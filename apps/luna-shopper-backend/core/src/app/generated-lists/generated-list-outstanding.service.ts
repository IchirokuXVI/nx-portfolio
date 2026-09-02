import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  isLiveGeneratedList,
  LINE_QUANTITY_MAX,
  RealtimeEvent,
  SettlementOutcome,
  type GeneratedListLineMovedEvent,
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
import { DataSource, Repository } from 'typeorm';
import { GeneratedList, GeneratedListLine } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { GeneratedListSettleService } from './generated-list-settle.service';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';

/**
 * What is outstanding is a number you can move (plan 0056).
 *
 * ## The rule, stated where it is implemented
 *
 * **The number on a basket line is what is still to get. Raising it means this
 * basket will buy more. Lowering it means that many were bought.**
 *
 * That asymmetry is the whole design rather than two behaviours bolted onto one
 * control. Outstanding goes down when units are dealt with, and the only thing
 * that deals with a unit is buying it; outstanding goes up when the basket
 * decides to carry more than the households asked for, which is a sale on the
 * shelf and not a purchase.
 *
 * The rejected alternative was a control that edits `quantity` in both
 * directions. It is wrong in the case this exists for: a shopper who takes three
 * of five off the shelf and edits the line down to two has said nothing about
 * buying anything, and the household's list still believes five are wanted. The
 * number they touched would mean "demand" while the number beside it means
 * "outstanding", and the screen would carry two quantities to tell apart while
 * holding a trolley.
 *
 * ## Lowering is the settle, not a second one
 *
 * {@link GeneratedListSettleService.settle} is **called**, unchanged. The
 * default allocation, the owner's access check per origin, the skip report, the
 * zone `line.settled` events, the claim release on a finished line and the
 * `lastEditedByParticipantId` write all come with it, and the answer is the same
 * {@link GeneratedListSettleResult} the settle route returns. A separate path
 * that wrote settlements its own way is how two ways of buying the same tin end
 * up disagreeing about who bought it.
 *
 * Which is why this service is small: only the raise is new, and the raise
 * touches one row.
 *
 * ## Why the inversion section 3.2 fears cannot happen here
 *
 * Two phones in one shop both read outstanding 5. One drags to 3, settling 2.
 * The other, a second behind, drags to 4 meaning "I got one" — and against a
 * current of 3 that reads as **raise by one**, so a purchase becomes a demand
 * nobody expressed. {@link SetGeneratedListLineOutstandingRequest.from} is what
 * refuses it, and the two branches make the refusal total rather than likely:
 *
 * - A **raise** re-reads the line under a write lock inside its own transaction
 *   and checks `from` again there, so it cannot be applied to a line that moved.
 * - A **lower** can never become a raise whatever happens in between, because it
 *   reaches the settle as a `BOUGHT` outcome with a positive quantity, and the
 *   settle clamps that to whatever is outstanding when it looks. The worst a
 *   race can do to it is settle fewer units than were asked for, which is the
 *   safe direction to be wrong in: nobody's history gains a purchase.
 */
@Injectable()
export class GeneratedListOutstandingService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    private readonly sharing: GeneratedListSharingService,
    private readonly generated: GeneratedListService,
    private readonly settleService: GeneratedListSettleService,
    private readonly events: CoreEventsPublisher
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
      return this.answerWithoutSettling(req, line);
    }

    if (req.outstanding > current) {
      return this.raise(req, list, line, current);
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
   * Raising: this basket will buy more, and nothing has been bought.
   *
   * `settledQuantity` is untouched, every `LineSettlement` stands and no zone is
   * read or written. A raise on a **finished** line therefore takes it from done
   * to partly settled, because it now wants more than it has got — which looks
   * like undoing a purchase and is not one (section 3.1). Undoing a purchase is
   * plan 0054's reopen, and the two are offered as different things.
   */
  private async raise(
    req: SetGeneratedListLineOutstandingRequest,
    list: GeneratedList,
    line: GeneratedListLine,
    current: number
  ): Promise<GeneratedListSettleResult> {
    await this.dataSource.transaction(async (manager) => {
      const basketLines = manager.getRepository(GeneratedListLine);
      // Re-read under a write lock and check `from` again against what it says.
      // The first check was against a row read outside any transaction, so on
      // its own it is a check against a number that may already be stale; this
      // is the one that makes section 3.2 an invariant rather than a likelihood.
      const locked = await basketLines.findOne({
        where: { id: line.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        throw new NotFoundException('Line not found');
      }
      const held = outstandingOf(locked);
      if (held !== current) {
        throw new StaleQuantityException(
          'This line has moved since you read it',
          { messageArgs: { current: held } }
        );
      }

      const raised = locked.quantity + (req.outstanding - held);
      if (raised > LINE_QUANTITY_MAX) {
        // Applied to the resulting `quantity` and not to the outstanding number,
        // so a partly settled line cannot be raised past the same limit an
        // unsettled one has (section 5).
        throw new ValidationException('That is more than a line can ask for', {
          messageArgs: { field: 'outstanding' },
        });
      }

      locked.quantity = raised;
      locked.lastEditedByParticipantId = req.participantId;
      locked.lastEditedAt = new Date();
      await basketLines.save(locked);
      // Carried back onto the row this call is holding, so the view composed
      // after the transaction describes the line as it now stands.
      line.quantity = locked.quantity;
      line.lastEditedByParticipantId = locked.lastEditedByParticipantId;
      line.lastEditedAt = locked.lastEditedAt;
    });

    // The basket's own room and nothing else (section 7). No zone hears a raise,
    // because no zone list moved: the households still want what they asked for,
    // and this basket has decided to carry more than that.
    //
    // Redacted to the least privileged reader in the room, because a broadcast
    // cannot be projected per socket. Nothing is lost by that: the three gated
    // fields do not move when a quantity does, so a reader who passes plan 0051
    // section 5.2 merges the mutable fields onto the line they already hold.
    const announcement: GeneratedListLineMovedEvent = {
      generatedListId: list.id,
      line: await this.generated.basketLineViewFor(line, false),
    };
    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListLineUpdated,
      list.id,
      announcement
    );

    return this.answerWithoutSettling(req, line);
  }

  /**
   * The settle's own answer shape for an act that settled nothing (section 7).
   *
   * One response shape in both directions, so a client has one thing to handle,
   * and every number in it is true of a raise: no origin was skipped because
   * none was reached, and no settlement was written because nothing was bought.
   * The two named arrays follow plan 0051 section 5.2 exactly as the settle's do,
   * present only for a reader entitled to names, so that a guest's raise and a
   * guest's settle answer with the same fields.
   */
  private async answerWithoutSettling(
    req: SetGeneratedListLineOutstandingRequest,
    line: GeneratedListLine
  ): Promise<GeneratedListSettleResult> {
    const seesZoneData = await this.seesZoneData(
      req.participantId,
      req.generatedListId
    );
    const view = await this.generated.basketLineViewFor(line, seesZoneData);
    if (!seesZoneData) {
      return { line: view, skippedCount: 0 };
    }
    return { line: view, skippedCount: 0, settlements: [], skipped: [] };
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
 * floors it, because `settledQuantity` above `quantity` is a state a raise can
 * never produce but a reader should never have to reason about.
 */
function outstandingOf(line: GeneratedListLine): number {
  return Math.max(0, line.quantity - line.settledQuantity);
}
