import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';

/**
 * The migration test plan 0105 section 8 asks for, against real Postgres.
 *
 * The migration adds a column, backfills it, creates a table, seeds it from the
 * column it replaces and drops that column, in one file. What that is correct
 * about is entirely what the data looks like afterwards, which is the one thing
 * a mocked repository cannot check.
 *
 * The property under test is the plan's: **every pre-migration location holds
 * exactly one scope afterwards, and its id is unchanged.** A shop whose stack
 * came out empty prices nothing, and a shop whose stack came out different
 * prices somebody else's shelf.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 *
 * It works in a scratch schema of its own and drops it afterwards, for the
 * reasons `price-scope-migration.integration.spec.ts` sets out at length.
 */
const SCHEMA = 'plan0105_migration_test';

/** The migration under test, and therefore the one this file stops before. */
const UNDER_TEST = 'PriceScopePriority1757200000000';

/**
 * The three row shapes the assertions read. `dataSource.query` answers
 * `any`, so naming them here is what makes a typo in a column alias a
 * compile error rather than an `undefined` that quietly passes.
 */
interface ScopeRow {
  id: string;
  kind: string;
  priority: number;
}
interface StackRow {
  locationId: string;
  held: number;
  priceScopeId: string;
}
interface LocationRow {
  id: string;
  priceScopeId: string;
}

describeIntegration('price scope priority migration (real Postgres)', () => {
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
      // `public` is deliberately left out: an object this test fails to create
      // in the scratch schema must error rather than resolve to the real one.
      extra: { options: `-c search_path=${SCHEMA}` },
    });
    await dataSource.initialize();
  }, 60_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  /**
   * The schema as it was the moment before this migration ran.
   *
   * Counted from the end rather than undone a fixed number of times, so the
   * next plan to add a migration does not have to remember this file.
   */
  async function migrateToJustBefore(): Promise<void> {
    await dataSource.runMigrations();
    const after = CATALOG_MIGRATIONS.findIndex(
      (migration) => migration.name === UNDER_TEST
    );
    expect(after).toBeGreaterThanOrEqual(0);
    for (let i = after; i < CATALOG_MIGRATIONS.length; i += 1) {
      await dataSource.undoLastMigration();
    }
  }

  /** A chain, three scopes and two shops, in the shape that predates the stack. */
  async function seedPreMigration() {
    const [{ id: supermarketId }] = await dataSource.query(`
      INSERT INTO "supermarkets" ("name")
      VALUES ('{"en":"Mercadona","es":"Mercadona"}')
      RETURNING id
    `);
    const scopeId = async (kind: string, externalKey: string) => {
      const [{ id }] = await dataSource.query(
        `INSERT INTO "price_scopes" ("supermarketId", "kind", "externalKey")
         VALUES ($1, $2, $3) RETURNING id`,
        [supermarketId, kind, externalKey]
      );
      return id as string;
    };
    const national = await scopeId('NATIONAL', null as unknown as string);
    const region = await scopeId('REGION', '4661');
    const store = await scopeId('STORE', 'shop-by-hand');

    const locationId = async (city: string, priceScopeId: string) => {
      const [{ id }] = await dataSource.query(
        `INSERT INTO "supermarket_locations" ("supermarketId", "city", "priceScopeId")
         VALUES ($1, $2, $3) RETURNING id`,
        [supermarketId, city, priceScopeId]
      );
      return id as string;
    };
    return {
      supermarketId,
      national,
      region,
      store,
      onRegion: await locationId('Córdoba', region),
      onStore: await locationId('Sevilla', store),
    };
  }

  it('gives every scope the priority of its kind, and renumbers none', async () => {
    await migrateToJustBefore();
    const world = await seedPreMigration();

    await dataSource.runMigrations();

    const rows: ScopeRow[] = await dataSource.query(
      `SELECT "id", "kind", "priority" FROM "price_scopes"
        WHERE "supermarketId" = $1`,
      [world.supermarketId]
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Section 2.2, and the gaps of 100 that are the reason the column is an
    // integer rather than a position in the enum.
    expect(Number(byId.get(world.store)?.priority)).toBe(100);
    expect(Number(byId.get(world.region)?.priority)).toBe(300);
    expect(Number(byId.get(world.national)?.priority)).toBe(1000);
  }, 120_000);

  it('leaves every existing shop holding exactly the scope it held', async () => {
    await migrateToJustBefore();
    const world = await seedPreMigration();

    await dataSource.runMigrations();

    const stacks: StackRow[] = await dataSource.query(
      `SELECT ls."supermarketLocationId" AS "locationId",
              count(*)::int AS "held",
              min(ls."priceScopeId"::text) AS "priceScopeId"
         FROM "supermarket_location_price_scopes" ls
        GROUP BY ls."supermarketLocationId"`
    );
    const byLocation = new Map(stacks.map((row) => [row.locationId, row]));

    // Exactly one, and the same one: the whole point of seeding the table from
    // the column rather than deriving a stack from anything cleverer.
    expect(byLocation.size).toBe(2);
    expect(byLocation.get(world.onRegion)?.held).toBe(1);
    expect(byLocation.get(world.onRegion)?.priceScopeId).toBe(world.region);
    expect(byLocation.get(world.onStore)?.held).toBe(1);
    expect(byLocation.get(world.onStore)?.priceScopeId).toBe(world.store);

    // And the column it replaced is gone, so nothing can answer twice.
    const columns = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'supermarket_locations'`,
      [SCHEMA]
    );
    const names = new Set(
      columns.map((c: { column_name: string }) => c.column_name)
    );
    expect(names.has('priceScopeId')).toBe(false);
  }, 120_000);

  it('refuses to drop a scope a shop still sells at', async () => {
    await migrateToJustBefore();
    const world = await seedPreMigration();
    await dataSource.runMigrations();

    // The `RESTRICT` kept from the column, now on the join table. A scope with
    // prices written against it must not vanish under them.
    await expect(
      dataSource.query(`DELETE FROM "price_scopes" WHERE "id" = $1`, [
        world.region,
      ])
    ).rejects.toThrow();
  }, 120_000);

  it('reverses to the single column, keeping the most specific scope', async () => {
    await migrateToJustBefore();
    const world = await seedPreMigration();
    await dataSource.runMigrations();

    // A shop given a second, wider tier after the migration. Going back cannot
    // hold two, so it keeps the more specific one and drops the other, which
    // is what losing the stack means.
    await dataSource.query(
      `INSERT INTO "supermarket_location_price_scopes"
              ("supermarketLocationId", "priceScopeId")
       VALUES ($1, $2)`,
      [world.onStore, world.national]
    );

    await dataSource.undoLastMigration();

    const rows: LocationRow[] = await dataSource.query(
      `SELECT "id", "priceScopeId" FROM "supermarket_locations"`
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(world.onStore)?.priceScopeId).toBe(world.store);
    expect(byId.get(world.onRegion)?.priceScopeId).toBe(world.region);
  }, 120_000);
});
