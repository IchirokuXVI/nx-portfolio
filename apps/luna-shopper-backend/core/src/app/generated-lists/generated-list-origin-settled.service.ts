import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GENERATED_LIST_LIMITS,
  isLiveGeneratedList,
  SettlementOutcome,
  type GeneratedListLineOriginDetail,
  type GeneratedListSettleSkip,
  type SetGeneratedListOriginSettledRequest,
  type SetGeneratedListOriginSettledResult,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  GeneratedListFinishedException,
  NotFoundException,
  StaleQuantityException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOrigin,
  ListLine,
  ShoppingList,
} from '../entities';
import { GeneratedListOriginsService } from './generated-list-origins.service';
import { GeneratedListReopenService } from './generated-list-reopen.service';
import { GeneratedListSettleService } from './generated-list-settle.service';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';
import { namesOfLists } from './list-names';

/**
 * What one list got (plan 0104, section 4).
 *
 * ## The distinction this file rests on, which is the one next door read
 * backwards
 *
 * {@link GeneratedListOriginsService.setOriginQuantity} says what a list **asked
 * for**. This says what it **got**. They are two rows of the same sheet, they
 * move in opposite directions, and they are two messages precisely so that
 * neither can be mistaken for the other: a single message with two optional
 * fields would let a client send both and mean neither.
 *
 * So everything that file refuses to do, this one does. It writes settlements,
 * it sets the bought indicator, it moves `settledQuantity`, and it appears in a
 * consumption history — because a shopper saying the flat got two of these is
 * saying the flat bought two of these.
 *
 * ## Neither direction is implemented here
 *
 * Raising calls {@link GeneratedListSettleService.settle} with an allocation
 * naming one list, so the allocation, the owner's access check, the events, the
 * claim release and the skip report are the settle's own. Lowering calls
 * {@link GeneratedListReopenService.revertUnits} restricted to that origin, so
 * the split, the marked history and the units going back are the revert's own.
 *
 * What is left here is the bound, the `from` bargain, and the answer: the basket
 * line and the origin detail, both read back from the database, so the sheet
 * never computes one number on the row from the other.
 *
 * ## Who may
 *
 * The all or nothing rule of plan 0051 section 5.2, which is what
 * `setOriginQuantity` and the allocation already require: this message names a
 * list, and naming a list is naming zone data. A guest is refused, and that is
 * not a restriction on shopping. A guest still settles the whole line, or part
 * of it, through the settle route, and the default allocation decides where the
 * units land exactly as it does today.
 */
@Injectable()
export class GeneratedListOriginSettledService {
  constructor(
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    @InjectRepository(GeneratedListLineOrigin)
    private readonly origins: Repository<GeneratedListLineOrigin>,
    @InjectRepository(ListLine)
    private readonly zoneLines: Repository<ListLine>,
    // Read only, and only to name an origin this write could not reach.
    @InjectRepository(ShoppingList)
    private readonly shoppingLists: Repository<ShoppingList>,
    private readonly sharing: GeneratedListSharingService,
    private readonly generated: GeneratedListService,
    // The sheet's own composer, reused rather than repeated: this route answers
    // with the row that read produces, field for field.
    private readonly originsService: GeneratedListOriginsService,
    private readonly settleService: GeneratedListSettleService,
    private readonly reopenService: GeneratedListReopenService
  ) {}

  async setOriginSettled(
    req: SetGeneratedListOriginSettledRequest
  ): Promise<SetGeneratedListOriginSettledResult> {
    const settled = this.checkQuantity(req.settled, 'settled');
    this.checkQuantity(req.from, 'from');

    const { list, line } = await this.resolve(req);
    const origin = await this.origins.findOne({
      where: { generatedListLineId: line.id, lineId: req.sourceLineId },
    });
    if (!origin) {
      // Not a provenance row of this line, so there is no contribution to say
      // anything about. Raising a list that is not an origin yet is
      // `setOriginQuantity`, which is the other number on the same row.
      throw new NotFoundException('That list does not contribute to this line');
    }

    if (settled > origin.quantity) {
      // A list cannot have got more of a line than it asked for through this
      // basket (section 4). A shopper who bought more than that raises what the
      // list asked for first, which is the row's other reel.
      throw new ValidationException('That is more than this list asked for', {
        messageArgs: { field: 'settled' },
      });
    }

    const current =
      (await this.originsService.settledPerOrigin(line.id)).get(
        req.sourceLineId
      ) ?? 0;
    if (req.from !== current) {
      // The number as it now stands travels in the message (plan 0057,
      // section 5), which is the one channel that reaches the client. The
      // recovery is a refetch, because the whole row moved and not only this
      // one field.
      throw new StaleQuantityException(
        'This line has moved since you read it',
        { messageArgs: { current } }
      );
    }

    const skipped =
      settled === current
        ? []
        : settled > current
          ? await this.settleMore(list, req, origin, settled - current)
          : await this.revert(list, line, req, current - settled);

    return {
      ...(await this.answer(list, line, origin)),
      skippedCount: skipped.length,
      skipped,
    };
  }

  /**
   * Raising: the difference is bought, for that list alone (section 4).
   *
   * The ordinary settle with an allocation naming one list, which is what makes
   * this a settle rather than a second way of writing one. Everything the sheet
   * would otherwise have to reproduce comes with it: the owner's access check on
   * that origin, the zone line coming down, the `line.settled` the household
   * hears, the claim released when the basket line finishes, and the skip report
   * when the origin cannot be reached.
   *
   * The basket line's own outstanding amount still bounds it, because the settle
   * bounds every purchase by what is left to get. A raise that asks for more
   * than the line has outstanding is refused by the settle rather than clamped
   * here, so the two rules stay in one place.
   *
   * ## The one thing decided before the settle is called
   *
   * **Whether the owner may still write that list**, which is section 6.4's
   * question and is asked here with the settle's own read. A hand written
   * allocation naming a list the settle then skips has nowhere to put its units,
   * and the settle refuses the whole allocation rather than reporting a skip, so
   * a shopper whose owner lost access last week would be told their request was
   * malformed. Asked first, the answer is the skip report the plan promises and
   * no settlement is attempted. It is not a second copy of the allocation rule:
   * it decides whether to call the settle at all, and the settle asks the same
   * question again for itself.
   */
  private async settleMore(
    list: GeneratedList,
    req: SetGeneratedListOriginSettledRequest,
    origin: GeneratedListLineOrigin,
    units: number
  ): Promise<GeneratedListSettleSkip[]> {
    const writable = await this.sharing.writableAmong(list.ownerUserId, [
      origin.listId,
    ]);
    if (!writable.has(origin.listId)) {
      return this.name(
        [{ lineId: origin.lineId, listId: origin.listId }],
        'ACCESS_GONE'
      );
    }
    const result = await this.settleService.settle({
      generatedListId: req.generatedListId,
      lineId: req.lineId,
      participantId: req.participantId,
      // Never `NOT_AVAILABLE`. "The flat got two" is a purchase, and a shop that
      // had none is an outcome the settle route says in its own words.
      outcome: SettlementOutcome.BOUGHT,
      quantity: units,
      allocations: [{ listId: origin.listId, quantity: units }],
    });
    // Present for every reader of this route, because a caller who reached it
    // passed section 5.2 (see the result's own comment).
    return result.skipped ?? [];
  }

  /**
   * Lowering: that origin's newest purchases go back (section 4).
   *
   * The revert's walk with one origin named, so a purchase larger than the take
   * back is split with its buyer and its time intact, the units land back on
   * that list's own line, and another origin's purchases stand untouched.
   *
   * A close is not in this walk at all, and that is the definition of the number
   * rather than an omission: `NOT_AVAILABLE` bought nothing, so it is no part of
   * what any list got.
   */
  private async revert(
    list: GeneratedList,
    line: GeneratedListLine,
    req: SetGeneratedListOriginSettledRequest,
    units: number
  ): Promise<GeneratedListSettleSkip[]> {
    const reverted = await this.reopenService.revertUnits(list, line, {
      participantId: req.participantId,
      units,
      originLineId: req.sourceLineId,
      // Checked again under the write lock the revert takes, for plan 0056
      // section 3.2's reason: the check above was against rows read outside any
      // transaction.
      expectOriginSettled: req.from,
    });
    return this.name(reverted.skipped, 'ORIGIN_DELETED');
  }

  /**
   * An origin this write could not reach, named (plan 0053, section 4).
   *
   * Named rather than counted, because this route is refused outright to a
   * reader who may not be told a list's name at all, so there is no redaction
   * for the names to survive.
   */
  private async name(
    skipped: readonly { lineId: string; listId: string }[],
    reason: GeneratedListSettleSkip['reason']
  ): Promise<GeneratedListSettleSkip[]> {
    if (skipped.length === 0) {
      return [];
    }
    const names = await namesOfLists(
      this.shoppingLists,
      skipped.map((entry) => entry.listId)
    );
    return skipped.map((entry) => {
      const named = names.get(entry.listId);
      return {
        lineId: entry.lineId,
        listId: entry.listId,
        reason,
        listName: named?.name ?? null,
        zoneName: named?.zoneName ?? null,
      };
    });
  }

  /**
   * The row as it now stands, read back rather than composed from what was
   * asked for.
   *
   * Both numbers come from the database, which is section 4's last sentence: the
   * sheet draws "asked for" and "got" on one row, and a client that computed
   * either from the other would drift the moment a close, a split or another
   * shopper moved something it could not see.
   */
  private async answer(
    list: GeneratedList,
    line: GeneratedListLine,
    origin: GeneratedListLineOrigin
  ): Promise<{
    line: SetGeneratedListOriginSettledResult['line'];
    origin: GeneratedListLineOriginDetail | null;
  }> {
    const [fresh, source, view] = await Promise.all([
      this.origins.findOne({ where: { id: origin.id } }),
      this.zoneLines.findOne({ where: { id: origin.lineId } }),
      // A reader of this route passes section 5.2 by construction, so the line
      // is projected whole.
      this.generated.basketLineViewFor(line, true),
    ]);
    return {
      line: view,
      origin:
        fresh && source
          ? await this.originsService.detailOf(list, line, fresh, source)
          : null,
    };
  }

  /**
   * The basket, the line, and whether this participant may be here at all.
   *
   * The same resolution {@link GeneratedListOriginsService} makes, and refused on
   * the same terms: outright rather than redacted, because the answer is an
   * origin and every field of one names a zone or a list.
   */
  private async resolve(
    req: SetGeneratedListOriginSettledRequest
  ): Promise<{ list: GeneratedList; line: GeneratedListLine }> {
    const list = await this.lists.findOne({
      where: { id: req.generatedListId },
    });
    if (!list) {
      throw new NotFoundException('Generated list not found');
    }
    if (!isLiveGeneratedList(list.status)) {
      // Plan 0059's one rule: this writes the zone line and the settlement table
      // exactly as a settle does, and a finished trip does neither.
      throw new GeneratedListFinishedException(
        'This basket is finished, so nothing more can be settled in it'
      );
    }
    const line = await this.lines.findOne({
      where: { id: req.lineId, generatedListId: list.id },
    });
    if (!line) {
      throw new NotFoundException('Line not found');
    }

    const participant = await this.sharing.liveParticipantById(
      req.participantId,
      list.id
    );
    if (!participant) {
      throw new ForbiddenException('Not a participant of this basket');
    }
    const seesZoneData = await this.sharing.seesZoneData(participant);
    if (!seesZoneData) {
      throw new ForbiddenException(
        'Saying what one list got needs write access to every source list'
      );
    }

    return { list, line };
  }

  /** A whole number of units, within the ceiling a line may hold. */
  private checkQuantity(value: number, field: string): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new ValidationException(
        `${field} must be a whole number of units, or zero`,
        { messageArgs: { field } }
      );
    }
    if (value > GENERATED_LIST_LIMITS.maxQuantity) {
      throw new ValidationException(
        `${field} must be at most ${GENERATED_LIST_LIMITS.maxQuantity}`,
        { messageArgs: { field } }
      );
    }
    return value;
  }
}
