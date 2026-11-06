import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_MIGRATIONS } from './migrations';
import { SourceProbes1760100000000 } from './migrations/1760100000000-SourceProbes';

/**
 * The probe table and its type (plan 0219, section 4).
 *
 * - **The type, the table and both indexes exist after it**, and a source
 *   takes one `RUNNING` probe at a time.
 * - **`down` removes all of it**, the table first and then the type, and `up`
 *   brings it back.
 *
 * It runs against a probe database of its own, as the `RunStopReason` spec
 * does, so `down` never touches the slot's own schema. Every read is raw SQL
 * over this migration's own columns.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
const THROUGH = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(SourceProbes1760100000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_0219_probe';
const SOURCE = '02190219-0000-4000-a000-000000000001';
const CHAIN = '02190219-0000-4000-a000-000000000002';

describeIntegration('SourceProbes1760100000000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;

  const exists = async (sql: string): Promise<boolean> => {
    const [row]: { found: boolean }[] = await probe.query(
      `SELECT EXISTS (${sql}) AS "found"`
    );
    return row.found;
  };
  const tableExists = () =>
    exists(`SELECT 1 FROM pg_tables WHERE tablename = 'source_probes'`);
  const typeExists = () =>
    exists(`SELECT 1 FROM pg_type WHERE typname = 'source_probe_status'`);

  beforeAll(async () => {
    const url = new URL(requiredEnv('HARVESTER_DB_URL'));
    admin = new DataSource({ type: 'postgres', url: url.toString() });
    await admin.initialize();
    await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);
    url.pathname = `/${PROBE_DATABASE}`;
    probe = new DataSource({
      type: 'postgres',
      url: url.toString(),
      migrations: THROUGH,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await probe.initialize();
    await probe.runMigrations({ transaction: 'each' });
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
    expect(Math.max(...stamps)).toBeLessThan(1760100000000);
  });

  it('creates the type, the table and both indexes', async () => {
    expect(await typeExists()).toBe(true);
    expect(await tableExists()).toBe(true);
    const indexes: { name: string }[] = await probe.query(
      `SELECT indexname AS "name" FROM pg_indexes
        WHERE tablename = 'source_probes' ORDER BY indexname`
    );
    expect(indexes.map((index) => index.name)).toEqual([
      'ix_source_probes_source_started',
      'pk_source_probes',
      'uq_source_probe_running',
    ]);
  });

  it('takes one RUNNING probe per source, and any number of finished ones', async () => {
    const insert = (status: string) =>
      probe.query(
        `INSERT INTO "source_probes"
           ("sourceId", "supermarketId", "adapterKey", "trigger", "status", "startedAt")
         VALUES ($1, $2, 'deza-web', 'MANUAL', $3, now())`,
        [SOURCE, CHAIN, status]
      );
    await insert('PASSED');
    await insert('PASSED');
    await insert('RUNNING');
    await expect(insert('RUNNING')).rejects.toThrow(/uq_source_probe_running/);
    const [row]: {
      steps: unknown;
      changed: boolean;
      requests: number;
      attempt: number;
    }[] = await probe.query(
      `SELECT "steps", "changed", "requests", "attempt" FROM "source_probes"
        WHERE "status" = 'RUNNING'`
    );
    expect(row).toEqual({ steps: [], changed: false, requests: 0, attempt: 1 });
    await probe.query(`DELETE FROM "source_probes"`);
  });

  it('goes down to no table and no type, and up again', async () => {
    const migration = new SourceProbes1760100000000();
    const runner = probe.createQueryRunner();
    try {
      await migration.down(runner);
      expect(await tableExists()).toBe(false);
      expect(await typeExists()).toBe(false);
      await migration.up(runner);
    } finally {
      await runner.release();
    }
    expect(await tableExists()).toBe(true);
    expect(await typeExists()).toBe(true);
  }, 180_000);
});
