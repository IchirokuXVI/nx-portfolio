import { ItemCategory } from '@portfolio/luna-shopper/contracts';

/**
 * Mercadona's tree mapped onto `ItemCategory` (plan 0038, section 5.6).
 *
 * Mercadona has 26 top level categories against our 12 values, so this is **lossy
 * by construction**. Two things reduce the damage: the mapping runs against the
 * *deepest* category on the product rather than the root (`Charcutería y quesos`
 * holds both cured meat and cheese, and mapping from the root files every cheese
 * under MEAT), and the table lives here rather than in the database, so
 * re-mapping costs a re-import rather than a migration.
 *
 * `Mascotas` and `Pizzas y platos preparados` landing in OTHER is the clearest
 * evidence that a flat enum is not enough. This plan does not fix that; it records
 * the damage in one table so the fix has a starting point.
 */

/** Case and accent insensitive, because the source's own casing is not stable. */
function fold(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const ROOT_CATEGORIES: ReadonlyArray<readonly [string, ItemCategory]> = [
  ['Fruta y verdura', ItemCategory.PRODUCE],
  ['Carne', ItemCategory.MEAT],
  ['Marisco y pescado', ItemCategory.SEAFOOD],
  ['Panadería y pastelería', ItemCategory.BAKERY],
  ['Congelados', ItemCategory.FROZEN],
  ['Huevos, leche y mantequilla', ItemCategory.DAIRY],
  ['Postres y yogures', ItemCategory.DAIRY],
  ['Agua y refrescos', ItemCategory.BEVERAGES],
  ['Bodega', ItemCategory.BEVERAGES],
  ['Zumos', ItemCategory.BEVERAGES],
  ['Aperitivos', ItemCategory.SNACKS],
  ['Azúcar, caramelos y chocolate', ItemCategory.SNACKS],
  ['Aceite, especias y salsas', ItemCategory.PANTRY],
  ['Arroz, legumbres y pasta', ItemCategory.PANTRY],
  ['Cacao, café e infusiones', ItemCategory.PANTRY],
  ['Cereales y galletas', ItemCategory.PANTRY],
  ['Conservas, caldos y cremas', ItemCategory.PANTRY],
  ['Limpieza y hogar', ItemCategory.HOUSEHOLD],
  ['Bebé', ItemCategory.PERSONAL_CARE],
  ['Cuidado del cabello', ItemCategory.PERSONAL_CARE],
  ['Cuidado facial y corporal', ItemCategory.PERSONAL_CARE],
  ['Fitoterapia y parafarmacia', ItemCategory.PERSONAL_CARE],
  ['Maquillaje', ItemCategory.PERSONAL_CARE],
  ['Mascotas', ItemCategory.OTHER],
  ['Pizzas y platos preparados', ItemCategory.OTHER],
  // Charcutería y quesos is split: see CHEESE_CATEGORY_IDS below.
  ['Charcutería y quesos', ItemCategory.MEAT],
];

const BY_NAME = new Map<string, ItemCategory>(
  ROOT_CATEGORIES.map(([name, category]) => [fold(name), category])
);

/**
 * The three level 2 categories under `Charcutería y quesos` that are cheese, by
 * id (plan 0038, section 5.6). Ids rather than names because the level 2 names
 * are the ones most likely to be reworded, and because this override exists
 * precisely to disagree with its parent.
 */
export const CHEESE_CATEGORY_IDS: ReadonlySet<number> = new Set([53, 54, 56]);

/**
 * Names that appear on level 2 of `Charcutería y quesos` and mean cheese. The id
 * check above is the primary rule; this catches a product whose path was captured
 * without ids, which is what a fixture or a hand entered path looks like.
 */
const CHEESE_NAMES: ReadonlySet<string> = new Set(
  ['Queso', 'Quesos', 'Queso untable y en lonchas', 'Queso curado'].map(fold)
);

export interface CategoryPathNode {
  id?: number;
  name: string;
}

/**
 * Resolve a product's `ItemCategory` from the path the walk took to reach it,
 * root first. The **deepest** node decides where a rule exists for it; otherwise
 * the walk climbs back towards the root, so a level 2 name nobody mapped still
 * lands under its parent rather than in OTHER.
 */
export function resolveCategory(path: CategoryPathNode[]): ItemCategory {
  const cheese = path.some(
    (node) =>
      (node.id !== undefined && CHEESE_CATEGORY_IDS.has(node.id)) ||
      CHEESE_NAMES.has(fold(node.name))
  );
  const charcuteria = path.some(
    (node) => fold(node.name) === fold('Charcutería y quesos')
  );
  if (charcuteria) {
    return cheese ? ItemCategory.DAIRY : ItemCategory.MEAT;
  }

  for (let i = path.length - 1; i >= 0; i -= 1) {
    const mapped = BY_NAME.get(fold(path[i].name));
    if (mapped) {
      return mapped;
    }
  }
  return ItemCategory.OTHER;
}

/** The table itself, for the test that asserts all of section 5.6 at once. */
export const MERCADONA_ROOT_CATEGORY_MAP: ReadonlyArray<
  readonly [string, ItemCategory]
> = ROOT_CATEGORIES;
