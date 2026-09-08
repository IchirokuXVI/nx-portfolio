import { ItemCategory } from '@portfolio/luna-shopper/contracts';
import { LIDL_GROCERY_CATEGORIES } from './types';

/**
 * LIDL's need world path mapped onto `ItemCategory` (plan 0089, section 5).
 *
 * Two different questions live here and they are not the same one:
 *
 * - {@link isGroceryCategory} answers "is this a supermarket product", from the
 *   coarse category the index prints. That decides what a run reads.
 * - {@link resolveCategory} answers "what aisle is it", from the need world
 *   path. That is a proposal an admin sees, and it decides nothing.
 *
 * **The map is lossy and the fallback is the honest answer.** LIDL publishes a
 * four level tree against our twelve values, and its own tagging is noisy:
 * eight of one week's 153 grocery products are filed under `Vivir y amueblar`
 * and one under `Deporte y ocio`. Those reach `OTHER`, which is what the admin
 * queue is for. **A run never guesses a category from a product name.**
 */

/** Case and accent insensitive: the source's own casing is not stable. */
function fold(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * The need world nodes that decide an aisle, measured against the whole
 * in-store assortment on 2026-09-06.
 *
 * They are the level three nodes under `Comida y cerca de la comida`, plus the
 * one level two node that is food and is not under it. **The deeper nodes are
 * deliberately absent**: resolution climbs towards the root, so `Alimentos
 * congelados/Helado` reaches `FROZEN` through its parent and a new child of a
 * mapped node needs no entry here at all.
 *
 * Nothing outside food is listed. `Vivir y amueblar` and `Deporte y ocio` are
 * not aisles of a supermarket, and leaving them out is what makes them fall
 * back rather than claim a value.
 */
const CATEGORY_NODES: ReadonlyArray<readonly [string, ItemCategory]> = [
  ['Frutas y hortalizas', ItemCategory.PRODUCE],
  ['Carne y aves', ItemCategory.MEAT],
  ['Pescado y marisco', ItemCategory.SEAFOOD],
  ['Panadería', ItemCategory.BAKERY],
  ['Quesos, productos lácteos y huevos', ItemCategory.DAIRY],
  ['Alimentos congelados', ItemCategory.FROZEN],
  ['Bebidas', ItemCategory.BEVERAGES],
  // The level two node that is food: beer, wine and spirits are filed beside
  // `Comida y cerca de la comida` rather than under it.
  ['Vino, cerveza y licores', ItemCategory.BEVERAGES],
  ['Dulces y aperitivos', ItemCategory.SNACKS],
  ['Café, té y cacao', ItemCategory.PANTRY],
  ['Muesli y untables', ItemCategory.PANTRY],
  ['Reservas de alimentos', ItemCategory.PANTRY],
  ['Aceites, especias y salsas', ItemCategory.PANTRY],
  // `Presupuesto` is LIDL's own word for the cheap household aisle, and it
  // holds toilet paper, detergent and cleaning products rather than food.
  ['Presupuesto', ItemCategory.HOUSEHOLD],
  ['Productos de droguería y cuidado personal', ItemCategory.PERSONAL_CARE],
  ['Bebés y niños', ItemCategory.PERSONAL_CARE],
  // Prepared meals and pet food are real supermarket aisles our enum has no
  // value for. They are mapped rather than left to fall back, so that the
  // fallback keeps meaning "the source said nothing we could read".
  ['Platos precocinados', ItemCategory.OTHER],
  ['Artículos para mascotas', ItemCategory.OTHER],
  ['Flores y plantas', ItemCategory.OTHER],
];

const BY_NAME = new Map<string, ItemCategory>(
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
 * The aisle a need world path names, or `OTHER`.
 *
 * The **deepest** node decides where a rule exists for it; otherwise resolution
 * climbs towards the root, so a leaf nobody mapped still lands under its parent
 * rather than in `OTHER`. That is what keeps this table at twenty rows against
 * a tree of several hundred nodes.
 */
export function resolveCategory(path: readonly string[]): ItemCategory {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const mapped = BY_NAME.get(fold(path[i]));
    if (mapped) {
      return mapped;
    }
  }
  return ItemCategory.OTHER;
}

/** The table itself, for the test that asserts all of it at once. */
export const LIDL_CATEGORY_MAP: ReadonlyArray<readonly [string, ItemCategory]> =
  CATEGORY_NODES;
