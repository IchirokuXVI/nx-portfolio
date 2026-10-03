import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * A slice of the category tree, as it looks with no backend listening (admin
 * plan 0036, backend plan 0166).
 *
 * Five roots and ten of their children, a slice of DIA's tree (backend plan
 * 0173, appendix A) with its own names and positions, enough to drive every
 * rule the screens explain: a product goes on a child and never on a root, and
 * a child holds no children. `uncategorised` is the one a harvested product
 * lands on when nothing says better, which is why the harvest twin reads this
 * too.
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
  root(
    'eggs-milk-and-butter',
    'Eggs, milk, and butter',
    'Huevos, leche y mantequilla',
    6,
    2
  ),
  child('milk', 'eggs-milk-and-butter', 'Milk', 'Leche', 1, 2),
  child(
    'lactose-free-and-fortified-milk',
    'eggs-milk-and-butter',
    'Lactose-free and fortified milk',
    'Leche sin lactosa y enriquecidas',
    2,
    0
  ),
  child(
    'butter-and-margarine',
    'eggs-milk-and-butter',
    'Butter and margarine',
    'Mantequilla y margarina',
    7,
    0
  ),
  root(
    'frozen-foods-and-ice-cream',
    'Frozen foods and ice cream',
    'Congelados y helados',
    9,
    0
  ),
  child(
    'ice-creams-and-ice',
    'frozen-foods-and-ice-cream',
    'Ice creams and ice',
    'Helados y hielo',
    5,
    0
  ),
  child(
    'cakes-and-churros',
    'frozen-foods-and-ice-cream',
    'Cakes and churros',
    'Tartas y churros',
    6,
    0
  ),
  root(
    'oils-sauces-and-spices',
    'Oils, sauces and spices',
    'Aceites, salsas y especias',
    11,
    1
  ),
  child('oils', 'oils-sauces-and-spices', 'Oils', 'Aceites', 0, 1),
  child(
    'vinegars-and-dressings',
    'oils-sauces-and-spices',
    'Vinegars and dressings',
    'Vinagres y aliños',
    1,
    0
  ),
  root('cleaning-and-home', 'Cleaning and home', 'Limpieza y hogar', 22, 1),
  child('dishwasher', 'cleaning-and-home', 'Dishwasher', 'Lavavajillas', 2, 1),
  child(
    'bleach-and-disinfectants',
    'cleaning-and-home',
    'Bleach and disinfectants',
    'Lejía y desinfectantes',
    8,
    0
  ),
  root('other', 'Other', 'Otros', 28, 0),
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
