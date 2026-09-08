import { daysInWindow, fillDailyWindow, toUtcDay } from './daily-window';

/**
 * The window fill (plan 0088, section 2).
 *
 * Pure, so it carries its own edge cases here rather than in four integration
 * specs. What it exists to guarantee is that a chart never has to invent a gap:
 * every day the gateway named is present, in order, with zero where nothing
 * happened.
 */
const WINDOW = { from: '2026-08-08', to: '2026-09-06' };

describe('daysInWindow', () => {
  it('covers both ends, so thirty days apart is thirty entries', () => {
    const days = daysInWindow(WINDOW);

    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-08-08');
    expect(days[29]).toBe('2026-09-06');
  });

  it('is one day when both ends are the same day', () => {
    expect(daysInWindow({ from: '2026-09-06', to: '2026-09-06' })).toEqual([
      '2026-09-06',
    ]);
  });

  it('crosses a month and a leap day without losing one', () => {
    expect(daysInWindow({ from: '2028-02-27', to: '2028-03-02' })).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
      '2028-03-02',
    ]);
  });

  /**
   * A backwards or unreadable window is empty rather than an infinite loop. It
   * cannot arrive from the gateway, which computes both ends from one clock, so
   * the answer only has to be safe.
   */
  it('is empty when the window is backwards or unreadable', () => {
    expect(daysInWindow({ from: '2026-09-06', to: '2026-08-08' })).toEqual([]);
    expect(daysInWindow({ from: 'not a day', to: '2026-08-08' })).toEqual([]);
  });
});

describe('toUtcDay', () => {
  it('reads a day off a Date, an ISO timestamp and a day string alike', () => {
    expect(toUtcDay(new Date('2026-08-09T23:30:00.000Z'))).toBe('2026-08-09');
    expect(toUtcDay('2026-08-09T00:00:00.000Z')).toBe('2026-08-09');
    expect(toUtcDay('2026-08-09')).toBe('2026-08-09');
  });
});

describe('fillDailyWindow', () => {
  it('answers a full window of zeros for an empty result set', () => {
    const series = fillDailyWindow(WINDOW, []);

    expect(series).toHaveLength(30);
    expect(series.every((point) => point.count === 0)).toBe(true);
  });

  /** The claim the plan makes by name: two rows still produce thirty entries. */
  it('spreads two rows over the whole window', () => {
    const series = fillDailyWindow(WINDOW, [
      { day: '2026-08-08', count: 3 },
      { day: '2026-09-06', count: 1 },
    ]);

    expect(series).toHaveLength(30);
    expect(series[0]).toEqual({ day: '2026-08-08', count: 3 });
    expect(series[29]).toEqual({ day: '2026-09-06', count: 1 });
    expect(series.slice(1, 29).every((point) => point.count === 0)).toBe(true);
  });

  it('counts a string, because Postgres returns count(*) as one', () => {
    const series = fillDailyWindow(WINDOW, [{ day: '2026-08-10', count: '7' }]);

    expect(series[2]).toEqual({ day: '2026-08-10', count: 7 });
  });

  it('adds two rows that landed on one day together', () => {
    const series = fillDailyWindow(WINDOW, [
      { day: '2026-08-10T00:00:00.000Z', count: 2 },
      { day: new Date('2026-08-10T00:00:00.000Z'), count: 5 },
    ]);

    expect(series[2].count).toBe(7);
  });

  /**
   * Dropped rather than appended. The caller asked for a window, and a chart
   * drawn from a series longer than the axis it was given has to guess.
   */
  it('drops a row outside the window', () => {
    const series = fillDailyWindow(WINDOW, [
      { day: '2026-08-07', count: 9 },
      { day: '2026-09-07', count: 9 },
    ]);

    expect(series).toHaveLength(30);
    expect(series.every((point) => point.count === 0)).toBe(true);
  });

  it('is in order, oldest first', () => {
    const days = fillDailyWindow(WINDOW, []).map((point) => point.day);

    expect([...days].sort()).toEqual(days);
  });
});
