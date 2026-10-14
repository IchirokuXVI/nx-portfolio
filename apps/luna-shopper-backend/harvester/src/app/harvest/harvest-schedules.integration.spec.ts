import type { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
  HarvestScheduleOutcome,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  HarvestRun,
  HarvestRunPreset,
  HarvestSchedule,
  type SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { HarvestRunPresetStore } from './harvest-run-preset.store';
import { HarvestRunService } from './harvest-run.service';
import { HarvestRunStore } from './harvest-run.store';
import { HarvestScheduleStore } from './harvest-schedule.store';
import { HarvestScheduleWorker } from './harvest-schedule.worker';
import type { PlatformAdminService } from './platform-admin.service';
import type { RunExecutor } from './run-executor.service';
import type { SourceEntryService } from './source-entry.service';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * Schedules against real Postgres (plan 0206, sections 2, 5 and 7).
 *
 * What a mocked repository cannot say:
 *
 * - the migration creates the table, its checks, its indexes and
 *   `harvest_runs.scheduleId`;
 * - **two harvester processes on one database start one run for one slot.**
 *   Each "process" here is its own connection pool with its own store, run
 *   service and worker, and both tick at the same moment;
 * - the retry of a run a shutdown stopped is claimed by one of them only, and
 *   one time only;
 * - a chain's store discovery waits behind another source's, because the
 *   active run index allows one store discovery in the whole database.
 *
 * The executor starts nothing, so every run stays PENDING and holds its
 * chain's lock until a test finishes it.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 2 --services harvester
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:43113/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration --testFile=harvest-schedules.integration.spec.ts
 */
describeIntegration('harvest schedules (real Postgres)', () => {
  /** Chains nothing else in this database uses, so cleanup is exact. */
  const CHAIN = '02060206-0000-4000-8000-111111111111';
  const LIDL_CHAIN = '02060206-0000-4000-8000-111111111112';
  const ADMIN = '02060206-0000-4000-8000-aaaaaaaaaaaa';
  /** A Wednesday, five minutes after a daily 03:00 UTC slot. */
  const NOW = new Date('2026-10-14T03:05:00.000Z');
  const SLOT = new Date('2026-10-14T03:00:00.000Z');

  interface Process {
    dataSource: DataSource;
    store: HarvestScheduleStore;
    worker: HarvestScheduleWorker;
    presets: HarvestRunPresetStore;
  }
  let one: Process;
  let two: Process;

  const sourceOf = (supermarketId: string, adapterKey: string) =>
    ({
      id: supermarketId.replace(/1(1|2)$/, '5$1'),
      supermarketId,
      adapterKey,
      enabled: true,
      consecutiveFailures: 0,
    }) as SupermarketSource;

  async function boot(): Promise<Process> {
    const dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    const config = {
      getOrThrow: () => ({ harvestEnabled: true, schedulerEnabled: true }),
    } as unknown as ConfigService;
    const sources = {
      findBySupermarket: async (id: string) =>
        id === LIDL_CHAIN
          ? sourceOf(LIDL_CHAIN, 'lidl-api')
          : sourceOf(CHAIN, 'lidl-api'),
    } as unknown as SupermarketSourceService;
    const presets = new HarvestRunPresetStore(
      dataSource.getRepository(HarvestRunPreset)
    );
    const runs = new HarvestRunService(
      new HarvestRunStore(dataSource.getRepository(HarvestRun)),
      { start: () => undefined } as unknown as RunExecutor,
      sources,
      undefined as unknown as SourceEntryService,
      { listAllPriceScopes: async () => [] } as unknown as CatalogClient,
      { requireAdmin: async () => ADMIN } as unknown as PlatformAdminService,
      config,
      presets
    );
    const store = new HarvestScheduleStore(
      dataSource.getRepository(HarvestSchedule)
    );
    const worker = new HarvestScheduleWorker(store, runs, config, () => NOW);
    return { dataSource, store, worker, presets };
  }

  async function clean(): Promise<void> {
    const db = one.dataSource;
    await db.query(
      `DELETE FROM "harvest_schedules" WHERE "supermarketId" = ANY($1)`,
      [[CHAIN, LIDL_CHAIN]]
    );
    await db.query(
      `DELETE FROM "harvest_runs"
        WHERE "supermarketId" = ANY($1) OR "correlationId" = 'plan-0206'`,
      [[CHAIN, LIDL_CHAIN]]
    );
    await db.query(
      `DELETE FROM "harvest_run_presets" WHERE "supermarketId" = ANY($1)`,
      [[CHAIN, LIDL_CHAIN]]
    );
  }

  /** A preset and a daily 03:00 UTC schedule whose slot is due at NOW. */
  async function dueSchedule(
    supermarketId = CHAIN,
    mode = HarvestRunMode.CATALOG_DISCOVERY
  ): Promise<string> {
    const preset = await one.presets.create({
      supermarketId,
      name: `Daily ${mode}`,
      input: { mode },
      userId: ADMIN,
    });
    const [row]: { id: string }[] = await one.dataSource.query(
      `INSERT INTO "harvest_schedules"
         ("presetId", "supermarketId", "timeOfDay", "daysOfWeek", "timezone",
          "nextRunAt", "createdByUserId", "updatedByUserId")
       VALUES ($1, $2, '03:00', '{1,2,3,4,5,6,7}', 'UTC', $3, $4, $4)
       RETURNING "id"`,
      [preset.id, supermarketId, SLOT, ADMIN]
    );
    return row.id;
  }

  const runsOf = (scheduleId: string): Promise<HarvestRun[]> =>
    one.dataSource.query(
      `SELECT * FROM "harvest_runs" WHERE "scheduleId" = $1 ORDER BY "requestedAt"`,
      [scheduleId]
    );

  const scheduleRow = async (id: string): Promise<HarvestSchedule> =>
    (
      await one.dataSource.query(
        `SELECT * FROM "harvest_schedules" WHERE "id" = $1`,
        [id]
      )
    )[0];

  beforeAll(async () => {
    one = await boot();
    two = await boot();
    await clean();
  });

  afterEach(async () => {
    await clean();
  });

  afterAll(async () => {
    await clean();
    await one?.dataSource.destroy();
    await two?.dataSource.destroy();
  });

  describe('the migration', () => {
    it('creates the table with its checks and indexes, and scheduleId on runs', async () => {
      const checks: { name: string }[] = await one.dataSource.query(
        `SELECT conname AS "name" FROM pg_constraint
          WHERE conrelid = 'harvest_schedules'::regclass AND contype = 'c'
          ORDER BY conname`
      );
      expect(checks.map((check) => check.name)).toEqual([
        'ck_harvest_schedules_attempts',
        'ck_harvest_schedules_days_of_week',
        'ck_harvest_schedules_off_has_no_slot',
        'ck_harvest_schedules_time_of_day',
      ]);
      const indexes: { name: string }[] = await one.dataSource.query(
        `SELECT indexname AS "name" FROM pg_indexes
          WHERE tablename IN ('harvest_schedules', 'harvest_runs')
            AND indexname IN ('ix_harvest_schedules_preset',
                              'ix_harvest_schedules_supermarket',
                              'ix_harvest_schedules_next_run',
                              'ix_harvest_runs_schedule')
          ORDER BY indexname`
      );
      expect(indexes).toHaveLength(4);
      const columns: { name: string }[] = await one.dataSource.query(
        `SELECT column_name AS "name" FROM information_schema.columns
          WHERE table_name = 'harvest_runs' AND column_name = 'scheduleId'`
      );
      expect(columns).toHaveLength(1);
    });

    it.each([
      ['a time that is not HH:mm', `'3:00'`, `'{1}'`, 'true', 'NULL'],
      ['a day that is not 1 to 7', `'03:00'`, `'{0}'`, 'true', 'NULL'],
      ['no day at all', `'03:00'`, `'{}'`, 'true', 'NULL'],
      [
        'a slot on a schedule that is off',
        `'03:00'`,
        `'{1}'`,
        'false',
        'now()',
      ],
    ])('refuses %s', async (_case, time, days, enabled, next) => {
      await expect(
        one.dataSource.query(
          `INSERT INTO "harvest_schedules"
             ("presetId", "supermarketId", "timeOfDay", "daysOfWeek",
              "enabled", "nextRunAt", "createdByUserId", "updatedByUserId")
           VALUES ($1, $2, ${time}, ${days}, ${enabled}, ${next}, $3, $3)`,
          [ADMIN, CHAIN, ADMIN]
        )
      ).rejects.toThrow(/violates check constraint/);
    });
  });

  describe('the claim', () => {
    it('gives a due slot to one of two connections, and moves it past now', async () => {
      const id = await dueSchedule();

      const claims = await Promise.all([
        one.store.claimDue(NOW),
        two.store.claimDue(NOW),
      ]);

      const won = claims.filter((claim) => claim !== null);
      expect(won).toHaveLength(1);
      expect(won[0]?.slot).toEqual(SLOT);
      const row = await scheduleRow(id);
      expect(row.nextRunAt).toEqual(new Date('2026-10-15T03:00:00.000Z'));
      expect(row.lastSlotAt).toEqual(SLOT);
      expect(row.lastSlotAttempts).toBe(0);
    });

    it('claims nothing that is not due yet', async () => {
      await dueSchedule();
      await expect(
        one.store.claimDue(new Date('2026-10-14T02:59:00.000Z'))
      ).resolves.toBeNull();
    });
  });

  describe('two workers on one database', () => {
    it('start one run for one slot, scheduled and with no user', async () => {
      const id = await dueSchedule();

      await Promise.all([one.worker.tick(), two.worker.tick()]);

      const runs = await runsOf(id);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        trigger: HarvestRunTrigger.SCHEDULED,
        requestedByUserId: null,
        supermarketId: CHAIN,
      });
      const row = await scheduleRow(id);
      expect(row).toMatchObject({
        lastOutcome: HarvestScheduleOutcome.STARTED,
        lastRunId: runs[0].id,
        lastSlotAttempts: 1,
      });
    });

    it('retry a run a shutdown stopped one time, from one of them, and not twice', async () => {
      const id = await dueSchedule();
      await one.worker.tick();
      const [first] = await runsOf(id);

      // The shutdown hook: ABORTED, with no person's abort behind it.
      await one.dataSource.query(
        `UPDATE "harvest_runs" SET "status" = $2, "finishedAt" = now() WHERE "id" = $1`,
        [first.id, HarvestRunStatus.ABORTED]
      );
      await Promise.all([one.worker.tick(), two.worker.tick()]);

      const afterRetry = await runsOf(id);
      expect(afterRetry).toHaveLength(2);
      const retry = afterRetry[1];
      expect(await scheduleRow(id)).toMatchObject({
        lastRunId: retry.id,
        lastSlotAttempts: 2,
        lastSlotAt: SLOT,
      });

      // The retry is stopped too. It has spent the slot's one retry.
      await one.dataSource.query(
        `UPDATE "harvest_runs" SET "status" = $2, "finishedAt" = now() WHERE "id" = $1`,
        [retry.id, HarvestRunStatus.ABORTED]
      );
      await Promise.all([one.worker.tick(), two.worker.tick()]);
      expect(await runsOf(id)).toHaveLength(2);
    });

    it('do not retry a run a person aborted', async () => {
      const id = await dueSchedule();
      await one.worker.tick();
      const [first] = await runsOf(id);
      await one.dataSource.query(
        `UPDATE "harvest_runs"
            SET "status" = $2, "abortRequestedAt" = now(), "finishedAt" = now()
          WHERE "id" = $1`,
        [first.id, HarvestRunStatus.ABORTED]
      );

      await one.worker.tick();

      expect(await runsOf(id)).toHaveLength(1);
    });

    it('skip a store discovery behind another source’s, with the run named (review point 6)', async () => {
      // An OpenStreetMap run of the postal code queue: no chain, and in flight.
      const [blocking]: { id: string }[] = await one.dataSource.query(
        `INSERT INTO "harvest_runs" ("mode", "trigger", "status", "correlationId")
         VALUES ('STORE_DISCOVERY', 'SYSTEM', 'PENDING', 'plan-0206')
         RETURNING "id"`
      );
      const id = await dueSchedule(LIDL_CHAIN, HarvestRunMode.STORE_DISCOVERY);

      await Promise.all([one.worker.tick(), two.worker.tick()]);

      expect(await runsOf(id)).toHaveLength(0);
      const row = await scheduleRow(id);
      expect(row.lastOutcome).toBe(HarvestScheduleOutcome.SKIPPED_BUSY);
      expect(row.lastOutcomeNote).toContain(blocking.id);
      expect(row.lastSlotAttempts).toBe(0);
    });
  });
});
