import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';

/**
 * The merged items migration against real Postgres (plan 0239).
 *
 * Claims about the database, which only a database can make:
 *
 * - Every existing product is live after it: both columns are null.
 * - A product cannot name itself, and cannot name a product that does not
 *   exist.
 * - A survivor cannot be deleted while a merged row names it
 *   (`ON DELETE RESTRICT`), and can be once nothing does.
 * - `down` takes the columns away and leaves every product behind, and `up`
 *   runs again after it.
 *
 * **It stops at the migration under test by name**, so the next catalog
 * migration does not break it. It reads and writes `items` with SQL of its
 * own, never through the entity, so a later column cannot break it either.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=merged-items-migration.integration.spec.ts
 */
const SCHEMA = 'plan0239_migration_test';

/** The migration under test, and therefore the one `down` is run back to. */
const UNDER_TEST = 'MergedItems1759100000000';

describeIntegration('the merged items migration (real Postgres)', () => {
  let dataSource: DataSource;
  /** Products written before the migration ran. */
  let before: string[];

  const product = async (name: string): Promise<string> => {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "items" ("name") VALUES ($1::jsonb) RETURNING "id"`,
      [JSON.stringify({ es: name })]
    );
    return id as string;
  };

  const columns = async (): Promise<string[]> =>
    (
      (await dataSource.query(
        `SELECT "column_name" FROM "information_schema"."columns"
          WHERE "table_schema" = $1 AND "table_name" = 'items'
            AND "column_name" IN ('mergedIntoId', 'mergedAt')
          ORDER BY "column_name"`,
        [SCHEMA]
      )) as { column_name: string }[]
    ).map((row) => row.column_name);

  /** Undo migrations, newest first, until the one under test is gone. */
  async function undoThroughUnderTest(): Promise<void> {
    for (;;) {
      const [last] = (await dataSource.query(
        `SELECT "name" FROM "migrations" ORDER BY "timestamp" DESC LIMIT 1`
      )) as { name: string }[];
      await dataSource.undoLastMigration();
      if (last.name === UNDER_TEST) {
        return;
      }
    }
  }

  beforeAll(async () => {
    const url = requiredEnv('CATALOG_DB_URL');

    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    // A prefix of the list, through the migration before the one under test,
    // then products in that schema, then the rest.
    const through = CATALOG_MIGRATIONS.slice(
      0,
      CATALOG_MIGRATIONS.findIndex((m) => m.name === UNDER_TEST)
    );
    const early = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      migrations: through,
      synchronize: false,
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await early.initialize();
    await early.runMigrations();
    dataSource = early;
    before = [await product('Leche'), await product('Pan')];
    await early.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      migrations: CATALOG_MIGRATIONS,
      synchronize: false,
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  it('adds both columns and leaves every existing product live', async () => {
    expect(await columns()).toEqual(['mergedAt', 'mergedIntoId']);
    const rows = (await dataSource.query(
      `SELECT "id", "mergedIntoId", "mergedAt" FROM "items"
        WHERE "id" = ANY($1::uuid[])`,
      [before]
    )) as { mergedIntoId: string | null; mergedAt: Date | null }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.mergedIntoId).toBeNull();
      expect(row.mergedAt).toBeNull();
    }
  });

  it('refuses a product that names itself, or a product that does not exist', async () => {
    const [milk] = before;
    await expect(
      dataSource.query(
        `UPDATE "items" SET "mergedIntoId" = "id" WHERE "id" = $1`,
        [milk]
      )
    ).rejects.toThrow(/ck_items_merged_into_other/);
    await expect(
      dataSource.query(
        `UPDATE "items" SET "mergedIntoId" = $2 WHERE "id" = $1`,
        [milk, '00000000-0000-4000-8000-000000000239']
      )
    ).rejects.toThrow(/fk_items_merged_into/);
  });

  it('keeps a survivor while a merged row names it, and lets it go after', async () => {
    const merged = await product('Leche entera');
    const survivor = await product('Leche entera.');
    await dataSource.query(
      `UPDATE "items" SET "mergedIntoId" = $2, "mergedAt" = now() WHERE "id" = $1`,
      [merged, survivor]
    );

    await expect(
      dataSource.query(`DELETE FROM "items" WHERE "id" = $1`, [survivor])
    ).rejects.toThrow(/fk_items_merged_into/);

    // The merged row can go, and then the survivor can.
    await dataSource.query(`DELETE FROM "items" WHERE "id" = $1`, [merged]);
    await dataSource.query(`DELETE FROM "items" WHERE "id" = $1`, [survivor]);
  });

  it('indexes the merged rows by their survivor', async () => {
    const [row] = (await dataSource.query(
      `SELECT "indexdef" FROM "pg_indexes"
        WHERE "schemaname" = $1 AND "indexname" = 'ix_items_merged_into'`,
      [SCHEMA]
    )) as { indexdef: string }[];
    expect(row.indexdef).toMatch(/\("mergedIntoId"\)/);
    expect(row.indexdef).toMatch(/WHERE \("mergedIntoId" IS NOT NULL\)/);
  });

  it('down drops the columns and keeps every product, and up runs again', async () => {
    const merged = await product('Yogur');
    const survivor = await product('Yogur natural');
    await dataSource.query(
      `UPDATE "items" SET "mergedIntoId" = $2, "mergedAt" = now() WHERE "id" = $1`,
      [merged, survivor]
    );

    await undoThroughUnderTest();
    expect(await columns()).toEqual([]);
    const [{ count }] = (await dataSource.query(
      `SELECT count(*)::int AS "count" FROM "items"
        WHERE "id" = ANY($1::uuid[])`,
      [[...before, merged, survivor]]
    )) as { count: number }[];
    expect(count).toBe(4);

    await dataSource.runMigrations();
    expect(await columns()).toEqual(['mergedAt', 'mergedIntoId']);
  });
});
