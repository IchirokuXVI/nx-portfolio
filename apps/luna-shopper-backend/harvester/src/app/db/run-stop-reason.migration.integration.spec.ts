import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_MIGRATIONS } from './migrations';
import { RunStopReason1759500000000 } from './migrations/1759500000000-RunStopReason';

/**
 * Why a run stopped, as a column and a type (plan 0215, section 9).
 *
 * Three claims that need a real database:
 *
 * - **The column and the type exist after it**, and the column takes the one
 *   reason and null, and nothing else.
 * - **A run from before it reads null.**
 * - **`down` removes both**, the column first and then the type.
 *
 * It runs against a probe database of its own, for the reason the
 * `OneSourceProduct` spec gives: the point is the state before the migration.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
const THROUGH = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(RunStopReason1759500000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_0215_probe';

const OLD_RUN = '02150215-0000-4000-a000-000000000001';

describeIntegration('RunStopReason1759500000000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

  const open = async (migrations: typeof THROUGH) => {
    probe = new DataSource({
      type: 'postgres',
      url: probeUrl,
      migrations,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await probe.initialize();
    await probe.runMigrations({ transaction: 'each' });
  };

  const typeExists = async (): Promise<boolean> => {
    const [row]: { found: boolean }[] = await probe.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_type WHERE typname = 'harvest_run_stop_reason'
       ) AS "found"`
    );
    return row.found;
  };
  const columnExists = async (): Promise<boolean> => {
    const [row]: { found: boolean }[] = await probe.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'harvest_runs' AND column_name = 'stopReason'
       ) AS "found"`
    );
    return row.found;
  };

  beforeAll(async () => {
    const url = new URL(requiredEnv('HARVESTER_DB_URL'));
    admin = new DataSource({ type: 'postgres', url: url.toString() });
    await admin.initialize();
    // `DROP` first, so a killed run leaves nothing behind for the next one.
    await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);
    url.pathname = `/${PROBE_DATABASE}`;
    probeUrl = url.toString();

    await open(BEFORE);
    await probe.query(
      `INSERT INTO "harvest_runs" ("id", "mode", "status", "error")
         VALUES ($1, 'CATALOG_DISCOVERY', 'FAILED', 'over the ratio')`,
      [OLD_RUN]
    );
    await probe.destroy();
    // The migration itself, as its own data source, so the migrations table
    // carries the state a real deployment's does when this one runs.
    await open(THROUGH);
  }, 180_000);

  afterAll(async () => {
    if (probe?.isInitialized) {
      await probe.destroy();
    }
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
      await admin.destroy();
    }
  });

  it('is newer than every migration before it', () => {
    const stamps = BEFORE.map((migration) =>
      Number(/(\d{13})$/.exec(migration.name)?.[1])
    );
    expect(stamps.length).toBeGreaterThan(0);
    expect(Math.max(...stamps)).toBeLessThan(1759500000000);
  });

  it('adds the column and its type, and leaves a run from before it null', async () => {
    expect(await typeExists()).toBe(true);
    expect(await columnExists()).toBe(true);
    const [row]: { stopReason: string | null }[] = await probe.query(
      `SELECT "stopReason" FROM "harvest_runs" WHERE "id" = $1`,
      [OLD_RUN]
    );
    expect(row.stopReason).toBeNull();
  }, 180_000);

  it('takes the one reason and nothing else', async () => {
    await probe.query(
      `UPDATE "harvest_runs" SET "stopReason" = 'SOURCE_BLOCKED' WHERE "id" = $1`,
      [OLD_RUN]
    );
    await expect(
      probe.query(
        `UPDATE "harvest_runs" SET "stopReason" = 'SOMETHING_ELSE' WHERE "id" = $1`,
        [OLD_RUN]
      )
    ).rejects.toThrow(/invalid input value for enum/);
    await probe.query(
      `UPDATE "harvest_runs" SET "stopReason" = NULL WHERE "id" = $1`,
      [OLD_RUN]
    );
  }, 180_000);

  it('goes down to no column and no type, and up again', async () => {
    const migration = new RunStopReason1759500000000();
    const runner = probe.createQueryRunner();
    try {
      await migration.down(runner);
      expect(await columnExists()).toBe(false);
      expect(await typeExists()).toBe(false);

      await migration.up(runner);
    } finally {
      await runner.release();
    }
    expect(await columnExists()).toBe(true);
    expect(await typeExists()).toBe(true);
  }, 180_000);
});
