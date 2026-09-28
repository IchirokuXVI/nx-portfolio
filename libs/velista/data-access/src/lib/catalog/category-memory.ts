import type { CategoryNode, ProductCategory } from '@portfolio/velista/models';

/**
 * A slice of the catalog's tree, in memory (velista `0118`, section 4).
 *
 * Four roots of backend `0166` appendix A and eleven of their leaves, with the real
 * slugs, names and positions, so a backend-less run and every memory store name their
 * products from the same rows the seed writes. The ids are `cat-<slug>`, readable in
 * a failing spec where the seed derives a uuid from the same slug.
 *
 * The counts are the products {@link CatalogBrowseMemory} holds under each row, and a
 * root counts the products under its children. `plant-drinks` holds none there, which
 * is the empty leaf a picker hides.
 */
export const MEMORY_CATEGORIES: readonly CategoryNode[] = [
  root('dairy-and-eggs', 'Dairy and eggs', 'Lácteos y huevos', 4, 5),
  leaf('milk', 'dairy-and-eggs', 'Milk', 'Leche', 0, 3),
  leaf('plant-drinks', 'dairy-and-eggs', 'Plant based drinks', 'Bebidas vegetales', 1, 0),
  leaf('yogurts-and-desserts', 'dairy-and-eggs', 'Yogurts and desserts', 'Yogures y postres', 2, 1),
  leaf('eggs', 'dairy-and-eggs', 'Eggs', 'Huevos', 4, 1),
  root('bakery', 'Bakery', 'Panadería y bollería', 5, 1),
  leaf('bread', 'bakery', 'Bread', 'Pan', 0, 1),
  root('breakfast-and-sweets', 'Breakfast and sweets', 'Desayuno y dulces', 6, 1),
  leaf('coffee-tea-and-cocoa', 'breakfast-and-sweets', 'Coffee, tea and cocoa', 'Café, té y cacao', 4, 1),
  root('pantry', 'Pantry', 'Despensa', 7, 5),
  leaf('pasta-rice-and-legumes', 'pantry', 'Pasta, rice and legumes', 'Pasta, arroz y legumbres', 0, 1),
  leaf('canned-food', 'pantry', 'Canned food', 'Conservas', 1, 1),
  leaf('oil-and-vinegar', 'pantry', 'Oil and vinegar', 'Aceite y vinagre', 2, 1),
  leaf('flour-sugar-and-baking', 'pantry', 'Flour, sugar and baking', 'Harina, azúcar y repostería', 4, 1),
  leaf('soups-and-stock', 'pantry', 'Soups and stock', 'Sopas y caldos', 6, 1),
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
