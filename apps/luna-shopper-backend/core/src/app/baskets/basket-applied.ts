import {
  BasketStatus,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import { IsNull, MoreThanOrEqual, Raw, type EntityManager } from 'typeorm';
import { LineSettlement, type ListLine } from '../entities';
import type { BasketScope } from './basket-line-facts';

/**
 * The split of a basket's buys of a line between the ask and above it (plan
 * 0274), and the count of the units above it toward a raise (plan 0275).
 *
 * In a file of its own and not in `basket-demand.service.ts`, because
 * `LineService` counts with it and the demand service is built over
 * `LineService`: an import the other way would be a cycle of modules.
 */

/** One standing buy of a line through a basket, as {@link rebalanceApplied} reads it. */
export interface DemandBuy {
  id: string;
  quantity: number;
  applied: number;
}

/**
 * A standing buy as {@link buysOf} answers it: the numbers, and when and by
 * whom it was made, which the count of plan 0275 orders and names by.
 */
export interface StandingBuy extends DemandBuy {
  settledAt: Date;
  settledByParticipantId: string | null;
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

/** What counting the units above the ask toward a raise writes (plan 0275). */
export interface AboveAskCount {
  /** The units above the ask before the count. */
  above: number;
  /** The units of the raise the buys took; the line moves by the rest. */
  counted: number;
  /** New `applied` by settlement id, only for the ones that change. */
  changes: Map<string, number>;
}

/**
 * Count the units bought above the ask toward a raise of `delta` (plan 0275,
 * section 5).
 *
 * `buys` are oldest first, across every basket that counts, which is the order
 * {@link rebalanceApplied} gives units back to a raised ask in: the units that
 * stay above the ask are then on the newest buys, which a minus reaches first.
 * Each buy's `applied` rises by what is still to count, never above its
 * `quantity`. A delta of zero or below counts nothing.
 */
export function countAboveAsk(
  buys: readonly DemandBuy[],
  delta: number
): AboveAskCount {
  const above = buys.reduce(
    (sum, buy) => sum + Math.max(0, buy.quantity - buy.applied),
    0
  );
  const changes = new Map<string, number>();
  const counted = delta > 0 ? Math.min(delta, above) : 0;
  let give = counted;
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
  return { above, counted, changes };
}

/**
 * This basket's standing buys of one line in this trip, in the line's unit,
 * oldest first: the purchases the read counts the line's ask from (plan 0274,
 * section 3). The scope is the read's, so a `LIVE` basket counts its current
 * session alone.
 *
 * With `openOnly`, a basket that is no longer `OPEN` when this runs answers no
 * buys. The count of plan 0275 reads which baskets cover the list before it
 * takes the line's lock, so a basket finished in between is dropped here, in
 * the same query, under the lock.
 */
export async function buysOf(
  manager: EntityManager,
  basketId: string,
  line: Pick<ListLine, 'id' | 'unit'>,
  scope: BasketScope,
  options: { openOnly?: boolean } = {}
): Promise<StandingBuy[]> {
  if (!scope.enabled) {
    return [];
  }
  const rows = await manager.getRepository(LineSettlement).find({
    select: {
      id: true,
      quantity: true,
      applied: true,
      settledAt: true,
      settledByParticipantId: true,
    },
    where: {
      basketId: options.openOnly
        ? Raw(
            (column) =>
              `${column} = :buysOfBasketId AND EXISTS (SELECT 1 FROM "baskets" b WHERE b."id" = ${column} AND b."status" = :buysOfOpen)`,
            { buysOfBasketId: basketId, buysOfOpen: BasketStatus.OPEN }
          )
        : basketId,
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
    settledAt: row.settledAt,
    settledByParticipantId: row.settledByParticipantId,
  }));
}
