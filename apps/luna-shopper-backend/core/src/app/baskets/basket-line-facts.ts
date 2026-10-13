import {
  BasketKind,
  PURCHASE_SESSION_GAP_MS,
  type SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import {
  BASKET_SESSION_LOOKBACK_MS,
  BASKET_SESSION_SQL,
  STANDING_SKIPS_SQL,
  type BasketElsewhereRow,
  type BasketLineSkipRow,
  type BasketSessionRow,
  type BasketSettlementRow,
  type CoveredLineItemRow,
  type CoveredLineRow,
} from './basket-read.sql';
import type {
  BasketElsewhereFact,
  BasketEntry,
  BasketSettlementFact,
  BasketSkipFact,
} from './basket-rows';

/**
 * The two facts about a basket that every read of its lines starts from (plan
 * 0204, section 3).
 *
 * The basket read, the row resolver and the patch of an event each ask which
 * purchases are in scope, and the read and the patch each ask which skips
 * stand. Three callers of one statement must not hold three copies of what its
 * answer means, so the two questions are asked here and nowhere else.
 *
 * Free functions over "something that can run a query", so a service asks with
 * the repository it already holds and gains no dependency.
 */
export interface BasketQueryRunner {
  query<T>(sql: string, parameters?: unknown[]): Promise<T>;
}

/** Which purchases of a basket a read or a write counts. */
export interface BasketScope {
  startedAt: Date | null;
  enabled: boolean;
}

/**
 * Which of this basket's purchases count (plan 0136, section 3.1, step 2).
 *
 * A `GENERATED` basket is a trip, so every standing purchase it made is in
 * scope and there is no lower bound. A `LIVE` basket never ends, so the scope
 * is the **current session** and there may be none, in which case `bought` is
 * zero everywhere and yesterday's shop does not reappear as today's progress.
 */
export async function basketScopeOf(
  runner: BasketQueryRunner,
  basket: { id: string; kind: BasketKind }
): Promise<BasketScope> {
  if (basket.kind !== BasketKind.LIVE) {
    return { startedAt: null, enabled: true };
  }
  const [session] = await runner.query<BasketSessionRow[]>(BASKET_SESSION_SQL, [
    basket.id,
    BASKET_SESSION_LOOKBACK_MS,
    PURCHASE_SESSION_GAP_MS,
  ]);
  return session
    ? { startedAt: session.startedAt, enabled: true }
    : { startedAt: null, enabled: false };
}

/**
 * The standing skips of an **open** basket, by line (plan 0137, section 3).
 *
 * Over the whole basket rather than over a line list: the statement is an index
 * range on `("basketId", "lineId")` and a basket holds a handful of skips, so
 * narrowing it would add a parameter and save nothing.
 *
 * A caller that may hold a finished basket asks nothing: its rows come from
 * `basket_trip_rows`, and a skip is an intention about a trip that is over.
 */
export async function standingSkipsOf(
  runner: BasketQueryRunner,
  basketId: string,
  skipWindowMs: number
): Promise<Map<string, BasketSkipFact>> {
  const rows = await runner.query<BasketLineSkipRow[]>(STANDING_SKIPS_SQL, [
    basketId,
    skipWindowMs,
  ]);
  return new Map(
    rows.map((row) => [
      row.lineId,
      {
        // `pg` hands a `timestamptz` back as a `Date`, but a driver that
        // handed back a string would otherwise reach `getTime` and throw.
        skippedAt:
          row.skippedAt instanceof Date
            ? row.skippedAt
            : new Date(row.skippedAt),
        skippedByParticipantId: row.skippedByParticipantId,
        fresh: row.fresh,
      },
    ])
  );
}

/**
 * Stitch the four row reads into the shape the pure rules take.
 *
 * A free function rather than a method for the reason the rest of `basket-rows`
 * is: it is the join the database did not do, and a spec can state it.
 */
export function toEntries(
  lines: readonly CoveredLineRow[],
  items: readonly CoveredLineItemRow[],
  settlements: readonly BasketSettlementRow[],
  /**
   * What other baskets bought lately, one row per line (plan 0188). Empty for a
   * caller that writes on a row rather than drawing it: the row resolver hands a
   * write this basket's own purchases, and no write acts on anybody else's.
   */
  elsewhere: readonly BasketElsewhereRow[] = []
): BasketEntry[] {
  const itemsByLine = new Map<string, string[]>();
  for (const row of items) {
    const held = itemsByLine.get(row.lineId);
    if (held) {
      held.push(row.itemId);
    } else {
      itemsByLine.set(row.lineId, [row.itemId]);
    }
  }

  const settlementsByLine = new Map<string, BasketSettlementFact[]>();
  for (const row of settlements) {
    const fact: BasketSettlementFact = {
      id: row.id,
      outcome: row.outcome as SettlementOutcome,
      quantity: row.quantity,
      // `pg` hands a `timestamptz` back as a `Date`, but a driver that hands
      // back a string would otherwise reach `toISOString` and throw.
      settledAt:
        row.settledAt instanceof Date ? row.settledAt : new Date(row.settledAt),
      settledByParticipantId: row.settledByParticipantId,
      // Computed by the database against its own `now()` (plan 0137, section
      // 4), and read for a `LIVE` basket's close alone.
      fresh: row.fresh,
    };
    const held = settlementsByLine.get(row.lineId);
    if (held) {
      held.push(fact);
    } else {
      settlementsByLine.set(row.lineId, [fact]);
    }
  }

  const elsewhereByLine = new Map<string, BasketElsewhereFact>();
  for (const row of elsewhere) {
    elsewhereByLine.set(row.lineId, {
      // `SUM` over an integer column is a bigint to Postgres, and `pg` hands a
      // bigint back as a string. The statement casts it, and this does not
      // trust the cast to survive an edit.
      quantity: Number(row.quantity),
      settledAt:
        row.settledAt instanceof Date ? row.settledAt : new Date(row.settledAt),
      throughBasket: row.throughBasket === true,
    });
  }

  return lines.map((line) => ({
    lineId: line.id,
    listId: line.listId,
    content: line.content,
    quantity: line.quantity,
    version: line.version,
    itemSetHash: line.itemSetHash,
    approvalStatus: line.approvalStatus,
    createdAt:
      line.createdAt instanceof Date
        ? line.createdAt
        : new Date(line.createdAt),
    itemIds: itemsByLine.get(line.id) ?? [],
    settlements: settlementsByLine.get(line.id) ?? [],
    elsewhere: elsewhereByLine.get(line.id) ?? null,
  }));
}
