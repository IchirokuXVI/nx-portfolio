/**
 * The calendar of the assistant allowance (plan 0234, sections 4 and 8.1).
 *
 * A day and a month turn over at midnight in the deployment's allowance
 * timezone, an IANA name the assistant sends with each request. Days are plain
 * `YYYY-MM-DD` strings, the shape a Postgres `date` takes, so nothing here
 * depends on the timezone of the process.
 *
 * Every function reads the zone through `Intl`, which holds the rules for
 * daylight saving time. A zone whose clocks skip midnight is handled: the day
 * then starts at the first minute that exists.
 */

const MINUTE_MS = 60_000;

/** True when `timezone` is an IANA name this runtime knows. */
export function isTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/** What a clock on the wall in `timezone` reads at `instant`. */
function wallClock(instant: Date, timezone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(instant)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  return {
    year: parts['year'],
    month: parts['month'],
    day: parts['day'],
    hour: parts['hour'] === 24 ? 0 : parts['hour'],
    minute: parts['minute'],
    second: parts['second'],
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function dayOf(clock: Pick<WallClock, 'year' | 'month' | 'day'>): string {
  return `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}`;
}

/** The date in `timezone` at `instant`, as `YYYY-MM-DD`. */
export function localDay(instant: Date, timezone: string): string {
  return dayOf(wallClock(instant, timezone));
}

function parseDay(day: string): { year: number; month: number; day: number } {
  const [year, month, date] = day.split('-').map(Number);
  return { year, month, day: date };
}

/** `day` moved by `days`, on the calendar alone. */
export function addDays(day: string, days: number): string {
  const { year, month, day: date } = parseDay(day);
  const moved = new Date(Date.UTC(year, month - 1, date + days));
  return dayOf({
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  });
}

/** The first day of the month `months` away from the month of `day`. */
export function monthStart(day: string, months = 0): string {
  const { year, month } = parseDay(day);
  const moved = new Date(Date.UTC(year, month - 1 + months, 1));
  return dayOf({
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: 1,
  });
}

/**
 * The first instant of `day` in `timezone`.
 *
 * A binary search over the minutes around the day's UTC midnight, for the
 * first one whose local date is `day`: every offset in use is within fourteen
 * hours, and a zone that skips midnight starts its day at the first minute it
 * has.
 */
export function startOfDay(day: string, timezone: string): Date {
  const { year, month, day: date } = parseDay(day);
  const utcMidnightMinutes = Date.UTC(year, month - 1, date) / MINUTE_MS;
  let lo = utcMidnightMinutes - 16 * 60;
  let hi = utcMidnightMinutes + 16 * 60;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDay(new Date(mid * MINUTE_MS), timezone) >= day) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return new Date(hi * MINUTE_MS);
}

/**
 * `instant` written in `timezone` with its offset, as
 * `2026-10-28T00:00:00+01:00` (plan 0234, section 8.1). A reader sees the
 * local time and still has the exact instant.
 */
export function zonedIso(instant: Date, timezone: string): string {
  const clock = wallClock(instant, timezone);
  const wallMs = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second
  );
  const instantMs = Math.floor(instant.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((wallMs - instantMs) / MINUTE_MS);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return (
    `${dayOf(clock)}T${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

/** Today, the month around it and when each turns over, in `timezone`. */
export interface AllowanceCalendar {
  day: string;
  monthStart: string;
  nextMonthStart: string;
  /** When the day turns over, written with its offset. */
  dayResetsAt: string;
  /** When the month turns over, written with its offset. */
  monthResetsAt: string;
}

export function calendarAt(now: Date, timezone: string): AllowanceCalendar {
  const day = localDay(now, timezone);
  const start = monthStart(day);
  const next = monthStart(day, 1);
  return {
    day,
    monthStart: start,
    nextMonthStart: next,
    dayResetsAt: zonedIso(startOfDay(addDays(day, 1), timezone), timezone),
    monthResetsAt: zonedIso(startOfDay(next, timezone), timezone),
  };
}
