import { foldForSearch } from './basket-search';
import type { CatalogItem } from './domain';
import { inCategoryOrder } from './product-category';

/**
 * What the zone list page draws of a list, as opposed to what the list holds (velista
 * `0082`).
 *
 * The basket has had a search, an order and a grouping since `0074` to `0077`. A zone
 * list had none, and a household list of sixty lines is where that hurts most. This
 * is the list page's half: a search, an A to Z order, and a view that shows **one
 * category at a time**. Pure, so every rule below is tested without a fixture.
 *
 * It is a separate pipeline from `composeBasketView` and not a generalisation of it.
 * The basket's is typed on basket lines, groups into several sections and marks rows
 * with prices; this filters to one heading at most and moves nothing but the order.
 */

/** "List order" is the server's `position`, and "A to Z" is the line's own name. */
export type ListViewOrder = 'list' | 'alpha';

/**
 * "All lines", or "One category".
 *
 * A mode of its own rather than a nullable category, because the sheet has a state
 * the page never draws: "One category" chosen and no category picked yet, which
 * applies nothing (section 4).
 */
export type ListViewMode = 'all' | 'category';

/**
 * The pick for a line whose products say nothing about an aisle.
 *
 * A line with no products has no category, and neither has a line whose products
 * did not load or failed to (section 3). "No category" is a real choice in the sheet,
 * so it needs a value, and it is not a category id because the catalog never sends
 * it: ids are uuids and this is not one.
 */
export const NO_CATEGORY = 'NONE';

/**
 * A category's id, or {@link NO_CATEGORY}.
 *
 * The id rather than the category, because a pick is compared, counted and held
 * across reads, and two reads of one row are two objects (velista `0118`).
 */
export type ListCategoryPick = string;

/** Everything the list filter sheet decides. */
export interface ListViewState {
  readonly order: ListViewOrder;
  readonly view: ListViewMode;
  /** The picked category, or null. Applies only while {@link view} is `'category'`. */
  readonly category: ListCategoryPick | null;
}

export const DEFAULT_LIST_VIEW_STATE: ListViewState = {
  order: 'list',
  view: 'all',
  category: null,
};

/** The two things this pipeline reads off a line. The rest travels untouched. */
export interface ListViewLine {
  readonly id: string;
  readonly content: string;
}

/** What a line's name is not enough to answer. */
export interface ListViewContext {
  /** What is in the search field, as typed. */
  readonly query: string;
  /** The reader's locale, for the collation of A to Z. */
  readonly locale: string;
  /** A line's categories, never empty: a line with none answers {@link NO_CATEGORY}. */
  readonly categoriesOf: (lineId: string) => readonly ListCategoryPick[];
  /** A line's product names, already in the reader's language. */
  readonly productNamesOf: (lineId: string) => readonly string[];
  /**
   * A category's name in the reader's language, for the search, or blank for an id
   * nothing named. Never asked about {@link NO_CATEGORY}.
   */
  readonly categoryName: (categoryId: string) => string;
}

/** What the page draws: the lines, and the heading above them or null. */
export interface ListView<T extends ListViewLine> {
  readonly lines: readonly T[];
  /** The category the lines are drawn under, or null for no heading. */
  readonly category: ListCategoryPick | null;
}

/** One radio in the sheet's category list. */
export interface ListCategoryCount {
  readonly category: ListCategoryPick;
  /** How many of the list's lines hold it. */
  readonly lines: number;
}

/**
 * One radio as the sheet draws it: the count, and the words.
 *
 * `name` is null for {@link NO_CATEGORY}, whose words are this app's and a key, and
 * the category's own name in the reader's language for every other row.
 */
export interface ListCategoryChoice extends ListCategoryCount {
  readonly name: string | null;
}

/** Where a category sits in the tree, or null for one the tree does not hold (yet). */
export type CategoryRank = (categoryId: string) => number | null;

/** The rank of a tree that has not arrived: nothing is ranked. */
export const NO_CATEGORY_RANK: CategoryRank = () => null;

/**
 * A line's categories, from the products it carries (section 3, velista `0118`).
 *
 * The set of **every** category of every product it carries, so a line whose product
 * is frozen and a ready meal is under both radios. In tree order by `rank`, and in
 * first appearance order for whatever the tree does not rank, which is everything
 * before the tree has arrived. A product the lookup has not answered for, or failed
 * on, contributes nothing, and neither does a product with no readable category, so a
 * line with none answers {@link NO_CATEGORY}.
 */
export function lineCategories(
  itemIds: readonly string[],
  itemOf: (itemId: string) => CatalogItem | null,
  rank: CategoryRank = NO_CATEGORY_RANK
): readonly ListCategoryPick[] {
  const found = new Set<string>();
  for (const itemId of itemIds) {
    const item = itemOf(itemId);
    for (const category of item?.categories ?? []) {
      found.add(category.id);
    }
  }

  if (found.size === 0) {
    return [NO_CATEGORY];
  }

  return inCategoryOrder([...found], (id) => id, rank);
}

/**
 * The categories present on a list, each with its line count (section 4).
 *
 * In tree order by `rank`, then first appearance for anything unranked, with "No
 * category" last and only when a line has none. A line with three categories counts
 * once under each of them, which is what picking any one of the three draws.
 */
export function listCategoryCounts(
  lines: readonly ListViewLine[],
  categoriesOf: (lineId: string) => readonly ListCategoryPick[],
  rank: CategoryRank = NO_CATEGORY_RANK
): readonly ListCategoryCount[] {
  const counts = new Map<ListCategoryPick, number>();
  for (const line of lines) {
    for (const category of new Set(categoriesOf(line.id))) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }

  const named = inCategoryOrder(
    [...counts.keys()].filter((category) => category !== NO_CATEGORY),
    (id) => id,
    rank
  );
  const order = counts.has(NO_CATEGORY) ? [...named, NO_CATEGORY] : named;
  return order.map((category) => ({
    category,
    lines: counts.get(category) ?? 0,
  }));
}

/**
 * The category the page is filtered to, or null.
 *
 * Null while the view is "All lines", and null too while "One category" is chosen and
 * nothing is picked: nothing changes on the page until a category is (section 4).
 */
export function pickedListCategory(
  state: ListViewState
): ListCategoryPick | null {
  return state.view === 'category' ? state.category : null;
}

/**
 * How many settings are on, for the filter button's badge (section 2).
 *
 * A to Z counts one and a picked category counts one. "One category" with nothing
 * picked counts nothing, because it changes nothing.
 */
export function listViewActiveCount(state: ListViewState): number {
  return (
    Number(state.order !== 'list') + Number(pickedListCategory(state) !== null)
  );
}

/**
 * Whether the reorder action has to wait (section 7).
 *
 * `line.reorder` takes the whole order, and a drag over a filtered or re-sorted screen
 * would rewrite positions nobody can see. So reordering waits for the list order, all
 * lines and no search.
 */
export function listViewHoldsReorder(
  state: ListViewState,
  query: string
): boolean {
  return listViewActiveCount(state) > 0 || foldForSearch(query) !== '';
}

/**
 * Whether one line answers the search (section 6).
 *
 * Its name, the name of any of its products, or the name of any of its categories
 * in the reader's language (velista `0118`: the name is data now, where it was a
 * label). "No category" is not a name a line carries, so typing it finds nothing. An
 * empty query matches everything.
 */
export function matchesListLine(
  line: ListViewLine,
  context: ListViewContext
): boolean {
  const folded = foldForSearch(context.query);
  if (folded === '') {
    return true;
  }

  const includes = (text: string) => foldForSearch(text).includes(folded);

  return (
    includes(line.content) ||
    context.productNamesOf(line.id).some(includes) ||
    context
      .categoriesOf(line.id)
      .some(
        (category) =>
          category !== NO_CATEGORY && includes(context.categoryName(category))
      )
  );
}

/**
 * The lines the page draws: the category, then the order, then the search.
 *
 * `lines` arrive in list order, which is the page's own sort, so "List order" keeps
 * them as they are. **No line is drawn twice**: only one category is drawn at a time,
 * so a line holding three of them is drawn once under whichever is picked, and the
 * ids are checked all the same so a duplicated input cannot break that.
 */
export function composeListView<T extends ListViewLine>(
  lines: readonly T[],
  state: ListViewState,
  context: ListViewContext
): ListView<T> {
  const category = pickedListCategory(state);

  const seen = new Set<string>();
  const kept = lines.filter((line) => {
    if (seen.has(line.id)) {
      return false;
    }
    seen.add(line.id);
    return (
      (category === null || context.categoriesOf(line.id).includes(category)) &&
      matchesListLine(line, context)
    );
  });

  return {
    lines: state.order === 'alpha' ? alphabetical(kept, context.locale) : kept,
    category,
  };
}

/**
 * A to Z in the reader's locale.
 *
 * Base sensitivity, so "Ávila" sorts with "Avila", as the basket's A to Z does. An
 * unrecognised locale tag throws `RangeError`, and the collator then falls back to
 * the runtime's own. `sort` is stable, so names that collate equal keep list order.
 */
function alphabetical<T extends ListViewLine>(
  lines: readonly T[],
  locale: string
): readonly T[] {
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(locale, { sensitivity: 'base' });
  } catch {
    collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  }

  return [...lines].sort((left, right) =>
    collator.compare(left.content, right.content)
  );
}
