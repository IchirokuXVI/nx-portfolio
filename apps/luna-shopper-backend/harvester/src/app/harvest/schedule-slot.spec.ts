import {
  isKnownTimezone,
  isTooLate,
  nextSlot,
  previousSlot,
  type SlotRule,
} from './schedule-slot';

/**
 * The slot of a schedule (plan 0206, section 3).
 *
 * Every instant is written in UTC. 2026-10-14 is a Wednesday, Madrid is UTC+2
 * until 2026-10-25 and UTC+1 after it, and the clock went forward on
 * 2026-03-29.
 */

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

function rule(
  timeOfDay: string,
  daysOfWeek: number[] = EVERY_DAY,
  timezone = 'Europe/Madrid'
): SlotRule {
  return { timeOfDay, daysOfWeek, timezone };
}

const at = (iso: string): Date => new Date(iso);

describe('nextSlot', () => {
  it('answers a slot later on the same day', () => {
    expect(nextSlot(rule('03:00'), at('2026-10-14T00:30:00Z'))).toEqual(
      at('2026-10-14T01:00:00Z')
    );
  });

  it('answers the next day once the slot of today has passed', () => {
    expect(nextSlot(rule('03:00'), at('2026-10-14T05:00:00Z'))).toEqual(
      at('2026-10-15T01:00:00Z')
    );
  });

  it('answers a slot strictly after the instant it is given', () => {
    expect(nextSlot(rule('03:00'), at('2026-10-14T01:00:00Z'))).toEqual(
      at('2026-10-15T01:00:00Z')
    );
  });

  it('walks to a later day of the week', () => {
    // Monday and Friday only, asked on a Wednesday.
    expect(nextSlot(rule('03:00', [1, 5]), at('2026-10-14T05:00:00Z'))).toEqual(
      at('2026-10-16T01:00:00Z')
    );
  });

  it('walks across a whole week to the same weekday', () => {
    // Wednesday only, asked on a Wednesday after its slot.
    expect(nextSlot(rule('03:00', [3]), at('2026-10-14T05:00:00Z'))).toEqual(
      at('2026-10-21T01:00:00Z')
    );
  });

  it('takes Sunday as 7', () => {
    expect(nextSlot(rule('22:00', [7]), at('2026-10-14T05:00:00Z'))).toEqual(
      at('2026-10-18T20:00:00Z')
    );
  });

  it('answers the first instant after the gap for a time that does not exist', () => {
    // 02:30 does not exist in Madrid on 2026-03-29: the clock goes from 02:00
    // straight to 03:00, which is 01:00 UTC.
    const daily = rule('02:30');
    const slot = nextSlot(daily, at('2026-03-28T23:00:00Z'));
    expect(slot).toEqual(at('2026-03-29T01:00:00Z'));
    // One time that day, and the usual time the day after.
    expect(nextSlot(daily, slot)).toEqual(at('2026-03-30T00:30:00Z'));
  });

  it('answers the first of the two for a time that occurs two times', () => {
    // 02:30 occurs at 00:30 UTC (summer time) and at 01:30 UTC (winter time)
    // in Madrid on 2026-10-25.
    const daily = rule('02:30');
    const slot = nextSlot(daily, at('2026-10-24T23:00:00Z'));
    expect(slot).toEqual(at('2026-10-25T00:30:00Z'));
    // The second 02:30 is not a second slot.
    expect(nextSlot(daily, slot)).toEqual(at('2026-10-26T01:30:00Z'));
  });

  it('uses the timezone of the rule and not the one of the machine', () => {
    expect(
      nextSlot(
        rule('09:00', EVERY_DAY, 'America/New_York'),
        at('2026-10-14T05:00:00Z')
      )
    ).toEqual(at('2026-10-14T13:00:00Z'));
    expect(
      nextSlot(
        rule('09:00', EVERY_DAY, 'Asia/Tokyo'),
        at('2026-10-14T05:00:00Z')
      )
    ).toEqual(at('2026-10-15T00:00:00Z'));
  });

  it('reads the local day, which can differ from the UTC day', () => {
    // 23:30 UTC on Wednesday is already Thursday in Tokyo.
    expect(
      nextSlot(rule('09:00', [4], 'Asia/Tokyo'), at('2026-10-14T23:30:00Z'))
    ).toEqual(at('2026-10-15T00:00:00Z'));
  });
});

describe('previousSlot', () => {
  it('answers the last slot at or before the instant', () => {
    expect(previousSlot(rule('03:00'), at('2026-10-14T05:00:00Z'))).toEqual(
      at('2026-10-14T01:00:00Z')
    );
    expect(previousSlot(rule('03:00'), at('2026-10-14T01:00:00Z'))).toEqual(
      at('2026-10-14T01:00:00Z')
    );
  });

  it('answers yesterday before the slot of today', () => {
    expect(previousSlot(rule('03:00'), at('2026-10-14T00:59:00Z'))).toEqual(
      at('2026-10-13T01:00:00Z')
    );
  });

  it('judges the newest missed slot, not the oldest (review point 1)', () => {
    // A daily 03:00 and a pod that was down from Monday 02:00 to Wednesday
    // 04:00, Madrid time. The slot judged is Wednesday 03:00, one hour late,
    // and it runs.
    const daily = rule('03:00');
    const now = at('2026-10-14T02:00:00Z');
    const slot = previousSlot(daily, now);
    expect(slot).toEqual(at('2026-10-14T01:00:00Z'));
    expect(isTooLate(daily, slot, now)).toBe(false);
  });

  it('walks back across a week', () => {
    // Friday only, asked on a Wednesday.
    expect(
      previousSlot(rule('03:00', [5]), at('2026-10-14T05:00:00Z'))
    ).toEqual(at('2026-10-09T01:00:00Z'));
  });

  it('agrees with nextSlot on the night the clock goes back', () => {
    const daily = rule('02:30');
    expect(previousSlot(daily, at('2026-10-25T03:00:00Z'))).toEqual(
      at('2026-10-25T00:30:00Z')
    );
  });
});

describe('isTooLate', () => {
  const minute = 60_000;
  const hour = 60 * minute;

  it('lets a daily slot run for just under twelve hours', () => {
    const daily = rule('03:00');
    const slot = at('2026-10-14T01:00:00Z');
    expect(
      isTooLate(daily, slot, new Date(slot.getTime() + 12 * hour - minute))
    ).toBe(false);
    expect(
      isTooLate(daily, slot, new Date(slot.getTime() + 12 * hour + minute))
    ).toBe(true);
  });

  it('lets a weekly slot run for just under three and a half days', () => {
    const weekly = rule('03:00', [3]);
    const slot = at('2026-10-14T01:00:00Z');
    const half = 3.5 * 24 * hour;
    expect(
      isTooLate(weekly, slot, new Date(slot.getTime() + half - minute))
    ).toBe(false);
    expect(
      isTooLate(weekly, slot, new Date(slot.getTime() + half + minute))
    ).toBe(true);
  });

  it('measures the gap to the slot after it, which may be shorter than a week', () => {
    // Monday and Wednesday: the gap after Monday is two days, so a Monday slot
    // is too late after one day.
    const twice = rule('03:00', [1, 3]);
    const monday = at('2026-10-12T01:00:00Z');
    expect(isTooLate(twice, monday, at('2026-10-13T00:59:00Z'))).toBe(false);
    expect(isTooLate(twice, monday, at('2026-10-13T01:01:00Z'))).toBe(true);
  });

  it('is false at the slot itself', () => {
    const slot = at('2026-10-14T01:00:00Z');
    expect(isTooLate(rule('03:00'), slot, slot)).toBe(false);
  });
});

describe('isKnownTimezone', () => {
  it('accepts an IANA name and refuses anything else', () => {
    expect(isKnownTimezone('Europe/Madrid')).toBe(true);
    expect(isKnownTimezone('UTC')).toBe(true);
    expect(isKnownTimezone('Europe/Atlantis')).toBe(false);
    expect(isKnownTimezone('')).toBe(false);
  });
});
