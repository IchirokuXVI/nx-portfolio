/**
 * A timestamp as words, with `Intl` and never with `DatePipe`.
 *
 * The same rule velista follows and `0004`'s `toRowView` already obeys: the
 * formatting happens where a spec can call it and the template is handed a
 * string. `DatePipe` would put the decision inside a template, where nothing can
 * assert on it and where the locale reaches it by a route this app does not use.
 *
 * These screens format their own rather than going through a field descriptor,
 * because their dates are not resource fields: a heartbeat and an abort request
 * belong to a process, not to a row somebody edits.
 */
export function formatInstant(value: string | null, locale?: string): string {
  if (value === null || value === '') {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * How long ago, in whole units, for a heartbeat.
 *
 * A run watched intermittently is one whose last sign of life is the number that
 * matters: "two seconds ago" and "eleven minutes ago" are a healthy run and a
 * hung one, and neither is legible as a clock time without the reader doing the
 * subtraction themselves.
 *
 * Empty when there is no timestamp or when it is in the future, because a clock
 * skew that produced "in 3 seconds" would be a distraction rather than
 * information.
 */
export function formatSince(
  value: string | null,
  now: number,
  locale?: string
): string {
  if (value === null || value === '') {
    return '';
  }

  const then = new Date(value).getTime();
  if (Number.isNaN(then) || then > now) {
    return '';
  }

  const seconds = Math.round((now - then) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (seconds < 60) {
    return format.format(-seconds, 'second');
  }
  if (seconds < 3600) {
    return format.format(-Math.round(seconds / 60), 'minute');
  }
  return format.format(-Math.round(seconds / 3600), 'hour');
}
