import { Injectable } from '@nestjs/common';
import {
  isOpenBasket,
  type BasketRowResult,
  type SetBasketRowDemandRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketFinishedException,
  ForbiddenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { ListLine } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { canChangeDemand } from '../lists/list-acts';
import {
  BasketWriteContext,
  type OpenBasketWrite,
} from './basket-write.context';

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
 *
 * ## It names its line, and the line can be at zero (plan 0201)
 *
 * `lineId` is always required. The line has to be on a covered list, and it
 * does **not** have to be a row of the basket: a list that held a product
 * before holds its line at zero, and raising that line is how the list asks
 * for the product again. Every other write refuses a line the basket does not
 * draw.
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
      throw new BasketFinishedException(
        'This basket is finished, so what it asks for cannot be changed'
      );
    }
    if (!Number.isInteger(req.quantity) || req.quantity < 0) {
      throw new ValidationException('quantity must be a whole number', {
        messageArgs: { field: 'quantity' },
      });
    }

    const entry = await this.pick(opened, req);

    // Plan 0131's rule, asked of the owner. The read serves the same answer as
    // `demandEditable`, and this is the enforcement behind it.
    if (!(await this.ownerMayChange(opened.basket.ownerUserId, entry))) {
      throw new ForbiddenException(
        'This list does not allow its quantity to be changed from here'
      );
    }

    const delta = req.quantity - req.from;
    if (delta === 0) {
      // A delta of zero writes nothing and answers the row. `addQuantity`
      // refuses one as a client bug, and from here it is an ordinary no-op: a
      // reel let go where it started.
      return opened.result([entry.id]);
    }

    // As the **owner**, which is what makes this a delegated write rather than
    // the actor's own. `expect` carries the `from` bargain into the locked read,
    // so a settle that landed between the resolve and the write refuses this
    // rather than overwriting it.
    await this.lines.addQuantity({
      userId: opened.basket.ownerUserId,
      lineId: entry.id,
      delta,
      expect: req.from,
      // The change record names the person who moved it and the basket they
      // moved it from, which is **not** the owner above (plan 0138, section 4):
      // a guest shopping somebody else's list leaves a change with a participant
      // and no account.
      via: opened.via(),
    });

    // No announcement of its own (plan 0204, section 3). `addQuantity` tells
    // every basket that covers the list what the line reads now, this one
    // included, and says that the marks moved: the other people of this basket
    // are shown the change (plan 0138, section 5). A second announcement here
    // would be the same patch computed twice.
    return opened.result([entry.id]);
  }

  /**
   * The line this request moves.
   *
   * **Who may name a line did not change with plan 0201.** An actor who was
   * served the list, which is a reader who writes it themselves, names any
   * line of it. An actor who was not, a guest for one, names a line only when
   * it is the whole of its row, which is the rule plan 0130 section 5 gave as
   * "a guest can change demand on single entry rows only". The refusal is the
   * one of before, so the route cannot be used to learn which households the
   * redaction withheld.
   */
  private async pick(
    opened: OpenBasketWrite,
    req: SetBasketRowDemandRequest
  ): Promise<ListLine> {
    if (typeof req.lineId !== 'string' || req.lineId.length === 0) {
      throw new ValidationException('lineId is required', {
        messageArgs: { field: 'lineId' },
      });
    }
    const line = await opened.line(req.rowKey, req.lineId);
    if (
      !opened.servedListIds.has(line.listId) &&
      !(await opened.aloneInItsRow(line.id))
    ) {
      throw new ValidationException('that line is not part of this row', {
        messageArgs: { field: 'lineId' },
      });
    }
    return line;
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
    entry: Pick<ListLine, 'listId' | 'approvalStatus'>
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
