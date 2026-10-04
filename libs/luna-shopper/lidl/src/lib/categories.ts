import { LIDL_GROCERY_CATEGORIES } from './types';

/**
 * LIDL's need world path mapped onto the leaves of the category taxonomy (plan
 * 0089, section 5, retargeted by plan 0166, section 7, and again by plan 0173,
 * section 6). The answer is a leaf slug from appendix A of plan 0173, or null;
 * the harvester turns the slug into a row and null into `uncategorised`.
 *
 * Two different questions live here and they are not the same one:
 *
 * - {@link isGroceryCategory} answers "is this a supermarket product", from the
 *   coarse category the index prints. That decides what a run reads.
 * - {@link resolveCategory} answers "what aisle is it", from the need world
 *   path. That is a proposal an admin sees, and it decides nothing.
 *
 * **Null is the honest answer when the path says nothing we can read.** LIDL's
 * own tagging is noisy: eight of one week's 153 grocery products are filed
 * under `Vivir y amueblar` and one under `Deporte y ocio`. Those reach null,
 * which is what the admin queue is for. **A run never guesses a category from
 * a product name.**
 */

/** Case and accent insensitive: the source's own casing is not stable. */
function fold(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** What a node answers when no leaf of the taxonomy is it. */
const NO_LEAF = 'uncategorised';

/**
 * The need world nodes that decide an aisle, measured against the whole
 * in-store assortment on 2026-09-06.
 *
 * The level three nodes under `Comida y cerca de la comida` are listed, plus
 * the one level two node that is food and is not under it. Each answers the
 * leaf that holds most of it, or `uncategorised` when it is as wide as a whole
 * root or wider: the taxonomy has no catch all under a root, and a guessed leaf
 * would misfile everything below the node. **A level four node is
 * listed only where a fixture or the research sample printed it**, and only
 * when it is narrower than its parent: resolution climbs towards the root, so
 * a level four node nobody listed still lands on its parent's answer.
 *
 * Nothing outside food is listed. `Vivir y amueblar` and `Deporte y ocio` are
 * not aisles of a supermarket, and leaving them out is what makes them fall
 * back rather than claim a leaf. `Flores y plantas` is left out too. The
 * taxonomy has had a leaf for it since plan 0179 (`garden-and-plants`), but
 * the index files plants as `P+F`, which {@link isGroceryCategory} drops
 * before anything is resolved, so a row for it here would answer nothing.
 */
const CATEGORY_NODES: ReadonlyArray<readonly [string, string]> = [
  ['Frutas y hortalizas', NO_LEAF],
  ['Fruta', 'other-fruits'],
  ['Carne y aves', NO_LEAF],
  ['Embutidos y fiambres', 'fuet-and-salchichon'],
  ['Pescado y marisco', NO_LEAF],
  ['Panadería', NO_LEAF],
  ['Pasteles', 'pastries-cakes-and-sugar-cakes'],
  ['Quesos, productos lácteos y huevos', NO_LEAF],
  ['Queso', 'semi-cured'],
  ['Leche y nata', 'milk'],
  ['Alimentos congelados', NO_LEAF],
  ['Helado', 'ice-creams-and-ice'],
  [
    'Pescado y marisco congelados',
    'frozen-foods-and-ice-cream-fish-and-seafood',
  ],
  ['Bebidas', NO_LEAF],
  ['Refrescos', 'cola'],
  // The level two node that is food: beer, wine and spirits are filed beside
  // `Comida y cerca de la comida` rather than under it.
  ['Vino, cerveza y licores', NO_LEAF],
  ['Cerveza y sidra', 'beers'],
  ['Dulces y aperitivos', NO_LEAF],
  ['Aperitivos salados', 'savory-snacks'],
  ['Galletas y pasteles', 'classic-and-digestive-biscuits'],
  ['Productos de chocolate', 'chocolates-and-bonbons'],
  ['Café, té y cacao', 'ground-coffee'],
  ['Muesli y untables', 'whole-grain-cereals-and-muesli'],
  ['Reservas de alimentos', NO_LEAF],
  ['Ingredientes para repostería', 'flours-and-yeasts'],
  ['Aceites, especias y salsas', NO_LEAF],
  ['Aceites y grasas', 'oils'],
  // `Presupuesto` is LIDL's own word for the cheap household aisle, and it
  // holds toilet paper, detergent and cleaning products rather than food.
  ['Presupuesto', NO_LEAF],
  ['Papel higiénico', 'toilet-paper-kitchen-paper-and-napkins'],
  ['Detergentes y cuidado de la ropa', 'detergents'],
  ['Productos de droguería y cuidado personal', NO_LEAF],
  ['Cuidado del cabello', 'shampoo'],
  ['Vitaminas y nutrición deportiva', 'nutritional-supplements'],
  ['Bebés y niños', NO_LEAF],
  ['Alimentos para bebés y leche en polvo', 'milk-and-baby-food'],
  ['Platos precocinados', NO_LEAF],
  ['Platos preparados refrigerados', 'ready-to-eat-dishes'],
  ['Artículos para mascotas', NO_LEAF],
  ['Comida para gatos', 'dry-cat-food'],
];

const BY_NAME = new Map<string, string>(
  CATEGORY_NODES.map(([name, category]) => [fold(name), category])
);

/**
 * Whether the index's coarse category is a supermarket product (section 5).
 *
 * `Food` and `F+V` are the run. `NonFood` is the weekly bazar, `P+F` is plants,
 * and a value starting `Categorías/` is the online shop, which a shop stocks
 * but a shopping list line is not about. The field carries a path for the
 * online shop and a bare token for everything else, so only the first segment
 * is read.
 */
export function isGroceryCategory(category: string | null): boolean {
  if (!category) {
    return false;
  }
  return LIDL_GROCERY_CATEGORIES.has(category.split('/')[0].trim());
}

/** The need world path, root first, out of the string the source prints. */
export function categoryPathOf(wonCategoryPrimary: string | null): string[] {
  if (!wonCategoryPrimary) {
    return [];
  }
  return wonCategoryPrimary
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * The leaf slug a need world path names, or null.
 *
 * The **deepest** node decides where a rule exists for it; otherwise resolution
 * climbs towards the root, so a node nobody mapped still lands on its parent's
 * answer rather than on null. That is what keeps this table at forty rows
 * against a tree of several hundred nodes.
 */
export function resolveCategory(path: readonly string[]): string | null {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const mapped = BY_NAME.get(fold(path[i]));
    if (mapped) {
      return mapped;
    }
  }
  return null;
}

/** The table itself, for the test that asserts all of it at once. */
export const LIDL_CATEGORY_MAP: ReadonlyArray<readonly [string, string]> =
  CATEGORY_NODES;
