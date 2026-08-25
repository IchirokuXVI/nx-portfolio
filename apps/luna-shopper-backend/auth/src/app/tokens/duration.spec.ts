import { parseDurationMs } from './duration';

describe('parseDurationMs', () => {
  it('parses each unit', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('15m')).toBe(15 * 60_000);
    expect(parseDurationMs('24h')).toBe(24 * 60 * 60_000);
    expect(parseDurationMs('30d')).toBe(30 * 24 * 60 * 60_000);
    expect(parseDurationMs('2w')).toBe(2 * 7 * 24 * 60 * 60_000);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDurationMs(' 15m ')).toBe(15 * 60_000);
  });

  it('rejects a malformed duration', () => {
    expect(() => parseDurationMs('15')).toThrow();
    expect(() => parseDurationMs('abc')).toThrow();
    expect(() => parseDurationMs('10y')).toThrow();
  });
});
