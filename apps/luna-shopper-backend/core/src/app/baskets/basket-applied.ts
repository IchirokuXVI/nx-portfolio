import {
  BasketStatus,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import { IsNull, MoreThanOrEqual, Raw, type EntityManager } from 'typeorm';
import { LineSettlement, type ListLine } from '../entities';
import type { BasketScope } from './basket-line-facts';

/**
 * The split of a basket's buys of a line between the ask and above it (plan
 * 0274), and the absorption of the units above it on a raise (plan 0276).
 *
 * In a file of its own and not in `basket-demand.service.ts`, because
 * `LineService` absorbs with it and the demand service is built over
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
 * whom it was made, which the report of plan 0276 orders and names by.
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
 * (plan 0274, section 5; plan 0276, section 11). `buys` are oldest first.
 *
 * `held` is what the buys meet of the ask now, the sum of their `applied`.
 * An ask below it lowers `applied` on the newest buys first until it adds up
 * to `asked`, so the units taken off sit on the buys a minus reaches first,
 * and the line holds nothing. An ask at or above it moves no buy, and the
 * line holds `asked - held`: units above the ask are never given back to a
 * rising ask here, because the raise that writes the line takes every one of
 * them into the ask under the same lock (`LineService.absorbExtra`).
 */
export function rebalanceApplied(
  buys: readonly DemandBuy[],
  asked: number
): DemandPlan {
  const held = buys.reduce((sum, buy) => sum + buy.applied, 0);
  const changes = new Map<string, number>();

  if (asked >= held) {
    return { left: asked - held, changes };
  }

  let cut = held - asked;
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
  return { left: 0, changes };
}

/** What taking the units above the ask into the ask writes (plan 0276). */
export interface AboveAskAbsorption {
  /** The units above the ask that the absorption took in. */
  above: number;
  /** New `applied` by settlement id, only for the buys that move. */
  changes: Map<string, number>;
}

/**
 * Take every unit bought above the ask into the ask on a raise (plan 0276,
 * section 1): each buy's `applied` becomes its `quantity`.
 *
 * `buys` are oldest first, across every basket that counts, and the changes
 * keep that order. A buy with nothing above the ask does not move.
 */
export function absorbAboveAsk(buys: readonly DemandBuy[]): AboveAskAbsorption {
  const changes = new Map<string, number>();
  let above = 0;
  for (const buy of buys) {
    if (buy.quantity > buy.applied) {
      above += buy.quantity - buy.applied;
      changes.set(buy.id, buy.quantity);
    }
  }
  return { above, changes };
}

/**
 * This basket's standing buys of one line in this trip, in the line's unit,
 * oldest first: the purchases the read counts the line's ask from (plan 0274,
 * section 3). The scope is the read's, so a `LIVE` basket counts its current
 * session alone.
 *
 * With `openOnly`, a basket that is no longer `OPEN` when this runs answers no
 * buys. A raise can read which baskets cover the list before it takes the
 * line's lock (plan 0276, section 1), so a basket finished in between is dropped here, in
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
