import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';
import {
  CategoryTree1758100000000,
  LANDING_LEAVES,
} from './migrations/1758100000000-CategoryTree';
import { categoryId } from './reference/ids';

/**
 * The category tree migration against real Postgres (plan 0166, section 6),
 * and the three rules it puts in the database (sections 1 and 2).
 *
 * The schema is migrated through a **prefix** of the list: everything before
 * this migration, products seeded with the old enum column, then this
 * migration. That is the state a developer's slot with a harvest passes
 * through, and it is what proves no product is left without a category.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=category-tree-migration.integration.spec.ts
 */
const SCHEMA = 'plan0166_migration_test';

const UNDER_TEST = 'CategoryTree1758100000000';
const THROUGH = CATALOG_MIGRATIONS.slice(
  0,
  CATALOG_MIGRATIONS.findIndex((m) => m.name === UNDER_TEST) + 1
);
const BEFORE = THROUGH.slice(0, -1);

/** The twelve old values, and one product of each. */
const OLD_VALUES = LANDING_LEAVES.map((leaf) => leaf.from);

describeIntegration('the category tree migration (real Postgres)', () => {
  const url = () => requiredEnv('CATALOG_DB_URL');
  let dataSource: DataSource;

  function connect(migrations: typeof CATALOG_MIGRATIONS): Promise<DataSource> {
    return new DataSource({
      type: 'postgres',
      url: url(),
      schema: SCHEMA,
      migrations,
      synchronize: false,
      extra: { options: `-c search_path=${SCHEMA},public` },
    }).initialize();
  }

  /** The Postgres error a statement fails with, or null when it succeeds. */
  async function refusal(
    sql: string,
    params: unknown[] = []
  ): Promise<{ code?: string; constraint?: string } | null> {
    try {
      await dataSource.query(sql, params);
      return null;
    } catch (error) {
      const driver = (
        error as { driverError?: { code?: string; constraint?: string } }
      ).driverError;
      return { code: driver?.code, constraint: driver?.constraint };
    }
  }

  beforeAll(async () => {
    const bootstrap = new DataSource({ type: 'postgres', url: url() });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    // Everything before this migration, and a product for each old value.
    const before = await connect(BEFORE);
    try {
      await before.runMigrations();
      for (const value of OLD_VALUES) {
        await before.query(
          `INSERT INTO "items" ("name", "category", "defaultUnit")
           VALUES ($1::jsonb, $2, 'UNIT')`,
          [JSON.stringify({ es: `Producto ${value}` }), value]
        );
      }
    } finally {
      await before.destroy();
    }

    dataSource = await connect(THROUGH);
    await dataSource.runMigrations();
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  it('is the last step of the prefix it is tested through', () => {
    expect(THROUGH[THROUGH.length - 1]).toBe(CategoryTree1758100000000);
    expect(BEFORE).not.toContain(CategoryTree1758100000000);
  });

  it('leaves no product without a category, each on its landing leaf', async () => {
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS "count" FROM "items" i
        WHERE NOT EXISTS (
          SELECT 1 FROM "item_categories" ic WHERE ic."itemId" = i."id"
        )`
    );
    expect(count).toBe(0);

    const rows: { name: { es: string }; slug: string; position: number }[] =
      await dataSource.query(
        `SELECT i."name", c."slug", ic."position"
           FROM "items" i
           JOIN "item_categories" ic ON ic."itemId" = i."id"
           JOIN "categories" c ON c."id" = ic."categoryId"`
      );
    expect(rows).toHaveLength(OLD_VALUES.length);
    for (const leaf of LANDING_LEAVES) {
      const row = rows.find((r) => r.name.es === `Producto ${leaf.from}`);
      expect(`${leaf.from} -> ${row?.slug}@${row?.position}`).toBe(
        `${leaf.from} -> ${leaf.slug}@0`
      );
    }
  });

  it('inserts the roots and the landing leaves under the ids the seed derives', async () => {
    const rows: { id: string; slug: string; parentId: string | null }[] =
      await dataSource.query(
        `SELECT "id", "slug", "parentId" FROM "categories"`
      );
    expect(rows.filter((r) => r.parentId === null)).toHaveLength(17);
    expect(rows.filter((r) => r.parentId !== null)).toHaveLength(12);
    for (const row of rows) {
      expect(row.id).toBe(categoryId(row.slug));
    }
  });

  it('drops the column and the enum type', async () => {
    const columns = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'items'`,
      [SCHEMA]
    );
    expect(
      columns.map((c: { column_name: string }) => c.column_name)
    ).not.toContain('category');
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS "count" FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'item_category' AND n.nspname = $1`,
      [SCHEMA]
    );
    expect(count).toBe(0);
  });

  describe('the rules the database holds', () => {
    const DAIRY = categoryId('dairy-and-eggs');
    const MEAT = categoryId('meat');
    const OTHER_DAIRY = categoryId('other-dairy');
    let itemId: string;

    beforeAll(async () => {
      [{ id: itemId }] = await dataSource.query(
        `INSERT INTO "items" ("name", "defaultUnit")
         VALUES ('{"es":"Regla"}'::jsonb, 'UNIT') RETURNING "id"`
      );
    });

    it('R1: refuses a parent that is itself a child', async () => {
      expect(
        await refusal(
          `INSERT INTO "categories" ("slug", "name", "position", "parentId")
           VALUES ('too-deep', '{"en":"Too deep"}'::jsonb, 0, $1)`,
          [OTHER_DAIRY]
        )
      ).toEqual({ code: '23514', constraint: 'ck_categories_two_levels' });
    });

    it('R1: refuses a parent for a root that has children', async () => {
      expect(
        await refusal(
          `UPDATE "categories" SET "parentId" = $1 WHERE "id" = $2`,
          [MEAT, DAIRY]
        )
      ).toEqual({ code: '23514', constraint: 'ck_categories_two_levels' });
    });

    it('R2: refuses a product on a root', async () => {
      expect(
        await refusal(
          `INSERT INTO "item_categories" ("itemId", "categoryId", "position")
           VALUES ($1, $2, 0)`,
          [itemId, DAIRY]
        )
      ).toEqual({ code: '23514', constraint: 'ck_item_categories_leaf' });
    });

    it('R2: refuses making a root of a child that holds products', async () => {
      await dataSource.query(
        `INSERT INTO "item_categories" ("itemId", "categoryId", "position")
         VALUES ($1, $2, 0)`,
        [itemId, OTHER_DAIRY]
      );
      expect(
        await refusal(
          `UPDATE "categories" SET "parentId" = NULL WHERE "id" = $1`,
          [OTHER_DAIRY]
        )
      ).toEqual({ code: '23514', constraint: 'ck_item_categories_leaf' });
    });

    it('R4: refuses deleting a category with products, or one with children', async () => {
      expect(
        await refusal(`DELETE FROM "categories" WHERE "id" = $1`, [OTHER_DAIRY])
      ).toEqual({ code: '23503', constraint: 'fk_item_categories_category' });
      expect(
        await refusal(`DELETE FROM "categories" WHERE "id" = $1`, [DAIRY])
      ).toEqual({ code: '23503', constraint: 'fk_categories_parent' });
    });

    it('lets an empty leaf and an empty root go', async () => {
      const [{ id: root }] = await dataSource.query(
        `INSERT INTO "categories" ("slug", "name", "position")
         VALUES ('empty-root', '{"en":"Empty"}'::jsonb, 99) RETURNING "id"`
      );
      const [{ id: leaf }] = await dataSource.query(
        `INSERT INTO "categories" ("slug", "name", "position", "parentId")
         VALUES ('empty-leaf', '{"en":"Empty leaf"}'::jsonb, 0, $1) RETURNING "id"`,
        [root]
      );
      expect(
        await refusal(`DELETE FROM "categories" WHERE "id" = $1`, [leaf])
      ).toBeNull();
      expect(
        await refusal(`DELETE FROM "categories" WHERE "id" = $1`, [root])
      ).toBeNull();
    });

    it('deletes a product’s rows with the product', async () => {
      await dataSource.query(`DELETE FROM "items" WHERE "id" = $1`, [itemId]);
      const [{ count }] = await dataSource.query(
        `SELECT count(*)::int AS "count" FROM "item_categories" WHERE "itemId" = $1`,
        [itemId]
      );
      expect(count).toBe(0);
    });
  });

  it('down puts the enum back from each product’s first root, and up moves it again', async () => {
    // A product on a leaf whose root has no enum value comes back as OTHER.
    await dataSource.query(
      `INSERT INTO "categories" ("id", "slug", "name", "position", "parentId")
       VALUES ($1, 'pizzas', '{"en":"Pizzas"}'::jsonb, 0, $2)`,
      [categoryId('pizzas'), categoryId('ready-meals')]
    );
    const [{ id: pizza }] = await dataSource.query(
      `INSERT INTO "items" ("name", "defaultUnit")
       VALUES ('{"es":"Pizza"}'::jsonb, 'UNIT') RETURNING "id"`
    );
    await dataSource.query(
      `INSERT INTO "item_categories" ("itemId", "categoryId", "position")
       VALUES ($1, $2, 0), ($1, $3, 1)`,
      [pizza, categoryId('pizzas'), categoryId('other-frozen')]
    );

    await dataSource.undoLastMigration();
    const back: { es: string; category: string }[] = await dataSource.query(
      `SELECT "name" ->> 'es' AS "es", "category"::text AS "category" FROM "items"`
    );
    const byName = new Map(back.map((row) => [row.es, row.category]));
    for (const value of OLD_VALUES) {
      expect(`${value}: ${byName.get(`Producto ${value}`)}`).toBe(
        `${value}: ${value}`
      );
    }
    expect(byName.get('Pizza')).toBe('OTHER');

    await dataSource.runMigrations();
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS "count" FROM "items" i
        WHERE NOT EXISTS (
          SELECT 1 FROM "item_categories" ic WHERE ic."itemId" = i."id"
        )`
    );
    expect(count).toBe(0);
  }, 120_000);
});
