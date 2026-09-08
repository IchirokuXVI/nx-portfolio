import { countAxis, dayFormatter, parseDay } from './chart-scale';

/**
 * The arithmetic the two charts share, which is where the judgement about what a
 * tick may say lives. d3 will happily produce a gridline at 2.5, and every number
 * these charts draw is a count of something, so 2.5 of it cannot exist.
 */
describe('countAxis', () => {
  it.each<[number, number[]]>([
    [15, [0, 5, 10, 15]],
    [4, [0, 1, 2, 3, 4]],
    [1, [0, 1]],
    [37, [0, 10, 20, 30, 40]],
    [230, [0, 100, 200, 300]],
  ])('labels a maximum of %s with whole numbers', (max, ticks) => {
    const axis = countAxis(max);

    expect(axis.ticks).toEqual(ticks);
    expect(axis.top).toBe(ticks[ticks.length - 1]);
    expect(axis.top).toBeGreaterThanOrEqual(max);
    for (const tick of axis.ticks) {
      expect(Number.isInteger(tick)).toBe(true);
    }
  });

  /**
   * Zero still gets a frame. A chart that collapsed to one line when nothing
   * happened would be read as a chart that failed, and zero to four is small
   * enough that tomorrow's first event shows.
   */
  it.each<[string, number]>([
    ['zero', 0],
    ['a negative', -5],
    ['nothing at all', Number.NaN],
  ])('still draws an axis for %s', (_case, max) => {
    expect(countAxis(max)).toEqual({ top: 4, ticks: [0, 1, 2, 3, 4] });
  });
});

describe('parseDay', () => {
  it('reads a day as midnight UTC, so it never shifts under a reader', () => {
    expect(parseDay('2026-01-05')?.toISOString()).toBe(
      '2026-01-05T00:00:00.000Z'
    );
  });

  it.each(['', '2026-1-5', '5 January 2026', '2026-13-40'])(
    'refuses %s rather than guessing',
    (day) => {
      expect(parseDay(day)).toBeNull();
    }
  );
});

describe('dayFormatter', () => {
  it('formats in UTC, so the axis names the day the backend counted', () => {
    const at = parseDay('2026-01-05') as Date;

    expect(dayFormatter('en').format(at)).toBe(
      new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(at)
    );
  });
});
