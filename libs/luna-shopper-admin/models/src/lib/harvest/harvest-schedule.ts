import type * as Wire from '../wire/wire-types';

/**
 * A preset that runs on a schedule, as the screens read it (admin plan 0067,
 * backend plan 0206).
 *
 * The wire view is the view model, as for a run (admin plan 0004, section 2).
 * What is here is what the screens ask of it and a bare shape cannot answer:
 * the days in order, a day and a time in words, and the instant a rule falls
 * due next. Pure, so that a spec can name every case.
 */
export type HarvestSchedule = Wire.HarvestHarvestScheduleView;
export type ScheduleBlock = Wire.EnumsHarvestScheduleBlock;
export type ScheduleOutcome = Wire.EnumsHarvestScheduleOutcome;

/** The timezone a schedule has when it names none, as the harvester says. */
export const DEFAULT_SCHEDULE_TIMEZONE = 'Europe/Madrid';

/** The seven ISO days, Monday first. */
export const ISO_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * Days as the route takes them: sorted, once each, Monday first.
 *
 * Anything that is not an ISO day is left out. The route refuses a list with a
 * day twice, so a list that held one would be a refused save for a reason the
 * person cannot see.
 */
export function sortedDays(days: readonly unknown[]): number[] {
  return [
    ...new Set(
      days
        .map((day) => (typeof day === 'string' ? Number(day) : day))
        .filter(
          (day): day is number =>
            typeof day === 'number' && ISO_DAYS.includes(day)
        )
    ),
  ].sort((a, b) => a - b);
}

/**
 * The days of a form, where they are one text: `"1,3,5"`.
 *
 * A text, because a draft value of the record page is a text or a list of IDs.
 * The days are written back sorted, so two drafts with the same days are the
 * same text and the form counts no change.
 */
export function daysFromDraft(value: unknown): number[] {
  if (Array.isArray(value)) {
    return sortedDays(value);
  }
  return typeof value === 'string' && value.trim() !== ''
    ? sortedDays(value.split(','))
    : [];
}

/** The days, as the form holds them. */
export function daysToDraft(days: readonly unknown[]): string {
  return sortedDays(days).join(',');
}

/**
 * The name of an ISO day in a language: "Mon", or "Monday".
 *
 * 1 January 2024 was a Monday, so day `n` of that week is that date plus
 * `n - 1`, read in UTC so that no timezone moves it.
 */
export function dayName(
  day: number,
  locale: string,
  style: 'short' | 'long' = 'short'
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: style,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2024, 0, day)));
}

/** "Mon, Wed, Fri", Monday first, in a language. */
export function daysLine(days: readonly number[], locale: string): string {
  return sortedDays(days)
    .map((day) => dayName(day, locale))
    .join(', ');
}

/** When a schedule runs, as a key and its arguments: "Mon, Wed, Fri at 06:00". */
export interface CadenceMessage {
  readonly key: string;
  readonly args: Readonly<Record<string, string>>;
}

/**
 * When a schedule runs, in words.
 *
 * Every day is said as "Every day", because seven names say the same thing in
 * a line three times as long.
 */
export function scheduleCadence(
  schedule: Pick<HarvestSchedule, 'daysOfWeek' | 'timeOfDay'>,
  locale: string
): CadenceMessage {
  const days = sortedDays(schedule.daysOfWeek);
  return days.length === ISO_DAYS.length
    ? {
        key: 'harvest.schedules.cadence.daily',
        args: { time: schedule.timeOfDay },
      }
    : {
        key: 'harvest.schedules.cadence.days',
        args: { days: daysLine(days, locale), time: schedule.timeOfDay },
      };
}

/** The place a timezone is named after: "Madrid", "New York". */
export function zonePlace(timeZone: string): string {
  const last = timeZone.split('/').pop() ?? timeZone;
  return last.replace(/_/g, ' ');
}

/**
 * The next run, in the schedule's own time and in the person's (admin plan
 * 0067, constraints).
 *
 * `here` is `null` when the person's clock reads what the schedule's does, so
 * the page says one time and not the same time twice.
 */
export interface NextRunWords {
  /** The day, in the schedule's timezone: "Mon 27 Oct". */
  readonly day: string;
  /** The time there: "06:00". */
  readonly time: string;
  /** "Madrid". */
  readonly place: string;
  /** The day and time on the person's clock, or `null` when they agree. */
  readonly here: string | null;
}

export function nextRunWords(
  nextRunAt: string | null,
  timeZone: string,
  viewerZone: string,
  locale: string
): NextRunWords | null {
  if (nextRunAt === null) {
    return null;
  }
  const at = new Date(nextRunAt);
  if (Number.isNaN(at.getTime())) {
    return null;
  }

  const day = (zone: string): string =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: zone,
    }).format(at);
  const time = (zone: string): string =>
    new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: zone,
    }).format(at);

  const there = { day: day(timeZone), time: time(timeZone) };
  const mine = { day: day(viewerZone), time: time(viewerZone) };
  const same = there.day === mine.day && there.time === mine.time;

  return {
    ...there,
    place: zonePlace(timeZone),
    here: same
      ? null
      : mine.day === there.day
        ? mine.time
        : `${mine.day} ${mine.time}`,
  };
}

/** About how long a run takes, in whole minutes, and never 0. */
export function estimateMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

/** The sentence that says why a schedule will not run (admin plan 0067, target 6). */
export function scheduleBlockKey(block: ScheduleBlock): string {
  return `harvest.schedules.blocked.${block}`;
}

/** The phrase that says what a slot did (admin plan 0067, target 7). */
export function scheduleOutcomeKey(outcome: ScheduleOutcome): string {
  return `harvest.schedules.outcome.${outcome}`;
}

/** What a schedule says it is: on, off, or on and kept from running. */
export type ScheduleState = 'on' | 'off' | 'blocked';

/**
 * The state a row draws (admin plan 0067, target 2).
 *
 * A schedule that is off says "Off" even when something would also block it:
 * it will not run either way, and turning it on is the next thing a person
 * does. The record page still says what blocks it, so that is known before it
 * is turned on.
 */
export function scheduleState(
  schedule: Pick<HarvestSchedule, 'enabled' | 'blockedBy'>
): ScheduleState {
  if (!schedule.enabled) {
    return 'off';
  }
  return schedule.blockedBy === null ? 'on' : 'blocked';
}

/** What a rule needs to fall due: the harvester's `SlotRule`. */
export interface ScheduleRule {
  readonly timeOfDay: string;
  readonly daysOfWeek: readonly number[];
  readonly timezone: string;
}

/**
 * The first slot of a rule strictly after an instant (backend plan 0206,
 * section 3).
 *
 * It walks forward one local day at a time, at most eight, and answers the
 * instant at which the wall clock of the timezone reads `timeOfDay` on a day
 * of the rule. `null` for a rule that has no day or no readable time.
 *
 * The memory back end works out `nextRunAt` with this. A time that does not
 * exist on the night the clock goes forward lands one hour later, which is the
 * harvester's answer too.
 */
export function nextScheduleSlot(rule: ScheduleRule, after: Date): Date | null {
  const days = sortedDays(rule.daysOfWeek);
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(rule.timeOfDay);
  if (days.length === 0 || time === null) {
    return null;
  }
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const start = wallClock(rule.timezone, after);

  for (let step = 0; step <= 8; step += 1) {
    const local = new Date(
      Date.UTC(start.year, start.month - 1, start.day + step)
    );
    const iso = ((local.getUTCDay() + 6) % 7) + 1;
    if (!days.includes(iso)) {
      continue;
    }
    const slot = fromWallClock(
      rule.timezone,
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      hour,
      minute
    );
    if (slot.getTime() > after.getTime()) {
      return slot;
    }
  }
  return null;
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/** What the clock of a timezone reads at an instant. */
function wallClock(timeZone: string, at: Date): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(at);
  const part = (type: string): number =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

/** How far a timezone is ahead of UTC at an instant, in milliseconds. */
function offsetAt(timeZone: string, at: Date): number {
  const clock = wallClock(timeZone, at);
  const asUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute
  );
  return asUtc - Math.floor(at.getTime() / 60000) * 60000;
}

/** The instant at which the clock of a timezone reads a time on a day. */
function fromWallClock(
  timeZone: string,
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const asUtc = Date.UTC(year, monthIndex, day, hour, minute);
  // Twice, because the offset can change between the first guess and the
  // instant it lands on.
  const first = asUtc - offsetAt(timeZone, new Date(asUtc));
  return new Date(asUtc - offsetAt(timeZone, new Date(first)));
}
