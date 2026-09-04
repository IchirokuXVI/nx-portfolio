import {
  inLocale,
  LINE_ITEM_SET_MAX,
  type AlsoOnVm,
  type CatalogItem,
  type HistorySectionVm,
  type LinePageVm,
  type LineProductChipVm,
  type LineProductClusterVm,
  type LineSettlement,
  type ProductGroup,
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
  /**
   * What the group this line follows is called, or null (velista plan 0065, 2.1).
   *
   * Null covers three things and the heading draws all of them the same way: the
   * lookup has not answered yet, it answered and the group is gone, and it failed.
   * The reader is owed the same sentence in each case, which is `From a group`:
   * `From ` with an empty name is the shape this null exists to make impossible.
   */
  readonly groupNameOf: (groupId: string) => ProductGroup | null;
  /**
   * The two words this screen has for a person it is not naming (velista plan 0066,
   * section 4): what to call the reader, and what to call somebody the zone cannot name.
   *
   * Already translated, because a selector holds no translator and this one is worth
   * keeping free of Angular. The three way branch that picks between them and a real
   * name stays here rather than in the template, which is the point: a caption assembled
   * in a template is a caption assembled again the next time somebody needs it.
   */
  readonly youLabel: string;
  readonly someoneLabel: string;
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

  const fromGroup = new Set(line.groupItemIds);
  const products: readonly LineProductChipVm[] = line.itemIds.map((itemId) => {
    const item: CatalogItem | null = input.itemNameOf(itemId);
    const source = fromGroup.has(itemId) ? 'group' : 'user';
    return {
      itemId,
      name: item === null ? null : inLocale(item.name, input.locale),
      brand: item?.brand ?? null,
      removable: input.canEdit && !input.busy,
      source,
      // Only what the catalog put there has anything to adopt, and adoption is an
      // edit like any other on this screen: offered where the reader may edit, inert
      // while a write is in flight (section 4).
      adoptable: source === 'group' && input.canEdit && !input.busy,
    };
  });

  return {
    lineId: line.id,
    content: line.content,
    quantity: line.quantity,
    listName: input.list?.name ?? null,
    zoneName: input.zoneName,
    products,
    clusters: clustersOf(products, line.productGroupId, input),
    // Always once the line has any, and never on a line with none: a counter over an
    // empty set is a number with nothing to count, and the sentence above it already
    // says the line has no products (section 3.1).
    counter:
      products.length === 0
        ? null
        : {
            count: products.length,
            cap: LINE_ITEM_SET_MAX,
            // Neither number is clamped, and this is what a screen reads rather than
            // comparing them itself. `104/100` is a legitimate state that the
            // catalog's own sync produces (backend plan 0070, section 7.2).
            overCap: products.length > LINE_ITEM_SET_MAX,
          },
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
    addedBy: addedByOf(line.createdByUserId, input),
    canEdit: input.canEdit,
    canDelete: input.canDelete,
  };
}

/**
 * What to call the person who put this line on the list (velista plan 0066, section 4).
 *
 * Three cases and one of them covers two situations. The reader gets their own word;
 * an id the zone resolves gets that name; an id it does not, and the empty string a
 * line older than the field carries, both get "somebody". Those last two are an author
 * who left the zone and a line from a server that predated `createdByUserId`, and a
 * reader is owed the same sentence for each.
 *
 * Not the same question as `list.page.addedByYou`, which heads the cluster of products
 * a person put on the line rather than the catalog (velista plan 0065). Two things named
 * "added by you" on one screen meaning different things is worth avoiding by naming, so
 * this caption's key is `list.page.addedBy` and it never appears without its argument.
 */
function addedByOf(
  createdByUserId: string,
  input: Pick<
    LinePageInput,
    'callerUserId' | 'nameOf' | 'youLabel' | 'someoneLabel'
  >
): string {
  if (createdByUserId === '') {
    return input.someoneLabel;
  }
  if (createdByUserId === input.callerUserId) {
    return input.youLabel;
  }
  return input.nameOf(createdByUserId) ?? input.someoneLabel;
}

/**
 * The products split by who put them there, or null (velista plan 0065, section 2).
 *
 * **Null on a line that follows no group**, which is every line backend `0048` ever
 * created and every line the composer adds without choosing one. There is nothing to
 * tell apart on those, so the page draws the flat run of chips that ships today and
 * nothing regresses for any of them.
 *
 * Where there is a binding, an **empty cluster is omitted rather than drawn empty**,
 * so a line whose products are all the catalog's has one heading and a line whose
 * products have all been adopted has the other. One heading over the only run of
 * chips there is reads as a statement about the line, which is the case section 2 is
 * about: immediately after somebody picks Milk every product is the catalog's, and a
 * mark on every chip would distinguish nothing.
 *
 * The catalog's cluster comes first, because it is the one whose contents somebody
 * else is changing.
 */
function clustersOf(
  products: readonly LineProductChipVm[],
  productGroupId: string | null,
  input: Pick<LinePageInput, 'groupNameOf' | 'locale'>
): readonly LineProductClusterVm[] | null {
  if (productGroupId === null || products.length === 0) {
    return null;
  }

  const group = input.groupNameOf(productGroupId);
  const name = group === null ? '' : inLocale(group.name, input.locale);

  const clusters: LineProductClusterVm[] = [
    {
      source: 'group',
      // Two keys, and never one key with an empty argument. A group whose name did
      // not resolve is owed `From a group`; `From ` is the sentence the unnamed
      // product chip already refuses to draw, and the reader gets the same words
      // whether the lookup failed or the group is gone.
      headingKey:
        name === '' ? 'list.page.fromGroupUnnamed' : 'list.page.fromGroup',
      headingArgs: name === '' ? {} : { name },
      products: products.filter((product) => product.source === 'group'),
    },
    {
      source: 'user',
      headingKey: 'list.page.addedByYou',
      headingArgs: {},
      products: products.filter((product) => product.source === 'user'),
    },
  ];

  return clusters.filter((cluster) => cluster.products.length > 0);
}
