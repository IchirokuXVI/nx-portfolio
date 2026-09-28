import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * A slice of the category tree, as it looks with no backend listening (admin
 * plan 0036, backend plan 0166 appendix A).
 *
 * Five roots and ten of their children, enough to drive every rule the screens
 * explain: a product goes on a child and never on a root, a child holds no
 * children, and every root has an `other` child for a product that fits the
 * root and no leaf. `uncategorised` is the one a harvested product lands on
 * when nothing says better, which is why the harvest twin reads this too.
 *
 * Here rather than beside the catalog seed, because two in memory twins need
 * it: the catalog's own table, and the harvest queue's create, which resolves a
 * slug to a category the way catalog does. The ids are readable rather than
 * uuids, as every seed in this app is.
 *
 * `itemCount` states what the seeded products hold. The memory table does not
 * recount it when a product moves: it is a figure the server works out, and a
 * twin that recounted would be a second implementation of it.
 */
export const CATEGORY_SEED: readonly Wire.CatalogCategoryView[] = [
  root('dairy-and-eggs', 'Dairy and eggs', 'Lácteos y huevos', 4, 2),
  child('milk', 'dairy-and-eggs', 'Milk', 'Leche', 0, 2),
  child(
    'yogurts-and-desserts',
    'dairy-and-eggs',
    'Yogurts and desserts',
    'Yogures y postres',
    2,
    0
  ),
  child('other-dairy', 'dairy-and-eggs', 'Other dairy', 'Otros lácteos', 5, 0),
  root('pantry', 'Pantry', 'Despensa', 7, 1),
  child(
    'oil-and-vinegar',
    'pantry',
    'Oil and vinegar',
    'Aceite y vinagre',
    2,
    1
  ),
  child('other-pantry', 'pantry', 'Other pantry', 'Otra despensa', 7, 0),
  root('frozen', 'Frozen', 'Congelados', 8, 0),
  child('ice-cream', 'frozen', 'Ice cream', 'Helados', 3, 0),
  child('other-frozen', 'frozen', 'Other frozen', 'Otros congelados', 4, 0),
  root('household', 'Household', 'Hogar y limpieza', 14, 1),
  child('dishwashing', 'household', 'Dishwashing', 'Lavavajillas', 2, 1),
  child(
    'other-household',
    'household',
    'Other household',
    'Otros de hogar',
    5,
    0
  ),
  root('other', 'Other', 'Otros', 16, 0),
  child('uncategorised', 'other', 'Not yet categorised', 'Sin categoría', 0, 0),
];

/**
 * A category as a product row carries it: the leaf, its parent, and its name
 * (backend plan 0166, section 3).
 */
export type ProductCategory = Wire.CatalogItemView['categories'][number];

/** The id a seeded category carries, from its slug. */
export function seededCategoryId(slug: string): string {
  return `cat_${slug}`;
}

/**
 * A seeded category as a product carries it, or `null` for a slug the seed
 * does not hold or a root, which no product may be on.
 */
export function seededLeaf(slug: string): ProductCategory | null {
  const row = CATEGORY_SEED.find((category) => category.slug === slug);
  if (row === undefined || row.parentId === null) {
    return null;
  }
  return { id: row.id, parentId: row.parentId, slug: row.slug, name: row.name };
}

function root(
  slug: string,
  en: string,
  es: string,
  position: number,
  itemCount: number
): Wire.CatalogCategoryView {
  return {
    id: seededCategoryId(slug),
    parentId: null,
    slug,
    name: { en, es },
    position,
    itemCount,
  };
}

function child(
  slug: string,
  parent: string,
  en: string,
  es: string,
  position: number,
  itemCount: number
): Wire.CatalogCategoryView {
  return {
    id: seededCategoryId(slug),
    parentId: seededCategoryId(parent),
    slug,
    name: { en, es },
    position,
    itemCount,
  };
}
