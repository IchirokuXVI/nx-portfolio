/**
 * Mercadona's tree mapped onto the leaves of the category taxonomy (plan 0038,
 * section 5.6, retargeted by plan 0166, section 7, and again by plan 0173,
 * section 6).
 *
 * The answer is a **leaf slug** from appendix A of plan 0173 or from plan
 * 0179, which added the leaves DIA's tree had no place for, or null. The
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
 *   is (`Fitoterapia y parafarmacia` is `parapharmacy`), or else
 *   `uncategorised`. The taxonomy has no catch all under a root, and a section
 *   spans several leaves, so a guessed one would misfile every child nobody
 *   listed. A new child Mercadona adds climbs to that answer and waits there
 *   for a person. A path that names no section at all reaches null, which the
 *   harvester files in the same place.
 *
 * The section names and the children the fixtures hold are proved by the
 * fixtures. The other children are the names the public tree printed; a name
 * that drifts upstream costs one climb to its section's answer, never a wrong
 * leaf. Where one child spans several leaves, the entry names the leaf that
 * holds most of it. The table is here rather than in the database, so remapping costs a
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

/** What a section or a child answers when no leaf of the taxonomy is it. */
const NO_LEAF = 'uncategorised';

const SECTIONS: readonly MercadonaSectionMapping[] = [
  {
    name: 'Aceite, especias y salsas',
    slug: NO_LEAF,
    children: [
      // Oil is most of it. Vinegar and salt have leaves of their own, and
      // telling them apart needs the level below.
      ['Aceite, vinagre y sal', 'oils'],
      ['Especias', 'spices-and-herbs'],
      ['Mayonesa, ketchup y mostaza', 'ketchup-mayonnaise-and-mustard'],
      // Tomate frito is not here: Mercadona files it under `Conservas`.
      ['Otras salsas', 'special-and-spicy-sauces'],
    ],
  },
  {
    name: 'Agua y refrescos',
    slug: NO_LEAF,
    children: [
      ['Agua', 'water'],
      ['Isotónico y energético', 'isotonic-and-sports-drinks'],
      ['Refresco de cola', 'cola'],
      ['Refresco de naranja y de limón', 'orange-lemon-and-lemon-lime'],
      // Iced tea has a leaf of its own, and it is a still drink too.
      ['Refresco de té y sin gas', 'non-carbonated-soft-drinks'],
      ['Tónica y bitter', 'tonic-sparkling-water-and-bitter'],
    ],
  },
  {
    name: 'Aperitivos',
    slug: NO_LEAF,
    children: [
      ['Aceitunas y encurtidos', 'olives'],
      ['Frutos secos y fruta desecada', 'nuts'],
      ['Patatas fritas y snacks', 'savory-snacks'],
    ],
  },
  {
    name: 'Arroz, legumbres y pasta',
    slug: NO_LEAF,
    children: [
      ['Arroz', 'rice'],
      ['Legumbres', 'chickpeas-and-beans'],
      ['Pasta y fideos', 'macaroni-spaghetti-and-dried-pasta'],
    ],
  },
  {
    name: 'Azúcar, caramelos y chocolate',
    slug: NO_LEAF,
    children: [
      ['Azúcar y edulcorantes', 'sugar-honey-and-sweeteners'],
      ['Chicles y caramelos', 'chewing-gum-and-candies'],
      ['Chocolate', 'milk-chocolate'],
      ['Golosinas', 'sweets'],
      ['Mermelada y miel', 'jams'],
    ],
  },
  {
    name: 'Bebé',
    slug: NO_LEAF,
    children: [
      ['Alimentación infantil', 'baby-foods-and-jars'],
      ['Leche y papillas', 'milk-and-baby-food'],
      ['Toallitas y pañales', 'diapers-and-wipes'],
    ],
  },
  {
    name: 'Bodega',
    slug: NO_LEAF,
    children: [
      ['Cerveza', 'beers'],
      ['Cerveza sin alcohol', 'non-alcoholic-beers'],
      ['Licores', 'creams-liqueurs-and-brandy'],
      ['Sidra y cava', 'cavas-and-cider'],
      ['Tinto de verano y sangría', 'summer-red-wine-and-sangria'],
      ['Vino blanco', 'white-wine'],
      // The taxonomy has one sparkling leaf, and it is this one.
      ['Vino lambrusco y espumoso', 'cavas-and-cider'],
      ['Vino rosado', 'rose-wine'],
      ['Vino tinto', 'red-wine'],
    ],
  },
  {
    name: 'Cacao, café e infusiones',
    slug: NO_LEAF,
    children: [
      ['Cacao soluble y chocolate a la taza', 'cocoa-and-hot-chocolate'],
      // The taxonomy splits capsules by machine, which needs the product.
      ['Café cápsula y monodosis', 'compatible-nespresso-capsules'],
      ['Café molido y en grano', 'ground-coffee'],
      ['Café soluble y otras bebidas', 'instant-coffee'],
      ['Té e infusiones', 'infusions'],
    ],
  },
  {
    name: 'Carne',
    slug: NO_LEAF,
    children: [
      ['Aves y pollo', 'chicken'],
      ['Cerdo', 'pork'],
      // The taxonomy has no lamb leaf, so lamb is filed with the rabbit.
      ['Conejo y cordero', 'rabbit'],
      ['Hamburguesas y picadas', 'hamburgers-ground-beef-and-meatballs'],
      ['Vacuno', 'beef'],
    ],
  },
  {
    name: 'Cereales y galletas',
    slug: NO_LEAF,
    children: [
      ['Cereales', 'cereals'],
      ['Galletas', 'classic-and-digestive-biscuits'],
      ['Tortitas', 'biscuits-cereals-and-jams-cakes'],
    ],
  },
  {
    // Cheese is also caught by id, below, because this section exists to be
    // split and the ids are steadier than the names.
    name: 'Charcutería y quesos',
    slug: NO_LEAF,
    children: [
      ['Aves y jamón cocido', 'cooked-ham'],
      ['Chopped y mortadela', 'chopped-and-mortadella'],
      ['Embutido curado', 'fuet-and-salchichon'],
      ['Jamón serrano', 'serrano-ham'],
      ['Paté y sobrasada', 'pate-and-sobrasada'],
      ['Queso curado, semicurado y tierno', 'semi-cured'],
      ['Queso lonchas, rallado y en porciones', 'sliced'],
      ['Queso untable y fresco', 'cheeses-fresh'],
    ],
  },
  {
    name: 'Congelados',
    slug: NO_LEAF,
    children: [
      ['Arroz y pasta', 'rice-and-pasta'],
      ['Helados', 'ice-creams-and-ice'],
      ['Marisco', 'frozen-foods-and-ice-cream-fish-and-seafood'],
      ['Pescado', 'frozen-foods-and-ice-cream-fish-and-seafood'],
      ['Pizzas', 'pizzas-and-doughs'],
      ['Verdura', 'vegetables-and-potatoes'],
    ],
  },
  {
    name: 'Conservas, caldos y cremas',
    slug: NO_LEAF,
    children: [
      ['Atún y otras conservas de pescado', 'tuna-and-bonito'],
      ['Berberechos y mejillones', 'mussels-cockles-and-fish'],
      [
        'Conservas de verdura y frutas',
        'canned-food-broths-and-creams-canned-vegetables',
      ],
      ['Gazpacho y cremas', 'creams-and-purees'],
      ['Sopa y caldo', 'broths-and-soups'],
      // Tomate frito is most of it, and that is a tomato sauce.
      ['Tomate', 'tomato-and-pasta-sauces'],
    ],
  },
  {
    name: 'Cuidado del cabello',
    slug: NO_LEAF,
    children: [
      ['Acondicionador y mascarilla', 'conditioners-and-masks'],
      ['Champú', 'shampoo'],
      ['Coloración cabello', 'dyes'],
      ['Fijación cabello', 'foams-and-fixers'],
    ],
  },
  {
    name: 'Cuidado facial y corporal',
    slug: NO_LEAF,
    children: [
      ['Afeitado y cuidado para hombre', 'shaving'],
      ['Cuidado corporal', 'body-and-hand-hydration'],
      ['Cuidado e higiene facial', 'facial-care'],
      ['Depilación', 'hair-removal'],
      ['Desodorante', 'deodorants'],
      ['Gel y jabón de manos', 'shower-gel-and-sponges'],
      ['Higiene bucal', 'oral-hygiene'],
      ['Higiene íntima', 'sanitary-pads-and-feminine-hygiene'],
      // Mercadona files nails with body care. The leaf is under `makeup`.
      ['Manicura y pedicura', 'nail-care'],
      ['Protector solar y aftersun', 'sunscreen'],
    ],
  },
  {
    name: 'Fitoterapia y parafarmacia',
    slug: 'parapharmacy',
    children: [
      ['Fitoterapia', 'nutritional-supplements'],
      ['Parafarmacia', 'parapharmacy'],
    ],
  },
  {
    name: 'Fruta y verdura',
    slug: NO_LEAF,
    children: [
      ['Fruta', 'other-fruits'],
      ['Lechuga y ensalada preparada', 'lettuce-and-leafy-greens'],
      // `vegetables` is a root now, and no leaf under it is vegetables in
      // general. Splitting it needs the level below, which no fixture holds.
      ['Verdura', NO_LEAF],
    ],
  },
  {
    name: 'Huevos, leche y mantequilla',
    slug: NO_LEAF,
    children: [
      ['Huevos', 'eggs'],
      // Milk and plant drinks share one Mercadona aisle. Milk is most of it,
      // and splitting the rest needs the level below, which no fixture holds.
      ['Leche y bebidas vegetales', 'milk'],
      ['Mantequilla y margarina', 'butter-and-margarine'],
      ['Nata', 'cream'],
    ],
  },
  {
    name: 'Limpieza y hogar',
    slug: NO_LEAF,
    children: [
      ['Bolsas', 'batteries-kitchenware-and-bags'],
      ['Detergente y suavizante ropa', 'detergents'],
      ['Estropajo, bayeta y guantes', 'scouring-pads-cloths-and-gloves'],
      ['Lejía y líquidos fuertes', 'bleach-and-disinfectants'],
      ['Limpiahogar y friegasuelos', 'cleaning-floors-windows-and-furniture'],
      ['Limpieza baño y WC', 'bathroom-and-toilet-cleaning'],
      ['Limpieza cocina', 'kitchen-cleaning-and-degreasing'],
      ['Limpieza vajilla', 'dishwasher'],
      ['Menaje y conservación de alimentos', 'film-aluminum-and-preservation'],
      // Foil and cling film, the two `size_format: 'm'` products.
      ['Papel de cocina y film', 'film-aluminum-and-preservation'],
      ['Papel higiénico y celulosa', 'toilet-paper-kitchen-paper-and-napkins'],
      ['Pilas y bolsas de basura', 'garbage-bags-brooms-and-mops'],
      ['Utensilios de limpieza y calzado', 'garbage-bags-brooms-and-mops'],
    ],
  },
  {
    // The make-up leaves are ours (plan 0179): DIA's tree had none. The
    // section spans all of them, so on its own it still answers no leaf.
    name: 'Maquillaje',
    slug: NO_LEAF,
    children: [
      ['Bases de maquillaje y corrector', 'face-makeup'],
      ['Colorete y polvos', 'powders-and-blush'],
      ['Labios', 'lip-makeup'],
      ['Ojos', 'eye-makeup'],
    ],
  },
  {
    name: 'Marisco y pescado',
    slug: NO_LEAF,
    children: [
      ['Marisco', 'seafood-shrimp-and-squid'],
      ['Pescado fresco', 'fish-and-seafood-fresh'],
      ['Salazones y ahumados', 'smoked-and-salted'],
    ],
  },
  {
    // Cats and dogs only: the taxonomy has no leaf for any other animal.
    name: 'Mascotas',
    slug: NO_LEAF,
    children: [
      ['Gato', 'dry-cat-food'],
      ['Perro', 'dry-dog-food'],
    ],
  },
  {
    name: 'Panadería y pastelería',
    slug: NO_LEAF,
    children: [
      ['Bollería de horno', 'sweet-baked-goods'],
      ['Bollería envasada', 'muffins-and-classic-pastries'],
      ['Harina y preparado repostería', 'flours-and-yeasts'],
      ['Pan de horno', 'freshly-baked-bread'],
      ['Pan de molde y otras especialidades', 'sliced-and-specialty-breads'],
      ['Pan tostado y rallado', 'breadcrumbs-toasted-bread-and-breadsticks'],
      [
        'Picos, rosquilletas y picatostes',
        'breadcrumbs-toasted-bread-and-breadsticks',
      ],
      ['Tartas y pasteles', 'pastries-cakes-and-sugar-cakes'],
    ],
  },
  {
    name: 'Pizzas y platos preparados',
    slug: NO_LEAF,
    children: [
      ['Listo para Comer', 'ready-to-eat-dishes'],
      ['Pizzas', 'refrigerated-pizzas'],
      ['Platos preparados calientes', 'traditional-food'],
      ['Platos preparados fríos', 'salads-and-bowls'],
    ],
  },
  {
    name: 'Postres y yogures',
    slug: NO_LEAF,
    children: [
      ['Bífidus', 'bifidus-yoghurts-and-cholesterol'],
      ['Flan y natillas', 'custard-flan-and-rice-pudding'],
      ['Gelatina y otros postres', 'gelatins-and-curds'],
      ['Postres de soja', 'kefir-and-plant-based-desserts'],
      ['Yogures desnatados', 'natural-and-skimmed-yogurts'],
      ['Yogures griegos', 'greek-yogurts'],
      ['Yogures líquidos', 'liquid-yogurts'],
      ['Yogures naturales y sabores', 'flavoured-and-fruit-yoghurts'],
      ['Yogures y postres infantiles', 'yogurts-and-children-s-desserts'],
    ],
  },
  {
    name: 'Zumos',
    slug: NO_LEAF,
    children: [
      ['Fruta variada', 'multifruit-and-other-flavors'],
      ['Melocotón y piña', 'peach-and-pineapple'],
      ['Naranja', 'orange'],
      ['Tomate y otros sabores', 'multifruit-and-other-flavors'],
    ],
  },
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

/**
 * What the cheese override answers. One slug for all three ids, so it is the
 * leaf the widest of them lands on by name (`Queso curado, semicurado y
 * tierno`). The harvester resolves bare names, which reach each child's own
 * leaf through the table above.
 */
const CHEESE = 'semi-cured';

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
