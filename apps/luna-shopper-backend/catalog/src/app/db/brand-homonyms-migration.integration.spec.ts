import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';

/**
 * The brand homonyms migration against real Postgres (plan 0178).
 *
 * Claims about the database rather than about the service: the table exists
 * with its unique pair, its foreign key cascades when a brand goes, `brands`
 * and its unique key are exactly as they were, and `down` takes the table away
 * and leaves every brand row behind.
 *
 * **It stops at the migration under test by name**, not by undoing whichever
 * migration happens to be last, so the next catalog migration does not break
 * it.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   docker run -d --name tmp-pg-catalog -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=catalog -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://postgres:pw@localhost:45991/catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0178_migration_test';

/** The migration under test, and therefore the one `down` is run back to. */
const UNDER_TEST = 'BrandHomonyms1758700000000';

describeIntegration('the brand homonyms migration (real Postgres)', () => {
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
    await dataSource.query(`DELETE FROM "brand_homonyms"`);
    await dataSource.query(`DELETE FROM "brands"`);
  });

  const brand = async (key: string, label: string): Promise<string> => {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "brands" ("key", "label") VALUES ($1, $2) RETURNING "id"`,
      [key, label]
    );
    return id as string;
  };

  const homonym = (printedKey: string, brandId: string) =>
    dataSource.query(
      `INSERT INTO "brand_homonyms" ("printedKey", "brandId") VALUES ($1, $2)`,
      [printedKey, brandId]
    );

  /** Undo migrations, newest first, until the one under test is gone. */
  async function undoThroughUnderTest(): Promise<void> {
    for (;;) {
      const [last] = await dataSource.query(
        `SELECT "name" FROM "migrations" ORDER BY "id" DESC LIMIT 1`
      );
      await dataSource.undoLastMigration();
      if (!last || last.name === UNDER_TEST) {
        return;
      }
    }
  }

  it('is newer than every other catalog migration', () => {
    const stamps = CATALOG_MIGRATIONS.map((migration) =>
      Number(/(\d{13})$/.exec(migration.name)?.[1])
    );
    const own = Number(/(\d{13})$/.exec(UNDER_TEST)?.[1]);
    const before = stamps.slice(0, stamps.indexOf(own));

    expect(before.length).toBeGreaterThan(0);
    expect(before.every((stamp) => stamp < own)).toBe(true);
  });

  it('writes no row of its own, into either table', async () => {
    // `beforeEach` emptied both, so this reads the migration through a fresh
    // schema: what it leaves behind is what a person will fill.
    const scratch = `${SCHEMA}_fresh`;
    await dataSource.query(`DROP SCHEMA IF EXISTS "${scratch}" CASCADE`);
    await dataSource.query(`CREATE SCHEMA "${scratch}"`);
    const fresh = new DataSource({
      type: 'postgres',
      url: requiredEnv('CATALOG_DB_URL'),
      schema: scratch,
      migrations: CATALOG_MIGRATIONS,
      synchronize: false,
      extra: { options: `-c search_path=${scratch},public` },
    });
    try {
      await fresh.initialize();
      await fresh.runMigrations();
      const [{ homonyms }] = await fresh.query(
        `SELECT count(*)::int AS "homonyms" FROM "brand_homonyms"`
      );
      const [{ brands }] = await fresh.query(
        `SELECT count(*)::int AS "brands" FROM "brands"`
      );
      expect({ homonyms, brands }).toEqual({ homonyms: 0, brands: 0 });
    } finally {
      if (fresh.isInitialized) {
        await fresh.query(`DROP SCHEMA IF EXISTS "${scratch}" CASCADE`);
        await fresh.destroy();
      }
    }
  }, 180_000);

  it('lets one printed key point at several brands, and one pair exist once', async () => {
    const poseidon = await brand('poseidon', 'Poseidon');
    const food = await brand('poseidonfood', 'Poseidon Food');
    const mar = await brand('poseidonmar', 'Poseidon Mar');

    await homonym('poseidon', food);
    await homonym('poseidon', mar);
    await expect(homonym('poseidon', food)).rejects.toThrow(
      /uq_brand_homonyms_key_brand/
    );

    // The key itself is still one brand's, and only one.
    const holders = await dataSource.query(
      `SELECT "id" FROM "brands" WHERE "key" = 'poseidon'`
    );
    expect(holders).toEqual([{ id: poseidon }]);
  }, 180_000);

  it('refuses a homonym of a brand that does not exist, and goes with a brand that is deleted', async () => {
    const food = await brand('poseidonfood', 'Poseidon Food');
    await expect(
      homonym('poseidon', '99999999-9999-4999-8999-999999999999')
    ).rejects.toThrow(/fk_brand_homonyms_brand/);

    await homonym('poseidon', food);
    await dataSource.query(`DELETE FROM "brands" WHERE "id" = $1`, [food]);

    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS "count" FROM "brand_homonyms"`
    );
    expect(count).toBe(0);
  }, 180_000);

  it('goes down to a schema with no homonyms and every brand still there, and up again', async () => {
    const food = await brand('poseidonfood', 'Poseidon Food');
    await brand('do', 'D.O.');
    await homonym('poseidon', food);

    await undoThroughUnderTest();
    try {
      const [{ table }] = await dataSource.query(
        `SELECT to_regclass('"${SCHEMA}"."brand_homonyms"') AS "table"`
      );
      expect(table).toBeNull();
      // No brand is deleted or renamed by this migration, in either direction.
      const rows = await dataSource.query(
        `SELECT "key", "label" FROM "brands" ORDER BY "key" ASC`
      );
      expect(rows).toEqual([
        { key: 'do', label: 'D.O.' },
        { key: 'poseidonfood', label: 'Poseidon Food' },
      ]);
    } finally {
      await dataSource.runMigrations();
    }

    const [{ table }] = await dataSource.query(
      `SELECT to_regclass('"${SCHEMA}"."brand_homonyms"') AS "table"`
    );
    expect(table).not.toBeNull();
    await homonym('poseidon', food);
  }, 180_000);
});
