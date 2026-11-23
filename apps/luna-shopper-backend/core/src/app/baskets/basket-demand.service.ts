import { Injectable } from '@nestjs/common';
import {
  isOpenBasket,
  SettlementOutcome,
  type BasketRowResult,
  type SetBasketRowDemandRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketFinishedException,
  ForbiddenException,
  NotFoundException,
  StaleQuantityException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  DataSource,
  IsNull,
  MoreThanOrEqual,
  type EntityManager,
} from 'typeorm';
import { LineSettlement, ListLine } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { assertLineUnit, requireLineUnit } from '../lists/line-unit-rules';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { canChangeDemand } from '../lists/list-acts';
import { basketScopeOf, type BasketScope } from './basket-line-facts';
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
 * bought for this list") is not a refusal any more.
 *
 * ## An ask below what the buys met (plan 0274, section 5)
 *
 * `quantity` is what the list asks from now on, and the ask is the line's
 * `left` plus the units of this basket's buys that met it (`applied`). So an
 * ask of `n` below what the buys met cannot be a line quantity: the line goes
 * to 0, and `applied` is lowered on this basket's standing buys of the line,
 * newest first, until it adds up to `n`. The units taken off become units
 * above the ask, which a minus takes first. An ask raised again gives units
 * above the ask back to it, oldest buy first, before the line holds anything:
 * `applied` adds up to the smaller of `n` and what was bought, and the line
 * holds the rest of `n`. {@link rebalanceApplied} is that arithmetic.
 *
 * Nothing about it is a refusal: a household that asks for less than was
 * already bought asks for less, and what was bought stays bought.
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
 * **`addQuantity` with `expect`.** A shopper moving a household's demand acts
 * on a number they were shown, so the write is a delta from `from` and refuses
 * when the line no longer holds `from`. `addQuantity` reads under
 * `pessimistic_write`, and plan 0136 adds `expect` to it so the `from` bargain
 * is checked against that same locked read: a settle that landed in between
 * refuses the gesture rather than moving the line to a number nobody meant.
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
    private readonly events: CoreEventsPublisher,
    // The split of this basket's buys between the ask and above it (plan
    // 0274, section 5). Last, so no positional construction has to shift.
    private readonly dataSource: DataSource
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
    // Required, and checked like a delta's (plan 0246, section 3.4).
    requireLineUnit(req.unit);

    const entry = await this.pick(opened, req);
    // Asked of the line as read here, so a demand in another unit is refused
    // even when it would write nothing; `addQuantity` asks it again under the
    // lock.
    assertLineUnit(entry, req.unit);

    // Plan 0131's rule, asked of the owner. The read serves the same answer as
    // `demandEditable`, and this is the enforcement behind it.
    if (!(await this.ownerMayChange(opened.basket.ownerUserId, entry))) {
      throw new ForbiddenException(
        'This list does not allow its quantity to be changed from here'
      );
    }

    // What this basket's buys of the line met, read before anything is locked
    // to know which write this is, and read again under the lock below.
    const scope = await basketScopeOf(this.dataSource, opened.basket);
    const planned = rebalanceApplied(
      await buysOf(this.dataSource.manager, opened.basket.id, entry, scope),
      req.quantity
    );
    const delta = planned.left - req.from;
    if (delta === 0 && planned.changes.size === 0) {
      // A delta of zero writes nothing and answers the row. `addQuantity`
      // refuses one as a client bug, and from here it is an ordinary no-op: a
      // reel let go where it started.
      return opened.result([entry.id]);
    }

    /**
     * The same arithmetic under the lock the line write holds, and the write of
     * `applied` it gives. A settle or a revert that landed since the read above
     * moved either the line or this basket's buys, and the gesture is refused
     * as `from` refuses it rather than applied to numbers nobody was shown.
     */
    const underLock = async (
      manager: EntityManager,
      line: ListLine
    ): Promise<void> => {
      const now = rebalanceApplied(
        await buysOf(manager, opened.basket.id, line, scope),
        req.quantity
      );
      if (now.left !== line.quantity + delta) {
        throw new StaleQuantityException(
          'Somebody else changed this while you were looking at it',
          { messageArgs: { current: line.quantity } }
        );
      }
      const settlements = manager.getRepository(LineSettlement);
      for (const [id, applied] of now.changes) {
        await settlements.update({ id }, { applied });
      }
    };

    if (delta === 0) {
      // The line keeps its number and only the split of this basket's buys
      // moves (plan 0274, section 5): an ask set below what the buys met, or
      // raised back over units that were above it. Nothing changed on the
      // list, so no other basket's rows moved, and this basket is told alone.
      await this.dataSource.transaction(async (manager) => {
        const line = await manager.getRepository(ListLine).findOne({
          where: { id: entry.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!line || line.deletedAt !== null) {
          throw new NotFoundException('Row not found');
        }
        assertLineUnit(line, req.unit);
        if (line.quantity !== req.from) {
          throw new StaleQuantityException(
            'Somebody else changed this while you were looking at it',
            { messageArgs: { current: line.quantity } }
          );
        }
        await underLock(manager, line);
      });
      opened.announceBasketMoved([
        { listId: entry.listId, lineId: entry.id, recorded: false },
      ]);
      return opened.result([entry.id]);
    }

    // As the **owner**, which is what makes this a delegated write rather than
    // the actor's own. `expect` carries the `from` bargain into the locked read,
    // so a settle that landed between the resolve and the write refuses this
    // rather than overwriting it.
    await this.lines.addQuantity(
      {
        userId: opened.basket.ownerUserId,
        lineId: entry.id,
        delta,
        unit: req.unit,
        expect: req.from,
        // The change record names the person who moved it and the basket they
        // moved it from, which is **not** the owner above (plan 0138, section
        // 4): a guest shopping somebody else's list leaves a change with a
        // participant and no account.
        via: opened.via(),
      },
      underLock
    );

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

/** One standing buy of a line through a basket, as {@link rebalanceApplied} reads it. */
export interface DemandBuy {
  id: string;
  quantity: number;
  applied: number;
}

/** What setting an ask writes: the line's new `left`, and each `applied` that moves. */
export interface DemandPlan {
  left: number;
  /** New `applied` by settlement id, only for the ones that change. */
  changes: Map<string, number>;
}

/**
 * The split of an ask of `asked` between the line and this basket's buys
 * (plan 0274, section 5). `buys` are oldest first.
 *
 * The buys meet as much of the ask as they can: their `applied` adds up to the
 * smaller of `asked` and what they bought, and the line holds the rest. When
 * that sum goes down, `applied` is taken off the newest buys first, so the
 * units above the ask sit on the buys a minus reaches first. When it goes up,
 * units above the ask are given to it from the oldest buys first, for the same
 * reason.
 *
 * With no units above the ask and an ask at or above what was bought, nothing
 * moves on the buys and the line holds `asked - bought`.
 */
export function rebalanceApplied(
  buys: readonly DemandBuy[],
  asked: number
): DemandPlan {
  const bought = buys.reduce((sum, buy) => sum + buy.quantity, 0);
  const held = buys.reduce((sum, buy) => sum + buy.applied, 0);
  const target = Math.min(asked, bought);
  const changes = new Map<string, number>();

  if (target < held) {
    let cut = held - target;
    for (const buy of [...buys].reverse()) {
      if (cut <= 0) {
        break;
      }
      const take = Math.min(cut, buy.applied);
      if (take > 0) {
        changes.set(buy.id, buy.applied - take);
        cut -= take;
      }
    }
  } else if (target > held) {
    let give = target - held;
    for (const buy of buys) {
      if (give <= 0) {
        break;
      }
      const room = Math.min(give, buy.quantity - buy.applied);
      if (room > 0) {
        changes.set(buy.id, buy.applied + room);
        give -= room;
      }
    }
  }

  return { left: asked - target, changes };
}

/**
 * This basket's standing buys of one line in this trip, in the line's unit,
 * oldest first: the purchases the read counts the line's ask from (plan 0274,
 * section 3). The scope is the read's, so a `LIVE` basket counts its current
 * session alone.
 */
async function buysOf(
  manager: EntityManager,
  basketId: string,
  line: Pick<ListLine, 'id' | 'unit'>,
  scope: BasketScope
): Promise<DemandBuy[]> {
  if (!scope.enabled) {
    return [];
  }
  const rows = await manager.getRepository(LineSettlement).find({
    select: { id: true, quantity: true, applied: true },
    where: {
      basketId,
      lineId: line.id,
      outcome: SettlementOutcome.BOUGHT,
      unit: line.unit ?? 'UNIT',
      revertedAt: IsNull(),
      ...(scope.startedAt
        ? { settledAt: MoreThanOrEqual(scope.startedAt) }
        : {}),
    },
    order: { settledAt: 'ASC', id: 'ASC' },
  });
  return rows.map((row) => ({
    id: row.id,
    quantity: row.quantity,
    applied: row.applied,
  }));
}
