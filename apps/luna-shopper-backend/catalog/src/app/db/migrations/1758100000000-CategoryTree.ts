import { MigrationInterface, QueryRunner } from 'typeorm';
import { categoryId } from '../reference/ids';

/**
 * A category is a row, and a product has several (plan 0166, section 6).
 *
 * One migration, five steps:
 *
 * 1. Create `categories` and `item_categories`, their indexes and the two
 *    triggers that hold the tree to two levels.
 * 2. Insert the seventeen roots and the twelve landing leaves, under the ids
 *    `db/reference/ids.ts` derives from their slugs. The reference seed adds
 *    the rest of the taxonomy on the next boot; this only needs the rows it is
 *    about to point products at.
 * 3. Put every product on the landing leaf of its old enum value, at position 0.
 * 4. Drop `items.category`.
 * 5. Drop the type `item_category`.
 *
 * **The names and positions below are frozen here**, as a migration's data has
 * to be. The taxonomy file is the living copy and the seed rewrites both on
 * every boot, so a rename there wins the moment the seed runs. What must never
 * drift is the id, which is why it comes from `categoryId` and not from a
 * literal: that derivation is fixed forever, and the seed upserts by it.
 *
 * ## The rules the database holds (sections 1 and 2)
 *
 * - **R1**, `ck_categories_two_levels`: a `parentId` must name a root, and a
 *   row that has children may not be given a parent.
 * - **R2**, `ck_item_categories_leaf`: an `item_categories` row must name a row
 *   with a parent, and a child holding products may not be made a root.
 * - **R4**: both foreign keys onto `categories` are `ON DELETE RESTRICT`, so a
 *   category with children or products cannot be deleted.
 *
 * R3, every product has at least one category, is the service's alone: a
 * deferred constraint over two tables is more machinery than the one write path
 * that creates products deserves, and step 3 guarantees the starting state.
 *
 * The triggers raise `check_violation` naming a constraint, so a caller that
 * reaches them sees the same shape as a `CHECK` and `CategoryService` can name
 * the rule. Each takes a `FOR SHARE` lock on the row it read, so two writes
 * racing to break the rule from both ends cannot both pass.
 *
 * ## Down
 *
 * Recreates the type and the column with default `OTHER`, fills it from each
 * product's first category's **root** where that root corresponds to an enum
 * value, and drops both tables. A product under `ready-meals` or `pets` comes
 * back as `OTHER`, which is the best twelve values can do: the down path is for
 * a broken deploy, not for a round trip.
 */
export class CategoryTree1758100000000 implements MigrationInterface {
  name = 'CategoryTree1758100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // --- 1. The tables, the indexes and the triggers -----------------------
    await queryRunner.query(`
      CREATE TABLE "categories" (
        "id"        uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "parentId"  uuid,
        "slug"      varchar(80) NOT NULL,
        "name"      jsonb NOT NULL,
        "position"  integer NOT NULL,
        CONSTRAINT "pk_categories" PRIMARY KEY ("id"),
        CONSTRAINT "fk_categories_parent" FOREIGN KEY ("parentId")
          REFERENCES "categories" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_categories_not_own_parent"
          CHECK ("parentId" IS NULL OR "parentId" <> "id"),
        CONSTRAINT "ck_categories_position" CHECK ("position" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_categories_slug" ON "categories" ("slug")`
    );
    // A parent's children in order, which is both the tree read and the check
    // that a row has children.
    await queryRunner.query(
      `CREATE INDEX "ix_categories_parent" ON "categories" ("parentId", "position")`
    );

    await queryRunner.query(`
      CREATE TABLE "item_categories" (
        "itemId"     uuid NOT NULL,
        "categoryId" uuid NOT NULL,
        "position"   smallint NOT NULL,
        CONSTRAINT "pk_item_categories" PRIMARY KEY ("itemId", "categoryId"),
        CONSTRAINT "uq_item_categories_position" UNIQUE ("itemId", "position"),
        CONSTRAINT "fk_item_categories_item" FOREIGN KEY ("itemId")
          REFERENCES "items" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_item_categories_category" FOREIGN KEY ("categoryId")
          REFERENCES "categories" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_item_categories_position" CHECK ("position" >= 0)
      )
    `);
    // The search filter and the counts read by category (section 4). The
    // primary key already serves a read by product.
    await queryRunner.query(
      `CREATE INDEX "ix_item_categories_category"
         ON "item_categories" ("categoryId", "itemId")`
    );

    // R1, and the half of R2 that a move of a category can break.
    await queryRunner.query(`
      CREATE FUNCTION "categories_two_levels"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        grandparent uuid;
      BEGIN
        IF NEW."parentId" IS NOT NULL THEN
          SELECT p."parentId" INTO grandparent
            FROM "categories" p
           WHERE p."id" = NEW."parentId"
             FOR SHARE;
          IF grandparent IS NOT NULL THEN
            RAISE EXCEPTION 'category_too_deep: % names a parent that is itself a child', NEW."id"
              USING ERRCODE = 'check_violation',
                    CONSTRAINT = 'ck_categories_two_levels',
                    DETAIL = NEW."parentId"::text;
          END IF;
          IF EXISTS (SELECT 1 FROM "categories" c WHERE c."parentId" = NEW."id") THEN
            RAISE EXCEPTION 'category_too_deep: % has children and cannot be given a parent', NEW."id"
              USING ERRCODE = 'check_violation',
                    CONSTRAINT = 'ck_categories_two_levels',
                    DETAIL = NEW."id"::text;
          END IF;
        ELSIF TG_OP = 'UPDATE' AND OLD."parentId" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "item_categories" ic WHERE ic."categoryId" = NEW."id"
          ) THEN
          RAISE EXCEPTION 'category_not_a_leaf: % holds products and cannot become a root', NEW."id"
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_item_categories_leaf',
                  DETAIL = NEW."id"::text;
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "tg_categories_two_levels"
        BEFORE INSERT OR UPDATE OF "parentId" ON "categories"
        FOR EACH ROW EXECUTE FUNCTION "categories_two_levels"()
    `);

    // R2: a product sits on a leaf. A category that does not exist is left to
    // the foreign key, which names itself.
    await queryRunner.query(`
      CREATE FUNCTION "item_categories_on_a_leaf"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        parent uuid;
      BEGIN
        SELECT c."parentId" INTO parent
          FROM "categories" c
         WHERE c."id" = NEW."categoryId"
           FOR SHARE;
        IF FOUND AND parent IS NULL THEN
          RAISE EXCEPTION 'category_not_a_leaf: % is a root', NEW."categoryId"
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_item_categories_leaf',
                  DETAIL = NEW."categoryId"::text;
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "tg_item_categories_on_a_leaf"
        BEFORE INSERT OR UPDATE OF "categoryId" ON "item_categories"
        FOR EACH ROW EXECUTE FUNCTION "item_categories_on_a_leaf"()
    `);

    // --- 2. The roots and the landing leaves --------------------------------
    for (const [position, root] of ROOTS.entries()) {
      await queryRunner.query(
        `INSERT INTO "categories" ("id", "parentId", "slug", "name", "position")
         VALUES ($1, NULL, $2, $3::jsonb, $4)
         ON CONFLICT ("id") DO NOTHING`,
        [categoryId(root.slug), root.slug, JSON.stringify(root.name), position]
      );
    }
    for (const leaf of LANDING_LEAVES) {
      await queryRunner.query(
        `INSERT INTO "categories" ("id", "parentId", "slug", "name", "position")
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT ("id") DO NOTHING`,
        [
          categoryId(leaf.slug),
          categoryId(leaf.root),
          leaf.slug,
          JSON.stringify(leaf.name),
          leaf.position,
        ]
      );
    }

    // --- 3. Every product onto its landing leaf -----------------------------
    const cases = LANDING_LEAVES.map(
      (leaf) => `WHEN '${leaf.from}' THEN '${categoryId(leaf.slug)}'::uuid`
    ).join('\n            ');
    await queryRunner.query(`
      INSERT INTO "item_categories" ("itemId", "categoryId", "position")
      SELECT i."id",
             CASE i."category"::text
               ${cases}
               ELSE '${categoryId(UNCATEGORISED)}'::uuid
             END,
             0
        FROM "items" i
    `);

    // --- 4 and 5. The column and its type -----------------------------------
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "category"`);
    await queryRunner.query(`DROP TYPE "item_category"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "item_category" AS ENUM (
        'PRODUCE', 'DAIRY', 'BAKERY', 'MEAT', 'SEAFOOD', 'FROZEN', 'BEVERAGES',
        'SNACKS', 'PANTRY', 'HOUSEHOLD', 'PERSONAL_CARE', 'OTHER'
      )`
    );
    await queryRunner.query(
      `ALTER TABLE "items"
         ADD COLUMN "category" "item_category" NOT NULL DEFAULT 'OTHER'`
    );
    // Each product's first category, by its root. A root with no enum value of
    // its own leaves the product on the default.
    const cases = Object.entries(ROOT_TO_ENUM)
      .map(([slug, value]) => `WHEN '${slug}' THEN '${value}'`)
      .join('\n              ');
    await queryRunner.query(`
      UPDATE "items" i
         SET "category" = m."category"::"item_category"
        FROM (
          SELECT DISTINCT ON (ic."itemId")
                 ic."itemId",
                 CASE r."slug"
                   ${cases}
                   ELSE 'OTHER'
                 END AS "category"
            FROM "item_categories" ic
            JOIN "categories" c ON c."id" = ic."categoryId"
            JOIN "categories" r ON r."id" = c."parentId"
           ORDER BY ic."itemId", ic."position"
        ) m
       WHERE m."itemId" = i."id"
    `);
    await queryRunner.query(`DROP TABLE "item_categories"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP FUNCTION "item_categories_on_a_leaf"()`);
    await queryRunner.query(`DROP FUNCTION "categories_two_levels"()`);
  }
}

const UNCATEGORISED = 'uncategorised';

/**
 * The seventeen roots of appendix A, in the order they are shown. Exported for
 * `reference-catalog.spec.ts`, which asserts the taxonomy file still agrees.
 */
export const ROOTS: { slug: string; name: { en: string; es: string } }[] = [
  {
    slug: 'fruit-and-vegetables',
    name: { en: 'Fruit and vegetables', es: 'Frutas y verduras' },
  },
  { slug: 'meat', name: { en: 'Meat', es: 'Carne' } },
  {
    slug: 'cold-cuts-and-cheese',
    name: { en: 'Cold cuts and cheese', es: 'Charcutería y quesos' },
  },
  {
    slug: 'fish-and-seafood',
    name: { en: 'Fish and seafood', es: 'Pescado y marisco' },
  },
  {
    slug: 'dairy-and-eggs',
    name: { en: 'Dairy and eggs', es: 'Lácteos y huevos' },
  },
  { slug: 'bakery', name: { en: 'Bakery', es: 'Panadería y bollería' } },
  {
    slug: 'breakfast-and-sweets',
    name: { en: 'Breakfast and sweets', es: 'Desayuno y dulces' },
  },
  { slug: 'pantry', name: { en: 'Pantry', es: 'Despensa' } },
  { slug: 'frozen', name: { en: 'Frozen', es: 'Congelados' } },
  { slug: 'ready-meals', name: { en: 'Ready meals', es: 'Platos preparados' } },
  { slug: 'snacks', name: { en: 'Snacks', es: 'Aperitivos' } },
  { slug: 'drinks', name: { en: 'Drinks', es: 'Bebidas' } },
  { slug: 'baby', name: { en: 'Baby', es: 'Bebé' } },
  { slug: 'pets', name: { en: 'Pets', es: 'Mascotas' } },
  { slug: 'household', name: { en: 'Household', es: 'Hogar y limpieza' } },
  {
    slug: 'personal-care',
    name: { en: 'Personal care', es: 'Cuidado personal' },
  },
  { slug: 'other', name: { en: 'Other', es: 'Otros' } },
];

/**
 * The twelve landing leaves, one per enum value (appendix A, last column), at
 * the position appendix A gives them among their siblings.
 */
export const LANDING_LEAVES: {
  from: string;
  slug: string;
  root: string;
  position: number;
  name: { en: string; es: string };
}[] = [
  {
    from: 'PRODUCE',
    slug: 'other-produce',
    root: 'fruit-and-vegetables',
    position: 4,
    name: { en: 'Other fruit and vegetables', es: 'Otras frutas y verduras' },
  },
  {
    from: 'MEAT',
    slug: 'other-meat',
    root: 'meat',
    position: 4,
    name: { en: 'Other meat', es: 'Otras carnes' },
  },
  {
    from: 'SEAFOOD',
    slug: 'other-seafood',
    root: 'fish-and-seafood',
    position: 3,
    name: { en: 'Other fish and seafood', es: 'Otros pescados y mariscos' },
  },
  {
    from: 'DAIRY',
    slug: 'other-dairy',
    root: 'dairy-and-eggs',
    position: 5,
    name: { en: 'Other dairy', es: 'Otros lácteos' },
  },
  {
    from: 'BAKERY',
    slug: 'other-bakery',
    root: 'bakery',
    position: 3,
    name: { en: 'Other bakery', es: 'Otra panadería' },
  },
  {
    from: 'PANTRY',
    slug: 'other-pantry',
    root: 'pantry',
    position: 7,
    name: { en: 'Other pantry', es: 'Otra despensa' },
  },
  {
    from: 'FROZEN',
    slug: 'other-frozen',
    root: 'frozen',
    position: 4,
    name: { en: 'Other frozen', es: 'Otros congelados' },
  },
  {
    from: 'SNACKS',
    slug: 'other-snacks',
    root: 'snacks',
    position: 3,
    name: { en: 'Other snacks', es: 'Otros aperitivos' },
  },
  {
    from: 'BEVERAGES',
    slug: 'other-drinks',
    root: 'drinks',
    position: 6,
    name: { en: 'Other drinks', es: 'Otras bebidas' },
  },
  {
    from: 'HOUSEHOLD',
    slug: 'other-household',
    root: 'household',
    position: 5,
    name: { en: 'Other household', es: 'Otros de hogar' },
  },
  {
    from: 'PERSONAL_CARE',
    slug: 'other-personal-care',
    root: 'personal-care',
    position: 6,
    name: { en: 'Other personal care', es: 'Otro cuidado personal' },
  },
  {
    from: 'OTHER',
    slug: UNCATEGORISED,
    root: 'other',
    position: 0,
    name: { en: 'Not yet categorised', es: 'Sin categoría' },
  },
];

/** The roots that correspond to an enum value, for the down path. */
const ROOT_TO_ENUM: Record<string, string> = {
  'fruit-and-vegetables': 'PRODUCE',
  meat: 'MEAT',
  'fish-and-seafood': 'SEAFOOD',
  'dairy-and-eggs': 'DAIRY',
  bakery: 'BAKERY',
  pantry: 'PANTRY',
  frozen: 'FROZEN',
  snacks: 'SNACKS',
  drinks: 'BEVERAGES',
  household: 'HOUSEHOLD',
  'personal-care': 'PERSONAL_CARE',
  other: 'OTHER',
};
