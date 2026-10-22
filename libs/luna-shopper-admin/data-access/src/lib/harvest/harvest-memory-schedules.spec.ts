import { GatewayError } from '../gateway-error';
import { HarvestMemory } from './harvest-memory';
import {
  DEZA_CATALOG_PRESET,
  DEZA_NIGHTLY_SCHEDULE,
  MERCADONA_SUNDAY_SCHEDULE,
  MERCADONA_WEEKDAYS_SCHEDULE,
  MERCADONA_WEEKLY_PRESET,
} from './harvest-seed';

/**
 * Schedules out of memory (admin plan 0067, target 11): the rules the
 * harvester keeps, with nothing listening, and no timer.
 */
const MERCADONA = '11111111-1111-4111-8111-111111111111';
const DEZA = '33333333-3333-4333-8333-333333333333';

async function refusal(promise: Promise<unknown>): Promise<GatewayError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(GatewayError);
  return error as GatewayError;
}

describe('HarvestMemory, schedules', () => {
  it('seeds one that runs, one that is off and one that will not run', async () => {
    const memory = new HarvestMemory();

    const page = await memory.listSchedules({});

    expect(
      page.items.map((schedule) => [
        schedule.id,
        schedule.enabled,
        schedule.blockedBy,
      ])
    ).toEqual(
      expect.arrayContaining([
        [MERCADONA_WEEKDAYS_SCHEDULE, true, null],
        [MERCADONA_SUNDAY_SCHEDULE, false, null],
        [DEZA_NIGHTLY_SCHEDULE, true, 'SOURCE_DISABLED'],
      ])
    );
    // The one that is off has no next run, and comes last.
    expect(page.items[page.items.length - 1]).toMatchObject({
      id: MERCADONA_SUNDAY_SCHEDULE,
      nextRunAt: null,
    });
  });

  it('reads the preset, the last run and the estimate onto the view', async () => {
    const memory = new HarvestMemory();

    const view = await memory.readSchedule(MERCADONA_WEEKDAYS_SCHEDULE);

    expect(view).toMatchObject({
      presetName: 'Weekly warehouses',
      lastRun: { id: 'run-catalog-completed', status: 'COMPLETED' },
      estimate: { basis: 'PRESET', samples: 1 },
    });
    expect(view.nextRunAt).not.toBeNull();
  });

  it('narrows the list by chain and by preset', async () => {
    const memory = new HarvestMemory();

    const deza = await memory.listSchedules({ supermarketId: DEZA });
    const weekly = await memory.listSchedules({
      presetId: MERCADONA_WEEKLY_PRESET,
    });

    expect(deza.items.map((schedule) => schedule.id)).toEqual([
      DEZA_NIGHTLY_SCHEDULE,
    ]);
    expect(weekly.items).toHaveLength(2);
  });

  it('refuses a create without the consent, naming the field', async () => {
    const memory = new HarvestMemory();

    const error = await refusal(
      memory.createSchedule({
        presetId: MERCADONA_WEEKLY_PRESET,
        timeOfDay: '06:00',
        daysOfWeek: [1],
        acknowledgedAutomaticFetch: false,
      })
    );

    expect(error).toMatchObject({ status: 400, code: 'validation_failed' });
    expect(Object.keys(error.fieldErrors)).toEqual([
      'acknowledgedAutomaticFetch',
    ]);
  });

  it('adds one with the consent, on, under the chain of its preset', async () => {
    const memory = new HarvestMemory();

    const view = await memory.createSchedule({
      presetId: DEZA_CATALOG_PRESET,
      timeOfDay: '04:15',
      daysOfWeek: [6],
      acknowledgedAutomaticFetch: true,
    });

    expect(view).toMatchObject({
      supermarketId: DEZA,
      timezone: 'Europe/Madrid',
      enabled: true,
      blockedBy: 'SOURCE_DISABLED',
    });
  });

  it('refuses a rule the harvester refuses', async () => {
    const memory = new HarvestMemory();
    const base = {
      presetId: MERCADONA_WEEKLY_PRESET,
      acknowledgedAutomaticFetch: true,
    };

    const time = await refusal(
      memory.createSchedule({ ...base, timeOfDay: '6:00', daysOfWeek: [1] })
    );
    const days = await refusal(
      memory.createSchedule({ ...base, timeOfDay: '06:00', daysOfWeek: [1, 1] })
    );
    const zone = await refusal(
      memory.createSchedule({
        ...base,
        timeOfDay: '06:00',
        daysOfWeek: [1],
        timezone: 'Nowhere/Else',
      })
    );

    expect(Object.keys(time.fieldErrors)).toEqual(['timeOfDay']);
    expect(Object.keys(days.fieldErrors)).toEqual(['daysOfWeek']);
    expect(Object.keys(zone.fieldErrors)).toEqual(['timezone']);
  });

  it('asks for the consent to turn one on, and not to turn one off', async () => {
    const memory = new HarvestMemory();

    const error = await refusal(
      memory.setScheduleEnabled(MERCADONA_SUNDAY_SCHEDULE, { enabled: true })
    );
    expect(error.status).toBe(400);

    await expect(
      memory.setScheduleEnabled(MERCADONA_SUNDAY_SCHEDULE, {
        enabled: true,
        acknowledgedAutomaticFetch: true,
      })
    ).resolves.toMatchObject({ enabled: true });
    await expect(
      memory.setScheduleEnabled(MERCADONA_SUNDAY_SCHEDULE, { enabled: false })
    ).resolves.toMatchObject({ enabled: false, nextRunAt: null });
  });

  it('says a chain that keeps failing will not run', async () => {
    const memory = new HarvestMemory();
    await memory.setSourceEnabled(DEZA, true);

    expect(
      (await memory.readSchedule(DEZA_NIGHTLY_SCHEDULE)).blockedBy
    ).toBeNull();

    // The memory back end has no route that counts failures, so the seed's
    // count is raised by hand.
    const failing = (
      memory as unknown as {
        _sources: { supermarketId: string; consecutiveFailures: number }[];
      }
    )._sources.find((row) => row.supermarketId === MERCADONA);
    if (failing !== undefined) {
      failing.consecutiveFailures = 3;
    }

    expect(
      (await memory.readSchedule(MERCADONA_WEEKDAYS_SCHEDULE)).blockedBy
    ).toBe('SOURCE_FAILING');
  });

  it('changes the time and the days, sorted', async () => {
    const memory = new HarvestMemory();

    const view = await memory.updateSchedule(MERCADONA_WEEKDAYS_SCHEDULE, {
      timeOfDay: '07:30',
      daysOfWeek: [5, 2],
    });

    expect(view).toMatchObject({ timeOfDay: '07:30', daysOfWeek: [2, 5] });
  });

  it('refuses to delete a preset a schedule names, and names the schedule', async () => {
    const memory = new HarvestMemory();

    const error = await refusal(memory.deletePreset(DEZA_CATALOG_PRESET));

    expect(error).toMatchObject({ status: 409, code: 'conflict' });
    expect(error.detail).toContain(DEZA_NIGHTLY_SCHEDULE);

    await memory.deleteSchedule(DEZA_NIGHTLY_SCHEDULE);
    await expect(memory.deletePreset(DEZA_CATALOG_PRESET)).resolves.toBe(
      undefined
    );
  });

  it('lists the runs a schedule started, and the runs a person started', async () => {
    const memory = new HarvestMemory();

    const scheduled = await memory.listRuns({ trigger: 'SCHEDULED' });
    const byOne = await memory.listRuns({
      scheduleId: MERCADONA_WEEKDAYS_SCHEDULE,
    });
    const manual = await memory.listRuns({ trigger: 'MANUAL' });

    expect(scheduled.items.map((run) => run.id)).toEqual([
      'run-catalog-completed',
    ]);
    expect(byOne.items.map((run) => run.id)).toEqual(['run-catalog-completed']);
    expect(manual.items.map((run) => run.trigger)).not.toContain('SCHEDULED');
  });
});
