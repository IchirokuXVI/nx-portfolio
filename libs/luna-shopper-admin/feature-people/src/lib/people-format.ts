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
