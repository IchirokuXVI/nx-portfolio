import { MigrationInterface, QueryRunner } from 'typeorm';
import { categoryId } from '../taxonomy/ids';
import { LANDING_LEAVES, ROOTS } from './1758100000000-CategoryTree';

/**
 * DIA's category tree replaces the first one (plan 0173, section 4).
 *
 * No table, index or trigger changes: this migration moves rows. It leaves a
 * database holding exactly the tree of appendix A, whether it starts from the
 * twenty nine rows `CategoryTree1758100000000` inserted or from the whole first
 * tree the reference seed added on top of them, with every product and every
 * shop section moved by appendix C.
 *
 * **A slug is an id** (`categoryId`), so a slug the two trees share is one row,
 * updated in place: `fish-and-seafood`, `bakery`, `pets`, `other`,
 * `uncategorised`, `pork`, `milk`, `eggs`, `cereals`, `water`, and
 * `vegetables`, which is a leaf holding products in the first tree and a root
 * in this one.
 *
 * ## Up, in the order the triggers allow
 *
 * The plan lists four steps: write the tree, move the products, move the
 * sections, delete what is left. They cannot run in that order as written. A
 * product on `frozen-vegetables` moves to a leaf under the root `vegetables`,
 * that leaf cannot be inserted until `vegetables` is a root, and R2 refuses to
 * make `vegetables` a root while it holds products. So the moves are split in
 * two, a lift before the tree is written and a landing after it:
 *
 * 1. **Lift.** Work out, into two temporary tables, where every product and
 *    every section that names a moved row ends up, and delete their current
 *    rows. A product is lifted whole: all its categories are mapped, a category
 *    it then holds twice keeps its first position, and its positions are
 *    renumbered from 0. A section loses only the rows that move.
 * 2. **Write the tree**, roots and then leaves, each
 *    `ON CONFLICT ("id") DO UPDATE` of the parent, the name and the position.
 *    Nothing holds a product on `vegetables` any more, so it turns into a root
 *    with the others and needs no place of its own in the order.
 * 3. **Land** the products and the sections on their new rows. The sections go
 *    in with `ON CONFLICT DO NOTHING`, which is the deduplication: two rows of
 *    one section that map to the same category become one.
 * 4. **Delete every row appendix A does not name**, leaves first, then roots.
 *
 * ## What step 4 does to a row added by hand
 *
 * It is deleted with the first tree, when it is empty. When it still holds a
 * product or a section, appendix C has no entry for it, nothing moved them, and
 * `ON DELETE RESTRICT` (R4) refuses the delete: the migration fails whole and
 * changes nothing. That is the check the plan asks for, and the answer is to
 * move those products in the back office and run it again. A row added by hand
 * under a slug appendix A uses fails earlier, on `uq_categories_slug`, for the
 * same reason and with the same remedy.
 *
 * ## A section that covered the leaf `vegetables`
 *
 * It follows appendix C like every other leaf and covers `uncategorised`
 * afterwards. Leaving the row alone would have turned it into the root
 * Verduras, since the id is the same, and a section that covered the root
 * `fruit-and-vegetables` lands on that root by `ROOT_REMAP` anyway.
 *
 * ## Down
 *
 * **Restores the shape `CategoryTree1758100000000` left, not each product's
 * category.** Its seventeen roots and twelve landing leaves come back with
 * their names and positions, every other row goes, and every product lands on
 * the landing leaf of the first tree root its DIA root came closest to
 * (`DIA_ROOT_TO_FIRST_ROOT`). Five of those roots never had a landing leaf
 * (`cold-cuts-and-cheese`, `breakfast-and-sweets`, `ready-meals`, `baby` and
 * `pets`), and a product under one of them lands on `uncategorised`, as does a
 * product on a leaf whose root this file does not know. A section follows the
 * same table: a root to its first tree root, a leaf to that landing leaf. The
 * down path is for a broken deploy, not for a round trip.
 */
export class DiaCategoryTree1758500000000 implements MigrationInterface {
  name = 'DiaCategoryTree1758500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const roots = DIA_CATEGORY_TREE.map((root, position) => ({
      id: categoryId(root.slug),
      parentId: null as string | null,
      slug: root.slug,
      name: root.name,
      position,
    }));
    const leaves = DIA_CATEGORY_TREE.flatMap((root) =>
      root.children.map((leaf, position) => ({
        id: categoryId(leaf.slug),
        parentId: categoryId(root.slug) as string | null,
        slug: leaf.slug,
        name: leaf.name,
        position,
      }))
    );
    const kept = [...roots, ...leaves].map((row) => row.id);

    // A row that maps to itself does not move, and is left out of both maps.
    const moves = (map: Record<string, string>): [string, string][] =>
      Object.entries(map)
        .filter(([from, to]) => from !== to)
        .map(([from, to]) => [categoryId(from), categoryId(to)]);
    const leafMoves = moves(LEAF_REMAP);
    const sectionMoves = [...moves(ROOT_REMAP), ...leafMoves];

    // --- 1. Lift the products and the sections off the rows that move -------
    await createScratchTables(queryRunner);
    await queryRunner.query(
      `INSERT INTO "${ITEM_SCRATCH}" ("itemId", "categoryId", "position")
       WITH "map" AS (
         SELECT * FROM unnest($1::uuid[], $2::uuid[]) AS m("from", "to")
       ),
       "moved" AS (
         SELECT DISTINCT ic."itemId"
           FROM "item_categories" ic
           JOIN "map" m ON m."from" = ic."categoryId"
       ),
       "target" AS (
         SELECT ic."itemId",
                COALESCE(m."to", ic."categoryId") AS "categoryId",
                MIN(ic."position") AS "first"
           FROM "item_categories" ic
           JOIN "moved" USING ("itemId")
           LEFT JOIN "map" m ON m."from" = ic."categoryId"
          GROUP BY 1, 2
       )
       SELECT "itemId",
              "categoryId",
              ROW_NUMBER() OVER (PARTITION BY "itemId" ORDER BY "first") - 1
         FROM "target"`,
      [leafMoves.map(([from]) => from), leafMoves.map(([, to]) => to)]
    );
    await queryRunner.query(
      `DELETE FROM "item_categories" ic
        WHERE ic."itemId" IN (SELECT "itemId" FROM "${ITEM_SCRATCH}")`
    );
    await queryRunner.query(
      `INSERT INTO "${SECTION_SCRATCH}" ("sectionId", "categoryId")
       SELECT DISTINCT sc."sectionId", m."to"
         FROM "section_categories" sc
         JOIN unnest($1::uuid[], $2::uuid[]) AS m("from", "to")
           ON m."from" = sc."categoryId"`,
      [sectionMoves.map(([from]) => from), sectionMoves.map(([, to]) => to)]
    );
    await queryRunner.query(
      `DELETE FROM "section_categories" WHERE "categoryId" = ANY($1::uuid[])`,
      [sectionMoves.map(([from]) => from)]
    );

    // --- 2. The tree of appendix A, roots first -----------------------------
    for (const row of [...roots, ...leaves]) {
      await queryRunner.query(
        `INSERT INTO "categories" ("id", "parentId", "slug", "name", "position")
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT ("id") DO UPDATE
           SET "parentId" = EXCLUDED."parentId",
               "name" = EXCLUDED."name",
               "position" = EXCLUDED."position",
               "updatedAt" = now()`,
        [row.id, row.parentId, row.slug, JSON.stringify(row.name), row.position]
      );
    }

    // --- 3. Land them --------------------------------------------------------
    await landScratchTables(queryRunner);

    // --- 4. Every row appendix A does not name, leaves first ----------------
    await queryRunner.query(
      `DELETE FROM "categories"
        WHERE "parentId" IS NOT NULL AND "id" <> ALL($1::uuid[])`,
      [kept]
    );
    await queryRunner.query(
      `DELETE FROM "categories"
        WHERE "parentId" IS NULL AND "id" <> ALL($1::uuid[])`,
      [kept]
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const uncategorised = categoryId(UNCATEGORISED);
    const landingLeafOf = new Map(
      LANDING_LEAVES.map((leaf) => [leaf.root, leaf.slug])
    );
    // Each DIA root, the first tree root it goes back to, and the leaf a
    // product under it lands on.
    const back = Object.entries(DIA_ROOT_TO_FIRST_ROOT).map(
      ([diaRoot, firstRoot]) => ({
        from: categoryId(diaRoot),
        root: categoryId(firstRoot),
        leaf: categoryId(landingLeafOf.get(firstRoot) ?? UNCATEGORISED),
      })
    );
    const backArrays = [
      back.map((row) => row.from),
      back.map((row) => row.root),
      back.map((row) => row.leaf),
    ];
    const kept = [
      ...ROOTS.map((root) => categoryId(root.slug)),
      ...LANDING_LEAVES.map((leaf) => categoryId(leaf.slug)),
    ];

    // --- 1. Lift every product and every section ----------------------------
    await createScratchTables(queryRunner);
    await queryRunner.query(
      `INSERT INTO "${ITEM_SCRATCH}" ("itemId", "categoryId", "position")
       WITH "target" AS (
         SELECT ic."itemId",
                COALESCE(b."leaf", $4::uuid) AS "categoryId",
                MIN(ic."position") AS "first"
           FROM "item_categories" ic
           JOIN "categories" c ON c."id" = ic."categoryId"
           LEFT JOIN unnest($1::uuid[], $2::uuid[], $3::uuid[])
                  AS b("from", "root", "leaf") ON b."from" = c."parentId"
          GROUP BY 1, 2
       )
       SELECT "itemId",
              "categoryId",
              ROW_NUMBER() OVER (PARTITION BY "itemId" ORDER BY "first") - 1
         FROM "target"`,
      [...backArrays, uncategorised]
    );
    await queryRunner.query(`DELETE FROM "item_categories"`);
    // A section on a root goes to that root's first tree root, and one on a
    // leaf to the landing leaf its products went to. A root this file does not
    // know goes to `other`.
    await queryRunner.query(
      `INSERT INTO "${SECTION_SCRATCH}" ("sectionId", "categoryId")
       SELECT DISTINCT sc."sectionId",
              CASE WHEN c."parentId" IS NULL
                   THEN COALESCE(b."root", $5::uuid)
                   ELSE COALESCE(b."leaf", $4::uuid)
              END
         FROM "section_categories" sc
         JOIN "categories" c ON c."id" = sc."categoryId"
         LEFT JOIN unnest($1::uuid[], $2::uuid[], $3::uuid[])
                AS b("from", "root", "leaf")
           ON b."from" = COALESCE(c."parentId", c."id")`,
      [...backArrays, uncategorised, categoryId(OTHER)]
    );
    await queryRunner.query(`DELETE FROM "section_categories"`);

    // --- 2. The rows the first migration inserted, as it inserted them ------
    for (const [position, root] of ROOTS.entries()) {
      await queryRunner.query(
        `INSERT INTO "categories" ("id", "parentId", "slug", "name", "position")
         VALUES ($1, NULL, $2, $3::jsonb, $4)
         ON CONFLICT ("id") DO UPDATE
           SET "parentId" = NULL,
               "name" = EXCLUDED."name",
               "position" = EXCLUDED."position",
               "updatedAt" = now()`,
        [categoryId(root.slug), root.slug, JSON.stringify(root.name), position]
      );
    }
    for (const leaf of LANDING_LEAVES) {
      await queryRunner.query(
        `INSERT INTO "categories" ("id", "parentId", "slug", "name", "position")
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT ("id") DO UPDATE
           SET "parentId" = EXCLUDED."parentId",
               "name" = EXCLUDED."name",
               "position" = EXCLUDED."position",
               "updatedAt" = now()`,
        [
          categoryId(leaf.slug),
          categoryId(leaf.root),
          leaf.slug,
          JSON.stringify(leaf.name),
          leaf.position,
        ]
      );
    }

    // --- 3. Land them --------------------------------------------------------
    await landScratchTables(queryRunner);

    // --- 4. Every other row, leaves first -----------------------------------
    await queryRunner.query(
      `DELETE FROM "categories"
        WHERE "parentId" IS NOT NULL AND "id" <> ALL($1::uuid[])`,
      [kept]
    );
    await queryRunner.query(
      `DELETE FROM "categories"
        WHERE "parentId" IS NULL AND "id" <> ALL($1::uuid[])`,
      [kept]
    );
  }
}

const UNCATEGORISED = 'uncategorised';
const OTHER = 'other';

/**
 * Where the lifted rows wait while the tree is rewritten under them. Temporary
 * tables, so they carry no trigger and no foreign key, and dropped by hand
 * rather than `ON COMMIT DROP` so the migration does not depend on which
 * transaction mode runs it.
 */
const ITEM_SCRATCH = 'dia_tree_item_categories';
const SECTION_SCRATCH = 'dia_tree_section_categories';

async function createScratchTables(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`DROP TABLE IF EXISTS "${ITEM_SCRATCH}"`);
  await queryRunner.query(`DROP TABLE IF EXISTS "${SECTION_SCRATCH}"`);
  await queryRunner.query(
    `CREATE TEMPORARY TABLE "${ITEM_SCRATCH}" (
       "itemId" uuid NOT NULL,
       "categoryId" uuid NOT NULL,
       "position" smallint NOT NULL
     )`
  );
  await queryRunner.query(
    `CREATE TEMPORARY TABLE "${SECTION_SCRATCH}" (
       "sectionId" uuid NOT NULL,
       "categoryId" uuid NOT NULL
     )`
  );
}

/** Writes the lifted rows back, onto rows that now exist, and drops the tables. */
async function landScratchTables(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(
    `INSERT INTO "item_categories" ("itemId", "categoryId", "position")
     SELECT "itemId", "categoryId", "position" FROM "${ITEM_SCRATCH}"`
  );
  await queryRunner.query(
    `INSERT INTO "section_categories" ("sectionId", "categoryId")
     SELECT "sectionId", "categoryId" FROM "${SECTION_SCRATCH}"
     ON CONFLICT DO NOTHING`
  );
  await queryRunner.query(`DROP TABLE "${ITEM_SCRATCH}"`);
  await queryRunner.query(`DROP TABLE "${SECTION_SCRATCH}"`);
}

/**
 * The tree of appendix A, in the order it is shown: twenty nine roots and two
 * hundred and forty six leaves. A row's position is its index among its
 * siblings, and its id is `categoryId(slug)`.
 *
 * Frozen here, as a migration's data has to be. `db/reference/categories.ts`
 * is the living copy, and `reference-catalog.spec.ts` asserts the two agree.
 */
export const DIA_CATEGORY_TREE: {
  slug: string;
  name: { en: string; es: string };
  children: { slug: string; name: { en: string; es: string } }[];
}[] = [
  {
    slug: 'fruits',
    name: { en: 'Fruits', es: 'Frutas' },
    children: [
      {
        slug: 'bananas-and-plantains',
        name: { en: 'Bananas and plantains', es: 'Plátanos y bananas' },
      },
      {
        slug: 'apples-and-pears',
        name: { en: 'Apples and pears', es: 'Manzanas y peras' },
      },
      {
        slug: 'oranges-tangerines-and-lemons',
        name: {
          en: 'Oranges, tangerines, and lemons',
          es: 'Naranjas, mandarinas y limones',
        },
      },
      {
        slug: 'melon-and-watermelon',
        name: { en: 'Melon and watermelon', es: 'Melón y sandía' },
      },
      { slug: 'grapes', name: { en: 'Grapes', es: 'Uvas' } },
      {
        slug: 'tropical-fruits',
        name: { en: 'Tropical fruits', es: 'Frutas tropicales' },
      },
      {
        slug: 'red-and-forest-fruits',
        name: { en: 'Red and forest fruits', es: 'Frutos rojos y del bosque' },
      },
      {
        slug: 'frozen-fruits',
        name: { en: 'Frozen fruits', es: 'Frutas congeladas' },
      },
      {
        slug: 'other-fruits',
        name: { en: 'Other fruits', es: 'Otras frutas' },
      },
    ],
  },
  {
    slug: 'vegetables',
    name: { en: 'Vegetables', es: 'Verduras' },
    children: [
      {
        slug: 'lettuce-and-leafy-greens',
        name: { en: 'Lettuce and leafy greens', es: 'Lechugas y hojas verdes' },
      },
      {
        slug: 'tomatoes-peppers-and-cucumbers',
        name: {
          en: 'Tomatoes, peppers and cucumbers',
          es: 'Tomates, pimientos y pepinos',
        },
      },
      {
        slug: 'garlic-onions-and-leeks',
        name: {
          en: 'Garlic, onions and leeks',
          es: 'Ajos, cebollas y puerros',
        },
      },
      {
        slug: 'courgette-pumpkin-and-aubergine',
        name: {
          en: 'Courgette, pumpkin and aubergine',
          es: 'Calabacín, calabaza y berenjena',
        },
      },
      {
        slug: 'potatoes-and-carrots',
        name: { en: 'Potatoes and carrots', es: 'Patatas y zanahorias' },
      },
      {
        slug: 'broccoli-cauliflower-and-green-beans',
        name: {
          en: 'Broccoli, cauliflower, and green beans',
          es: 'Brócoli, coliflor y judías verdes',
        },
      },
      {
        slug: 'mushrooms',
        name: { en: 'Mushrooms', es: 'Setas y champiñones' },
      },
      {
        slug: 'aromatic-herbs',
        name: { en: 'Aromatic herbs', es: 'Hierbas aromáticas' },
      },
      {
        slug: 'salads-and-prepared-vegetables',
        name: {
          en: 'Salads and prepared vegetables',
          es: 'Ensaladas y verduras preparadas',
        },
      },
      {
        slug: 'frozen-and-steamed-vegetables',
        name: {
          en: 'Frozen and steamed vegetables',
          es: 'Verduras congeladas y al vapor',
        },
      },
      {
        slug: 'vegetables-canned-vegetables',
        name: { en: 'Canned vegetables', es: 'Conservas de verduras' },
      },
    ],
  },
  {
    slug: 'meats',
    name: { en: 'Meats', es: 'Carnes' },
    children: [
      { slug: 'chicken', name: { en: 'Chicken', es: 'Pollo' } },
      { slug: 'beef', name: { en: 'Beef', es: 'Vacuno' } },
      { slug: 'pork', name: { en: 'Pork', es: 'Cerdo' } },
      { slug: 'turkey', name: { en: 'Turkey', es: 'Pavo' } },
      { slug: 'rabbit', name: { en: 'Rabbit', es: 'Conejo' } },
      {
        slug: 'hamburgers-ground-beef-and-meatballs',
        name: {
          en: 'Hamburgers, ground beef, and meatballs',
          es: 'Hamburguesas, carne picada y albóndigas',
        },
      },
      {
        slug: 'breaded-and-prepared-foods',
        name: {
          en: 'Breaded and prepared foods',
          es: 'Empanados y elaborados',
        },
      },
      {
        slug: 'cuts-and-cuts',
        name: { en: 'Cuts and cuts', es: 'Arreglos y despieces' },
      },
    ],
  },
  {
    slug: 'fish-and-seafood',
    name: { en: 'Fish and seafood', es: 'Pescados y mariscos' },
    children: [
      { slug: 'fish-and-seafood-fresh', name: { en: 'Fresh', es: 'Fresco' } },
      {
        slug: 'fish-and-seafood-frozen',
        name: { en: 'Frozen', es: 'Congelado' },
      },
      { slug: 'breaded', name: { en: 'Breaded', es: 'Rebozado' } },
      {
        slug: 'seafood-shrimp-and-squid',
        name: {
          en: 'Seafood, shrimp and squid',
          es: 'Marisco, gamba y calamar',
        },
      },
      {
        slug: 'smoked-and-salted',
        name: { en: 'Smoked and salted', es: 'Ahumado y salazón' },
      },
      {
        slug: 'surimi-and-prepared-products',
        name: { en: 'Surimi and prepared products', es: 'Surimi y elaborados' },
      },
    ],
  },
  {
    slug: 'charcuterie',
    name: { en: 'Charcuterie', es: 'Charcutería' },
    children: [
      { slug: 'cooked-ham', name: { en: 'Cooked ham', es: 'Jamón cocido' } },
      {
        slug: 'turkey-and-chicken',
        name: { en: 'Turkey and chicken', es: 'Pavo y pollo' },
      },
      { slug: 'serrano-ham', name: { en: 'Serrano ham', es: 'Jamón serrano' } },
      {
        slug: 'loin-and-chorizo',
        name: { en: 'Loin and chorizo', es: 'Lomo y chorizo' },
      },
      {
        slug: 'fuet-and-salchichon',
        name: { en: 'Fuet and salchichón', es: 'Fuet y salchichón' },
      },
      {
        slug: 'chopped-and-mortadella',
        name: { en: 'Chopped and mortadella', es: 'Chopped y mortadela' },
      },
      { slug: 'sausages', name: { en: 'Sausages', es: 'Salchichas' } },
      { slug: 'bacon', name: { en: 'Bacon', es: 'Bacon' } },
      {
        slug: 'pate-and-sobrasada',
        name: { en: 'Pâté and sobrasada', es: 'Paté y sobrasada' },
      },
    ],
  },
  {
    slug: 'cheeses',
    name: { en: 'Cheeses', es: 'Quesos' },
    children: [
      { slug: 'cured', name: { en: 'Cured', es: 'Curado' } },
      { slug: 'semi-cured', name: { en: 'Semi-cured', es: 'Semicurado' } },
      { slug: 'young-mild', name: { en: 'Young/Mild', es: 'Tierno' } },
      { slug: 'cheeses-fresh', name: { en: 'Fresh', es: 'Fresco' } },
      {
        slug: 'specialties',
        name: { en: 'Specialties', es: 'Especialidades' },
      },
      {
        slug: 'blue-and-goat-cheese',
        name: { en: 'Blue and goat cheese', es: 'Azul y de cabra' },
      },
      { slug: 'sliced', name: { en: 'Sliced', es: 'En lonchas' } },
      {
        slug: 'shredded-grated',
        name: { en: 'Shredded/Grated', es: 'Rallado' },
      },
      {
        slug: 'spreadable-and-portions',
        name: { en: 'Spreadable and portions', es: 'Untable y en porciones' },
      },
    ],
  },
  {
    slug: 'eggs-milk-and-butter',
    name: { en: 'Eggs, milk, and butter', es: 'Huevos, leche y mantequilla' },
    children: [
      { slug: 'eggs', name: { en: 'Eggs', es: 'Huevos' } },
      { slug: 'milk', name: { en: 'Milk', es: 'Leche' } },
      {
        slug: 'lactose-free-and-fortified-milk',
        name: {
          en: 'Lactose-free and fortified milk',
          es: 'Leche sin lactosa y enriquecidas',
        },
      },
      {
        slug: 'plant-based-drinks-and-horchata',
        name: {
          en: 'Plant-based drinks and horchata',
          es: 'Bebidas vegetales y horchatas',
        },
      },
      {
        slug: 'infant-formula',
        name: { en: 'Infant formula', es: 'Leche infantil' },
      },
      { slug: 'milkshakes', name: { en: 'Milkshakes', es: 'Batidos' } },
      {
        slug: 'condensed-and-evaporated-milk',
        name: {
          en: 'Condensed and evaporated milk',
          es: 'Leche condensada y evaporada',
        },
      },
      {
        slug: 'butter-and-margarine',
        name: { en: 'Butter and margarine', es: 'Mantequilla y margarina' },
      },
      { slug: 'cream', name: { en: 'Cream', es: 'Nata' } },
    ],
  },
  {
    slug: 'bakery',
    name: { en: 'Bakery', es: 'Panadería' },
    children: [
      {
        slug: 'freshly-baked-bread',
        name: { en: 'Freshly baked bread', es: 'Pan recién horneado' },
      },
      {
        slug: 'sliced-and-specialty-breads',
        name: {
          en: 'Sliced and specialty breads',
          es: 'Pan de molde y especiales',
        },
      },
      {
        slug: 'hamburger-and-hot-dog-buns',
        name: {
          en: 'Hamburger and hot dog buns',
          es: 'Pan para hamburguesas y perritos',
        },
      },
      {
        slug: 'wheat-tortillas-and-pita-bread',
        name: {
          en: 'Wheat tortillas and pita bread',
          es: 'Tortillas de trigo y pitas',
        },
      },
      {
        slug: 'gluten-free-bread',
        name: { en: 'Gluten-free bread', es: 'Pan sin gluten' },
      },
      {
        slug: 'breadcrumbs-toasted-bread-and-breadsticks',
        name: {
          en: 'Breadcrumbs, toasted bread, and breadsticks',
          es: 'Pan rallado, tostado y picos',
        },
      },
      { slug: 'oven', name: { en: 'Oven', es: 'Horno' } },
      {
        slug: 'doughs-and-pastries',
        name: { en: 'Doughs and pastries', es: 'Masas y hojaldres' },
      },
    ],
  },
  {
    slug: 'yoghurts-and-desserts',
    name: { en: 'Yoghurts and desserts', es: 'Yogures y postres' },
    children: [
      {
        slug: 'natural-and-skimmed-yogurts',
        name: {
          en: 'Natural and skimmed yogurts',
          es: 'Yogures naturales y desnatados',
        },
      },
      {
        slug: 'flavoured-and-fruit-yoghurts',
        name: {
          en: 'Flavoured and fruit yoghurts',
          es: 'Yogures de sabores y frutas',
        },
      },
      {
        slug: 'greek-yogurts',
        name: { en: 'Greek yogurts', es: 'Yogures griegos' },
      },
      {
        slug: 'liquid-yogurts',
        name: { en: 'Liquid yogurts', es: 'Yogures líquidos' },
      },
      {
        slug: 'bifidus-yoghurts-and-cholesterol',
        name: {
          en: 'Bifidus yoghurts and cholesterol',
          es: 'Yogures bífidus y colesterol',
        },
      },
      {
        slug: 'kefir-and-plant-based-desserts',
        name: {
          en: 'Kefir and plant-based desserts',
          es: 'Kéfir y postres vegetales',
        },
      },
      {
        slug: 'protein-desserts-and-yogurts',
        name: {
          en: 'Desserts and protein shakes',
          es: 'Postres y batidos de proteínas',
        },
      },
      {
        slug: 'yogurts-and-children-s-desserts',
        name: {
          en: "Yogurts and children's desserts",
          es: 'Yogures y postres infantiles',
        },
      },
      {
        slug: 'traditional-desserts',
        name: { en: 'Traditional desserts', es: 'Postres tradicionales' },
      },
      {
        slug: 'custard-flan-and-rice-pudding',
        name: {
          en: 'Custard, flan, and rice pudding',
          es: 'Natillas, flan y arroz con leche',
        },
      },
      {
        slug: 'gelatins-and-curds',
        name: { en: 'Gelatins and curds', es: 'Gelatinas y cuajadas' },
      },
    ],
  },
  {
    slug: 'frozen-foods-and-ice-cream',
    name: { en: 'Frozen foods and ice cream', es: 'Congelados y helados' },
    children: [
      {
        slug: 'pizzas-and-doughs',
        name: { en: 'Pizzas and doughs', es: 'Pizzas y masas' },
      },
      {
        slug: 'croquettes-and-batters',
        name: { en: 'Croquettes and batters', es: 'Croquetas y rebozados' },
      },
      {
        slug: 'frozen-foods-and-ice-cream-fish-and-seafood',
        name: { en: 'Fish and seafood', es: 'Pescado y marisco' },
      },
      {
        slug: 'vegetables-and-potatoes',
        name: { en: 'Vegetables and potatoes', es: 'Verduras y patatas' },
      },
      {
        slug: 'rice-and-pasta',
        name: { en: 'Rice and pasta', es: 'Arroces y pasta' },
      },
      {
        slug: 'ice-creams-and-ice',
        name: { en: 'Ice creams and ice', es: 'Helados y hielo' },
      },
      {
        slug: 'cakes-and-churros',
        name: { en: 'Cakes and churros', es: 'Tartas y churros' },
      },
    ],
  },
  {
    slug: 'rice-pasta-and-pulses',
    name: { en: 'Rice, pasta and pulses', es: 'Arroz, pastas y legumbres' },
    children: [
      { slug: 'rice', name: { en: 'Rice', es: 'Arroz' } },
      {
        slug: 'rice-pasta-and-pulses-fideos',
        name: { en: 'Noodles', es: 'Fideos' },
      },
      {
        slug: 'macaroni-spaghetti-and-dried-pasta',
        name: {
          en: 'Macaroni, spaghetti, and dried pasta',
          es: 'Macarrones, espaguetis y pastas secas',
        },
      },
      {
        slug: 'filled-and-sauced-pasta',
        name: {
          en: 'Filled and Sauced Pasta',
          es: 'Pastas rellenas y en salsa',
        },
      },
      {
        slug: 'lasagna-and-cannelloni',
        name: { en: 'Lasagna and cannelloni', es: 'Lasaña y canelones' },
      },
      {
        slug: 'pasta-sauces',
        name: { en: 'Pasta sauces', es: 'Salsas para pasta' },
      },
      {
        slug: 'rice-pasta-and-pulses-noodles',
        name: { en: 'Noodles', es: 'Noodles' },
      },
      {
        slug: 'gluten-free-pasta',
        name: { en: 'Gluten-free pasta', es: 'Pastas sin gluten' },
      },
      {
        slug: 'chickpeas-and-beans',
        name: { en: 'Chickpeas and beans', es: 'Garbanzos y alubias' },
      },
      { slug: 'lentils', name: { en: 'Lentils', es: 'Lentejas' } },
      {
        slug: 'quinoa-couscous-and-soy',
        name: {
          en: 'Quinoa, couscous, and soy',
          es: 'Quinoa, couscous y soja',
        },
      },
    ],
  },
  {
    slug: 'oils-sauces-and-spices',
    name: { en: 'Oils, sauces and spices', es: 'Aceites, salsas y especias' },
    children: [
      { slug: 'oils', name: { en: 'Oils', es: 'Aceites' } },
      {
        slug: 'vinegars-and-dressings',
        name: { en: 'Vinegars and dressings', es: 'Vinagres y aliños' },
      },
      {
        slug: 'garlic-salt-and-pepper',
        name: { en: 'Garlic, salt, and pepper', es: 'Ajo, sal y pimienta' },
      },
      {
        slug: 'spices-and-herbs',
        name: { en: 'Spices and herbs', es: 'Especias y hierbas' },
      },
      { slug: 'seasonings', name: { en: 'Seasonings', es: 'Sazonadores' } },
      {
        slug: 'tomato-and-pasta-sauces',
        name: { en: 'Tomato and pasta sauces', es: 'Salsas de tomate y pasta' },
      },
      {
        slug: 'special-and-spicy-sauces',
        name: {
          en: 'Special and spicy sauces',
          es: 'Salsas especiales y picantes',
        },
      },
      {
        slug: 'ketchup-mayonnaise-and-mustard',
        name: {
          en: 'Ketchup, mayonnaise, and mustard',
          es: 'Ketchup, mayonesa y mostaza',
        },
      },
    ],
  },
  {
    slug: 'canned-food-broths-and-creams',
    name: {
      en: 'Canned food, broths and creams',
      es: 'Conservas, caldos y cremas',
    },
    children: [
      {
        slug: 'tuna-and-bonito',
        name: { en: 'Tuna and bonito', es: 'Atún y bonito' },
      },
      {
        slug: 'mackerel-and-sardines',
        name: { en: 'Mackerel and sardines', es: 'Caballa y sardinas' },
      },
      {
        slug: 'mussels-cockles-and-fish',
        name: {
          en: 'Mussels, cockles, and fish',
          es: 'Mejillones, berberechos y pescado',
        },
      },
      { slug: 'pates', name: { en: 'Pâtés', es: 'Patés' } },
      {
        slug: 'canned-food-broths-and-creams-canned-vegetables',
        name: { en: 'Canned vegetables', es: 'Conservas de verdura' },
      },
      {
        slug: 'canned-fruit',
        name: { en: 'Canned fruit', es: 'Conservas de fruta' },
      },
      {
        slug: 'creams-and-purees',
        name: { en: 'Creams and purées', es: 'Cremas y purés' },
      },
      {
        slug: 'broths-and-soups',
        name: { en: 'Broths and soups', es: 'Caldos y sopas' },
      },
    ],
  },
  {
    slug: 'coffee-cocoa-and-infusions',
    name: { en: 'Coffee, cocoa and infusions', es: 'Café, cacao e infusiones' },
    children: [
      {
        slug: 'compatible-nespresso-capsules',
        name: {
          en: 'Compatible Nespresso capsules',
          es: 'Cápsulas compatibles Nespresso',
        },
      },
      {
        slug: 'compatible-dolce-gusto-capsules',
        name: {
          en: 'Compatible Dolce Gusto capsules',
          es: 'Cápsulas compatibles Dolce Gusto',
        },
      },
      {
        slug: 'other-compatible-capsules',
        name: {
          en: 'Other compatible capsules',
          es: 'Otras cápsulas compatibles',
        },
      },
      {
        slug: 'ground-coffee',
        name: { en: 'Ground coffee', es: 'Café molido' },
      },
      {
        slug: 'instant-coffee',
        name: { en: 'Instant coffee', es: 'Café soluble' },
      },
      {
        slug: 'whole-bean-coffee',
        name: { en: 'Whole bean coffee', es: 'Café en grano' },
      },
      {
        slug: 'cold-brew-coffee',
        name: { en: 'Cold brew coffee', es: 'Cafés fríos' },
      },
      {
        slug: 'cocoa-and-hot-chocolate',
        name: {
          en: 'Cocoa and hot chocolate',
          es: 'Cacao y chocolate a la taza',
        },
      },
      { slug: 'infusions', name: { en: 'Infusions', es: 'Infusiones' } },
      { slug: 'tea', name: { en: 'Tea', es: 'Té' } },
    ],
  },
  {
    slug: 'pastries-cakes-and-sugar',
    name: {
      en: 'Pastries, cakes, and sugar',
      es: 'Bollería, repostería y azúcar',
    },
    children: [
      {
        slug: 'sweet-baked-goods',
        name: { en: 'Sweet baked goods', es: 'Bollería de horno dulce' },
      },
      {
        slug: 'muffins-and-classic-pastries',
        name: {
          en: 'Muffins and classic pastries',
          es: 'Magdalenas y bollería clásica',
        },
      },
      {
        slug: 'doughnuts-and-cakes',
        name: { en: 'Doughnuts and cakes', es: 'Rosquillas y pastelitos' },
      },
      {
        slug: 'pastries-cakes-and-sugar-cakes',
        name: { en: 'Cakes', es: 'Tartas' },
      },
      {
        slug: 'flours-and-yeasts',
        name: { en: 'Flours and yeasts', es: 'Harinas y levaduras' },
      },
      {
        slug: 'dessert-mixes-and-decorations',
        name: {
          en: 'Dessert mixes and decorations',
          es: 'Preparados para postres y decoración',
        },
      },
      {
        slug: 'sugar-honey-and-sweeteners',
        name: {
          en: 'Sugar, honey, and sweeteners',
          es: 'Azúcar, miel y edulcorantes',
        },
      },
    ],
  },
  {
    slug: 'biscuits-cereals-and-jams',
    name: {
      en: 'Biscuits, cereals, and jams',
      es: 'Galletas, cereales y mermeladas',
    },
    children: [
      {
        slug: 'chocolate-and-filled-biscuits',
        name: {
          en: 'Chocolate and filled biscuits',
          es: 'Galletas de chocolate y rellenas',
        },
      },
      {
        slug: 'classic-and-digestive-biscuits',
        name: {
          en: 'Classic and digestive biscuits',
          es: 'Galletas clásicas y digestive',
        },
      },
      {
        slug: 'savory-biscuits-and-crackers',
        name: {
          en: 'Savory biscuits and crackers',
          es: 'Galletas saladas y crackers',
        },
      },
      { slug: 'cereals', name: { en: 'Cereals', es: 'Cereales' } },
      {
        slug: 'whole-grain-cereals-and-muesli',
        name: {
          en: 'Whole grain cereals and muesli',
          es: 'Cereales integrales y muesli',
        },
      },
      {
        slug: 'cereal-and-protein-bars',
        name: {
          en: 'Cereal and protein bars',
          es: 'Barritas de cereales y proteínas',
        },
      },
      {
        slug: 'biscuits-cereals-and-jams-cakes',
        name: { en: 'Cakes', es: 'Tortitas' },
      },
      {
        slug: 'gluten-free-biscuits-cereals-and-pancakes',
        name: {
          en: 'Gluten-free biscuits, cereals, and pancakes',
          es: 'Galletas, cereales y tortitas sin gluten',
        },
      },
      { slug: 'jams', name: { en: 'Jams', es: 'Mermeladas' } },
    ],
  },
  {
    slug: 'chocolates-and-sweets',
    name: { en: 'Chocolates and sweets', es: 'Chocolates y golosinas' },
    children: [
      {
        slug: 'milk-chocolate',
        name: { en: 'Milk chocolate', es: 'Chocolate con leche' },
      },
      {
        slug: 'dark-chocolate',
        name: { en: 'Dark chocolate', es: 'Chocolate negro' },
      },
      {
        slug: 'white-chocolate',
        name: { en: 'White chocolate', es: 'Chocolate blanco' },
      },
      {
        slug: 'chocolates-and-bonbons',
        name: { en: 'Chocolates and bonbons', es: 'Chocolatinas y bombones' },
      },
      {
        slug: 'cocoa-spreads-and-creams',
        name: {
          en: 'Cocoa spreads and creams',
          es: 'Cremas de cacao y de untar',
        },
      },
      { slug: 'sweets', name: { en: 'Sweets', es: 'Golosinas' } },
      {
        slug: 'chewing-gum-and-candies',
        name: { en: 'Chewing gum and candies', es: 'Chicles y caramelos' },
      },
    ],
  },
  {
    slug: 'prepared-meals-and-pizzas',
    name: { en: 'Prepared meals and pizzas', es: 'Platos preparados y pizzas' },
    children: [
      {
        slug: 'ready-to-eat-dishes',
        name: { en: 'Ready-to-eat dishes', es: 'Listos para comer' },
      },
      {
        slug: 'tortillas-and-pies',
        name: { en: 'Tortillas and pies', es: 'Tortillas y empanadas' },
      },
      {
        slug: 'refrigerated-pizzas',
        name: { en: 'Refrigerated pizzas', es: 'Pizzas refrigeradas' },
      },
      {
        slug: 'frozen-pizzas',
        name: { en: 'Frozen pizzas', es: 'Pizzas congeladas' },
      },
      {
        slug: 'sandwiches-and-burgers',
        name: { en: 'Sandwiches and Burgers', es: 'Sándwiches y hamburguesas' },
      },
      {
        slug: 'traditional-food',
        name: { en: 'Traditional Food', es: 'Comida tradicional' },
      },
      {
        slug: 'mexican-food',
        name: { en: 'Mexican Food', es: 'Comida mexicana' },
      },
      { slug: 'asian-food', name: { en: 'Asian Food', es: 'Comida asiática' } },
      {
        slug: 'salads-and-bowls',
        name: { en: 'Salads and Bowls', es: 'Ensaladas y bowls' },
      },
      {
        slug: 'gazpachos-and-salmorejos',
        name: { en: 'Gazpachos and salmorejos', es: 'Gazpachos y salmorejos' },
      },
      {
        slug: 'hummus-and-guacamole',
        name: { en: 'Hummus and guacamole', es: 'Hummus y guacamoles' },
      },
    ],
  },
  {
    slug: 'snacks-and-nuts',
    name: { en: 'Snacks and nuts', es: 'Aperitivos y frutos secos' },
    children: [
      {
        slug: 'potato-chips',
        name: { en: 'Potato chips', es: 'Patatas fritas' },
      },
      {
        slug: 'savory-snacks',
        name: { en: 'Savory snacks', es: 'Snacks salados' },
      },
      {
        slug: 'vegetable-snacks',
        name: { en: 'Vegetable snacks', es: 'Snacks vegetales' },
      },
      { slug: 'nuts', name: { en: 'Nuts', es: 'Frutos secos' } },
      {
        slug: 'mixed-nuts',
        name: { en: 'Mixed nuts', es: 'Mix de frutos secos' },
      },
      {
        slug: 'dried-fruit',
        name: { en: 'Dried fruit', es: 'Frutas deshidratadas' },
      },
      { slug: 'olives', name: { en: 'Olives', es: 'Aceitunas' } },
      { slug: 'pickles', name: { en: 'Pickles', es: 'Encurtidos' } },
    ],
  },
  {
    slug: 'water-and-soft-drinks',
    name: { en: 'Water and Soft Drinks', es: 'Agua y refrescos' },
    children: [
      { slug: 'water', name: { en: 'Water', es: 'Agua' } },
      { slug: 'cola', name: { en: 'Cola', es: 'Cola' } },
      {
        slug: 'orange-lemon-and-lemon-lime',
        name: {
          en: 'Orange, Lemon, and Lemon-Lime',
          es: 'Naranja, limón y lima-limón',
        },
      },
      {
        slug: 'tonic-sparkling-water-and-bitter',
        name: {
          en: 'Tonic, Sparkling Water, and Bitter',
          es: 'Tónica, gaseosa y bitter',
        },
      },
      { slug: 'iced-tea', name: { en: 'Iced Tea', es: 'Té frío' } },
      {
        slug: 'non-carbonated-soft-drinks',
        name: { en: 'Non-Carbonated Soft Drinks', es: 'Refrescos sin gas' },
      },
      {
        slug: 'isotonic-and-sports-drinks',
        name: {
          en: 'Isotonic and sports drinks',
          es: 'Bebidas isotónicas y deportivas',
        },
      },
      {
        slug: 'energy-drinks',
        name: { en: 'Energy drinks', es: 'Bebidas energéticas' },
      },
      {
        slug: 'kombucha-and-vitamin-infused-waters',
        name: {
          en: 'Kombucha and Vitamin-Infused Waters',
          es: 'Kombucha y aguas vitaminadas',
        },
      },
      {
        slug: 'water-and-soft-drink-packs',
        name: {
          en: 'Water and Soft Drink Packs',
          es: 'Packs de agua y refrescos',
        },
      },
    ],
  },
  {
    slug: 'juices-and-smoothies',
    name: { en: 'Juices and Smoothies', es: 'Zumos y smoothies' },
    children: [
      {
        slug: 'freshly-squeezed-and-fresh',
        name: {
          en: 'Freshly squeezed and fresh',
          es: 'Recién exprimido y fresco',
        },
      },
      { slug: 'orange', name: { en: 'Orange', es: 'Naranja' } },
      { slug: 'lemonade', name: { en: 'Lemonade', es: 'Limonadas' } },
      {
        slug: 'peach-and-pineapple',
        name: { en: 'Peach and Pineapple', es: 'Melocotón y piña' },
      },
      {
        slug: 'multifruit-and-other-flavors',
        name: {
          en: 'Multifruit and Other Flavors',
          es: 'Multifrutas y otros sabores',
        },
      },
      {
        slug: 'fruit-and-milk',
        name: { en: 'Fruit and Milk', es: 'Fruta y leche' },
      },
      { slug: 'smoothies', name: { en: 'Smoothies', es: 'Smoothies' } },
      {
        slug: 'juice-packs',
        name: { en: 'Juice Packs', es: 'Packs de zumos' },
      },
    ],
  },
  {
    slug: 'beers-wines-and-spirits',
    name: { en: 'Beers, wines, and spirits', es: 'Cervezas, vinos y licores' },
    children: [
      { slug: 'beers', name: { en: 'Beers', es: 'Cervezas' } },
      {
        slug: 'premium-and-specialty-beers',
        name: {
          en: 'Premium and specialty beers',
          es: 'Cervezas prémium y especiales',
        },
      },
      {
        slug: 'beers-with-lemon',
        name: { en: 'Beers with lemon', es: 'Cervezas con limón' },
      },
      {
        slug: 'non-alcoholic-beers',
        name: { en: 'Non-alcoholic beers', es: 'Cervezas sin alcohol' },
      },
      {
        slug: 'beer-packs',
        name: { en: 'Beer packs', es: 'Packs de cervezas' },
      },
      {
        slug: 'summer-red-wine-and-sangria',
        name: {
          en: 'Summer red wine and sangria',
          es: 'Tinto de verano y sangría',
        },
      },
      { slug: 'red-wine', name: { en: 'Red wine', es: 'Vino tinto' } },
      { slug: 'white-wine', name: { en: 'White wine', es: 'Vino blanco' } },
      { slug: 'rose-wine', name: { en: 'Rose wine', es: 'Vino rosado' } },
      {
        slug: 'cavas-and-cider',
        name: { en: 'Cavas and cider', es: 'Cavas y sidra' },
      },
      {
        slug: 'gin-vodka-and-tequila',
        name: { en: 'Gin, vodka and tequila', es: 'Ginebra, vodka y tequila' },
      },
      {
        slug: 'ron-and-whisky',
        name: { en: 'Ron and whisky', es: 'Ron y whisky' },
      },
      {
        slug: 'vermouth-and-aperitifs',
        name: { en: 'Vermouth and aperitifs', es: 'Vermouth y aperitivos' },
      },
      {
        slug: 'creams-liqueurs-and-brandy',
        name: {
          en: 'Creams, liqueurs, and brandy',
          es: 'Cremas, licores y brandy',
        },
      },
    ],
  },
  {
    slug: 'cleaning-and-home',
    name: { en: 'Cleaning and home', es: 'Limpieza y hogar' },
    children: [
      { slug: 'detergents', name: { en: 'Detergents', es: 'Detergentes' } },
      {
        slug: 'fabric-softeners-and-laundry-care',
        name: {
          en: 'Fabric softeners and laundry care',
          es: 'Suavizantes y cuidado de la ropa',
        },
      },
      { slug: 'dishwasher', name: { en: 'Dishwasher', es: 'Lavavajillas' } },
      {
        slug: 'toilet-paper-kitchen-paper-and-napkins',
        name: {
          en: 'Toilet paper, kitchen paper and napkins',
          es: 'Papel higiénico, cocina y servilletas',
        },
      },
      {
        slug: 'garbage-bags-brooms-and-mops',
        name: {
          en: 'Garbage bags, brooms and mops',
          es: 'Bolsas de basura, escobas y fregonas',
        },
      },
      {
        slug: 'kitchen-cleaning-and-degreasing',
        name: {
          en: 'Kitchen cleaning and degreasing',
          es: 'Limpieza cocina y quitagrasas',
        },
      },
      {
        slug: 'bathroom-and-toilet-cleaning',
        name: { en: 'Bathroom and toilet cleaning', es: 'Limpieza baño y WC' },
      },
      {
        slug: 'cleaning-floors-windows-and-furniture',
        name: {
          en: 'Cleaning floors, windows and furniture',
          es: 'Limpieza suelos, cristales y muebles',
        },
      },
      {
        slug: 'bleach-and-disinfectants',
        name: { en: 'Bleach and disinfectants', es: 'Lejía y desinfectantes' },
      },
      {
        slug: 'film-aluminum-and-preservation',
        name: {
          en: 'Film, aluminum and preservation',
          es: 'Film, aluminio y conservación',
        },
      },
      {
        slug: 'scouring-pads-cloths-and-gloves',
        name: {
          en: 'Scouring pads, cloths and gloves',
          es: 'Estropajos, bayetas y guantes',
        },
      },
      {
        slug: 'air-fresheners-refills-and-candles',
        name: {
          en: 'Air fresheners, refills and candles',
          es: 'Ambientadores, recambios y velas',
        },
      },
      {
        slug: 'insecticides',
        name: { en: 'Insecticides', es: 'Insecticidas' },
      },
      {
        slug: 'batteries-kitchenware-and-bags',
        name: {
          en: 'Batteries, kitchenware and bags',
          es: 'Pilas, menaje y bolsas',
        },
      },
    ],
  },
  {
    slug: 'hygiene-and-body-care',
    name: { en: 'Hygiene and Body Care', es: 'Higiene y cuidado del cuerpo' },
    children: [
      {
        slug: 'shower-gel-and-sponges',
        name: { en: 'Shower gel and sponges', es: 'Gel de ducha y esponjas' },
      },
      {
        slug: 'oral-hygiene',
        name: { en: 'Oral hygiene', es: 'Higiene bucal' },
      },
      { slug: 'deodorants', name: { en: 'Deodorants', es: 'Desodorantes' } },
      { slug: 'shaving', name: { en: 'Shaving', es: 'Afeitado' } },
      { slug: 'hair-removal', name: { en: 'Hair removal', es: 'Depilación' } },
      {
        slug: 'sanitary-pads-and-feminine-hygiene',
        name: {
          en: 'Sanitary pads and feminine hygiene',
          es: 'Compresas e higiene íntima',
        },
      },
      {
        slug: 'body-and-hand-hydration',
        name: {
          en: 'Body and hand hydration',
          es: 'Hidratación de cuerpo y manos',
        },
      },
      { slug: 'hand-soap', name: { en: 'Hand soap', es: 'Jabón de manos' } },
    ],
  },
  {
    slug: 'hair-and-perfumery',
    name: { en: 'Hair and Perfumery', es: 'Cabello y perfumería' },
    children: [
      { slug: 'shampoo', name: { en: 'Shampoo', es: 'Champú' } },
      {
        slug: 'conditioners-and-masks',
        name: {
          en: 'Conditioners and masks',
          es: 'Acondicionadores y mascarillas',
        },
      },
      {
        slug: 'foams-and-fixers',
        name: { en: 'Foams and fixers', es: 'Espumas y fijadores' },
      },
      { slug: 'dyes', name: { en: 'Dyes', es: 'Tintes' } },
      {
        slug: 'facial-care',
        name: { en: 'Facial Care', es: 'Cuidado facial' },
      },
      {
        slug: 'perfumes-and-colognes',
        name: { en: 'Perfumes and colognes', es: 'Perfumes y colonias' },
      },
    ],
  },
  {
    slug: 'health-and-pharmacy',
    name: { en: 'Health and Pharmacy', es: 'Salud y parafarmacia' },
    children: [
      {
        slug: 'nutritional-supplements',
        name: {
          en: 'Nutritional supplements',
          es: 'Complementos nutricionales',
        },
      },
      {
        slug: 'parapharmacy',
        name: { en: 'Parapharmacy', es: 'Parafarmacia' },
      },
      { slug: 'first-aid-kit', name: { en: 'First Aid Kit', es: 'Botiquín' } },
      { slug: 'sunscreen', name: { en: 'Sunscreen', es: 'Protector solar' } },
    ],
  },
  {
    slug: 'children',
    name: { en: 'Children', es: 'Infantil' },
    children: [
      {
        slug: 'milk-and-baby-food',
        name: { en: 'Milk and Baby Food', es: 'Leches y papillas' },
      },
      {
        slug: 'baby-foods-and-jars',
        name: { en: 'Baby foods and jars', es: 'Potitos y tarritos' },
      },
      {
        slug: 'yogurt-and-desserts',
        name: { en: 'Yogurt and Desserts', es: 'Yogures y postres' },
      },
      {
        slug: 'pots-and-snacks',
        name: { en: 'Pots and Snacks', es: 'Bolsitas y snacks' },
      },
      {
        slug: 'diapers-and-wipes',
        name: { en: 'Diapers and wipes', es: 'Pañales y toallitas' },
      },
      {
        slug: 'hygiene-and-care',
        name: { en: 'Hygiene and Care', es: 'Higiene y cuidado' },
      },
      {
        slug: 'children-juices-and-smoothies',
        name: { en: 'Juices and Smoothies', es: 'Zumos y batidos' },
      },
      {
        slug: 'cookies-and-pastries',
        name: { en: 'Cookies and Pastries', es: 'Galletas y bollería' },
      },
      {
        slug: 'sweets-and-chocolates',
        name: { en: 'Sweets and Chocolates', es: 'Golosinas y chocolatinas' },
      },
    ],
  },
  {
    slug: 'pets',
    name: { en: 'Pets', es: 'Mascotas' },
    children: [
      {
        slug: 'wet-cat-food',
        name: { en: 'Wet cat food', es: 'Gato comida húmeda' },
      },
      {
        slug: 'dry-cat-food',
        name: { en: 'Dry cat food', es: 'Gato comida seca' },
      },
      {
        slug: 'cat-treats-and-care',
        name: { en: 'Cat treats and care', es: 'Gato snacks y cuidado' },
      },
      {
        slug: 'wet-dog-food',
        name: { en: 'Wet dog food', es: 'Perro comida húmeda' },
      },
      {
        slug: 'dry-dog-food',
        name: { en: 'Dry dog food', es: 'Perro comida seca' },
      },
      {
        slug: 'dog-treats-and-care',
        name: { en: 'Dog treats and care', es: 'Perro snacks y cuidado' },
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
 * Appendix C for shop sections: each root of the first tree to the root of the
 * new tree that holds most of it.
 */
export const ROOT_REMAP: Record<string, string> = {
  'fruit-and-vegetables': 'vegetables',
  meat: 'meats',
  'cold-cuts-and-cheese': 'charcuterie',
  'fish-and-seafood': 'fish-and-seafood',
  'dairy-and-eggs': 'eggs-milk-and-butter',
  bakery: 'bakery',
  'breakfast-and-sweets': 'biscuits-cereals-and-jams',
  pantry: 'oils-sauces-and-spices',
  frozen: 'frozen-foods-and-ice-cream',
  'ready-meals': 'prepared-meals-and-pizzas',
  snacks: 'snacks-and-nuts',
  drinks: 'beers-wines-and-spirits',
  baby: 'children',
  pets: 'pets',
  household: 'cleaning-and-home',
  'personal-care': 'hygiene-and-body-care',
  other: 'other',
};

/**
 * Appendix C for products and shop sections: each leaf of the first tree to
 * one leaf of the new tree. Every catch all and every doubtful leaf goes to
 * `uncategorised` (section 4).
 */
export const LEAF_REMAP: Record<string, string> = {
  fruit: 'other-fruits',
  vegetables: 'uncategorised',
  'salads-and-herbs': 'lettuce-and-leafy-greens',
  'nuts-and-dried-fruit': 'nuts',
  'other-produce': 'uncategorised',
  poultry: 'chicken',
  pork: 'pork',
  'beef-and-lamb': 'beef',
  'minced-and-burgers': 'hamburgers-ground-beef-and-meatballs',
  'other-meat': 'uncategorised',
  'cured-ham-and-sausages': 'serrano-ham',
  'sliced-cold-cuts': 'cooked-ham',
  cheese: 'semi-cured',
  'pates-and-spreads': 'pate-and-sobrasada',
  'other-cold-cuts': 'uncategorised',
  'fresh-fish': 'fish-and-seafood-fresh',
  shellfish: 'seafood-shrimp-and-squid',
  'smoked-and-salted-fish': 'smoked-and-salted',
  'other-seafood': 'uncategorised',
  milk: 'milk',
  'plant-drinks': 'plant-based-drinks-and-horchata',
  'yogurts-and-desserts': 'uncategorised',
  'butter-and-cream': 'butter-and-margarine',
  eggs: 'eggs',
  'other-dairy': 'uncategorised',
  bread: 'freshly-baked-bread',
  'pastries-and-cakes': 'muffins-and-classic-pastries',
  'toasts-and-crispbread': 'breadcrumbs-toasted-bread-and-breadsticks',
  'other-bakery': 'uncategorised',
  cereals: 'cereals',
  biscuits: 'classic-and-digestive-biscuits',
  'jam-honey-and-spreads': 'jams',
  'chocolate-and-sweets': 'sweets',
  'coffee-tea-and-cocoa': 'ground-coffee',
  'other-breakfast': 'uncategorised',
  'pasta-rice-and-legumes': 'macaroni-spaghetti-and-dried-pasta',
  'canned-food': 'canned-food-broths-and-creams-canned-vegetables',
  'oil-and-vinegar': 'oils',
  'sauces-and-condiments': 'ketchup-mayonnaise-and-mustard',
  'flour-sugar-and-baking': 'flours-and-yeasts',
  'spices-and-salt': 'spices-and-herbs',
  'soups-and-stock': 'broths-and-soups',
  'other-pantry': 'uncategorised',
  'frozen-vegetables': 'frozen-and-steamed-vegetables',
  'frozen-fish-and-seafood': 'frozen-foods-and-ice-cream-fish-and-seafood',
  'frozen-meals-and-pizzas': 'pizzas-and-doughs',
  'ice-cream': 'ice-creams-and-ice',
  'other-frozen': 'uncategorised',
  pizzas: 'refrigerated-pizzas',
  'prepared-dishes': 'traditional-food',
  'salads-and-sandwiches': 'salads-and-bowls',
  'fresh-pasta-and-dough': 'filled-and-sauced-pasta',
  'other-ready-meals': 'uncategorised',
  crisps: 'potato-chips',
  'salty-snacks': 'savory-snacks',
  'olives-and-pickles': 'olives',
  'other-snacks': 'uncategorised',
  water: 'water',
  'soft-drinks': 'cola',
  juices: 'multifruit-and-other-flavors',
  beer: 'beers',
  'wine-and-cava': 'red-wine',
  spirits: 'gin-vodka-and-tequila',
  'other-drinks': 'uncategorised',
  'baby-food': 'baby-foods-and-jars',
  'nappies-and-wipes': 'diapers-and-wipes',
  'other-baby': 'uncategorised',
  dogs: 'dry-dog-food',
  cats: 'dry-cat-food',
  'other-pets': 'uncategorised',
  cleaning: 'cleaning-floors-windows-and-furniture',
  laundry: 'detergents',
  dishwashing: 'dishwasher',
  'paper-and-wipes': 'toilet-paper-kitchen-paper-and-napkins',
  'bags-foil-and-wrap': 'film-aluminum-and-preservation',
  'other-household': 'uncategorised',
  hair: 'shampoo',
  'skin-and-body': 'body-and-hand-hydration',
  'oral-care': 'oral-hygiene',
  'shaving-and-deodorant': 'deodorants',
  'feminine-care': 'sanitary-pads-and-feminine-hygiene',
  pharmacy: 'parapharmacy',
  'other-personal-care': 'uncategorised',
  uncategorised: 'uncategorised',
};

/**
 * The way back, for `down`: each root of appendix A to the root of the first
 * tree it came closest to. It is `ROOT_REMAP` inverted, and the twelve roots
 * that table never names go where appendix C's notes say the first tree root
 * that spanned them was (`cheeses` was half of `cold-cuts-and-cheese`,
 * `juices-and-smoothies` a part of `drinks`). `pastries-cakes-and-sugar` was
 * spanned by both `bakery` and `pantry`, and goes to `bakery`, which held its
 * pastries.
 */
export const DIA_ROOT_TO_FIRST_ROOT: Record<string, string> = {
  fruits: 'fruit-and-vegetables',
  vegetables: 'fruit-and-vegetables',
  meats: 'meat',
  'fish-and-seafood': 'fish-and-seafood',
  charcuterie: 'cold-cuts-and-cheese',
  cheeses: 'cold-cuts-and-cheese',
  'eggs-milk-and-butter': 'dairy-and-eggs',
  bakery: 'bakery',
  'yoghurts-and-desserts': 'dairy-and-eggs',
  'frozen-foods-and-ice-cream': 'frozen',
  'rice-pasta-and-pulses': 'pantry',
  'oils-sauces-and-spices': 'pantry',
  'canned-food-broths-and-creams': 'pantry',
  'coffee-cocoa-and-infusions': 'breakfast-and-sweets',
  'pastries-cakes-and-sugar': 'bakery',
  'biscuits-cereals-and-jams': 'breakfast-and-sweets',
  'chocolates-and-sweets': 'breakfast-and-sweets',
  'prepared-meals-and-pizzas': 'ready-meals',
  'snacks-and-nuts': 'snacks',
  'water-and-soft-drinks': 'drinks',
  'juices-and-smoothies': 'drinks',
  'beers-wines-and-spirits': 'drinks',
  'cleaning-and-home': 'household',
  'hygiene-and-body-care': 'personal-care',
  'hair-and-perfumery': 'personal-care',
  'health-and-pharmacy': 'personal-care',
  children: 'baby',
  pets: 'pets',
  other: 'other',
};
