import {
  inLocale,
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
 * - **`alsoOn` empty draws nothing.** "No other list has this" is not information
 *   anybody came here for.
 */
export interface LinePageInput
  extends Pick<
    LineDetailInput,
    'line' | 'settlements' | 'itemNameOf' | 'nameOf' | 'callerUserId' | 'locale'
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
  /** The reader's other lists carrying this line's products, already resolved. */
  readonly alsoOn: readonly string[];
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
    hasMore: false,
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
          hasMore: false,
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
