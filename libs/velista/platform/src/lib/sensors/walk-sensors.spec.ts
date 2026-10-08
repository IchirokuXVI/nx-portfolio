import { onPerformanceClock } from './walk-sensors';

describe('onPerformanceClock', () => {
  it('keeps a timestamp within a second of now', () => {
    expect(onPerformanceClock(9_950.5, 10_000)).toBe(9_950.5);
    expect(onPerformanceClock(10_020, 10_000)).toBe(10_020);
  });

  it('answers now for a timestamp on another clock', () => {
    // The time since boot, days ahead of a page opened a minute ago.
    expect(onPerformanceClock(400_000_000, 60_000)).toBe(60_000);
    expect(onPerformanceClock(12, 60_000)).toBe(60_000);
  });

  it('answers now for a timestamp that is missing or not a number', () => {
    expect(onPerformanceClock(undefined, 10_000)).toBe(10_000);
    expect(onPerformanceClock(Number.NaN, 10_000)).toBe(10_000);
  });
});
