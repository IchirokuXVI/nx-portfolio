import {
  catalogName,
  dayOfMonth,
  formatMinorMoney,
  groupHistoryByMonth,
  lineName,
  monthName,
  toSettlementRow,
  type CatalogItem,
  type HistoryScope,
  type Line,
  type LineHistoryFactsVm,
  type LineHistoryMonthVm,
  type LineHistoryRowVm,
  type LineProductPriceRead,
  type LineSettlement,
} from '@portfolio/velista/models';
import { estimateFrom } from '../line-detail-sheet/select-line-detail';

/**
 * What the history page of a line draws (velista `0135`, section 5).
 *
 * Two scopes that answer two questions. **This list** is every purchase of this
 * line: one household's. **Everywhere you shop** is every purchase of this line's
 * products across the lists the reader can read: theirs. The second is absent,
 * not empty, on a line with no products, because it is keyed on the products and
 * a line of free text has not said what "this" is.
 */
export interface LineHistoryInput {
  readonly line: Line | undefined;
  readonly listName: string | null;
  readonly scope: HistoryScope;
  /** The rows of {@link scope}, newest first, or undefined while not read. */
  readonly settlements: readonly LineSettlement[] | undefined;
  /** Whether {@link scope} has an older page to read. */
  readonly hasMore: boolean;
  readonly itemNameOf: (itemId: string) => CatalogItem | null;
  /** The prices of a product, for the product the line shows (velista `0145`). */
  readonly pricesOf?: (itemId: string) => LineProductPriceRead;
  readonly nameOf: (userId: string) => string | null;
  /** The name of another list, for a row of "everywhere". Null when not held. */
  readonly listNameOf: (listId: string) => string | null;
  readonly callerUserId: string | null;
  readonly locale: string;
  readonly now: Date;
}

export interface LineHistoryVm {
  readonly content: string;
  readonly listName: string | null;
  /** The scopes on offer. One, on a line with no products, and then no control. */
  readonly scopes: readonly HistoryScope[];
  readonly scope: HistoryScope;
  readonly loading: boolean;
  /** Null while loading and with no purchase to count. */
  readonly facts: LineHistoryFactsVm | null;
  readonly months: readonly LineHistoryMonthVm[];
  readonly hasMore: boolean;
}

export function selectLineHistory(
  input: LineHistoryInput
): LineHistoryVm | null {
  const { line } = input;
  if (line === undefined) {
    return null;
  }

  const scopes: readonly HistoryScope[] =
    line.itemIds.length === 0 ? ['thisList'] : ['thisList', 'everywhere'];
  // A line that lost its products while the page was open falls back to the one
  // scope it still has.
  const scope = scopes.includes(input.scope) ? input.scope : 'thisList';
  const settlements = input.settlements;

  const rows: LineHistoryRowVm[] = (settlements ?? []).map((settlement) => ({
    ...toSettlementRow(
      settlement,
      input,
      scope === 'everywhere' ? input.listNameOf(settlement.listId) : null
    ),
    day: dayOfMonth(settlement.settledAt, input.locale),
    product: productOf(settlement, input),
  }));

  return {
    // The name the line is drawn with (velista `0144`).
    content: lineName(
      line,
      (itemId) => input.itemNameOf(itemId)?.name ?? null,
      input.locale,
      input.pricesOf
    ).text,
    listName: input.listName,
    scopes,
    scope,
    loading: settlements === undefined,
    facts: settlements === undefined ? null : factsOf(line, scope, input),
    months: groupHistoryByMonth(rows, input.locale, input.now),
    hasMore: input.hasMore,
  };
}

/** "Shampoo for normal hair · Deliplus", or null for a row with no product. */
function productOf(
  settlement: LineSettlement,
  input: Pick<LineHistoryInput, 'itemNameOf' | 'locale'>
): string | null {
  if (settlement.outcome !== 'BOUGHT' || settlement.itemId === null) {
    return null;
  }
  const item = input.itemNameOf(settlement.itemId);
  if (item === null) {
    return null;
  }
  const parts = [catalogName(item.name, input.locale), item.brand].filter(
    (part): part is string => part !== null && part.trim() !== ''
  );
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * The three figures (section 5). The whole block is null with nothing bought,
 * because three dashes say less than the sentence the page draws instead.
 */
function factsOf(
  line: Line,
  scope: HistoryScope,
  input: LineHistoryInput
): LineHistoryFactsVm | null {
  // A purchase somebody took back is not a purchase to count or to price.
  const purchases = (input.settlements ?? []).filter(
    (settlement) =>
      settlement.outcome === 'BOUGHT' && settlement.revertedAt === null
  );
  if (purchases.length === 0) {
    return null;
  }

  const estimate = estimateFrom(purchases);
  const oldest = purchases[purchases.length - 1];
  const priced = purchases.find(
    (purchase) => purchase.unitPriceCents !== null && purchase.currency !== null
  );

  return {
    times:
      scope === 'thisList'
        ? // The line's own count, which is exact whatever was paged in. Never
          // under what is on screen, for a count that lags a settle by a frame.
          { count: Math.max(line.boughtCount, purchases.length), more: false }
        : { count: purchases.length, more: input.hasMore },
    // Only a history read to its end knows where it starts.
    since: input.hasMore
      ? null
      : monthName(oldest.settledAt, input.locale, input.now),
    everyDays:
      estimate === null
        ? null
        : { days: estimate.medianDays, rough: estimate.rough },
    lastPaid:
      priced === undefined ||
      priced.unitPriceCents === null ||
      priced.currency === null
        ? null
        : formatMinorMoney(
            priced.unitPriceCents,
            priced.currency,
            input.locale
          ),
  };
}
