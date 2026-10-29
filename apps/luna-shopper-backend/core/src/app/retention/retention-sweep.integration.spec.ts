import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_MIGRATIONS } from '../db/migrations';
import { CORE_ENTITIES } from '../entities';
import type { RetentionConfig } from './retention-config';
import { RetentionSweepService } from './retention-sweep.service';

/**
 * The retention sweep of core against real Postgres (plan 0233, section 7).
 *
 * That the statement deletes exactly the audit rows past the cutoff and keeps
 * a row one minute younger, that a sweep passes by a row another transaction
 * holds instead of waiting for it (the `SKIP LOCKED` that lets two replicas
 * sweep at once), and that two sweeps started together both finish and delete
 * each row once.
 *
 * The held row is what proves the clause. Two sweeps started together may
 * still run their batches one after the other, so on their own they would
 * pass with a plain `FOR UPDATE` too.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services core
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:<port>/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=retention-sweep.integration
 */
const SCHEMA = 'plan0233_retention_test';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date();

const CONFIG: RetentionConfig = {
  auditMs: 180 * DAY,
  sweep: {
    enabled: true,
    intervalMs: 60 * MINUTE,
    batchSize: 1000,
    maxBatches: 50,
  },
};

/**
 * Fails when `work` has not settled within `ms`. A sweep that waited for a
 * locked row would hang here; `SKIP LOCKED` passes the row by.
 */
function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the sweeps still waited after ${ms} ms`)),
      ms
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const OLD = new Date(NOW.getTime() - CONFIG.auditMs - MINUTE);
const YOUNG = new Date(NOW.getTime() - CONFIG.auditMs + MINUTE);

describeIntegration('the core retention sweep (real Postgres)', () => {
  let dataSource: DataSource;

  const logger = { log: jest.fn(), error: jest.fn() };

  function sweeper(config: RetentionConfig): RetentionSweepService {
    return new RetentionSweepService(
      dataSource,
      logger as never,
      { getOrThrow: () => ({ retention: config }) } as never
    );
  }

  /** Inserts `count` rows, each one second older than the last, from `from`. */
  async function seed(from: Date, count: number): Promise<string[]> {
    const rows = (await dataSource.query(
      `INSERT INTO "core_audit" ("actorId", "actorKind", "entity", "entityId", "action", "at")
       SELECT gen_random_uuid(), 'ADMIN', 'zones', gen_random_uuid(), 'UPDATE',
              $1::timestamptz - (n - 1) * interval '1 second'
       FROM generate_series(1, $2::int) AS n
       RETURNING "id"`,
      [from, count]
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  async function ids(): Promise<string[]> {
    const rows = (await dataSource.query(
      `SELECT "id" FROM "core_audit"`
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id).sort();
  }

  beforeAll(async () => {
    const url = requiredEnv('CORE_DB_URL');

    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: CORE_ENTITIES,
      migrations: CORE_MIGRATIONS,
      synchronize: false,
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE "core_audit"`);
    logger.log.mockClear();
    logger.error.mockClear();
  });

  it('deletes a row past six months and keeps a row one minute younger', async () => {
    await seed(OLD, 1);
    const [young] = await seed(YOUNG, 1);

    const results = await sweeper(CONFIG).sweep(NOW);

    expect(results).toEqual([
      { table: 'core_audit', deleted: 1, failed: false },
    ]);
    expect(await ids()).toEqual([young]);
    expect(logger.error).not.toHaveBeenCalled();

    const again = await sweeper(CONFIG).sweep(NOW);
    expect(again).toEqual([{ table: 'core_audit', deleted: 0, failed: false }]);
  });

  it('passes a held row by, and lets two sweeps at once both finish and delete each row once', async () => {
    await seed(OLD, 2500);
    const [young] = await seed(YOUNG, 1);

    const small = { ...CONFIG, sweep: { ...CONFIG.sweep, batchSize: 500 } };

    // A third transaction holds the oldest row, as the batch of another
    // replica would. Both sweeps must finish while it is held.
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      const rows = (await holder.query(
        `SELECT "id" FROM "core_audit" ORDER BY "at" LIMIT 1 FOR UPDATE`
      )) as Array<{ id: string }>;
      const held = rows[0].id;

      const [[first], [second]] = await within(
        10_000,
        Promise.all([sweeper(small).sweep(NOW), sweeper(small).sweep(NOW)])
      );

      expect(first.failed).toBe(false);
      expect(second.failed).toBe(false);
      expect(first.deleted + second.deleted).toBe(2499);
      expect(await ids()).toEqual([held, young].sort());
    } finally {
      await holder.rollbackTransaction();
      await holder.release();
    }

    // Released, the held row goes on the next sweep.
    const after = await sweeper(small).sweep(NOW);
    expect(after).toEqual([{ table: 'core_audit', deleted: 1, failed: false }]);
    expect(await ids()).toEqual([young]);
    expect(logger.error).not.toHaveBeenCalled();
  }, 30_000);
});
