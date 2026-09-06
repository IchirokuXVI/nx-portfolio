import { weekDelta, type CountedDay } from './week-delta';

/** A series of `counts`, oldest first, as the document sends one. */
function series(...counts: readonly number[]): CountedDay[] {
  return counts.map((count) => ({ count }));
}

describe('weekDelta', () => {
  /**
   * The shape the document actually sends: thirty days, oldest first. Only the
   * last fourteen are read, and the sixteen in front of them are not.
   */
  it('compares the last seven days with the seven before them', () => {
    const days = series(
      ...Array.from({ length: 16 }, () => 99),
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      3,
      3,
      3,
      3,
      3,
      3,
      3
    );

    expect(weekDelta(days)).toBe(21 - 7);
  });

  it('is negative when the last seven days are quieter', () => {
    const days = series(5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1, 1);

    expect(weekDelta(days)).toBe(7 - 35);
  });

  /**
   * A window that is short because the product is young. The earlier week is
   * whatever there is of it, which under-reports rather than refusing to answer.
   */
  it('compares against whatever there is when the series is shorter than a fortnight', () => {
    const days = series(4, 4, 2, 2, 2, 2, 2, 2, 2);

    expect(weekDelta(days)).toBe(14 - 8);
  });

  it('is the whole series when there is less than a week of it', () => {
    expect(weekDelta(series(1, 2, 3))).toBe(6);
  });

  it('is zero for a series of zeros', () => {
    expect(weekDelta(series(...Array.from({ length: 30 }, () => 0)))).toBe(0);
  });

  it('is zero for an empty series', () => {
    expect(weekDelta([])).toBe(0);
  });
});
