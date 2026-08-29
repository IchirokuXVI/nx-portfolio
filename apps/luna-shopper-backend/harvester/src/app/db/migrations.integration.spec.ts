import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_ENTITIES } from '../entities';

/**
 * Real-Postgres integration test for the harvester schema (plan 0038).
 *
 * The interesting half is the **active-run lock**. Section 4.2 puts it in the
 * database rather than in application code precisely so it holds across restarts
 * and between two callers racing, and a partial unique index is the sort of thing
 * that either works or silently does not: a mocked repository cannot tell you
 * which, and neither can reading it.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
describeIntegration('harvester schema (real Postgres)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DELETE FROM "harvest_runs" WHERE "correlationId" = 'integration-test'`
      );
      await dataSource.destroy();
    }
  });

  it('has the harvester tables the migration creates', async () => {
    const rows = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = new Set(rows.map((r: { table_name: string }) => r.table_name));
    for (const table of [
      'supermarket_sources',
      'harvest_runs',
      'source_catalog_entries',
      'item_source_refs',
      'discovered_places',
    ]) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('allows exactly one active run per supermarket', async () => {
    const supermarketId = '5efa0000-0000-4000-a000-0000000000aa';
    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE "supermarketId" = $1`,
      [supermarketId]
    );

    await dataSource.query(
      `INSERT INTO "harvest_runs" ("supermarketId", "mode", "status", "correlationId")
       VALUES ($1, 'CATALOG_DISCOVERY', 'RUNNING', 'integration-test')`,
      [supermarketId]
    );

    // The second insert is refused by the index, not by a check that could lose
    // the race. That is the whole reason the guard lives here.
    await expect(
      dataSource.query(
        `INSERT INTO "harvest_runs" ("supermarketId", "mode", "status", "correlationId")
         VALUES ($1, 'REFRESH', 'PENDING', 'integration-test')`,
        [supermarketId]
      )
    ).rejects.toThrow(/uq_harvest_run_active/);

    // Once the first finishes the lock is released, whatever it finished as.
    await dataSource.query(
      `UPDATE "harvest_runs" SET status = 'ABORTED' WHERE "supermarketId" = $1`,
      [supermarketId]
    );
    await expect(
      dataSource.query(
        `INSERT INTO "harvest_runs" ("supermarketId", "mode", "status", "correlationId")
         VALUES ($1, 'REFRESH', 'PENDING', 'integration-test')`,
        [supermarketId]
      )
    ).resolves.toBeDefined();

    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE "supermarketId" = $1`,
      [supermarketId]
    );
  });

  it('allows exactly one active store discovery run, which has no supermarket', async () => {
    // A store discovery run is excluded from the per supermarket lock by its
    // null `supermarketId`, so it gets its own single row guard.
    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE mode = 'STORE_DISCOVERY' AND "correlationId" = 'integration-test'`
    );
    await dataSource.query(
      `INSERT INTO "harvest_runs" ("mode", "status", "correlationId")
       VALUES ('STORE_DISCOVERY', 'RUNNING', 'integration-test')`
    );
    await expect(
      dataSource.query(
        `INSERT INTO "harvest_runs" ("mode", "status", "correlationId")
         VALUES ('STORE_DISCOVERY', 'PENDING', 'integration-test')`
      )
    ).rejects.toThrow(/uq_harvest_run_active_store_discovery/);

    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE mode = 'STORE_DISCOVERY' AND "correlationId" = 'integration-test'`
    );
  });

  it('lets two different supermarkets run at once', async () => {
    // The lock is per chain, not global: nothing about fetching Mercadona says
    // another chain may not be fetched at the same time.
    const a = '5efa0000-0000-4000-a000-0000000000bb';
    const b = '5efa0000-0000-4000-a000-0000000000cc';
    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE "supermarketId" = ANY($1)`,
      [[a, b]]
    );
    for (const supermarketId of [a, b]) {
      await expect(
        dataSource.query(
          `INSERT INTO "harvest_runs" ("supermarketId", "mode", "status", "correlationId")
           VALUES ($1, 'REFRESH', 'RUNNING', 'integration-test')`,
          [supermarketId]
        )
      ).resolves.toBeDefined();
    }
    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE "supermarketId" = ANY($1)`,
      [[a, b]]
    );
  });
});
