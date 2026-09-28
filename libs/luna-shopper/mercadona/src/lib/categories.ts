/**
 * Mercadona's tree mapped onto the leaves of the category taxonomy (plan 0038,
 * section 5.6, retargeted by plan 0166, section 7).
 *
 * The answer is a **leaf slug** from appendix A of plan 0166, or null. The
 * library knows no ids: the harvester turns the slug into a row, and turns null
 * into `uncategorised`.
 *
 * The table is keyed on a section (Mercadona's 26 level 1 names) and, inside
 * it, on the section's children. Two things follow from that shape:
 *
 * - **A child is looked up under its own section.** Mercadona reuses short
 *   names: `Congelados` has children called `Carne`, `Pescado`, `Marisco`,
 *   `Verdura` and `Pizzas`, and each one means the frozen aisle, not the fresh
 *   one a flat name map would send it to.
 * - **Every section has an answer of its own**: the one leaf the whole section
 *   is (`Zumos` is `juices`), or else its root's `other-*` leaf. A child nobody listed, or a new one Mercadona adds, climbs to that and
 *   still lands under the right root. Only a path that names no section at all
 *   reaches null.
 *
 * The section names and the children the fixtures hold are proved by the
 * fixtures. The other children are the names the public tree printed; a name
 * that drifts upstream costs one climb to its section's answer, never a wrong
 * leaf. The table is here rather than in the database, so remapping costs a
 * re-import rather than a migration.
 */

/** Case and accent insensitive, because the source's own casing is not stable. */
function fold(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** One Mercadona section, what it answers on its own, and its children. */
export interface MercadonaSectionMapping {
  name: string;
  /** The leaf a product lands on when no child below it is listed. */
  slug: string;
  /** Children whose aisle is narrower than the section's own answer. */
  children: ReadonlyArray<readonly [string, string]>;
}

const SECTIONS: readonly MercadonaSectionMapping[] = [
  {
    name: 'Aceite, especias y salsas',
    slug: 'other-pantry',
    children: [
      ['Aceite, vinagre y sal', 'oil-and-vinegar'],
      ['Especias', 'spices-and-salt'],
      ['Mayonesa, ketchup y mostaza', 'sauces-and-condiments'],
      ['Otras salsas', 'sauces-and-condiments'],
    ],
  },
  {
    name: 'Agua y refrescos',
    slug: 'other-drinks',
    children: [
      ['Agua', 'water'],
      ['Isotónico y energético', 'soft-drinks'],
      ['Refresco de cola', 'soft-drinks'],
      ['Refresco de naranja y de limón', 'soft-drinks'],
      ['Refresco de té y sin gas', 'soft-drinks'],
      ['Tónica y bitter', 'soft-drinks'],
    ],
  },
  {
    name: 'Aperitivos',
    slug: 'other-snacks',
    children: [
      ['Aceitunas y encurtidos', 'olives-and-pickles'],
      ['Frutos secos y fruta desecada', 'nuts-and-dried-fruit'],
      ['Patatas fritas y snacks', 'crisps'],
    ],
  },
  {
    name: 'Arroz, legumbres y pasta',
    slug: 'pasta-rice-and-legumes',
    children: [],
  },
  {
    name: 'Azúcar, caramelos y chocolate',
    slug: 'other-breakfast',
    children: [
      ['Azúcar y edulcorantes', 'flour-sugar-and-baking'],
      ['Chicles y caramelos', 'chocolate-and-sweets'],
      ['Chocolate', 'chocolate-and-sweets'],
      ['Golosinas', 'chocolate-and-sweets'],
      ['Mermelada y miel', 'jam-honey-and-spreads'],
    ],
  },
  {
    name: 'Bebé',
    slug: 'other-baby',
    children: [
      ['Alimentación infantil', 'baby-food'],
      ['Leche y papillas', 'baby-food'],
      ['Toallitas y pañales', 'nappies-and-wipes'],
    ],
  },
  {
    name: 'Bodega',
    slug: 'other-drinks',
    children: [
      ['Cerveza', 'beer'],
      ['Cerveza sin alcohol', 'beer'],
      ['Licores', 'spirits'],
      ['Sidra y cava', 'wine-and-cava'],
      ['Tinto de verano y sangría', 'wine-and-cava'],
      ['Vino blanco', 'wine-and-cava'],
      ['Vino lambrusco y espumoso', 'wine-and-cava'],
      ['Vino rosado', 'wine-and-cava'],
      ['Vino tinto', 'wine-and-cava'],
    ],
  },
  {
    name: 'Cacao, café e infusiones',
    slug: 'coffee-tea-and-cocoa',
    children: [],
  },
  {
    name: 'Carne',
    slug: 'other-meat',
    children: [
      ['Aves y pollo', 'poultry'],
      ['Cerdo', 'pork'],
      ['Conejo y cordero', 'beef-and-lamb'],
      ['Hamburguesas y picadas', 'minced-and-burgers'],
      ['Vacuno', 'beef-and-lamb'],
    ],
  },
  {
    name: 'Cereales y galletas',
    slug: 'other-breakfast',
    children: [
      ['Cereales', 'cereals'],
      ['Galletas', 'biscuits'],
      ['Tortitas', 'toasts-and-crispbread'],
    ],
  },
  {
    // Cheese is also caught by id, below, because this section exists to be
    // split and the ids are steadier than the names.
    name: 'Charcutería y quesos',
    slug: 'other-cold-cuts',
    children: [
      ['Aves y jamón cocido', 'sliced-cold-cuts'],
      ['Chopped y mortadela', 'sliced-cold-cuts'],
      ['Embutido curado', 'cured-ham-and-sausages'],
      ['Jamón serrano', 'cured-ham-and-sausages'],
      ['Paté y sobrasada', 'pates-and-spreads'],
      ['Queso curado, semicurado y tierno', 'cheese'],
      ['Queso lonchas, rallado y en porciones', 'cheese'],
      ['Queso untable y fresco', 'cheese'],
    ],
  },
  {
    name: 'Congelados',
    slug: 'other-frozen',
    children: [
      ['Arroz y pasta', 'frozen-meals-and-pizzas'],
      ['Helados', 'ice-cream'],
      ['Marisco', 'frozen-fish-and-seafood'],
      ['Pescado', 'frozen-fish-and-seafood'],
      ['Pizzas', 'frozen-meals-and-pizzas'],
      ['Verdura', 'frozen-vegetables'],
    ],
  },
  {
    name: 'Conservas, caldos y cremas',
    slug: 'other-pantry',
    children: [
      ['Atún y otras conservas de pescado', 'canned-food'],
      ['Berberechos y mejillones', 'canned-food'],
      ['Conservas de verdura y frutas', 'canned-food'],
      ['Gazpacho y cremas', 'soups-and-stock'],
      ['Sopa y caldo', 'soups-and-stock'],
      ['Tomate', 'canned-food'],
    ],
  },
  { name: 'Cuidado del cabello', slug: 'hair', children: [] },
  {
    name: 'Cuidado facial y corporal',
    slug: 'other-personal-care',
    children: [
      ['Afeitado y cuidado para hombre', 'shaving-and-deodorant'],
      ['Cuidado corporal', 'skin-and-body'],
      ['Cuidado e higiene facial', 'skin-and-body'],
      ['Depilación', 'shaving-and-deodorant'],
      ['Desodorante', 'shaving-and-deodorant'],
      ['Gel y jabón de manos', 'skin-and-body'],
      ['Higiene bucal', 'oral-care'],
      ['Higiene íntima', 'feminine-care'],
      ['Protector solar y aftersun', 'skin-and-body'],
    ],
  },
  { name: 'Fitoterapia y parafarmacia', slug: 'pharmacy', children: [] },
  {
    name: 'Fruta y verdura',
    slug: 'other-produce',
    children: [
      ['Fruta', 'fruit'],
      ['Lechuga y ensalada preparada', 'salads-and-herbs'],
      ['Verdura', 'vegetables'],
    ],
  },
  {
    name: 'Huevos, leche y mantequilla',
    slug: 'other-dairy',
    children: [
      ['Huevos', 'eggs'],
      // Milk and plant drinks share one Mercadona aisle. Milk is most of it,
      // and splitting the rest needs the level below, which no fixture holds.
      ['Leche y bebidas vegetales', 'milk'],
      ['Mantequilla y margarina', 'butter-and-cream'],
      ['Nata', 'butter-and-cream'],
    ],
  },
  {
    name: 'Limpieza y hogar',
    slug: 'other-household',
    children: [
      ['Bolsas', 'bags-foil-and-wrap'],
      ['Detergente y suavizante ropa', 'laundry'],
      ['Estropajo, bayeta y guantes', 'cleaning'],
      ['Lejía y líquidos fuertes', 'cleaning'],
      ['Limpiahogar y friegasuelos', 'cleaning'],
      ['Limpieza baño y WC', 'cleaning'],
      ['Limpieza cocina', 'cleaning'],
      ['Limpieza vajilla', 'dishwashing'],
      ['Menaje y conservación de alimentos', 'bags-foil-and-wrap'],
      // Foil and cling film, the two `size_format: 'm'` products.
      ['Papel de cocina y film', 'bags-foil-and-wrap'],
      ['Papel higiénico y celulosa', 'paper-and-wipes'],
      ['Pilas y bolsas de basura', 'bags-foil-and-wrap'],
      ['Utensilios de limpieza y calzado', 'cleaning'],
    ],
  },
  { name: 'Maquillaje', slug: 'other-personal-care', children: [] },
  {
    name: 'Marisco y pescado',
    slug: 'other-seafood',
    children: [
      ['Marisco', 'shellfish'],
      ['Pescado fresco', 'fresh-fish'],
      ['Salazones y ahumados', 'smoked-and-salted-fish'],
    ],
  },
  {
    name: 'Mascotas',
    slug: 'other-pets',
    children: [
      ['Gato', 'cats'],
      ['Perro', 'dogs'],
    ],
  },
  {
    name: 'Panadería y pastelería',
    slug: 'other-bakery',
    children: [
      ['Bollería de horno', 'pastries-and-cakes'],
      ['Bollería envasada', 'pastries-and-cakes'],
      ['Harina y preparado repostería', 'flour-sugar-and-baking'],
      ['Pan de horno', 'bread'],
      ['Pan de molde y otras especialidades', 'bread'],
      ['Pan tostado y rallado', 'toasts-and-crispbread'],
      ['Picos, rosquilletas y picatostes', 'toasts-and-crispbread'],
      ['Tartas y pasteles', 'pastries-and-cakes'],
    ],
  },
  {
    name: 'Pizzas y platos preparados',
    slug: 'other-ready-meals',
    children: [
      ['Listo para Comer', 'prepared-dishes'],
      ['Pizzas', 'pizzas'],
      ['Platos preparados calientes', 'prepared-dishes'],
      ['Platos preparados fríos', 'prepared-dishes'],
    ],
  },
  { name: 'Postres y yogures', slug: 'yogurts-and-desserts', children: [] },
  { name: 'Zumos', slug: 'juices', children: [] },
];

interface FoldedSection {
  slug: string;
  children: ReadonlyMap<string, string>;
}

const BY_SECTION = new Map<string, FoldedSection>(
  SECTIONS.map((section) => [
    fold(section.name),
    {
      slug: section.slug,
      children: new Map(
        section.children.map(([name, slug]) => [fold(name), slug])
      ),
    },
  ])
);

const CHARCUTERIA = fold('Charcutería y quesos');

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

/** What the cheese override answers. */
const CHEESE = 'cheese';

export interface CategoryPathNode {
  id?: number;
  name: string;
}

/**
 * Resolve a product's leaf slug from the path the walk took to reach it, root
 * first, or null when no node of it names a Mercadona section.
 *
 * The **deepest** node decides where a rule exists for it; otherwise the walk
 * climbs back towards the root, so a child nobody mapped still lands on its
 * section's answer. A child is only ever read under a section that appears
 * above it in the same path.
 */
export function resolveCategory(path: CategoryPathNode[]): string | null {
  const folded = path.map((node) => fold(node.name));

  if (folded.includes(CHARCUTERIA)) {
    const cheese = path.some(
      (node, i) =>
        (node.id !== undefined && CHEESE_CATEGORY_IDS.has(node.id)) ||
        CHEESE_NAMES.has(folded[i])
    );
    if (cheese) {
      return CHEESE;
    }
  }

  for (let i = folded.length - 1; i >= 0; i -= 1) {
    const above = sectionAbove(folded, i);
    if (above) {
      // A node below a section is that section's child, even when its name is
      // also a section's: `Congelados` holds a child called `Carne`.
      const child = above.children.get(folded[i]);
      if (child) {
        return child;
      }
      continue;
    }
    const section = BY_SECTION.get(folded[i]);
    if (section) {
      return section.slug;
    }
  }
  return null;
}

/** The nearest section above node `i` of the path, if any node there is one. */
function sectionAbove(
  folded: readonly string[],
  i: number
): FoldedSection | undefined {
  for (let j = i - 1; j >= 0; j -= 1) {
    const section = BY_SECTION.get(folded[j]);
    if (section) {
      return section;
    }
  }
  return undefined;
}

/** The table itself, for the tests that assert all of it at once. */
export const MERCADONA_CATEGORY_TABLE: readonly MercadonaSectionMapping[] =
  SECTIONS;

/** Every slug the table can answer, cheese override included. */
export function mercadonaCategorySlugs(): string[] {
  return [
    CHEESE,
    ...SECTIONS.flatMap((section) => [
      section.slug,
      ...section.children.map(([, slug]) => slug),
    ]),
  ];
}
