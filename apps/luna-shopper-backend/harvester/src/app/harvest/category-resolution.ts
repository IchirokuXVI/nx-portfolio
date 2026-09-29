import type { CategoryTreeView } from '@portfolio/luna-shopper/contracts';
import { resolveCategory } from '@portfolio/luna-shopper/mercadona';

/**
 * The leaf a product lands on when its source path resolves to nothing (plan
 * 0166, section 7). A row of the tree like any other, so an operator can move
 * the product out of it later; the chain libraries answer null and never name
 * it themselves.
 */
export const UNCATEGORISED_SLUG = 'uncategorised';

/**
 * The slugs a product created from a source row is filed under.
 *
 * The override wins when present, as `req.category` did before plan 0166; an
 * empty override is passed through so catalog refuses it with
 * `item_needs_a_category` rather than the harvester quietly filling it in.
 * Otherwise the row's own path goes through the Mercadona table, which is what
 * every chain has used since plan 0038 (DEZA and Carrefour included), and a
 * path the table cannot place becomes `uncategorised`.
 */
export function categorySlugsFor(
  override: readonly string[] | undefined,
  categoryPath: readonly string[] | null | undefined
): string[] {
  if (override !== undefined) {
    return [...override];
  }
  const slug = resolveCategory((categoryPath ?? []).map((name) => ({ name })));
  return [slug ?? UNCATEGORISED_SLUG];
}

/**
 * The tree read once, as a slug to id map (plan 0166, section 7).
 *
 * Catalog's create surfaces take ids and the harvester's take slugs, so the
 * harvester reads `category.tree` once per request (one product or a whole
 * decisions file) and answers every slug from memory.
 */
export class CategorySlugIndex {
  private readonly ids: ReadonlyMap<string, string>;

  constructor(tree: CategoryTreeView) {
    this.ids = new Map(
      tree.categories.map((category) => [category.slug, category.id])
    );
  }

  /**
   * The ids of `slugs`, in the order given, or the slugs the tree does not
   * hold. A root's slug resolves to its id: whether a product may sit on it is
   * catalog's decision (`category_not_a_leaf`), not the harvester's.
   */
  resolve(
    slugs: readonly string[]
  ): { ids: string[]; unknown: [] } | { ids: null; unknown: string[] } {
    const ids: string[] = [];
    const unknown: string[] = [];
    for (const slug of slugs) {
      const id = this.ids.get(slug);
      if (id === undefined) {
        unknown.push(slug);
      } else {
        ids.push(id);
      }
    }
    return unknown.length > 0 ? { ids: null, unknown } : { ids, unknown: [] };
  }
}
