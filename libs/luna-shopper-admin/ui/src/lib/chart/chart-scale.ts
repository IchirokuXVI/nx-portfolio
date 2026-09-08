/**
 * The arithmetic two charts share, kept out of both of them.
 *
 * d3 supplies the scales and the path strings; what it does not supply is the
 * judgement about what a tick should be here. Every number these charts draw is a
 * count of something, so a y axis labelled 2.5 is a y axis labelled with a thing
 * that cannot exist, and d3's own `ticks` will produce one whenever the maximum
 * is small. So the step is chosen here and the scale is told what to use.
 */

/** A y axis that starts at zero and is labelled only with whole numbers. */
export interface CountAxis {
  /** The top of the domain, which is the last tick. */
  readonly top: number;
  /** Every tick from zero upward, at most five of them. */
  readonly ticks: readonly number[];
}

/**
 * A step of 1, 2 or 5 times a power of ten, and never anything else.
 *
 * Those three are the intervals a reader adds up in their head without being
 * asked to. A step of 3 or 7 is arithmetically fine and makes every gridline a
 * small sum.
 */
function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) {
    return 1;
  }

  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const stepped =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(1, stepped * magnitude);
}

/**
 * Four intervals from zero to something above the largest value.
 *
 * A maximum of zero still gets an axis, because a chart that collapses to a
 * single line when the count is zero is a chart an operator reads as broken
 * rather than as empty. Zero to four is an arbitrary but honest frame: it says
 * nothing happened, at a scale small enough that one event tomorrow will show.
 */
export function countAxis(max: number): CountAxis {
  if (!Number.isFinite(max) || max <= 0) {
    return { top: 4, ticks: [0, 1, 2, 3, 4] };
  }

  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) {
    ticks.push(Math.round(value));
  }

  return { top, ticks };
}

/**
 * A `YYYY-MM-DD` day as a UTC instant, or `null` when it is not one.
 *
 * UTC on both sides of the parse, so a day never shifts under a reader in a
 * timezone west of the server. The backend's window is days, not moments, and a
 * chart that drew the fifth as the fourth for half the world would be wrong in
 * exactly the way nobody notices.
 */
export function parseDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }

  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * A day as a short month and a number, through `Intl` and never `DatePipe`.
 *
 * `DatePipe` would put the decision inside a template, where nothing can assert
 * on it. d3 has a formatter of its own and it is not locale aware, which is the
 * other reason this is here: this app ships one locale today and the point of
 * every string going through a key is that the second one costs nothing.
 */
export function dayFormatter(locale: string | undefined): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** A day spelled out in full, for a tooltip and a table where there is room. */
export function longDayFormatter(
  locale: string | undefined
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
}
