import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  isLiveGeneratedList,
  SettlementOutcome,
  type GeneratedListSettleResult,
  type SetGeneratedListLineOutstandingRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  GeneratedListFinishedException,
  NotFoundException,
  StaleQuantityException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { GeneratedList, GeneratedListLine } from '../entities';
import { GeneratedListReopenService } from './generated-list-reopen.service';
import { GeneratedListSettleService } from './generated-list-settle.service';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';

/**
 * What is outstanding is a number you can move (plan 0056, rewritten by plan
 * 0104).
 *
 * ## The rule, stated where it is implemented
 *
 * **The number on a basket line is what is still to get, and it runs between
 * zero and what the lists asked for. Lowering it means that many were bought.
 * Raising it takes purchases back, one unit at a time.**
 *
 * Plan 0056 put a different asymmetry here: raising meant the basket had decided
 * to buy more than the households asked for. The person holding the phone does
 * not see two meanings. They see one number, and the thing they reach for when
 * they put a tin back on the shelf is the same thing they reach for when they
 * want more of it, so the raise is now the undo and the sale is gone (plan 0104,
 * section 2.1).
 *
 * The rejected alternative was to keep the raise and add a separate revert
 * control. It fails on the screen rather than in the model: one number that goes
 * up for two unrelated reasons is the thing the client half was written to
 * remove.
 *
 * **Nothing here writes `quantity`.** That number is moved only by what the
 * lists ask for, which is `setOriginQuantity` (plan 0092). Lines carrying more
 * than the sum of their origins already exist and keep it: such a row is still
 * legal, still served, and still the ceiling of its own reel.
 *
 * ## Both directions are somebody else's implementation
 *
 * {@link GeneratedListSettleService.settle} is **called** for a lower and
 * {@link GeneratedListReopenService.revertUnits} for a raise, both unchanged.
 * The default allocation, the owner's access check per origin, the skip report,
 * the zone events, the claim moves and the `lastEditedByParticipantId` write all
 * come with them. A separate path that wrote settlements its own way is how two
 * ways of buying the same tin end up disagreeing about who bought it.
 *
 * Which is why this service is small: it is the bound, the `from` bargain and
 * the choice between the two.
 *
 * ## Why the inversion section 3.2 fears cannot happen here
 *
 * Two phones in one shop both read outstanding 5. One drags to 3, settling 2.
 * The other, a second behind, drags to 4 meaning "I got one" — and against a
 * current of 3 that reads as **raise by one**, so a purchase becomes a take back
 * nobody asked for. {@link SetGeneratedListLineOutstandingRequest.from} is what
 * refuses it, and the two branches make the refusal total rather than likely:
 *
 * - A **raise** re-reads the line under a write lock inside the revert's own
 *   transaction and checks `from` again there, so it cannot be applied to a line
 *   that moved.
 * - A **lower** can never become a raise whatever happens in between, because it
 *   reaches the settle as a `BOUGHT` outcome with a positive quantity, and the
 *   settle clamps that to whatever is outstanding when it looks. The worst a
 *   race can do to it is settle fewer units than were asked for, which is the
 *   safe direction to be wrong in: nobody's history gains a purchase.
 */
@Injectable()
export class GeneratedListOutstandingService {
  constructor(
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    private readonly sharing: GeneratedListSharingService,
    private readonly generated: GeneratedListService,
    private readonly settleService: GeneratedListSettleService,
    private readonly reopenService: GeneratedListReopenService
  ) {}

  async setOutstanding(
    req: SetGeneratedListLineOutstandingRequest
  ): Promise<GeneratedListSettleResult> {
    if (!Number.isInteger(req.outstanding) || req.outstanding < 0) {
      // Zero is the floor and it is a real value: the whole line settled, which
      // is what the "got all" button already does (section 5).
      throw new ValidationException(
        'outstanding must be a whole number of units, or zero',
        { messageArgs: { field: 'outstanding' } }
      );
    }
    if (!Number.isInteger(req.from) || req.from < 0) {
      throw new ValidationException(
        'from must be a whole number of units, or zero',
        { messageArgs: { field: 'from' } }
      );
    }

    const list = await this.lists.findOne({
      where: { id: req.generatedListId },
    });
    if (!list) {
      throw new NotFoundException('Generated list not found');
    }
    if (!isLiveGeneratedList(list.status)) {
      // Both directions, with its own code rather than a bare conflict, so the
      // screen can say "this shopping list is finished" instead of "that did not
      // work" (section 5, and plan 0055 section 3.3).
      throw new GeneratedListFinishedException('This basket is finished');
    }

    const line = await this.lines.findOne({
      where: { id: req.lineId, generatedListId: list.id },
    });
    if (!line) {
      throw new NotFoundException('Line not found');
    }

    // The same check the settle and the reopen make, before anything is decided
    // from the line: being on the basket is what this act is authorized by
    // (section 3.3), and for a lower the settle asks it again on its own.
    const participant = await this.sharing.livePresenceEntry(
      req.participantId,
      list.id
    );
    if (!participant) {
      throw new ForbiddenException('Not a participant of this basket');
    }

    if (req.outstanding > line.quantity) {
      // The top of the reel is what the lists asked for, and there is nothing
      // above it (plan 0104, section 2). A `ValidationException` rather than a
      // clamp: a client that asks for a number the rule forbids has a stale idea
      // of the line, and answering it with a different number would teach it
      // that its idea was right.
      throw new ValidationException('That is more than this line asks for', {
        messageArgs: { field: 'outstanding' },
      });
    }

    const current = outstandingOf(line);
    if (req.from !== current) {
      // The number as it now stands travels in the message (plan 0057,
      // section 5), which is the one channel that reaches the client: the
      // envelope drops `details`. The recovery is still a refetch, because the
      // whole line moved and not only this one field.
      throw new StaleQuantityException(
        'This line has moved since you read it',
        { messageArgs: { current } }
      );
    }

    if (req.outstanding === current) {
      // A drag that landed where it started is not an error (section 3), and it
      // writes nothing, announces nothing and is a success.
      return this.answer(req, line, 0);
    }

    if (req.outstanding > current) {
      return this.revert(req, list, line, current);
    }

    // Lowering is a settle, so it *is* the settle: the whole of section 3's
    // second row is this one call, including who it is authorized by, where the
    // units land and what everybody hears.
    return this.settleService.settle({
      generatedListId: req.generatedListId,
      lineId: req.lineId,
      participantId: req.participantId,
      // Never `NOT_AVAILABLE`, and it is not reachable from here at all
      // (section 6): that is an outcome rather than a quantity, and dragging a
      // number to zero must never be able to mean "the shop had none".
      outcome: SettlementOutcome.BOUGHT,
      quantity: current - req.outstanding,
    });
  }

  /**
   * Raising: this many purchases go back, newest first (plan 0104, section 3).
   *
   * The reopen's own walk, called with a number of units rather than with
   * everything the line has settled. So the units land back on the lists they
   * came off, the history is marked rather than deleted, a purchase larger than
   * the take back is split, and a line that had been finished claims its origins
   * again — all of it the reopen's, none of it written twice.
   *
   * **The answer carries the line**, as it always did, and the client redraws
   * from it rather than from what it asked for: a `NOT_AVAILABLE` close has no
   * units to divide, so a raise that reaches one takes the whole close back and
   * the number lands above where it was dragged (section 3.3).
   */
  private async revert(
    req: SetGeneratedListLineOutstandingRequest,
    list: GeneratedList,
    line: GeneratedListLine,
    current: number
  ): Promise<GeneratedListSettleResult> {
    const reverted = await this.reopenService.revertUnits(list, line, {
      participantId: req.participantId,
      units: req.outstanding - current,
      // Checked again under the write lock the revert takes, which is what makes
      // section 3.2 an invariant rather than a likelihood: the check above was
      // against a row read outside any transaction.
      expectOutstanding: current,
    });
    return this.answer(req, line, reverted.skippedCount);
  }

  /**
   * The settle's own answer shape for an act that settled nothing (section 7).
   *
   * One response shape in both directions, so a client has one thing to handle.
   * `settlements` is empty because nothing was bought: a revert takes rows away,
   * and a ref names where units landed. The two named arrays follow plan 0051
   * section 5.2 exactly as the settle's do, present only for a reader entitled to
   * names, so that a guest's raise and a guest's settle answer with the same
   * fields.
   *
   * A skipped origin **is** reported, in the count that survives the redaction:
   * a raise whose origin list has since been deleted has nowhere to put its
   * units back, and the shopper has to know something did not land.
   */
  private async answer(
    req: SetGeneratedListLineOutstandingRequest,
    line: GeneratedListLine,
    skippedCount: number
  ): Promise<GeneratedListSettleResult> {
    const seesZoneData = await this.seesZoneData(
      req.participantId,
      req.generatedListId
    );
    const view = await this.generated.basketLineViewFor(line, seesZoneData);
    if (!seesZoneData) {
      return { line: view, skippedCount };
    }
    return { line: view, skippedCount, settlements: [], skipped: [] };
  }

  /**
   * Whether this actor may be told which lists this line came from.
   *
   * Asked of core's own access tables at request time (plan 0051, section 5.2),
   * never taken from the request: the gateway computes the same value for its
   * own guard, but a value that travelled through a message is a value a future
   * caller could send.
   */
  private async seesZoneData(
    participantId: string,
    generatedListId: string
  ): Promise<boolean> {
    const participant = await this.sharing.liveParticipantById(
      participantId,
      generatedListId
    );
    return participant ? await this.sharing.seesZoneData(participant) : false;
  }
}

/**
 * What is still to get on a basket line: the number this whole plan is about.
 *
 * Floored at zero rather than trusted to be non negative, exactly as the settle
 * floors it, because `settledQuantity` above `quantity` is a state no write here
 * can produce but a reader should never have to reason about.
 */
function outstandingOf(line: GeneratedListLine): number {
  return Math.max(0, line.quantity - line.settledQuantity);
}
