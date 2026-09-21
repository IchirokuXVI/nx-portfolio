import { Injectable } from '@nestjs/common';
import {
  isOpenBasket,
  type BasketRowResult,
  type SetBasketRowDemandRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  GeneratedListFinishedException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ListAccessService } from '../lists/list-access.service';
import { canChangeDemand } from '../lists/list-acts';
import { LineService } from '../lists/line.service';
import { BasketWriteContext } from './basket-write.context';
import { type BasketEntry } from './basket-rows';

/**
 * Changing what one household asks for, from the basket (plan 0136, section
 * 5.3).
 *
 * It replaces `setOriginQuantity`, the demand side of `setOutstanding`, and
 * `BelowSettledException`, whose floor ("fewer than this basket has already
 * bought for this list") cannot be stated at all now that `asked` is
 * `bought + left`: there is no stored number for a purchase to be below.
 *
 * ## The permission is the owner's, never the actor's
 *
 * Plan 0131's demand rule, asked of the basket's **owner**. A guest has no
 * permissions to ask about, and a registered co shopper's would let them move a
 * number on a household they have no standing in. The owner delegated shopping,
 * not permission, which is the same rule the settle follows.
 *
 * The answer is already in hand: `demandEditable` on the entry is this rule,
 * computed by the read for exactly this reason, because no client can compute it.
 *
 * ## It writes through `LineService.addQuantity` and not a save of its own
 *
 * So the approval rule, the audit and `line.updated` are the **list's** own,
 * which is the argument the old `promote` made about `LineService.add`. A copy
 * of the write here would be a second place for plan 0037's approval and plan
 * 0076's reversion to be implemented, and the two would drift.
 *
 * **`addQuantity` and not `update`.** `update` with a quantity alone saves the
 * row it read outside any lock, so a quantity edit that raced a settle would
 * overwrite the decrement. `addQuantity` reads under `pessimistic_write`, and
 * plan 0136 adds `expect` to it so the `from` bargain is checked against that
 * same locked read.
 */
@Injectable()
export class BasketDemandService {
  constructor(
    private readonly context: BasketWriteContext,
    private readonly lines: LineService,
    // The **owner's** permissions on the entry's list, never the actor's.
    private readonly listAccess: ListAccessService,
    private readonly events: CoreEventsPublisher
  ) {}

  async setDemand(req: SetBasketRowDemandRequest): Promise<BasketRowResult> {
    const opened = await this.context.open(req);
    if (!isOpenBasket(opened.basket.status)) {
      throw new GeneratedListFinishedException(
        'This basket is finished, so what it asks for cannot be changed'
      );
    }
    if (!Number.isInteger(req.quantity) || req.quantity < 0) {
      throw new ValidationException('quantity must be a whole number', {
        messageArgs: { field: 'quantity' },
      });
    }

    const row = await opened.row(req.rowKey);
    const entry = this.pick(row.entries, req, opened.servedListIds);

    // Plan 0131's rule, asked of the owner. The read serves the same answer as
    // `demandEditable`, and this is the enforcement behind it.
    if (
      !(await this.ownerMayChange(opened.basket.ownerUserId, entry))
    ) {
      throw new ForbiddenException(
        'This list does not allow its quantity to be changed from here'
      );
    }

    const delta = req.quantity - req.from;
    if (delta === 0) {
      // A delta of zero writes nothing and answers the row. `addQuantity`
      // refuses one as a client bug, and from here it is an ordinary no-op: a
      // reel let go where it started.
      return opened.result([entry.lineId], req.rowKey);
    }

    // As the **owner**, which is what makes this a delegated write rather than
    // the actor's own. `expect` carries the `from` bargain into the locked read,
    // so a settle that landed between the resolve and the write refuses this
    // rather than overwriting it.
    await this.lines.addQuantity({
      userId: opened.basket.ownerUserId,
      lineId: entry.lineId,
      delta,
      expect: req.from,
      // The change record names the person who moved it and the basket they
      // moved it from, which is **not** the owner above (plan 0138, section 4):
      // a guest shopping somebody else's list leaves a change with a participant
      // and no account.
      via: opened.via(),
    });

    opened.announceLinesChanged([entry.lineId], this.events);
    return opened.result([entry.lineId], req.rowKey);
  }

  /**
   * Which entry this request moves.
   *
   * `lineId` is required when the row holds more than one entry, because a row
   * of two households asks two different questions and a client that named
   * neither has not asked one. A reader with no list refs, a guest for one, can
   * therefore change demand on single entry rows only (plan 0130, section 5).
   */
  private pick(
    entries: readonly BasketEntry[],
    req: SetBasketRowDemandRequest,
    servedListIds: ReadonlySet<string>
  ): BasketEntry {
    if (req.lineId === undefined) {
      if (entries.length !== 1) {
        throw new ValidationException(
          'this row comes from more than one list, so say which',
          { messageArgs: { field: 'lineId' } }
        );
      }
      return entries[0];
    }
    const entry = entries.find((candidate) => candidate.lineId === req.lineId);
    if (!entry || !servedListIds.has(entry.listId)) {
      // The same refusal for "not in this row" and "you were not told this list
      // is in this row", so the route cannot be used to learn which households
      // the redaction withheld.
      throw new ValidationException('that line is not part of this row', {
        messageArgs: { field: 'lineId' },
      });
    }
    return entry;
  }

  /**
   * Plan 0131's `canChangeDemand`, asked of the owner on this entry's list.
   *
   * It is asked again here rather than trusted from the read, for the reason
   * section 5.2 of plan 0051 gives about every value that travelled: the read
   * happened on another request, and access moves.
   */
  private async ownerMayChange(
    ownerUserId: string,
    entry: BasketEntry
  ): Promise<boolean> {
    const permissions = await this.listAccess.permissionsAmong(ownerUserId, [
      entry.listId,
    ]);
    return canChangeDemand(
      permissions.get(entry.listId) ?? new Set(),
      entry.approvalStatus
    );
  }
}
