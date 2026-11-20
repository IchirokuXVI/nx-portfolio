import { formatCount } from './count';

describe('formatCount', () => {
  it('groups a count of four digits or more as an English sentence does', () => {
    expect(formatCount(1008)).toBe('1,008');
    expect(formatCount(17135)).toBe('17,135');
  });

  it('prints a smaller count as it is', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(984)).toBe('984');
  });
});
