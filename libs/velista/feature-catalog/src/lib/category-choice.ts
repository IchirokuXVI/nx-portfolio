import type {
  CategoryBranch,
  CategoryNode,
  CategoryTree,
} from '@portfolio/velista/models';

/**
 * The query parameter that holds the chosen category (velista `0119`, target 5).
 *
 * The URL is the one place the choice lives, so a shared link opens the tab narrowed
 * and the back button walks the choices. It names a **slug**, never an id: a slug is
 * stable forever and readable, and a link somebody sends is read by a person first.
 */
export const CATEGORY_PARAM = 'category';

/**
 * The branches a picker draws: every child with a product under it, and every root
 * with at least one such child (target 1).
 *
 * A row with a count of zero is a page that would open onto nothing, so it is not
 * drawn, and a root whose children are all hidden would open onto a page of one row,
 * "Everything in", that lists nothing either.
 */
export function visibleBranches(
  roots: readonly CategoryBranch[]
): readonly CategoryBranch[] {
  const shown: CategoryBranch[] = [];
  for (const branch of roots) {
    const children = branch.children.filter((child) => child.itemCount > 0);
    if (children.length > 0) {
      shown.push({ root: branch.root, children });
    }
  }
  return shown;
}

/** A chosen category and the root it sits under, which is itself for a root. */
export interface CategoryChoice {
  readonly node: CategoryNode;
  readonly root: CategoryNode;
}

/**
 * The category a slug names, with its root, or null for a slug the tree does not
 * hold. Null too for a leaf whose root is missing, which the tree builder never
 * produces but a picker could not draw a way back to.
 */
export function categoryChoice(
  tree: CategoryTree,
  slug: string | null
): CategoryChoice | null {
  if (slug === null) {
    return null;
  }
  const node = tree.bySlug.get(slug);
  if (node === undefined) {
    return null;
  }
  if (node.parentId === null) {
    return { node, root: node };
  }
  const root = tree.byId.get(node.parentId);
  return root === undefined ? null : { node, root };
}

/**
 * A count as words in the reader's locale: `1,143` in English, `1143` in Spanish
 * (rule P2). The number beside the word is formatted here, and the word is chosen by
 * the translation's plural rule from the raw count.
 */
export function formatCount(count: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(count);
  } catch {
    return String(count);
  }
}
