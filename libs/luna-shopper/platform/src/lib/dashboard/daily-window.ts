import type {
  AdminDashboardWindow,
  DailyCount,
} from '@portfolio/luna-shopper/contracts';

/**
 * A day and its count, as a `GROUP BY date_trunc('day', ...)` answers it.
 *
 * `day` is whatever the driver handed back: Postgres returns a `timestamptz`
 * for `date_trunc` and a `Date` for a `::date` cast, and a query that formatted
 * the day itself returns a string. All three are accepted, so a caller does not
 * have to remember which of the three its own SQL produced.
 */
export interface DailyRow {
  day: string | Date;
  count: number | string;
}

/** One day, as `YYYY-MM-DD` in UTC. */
export function toUtcDay(value: string | Date): string {
  if (typeof value === 'string') {
    // Already a day, or an ISO timestamp whose day is its first ten characters.
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

/**
 * Every day the window covers, in order, oldest first (plan 0088, section 2).
 *
 * The window is inclusive of both ends, so a `from` and a `to` thirty days apart
 * produce thirty entries and a window whose ends are the same day produces one.
 */
export function daysInWindow(window: AdminDashboardWindow): string[] {
  const first = Date.parse(`${window.from}T00:00:00.000Z`);
  const last = Date.parse(`${window.to}T00:00:00.000Z`);
  if (Number.isNaN(first) || Number.isNaN(last) || last < first) {
    return [];
  }

  const days: string[] = [];
  const oneDay = 24 * 60 * 60 * 1000;
  for (let at = first; at <= last; at += oneDay) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * A grouped query's rows, spread over the whole window with zero where nothing
 * happened (plan 0088, section 2).
 *
 * Four services bucketing "the last thirty days" for themselves disagree about
 * where a day starts the moment one clock is a second behind another, so the
 * gateway states the window and every service fills the same one through this
 * function. It is here rather than copied four times because an off by one in a
 * date loop is easy to write and hard to see.
 *
 * A row outside the window is dropped rather than appended: the caller asked for
 * a window, and a chart drawn from a series longer than the axis it was given
 * has to guess. Two rows landing on one day are added together, which is what a
 * caller that grouped by source and by day and then filtered gets when the same
 * day appears twice.
 */
export function fillDailyWindow(
  window: AdminDashboardWindow,
  rows: readonly DailyRow[]
): DailyCount[] {
  const counted = new Map<string, number>();
  for (const row of rows) {
    const day = toUtcDay(row.day);
    const value = typeof row.count === 'string' ? Number(row.count) : row.count;
    counted.set(
      day,
      (counted.get(day) ?? 0) + (Number.isFinite(value) ? value : 0)
    );
  }

  return daysInWindow(window).map((day) => ({
    day,
    count: counted.get(day) ?? 0,
  }));
}
