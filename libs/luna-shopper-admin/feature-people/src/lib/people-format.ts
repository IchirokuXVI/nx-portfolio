/**
 * Turning what the gateway sent into what a detail screen shows.
 *
 * Pure functions rather than pipes, for the reason velista formats dates in its
 * selectors: `Intl` is the only thing in this workspace allowed to turn a date
 * into words, `DatePipe` is not, and a pure function is the only place a spec
 * can assert on the result without rendering anything.
 */

/** A timestamp as words, with the time of day. Empty when there is none. */
export function instant(value: string | null, locale: string): string {
  return format(value, locale, true);
}

/** A timestamp as words, without the time of day. Empty when there is none. */
export function day(value: string | null, locale: string): string {
  return format(value, locale, false);
}

/**
 * What an unnamed shopping list is told apart by: the day it was made and the
 * time, in the operator's reading language.
 *
 * One function for the row of the list and for the heading of the page it
 * opens, so the two cannot name one shopping list by two days. They did: the
 * row cut the day out of the timestamp, which is the day in UTC, and the
 * heading wrote the day where the operator is. The time is there because a
 * shopper makes more than one list in a day.
 *
 * `locales` is the reading order a descriptor's `title` is handed, chosen one
 * first. A title is a pure function and has no other language to read.
 */
export function madeAt(value: string, locales: readonly string[]): string {
  return instant(value, locales[0] ?? 'en');
}

function format(
  value: string | null,
  locale: string,
  withTime: boolean
): string {
  if (value === null || value === '') {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    // An unreadable timestamp is shown as it arrived rather than as nothing.
    // "Was not sent" and "was sent and makes no sense" are different problems,
    // and only the second one is worth reporting.
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(date);
}
