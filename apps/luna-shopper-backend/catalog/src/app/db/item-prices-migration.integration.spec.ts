import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { EffectivePriceService } from '../catalog/effective-price.service';
import { EffectivePriceSweep } from '../catalog/effective-price.sweep';
import { CATALOG_ENTITIES } from '../entities';
import { CATALOG_MIGRATIONS } from './migrations';

/**
 * The migration test plan 0080 section 8 asks for, against real Postgres.
 *
 * It seeds the pre migration shape, one price per (item, scope) on
 * `supermarket_items` with nothing behind it, runs the migration, and asserts
 * the property the whole plan rests on: **every pre existing row resolves to
 * the same price after the migration as before it**, with one `item_prices`
 * row standing behind it. It also asserts that a crawl row eight days old is
 * marked stale by the first sweep and not by the migration.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0080_migration_test';

const DAY_MS = 24 * 60 * 60 * 1000;

describeIntegration('item prices migration (real Postgres)', () => {
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
      entities: CATALOG_ENTITIES,
      migrations: CATALOG_MIGRATIONS,
      synchronize: false,
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

  it('carries every pre existing price across unchanged, with a row behind it', async () => {
    // 1. The world as it was: everything up to plan 0075.
    await dataSource.runMigrations();
    await dataSource.undoLastMigration();

    // 2. A chain with one warehouse scope, and three rows in the old shape:
    //    a crawl price eight days old, a typed price, and an availability only
    //    row with no price at all.
    const [{ id: supermarketId }] = await dataSource.query(`
      INSERT INTO "supermarkets" ("name") VALUES ('{"en":"Chain","es":"Cadena"}')
      RETURNING id
    `);
    const [{ id: scopeId }] = await dataSource.query(
      `INSERT INTO "price_scopes" ("supermarketId", "kind", "externalKey")
       VALUES ($1, 'WAREHOUSE', '4661') RETURNING id`,
      [supermarketId]
    );
    const ids: string[] = [];
    for (const name of ['Milk', 'Bread', 'Eggs']) {
      const [{ id }] = await dataSource.query(
        `INSERT INTO "items" ("name", "category", "defaultUnit")
         VALUES ($1, 'PANTRY', 'UNIT') RETURNING id`,
        [JSON.stringify({ en: name, es: name })]
      );
      ids.push(id);
    }
    const [milk, bread, eggs] = ids;
    const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS);
    await dataSource.query(
      `INSERT INTO "supermarket_items"
         ("itemId", "priceScopeId", "price", "currency", "unitPrice", "unitPriceLabel",
          "priceObservedAt", "priceSourceKind", "available")
       VALUES ($1, $4, 1.19, 'EUR', 1.19, 'L', $5, 'OFFICIAL_API', true),
              ($2, $4, 2.10, 'EUR', NULL, NULL, NULL, 'ADMIN', true),
              ($3, $4, NULL, NULL, NULL, NULL, NULL, 'OFFICIAL_API', false)`,
      [milk, bread, eggs, scopeId, eightDaysAgo]
    );

    // 3. Forward.
    await dataSource.runMigrations();

    const rows = await dataSource.query(
      `SELECT si."itemId", si."price", si."priceSourceKind", si."itemPriceId",
              si."stale", si."nextBoundaryAt", si."available", si."priceObservedAt",
              p."sourceKind", p."price" AS "rowPrice", p."observedAt", p."lastObservedAt",
              p."overrides", p."protectedUntil", p."sourceRunId"
       FROM "supermarket_items" si
       LEFT JOIN "item_prices" p ON p."id" = si."itemPriceId"`
    );
    const byItem = new Map(rows.map((r: { itemId: string }) => [r.itemId, r]));

    // The crawl row: same price, a row behind it, a boundary a week after it
    // was seen, and not stale, because the migration does not judge that.
    const milkRow = byItem.get(milk);
    expect(Number(milkRow.price)).toBe(1.19);
    expect(Number(milkRow.rowPrice)).toBe(1.19);
    expect(milkRow.sourceKind).toBe('OFFICIAL_API');
    expect(milkRow.stale).toBe(false);
    expect(new Date(milkRow.observedAt)).toEqual(eightDaysAgo);
    expect(new Date(milkRow.lastObservedAt)).toEqual(eightDaysAgo);
    expect(new Date(milkRow.nextBoundaryAt)).toEqual(
      new Date(eightDaysAgo.getTime() + 7 * DAY_MS)
    );
    expect(milkRow.sourceRunId).toBeNull();

    // The typed row: an empty snapshot and no protection, because nothing typed
    // before this plan was typed against a snapshot.
    const breadRow = byItem.get(bread);
    expect(Number(breadRow.price)).toBe(2.1);
    expect(breadRow.sourceKind).toBe('ADMIN');
    expect(breadRow.overrides).toEqual({});
    expect(breadRow.protectedUntil).toBeNull();
    expect(breadRow.nextBoundaryAt).toBeNull();
    // `priceObservedAt` was null, so the row's date is when it was created.
    expect(breadRow.observedAt).not.toBeNull();
    expect(new Date(breadRow.priceObservedAt)).toEqual(
      new Date(breadRow.observedAt)
    );

    // The availability only row: no price row, no source, the flag kept.
    const eggsRow = byItem.get(eggs);
    expect(eggsRow.itemPriceId).toBeNull();
    expect(eggsRow.priceSourceKind).toBeNull();
    expect(eggsRow.available).toBe(false);

    const policies = await dataSource.query(
      `SELECT "sourceKind", "priority", "maxAgeDays", "enabled" FROM "price_policies" ORDER BY "priority"`
    );
    expect(policies.map((p: { sourceKind: string }) => p.sourceKind)).toEqual([
      'OFFICIAL_LEAFLET',
      'OFFICIAL_API',
      'OFFICIAL_WEB',
      'ADMIN',
      'USER_RECEIPT',
      'USER_REPORTED',
    ]);
    expect(policies[4].maxAgeDays).toBeNull();
    expect(policies[5].enabled).toBe(false);

    // 4. The first sweep marks the eight day old crawl stale. The migration did
    //    not, and the typed row is left alone.
    const sweep = new EffectivePriceSweep(
      dataSource,
      new EffectivePriceService()
    );
    expect(await sweep.tick(new Date())).toBe(1);
    const after = await dataSource.query(
      `SELECT "itemId", "stale", "price" FROM "supermarket_items"`
    );
    const staleByItem = new Map(
      after.map((r: { itemId: string; stale: boolean }) => [r.itemId, r.stale])
    );
    expect(staleByItem.get(milk)).toBe(true);
    expect(staleByItem.get(bread)).toBe(false);
    expect(
      Number(after.find((r: { itemId: string }) => r.itemId === milk).price)
    ).toBe(1.19);
  }, 120_000);

  it('reverses cleanly', async () => {
    await dataSource.undoLastMigration();
    const columns = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'supermarket_items'`,
      [SCHEMA]
    );
    const names = new Set(
      columns.map((c: { column_name: string }) => c.column_name)
    );
    expect(names.has('itemPriceId')).toBe(false);
    expect(names.has('stale')).toBe(false);
    const tables = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [SCHEMA]
    );
    const tableNames = new Set(
      tables.map((t: { table_name: string }) => t.table_name)
    );
    expect(tableNames.has('item_prices')).toBe(false);
    expect(tableNames.has('price_policies')).toBe(false);
    const rows = await dataSource.query(
      `SELECT "price", "priceSourceKind" FROM "supermarket_items" ORDER BY "price" NULLS LAST`
    );
    expect(
      rows.map((r: { price: string | null }) =>
        r.price === null ? null : Number(r.price)
      )
    ).toEqual([1.19, 2.1, null]);
    await dataSource.runMigrations();
  }, 120_000);
});
