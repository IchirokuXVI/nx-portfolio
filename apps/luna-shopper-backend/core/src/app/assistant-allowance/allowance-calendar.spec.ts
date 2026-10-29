import {
  addDays,
  calendarAt,
  isTimeZone,
  localDay,
  monthStart,
  startOfDay,
  zonedIso,
} from './allowance-calendar';

describe('the allowance calendar (plan 0234)', () => {
  it('knows an IANA name and refuses anything else', () => {
    expect(isTimeZone('Europe/Madrid')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });

  it('reads the date in the zone, not in UTC', () => {
    // 23:30 UTC on 31 October is already 1 November in Madrid (UTC+1).
    const instant = new Date('2026-10-31T23:30:00Z');
    expect(localDay(instant, 'UTC')).toBe('2026-10-31');
    expect(localDay(instant, 'Europe/Madrid')).toBe('2026-11-01');
  });

  it('moves days and months on the calendar alone', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(monthStart('2026-10-27')).toBe('2026-10-01');
    expect(monthStart('2026-12-15', 1)).toBe('2027-01-01');
    expect(monthStart('2026-01-15', -13)).toBe('2024-12-01');
  });

  it('finds midnight across a change of summer time', () => {
    // Madrid leaves summer time on 25 October 2026, so the 26th starts at
    // 23:00 UTC and the 25th at 22:00 UTC.
    expect(startOfDay('2026-10-25', 'Europe/Madrid').toISOString()).toBe(
      '2026-10-24T22:00:00.000Z'
    );
    expect(startOfDay('2026-10-26', 'Europe/Madrid').toISOString()).toBe(
      '2026-10-25T23:00:00.000Z'
    );
  });

  it('starts a day that skips midnight at its first minute', () => {
    // Santiago de Chile moves its clocks from 00:00 to 01:00 on 6 September
    // 2026, so that day starts at 01:00 local, 04:00 UTC.
    const start = startOfDay('2026-09-06', 'America/Santiago');
    expect(localDay(start, 'America/Santiago')).toBe('2026-09-06');
    expect(
      localDay(new Date(start.getTime() - 60_000), 'America/Santiago')
    ).toBe('2026-09-05');
  });

  it('writes an instant with the offset of the zone', () => {
    expect(zonedIso(new Date('2026-10-27T23:00:00Z'), 'Europe/Madrid')).toBe(
      '2026-10-28T00:00:00+01:00'
    );
    expect(zonedIso(new Date('2026-07-01T10:15:30Z'), 'UTC')).toBe(
      '2026-07-01T10:15:30+00:00'
    );
    expect(zonedIso(new Date('2026-07-01T10:00:00Z'), 'America/New_York')).toBe(
      '2026-07-01T06:00:00-04:00'
    );
  });

  it('says when the day and the month turn over', () => {
    const calendar = calendarAt(
      new Date('2026-10-27T15:00:00Z'),
      'Europe/Madrid'
    );
    expect(calendar).toEqual({
      day: '2026-10-27',
      monthStart: '2026-10-01',
      nextMonthStart: '2026-11-01',
      dayResetsAt: '2026-10-28T00:00:00+01:00',
      monthResetsAt: '2026-11-01T00:00:00+01:00',
    });
  });
});
