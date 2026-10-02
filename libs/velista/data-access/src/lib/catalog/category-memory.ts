import type { CategoryNode, ProductCategory } from '@portfolio/velista/models';

/**
 * A slice of the catalog's tree, in memory (velista `0118`, section 4).
 *
 * Nine roots of backend `0173` appendix A and thirteen of their leaves, with the real
 * slugs, names and positions, so a backend-less run and every memory store name their
 * products from the same rows the seed writes. The ids are `cat-<slug>`, readable in
 * a failing spec where the seed derives a uuid from the same slug.
 *
 * The counts are the products {@link CatalogBrowseMemory} holds under each row, and a
 * root counts the products under its children. `plant-based-drinks-and-horchata` and
 * `freshly-baked-bread` hold none there, which is the empty leaf a picker hides.
 */
// One row per line, as the taxonomy table in backend 0173 reads.
// prettier-ignore
export const MEMORY_CATEGORIES: readonly CategoryNode[] = [
  root('eggs-milk-and-butter', 'Eggs, milk, and butter', 'Huevos, leche y mantequilla', 6, 4),
  leaf('eggs', 'eggs-milk-and-butter', 'Eggs', 'Huevos', 0, 1),
  leaf('milk', 'eggs-milk-and-butter', 'Milk', 'Leche', 1, 2),
  leaf('lactose-free-and-fortified-milk', 'eggs-milk-and-butter', 'Lactose-free and fortified milk', 'Leche sin lactosa y enriquecidas', 2, 1),
  leaf('plant-based-drinks-and-horchata', 'eggs-milk-and-butter', 'Plant-based drinks and horchata', 'Bebidas vegetales y horchatas', 3, 0),
  root('bakery', 'Bakery', 'Panadería', 7, 1),
  leaf('freshly-baked-bread', 'bakery', 'Freshly baked bread', 'Pan recién horneado', 0, 0),
  leaf('sliced-and-specialty-breads', 'bakery', 'Sliced and specialty breads', 'Pan de molde y especiales', 1, 1),
  root('yoghurts-and-desserts', 'Yoghurts and desserts', 'Yogures y postres', 8, 1),
  leaf('natural-and-skimmed-yogurts', 'yoghurts-and-desserts', 'Natural and skimmed yogurts', 'Yogures naturales y desnatados', 0, 1),
  root('rice-pasta-and-pulses', 'Rice, pasta and pulses', 'Arroz, pastas y legumbres', 10, 1),
  leaf('rice', 'rice-pasta-and-pulses', 'Rice', 'Arroz', 0, 1),
  root('oils-sauces-and-spices', 'Oils, sauces and spices', 'Aceites, salsas y especias', 11, 1),
  leaf('oils', 'oils-sauces-and-spices', 'Oils', 'Aceites', 0, 1),
  root('canned-food-broths-and-creams', 'Canned food, broths and creams', 'Conservas, caldos y cremas', 12, 1),
  leaf('tuna-and-bonito', 'canned-food-broths-and-creams', 'Tuna and bonito', 'Atún y bonito', 0, 1),
  root('coffee-cocoa-and-infusions', 'Coffee, cocoa and infusions', 'Café, cacao e infusiones', 13, 1),
  leaf('ground-coffee', 'coffee-cocoa-and-infusions', 'Ground coffee', 'Café molido', 3, 1),
  root('pastries-cakes-and-sugar', 'Pastries, cakes, and sugar', 'Bollería, repostería y azúcar', 14, 1),
  leaf('sugar-honey-and-sweeteners', 'pastries-cakes-and-sugar', 'Sugar, honey, and sweeteners', 'Azúcar, miel y edulcorantes', 6, 1),
  root('prepared-meals-and-pizzas', 'Prepared meals and pizzas', 'Platos preparados y pizzas', 17, 1),
  leaf('gazpachos-and-salmorejos', 'prepared-meals-and-pizzas', 'Gazpachos and salmorejos', 'Gazpachos y salmorejos', 9, 1),
];

/**
 * One leaf of {@link MEMORY_CATEGORIES} as a product carries it, by slug.
 *
 * Throws on a slug the table does not hold, which can only be a typo in a fixture
 * beside it and is better found when the module loads than as a product silently
 * filed under "No category".
 */
export function memoryCategory(slug: string): ProductCategory {
  const row = MEMORY_CATEGORIES.find((one) => one.slug === slug);
  if (row === undefined || row.parentId === null) {
    throw new Error(`No memory leaf named ${slug}`);
  }
  return { id: row.id, parentId: row.parentId, slug, name: row.name };
}

function root(
  slug: string,
  en: string,
  es: string,
  position: number,
  itemCount: number
): CategoryNode {
  return {
    id: `cat-${slug}`,
    parentId: null,
    slug,
    name: { en, es },
    position,
    itemCount,
  };
}

function leaf(
  slug: string,
  parent: string,
  en: string,
  es: string,
  position: number,
  itemCount: number
): CategoryNode {
  return {
    id: `cat-${slug}`,
    parentId: `cat-${parent}`,
    slug,
    name: { en, es },
    position,
    itemCount,
  };
}
