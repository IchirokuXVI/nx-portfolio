import { formatDuration, formatMetres, formatStarted } from './format';

describe('format', () => {
  it('writes durations as m:ss, and h:mm:ss past an hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_900)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(-5)).toBe('0:00');
  });

  it('writes metres with one decimal in the locale', () => {
    expect(formatMetres(12.345, 'en')).toBe('12.3');
    expect(formatMetres(12.345, 'es')).toBe('12,3');
    expect(formatMetres(Number.NaN, 'en')).toBe('');
  });

  it('writes the start in the locale, and leaves a broken date as it is', () => {
    expect(formatStarted('2026-09-28T10:05:00+02:00', 'en')).toMatch(/2026/);
    expect(formatStarted('yesterday', 'en')).toBe('yesterday');
  });
});
