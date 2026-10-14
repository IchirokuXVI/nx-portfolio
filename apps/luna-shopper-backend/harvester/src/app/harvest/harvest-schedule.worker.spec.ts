import type { ConfigService } from '@nestjs/config';
import { HarvestScheduleOutcome } from '@portfolio/luna-shopper/contracts';
import type { HarvestSchedule } from '../entities';
import type { HarvestRunService, ScheduledStart } from './harvest-run.service';
import type {
  ClaimedSlot,
  HarvestScheduleStore,
  ScheduleOutcomeWrite,
} from './harvest-schedule.store';
import { HarvestScheduleWorker } from './harvest-schedule.worker';
import { nextSlot, previousSlot } from './schedule-slot';

/**
 * The worker that fires due schedules (plan 0206, sections 5 and 7).
 *
 * The store is a fake that keeps one row and answers the claim the way the
 * real one does: due when `nextRunAt <= now`, judged on the last slot at or
 * before now, and moved past now. The clock is passed in and no timer runs.
 * The real claim between two processes is the integration spec's.
 */

const DAILY_0300_UTC = {
  timeOfDay: '03:00',
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  timezone: 'UTC',
};

function schedule(over: Partial<HarvestSchedule> = {}): HarvestSchedule {
  return {
    id: 'schedule-1',
    presetId: 'preset-1',
    supermarketId: 'chain-1',
    ...DAILY_0300_UTC,
    enabled: true,
    nextRunAt: new Date('2026-10-14T03:00:00.000Z'),
    lastSlotAt: null,
    lastSlotAttempts: 0,
    lastRunId: null,
    lastOutcome: null,
    lastOutcomeAt: null,
    lastOutcomeNote: null,
    ...over,
  } as HarvestSchedule;
}

function build(
  options: {
    row?: HarvestSchedule;
    harvestEnabled?: boolean;
    schedulerEnabled?: boolean;
    /** What each start answers, in order; then STARTED. */
    starts?: Array<ScheduledStart | Error>;
    /** The rows `findInterrupted` answers. */
    interrupted?: HarvestSchedule[];
  } = {}
) {
  let row: HarvestSchedule = options.row ?? schedule();
  const outcomes: ScheduleOutcomeWrite[] = [];
  let runNumber = 0;

  const store = {
    claimDue: jest.fn(async (now: Date): Promise<ClaimedSlot | null> => {
      if (!row.enabled || !row.nextRunAt || row.nextRunAt > now) {
        return null;
      }
      const slot = previousSlot(row, now);
      row = {
        ...row,
        nextRunAt: nextSlot(row, now),
        lastSlotAt: slot,
        lastSlotAttempts: 0,
      };
      return { schedule: { ...row }, slot };
    }),
    recordOutcome: jest.fn(async (_id: string, write: ScheduleOutcomeWrite) => {
      outcomes.push(write);
      row = {
        ...row,
        lastOutcome: write.outcome,
        lastRunId: write.runId ?? row.lastRunId,
        lastSlotAttempts: write.attempts ?? row.lastSlotAttempts,
      };
    }),
    findInterrupted: jest.fn(async () => options.interrupted ?? []),
    claimRetry: jest.fn(async (_id: string, runId: string) => {
      if (row.lastSlotAttempts !== 1 || row.lastRunId !== runId) {
        return false;
      }
      row = { ...row, lastSlotAttempts: 2 };
      return true;
    }),
  } as unknown as HarvestScheduleStore;

  const queued = [...(options.starts ?? [])];
  const runs = {
    startScheduled: jest.fn(async (): Promise<ScheduledStart> => {
      const next = queued.shift();
      if (next instanceof Error) {
        throw next;
      }
      if (next) {
        return next;
      }
      runNumber += 1;
      return {
        outcome: HarvestScheduleOutcome.STARTED,
        note: null,
        runId: `run-${runNumber}`,
      };
    }),
  } as unknown as HarvestRunService;

  const config = {
    getOrThrow: () => ({
      harvestEnabled: options.harvestEnabled ?? true,
      schedulerEnabled: options.schedulerEnabled ?? true,
    }),
  } as unknown as ConfigService;

  let now = new Date('2026-10-14T03:01:00.000Z');
  const worker = new HarvestScheduleWorker(store, runs, config, () => now);
  return {
    worker,
    store,
    runs,
    outcomes,
    row: () => row,
    setRow: (next: Partial<HarvestSchedule>) => (row = { ...row, ...next }),
    at: (iso: string) => (now = new Date(iso)),
  };
}

describe('HarvestScheduleWorker, a due slot', () => {
  it('starts the preset of a due schedule and records attempt 1', async () => {
    const { worker, runs, outcomes, row } = build();

    await worker.tick();

    expect(runs.startScheduled).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'schedule-1', presetId: 'preset-1' })
    );
    expect(outcomes).toEqual([
      expect.objectContaining({
        outcome: HarvestScheduleOutcome.STARTED,
        runId: 'run-1',
        attempts: 1,
      }),
    ]);
    expect(row()).toMatchObject({
      lastSlotAt: new Date('2026-10-14T03:00:00.000Z'),
      nextRunAt: new Date('2026-10-15T03:00:00.000Z'),
      lastRunId: 'run-1',
      lastSlotAttempts: 1,
    });
  });

  it('fires a slot one time, however many ticks follow', async () => {
    const { worker, runs } = build();

    await worker.tick();
    await worker.tick();
    await worker.tick();

    expect(runs.startScheduled).toHaveBeenCalledTimes(1);
  });

  it.each<[string, ScheduledStart]>([
    [
      'a source that keeps failing',
      {
        outcome: HarvestScheduleOutcome.SKIPPED_FAILING,
        note: 'The source has failed 3 runs in a row.',
        runId: null,
      },
    ],
    [
      'a refusal',
      {
        outcome: HarvestScheduleOutcome.REFUSED,
        note: 'That source is disabled.',
        runId: null,
      },
    ],
    [
      'a run in the way',
      {
        outcome: HarvestScheduleOutcome.SKIPPED_BUSY,
        note: 'A run of this chain is in progress: run-0.',
        runId: null,
      },
    ],
  ])(
    'writes %s as the outcome and leaves the attempts at 0',
    async (_case, start) => {
      const { worker, outcomes, row } = build({ starts: [start] });

      await worker.tick();

      expect(outcomes).toEqual([
        expect.objectContaining({ ...start, attempts: null }),
      ]);
      expect(row().lastSlotAttempts).toBe(0);
    }
  );

  it('skips a slot that is too late, and starts nothing', async () => {
    // Down from 03:00 until 15:01: more than half of a day's gap.
    const { worker, runs, outcomes, at } = build();
    at('2026-10-14T15:01:00.000Z');

    await worker.tick();

    expect(runs.startScheduled).not.toHaveBeenCalled();
    expect(outcomes).toEqual([
      expect.objectContaining({ outcome: HarvestScheduleOutcome.SKIPPED_LATE }),
    ]);
  });

  it('runs a slot that is late by less than half of the gap', async () => {
    const { worker, runs, at } = build();
    at('2026-10-14T14:59:00.000Z');

    await worker.tick();

    expect(runs.startScheduled).toHaveBeenCalledTimes(1);
  });

  it('starts one run for three missed slots, judged on the newest', async () => {
    // The last claim was three days ago. Slots of the 12th, 13th and 14th
    // were missed, and the 14th, one minute old, is the one judged.
    const { worker, runs, row } = build({
      row: schedule({ nextRunAt: new Date('2026-10-12T03:00:00.000Z') }),
    });

    await worker.tick();

    expect(runs.startScheduled).toHaveBeenCalledTimes(1);
    expect(row().lastSlotAt).toEqual(new Date('2026-10-14T03:00:00.000Z'));
  });

  it.each([
    ['HARVEST_ENABLED', { harvestEnabled: false }],
    ['HARVEST_SCHEDULER_ENABLED', { schedulerEnabled: false }],
    ['both', { harvestEnabled: false, schedulerEnabled: false }],
  ])('starts nothing with %s false', async (_case, switches) => {
    const { worker, store, runs } = build(switches);

    await worker.tick();

    expect(store.claimDue).not.toHaveBeenCalled();
    expect(store.findInterrupted).not.toHaveBeenCalled();
    expect(runs.startScheduled).not.toHaveBeenCalled();
  });

  it('writes an unexpected error as REFUSED with its message', async () => {
    const { worker, outcomes } = build({
      starts: [new Error('catalog did not answer')],
    });

    await worker.tick();

    expect(outcomes).toEqual([
      expect.objectContaining({
        outcome: HarvestScheduleOutcome.REFUSED,
        note: 'catalog did not answer',
        runId: null,
      }),
    ]);
  });

  it('does not let an error inside a tick stop the next tick', async () => {
    const { worker, store, runs, at } = build();
    (store.claimDue as jest.Mock).mockRejectedValueOnce(
      new Error('the database went away')
    );

    await expect(worker.tick()).resolves.toBeUndefined();
    at('2026-10-14T03:02:00.000Z');
    await worker.tick();

    expect(runs.startScheduled).toHaveBeenCalledTimes(1);
  });

  it('runs one tick at a time in a process', async () => {
    const { worker, store } = build();
    let release!: () => void;
    (store.findInterrupted as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([])))
    );

    const first = worker.tick();
    await worker.tick();
    release();
    await first;

    expect(store.findInterrupted).toHaveBeenCalledTimes(1);
  });

  it('claims nothing after the shutdown hook', async () => {
    const { worker, store } = build();
    worker.onApplicationShutdown();

    await worker.tick();

    expect(store.claimDue).not.toHaveBeenCalled();
  });
});

describe('HarvestScheduleWorker, a run a shutdown stopped (section 7)', () => {
  /** The schedule after its slot started run-1 and a deploy stopped it. */
  function stopped() {
    const context = build({
      row: schedule({
        nextRunAt: new Date('2026-10-15T03:00:00.000Z'),
        lastSlotAt: new Date('2026-10-14T03:00:00.000Z'),
        lastSlotAttempts: 1,
        lastRunId: 'run-1',
      }),
    });
    (context.store.findInterrupted as jest.Mock).mockImplementation(
      async () => {
        const row = context.row();
        // The store's query: attempts 1 and a run that was interrupted. Here
        // every run the fake started is taken to have been stopped.
        return row.lastSlotAttempts === 1 ? [row] : [];
      }
    );
    return context;
  }

  it('starts it again one time, and claims the retry first', async () => {
    const { worker, store, runs, outcomes, row } = stopped();

    await worker.tick();

    expect(store.claimRetry).toHaveBeenCalledWith('schedule-1', 'run-1');
    expect(runs.startScheduled).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([
      expect.objectContaining({
        outcome: HarvestScheduleOutcome.STARTED,
        attempts: null,
      }),
    ]);
    expect(row()).toMatchObject({
      lastRunId: 'run-1',
      lastSlotAttempts: 2,
      lastSlotAt: new Date('2026-10-14T03:00:00.000Z'),
    });
  });

  it('does not start it a second time', async () => {
    const { worker, runs } = stopped();

    await worker.tick();
    await worker.tick();
    await worker.tick();

    expect(runs.startScheduled).toHaveBeenCalledTimes(1);
  });

  it('spends the retry when the start is refused, so it is not tried on each tick', async () => {
    const { worker, runs, row } = stopped();
    (runs.startScheduled as jest.Mock).mockResolvedValueOnce({
      outcome: HarvestScheduleOutcome.SKIPPED_BUSY,
      note: 'A run of this chain is in progress: run-9.',
      runId: null,
    });

    await worker.tick();
    await worker.tick();

    expect(runs.startScheduled).toHaveBeenCalledTimes(1);
    expect(row()).toMatchObject({
      lastSlotAttempts: 2,
      lastOutcome: HarvestScheduleOutcome.SKIPPED_BUSY,
    });
  });

  it('leaves a slot alone once it is too late, and the next slot starts fresh', async () => {
    const { worker, store, runs, at } = stopped();
    at('2026-10-14T15:30:00.000Z');

    await worker.tick();

    expect(store.claimRetry).not.toHaveBeenCalled();
    expect(runs.startScheduled).not.toHaveBeenCalled();
  });

  it('does not start a run a person aborted, which the store never answers', async () => {
    // `findInterrupted` reads `abortRequestedAt IS NULL`, so a person's abort
    // is not a candidate at all.
    const { worker, runs } = build({
      row: schedule({
        nextRunAt: new Date('2026-10-15T03:00:00.000Z'),
        lastSlotAt: new Date('2026-10-14T03:00:00.000Z'),
        lastSlotAttempts: 1,
        lastRunId: 'run-1',
      }),
      interrupted: [],
    });

    await worker.tick();

    expect(runs.startScheduled).not.toHaveBeenCalled();
  });

  it('starts nothing when another process claimed the retry first', async () => {
    const { worker, store, runs } = stopped();
    (store.claimRetry as jest.Mock).mockResolvedValueOnce(false);

    await worker.tick();

    expect(runs.startScheduled).not.toHaveBeenCalled();
  });
});
