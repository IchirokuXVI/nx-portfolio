import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';

/**
 * The migration test plan 0038 section 9 asks for, against real Postgres.
 *
 * It seeds the **pre-migration** shape (prices keyed on a store, with a position
 * in the aisle), runs the section 5.2 migration, and asserts the one property the
 * whole re-keying rests on: **every existing price still resolves to the same
 * value through its new STORE scope**, and `positionInStore` survived the move.
 *
 * A mocked repository cannot check any of that. The migration is 30 statements of
 * SQL whose correctness is entirely about what the data looks like afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 *
 * It works in a scratch schema of its own and drops it afterwards, so it never
 * touches the developer's own catalog data.
 */
const SCHEMA = 'plan0038_migration_test';

describeIntegration('price scope migration (real Postgres)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    const url = requiredEnv('CATALOG_DB_URL');

    // The scratch schema has to exist before a DataSource can be pointed at it.
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
      // `schema` alone does NOT put the migrations in the scratch schema. It
      // qualifies the names TypeORM generates from entity metadata, and a
      // migration is raw SQL naming `"items"` with no schema at all, so every
      // statement here resolves against the connection's search_path, which is
      // `public`. Against a database the stack has already migrated that means
      // `CREATE TYPE "item_category"` fails as already existing, and, worse,
      // the undo below would drop the developer's real tables.
      //
      // Postgres has no `SET SCHEMA` for a session, so the search_path is set
      // for the connection itself, through the startup parameter pg forwards.
      // `public` is deliberately left out rather than kept as a fallback: an
      // object this test fails to create in the scratch schema must error,
      // never silently resolve to the real one and get dropped.
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

  it('carries every pre-migration price across to a STORE scope unchanged', async () => {
    // 1. The world as it was: the baseline schema only.
    await dataSource.runMigrations();
    await dataSource.undoLastMigration();

    // 2. Two stores of one chain, each with its own price for the same item and
    //    its own aisle. This is exactly the twelve-identical-rows shape the scope
    //    exists to collapse, in miniature.
    const [{ id: supermarketId }] = await dataSource.query(`
      INSERT INTO "supermarkets" ("name") VALUES ('{"en":"Mercadona","es":"Mercadona"}')
      RETURNING id
    `);
    const [{ id: locationA }] = await dataSource.query(
      `INSERT INTO "supermarket_locations" ("supermarketId", "city")
       VALUES ($1, 'Córdoba') RETURNING id`,
      [supermarketId]
    );
    const [{ id: locationB }] = await dataSource.query(
      `INSERT INTO "supermarket_locations" ("supermarketId", "city")
       VALUES ($1, 'Córdoba') RETURNING id`,
      [supermarketId]
    );
    const [{ id: itemId }] = await dataSource.query(`
      INSERT INTO "items" ("name", "category", "defaultUnit")
      VALUES ('{"en":"Olive oil","es":"Aceite de oliva"}', 'PANTRY', 'LITER')
      RETURNING id
    `);
    await dataSource.query(
      `INSERT INTO "supermarket_items"
         ("itemId", "supermarketLocationId", "price", "currency", "positionInStore", "available")
       VALUES ($1, $2, 8.75, 'EUR', 'Aisle 3', true),
              ($1, $3, 8.95, 'EUR', 'Aisle 1', false)`,
      [itemId, locationA, locationB]
    );

    // 3. Forward.
    await dataSource.runMigrations();

    // Every location now points at a STORE scope of its own, keyed on its id.
    const locations = await dataSource.query(
      `SELECT l."id", l."priceScopeId", s."kind", s."externalKey"
       FROM "supermarket_locations" l
       JOIN "price_scopes" s ON s."id" = l."priceScopeId"
       ORDER BY l."city", l."id"`
    );
    expect(locations).toHaveLength(2);
    for (const row of locations) {
      expect(row.kind).toBe('STORE');
      expect(row.externalKey).toBe(row.id);
    }

    // The property that matters: each store still resolves to the price it had.
    const prices = await dataSource.query(
      `SELECT l."id" AS "locationId", si."price", si."available", si."priceSourceKind"
       FROM "supermarket_items" si
       JOIN "supermarket_locations" l ON l."priceScopeId" = si."priceScopeId"
       WHERE si."itemId" = $1`,
      [itemId]
    );
    const byLocation = new Map(
      prices.map((p: { locationId: string }) => [p.locationId, p])
    );
    expect(Number(byLocation.get(locationA).price)).toBe(8.75);
    expect(Number(byLocation.get(locationB).price)).toBe(8.95);
    expect(byLocation.get(locationB).available).toBe(false);
    // A price that was already there was typed in by a person, and saying so is
    // what stops the first import writing over it (section 6.5).
    expect(byLocation.get(locationA).priceSourceKind).toBe('ADMIN');

    // And the aisle survived the move to its own table.
    const positions = await dataSource.query(
      `SELECT "supermarketLocationId", "positionInStore", "available"
       FROM "supermarket_location_items" WHERE "itemId" = $1`,
      [itemId]
    );
    expect(positions).toHaveLength(2);
    const byStore = new Map(
      positions.map((p: { supermarketLocationId: string }) => [
        p.supermarketLocationId,
        p,
      ])
    );
    expect(byStore.get(locationA).positionInStore).toBe('Aisle 3');
    expect(byStore.get(locationB).positionInStore).toBe('Aisle 1');
    // Copied as an explicit override, because these rows genuinely WERE per
    // store: someone had checked that shop.
    expect(byStore.get(locationB).available).toBe(false);
  }, 120_000);

  it('reverses cleanly, putting the prices back on their stores', async () => {
    // Forward, back, forward. A down migration after a real harvest is not a
    // routine operation, but one that leaves the schema unusable is a trap.
    await dataSource.undoLastMigration();

    const columns = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'supermarket_items'`,
      [SCHEMA]
    );
    const names = new Set(
      columns.map((c: { column_name: string }) => c.column_name)
    );
    expect(names.has('supermarketLocationId')).toBe(true);
    expect(names.has('positionInStore')).toBe(true);
    expect(names.has('priceScopeId')).toBe(false);

    const rows = await dataSource.query(
      `SELECT "price", "positionInStore" FROM "supermarket_items" ORDER BY "price"`
    );
    expect(rows.map((r: { price: string }) => Number(r.price))).toEqual([
      8.75, 8.95,
    ]);
    expect(rows.map((r: { positionInStore: string }) => r.positionInStore)).toEqual(
      ['Aisle 3', 'Aisle 1']
    );

    await dataSource.runMigrations();
  }, 120_000);
});
