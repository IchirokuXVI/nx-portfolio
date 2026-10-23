import {
  dayName,
  daysFromDraft,
  daysToDraft,
  estimateMinutes,
  nextRunWords,
  nextScheduleSlot,
  scheduleBlockKey,
  scheduleCadence,
  scheduleOutcomeKey,
  scheduleState,
  sortedDays,
  zonePlace,
} from './harvest-schedule';

describe('the days of a schedule', () => {
  it('are sorted, once each, Monday first', () => {
    expect(sortedDays([5, 1, 3, 1, 7])).toEqual([1, 3, 5, 7]);
    expect(sortedDays(['3', '1'])).toEqual([1, 3]);
  });

  it('leave out what is no ISO day', () => {
    expect(sortedDays([0, 8, 2.5, 'x', null, 2])).toEqual([2]);
  });

  it('go into a form as one sorted text and come back as numbers', () => {
    expect(daysToDraft([5, 1, 3])).toBe('1,3,5');
    expect(daysFromDraft('5,1,3,3')).toEqual([1, 3, 5]);
    expect(daysFromDraft('')).toEqual([]);
    expect(daysFromDraft([7, 6])).toEqual([6, 7]);
  });

  it('are named Monday first', () => {
    expect(dayName(1, 'en')).toBe('Mon');
    expect(dayName(7, 'en', 'long')).toBe('Sunday');
  });
});

describe('when a schedule runs, in words', () => {
  it('names the days and the time', () => {
    expect(
      scheduleCadence({ daysOfWeek: [5, 1, 3], timeOfDay: '06:00' }, 'en')
    ).toEqual({
      key: 'harvest.schedules.cadence.days',
      args: { days: 'Mon, Wed, Fri', time: '06:00' },
    });
  });

  it('says every day for all seven', () => {
    expect(
      scheduleCadence(
        { daysOfWeek: [1, 2, 3, 4, 5, 6, 7], timeOfDay: '22:30' },
        'en'
      )
    ).toEqual({
      key: 'harvest.schedules.cadence.daily',
      args: { time: '22:30' },
    });
  });
});

describe('the next run', () => {
  // Tuesday 27 October 2026, 06:00 in Madrid, which is 05:00 UTC in winter.
  const at = '2026-10-27T05:00:00.000Z';

  it('is said once when the person is in the same timezone', () => {
    expect(
      nextRunWords(at, 'Europe/Madrid', 'Europe/Madrid', 'en')
    ).toMatchObject({ time: '06:00', place: 'Madrid', here: null });
  });

  it('is said in the person time as well when it differs', () => {
    expect(
      nextRunWords(at, 'Europe/Madrid', 'Europe/London', 'en')
    ).toMatchObject({ time: '06:00', place: 'Madrid', here: '05:00' });
  });

  it('names the day too when the person is on another day', () => {
    // 03:00 on Tuesday in Madrid is 22:00 on Monday in New York.
    const late = '2026-10-27T02:00:00.000Z';
    const words = nextRunWords(late, 'Europe/Madrid', 'America/New_York', 'en');
    expect(words?.here).toContain('22:00');
    expect(words?.here).toContain('Mon');
  });

  it('is nothing for a schedule that is off', () => {
    expect(nextRunWords(null, 'Europe/Madrid', 'UTC', 'en')).toBeNull();
  });

  it('names the place of a timezone', () => {
    expect(zonePlace('America/New_York')).toBe('New York');
  });
});

describe('the slot of a rule', () => {
  const rule = {
    timeOfDay: '06:00',
    daysOfWeek: [1, 3, 5],
    timezone: 'Europe/Madrid',
  };

  it('is the first one strictly after the instant', () => {
    // Monday 26 October 2026, 10:00 UTC: Monday's slot is gone.
    expect(
      nextScheduleSlot(
        rule,
        new Date('2026-10-26T10:00:00.000Z')
      )?.toISOString()
    ).toBe('2026-10-28T05:00:00.000Z');
  });

  it('follows the clock of the timezone across a change of the time', () => {
    // Friday 23 October 2026 is still summer time in Madrid, UTC+2.
    expect(
      nextScheduleSlot(
        rule,
        new Date('2026-10-22T10:00:00.000Z')
      )?.toISOString()
    ).toBe('2026-10-23T04:00:00.000Z');
  });

  it('is nothing for a rule with no day', () => {
    expect(
      nextScheduleSlot({ ...rule, daysOfWeek: [] }, new Date())
    ).toBeNull();
  });
});

describe('what a schedule says about itself', () => {
  it('is off, on, or on and kept from running', () => {
    expect(
      scheduleState({ enabled: false, blockedBy: 'SOURCE_DISABLED' })
    ).toBe('off');
    expect(scheduleState({ enabled: true, blockedBy: null })).toBe('on');
    expect(
      scheduleState({ enabled: true, blockedBy: 'SCHEDULER_DISABLED' })
    ).toBe('blocked');
  });

  it('has a sentence for each block and a phrase for each outcome', () => {
    expect(scheduleBlockKey('SOURCE_FAILING')).toBe(
      'harvest.schedules.blocked.SOURCE_FAILING'
    );
    expect(scheduleOutcomeKey('SKIPPED_BUSY')).toBe(
      'harvest.schedules.outcome.SKIPPED_BUSY'
    );
  });

  it('takes about a whole number of minutes, never none', () => {
    expect(estimateMinutes(1200)).toBe(20);
    expect(estimateMinutes(10)).toBe(1);
  });
});
