import type { ConfigService } from '@nestjs/config';
import {
  HarvestAlertKind,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
  HarvestScheduleOutcome,
  PostalCodeDiscoveryStatus,
} from '@portfolio/luna-shopper/contracts';
import type {
  HarvestRun,
  HarvestSchedule,
  PostalCodeDiscoveryRequest,
} from '../../entities';
import type { HarvestRunService, ScheduledStart } from '../harvest-run.service';
import { HarvestRunStore } from '../harvest-run.store';
import type {
  ClaimedSlot,
  HarvestScheduleStore,
} from '../harvest-schedule.store';
import { HarvestScheduleWorker } from '../harvest-schedule.worker';
import type {
  PlaceSourceRef,
  PostalCodeDiscoveryService,
} from '../postal-code-discovery.service';
import type { PostalCodeDiscoveryStore } from '../postal-code-discovery.store';
import { PostalCodeDiscoveryWorker } from '../postal-code-discovery.worker';
import type { SourceProbeService } from '../probes/source-probe.service';
import type { SourceProbeStore } from '../probes/source-probe.store';
import type { RunExecutor } from '../run-executor.service';

/**
 * The alert in a slot's outcome write and in a postal code's last failure
 * (plan 0218, section 2.3, and the owner's answer 4). The stores are fakes:
 * what is pinned is which write carries a draft and which carries exactly the
 * arguments it carried before this plan.
 */

const SLOT = new Date('2026-11-05T03:00:00.000Z');
const NOW = new Date('2026-11-05T03:00:30.000Z');

describe('HarvestScheduleWorker and the owner alert', () => {
  function schedule(over: Partial<HarvestSchedule> = {}): HarvestSchedule {
    return {
      id: 'schedule-1',
      presetId: 'preset-1',
      supermarketId: 'chain-1',
      timeOfDay: '03:00',
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      timezone: 'UTC',
      enabled: true,
      nextRunAt: SLOT,
      lastSlotAt: SLOT,
      lastSlotAttempts: 0,
      lastRunId: null,
      lastOutcome: HarvestScheduleOutcome.STARTED,
      lastOutcomeAt: null,
      lastOutcomeNote: null,
      ...over,
    } as HarvestSchedule;
  }

  function build(
    result: ScheduledStart,
    options: { claimed?: HarvestSchedule; interrupted?: HarvestSchedule[] } = {}
  ) {
    let claimed = options.claimed ? [options.claimed] : [];
    const store = {
      claimDue: jest.fn(async (): Promise<ClaimedSlot | null> => {
        const next = claimed.shift();
        return next ? { schedule: next, slot: SLOT } : null;
      }),
      recordOutcome: jest.fn(async () => undefined),
      findInterrupted: jest.fn(async () => options.interrupted ?? []),
      claimRetry: jest.fn(async () => true),
      findUndecided: jest.fn(async () => []),
      claimUndecided: jest.fn(async () => false),
      holdSlot: jest.fn(async () => ({ release: async () => undefined })),
      isUndecided: jest.fn(async () => true),
    } as unknown as HarvestScheduleStore & { recordOutcome: jest.Mock };
    const runs = {
      startScheduled: jest.fn(async () => result),
    } as unknown as HarvestRunService;
    const config = {
      getOrThrow: () => ({ harvestEnabled: true, schedulerEnabled: true }),
    } as unknown as ConfigService;
    const worker = new HarvestScheduleWorker(
      store,
      runs,
      config,
      () => NOW,
      {} as SourceProbeService,
      {} as SourceProbeStore
    );
    return { worker, store, reset: () => (claimed = []) };
  }

  const refused: ScheduledStart = {
    outcome: HarvestScheduleOutcome.REFUSED,
    note: 'That source is disabled. Enable it with supermarketSource.setEnabled.',
    runId: null,
  };

  it('passes a draft to recordOutcome for a refused slot', async () => {
    const { worker, store } = build(refused, { claimed: schedule() });

    await worker.tick();

    expect(store.recordOutcome).toHaveBeenCalledTimes(1);
    const [id, write, alert] = store.recordOutcome.mock.calls[0];
    expect(id).toBe('schedule-1');
    expect(write).toMatchObject({ outcome: HarvestScheduleOutcome.REFUSED });
    expect(alert).toMatchObject({
      kind: HarvestAlertKind.SLOT_REFUSED,
      dedupeKey: `slot:schedule-1:${SLOT.toISOString()}`,
      scheduleId: 'schedule-1',
    });
  });

  it('passes none for a refused slot whose last outcome was the same refusal', async () => {
    const { worker, store } = build(refused, {
      claimed: schedule({
        lastOutcome: HarvestScheduleOutcome.REFUSED,
        lastOutcomeNote: refused.note,
      }),
    });

    await worker.tick();

    expect(store.recordOutcome.mock.calls[0]).toHaveLength(2);
  });

  it('passes none for a busy slot', async () => {
    const { worker, store } = build(
      {
        outcome: HarvestScheduleOutcome.SKIPPED_BUSY,
        note: 'Run run-7 of this chain is in progress.',
        runId: null,
      },
      { claimed: schedule() }
    );

    await worker.tick();

    expect(store.recordOutcome.mock.calls[0]).toHaveLength(2);
  });

  it('passes a :retry draft for a refused retry', async () => {
    const { worker, store } = build(refused, {
      interrupted: [
        schedule({
          lastSlotAttempts: 1,
          lastRunId: 'run-1',
          lastOutcome: HarvestScheduleOutcome.STARTED,
        }),
      ],
    });

    await worker.tick();

    const [, , alert] = store.recordOutcome.mock.calls[0];
    expect(alert?.dedupeKey).toBe(
      `slot:schedule-1:${SLOT.toISOString()}:retry`
    );
  });
});

describe('PostalCodeDiscoveryWorker and the owner alert (answer 4)', () => {
  const OSM: PlaceSourceRef = {
    sourceId: null,
    supermarketId: null,
    label: 'OpenStreetMap',
    autoImportPlaces: false,
  };

  function request(attempts: number): PostalCodeDiscoveryRequest {
    return {
      id: 'q-1',
      country: 'es',
      postalCode: '14013',
      status: PostalCodeDiscoveryStatus.RUNNING,
      requestedAt: new Date('2026-11-01T09:00:00.000Z'),
      lastAttemptedAt: new Date('2026-11-05T03:00:00.000Z'),
      discoveredAt: null,
      nextAttemptAt: null,
      requeuedAt: null,
      attempts,
      runId: null,
    } as unknown as PostalCodeDiscoveryRequest;
  }

  function build(attempts: number, options: { dueError?: string } = {}) {
    const pending = [request(attempts)];
    const markAttemptFailed = jest.fn(async () => undefined);
    const queue = {
      claimNext: jest.fn(async () => pending.shift() ?? null),
      markDone: jest.fn(async () => undefined),
      markAttemptFailed,
      release: jest.fn(async () => undefined),
      reapStale: jest.fn(async () => 0),
    } as unknown as PostalCodeDiscoveryStore;
    const runs = {
      create: jest.fn(async () => ({ id: 'run-9' })),
      seedHeartbeat: jest.fn(async () => undefined),
      load: jest.fn(async () => ({ error: 'Overpass timed out' })),
    } as unknown as HarvestRunStore;
    const executor = {
      runToCompletion: jest.fn(async () => HarvestRunStatus.FAILED),
    } as unknown as RunExecutor;
    const discovery = {
      dueSourcesFor: jest.fn(async () => {
        if (options.dueError) {
          throw new Error(options.dueError);
        }
        return [OSM];
      }),
    } as unknown as PostalCodeDiscoveryService;
    const config = {
      getOrThrow: () => ({
        harvestEnabled: true,
        staleAfterSeconds: 900,
        discoveryMaxAttempts: 3,
        discoveryRadiusMetres: 5000,
        discoveryPollSeconds: 60,
      }),
    } as unknown as ConfigService;
    const worker = new PostalCodeDiscoveryWorker(
      queue,
      runs,
      executor,
      discovery,
      config
    );
    return { worker, markAttemptFailed };
  }

  it('passes no draft for an attempt that leaves the code queued', async () => {
    const { worker, markAttemptFailed } = build(2);

    await worker.drain();

    expect(markAttemptFailed).toHaveBeenCalledWith(
      expect.objectContaining({ postalCode: '14013' }),
      'OpenStreetMap: Overpass timed out',
      3,
      null
    );
  });

  it('passes one POSTAL_CODE_FAILED draft, linked to the failed run, for the attempt that gives up', async () => {
    const { worker, markAttemptFailed } = build(3);

    await worker.drain();

    expect(markAttemptFailed).toHaveBeenCalledTimes(1);
    const call = markAttemptFailed.mock.calls[0] as unknown[];
    expect(call[3]).toBeNull();
    expect(call[4]).toMatchObject({
      kind: HarvestAlertKind.POSTAL_CODE_FAILED,
      dedupeKey: 'code:14013:run-9',
      runId: 'run-9',
      payload: expect.objectContaining({
        postalCode: '14013',
        attempts: 3,
        error: 'OpenStreetMap: Overpass timed out',
      }),
    });
  });

  it('keys the draft on the attempt when the source set could not be read', async () => {
    const { worker, markAttemptFailed } = build(3, {
      dueError: 'the database is down',
    });

    await worker.drain();

    const call = markAttemptFailed.mock.calls[0] as unknown[];
    expect(call[4]).toMatchObject({
      kind: HarvestAlertKind.POSTAL_CODE_FAILED,
      dedupeKey: `code:14013:attempt-q-1-${Date.parse('2026-11-05T03:00:00.000Z')}`,
      runId: null,
    });
  });
});

describe('HarvestRunStore.reapStale and the owner alert (answer 5)', () => {
  function staleRun(id: string): HarvestRun {
    return {
      id,
      mode: HarvestRunMode.CATALOG_DISCOVERY,
      trigger: HarvestRunTrigger.MANUAL,
      supermarketId: 'chain-1',
      sourceId: null,
      presetId: null,
      scheduleId: null,
      status: HarvestRunStatus.RUNNING,
      requestedAt: new Date('2026-11-05T02:00:00.000Z'),
      startedAt: new Date('2026-11-05T02:00:05.000Z'),
      heartbeatAt: new Date('2026-11-05T02:10:00.000Z'),
      failed: 0,
      totalPlanned: null,
    } as unknown as HarvestRun;
  }

  function build(runs: HarvestRun[], failingTransactions: number) {
    let failures = failingTransactions;
    const update = jest.fn(async () => undefined);
    const transaction = jest.fn(
      async (work: (manager: unknown) => Promise<unknown>) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('the alert insert failed');
        }
        return work({ update: jest.fn(), query: jest.fn(async () => []) });
      }
    );
    const repository = {
      find: jest.fn(async () => runs),
      update,
      manager: { transaction },
    } as unknown as ConstructorParameters<typeof HarvestRunStore>[0];
    const store = new HarvestRunStore(repository);
    jest
      .spyOn(
        (store as unknown as { logger: { error: () => void } }).logger,
        'error'
      )
      .mockImplementation(() => undefined);
    return { store, update, transaction };
  }

  it('reaps a run without its alert when the alert cannot be written, and goes on to the next run', async () => {
    const { store, update, transaction } = build(
      [staleRun('run-1'), staleRun('run-2')],
      1
    );

    await expect(store.reapStale(900)).resolves.toBe(2);

    // run-1: the transaction with its alert threw, so a plain update reaped
    // it with no alert. run-2: its transaction with the alert committed.
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      { id: 'run-1' },
      expect.objectContaining({
        status: HarvestRunStatus.STALE,
        error:
          'No heartbeat; the run was reaped so the lock could be released.',
        stopReason: null,
      })
    );
  });
});
