import {
  HarvestAlertKind,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
  HarvestScheduleOutcome,
} from '@portfolio/luna-shopper/contracts';
import { SOURCE_FAILING_AFTER } from '../harvest-run.service';
import {
  needsScheduleCount,
  postalCodeAlertFor,
  runAlertFor,
  SCHEDULES_STOP_AFTER,
  slotAlertFor,
  testAlertFor,
  type RunAlertRun,
  type SlotAlertSchedule,
} from './harvest-alert.rules';

/**
 * Which outcome makes an alert (plan 0218, sections 2 and 3, and the owner's
 * answers of 2026-11-05). Pure functions, no clock and no database.
 */

const FINISHED = new Date('2026-11-05T03:20:00.000Z');

function run(over: Partial<RunAlertRun> = {}): RunAlertRun {
  return {
    id: 'run-1',
    mode: HarvestRunMode.CATALOG_DISCOVERY,
    trigger: HarvestRunTrigger.SCHEDULED,
    supermarketId: 'chain-1',
    presetId: 'preset-1',
    scheduleId: 'schedule-1',
    requestedAt: new Date('2026-11-05T03:00:00.000Z'),
    startedAt: new Date('2026-11-05T03:00:05.000Z'),
    failed: 30,
    totalPlanned: 100,
    ...over,
  };
}

function runInput(over: Partial<Parameters<typeof runAlertFor>[0]> = {}) {
  return {
    run: run(),
    status: HarvestRunStatus.FAILED,
    error: '30 of 100 items failed, which is over the 0.25 threshold.',
    refusal: false,
    adapterKey: 'mercadona-api',
    failuresBefore: 0,
    enabledSchedules: 0,
    finishedAt: FINISHED,
    ...over,
  };
}

describe('runAlertFor', () => {
  it('gives RUN_FAILED with key run:<id> for a FAILED run of MANUAL and of SCHEDULED', () => {
    for (const trigger of [
      HarvestRunTrigger.MANUAL,
      HarvestRunTrigger.SCHEDULED,
    ]) {
      const draft = runAlertFor(runInput({ run: run({ trigger }) }));
      expect(draft).toMatchObject({
        kind: HarvestAlertKind.RUN_FAILED,
        dedupeKey: 'run:run-1',
        runId: 'run-1',
        supermarketId: 'chain-1',
        scheduleId: 'schedule-1',
      });
      expect(draft?.payload).toMatchObject({
        trigger,
        mode: HarvestRunMode.CATALOG_DISCOVERY,
        failed: 30,
        totalPlanned: 100,
        error: '30 of 100 items failed, which is over the 0.25 threshold.',
        adapterKey: 'mercadona-api',
        finishedAt: FINISHED.toISOString(),
        startedAt: '2026-11-05T03:00:05.000Z',
        schedulesStopped: null,
      });
    }
  });

  it('gives RUN_BLOCKED for a FAILED run with a refusal, and RUN_FAILED for the same run without', () => {
    expect(runAlertFor(runInput({ refusal: true }))?.kind).toBe(
      HarvestAlertKind.RUN_BLOCKED
    );
    expect(runAlertFor(runInput({ refusal: false }))?.kind).toBe(
      HarvestAlertKind.RUN_FAILED
    );
  });

  it('gives nothing for COMPLETED and for ABORTED, by a person or by a shutdown', () => {
    expect(
      runAlertFor(runInput({ status: HarvestRunStatus.COMPLETED }))
    ).toBeNull();
    expect(
      runAlertFor(
        runInput({
          status: HarvestRunStatus.ABORTED,
          error: 'Stopped because the harvester shut down.',
        })
      )
    ).toBeNull();
    expect(
      runAlertFor(runInput({ status: HarvestRunStatus.ABORTED, error: null }))
    ).toBeNull();
  });

  it('gives RUN_STALE for a STALE run of any trigger, keyed on the run (the owner, answer 5)', () => {
    for (const trigger of Object.values(HarvestRunTrigger)) {
      const draft = runAlertFor(
        runInput({
          run: run({ trigger }),
          status: HarvestRunStatus.STALE,
          error: 'The stale reaper marked the run.',
          staleAfterSeconds: 900,
        })
      );
      expect(draft).toMatchObject({
        kind: HarvestAlertKind.RUN_STALE,
        dedupeKey: 'run:run-1',
      });
      expect(draft?.payload).toMatchObject({
        staleAfterSeconds: 900,
        error: 'The stale reaper marked the run.',
      });
    }
  });

  it('gives nothing for a FAILED SYSTEM run, unless it takes the counter to 3 with a schedule on', () => {
    const system = run({ trigger: HarvestRunTrigger.SYSTEM });
    expect(runAlertFor(runInput({ run: system }))).toBeNull();
    expect(
      runAlertFor(
        runInput({ run: system, failuresBefore: 2, enabledSchedules: 0 })
      )
    ).toBeNull();
    const stopped = runAlertFor(
      runInput({ run: system, failuresBefore: 2, enabledSchedules: 1 })
    );
    expect(stopped?.kind).toBe(HarvestAlertKind.RUN_FAILED);
    expect(stopped?.payload['schedulesStopped']).toBe(1);
  });

  it('sets schedulesStopped from 2 to 3 with two schedules on, and not with none or from 3 to 4', () => {
    expect(
      runAlertFor(runInput({ failuresBefore: 2, enabledSchedules: 2 }))
        ?.payload['schedulesStopped']
    ).toBe(2);
    expect(
      runAlertFor(runInput({ failuresBefore: 2, enabledSchedules: 0 }))
        ?.payload['schedulesStopped']
    ).toBeNull();
    expect(
      runAlertFor(runInput({ failuresBefore: 3, enabledSchedules: 2 }))
        ?.payload['schedulesStopped']
    ).toBeNull();
  });

  it('asks for the schedule count only for the failure that reaches the threshold', () => {
    expect(needsScheduleCount(HarvestRunStatus.FAILED, 2)).toBe(true);
    expect(needsScheduleCount(HarvestRunStatus.FAILED, 1)).toBe(false);
    expect(needsScheduleCount(HarvestRunStatus.FAILED, 3)).toBe(false);
    expect(needsScheduleCount(HarvestRunStatus.FAILED, null)).toBe(false);
    expect(needsScheduleCount(HarvestRunStatus.COMPLETED, 2)).toBe(false);
  });

  it('stops the schedules at the same number the scheduler skips at', () => {
    expect(SCHEDULES_STOP_AFTER).toBe(SOURCE_FAILING_AFTER);
  });
});

describe('slotAlertFor', () => {
  const SLOT = new Date('2026-11-05T03:00:00.000Z');
  const AT = new Date('2026-11-05T03:00:30.000Z');
  const refused = {
    outcome: HarvestScheduleOutcome.REFUSED,
    note: 'That source is disabled. Enable it with supermarketSource.setEnabled.',
  };

  function schedule(over: Partial<SlotAlertSchedule> = {}): SlotAlertSchedule {
    return {
      id: 'schedule-1',
      presetId: 'preset-1',
      supermarketId: 'chain-1',
      lastOutcome: HarvestScheduleOutcome.STARTED,
      lastOutcomeNote: null,
      ...over,
    };
  }

  const input = (
    over: Partial<Parameters<typeof slotAlertFor>[0]> = {}
  ): Parameters<typeof slotAlertFor>[0] => ({
    schedule: schedule(),
    slot: SLOT,
    retry: false,
    result: refused,
    adapterKey: null,
    at: AT,
    ...over,
  });

  it('alerts a REFUSED slot after STARTED, keyed on the schedule and the slot', () => {
    expect(slotAlertFor(input())).toMatchObject({
      kind: HarvestAlertKind.SLOT_REFUSED,
      dedupeKey: `slot:schedule-1:${SLOT.toISOString()}`,
      scheduleId: 'schedule-1',
      supermarketId: 'chain-1',
      runId: null,
      payload: expect.objectContaining({
        note: refused.note,
        slot: SLOT.toISOString(),
        retry: false,
      }),
    });
  });

  it('does not alert REFUSED after REFUSED with the same note, and does with another note', () => {
    expect(
      slotAlertFor(
        input({
          schedule: schedule({
            lastOutcome: HarvestScheduleOutcome.REFUSED,
            lastOutcomeNote: refused.note,
          }),
        })
      )
    ).toBeNull();
    expect(
      slotAlertFor(
        input({
          schedule: schedule({
            lastOutcome: HarvestScheduleOutcome.REFUSED,
            lastOutcomeNote: 'The preset no longer exists.',
          }),
        })
      )?.kind
    ).toBe(HarvestAlertKind.SLOT_REFUSED);
  });

  it('alerts a refused retry with the :retry key', () => {
    expect(slotAlertFor(input({ retry: true }))?.dedupeKey).toBe(
      `slot:schedule-1:${SLOT.toISOString()}:retry`
    );
  });

  it('gives nothing for SKIPPED_BUSY, SKIPPED_LATE, SKIPPED_FAILING and STARTED', () => {
    for (const outcome of [
      HarvestScheduleOutcome.SKIPPED_BUSY,
      HarvestScheduleOutcome.SKIPPED_LATE,
      HarvestScheduleOutcome.SKIPPED_FAILING,
      HarvestScheduleOutcome.STARTED,
    ]) {
      expect(
        slotAlertFor(input({ result: { outcome, note: 'x' } }))
      ).toBeNull();
    }
  });
});

describe('postalCodeAlertFor (the owner, answer 4)', () => {
  const AT = new Date('2026-11-05T04:00:00.000Z');
  const request = (attempts: number) => ({
    id: 'q-1',
    postalCode: '14013',
    country: 'es',
    attempts,
    lastAttemptedAt: new Date('2026-11-05T03:59:00.000Z'),
  });

  it('gives nothing for an attempt that leaves the code queued', () => {
    for (const attempts of [1, 2]) {
      expect(
        postalCodeAlertFor({
          request: request(attempts),
          maxAttempts: 3,
          error: 'Overpass timed out',
          runId: 'run-9',
          at: AT,
        })
      ).toBeNull();
    }
  });

  it('gives POSTAL_CODE_FAILED for the attempt that gives up, keyed on the code and the run', () => {
    expect(
      postalCodeAlertFor({
        request: request(3),
        maxAttempts: 3,
        error: 'OpenStreetMap: Overpass timed out',
        runId: 'run-9',
        at: AT,
      })
    ).toEqual({
      kind: HarvestAlertKind.POSTAL_CODE_FAILED,
      dedupeKey: 'code:14013:run-9',
      supermarketId: null,
      runId: 'run-9',
      scheduleId: null,
      payload: {
        postalCode: '14013',
        country: 'es',
        attempts: 3,
        error: 'OpenStreetMap: Overpass timed out',
        runId: 'run-9',
        at: AT.toISOString(),
      },
    });
  });

  it('keys on the attempt when no run started', () => {
    const draft = postalCodeAlertFor({
      request: request(3),
      maxAttempts: 3,
      error: 'the database is down',
      runId: null,
      at: AT,
    });
    expect(draft?.dedupeKey).toBe(
      `code:14013:attempt-q-1-${Date.parse('2026-11-05T03:59:00.000Z')}`
    );
    expect(draft?.runId).toBeNull();
  });
});

describe('testAlertFor', () => {
  it('is a TEST keyed on its own id', () => {
    const at = new Date('2026-11-05T10:00:00.000Z');
    expect(testAlertFor({ id: 'abc', userId: 'admin-1', at })).toEqual({
      kind: HarvestAlertKind.TEST,
      dedupeKey: 'test:abc',
      supermarketId: null,
      runId: null,
      scheduleId: null,
      payload: { requestedByUserId: 'admin-1', at: at.toISOString() },
    });
  });
});
