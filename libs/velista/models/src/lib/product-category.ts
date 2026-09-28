import { catalogName } from './catalog-browse';
import type { LocalizedName } from './shopping-profile';

/**
 * What aisle a product is in (velista `0118`, backend `0166`).
 *
 * A row of the catalog's tree, and no longer one of twelve constants: it has an id,
 * a parent, a slug and a name somebody wrote, in data. A product carries **one or
 * more**, in the order the catalog placed them, and only ever on a leaf, which is why
 * {@link parentId} is never null here. The tree itself, roots included, is
 * {@link CategoryNode}.
 *
 * There is no fallback value. A category this build cannot read is dropped by the
 * mapper, and a product left with none is a product with no category, which both
 * pipelines already have a place for (the basket's last section, the zone list's
 * "No category"). "Not yet categorised" is a real leaf and arrives as data.
 */
export interface ProductCategory {
  readonly id: string;
  /** The root this leaf sits under. */
  readonly parentId: string;
  /** Stable forever, and readable: what a URL or a decisions file names. */
  readonly slug: string;
  readonly name: LocalizedName;
}

/**
 * One row of the whole tree, as `GET /v1/catalog/categories` answers it.
 *
 * Two levels and no more (backend `0166`, section 1): a root has a null
 * {@link parentId}, and every other row's parent is a root.
 */
export interface CategoryNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly slug: string;
  readonly name: LocalizedName;
  /** The order among its siblings. */
  readonly position: number;
  /** Distinct products under the row. A root counts the products under its children. */
  readonly itemCount: number;
}

/** A root and its children, both in `position` order. */
export interface CategoryBranch {
  readonly root: CategoryNode;
  readonly children: readonly CategoryNode[];
}

/**
 * The tree read once, arranged for the screens that walk it and the ones that sort
 * by it.
 *
 * {@link ranks} is one integer per row in walk order: a root, then its children, then
 * the next root. Sorting by it lays categories out as the tree does, which is the
 * order a filter sheet's radios and a line's categories are listed in.
 */
export interface CategoryTree {
  readonly roots: readonly CategoryBranch[];
  readonly byId: ReadonlyMap<string, CategoryNode>;
  readonly bySlug: ReadonlyMap<string, CategoryNode>;
  readonly ranks: ReadonlyMap<string, number>;
}

/** The tree before anything is read: every lookup misses and nothing is ranked. */
export const EMPTY_CATEGORY_TREE: CategoryTree = {
  roots: [],
  byId: new Map(),
  bySlug: new Map(),
  ranks: new Map(),
};

/**
 * Arrange the rows the tree route answered.
 *
 * Roots are the rows with no parent, and children the rows whose parent is a root,
 * each in `position` order with the slug breaking a tie so the walk is the same on
 * every read. A row whose parent is missing or is not a root breaks the two level
 * rule and is left out rather than guessed at: a picker cannot draw a child it has no
 * page for.
 */
export function buildCategoryTree(rows: readonly CategoryNode[]): CategoryTree {
  const bySiblingOrder = (left: CategoryNode, right: CategoryNode) =>
    left.position - right.position || compareText(left.slug, right.slug);

  const roots = rows
    .filter((row) => row.parentId === null)
    .sort(bySiblingOrder);
  const rootIds = new Set(roots.map((root) => root.id));

  const childrenOf = new Map<string, CategoryNode[]>();
  for (const row of rows) {
    if (row.parentId !== null && rootIds.has(row.parentId)) {
      const held = childrenOf.get(row.parentId);
      if (held === undefined) {
        childrenOf.set(row.parentId, [row]);
      } else {
        held.push(row);
      }
    }
  }

  const branches: CategoryBranch[] = [];
  const byId = new Map<string, CategoryNode>();
  const bySlug = new Map<string, CategoryNode>();
  const ranks = new Map<string, number>();

  const place = (row: CategoryNode) => {
    if (byId.has(row.id)) {
      return false;
    }
    byId.set(row.id, row);
    bySlug.set(row.slug, row);
    ranks.set(row.id, ranks.size);
    return true;
  };

  for (const root of roots) {
    if (!place(root)) {
      continue;
    }
    const children = (childrenOf.get(root.id) ?? [])
      .sort(bySiblingOrder)
      .filter(place);
    branches.push({ root, children });
  }

  return { roots: branches, byId, bySlug, ranks };
}

/**
 * A category's name in the reader's language, never blank while it has one at all.
 *
 * {@link catalogName}'s rule, because a category name is catalog data and at least
 * one language is guaranteed rather than both: an English reader of a row named in
 * Spanish alone reads the Spanish rather than an empty heading.
 */
export function categoryName(
  category: { readonly name: LocalizedName },
  locale: string
): string {
  return catalogName(category.name, locale);
}

/**
 * Put categories in tree order, keeping first appearance for whatever is not ranked.
 *
 * `rank` answers null for an id the tree does not hold, which is every id before the
 * tree has arrived. Those sort after every ranked id and keep the order they came in,
 * because `sort` is stable, so a list drawn before the read is in first appearance
 * order and re-sorts, with nothing else moving, when it lands.
 */
export function inCategoryOrder<T>(
  values: readonly T[],
  idOf: (value: T) => string,
  rank: (categoryId: string) => number | null
): T[] {
  const keyOf = (value: T) => rank(idOf(value)) ?? Number.POSITIVE_INFINITY;
  return [...values].sort((left, right) => {
    const a = keyOf(left);
    const b = keyOf(right);
    return a === b ? 0 : a < b ? -1 : 1;
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
