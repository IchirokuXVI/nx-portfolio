/**
 * When a schedule is due (plan 0206, section 3).
 *
 * Pure: every function takes the clock as an argument, and the timezone of a
 * rule is read through `Intl.DateTimeFormat` with its `timeZone` option. Nothing
 * here reads `process.env.TZ` or the zone of the machine, so a pod in UTC and a
 * laptop in Madrid answer the same instant for the same rule.
 *
 * Two answers come from daylight saving time, and both are stated:
 *
 * - **A time that does not exist** (02:30 on the night the clock goes forward)
 *   answers the first instant after the gap. The schedule fires one time that
 *   day, not zero times.
 * - **A time that occurs two times** (02:30 on the night the clock goes back)
 *   answers the first of the two. The schedule fires one time that day, not two.
 */

/** What a slot is computed from: the three fields of a schedule row. */
export interface SlotRule {
  /** `HH:mm`, 24 hour. */
  timeOfDay: string;
  /** ISO numbers: 1 is Monday and 7 is Sunday. */
  daysOfWeek: readonly number[];
  /** An IANA name, such as `Europe/Madrid`. */
  timezone: string;
}

const DAY_MS = 86_400_000;

/**
 * How far the walk looks, in local days. Seven reach every weekday, and the
 * eighth covers a rule whose only day is today with today's slot gone.
 */
const WALK_DAYS = 8;

/** One formatter per zone. Building one costs far more than using it. */
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

/**
 * The wall clock of `timezone` at `instant`, written as if it were a UTC
 * instant. Comparing two of these compares two wall clock readings.
 */
function wallClock(timezone: string, instant: number): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(instant)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  return Date.UTC(
    parts['year'],
    parts['month'] - 1,
    parts['day'],
    parts['hour'],
    parts['minute'],
    parts['second']
  );
}

/** The local calendar day of `instant`, as the UTC midnight of that date. */
function localDay(timezone: string, instant: number): number {
  const wall = wallClock(timezone, instant);
  return wall - (((wall % DAY_MS) + DAY_MS) % DAY_MS);
}

/** 1 for Monday through 7 for Sunday, of a day from {@link localDay}. */
function isoWeekday(day: number): number {
  const weekday = new Date(day).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Minutes after midnight of an `HH:mm` string. */
function minutesOf(timeOfDay: string): number {
  const [hours, minutes] = timeOfDay.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * The instant at which the wall clock of `timezone` reads `wall`.
 *
 * Every zone's offset lies within fourteen hours of UTC, so the offsets that
 * hold half a day either side of the wall time are the only ones that can
 * apply. Each is tried, and the earliest instant that reads back as `wall` is
 * the answer, which is the first of two on the night the clock goes back.
 *
 * When neither reads back, `wall` is inside a gap. The answer is then the
 * first instant whose wall clock is at or after `wall`, found by halving the
 * hour between the two candidates. That instant is the change itself.
 */
function instantAt(timezone: string, wall: number): number {
  const offsets = new Set<number>();
  for (const probe of [wall - DAY_MS / 2, wall + DAY_MS / 2]) {
    offsets.add(wallClock(timezone, probe) - probe);
  }
  const candidates = [...offsets].map((offset) => wall - offset);
  const exact = candidates.filter((t) => wallClock(timezone, t) === wall);
  if (exact.length > 0) {
    return Math.min(...exact);
  }

  // A gap: the earlier candidate reads before `wall` and the later one after.
  let low = Math.min(...candidates);
  let high = Math.max(...candidates);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (wallClock(timezone, middle) >= wall) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

/** The slot of `rule` on one local day, or null when the day is not one of its days. */
function slotOn(rule: SlotRule, day: number): number | null {
  if (!rule.daysOfWeek.includes(isoWeekday(day))) {
    return null;
  }
  return instantAt(rule.timezone, day + minutesOf(rule.timeOfDay) * 60_000);
}

/** The first slot strictly after `after`. */
export function nextSlot(rule: SlotRule, after: Date): Date {
  const from = after.getTime();
  const today = localDay(rule.timezone, from);
  for (let step = 0; step <= WALK_DAYS; step += 1) {
    const slot = slotOn(rule, today + step * DAY_MS);
    if (slot !== null && slot > from) {
      return new Date(slot);
    }
  }
  throw new Error(`The rule ${describeRule(rule)} has no slot in a week.`);
}

/**
 * The last slot at or before `atOrBefore`.
 *
 * This is the slot a due schedule is judged on (plan 0206, review point 1).
 * Several slots missed in a row thus become one decision about the newest of
 * them, and never a queue of catch up runs.
 */
export function previousSlot(rule: SlotRule, atOrBefore: Date): Date {
  const until = atOrBefore.getTime();
  const today = localDay(rule.timezone, until);
  for (let step = 0; step <= WALK_DAYS; step += 1) {
    const slot = slotOn(rule, today - step * DAY_MS);
    if (slot !== null && slot <= until) {
      return new Date(slot);
    }
  }
  throw new Error(`The rule ${describeRule(rule)} has no slot in a week.`);
}

/**
 * Whether a slot that was due at `slot` is too old to run at `now` (section
 * 5.2): more than half of the gap to the slot after it has passed.
 *
 * A weekly schedule thus catches up for three and a half days, and a daily one
 * for twelve hours. There is no setting for it.
 */
export function isTooLate(rule: SlotRule, slot: Date, now: Date): boolean {
  const gap = nextSlot(rule, slot).getTime() - slot.getTime();
  return now.getTime() - slot.getTime() > gap / 2;
}

/** Whether `timezone` is a name `Intl.DateTimeFormat` accepts. */
export function isKnownTimezone(timezone: string): boolean {
  try {
    formatterFor(timezone);
    return true;
  } catch {
    return false;
  }
}

function describeRule(rule: SlotRule): string {
  return `${rule.timeOfDay} on [${rule.daysOfWeek.join(', ')}] in ${rule.timezone}`;
}
