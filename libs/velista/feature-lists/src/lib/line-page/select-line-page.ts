import {
  inLocale,
  type AlsoOnVm,
  type CatalogItem,
  type HistorySectionVm,
  type LinePageVm,
  type LineSettlement,
  type ShoppingListSummary,
} from '@portfolio/velista/models';
import {
  estimateFrom,
  toSettlementRow,
  type LineDetailInput,
} from '../line-detail-sheet/select-line-detail';

/**
 * What the line page draws (velista plan 0043, section 5.3).
 *
 * The two rules worth naming, because both are absences and an absence is the thing a
 * refactor removes without noticing:
 *
 * - **The cross list history is null, not empty, on a line with no products.** It is
 *   keyed on the line's product set, so a free text line cannot have one; drawing it
 *   empty would say the reader has never bought this anywhere, when in fact nobody has
 *   said what "this" is. That is the argument for the composer's suggestions.
 * - **`alsoOn` is null until something can answer it, and is then drawn only when it
 *   is complete.** It was derived from whatever lists the session happened to hold,
 *   which under reported by construction and drew nothing when empty, so "nobody
 *   asked" and "no other list has this" were one picture (velista plan 0047, section
 *   5). Backend plan 0053 section 3 adds the query. Empty still draws nothing once
 *   there is one, because "no other list has this" is not information anybody came
 *   here for, but that is a different absence and the two must not be collapsed again.
 */
export interface LinePageInput
  extends Pick<
    LineDetailInput,
    | 'line'
    | 'settlements'
    | 'itemNameOf'
    | 'namesUnavailable'
    | 'nameOf'
    | 'callerUserId'
    | 'locale'
  > {
  readonly list: ShoppingListSummary | undefined;
  readonly zoneName: string | null;
  /**
   * The cross list history, already unioned over the line's products, or undefined
   * when it has not been read.
   */
  readonly itemSettlements: readonly LineSettlement[] | undefined;
  /**
   * Which list each settlement was on, for the cross list section's rows.
   *
   * A lookup rather than a name on the settlement, because a settlement carries a
   * `listId` and the names live in `ListStore`. Null for a list this reader cannot see
   * the name of, which the row draws as nothing rather than as an id.
   */
  readonly listNameOf: (listId: string) => string | null;
  /**
   * The reader's other lists still wanting this line's products, or null when nobody
   * has asked (velista plan 0047, section 5).
   *
   * Answered by backend plan 0053 section 3, one request per product, merged by the
   * container. Null is a line with no product, or an answer that has not arrived or did
   * not come back; an empty `places` is the real answer that nothing else wants it. The
   * derivation this page used to make from whatever the session had loaded could not
   * tell those apart, which is what the query exists to fix.
   */
  readonly alsoOn: AlsoOnVm | null;
  /** Whether the line's own history has a further page to fetch. */
  readonly hasMoreSettlements: boolean;
  /** Whether the cross list history has a further page to fetch. */
  readonly hasMoreItemSettlements: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  /** Whether a product is being added or removed right now. */
  readonly busy: boolean;
}

export function selectLinePage(input: LinePageInput): LinePageVm | null {
  const { line } = input;
  if (line === undefined) {
    return null;
  }

  const thisList: HistorySectionVm = {
    scope: 'thisList',
    // Every row on this section is this list by construction, so naming it in each
    // one would be noise. The cross list section is the opposite: the whole point of
    // it is that the rows come from different places.
    rows: (input.settlements ?? []).map((settlement) =>
      toSettlementRow(settlement, input, null)
    ),
    loading: input.settlements === undefined,
    // From the page the store actually holds, rather than the literal `false` that
    // made the whole control unreachable (velista plan 0047, section 4). `Show more`
    // exists in both locales and was read by nothing.
    hasMore: input.hasMoreSettlements,
  };

  const everywhere: HistorySectionVm | null =
    line.itemIds.length === 0
      ? null
      : {
          scope: 'everywhere',
          rows: (input.itemSettlements ?? []).map((settlement) =>
            toSettlementRow(
              settlement,
              input,
              input.listNameOf(settlement.listId)
            )
          ),
          loading: input.itemSettlements === undefined,
          hasMore: input.hasMoreItemSettlements,
        };

  const purchases = (input.settlements ?? []).filter(
    (settlement) => settlement.outcome === 'BOUGHT'
  );

  return {
    lineId: line.id,
    content: line.content,
    quantity: line.quantity,
    listName: input.list?.name ?? null,
    zoneName: input.zoneName,
    products: line.itemIds.map((itemId) => {
      const item: CatalogItem | null = input.itemNameOf(itemId);
      return {
        itemId,
        name: item === null ? null : inLocale(item.name, input.locale),
        brand: item?.brand ?? null,
        removable: input.canEdit && !input.busy,
      };
    }),
    namesUnavailable: input.namesUnavailable && line.itemIds.length > 0,
    // The sheet's own function, imported rather than reimplemented. Both screens
    // compute this from the same history and must give the same answer: a sheet
    // saying "every 11 days" over a page saying "every 12" would cost the number the
    // only thing it has, which is that somebody trusts it.
    estimate: estimateFrom(purchases),
    lastPurchase: thisList.rows.find((row) => row.outcome === 'BOUGHT') ?? null,
    thisList,
    everywhere,
    alsoOn: input.alsoOn,
    canEdit: input.canEdit,
    canDelete: input.canDelete,
  };
}
