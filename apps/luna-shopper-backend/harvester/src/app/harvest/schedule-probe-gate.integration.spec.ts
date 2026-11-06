import type { ConfigService } from '@nestjs/config';
import {
  HarvestAlertKind,
  HarvestRunMode,
  HarvestRunTrigger,
  HarvestScheduleOutcome,
  SourceProbeStatus,
  type SourceProbeResult,
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
  SourceProbe,
  type SupermarketSource,
} from '../entities';
import type { HarvestAlertDraft } from './alerts/harvest-alert.rules';
import type { CatalogClient } from './catalog-client.service';
import { HarvestRunPresetStore } from './harvest-run-preset.store';
import { HarvestRunService } from './harvest-run.service';
import { HarvestRunStore } from './harvest-run.store';
import { HarvestScheduleStore } from './harvest-schedule.store';
import { HarvestScheduleWorker } from './harvest-schedule.worker';
import type { PlatformAdminService } from './platform-admin.service';
import type { SourceProbeDispatcher } from './probes/source-probe.runner';
import { SourceProbeService } from './probes/source-probe.service';
import { SourceProbeStore } from './probes/source-probe.store';
import type { RunExecutor } from './run-executor.service';
import type { SourceEntryService } from './source-entry.service';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * The probe gate against real Postgres (plan 0247, the Tests section).
 *
 * What a fake cannot say:
 *
 * - a slot and its gate probe on one database write the probe row with its
 *   verdict and its `PROBE_FAILED` alert in one transaction, then the
 *   outcome of the slot and its `SLOT_PROBE_FAILED` alert in another;
 * - a probe that passes lets the same tick insert the run, with no alert;
 * - an alert insert that fails rolls the outcome back, and the verdict.
 *
 * The run service, the stores and the probe service are the real ones. The
 * dispatcher answers what a case asks for and fetches nothing, and the
 * executor starts nothing, so a run stays `PENDING` until the cleanup.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 7 --services harvester
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
describeIntegration('the probe gate (real Postgres)', () => {
  /** A chain nothing else in this database uses, so cleanup is exact. */
  const CHAIN = '02470247-0000-4000-8000-111111111111';
  const SOURCE = '02470247-0000-4000-8000-555555555551';
  const ADMIN = '02470247-0000-4000-8000-aaaaaaaaaaaa';
  /** Thirty seconds after a daily 03:00 UTC slot. */
  const NOW = new Date('2026-11-06T03:00:30.000Z');
  const SLOT = new Date('2026-11-06T03:00:00.000Z');

  let dataSource: DataSource;
  let schedules: HarvestScheduleStore;
  let probeStore: SourceProbeStore;
  let presets: HarvestRunPresetStore;
  let worker: HarvestScheduleWorker;
  /** A worker and its probe service on a clock of their own, as after a restart. */
  let makeWorker: (clock: () => Date) => {
    worker: HarvestScheduleWorker;
    probes: SourceProbeService;
  };
  /** What happens while a probe reads, if anything: a SIGTERM, say. */
  let duringProbe: (() => void) | null = null;
  /** What the next probe reads. */
  let answer: SourceProbeResult;

  const step = (over: Partial<SourceProbeResult['steps'][number]> = {}) => ({
    name: 'listing',
    url: null,
    ok: true,
    httpStatus: null,
    error: null,
    problems: [],
    sample: {},
    durationMs: 3,
    ...over,
  });
  const passed: SourceProbeResult = { steps: [step()], requests: 3 };
  const blocked: SourceProbeResult = {
    steps: [step({ ok: false, httpStatus: 403 })],
    requests: 1,
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    const config = {
      getOrThrow: () => ({ harvestEnabled: true, schedulerEnabled: true }),
    } as unknown as ConfigService;
    const readSource = async () =>
      (
        await dataSource.query(
          `SELECT * FROM "supermarket_sources" WHERE "id" = $1`,
          [SOURCE]
        )
      )[0] as SupermarketSource;
    const sources = {
      findBySupermarket: readSource,
      load: readSource,
    } as unknown as SupermarketSourceService;
    const runStore = new HarvestRunStore(dataSource.getRepository(HarvestRun));
    presets = new HarvestRunPresetStore(
      dataSource.getRepository(HarvestRunPreset)
    );
    const runs = new HarvestRunService(
      runStore,
      { start: () => undefined } as unknown as RunExecutor,
      sources,
      undefined as unknown as SourceEntryService,
      { listAllPriceScopes: async () => [] } as unknown as CatalogClient,
      { requireAdmin: async () => ADMIN } as unknown as PlatformAdminService,
      config,
      presets
    );
    schedules = new HarvestScheduleStore(
      dataSource.getRepository(HarvestSchedule)
    );
    probeStore = new SourceProbeStore(dataSource.getRepository(SourceProbe));
    makeWorker = (clock) => {
      const probes = new SourceProbeService(
        probeStore,
        sources,
        runStore,
        {
          probe: async () => {
            duringProbe?.();
            return answer;
          },
        } as unknown as SourceProbeDispatcher,
        { requireAdmin: async () => ADMIN } as unknown as PlatformAdminService,
        config,
        clock
      );
      return {
        worker: new HarvestScheduleWorker(
          schedules,
          runs,
          config,
          clock,
          probes,
          probeStore
        ),
        probes,
      };
    };
    worker = makeWorker(() => NOW).worker;
    await clean();
  }, 60_000);

  async function clean(): Promise<void> {
    await dataSource.query(
      `DELETE FROM "harvest_alerts" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    await dataSource.query(
      `DELETE FROM "source_probes" WHERE "sourceId" = $1`,
      [SOURCE]
    );
    await dataSource.query(
      `DELETE FROM "harvest_schedules" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    await dataSource.query(
      `DELETE FROM "harvest_run_presets" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    await dataSource.query(
      `DELETE FROM "supermarket_sources" WHERE "id" = $1`,
      [SOURCE]
    );
  }

  /** The DEZA row on, a preset of a catalog discovery and a due schedule. */
  async function dueSchedule(): Promise<string> {
    await dataSource.query(
      `INSERT INTO "supermarket_sources"
         ("id", "supermarketId", "adapterKey", "enabled", "config")
       VALUES ($1, $2, 'deza-web', true, '{}'::jsonb)`,
      [SOURCE, CHAIN]
    );
    const preset = await presets.create({
      supermarketId: CHAIN,
      name: 'Daily DEZA walk',
      input: { mode: HarvestRunMode.CATALOG_DISCOVERY },
      userId: ADMIN,
    });
    const [row]: { id: string }[] = await dataSource.query(
      `INSERT INTO "harvest_schedules"
         ("presetId", "supermarketId", "timeOfDay", "daysOfWeek", "timezone",
          "nextRunAt", "createdByUserId", "updatedByUserId")
       VALUES ($1, $2, '03:00', '{1,2,3,4,5,6,7}', 'UTC', $3, $4, $4)
       RETURNING "id"`,
      [preset.id, CHAIN, SLOT, ADMIN]
    );
    return row.id;
  }

  /** A probe of yesterday that passed, so a red one today is a change. */
  const seedGreenYesterday = () =>
    dataSource.query(
      `INSERT INTO "source_probes"
         ("sourceId", "supermarketId", "adapterKey", "trigger", "status",
          "attempt", "startedAt", "finishedAt")
       VALUES ($1, $2, 'deza-web', 'SCHEDULED', 'PASSED', 1, $3, $3)`,
      [SOURCE, CHAIN, new Date(NOW.getTime() - 86_400_000)]
    );

  const scheduleRow = async (id: string): Promise<HarvestSchedule> =>
    (
      await dataSource.query(
        `SELECT * FROM "harvest_schedules" WHERE "id" = $1`,
        [id]
      )
    )[0];
  const probesToday = (): Promise<SourceProbe[]> =>
    dataSource.query(
      `SELECT * FROM "source_probes" WHERE "sourceId" = $1 AND "startedAt" = $2`,
      [SOURCE, NOW]
    );
  const alertsOfChain = (): Promise<
    Array<{ kind: string; dedupeKey: string; payload: Record<string, unknown> }>
  > =>
    dataSource.query(
      `SELECT "kind", "dedupeKey", "payload" FROM "harvest_alerts"
        WHERE "supermarketId" = $1 ORDER BY "kind"`,
      [CHAIN]
    );
  const runsOfChain = (): Promise<HarvestRun[]> =>
    dataSource.query(
      `SELECT * FROM "harvest_runs" WHERE "supermarketId" = $1`,
      [CHAIN]
    );

  afterEach(async () => {
    duringProbe = null;
    await clean();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  it('writes the gate probe, its PROBE_FAILED alert, the skipped outcome and its SLOT_PROBE_FAILED alert, and no run', async () => {
    const id = await dueSchedule();
    await seedGreenYesterday();
    answer = blocked;

    await worker.tick();

    const [probe, ...more] = await probesToday();
    expect(more).toHaveLength(0);
    expect(probe).toMatchObject({
      trigger: HarvestRunTrigger.SCHEDULED,
      status: SourceProbeStatus.BLOCKED,
      previousStatus: SourceProbeStatus.PASSED,
      changed: true,
      attempt: 1,
      requestedByUserId: null,
    });
    const row = await scheduleRow(id);
    expect(row.lastOutcome).toBe(HarvestScheduleOutcome.SKIPPED_PROBE_FAILED);
    expect(row.lastOutcomeNote).toMatch(
      new RegExp(`^probe ${probe.id} BLOCKED: `)
    );
    expect(row.lastSlotAttempts).toBe(0);
    expect(await runsOfChain()).toHaveLength(0);
    const alerts = await alertsOfChain();
    expect(alerts.map((alert) => [alert.kind, alert.dedupeKey])).toEqual([
      [HarvestAlertKind.PROBE_FAILED, `probe:${probe.id}`],
      [HarvestAlertKind.SLOT_PROBE_FAILED, `slot:${id}:${SLOT.toISOString()}`],
    ]);
    expect(alerts[1].payload).toMatchObject({
      probeId: probe.id,
      probeStatus: 'BLOCKED',
    });
  });

  it('starts the run in the same tick after the gate probe passes, with no alert', async () => {
    const id = await dueSchedule();
    answer = passed;

    await worker.tick();

    const [probe] = await probesToday();
    expect(probe.status).toBe(SourceProbeStatus.PASSED);
    const row = await scheduleRow(id);
    expect(row.lastOutcome).toBe(HarvestScheduleOutcome.STARTED);
    const runs = await runsOfChain();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: HarvestRunTrigger.SCHEDULED,
      scheduleId: id,
    });
    expect(await alertsOfChain()).toEqual([]);
  });

  it('starts with no new probe when one passed inside the window', async () => {
    const id = await dueSchedule();
    await dataSource.query(
      `INSERT INTO "source_probes"
         ("sourceId", "supermarketId", "adapterKey", "trigger", "status",
          "attempt", "startedAt", "finishedAt")
       VALUES ($1, $2, 'deza-web', 'MANUAL', 'PASSED', 1, $3, $3)`,
      [SOURCE, CHAIN, new Date(NOW.getTime() - 10 * 60_000)]
    );
    answer = blocked;

    await worker.tick();

    expect(await probesToday()).toHaveLength(0);
    expect((await scheduleRow(id)).lastOutcome).toBe(
      HarvestScheduleOutcome.STARTED
    );
  });

  it('leaves a slot a deploy stopped during its gate probe undecided, and the restart decides it one time', async () => {
    const id = await dueSchedule();
    await seedGreenYesterday();
    answer = passed;
    // The process that claims the slot gets SIGTERM while its probe reads.
    const before = makeWorker(() => NOW);
    duringProbe = () => {
      before.worker.onApplicationShutdown();
      before.probes.onApplicationShutdown();
    };

    await before.worker.tick();

    const [aborted] = await probesToday();
    expect(aborted.status).toBe(SourceProbeStatus.ABORTED);
    let row = await scheduleRow(id);
    expect(row.lastOutcome).toBeNull();
    expect(row.lastOutcomeAt).toBeNull();
    expect(row.lastSlotAttempts).toBe(0);
    expect(new Date(row.lastSlotAt as Date)).toEqual(SLOT);
    expect(await runsOfChain()).toHaveLength(0);
    expect(await alertsOfChain()).toEqual([]);
    expect((await schedules.findUndecided()).map((each) => each.id)).toEqual([
      id,
    ]);

    // The new process, two minutes later, with no probe of its own in flight.
    duringProbe = null;
    const restartedAt = new Date(NOW.getTime() + 2 * 60_000);
    const after = makeWorker(() => restartedAt);
    await after.worker.tick();

    row = await scheduleRow(id);
    expect(row.lastOutcome).toBe(HarvestScheduleOutcome.STARTED);
    expect(row.lastSlotAttempts).toBe(2);
    expect(new Date(row.lastOutcomeAt as Date)).toEqual(restartedAt);
    const runs = await runsOfChain();
    expect(runs).toHaveLength(1);
    expect(runs[0].scheduleId).toBe(id);
    expect(await schedules.findUndecided()).toEqual([]);

    // Not twice: the retry is spent, and a further tick starts nothing.
    await after.worker.tick();
    expect(await runsOfChain()).toHaveLength(1);
    expect(await schedules.claimUndecided(id, SLOT)).toBe(false);
  });

  it('does not read a decided slot, or a slot whose run started, as undecided', async () => {
    const id = await dueSchedule();
    // Claimed, then decided with an outcome that started nothing.
    await dataSource.query(
      `UPDATE "harvest_schedules"
          SET "lastSlotAt" = $2, "lastSlotAttempts" = 0,
              "lastOutcome" = 'SKIPPED_LATE', "lastOutcomeAt" = $3
        WHERE "id" = $1`,
      [id, SLOT, NOW]
    );
    expect(await schedules.findUndecided()).toEqual([]);

    // Claimed with no outcome written, but its run was inserted.
    await dataSource.query(
      `UPDATE "harvest_schedules"
          SET "lastOutcome" = NULL, "lastOutcomeAt" = NULL
        WHERE "id" = $1`,
      [id]
    );
    expect((await schedules.findUndecided()).map((each) => each.id)).toEqual([
      id,
    ]);
    await dataSource.query(
      `INSERT INTO "harvest_runs"
         ("mode", "trigger", "supermarketId", "status", "scheduleId",
          "requestedAt")
       VALUES ('CATALOG_DISCOVERY', 'SCHEDULED', $1, 'COMPLETED', $2, $3)`,
      [CHAIN, id, NOW]
    );
    expect(await schedules.findUndecided()).toEqual([]);
  });

  it('rolls the outcome back when the slot alert insert fails', async () => {
    const id = await dueSchedule();
    const bad = {
      kind: 'NOT_A_KIND' as HarvestAlertKind,
      dedupeKey: `slot:${id}:rollback`,
      supermarketId: CHAIN,
      runId: null,
      scheduleId: id,
      payload: {},
    } as HarvestAlertDraft;

    await expect(
      schedules.recordOutcome(
        id,
        {
          outcome: HarvestScheduleOutcome.SKIPPED_PROBE_FAILED,
          note: 'probe p BLOCKED: listing: HTTP 403',
          at: NOW,
          runId: null,
          attempts: null,
        },
        bad
      )
    ).rejects.toThrow();

    expect((await scheduleRow(id)).lastOutcome).toBeNull();
    expect(await alertsOfChain()).toEqual([]);
  });

  it('rolls the verdict back when the probe alert insert fails', async () => {
    await dueSchedule();
    const running = await probeStore.insertRunning({
      source: { id: SOURCE, supermarketId: CHAIN, adapterKey: 'deza-web' },
      trigger: HarvestRunTrigger.SCHEDULED,
      startedAt: NOW,
      requestedByUserId: null,
    });
    if (!running) {
      throw new Error('the probe did not insert');
    }

    await expect(
      probeStore.finish(
        running.id,
        {
          status: SourceProbeStatus.SHAPE_CHANGED,
          previousStatus: SourceProbeStatus.PASSED,
          changed: true,
          finishedAt: NOW,
          requests: 2,
          steps: [],
          error: 'listing: no rows',
        },
        {
          kind: 'NOT_A_KIND' as HarvestAlertKind,
          dedupeKey: `probe:${running.id}`,
          supermarketId: CHAIN,
          runId: null,
          scheduleId: null,
          payload: {},
        }
      )
    ).rejects.toThrow();

    expect((await probeStore.load(running.id)).status).toBe(
      SourceProbeStatus.RUNNING
    );
    expect(await alertsOfChain()).toEqual([]);
  });
});
