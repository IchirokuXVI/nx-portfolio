import { MigrationInterface, QueryRunner } from 'typeorm';
import { categoryId } from '../taxonomy/ids';

/**
 * Categories for what DIA does not sell (plan 0179).
 *
 * DIA's tree describes what DIA sells online. Mercadona, Deza and El Jamón
 * sell more: make-up, books, magazines, stationery, home textiles, garden,
 * DIY, party goods, toys, food for birds and rodents, shoe care and fortified
 * wines. This migration adds four roots and thirty leaves for them.
 *
 * **It only adds.** No table, index or trigger changes, no product moves, no
 * section moves, and no slug or name of an existing row is rewritten. The one
 * existing row it writes to is the root `other`, and only its position: the
 * four new roots take positions 28 to 31 and `other` goes from 28 to 32, so
 * the catch all stays the last root shown.
 *
 * ## Up
 *
 * 1. Refuse when a row with one of the thirty four slugs, or one of their
 *    ids, already exists.
 * 2. Move `other` to the end.
 * 3. Insert the four roots.
 * 4. Insert the leaves: eight under roots DIA's tree already has, each after
 *    the last child that root had, and twenty two under the new roots.
 *
 * **Step 1 is why the inserts are plain.** The back office creates a category
 * under `categoryId(slug)`, the same id this file derives, so a `books` made by
 * hand is the very row an upsert would write over: moved under another root
 * with its products, renamed and repositioned, and later deleted by `down`
 * although it was there before `up`. So the migration reads first, names every
 * such row with its parent, and changes nothing. What happens to that row is
 * a person's decision, and the back office cannot rename a slug: move its
 * products and sections to another category, delete it there, and run the
 * migration again.
 *
 * ## Down
 *
 * Removes only the rows this file names and puts `other` back at position 28.
 * **It refuses while a product or a shop section points at one of them**, and
 * says which rows and how many. Where they go is a person's decision, so the
 * migration does not make it: move them in the back office and run it again.
 * A leaf added by hand under one of the new roots is refused by the foreign
 * key `fk_categories_parent` for the same reason.
 */
export class CategoriesBeyondDia1758600000000 implements MigrationInterface {
  name = 'CategoriesBeyondDia1758600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const rows = [...rootRows(), ...leafRows()];

    // --- 1. The refusal ------------------------------------------------------
    const taken: { slug: string; parent: string | null }[] =
      await queryRunner.query(
        `SELECT c."slug", p."slug" AS "parent"
           FROM "categories" c
           LEFT JOIN "categories" p ON p."id" = c."parentId"
          WHERE c."id" = ANY($1::uuid[]) OR c."slug" = ANY($2::text[])
          ORDER BY c."slug"`,
        [rows.map((row) => row.id), rows.map((row) => row.slug)]
      );
    if (taken.length > 0) {
      const named = taken
        .map(
          (row) =>
            `${row.slug} (${row.parent === null ? 'a root' : `under ${row.parent}`})`
        )
        .join(', ');
      throw new Error(
        `CategoriesBeyondDia1758600000000 cannot run while a category it adds already exists: ${named}. Move its products and sections, delete it in the back office and run it again.`
      );
    }

    // --- 2. `other` stays the last root ------------------------------------
    await queryRunner.query(
      `UPDATE "categories" SET "position" = $2, "updatedAt" = now()
        WHERE "id" = $1`,
      [categoryId(OTHER), OTHER_POSITION_AFTER]
    );

    // --- 3 and 4. The roots, then every leaf --------------------------------
    for (const row of rows) {
      await queryRunner.query(
        `INSERT INTO "categories" ("id", "parentId", "slug", "name", "position")
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [row.id, row.parentId, row.slug, JSON.stringify(row.name), row.position]
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const roots = rootRows().map((row) => row.id);
    const leaves = leafRows().map((row) => row.id);
    const all = [...roots, ...leaves];

    // --- The refusal ---------------------------------------------------------
    const held: { slug: string; products: number; sections: number }[] =
      await queryRunner.query(
        `SELECT c."slug",
                (SELECT count(*)::int FROM "item_categories" ic
                  WHERE ic."categoryId" = c."id") AS "products",
                (SELECT count(*)::int FROM "section_categories" sc
                  WHERE sc."categoryId" = c."id") AS "sections"
           FROM "categories" c
          WHERE c."id" = ANY($1::uuid[])
            AND (EXISTS (SELECT 1 FROM "item_categories" ic
                          WHERE ic."categoryId" = c."id")
                 OR EXISTS (SELECT 1 FROM "section_categories" sc
                             WHERE sc."categoryId" = c."id"))
          ORDER BY c."slug"`,
        [all]
      );
    if (held.length > 0) {
      const named = held
        .map(
          (row) =>
            `${row.slug} (${row.products} products, ${row.sections} sections)`
        )
        .join(', ');
      throw new Error(
        `CategoriesBeyondDia1758600000000 cannot be undone while a product or a shop section points at a category it added: ${named}. Move them in the back office and run it again.`
      );
    }

    // --- Leaves first, then the roots, then `other` back where it was -------
    await queryRunner.query(
      `DELETE FROM "categories" WHERE "id" = ANY($1::uuid[])`,
      [leaves]
    );
    await queryRunner.query(
      `DELETE FROM "categories" WHERE "id" = ANY($1::uuid[])`,
      [roots]
    );
    await queryRunner.query(
      `UPDATE "categories" SET "position" = $2, "updatedAt" = now()
        WHERE "id" = $1`,
      [categoryId(OTHER), OTHER_POSITION_BEFORE]
    );
  }
}

const OTHER = 'other';

/** Where `DiaCategoryTree1758500000000` left the root `other`. */
export const OTHER_POSITION_BEFORE = 28;

/** Where the first new root goes, which is the place `other` held. */
export const FIRST_NEW_ROOT_POSITION = OTHER_POSITION_BEFORE;

interface NewLeaf {
  slug: string;
  name: { en: string; es: string };
}

/**
 * The eight leaves added under roots DIA's tree already has. `position` is the
 * number of children that root had in `DIA_CATEGORY_TREE`, so the new leaf
 * comes after all of them, and the next one under the same root follows it.
 *
 * Frozen here, as a migration's data has to be. `taxonomy/categories.ts` is the
 * living copy, and `taxonomy.spec.ts` asserts the two agree.
 */
export const NEW_LEAVES_UNDER_DIA_ROOTS: (NewLeaf & {
  root: string;
  position: number;
})[] = [
  {
    root: 'hair-and-perfumery',
    position: 6,
    slug: 'hair-accessories',
    name: { en: 'Hair accessories', es: 'Accesorios para el cabello' },
  },
  {
    root: 'cleaning-and-home',
    position: 14,
    slug: 'shoe-care',
    name: { en: 'Shoe care', es: 'Cuidado del calzado' },
  },
  {
    root: 'pets',
    position: 6,
    slug: 'bird-food-and-care',
    name: { en: 'Birds', es: 'Pájaros' },
  },
  {
    root: 'pets',
    position: 7,
    slug: 'small-animal-food-and-care',
    name: { en: 'Rodents and rabbits', es: 'Roedores y conejos' },
  },
  {
    root: 'pets',
    position: 8,
    slug: 'fish-and-reptile-care',
    name: { en: 'Fish and reptiles', es: 'Peces y reptiles' },
  },
  {
    root: 'pets',
    position: 9,
    slug: 'pet-accessories',
    name: { en: 'Pet accessories', es: 'Accesorios para mascotas' },
  },
  {
    root: 'beers-wines-and-spirits',
    position: 14,
    slug: 'sherry-and-fortified-wines',
    name: { en: 'Sherry and fortified wines', es: 'Vinos generosos y dulces' },
  },
  {
    root: 'beers-wines-and-spirits',
    position: 15,
    slug: 'premixed-drinks',
    name: { en: 'Premixed drinks', es: 'Combinados y bebidas con alcohol' },
  },
];

/**
 * The four new roots and their twenty two leaves, in the order they are shown.
 * A root's position is `FIRST_NEW_ROOT_POSITION` plus its index here, and a
 * leaf's position is its index among its siblings.
 */
export const NEW_ROOTS: (NewLeaf & { children: NewLeaf[] })[] = [
  {
    slug: 'makeup',
    name: { en: 'Make-up', es: 'Maquillaje' },
    children: [
      {
        slug: 'face-makeup',
        name: { en: 'Foundations and concealers', es: 'Bases y correctores' },
      },
      {
        slug: 'powders-and-blush',
        name: { en: 'Powders and blush', es: 'Polvos y colorete' },
      },
      { slug: 'eye-makeup', name: { en: 'Eyes', es: 'Ojos' } },
      { slug: 'lip-makeup', name: { en: 'Lips', es: 'Labios' } },
      { slug: 'nail-care', name: { en: 'Nails', es: 'Manicura y pedicura' } },
      {
        slug: 'makeup-tools',
        name: { en: 'Brushes and tools', es: 'Brochas y accesorios' },
      },
    ],
  },
  {
    slug: 'home-and-garden',
    name: { en: 'Home and garden', es: 'Hogar y jardín' },
    children: [
      {
        slug: 'home-textiles',
        name: { en: 'Home textiles', es: 'Textil hogar' },
      },
      { slug: 'home-decor', name: { en: 'Home decor', es: 'Decoración' } },
      {
        slug: 'storage-and-organisation',
        name: { en: 'Storage and organisation', es: 'Orden y almacenaje' },
      },
      {
        slug: 'garden-and-plants',
        name: { en: 'Garden and plants', es: 'Jardín y plantas' },
      },
      {
        slug: 'diy-and-hardware',
        name: { en: 'DIY and hardware', es: 'Bricolaje y ferretería' },
      },
      {
        slug: 'lighting-and-electrical',
        name: {
          en: 'Lighting and electrical',
          es: 'Iluminación y electricidad',
        },
      },
      {
        slug: 'small-appliances',
        name: { en: 'Small appliances', es: 'Pequeño electrodoméstico' },
      },
      { slug: 'car-care', name: { en: 'Car care', es: 'Cuidado del coche' } },
    ],
  },
  {
    slug: 'leisure-and-stationery',
    name: { en: 'Leisure and stationery', es: 'Ocio y papelería' },
    children: [
      {
        slug: 'stationery-and-school',
        name: {
          en: 'Stationery and school',
          es: 'Papelería y material escolar',
        },
      },
      { slug: 'books', name: { en: 'Books', es: 'Libros' } },
      {
        slug: 'magazines-and-collectibles',
        name: {
          en: 'Magazines and collectibles',
          es: 'Revistas y coleccionables',
        },
      },
      {
        slug: 'toys-and-games',
        name: { en: 'Toys and games', es: 'Juguetes y juegos' },
      },
      {
        slug: 'party-and-celebrations',
        name: { en: 'Party and costumes', es: 'Fiestas y disfraces' },
      },
      {
        slug: 'beach-and-pool',
        name: { en: 'Beach and pool', es: 'Playa y piscina' },
      },
    ],
  },
  {
    slug: 'clothing-and-accessories',
    name: { en: 'Clothing and accessories', es: 'Ropa y complementos' },
    children: [
      { slug: 'clothing', name: { en: 'Clothing', es: 'Ropa' } },
      {
        slug: 'clothing-accessories',
        name: { en: 'Accessories', es: 'Complementos' },
      },
    ],
  },
];

/** Where `other` goes: after the last new root. */
export const OTHER_POSITION_AFTER = FIRST_NEW_ROOT_POSITION + NEW_ROOTS.length;

interface Row {
  id: string;
  parentId: string | null;
  slug: string;
  name: { en: string; es: string };
  position: number;
}

function rootRows(): Row[] {
  return NEW_ROOTS.map((root, index) => ({
    id: categoryId(root.slug),
    parentId: null,
    slug: root.slug,
    name: root.name,
    position: FIRST_NEW_ROOT_POSITION + index,
  }));
}

function leafRows(): Row[] {
  return [
    ...NEW_LEAVES_UNDER_DIA_ROOTS.map((leaf) => ({
      id: categoryId(leaf.slug),
      parentId: categoryId(leaf.root),
      slug: leaf.slug,
      name: leaf.name,
      position: leaf.position,
    })),
    ...NEW_ROOTS.flatMap((root) =>
      root.children.map((leaf, position) => ({
        id: categoryId(leaf.slug),
        parentId: categoryId(root.slug),
        slug: leaf.slug,
        name: leaf.name,
        position,
      }))
    ),
  ];
}
