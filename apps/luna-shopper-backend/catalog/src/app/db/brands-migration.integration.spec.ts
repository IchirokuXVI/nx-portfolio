import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';

/**
 * The brands migration against real Postgres (plan 0115, sections 3.3 and 10).
 *
 * What it is correct about is entirely what the rows look like afterwards, and
 * a mocked repository can check none of it. Two claims, and they are the two the
 * plan makes:
 *
 * - **`items.brandKey` is backfilled**, with the key `brandKey` produces and not
 *   one a SQL expression approximates. `Campofrio` with its accent is the case
 *   that separates the two: no database here has `unaccent`, so a SQL backfill
 *   would have written `campofrío` and every write afterwards would have written
 *   `campofrio`, and the two would never meet.
 * - **It creates no brand.** A person creates every row, so a migration that
 *   invented a registry out of the text it found would be the automatic
 *   registration section 9 refuses.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   docker run -d --name tmp-pg-catalog -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=catalog -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://postgres:pw@localhost:45991/catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0115_migration_test';

/** The migration under test, and therefore the one this file stops before. */
const UNDER_TEST = 'Brands1757300000000';

interface KeyedRow {
  brand: string | null;
  brandKey: string | null;
  brandId: string | null;
}

describeIntegration('the brands migration (real Postgres)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    const url = requiredEnv('CATALOG_DB_URL');

    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      migrations: CATALOG_MIGRATIONS,
      synchronize: false,
      // The migrations are raw SQL naming unqualified tables, so the scratch
      // schema has to be on the search_path; `public` follows it for the
      // extensions they install.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  /**
   * The schema as it was the moment before this migration ran.
   *
   * Counted from the end rather than undone a fixed number of times, so the next
   * plan to add a migration does not have to remember this file.
   */
  async function migrateToJustBefore(): Promise<void> {
    await dataSource.runMigrations();
    await dataSource.query(`DELETE FROM "items"`);

    const after = CATALOG_MIGRATIONS.findIndex(
      (migration) => migration.name === UNDER_TEST
    );
    expect(after).toBeGreaterThanOrEqual(0);
    for (let i = after; i < CATALOG_MIGRATIONS.length; i += 1) {
      await dataSource.undoLastMigration();
    }
  }

  /** Products whose brands cover every case section 2 names. */
  async function seedPreMigration(): Promise<void> {
    const insert = (name: string, brand: string | null) =>
      dataSource.query(
        `INSERT INTO "items" ("name", "brand", "category", "defaultUnit")
         VALUES ($1::jsonb, $2, 'OTHER', 'UNIT')`,
        [JSON.stringify({ es: name }), brand]
      );
    await insert('Cerveza', 'MAHOU');
    await insert('Jamon', 'El Pozo');
    await insert('Chorizo', 'Campofrío');
    await insert('Refresco', 'Coca-Cola');
    await insert('Oferta', '---');
    await insert('Generico', null);
  }

  it('keys every branded product, and only with the key the code computes', async () => {
    await migrateToJustBefore();
    await seedPreMigration();

    await dataSource.runMigrations();

    const rows: KeyedRow[] = await dataSource.query(
      `SELECT "brand", "brandKey", "brandId" FROM "items"`
    );
    const byBrand = new Map(rows.map((row) => [row.brand, row]));

    expect(byBrand.get('MAHOU')?.brandKey).toBe('mahou');
    expect(byBrand.get('El Pozo')?.brandKey).toBe('elpozo');
    // The accent is the case a SQL backfill gets wrong, because no database
    // here has `unaccent` and `translate` is what `catalog_norm` uses instead.
    expect(byBrand.get('Campofrío')?.brandKey).toBe('campofrio');
    expect(byBrand.get('Coca-Cola')?.brandKey).toBe('cocacola');
    // A text with no letters or digits has no key, so it has no brand.
    expect(byBrand.get('---')?.brandKey).toBeNull();
    expect(byBrand.get(null)?.brandKey).toBeNull();

    // `brand` itself is untouched: the key sits beside the text, not over it.
    expect(rows.map((row) => row.brand).sort()).toEqual(
      ['---', 'Campofrío', 'Coca-Cola', 'El Pozo', 'MAHOU', null].sort()
    );
  }, 180_000);

  it('creates no brand, and links no product to one', async () => {
    await migrateToJustBefore();
    await seedPreMigration();

    await dataSource.runMigrations();

    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM "brands"`
    );
    expect(count).toBe(0);

    const [{ linked }] = await dataSource.query(
      `SELECT count(*)::int AS linked FROM "items" WHERE "brandId" IS NOT NULL`
    );
    expect(linked).toBe(0);
  }, 180_000);

  it('reverses to the schema it found, dropping both columns and the table', async () => {
    await migrateToJustBefore();
    await seedPreMigration();
    await dataSource.runMigrations();

    await dataSource.undoLastMigration();

    const columns = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'items'`,
      [SCHEMA]
    );
    const names = new Set(
      columns.map((column: { column_name: string }) => column.column_name)
    );
    expect(names.has('brandKey')).toBe(false);
    expect(names.has('brandId')).toBe(false);

    const tables = await dataSource.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = 'brands'`,
      [SCHEMA]
    );
    expect(tables).toHaveLength(0);
  }, 180_000);
});
