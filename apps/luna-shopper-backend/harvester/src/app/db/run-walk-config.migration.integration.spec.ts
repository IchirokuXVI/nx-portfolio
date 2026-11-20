import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_MIGRATIONS } from './migrations';
import { RunWalkConfig1760720000000 } from './migrations/1760720000000-RunWalkConfig';

/**
 * What a run walked under, beside its request (owner decisions 130b and 127b).
 *
 * Three claims that need a real database:
 *
 * - **Both columns exist after it, nullable**, and a run from before it reads
 *   null in both.
 * - **It deletes and rewrites no row.** The run count and the stored input are
 *   what they were.
 * - **`down` drops both columns, and `up` adds them again.**
 *
 * It runs against a probe database of its own, for the reason the
 * `OneSourceProduct` spec gives: the point is the state before the migration.
 * Every read and write here is SQL, so a later plan's column cannot break it.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
const THROUGH = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(RunWalkConfig1760720000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_130b_probe';

const OLD_RUN = '0130b000-0000-4000-a000-000000000001';
const OLD_INPUT = { priceScopeIds: ['scope-a'], writes: 'PRICES' };

interface Row {
  input: unknown;
  configFingerprint: string | null;
  adapterKey: string | null;
}

describeIntegration('RunWalkConfig1760720000000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;
  let countBefore = 0;

  const count = async (): Promise<number> => {
    const [row]: { n: number }[] = await probe.query(
      `SELECT count(*)::int AS "n" FROM "harvest_runs"`
    );
    return row.n;
  };
  const read = async (id: string): Promise<Row> => {
    const [row]: Row[] = await probe.query(
      `SELECT "input", "configFingerprint", "adapterKey"
         FROM "harvest_runs" WHERE "id" = $1`,
      [id]
    );
    return row;
  };
  const columns = async (): Promise<
    { column_name: string; is_nullable: string }[]
  > =>
    probe.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'harvest_runs'
          AND column_name IN ('configFingerprint', 'adapterKey')
        ORDER BY column_name`
    );

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
      `INSERT INTO "harvest_runs" ("id", "mode", "status", "input")
         VALUES ($1, 'CATALOG_DISCOVERY', 'COMPLETED', $2::jsonb)`,
      [OLD_RUN, JSON.stringify(OLD_INPUT)]
    );
    countBefore = await count();
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
    expect(Math.max(...stamps)).toBeLessThan(1760720000000);
  });

  it('adds two nullable columns and leaves a run from before it null in both', async () => {
    expect(await columns()).toEqual([
      { column_name: 'adapterKey', is_nullable: 'YES' },
      { column_name: 'configFingerprint', is_nullable: 'YES' },
    ]);
    expect(await count()).toBe(countBefore);
    expect(await read(OLD_RUN)).toEqual({
      input: OLD_INPUT,
      configFingerprint: null,
      adapterKey: null,
    });
  }, 180_000);

  it('holds a fingerprint and an adapter a spawn writes', async () => {
    const digest = 'f'.repeat(64);
    await probe.query(
      `UPDATE "harvest_runs" SET "configFingerprint" = $2, "adapterKey" = 'carrefour-web'
        WHERE "id" = $1`,
      [OLD_RUN, digest]
    );
    expect(await read(OLD_RUN)).toMatchObject({
      configFingerprint: digest,
      adapterKey: 'carrefour-web',
    });
    await probe.query(
      `UPDATE "harvest_runs" SET "configFingerprint" = NULL, "adapterKey" = NULL
        WHERE "id" = $1`,
      [OLD_RUN]
    );
  }, 180_000);

  it('goes down to no column and the rows as they were, and up again', async () => {
    const migration = new RunWalkConfig1760720000000();
    const runner = probe.createQueryRunner();
    try {
      await migration.down(runner);
      expect(await columns()).toEqual([]);
      expect(await count()).toBe(countBefore);

      await migration.up(runner);
    } finally {
      await runner.release();
    }
    expect(await read(OLD_RUN)).toEqual({
      input: OLD_INPUT,
      configFingerprint: null,
      adapterKey: null,
    });
  }, 180_000);
});
