import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';

/**
 * The shop sections migration against real Postgres (plan 0167, section 1):
 * up, down, and up again, through a **prefix** of the list ending at it.
 *
 * What the tables mean is `section.integration.spec.ts`'s claim. This file is
 * about the migration: that up creates the four tables, their indexes and both
 * triggers, that down leaves nothing behind, and that up works again after it.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=shop-sections-migration.integration.spec.ts
 */
const SCHEMA = 'plan0167_migration_test';

const UNDER_TEST = 'ShopSections1758200000000';
const THROUGH = CATALOG_MIGRATIONS.slice(
  0,
  CATALOG_MIGRATIONS.findIndex((m) => m.name === UNDER_TEST) + 1
);

const TABLES = [
  'supermarket_sections',
  'section_categories',
  'location_sections',
  'supermarket_item_sections',
];
const INDEXES = [
  'uq_supermarket_sections_slug',
  'ix_supermarket_sections_position',
  'ix_section_categories_category',
  'ix_location_sections_section',
  'ix_item_sections_item',
  'ix_item_sections_section',
];
const TRIGGERS = [
  'tg_location_sections_same_chain',
  'tg_item_sections_same_chain',
];

describeIntegration('the shop sections migration (real Postgres)', () => {
  let dataSource: DataSource;

  async function present(): Promise<{
    tables: string[];
    indexes: string[];
    triggers: string[];
  }> {
    const tables = (await dataSource.query(
      `SELECT table_name AS "name" FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = ANY($2) ORDER BY 1`,
      [SCHEMA, TABLES]
    )) as { name: string }[];
    const indexes = (await dataSource.query(
      `SELECT indexname AS "name" FROM pg_indexes
        WHERE schemaname = $1 AND indexname = ANY($2) ORDER BY 1`,
      [SCHEMA, INDEXES]
    )) as { name: string }[];
    const triggers = (await dataSource.query(
      `SELECT t.tgname AS "name" FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND t.tgname = ANY($2) ORDER BY 1`,
      [SCHEMA, TRIGGERS]
    )) as { name: string }[];
    return {
      tables: tables.map((row) => row.name),
      indexes: indexes.map((row) => row.name),
      triggers: triggers.map((row) => row.name),
    };
  }

  beforeAll(async () => {
    const url = requiredEnv('CATALOG_DB_URL');
    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = await new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      migrations: THROUGH,
      synchronize: false,
      extra: { options: `-c search_path=${SCHEMA},public` },
    }).initialize();
    await dataSource.runMigrations();
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  const everything = {
    tables: [...TABLES].sort(),
    indexes: [...INDEXES].sort(),
    triggers: [...TRIGGERS].sort(),
  };

  it('creates the four tables, their indexes and both triggers', async () => {
    expect(await present()).toEqual(everything);
  });

  it('leaves nothing behind on down, and runs up again after it', async () => {
    await dataSource.undoLastMigration();
    expect(await present()).toEqual({ tables: [], indexes: [], triggers: [] });
    const [{ functions }] = (await dataSource.query(
      `SELECT count(*)::int AS "functions" FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.proname LIKE '%sections_same_chain'`,
      [SCHEMA]
    )) as { functions: number }[];
    expect(functions).toBe(0);

    await dataSource.runMigrations();
    expect(await present()).toEqual(everything);
  });
});
