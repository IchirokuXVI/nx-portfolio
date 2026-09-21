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
 * `spentCents` arrives as a `bigint`, which the driver hands back as a string
 * so no precision is lost on the way out of Postgres, and as null when nothing
 * in the entry carried a price. **Null stays null**: a history that answered 0
 * would say the shopping was free (plan 0142, section 3.3).
 */
export function toPurchaseEntryView(row: PurchaseEntryRow): PurchaseEntryView {
  return {
    id: row.id,
    kind: row.kind === TripKind.BASKET ? TripKind.BASKET : TripKind.SESSION,
    name: row.name,
    open: row.open === true,
    startedAt: new Date(row.startedAt).toISOString(),
    endedAt: new Date(row.endedAt).toISOString(),
    lineCount: Number(row.lineCount),
    boughtLineCount: Number(row.boughtLineCount),
    spentCents: row.spentCents === null ? null : Number(row.spentCents),
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
    pricePaidCents:
      row.pricePaidCents === null ? null : Number(row.pricePaidCents),
    settledAt: new Date(row.settledAt).toISOString(),
    lineId: row.lineId,
    listId: row.listId,
    listName: row.listName,
    zoneId: row.zoneId,
    content: row.content,
  };
}
