import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';

/**
 * The brand link column against real Postgres (plan 0124, sections 2 and 9).
 *
 * Three claims, and every one of them is a claim about the database rather than
 * about the service: the column exists, its foreign key names `brands` and sets
 * null rather than cascading, and the check refuses a row that is its own
 * canonical brand. The one level rule itself is not here, because no constraint
 * can hold it: it reads a second row, and `BrandService` is where it lives.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   docker run -d --name tmp-pg-catalog -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=catalog -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://postgres:pw@localhost:45991/catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0124_migration_test';

/** The migration under test, and therefore the one this file stops before. */
const UNDER_TEST = 'BrandLinks1757600000000';

describeIntegration('the brand links migration (real Postgres)', () => {
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
    await dataSource.runMigrations();
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM "items"`);
    await dataSource.query(`DELETE FROM "brands"`);
  });

  const insert = (
    key: string,
    label: string,
    canonical: string | null = null
  ) =>
    dataSource.query(
      `INSERT INTO "brands" ("key", "label", "canonicalBrandId")
       VALUES ($1, $2, $3) RETURNING "id"`,
      [key, label, canonical]
    );

  it('points one brand at another, and sets null when that one goes away', async () => {
    const [{ id: canonicalId }] = await insert('deborah', 'Deborah');
    const [{ id: spellingId }] = await insert(
      'deborah48h',
      'DEBORAH 48H',
      canonicalId
    );

    // There is no delete route for a canonical brand, so this is the raw
    // statement rather than the service: what is under test is the foreign
    // key's own behaviour, which is what a later plan would rely on.
    await dataSource.query(`DELETE FROM "brands" WHERE "id" = $1`, [
      canonicalId,
    ]);

    const [row] = await dataSource.query(
      `SELECT "canonicalBrandId" FROM "brands" WHERE "id" = $1`,
      [spellingId]
    );
    // ON DELETE SET NULL: the spelling goes back to standing for itself rather
    // than vanishing with the brand it pointed at.
    expect(row.canonicalBrandId).toBeNull();
  }, 180_000);

  it('refuses a brand that is its own canonical brand', async () => {
    const [{ id }] = await insert('deborah', 'Deborah');

    await expect(
      dataSource.query(
        `UPDATE "brands" SET "canonicalBrandId" = "id" WHERE "id" = $1`,
        [id]
      )
    ).rejects.toThrow(/ck_brands_not_own_canonical/);
  }, 180_000);

  it('refuses a link to a brand that does not exist', async () => {
    await expect(
      insert(
        'deborah48h',
        'DEBORAH 48H',
        '11111111-1111-4111-8111-111111111111'
      )
    ).rejects.toThrow(/fk_brands_canonical/);
  }, 180_000);

  it('reverses to the schema it found, dropping the column', async () => {
    const at = CATALOG_MIGRATIONS.findIndex(
      (migration) => migration.name === UNDER_TEST
    );
    expect(at).toBeGreaterThanOrEqual(0);
    // Counted from the end, so the next plan to add a migration does not have
    // to remember this file.
    for (let i = at; i < CATALOG_MIGRATIONS.length; i += 1) {
      await dataSource.undoLastMigration();
    }

    const columns = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'brands'`,
      [SCHEMA]
    );
    const names = new Set(
      columns.map((column: { column_name: string }) => column.column_name)
    );
    expect(names.has('canonicalBrandId')).toBe(false);

    // And back up, so the suites after this one meet the schema they expect.
    await dataSource.runMigrations();
  }, 180_000);
});
