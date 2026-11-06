import type { ConfigService } from '@nestjs/config';
import {
  HarvestAlertKind,
  HarvestRunMode,
  HarvestRunTrigger,
  HarvestScheduleOutcome,
  SourceProbeStatus,
} from '@portfolio/luna-shopper/contracts';
import type { HarvestSchedule, SupermarketSource } from '../entities';
import type {
  HarvestRunService,
  ScheduledStart,
  ScheduledStartGate,
} from './harvest-run.service';
import type {
  ClaimedSlot,
  HarvestScheduleStore,
  ScheduleOutcomeWrite,
} from './harvest-schedule.store';
import { HarvestScheduleWorker } from './harvest-schedule.worker';
import type { SourceProbeService } from './probes/source-probe.service';
import { FakeSourceProbeStore } from './probes/source-probe.store.fake';
import { PROBE_DID_NOT_FINISH, PROBE_POLL_MS } from './schedule-probe-gate';

/**
 * The probe gate in the schedule worker (plan 0247, section 2).
 *
 * `startScheduled` is a fake that keeps the order of the real one (the row,
 * the failures, the run in flight, then the gate, then the insert), which
 * `harvest-run.service.spec.ts` proves of the real one. The probes are an in
 * memory `source_probes`, and the probe service runs a probe into it with the
 * status a case asks for. The clock is passed in and the gate's sleep moves
 * it, so no timer runs.
 */

const SLOT = new Date('2026-11-06T03:00:00.000Z');
const NOW = new Date('2026-11-06T03:00:30.000Z');

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
    lastOutcome: null,
    lastOutcomeAt: null,
    lastOutcomeNote: null,
    ...over,
  } as HarvestSchedule;
}

const SOURCE = {
  id: 'source-1',
  supermarketId: 'chain-1',
  adapterKey: 'deza-web',
  enabled: true,
  config: {},
  consecutiveFailures: 0,
} as unknown as SupermarketSource;

function build(
  options: {
    mode?: HarvestRunMode;
    busy?: boolean;
    failing?: boolean;
    /** The status each probe the slot runs ends with, in order. */
    verdicts?: SourceProbeStatus[];
    claimed?: HarvestSchedule;
    interrupted?: HarvestSchedule[];
  } = {}
) {
  let now = NOW;
  const probes = new FakeSourceProbeStore();
  const outcomes: Array<{
    write: ScheduleOutcomeWrite;
    alert: unknown;
  }> = [];
  let claimed = [options.claimed ?? schedule()];
  const store = {
    claimDue: jest.fn(async (): Promise<ClaimedSlot | null> => {
      const next = claimed.shift();
      return next ? { schedule: next, slot: SLOT } : null;
    }),
    recordOutcome: jest.fn(
      async (_id: string, write: ScheduleOutcomeWrite, alert?: unknown) => {
        outcomes.push({ write, alert });
      }
    ),
    findInterrupted: jest.fn(async () => options.interrupted ?? []),
    claimRetry: jest.fn(async () => true),
  } as unknown as HarvestScheduleStore;

  let runNumber = 0;
  const gateCalls: number[] = [];
  const runs = {
    startScheduled: jest.fn(
      async (
        _schedule: HarvestSchedule,
        gate?: ScheduledStartGate
      ): Promise<ScheduledStart> => {
        if (options.failing) {
          return {
            outcome: HarvestScheduleOutcome.SKIPPED_FAILING,
            note: 'failing',
            runId: null,
          };
        }
        if (options.busy) {
          return {
            outcome: HarvestScheduleOutcome.SKIPPED_BUSY,
            note: 'A run of this chain is in progress: run-0.',
            runId: null,
          };
        }
        if (gate) {
          gateCalls.push(1);
          const gated = await gate({
            source: SOURCE,
            mode: options.mode ?? HarvestRunMode.CATALOG_DISCOVERY,
          });
          if (gated) {
            return gated;
          }
        }
        runNumber += 1;
        return {
          outcome: HarvestScheduleOutcome.STARTED,
          note: null,
          runId: `run-${runNumber}`,
        };
      }
    ),
  } as unknown as HarvestRunService;

  const verdicts = [...(options.verdicts ?? [SourceProbeStatus.PASSED])];
  const probeService = {
    runForSchedule: jest.fn(async (source: SupermarketSource) => {
      const row = await probes.insertRunning({
        source,
        trigger: HarvestRunTrigger.SCHEDULED,
        startedAt: now,
        requestedByUserId: null,
      });
      if (!row) {
        return null;
      }
      const status = verdicts.shift() ?? SourceProbeStatus.PASSED;
      await probes.finish(row.id, {
        status,
        previousStatus: null,
        changed: false,
        finishedAt: now,
        requests: 3,
        steps: [],
        error:
          status === SourceProbeStatus.PASSED
            ? null
            : 'listing: the response was HTTP 403',
      });
      return probes.load(row.id);
    }),
  } as unknown as SourceProbeService & { runForSchedule: jest.Mock };

  const config = {
    getOrThrow: () => ({ harvestEnabled: true, schedulerEnabled: true }),
  } as unknown as ConfigService;

  const worker = new HarvestScheduleWorker(
    store,
    runs,
    config,
    () => now,
    probeService,
    probes.asStore()
  );
  const sleeps: number[] = [];
  /** What happens to the world on each sleep of the gate, if anything. */
  let onSleep: (() => void) | null = null;
  worker.sleep = async (ms: number) => {
    sleeps.push(ms);
    now = new Date(now.getTime() + ms);
    onSleep?.();
  };
  return {
    worker,
    store,
    runs,
    probes,
    probeService,
    outcomes,
    gateCalls,
    sleeps,
    onSleep: (fn: () => void) => (onSleep = fn),
    reclaim: (row: HarvestSchedule) => (claimed = [row]),
  };
}

describe('HarvestScheduleWorker, the probe gate (plan 0247)', () => {
  it('starts a run and runs no probe when a PASSED probe is younger than 15 minutes', async () => {
    const { worker, probes, probeService, outcomes } = build();
    probes.seed({
      sourceId: SOURCE.id,
      status: SourceProbeStatus.PASSED,
      startedAt: new Date(NOW.getTime() - 14 * 60_000),
    });

    await worker.tick();

    expect(probeService.runForSchedule).not.toHaveBeenCalled();
    expect(outcomes[0].write).toMatchObject({
      outcome: HarvestScheduleOutcome.STARTED,
      runId: 'run-1',
    });
  });

  it('runs a probe with no valid one, and starts in the same tick after PASSED', async () => {
    const { worker, probeService, outcomes } = build();

    await worker.tick();

    expect(probeService.runForSchedule).toHaveBeenCalledWith(
      SOURCE,
      'schedule-1'
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].write).toMatchObject({
      outcome: HarvestScheduleOutcome.STARTED,
      runId: 'run-1',
      attempts: 1,
    });
  });

  it('records SKIPPED_PROBE_FAILED for a BLOCKED probe, starts nothing, and passes a draft', async () => {
    const { worker, probes, outcomes } = build({
      verdicts: [SourceProbeStatus.BLOCKED],
    });

    await worker.tick();

    const [probe] = probes.rows;
    expect(outcomes[0].write).toMatchObject({
      outcome: HarvestScheduleOutcome.SKIPPED_PROBE_FAILED,
      note: `probe ${probe.id} BLOCKED: listing: the response was HTTP 403`,
      runId: null,
      attempts: null,
    });
    expect(outcomes[0].alert).toMatchObject({
      kind: HarvestAlertKind.SLOT_PROBE_FAILED,
      dedupeKey: `slot:schedule-1:${SLOT.toISOString()}`,
      scheduleId: 'schedule-1',
      payload: {
        probeId: probe.id,
        probeStatus: 'BLOCKED',
        probeError: 'listing: the response was HTTP 403',
      },
    });
  });

  it('skips on ERROR too', async () => {
    const { worker, outcomes } = build({ verdicts: [SourceProbeStatus.ERROR] });

    await worker.tick();

    expect(outcomes[0].write.outcome).toBe(
      HarvestScheduleOutcome.SKIPPED_PROBE_FAILED
    );
  });

  it('runs the gate after the busy and the failing rules, so neither gets a probe', async () => {
    for (const options of [{ busy: true }, { failing: true }]) {
      const { worker, probeService, gateCalls, outcomes } = build(options);
      await worker.tick();
      expect(gateCalls).toHaveLength(0);
      expect(probeService.runForSchedule).not.toHaveBeenCalled();
      expect(outcomes[0].write.runId).toBeNull();
    }
  });

  it('starts a file import with no probe', async () => {
    const { worker, probeService, outcomes } = build({
      mode: HarvestRunMode.FILE_IMPORT,
      verdicts: [SourceProbeStatus.BLOCKED],
    });

    await worker.tick();

    expect(probeService.runForSchedule).not.toHaveBeenCalled();
    expect(outcomes[0].write.outcome).toBe(HarvestScheduleOutcome.STARTED);
  });

  it('waits for a RUNNING probe and uses its verdict', async () => {
    const { worker, probes, probeService, outcomes, sleeps, onSleep } = build();
    const running = probes.seed({
      sourceId: SOURCE.id,
      status: SourceProbeStatus.RUNNING,
      startedAt: new Date(NOW.getTime() - 60_000),
      finishedAt: null,
    });
    let reads = 0;
    onSleep(() => {
      reads += 1;
      if (reads === 3) {
        const row = probes.rows.find((each) => each.id === running.id);
        if (row) {
          row.status = SourceProbeStatus.SHAPE_CHANGED;
          row.error = 'listing: no rows';
        }
      }
    });

    await worker.tick();

    expect(probeService.runForSchedule).not.toHaveBeenCalled();
    expect(sleeps).toEqual([PROBE_POLL_MS, PROBE_POLL_MS, PROBE_POLL_MS]);
    expect(outcomes[0].write).toMatchObject({
      outcome: HarvestScheduleOutcome.SKIPPED_PROBE_FAILED,
      note: `probe ${running.id} SHAPE_CHANGED: listing: no rows`,
    });
  });

  it('starts after a RUNNING probe it waited for passes', async () => {
    const { worker, probes, outcomes, onSleep } = build();
    const running = probes.seed({
      sourceId: SOURCE.id,
      status: SourceProbeStatus.RUNNING,
      startedAt: NOW,
      finishedAt: null,
    });
    onSleep(() => {
      const row = probes.rows.find((each) => each.id === running.id);
      if (row) {
        row.status = SourceProbeStatus.PASSED;
      }
    });

    await worker.tick();

    expect(outcomes[0].write.outcome).toBe(HarvestScheduleOutcome.STARTED);
  });

  it('skips with the note when the probe is still RUNNING six minutes after its start', async () => {
    const { worker, probes, outcomes, sleeps } = build();
    const running = probes.seed({
      sourceId: SOURCE.id,
      status: SourceProbeStatus.RUNNING,
      startedAt: new Date(NOW.getTime() - 60_000),
      finishedAt: null,
    });

    await worker.tick();

    // Five minutes left of the wait, in reads five seconds apart.
    expect(sleeps).toHaveLength(60);
    expect(outcomes[0].write).toMatchObject({
      outcome: HarvestScheduleOutcome.SKIPPED_PROBE_FAILED,
      note: `${PROBE_DID_NOT_FINISH} (probe ${running.id})`,
      runId: null,
    });
  });

  it('gates the retry of an interrupted run, and the retry is spent', async () => {
    const interrupted = schedule({
      lastSlotAt: SLOT,
      lastSlotAttempts: 1,
      lastRunId: 'run-stopped',
      lastOutcome: HarvestScheduleOutcome.STARTED,
    });
    const { worker, store, outcomes } = build({
      interrupted: [interrupted],
      verdicts: [SourceProbeStatus.UNREACHABLE],
    });
    // Nothing is due: only the retry runs.
    (store.claimDue as jest.Mock).mockResolvedValue(null);

    await worker.tick();

    expect(store.claimRetry).toHaveBeenCalledWith('schedule-1', 'run-stopped');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].write).toMatchObject({
      outcome: HarvestScheduleOutcome.SKIPPED_PROBE_FAILED,
      attempts: null,
    });
    expect(outcomes[0].alert).toMatchObject({
      kind: HarvestAlertKind.SLOT_PROBE_FAILED,
      dedupeKey: `slot:schedule-1:${SLOT.toISOString()}:retry`,
    });
  });

  it('sends no second slot alert while the probe keeps the same status', async () => {
    const { worker, probes, outcomes, reclaim } = build({
      verdicts: [SourceProbeStatus.BLOCKED, SourceProbeStatus.BLOCKED],
    });
    await worker.tick();
    const first = outcomes[0].write;
    // The next slot of the same schedule, as the claim reads it.
    probes.rows.length = 0;
    reclaim(
      schedule({
        lastOutcome: first.outcome,
        lastOutcomeNote: first.note,
      })
    );

    await worker.tick();

    expect(outcomes).toHaveLength(2);
    expect(outcomes[1].write.outcome).toBe(
      HarvestScheduleOutcome.SKIPPED_PROBE_FAILED
    );
    expect(outcomes[1].alert).toBeUndefined();
  });
});
