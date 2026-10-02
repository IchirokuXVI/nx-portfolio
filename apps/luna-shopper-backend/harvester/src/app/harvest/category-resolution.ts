import type { CategoryTreeView } from '@portfolio/luna-shopper/contracts';
import { DIA_CATEGORY_SLUGS } from '@portfolio/luna-shopper/dia';
import { resolveCategory } from '@portfolio/luna-shopper/mercadona';

/**
 * The leaf a product lands on when its source path resolves to nothing (plan
 * 0166, section 7). A row of the tree like any other, so an operator can move
 * the product out of it later. Since plan 0173 the chain libraries answer it
 * too, for a section no leaf fits, and null for a path they cannot read.
 */
export const UNCATEGORISED_SLUG = 'uncategorised';

/** How many categories catalog lets one product sit in. */
const ITEM_CATEGORY_MAX = 10;

/** The key of a DIA row's `extra` that holds its DIA leaf ids (plan 0174). */
const DIA_CATEGORY_IDS_KEY = 'diaCategoryIds';

/** What the source row says beyond its path, for a chain that maps by id. */
export interface CategorySource {
  /** The adapter of the chain the row belongs to, or null when it has none. */
  adapterKey?: string | null;
  /** The row's own `extra`, as the last full read wrote it. */
  extra?: Record<string, unknown> | null;
}

/**
 * The slugs a product created from a source row is filed under.
 *
 * The override wins when present, as `req.category` did before plan 0166; an
 * empty override is passed through so catalog refuses it with
 * `item_needs_a_category` rather than the harvester quietly filling it in.
 *
 * Otherwise the chain decides how the row is read:
 *
 * - **`dia-api`** (plan 0174, section 7). Our tree is a copy of DIA's (plan
 *   0173), so a DIA row is filed by the DIA leaf ids it was listed under, each
 *   through `DIA_CATEGORY_SLUGS`. A product sits in up to four leaves, so it
 *   lands on up to that many of ours, distinct and in walk order. No id that
 *   maps is `uncategorised`.
 * - **Every other adapter.** The row's own path goes through the Mercadona
 *   table, which is what every chain has used since plan 0038 (DEZA and
 *   Carrefour included), and a path the table cannot place becomes
 *   `uncategorised`.
 */
export function categorySlugsFor(
  override: readonly string[] | undefined,
  categoryPath: readonly string[] | null | undefined,
  source: CategorySource = {}
): string[] {
  if (override !== undefined) {
    return [...override];
  }
  if (source.adapterKey === 'dia-api') {
    return diaSlugs(source.extra);
  }
  const slug = resolveCategory((categoryPath ?? []).map((name) => ({ name })));
  return [slug ?? UNCATEGORISED_SLUG];
}

function diaSlugs(extra: Record<string, unknown> | null | undefined): string[] {
  const ids = extra?.[DIA_CATEGORY_IDS_KEY];
  const slugs: string[] = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const slug = typeof id === 'string' ? DIA_CATEGORY_SLUGS[id] : undefined;
    if (slug !== undefined && !slugs.includes(slug)) {
      slugs.push(slug);
    }
  }
  return slugs.length > 0
    ? slugs.slice(0, ITEM_CATEGORY_MAX)
    : [UNCATEGORISED_SLUG];
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
