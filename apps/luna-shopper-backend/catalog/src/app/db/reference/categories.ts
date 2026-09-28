import { categoryId } from './ids';
import type { ReferenceCategoryRoot } from './types';

/**
 * The starting taxonomy (plan 0166, section 5 and appendix A): seventeen roots,
 * each with its own children, and a product only ever on a child.
 *
 * Authored for Spanish supermarkets, and a starting point rather than a
 * settled answer: it is edited in the back office afterwards. The seed upserts
 * every row here by the id its slug derives on every boot, names and positions
 * included, and never deletes. So a rename in this file wins, and a row added by
 * hand in the back office survives.
 *
 * **A slug is an identity and never changes once shipped.** The id is derived
 * from it, the migration inserted the roots and the twelve landing leaves under
 * those same ids, and the reference products, the demo world and the harvest
 * resolvers all name a category by slug. Rename the `name`, never the `slug`.
 *
 * Every root has an `other-*` child (the root `other` has `uncategorised`), so a
 * product that fits the root and no leaf has somewhere honest to go. Appendix A
 * says eighty leaves; the table it gives holds eighty four, and all of them are
 * here.
 */
export const REFERENCE_CATEGORIES: ReferenceCategoryRoot[] = [
  {
    slug: 'fruit-and-vegetables',
    name: { en: 'Fruit and vegetables', es: 'Frutas y verduras' },
    children: [
      { slug: 'fruit', name: { en: 'Fruit', es: 'Fruta' } },
      {
        slug: 'vegetables',
        name: { en: 'Vegetables', es: 'Verduras y hortalizas' },
      },
      {
        slug: 'salads-and-herbs',
        name: {
          en: 'Salads and fresh herbs',
          es: 'Ensaladas y hierbas frescas',
        },
      },
      {
        slug: 'nuts-and-dried-fruit',
        name: {
          en: 'Nuts and dried fruit',
          es: 'Frutos secos y fruta desecada',
        },
      },
      {
        slug: 'other-produce',
        name: {
          en: 'Other fruit and vegetables',
          es: 'Otras frutas y verduras',
        },
      },
    ],
  },
  {
    slug: 'meat',
    name: { en: 'Meat', es: 'Carne' },
    children: [
      { slug: 'poultry', name: { en: 'Poultry', es: 'Aves' } },
      { slug: 'pork', name: { en: 'Pork', es: 'Cerdo' } },
      {
        slug: 'beef-and-lamb',
        name: { en: 'Beef and lamb', es: 'Vacuno y cordero' },
      },
      {
        slug: 'minced-and-burgers',
        name: {
          en: 'Minced meat and burgers',
          es: 'Carne picada y hamburguesas',
        },
      },
      { slug: 'other-meat', name: { en: 'Other meat', es: 'Otras carnes' } },
    ],
  },
  {
    slug: 'cold-cuts-and-cheese',
    name: { en: 'Cold cuts and cheese', es: 'Charcutería y quesos' },
    children: [
      {
        slug: 'cured-ham-and-sausages',
        name: { en: 'Cured ham and sausages', es: 'Jamón y embutidos' },
      },
      {
        slug: 'sliced-cold-cuts',
        name: { en: 'Sliced cold cuts', es: 'Fiambres' },
      },
      { slug: 'cheese', name: { en: 'Cheese', es: 'Quesos' } },
      {
        slug: 'pates-and-spreads',
        name: { en: 'Pâtés and spreads', es: 'Patés y untables' },
      },
      {
        slug: 'other-cold-cuts',
        name: { en: 'Other cold cuts', es: 'Otra charcutería' },
      },
    ],
  },
  {
    slug: 'fish-and-seafood',
    name: { en: 'Fish and seafood', es: 'Pescado y marisco' },
    children: [
      { slug: 'fresh-fish', name: { en: 'Fresh fish', es: 'Pescado fresco' } },
      { slug: 'shellfish', name: { en: 'Shellfish', es: 'Marisco' } },
      {
        slug: 'smoked-and-salted-fish',
        name: { en: 'Smoked and salted fish', es: 'Ahumados y salazones' },
      },
      {
        slug: 'other-seafood',
        name: {
          en: 'Other fish and seafood',
          es: 'Otros pescados y mariscos',
        },
      },
    ],
  },
  {
    slug: 'dairy-and-eggs',
    name: { en: 'Dairy and eggs', es: 'Lácteos y huevos' },
    children: [
      { slug: 'milk', name: { en: 'Milk', es: 'Leche' } },
      {
        slug: 'plant-drinks',
        name: { en: 'Plant based drinks', es: 'Bebidas vegetales' },
      },
      {
        slug: 'yogurts-and-desserts',
        name: { en: 'Yogurts and desserts', es: 'Yogures y postres' },
      },
      {
        slug: 'butter-and-cream',
        name: { en: 'Butter and cream', es: 'Mantequilla y nata' },
      },
      { slug: 'eggs', name: { en: 'Eggs', es: 'Huevos' } },
      { slug: 'other-dairy', name: { en: 'Other dairy', es: 'Otros lácteos' } },
    ],
  },
  {
    slug: 'bakery',
    name: { en: 'Bakery', es: 'Panadería y bollería' },
    children: [
      { slug: 'bread', name: { en: 'Bread', es: 'Pan' } },
      {
        slug: 'pastries-and-cakes',
        name: { en: 'Pastries and cakes', es: 'Bollería y pasteles' },
      },
      {
        slug: 'toasts-and-crispbread',
        name: { en: 'Toasts and crispbread', es: 'Tostadas y picos' },
      },
      {
        slug: 'other-bakery',
        name: { en: 'Other bakery', es: 'Otra panadería' },
      },
    ],
  },
  {
    slug: 'breakfast-and-sweets',
    name: { en: 'Breakfast and sweets', es: 'Desayuno y dulces' },
    children: [
      { slug: 'cereals', name: { en: 'Cereals', es: 'Cereales' } },
      { slug: 'biscuits', name: { en: 'Biscuits', es: 'Galletas' } },
      {
        slug: 'jam-honey-and-spreads',
        name: {
          en: 'Jam, honey and spreads',
          es: 'Mermelada, miel y cremas de untar',
        },
      },
      {
        slug: 'chocolate-and-sweets',
        name: { en: 'Chocolate and sweets', es: 'Chocolate y golosinas' },
      },
      {
        slug: 'coffee-tea-and-cocoa',
        name: { en: 'Coffee, tea and cocoa', es: 'Café, té y cacao' },
      },
      {
        slug: 'other-breakfast',
        name: {
          en: 'Other breakfast and sweets',
          es: 'Otros desayunos y dulces',
        },
      },
    ],
  },
  {
    slug: 'pantry',
    name: { en: 'Pantry', es: 'Despensa' },
    children: [
      {
        slug: 'pasta-rice-and-legumes',
        name: {
          en: 'Pasta, rice and legumes',
          es: 'Pasta, arroz y legumbres',
        },
      },
      { slug: 'canned-food', name: { en: 'Canned food', es: 'Conservas' } },
      {
        slug: 'oil-and-vinegar',
        name: { en: 'Oil and vinegar', es: 'Aceite y vinagre' },
      },
      {
        slug: 'sauces-and-condiments',
        name: { en: 'Sauces and condiments', es: 'Salsas y condimentos' },
      },
      {
        slug: 'flour-sugar-and-baking',
        name: {
          en: 'Flour, sugar and baking',
          es: 'Harina, azúcar y repostería',
        },
      },
      {
        slug: 'spices-and-salt',
        name: { en: 'Spices and salt', es: 'Especias y sal' },
      },
      {
        slug: 'soups-and-stock',
        name: { en: 'Soups and stock', es: 'Sopas y caldos' },
      },
      {
        slug: 'other-pantry',
        name: { en: 'Other pantry', es: 'Otra despensa' },
      },
    ],
  },
  {
    slug: 'frozen',
    name: { en: 'Frozen', es: 'Congelados' },
    children: [
      {
        slug: 'frozen-vegetables',
        name: { en: 'Frozen vegetables', es: 'Verduras congeladas' },
      },
      {
        slug: 'frozen-fish-and-seafood',
        name: {
          en: 'Frozen fish and seafood',
          es: 'Pescado y marisco congelado',
        },
      },
      {
        slug: 'frozen-meals-and-pizzas',
        name: {
          en: 'Frozen meals and pizzas',
          es: 'Platos preparados y pizzas congeladas',
        },
      },
      { slug: 'ice-cream', name: { en: 'Ice cream', es: 'Helados' } },
      {
        slug: 'other-frozen',
        name: { en: 'Other frozen', es: 'Otros congelados' },
      },
    ],
  },
  {
    slug: 'ready-meals',
    name: { en: 'Ready meals', es: 'Platos preparados' },
    children: [
      { slug: 'pizzas', name: { en: 'Pizzas', es: 'Pizzas' } },
      {
        slug: 'prepared-dishes',
        name: { en: 'Prepared dishes', es: 'Platos cocinados' },
      },
      {
        slug: 'salads-and-sandwiches',
        name: { en: 'Salads and sandwiches', es: 'Ensaladas y sándwiches' },
      },
      {
        slug: 'fresh-pasta-and-dough',
        name: { en: 'Fresh pasta and dough', es: 'Pasta fresca y masas' },
      },
      {
        slug: 'other-ready-meals',
        name: { en: 'Other ready meals', es: 'Otros platos preparados' },
      },
    ],
  },
  {
    slug: 'snacks',
    name: { en: 'Snacks', es: 'Aperitivos' },
    children: [
      { slug: 'crisps', name: { en: 'Crisps', es: 'Patatas fritas' } },
      {
        slug: 'salty-snacks',
        name: { en: 'Salty snacks', es: 'Snacks salados' },
      },
      {
        slug: 'olives-and-pickles',
        name: { en: 'Olives and pickles', es: 'Aceitunas y encurtidos' },
      },
      {
        slug: 'other-snacks',
        name: { en: 'Other snacks', es: 'Otros aperitivos' },
      },
    ],
  },
  {
    slug: 'drinks',
    name: { en: 'Drinks', es: 'Bebidas' },
    children: [
      { slug: 'water', name: { en: 'Water', es: 'Agua' } },
      { slug: 'soft-drinks', name: { en: 'Soft drinks', es: 'Refrescos' } },
      { slug: 'juices', name: { en: 'Juices', es: 'Zumos' } },
      { slug: 'beer', name: { en: 'Beer', es: 'Cerveza' } },
      {
        slug: 'wine-and-cava',
        name: { en: 'Wine and cava', es: 'Vino y cava' },
      },
      {
        slug: 'spirits',
        name: { en: 'Spirits', es: 'Licores y destilados' },
      },
      {
        slug: 'other-drinks',
        name: { en: 'Other drinks', es: 'Otras bebidas' },
      },
    ],
  },
  {
    slug: 'baby',
    name: { en: 'Baby', es: 'Bebé' },
    children: [
      {
        slug: 'baby-food',
        name: { en: 'Baby food', es: 'Alimentación infantil' },
      },
      {
        slug: 'nappies-and-wipes',
        name: { en: 'Nappies and wipes', es: 'Pañales y toallitas' },
      },
      { slug: 'other-baby', name: { en: 'Other baby', es: 'Otros de bebé' } },
    ],
  },
  {
    slug: 'pets',
    name: { en: 'Pets', es: 'Mascotas' },
    children: [
      { slug: 'dogs', name: { en: 'Dogs', es: 'Perros' } },
      { slug: 'cats', name: { en: 'Cats', es: 'Gatos' } },
      {
        slug: 'other-pets',
        name: { en: 'Other pets', es: 'Otras mascotas' },
      },
    ],
  },
  {
    slug: 'household',
    name: { en: 'Household', es: 'Hogar y limpieza' },
    children: [
      {
        slug: 'cleaning',
        name: { en: 'Cleaning', es: 'Limpieza del hogar' },
      },
      { slug: 'laundry', name: { en: 'Laundry', es: 'Lavado de ropa' } },
      {
        slug: 'dishwashing',
        name: { en: 'Dishwashing', es: 'Lavavajillas' },
      },
      {
        slug: 'paper-and-wipes',
        name: { en: 'Paper and wipes', es: 'Papel y toallitas' },
      },
      {
        slug: 'bags-foil-and-wrap',
        name: {
          en: 'Bags, foil and wrap',
          es: 'Bolsas, papel de aluminio y film',
        },
      },
      {
        slug: 'other-household',
        name: { en: 'Other household', es: 'Otros de hogar' },
      },
    ],
  },
  {
    slug: 'personal-care',
    name: { en: 'Personal care', es: 'Cuidado personal' },
    children: [
      { slug: 'hair', name: { en: 'Hair', es: 'Cabello' } },
      {
        slug: 'skin-and-body',
        name: { en: 'Skin and body', es: 'Piel y cuerpo' },
      },
      { slug: 'oral-care', name: { en: 'Oral care', es: 'Higiene bucal' } },
      {
        slug: 'shaving-and-deodorant',
        name: { en: 'Shaving and deodorant', es: 'Afeitado y desodorante' },
      },
      {
        slug: 'feminine-care',
        name: { en: 'Feminine care', es: 'Higiene íntima' },
      },
      { slug: 'pharmacy', name: { en: 'Pharmacy', es: 'Parafarmacia' } },
      {
        slug: 'other-personal-care',
        name: { en: 'Other personal care', es: 'Otro cuidado personal' },
      },
    ],
  },
  {
    slug: 'other',
    name: { en: 'Other', es: 'Otros' },
    children: [
      {
        slug: 'uncategorised',
        name: { en: 'Not yet categorised', es: 'Sin categoría' },
      },
    ],
  },
];

/**
 * The leaf a product lands on when nothing better is known (plan 0166,
 * appendix A): the only child of the root `other`.
 */
export const UNCATEGORISED_SLUG = 'uncategorised';

/** One row of the taxonomy as the `categories` table holds it. */
export interface ReferenceCategoryRow {
  id: string;
  parentId: string | null;
  slug: string;
  name: ReferenceCategoryRoot['name'];
  position: number;
}

/**
 * The taxonomy as rows, roots first and then every child, each numbered by
 * where it sits among its siblings.
 *
 * Roots first because a child's parent has to exist before it does, and the
 * seed writes them in this order.
 */
export function referenceCategoryRows(): ReferenceCategoryRow[] {
  const roots = REFERENCE_CATEGORIES.map((root, position) => ({
    id: categoryId(root.slug),
    parentId: null,
    slug: root.slug,
    name: root.name,
    position,
  }));
  const children = REFERENCE_CATEGORIES.flatMap((root) =>
    root.children.map((child, position) => ({
      id: categoryId(child.slug),
      parentId: categoryId(root.slug),
      slug: child.slug,
      name: child.name,
      position,
    }))
  );
  return [...roots, ...children];
}

/** Every leaf slug the taxonomy holds, for the checks that name one. */
export const REFERENCE_LEAF_SLUGS: ReadonlySet<string> = new Set(
  REFERENCE_CATEGORIES.flatMap((root) => root.children.map((c) => c.slug))
);
