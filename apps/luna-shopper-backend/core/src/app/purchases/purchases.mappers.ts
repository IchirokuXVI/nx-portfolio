import {
  SettlementOutcome,
  TripKind,
  type PurchaseEntryView,
  type PurchaseRowView,
} from '@portfolio/luna-shopper/contracts';
import type { PurchaseEntryRow, PurchaseLineRow } from './purchases.sql';

/**
 * One raw history entry, with its dates serialized and its kind typed.
 *
 * The sum arrives as a `bigint`, which the driver hands back as a string so no
 * precision is lost on the way out of Postgres, and as null when nothing in the
 * entry carried a price. **Null stays null**: a history that answered 0 would
 * say the shopping was free (plan 0142, section 3.3).
 *
 * It is also null when the entry's priced rows carry **two currencies** (plan
 * 0143, section 7). The statement counts them and the decision is made here,
 * because it is a decision about what may be shown rather than about what the
 * database holds: two shops in two currencies in one session have no total,
 * every row still says what it cost, and `unpricedCount` is unchanged, since it
 * counts rows with no price and not rows that refuse to add up.
 */
export function toPurchaseEntryView(row: PurchaseEntryRow): PurchaseEntryView {
  const cents = row.spentCents === null ? null : Number(row.spentCents);
  const settledLineCount = Number(row.lineCount);
  const anyBoughtLineCount = Number(row.boughtLineCount);
  return {
    id: row.id,
    kind: row.kind === TripKind.BASKET ? TripKind.BASKET : TripKind.SESSION,
    name: row.name,
    open: row.open === true,
    startedAt: new Date(row.startedAt).toISOString(),
    endedAt: new Date(row.endedAt).toISOString(),
    settledLineCount,
    anyBoughtLineCount,
    // The old names, for one release (plan 0159). A trip's `lineCount` counts
    // something else, which is why these were renamed.
    lineCount: settledLineCount,
    boughtLineCount: anyBoughtLineCount,
    spent:
      cents === null || row.currency === null || Number(row.currencies) !== 1
        ? null
        : { cents, currency: row.currency },
    unpricedCount: Number(row.unpricedCount),
  };
}

/**
 * One folded row of an entry (plan 0142, section 4).
 *
 * The five location fields are already null together when the reader no longer
 * holds `READ` on the line's list: the statement decides that, because it is
 * the only place that can ask the question at request time.
 */
export function toPurchaseRowView(row: PurchaseLineRow): PurchaseRowView {
  return {
    id: row.id,
    itemId: row.itemId,
    outcome:
      row.outcome === SettlementOutcome.BOUGHT
        ? SettlementOutcome.BOUGHT
        : SettlementOutcome.NOT_AVAILABLE,
    quantity: Number(row.quantity),
    // The amount and its currency travel together or neither is served: an
    // amount with no currency is a number (plan 0143, section 2).
    pricePaid:
      row.pricePaidCents === null || row.pricePaidCurrency === null
        ? null
        : {
            cents: Number(row.pricePaidCents),
            currency: row.pricePaidCurrency,
          },
    priceScopeId: row.priceScopeId,
    supermarketLocationId: row.supermarketLocationId,
    settledAt: new Date(row.settledAt).toISOString(),
    lineId: row.lineId,
    listId: row.listId,
    listName: row.listName,
    zoneId: row.zoneId,
    content: row.content,
  };
}
