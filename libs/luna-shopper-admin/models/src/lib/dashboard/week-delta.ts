/**
 * One day of a daily series, as much of it as this file needs.
 *
 * Structural rather than the generated wire shape, so a spec can pass literal
 * counts and so the function keeps working whichever series it is handed. Every
 * daily series on the dashboard document carries a `count`, and that is the only
 * field an arithmetic over days can use.
 */
export interface CountedDay {
  readonly count: number;
}

/** How many days each half of the comparison covers. */
export const WEEK_LENGTH = 7;

/**
 * The last seven days against the seven before them.
 *
 * A tile beside a thirty day sparkline says how many there are; this says
 * whether that number is moving, which is the question an operator opens the
 * screen with. Two whole weeks rather than a day against a day, because sign ups
 * on a Sunday and sign ups on a Tuesday are different numbers about the same
 * product and a one day comparison mostly measures which weekday it is.
 *
 * A series shorter than fourteen days is compared with whatever it has: the last
 * seven entries against everything before them. That under-reports the earlier
 * week rather than refusing to answer, which is the right way round for a window
 * that is short because the product is young. The backend sends thirty days
 * filled with zeros, so this case belongs to specs and to a caller passing a
 * slice.
 */
export function weekDelta(series: readonly CountedDay[]): number {
  const recent = series.slice(-WEEK_LENGTH);
  const previous = series.slice(
    Math.max(0, series.length - WEEK_LENGTH * 2),
    Math.max(0, series.length - WEEK_LENGTH)
  );

  return total(recent) - total(previous);
}

function total(days: readonly CountedDay[]): number {
  return days.reduce((sum, day) => sum + day.count, 0);
}
