/**
 * How a trip or a history entry is dated on screen (velista `0088` section 4, velista
 * `0095` sections 3 and 4).
 *
 * `Intl` and never `DatePipe`: the language is runtime state here. An unrecognised
 * locale tag throws `RangeError`, and the runtime's own locale stands in.
 */
export interface TripDateFormatter {
  /** "Sat 12 Sep", with the year only when it is not this year's. */
  date(date: Date, now: Date): string;
  /** The same, with the time of day: "Sat 12 Sep, 18:40". */
  dateTime(date: Date, now: Date): string;
}

export function tripDateFormatter(locale: string): TripDateFormatter {
  const build = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale, options);
    } catch {
      return new Intl.DateTimeFormat(undefined, options);
    }
  };
  const time: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  };
  const shortDay: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  };
  const longDay: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  const short = build(shortDay);
  const long = build(longDay);
  const shortTime = build({ ...shortDay, ...time });
  const longTime = build({ ...longDay, ...time });

  return {
    date: (date, now) =>
      sameYear(date, now) ? short.format(date) : long.format(date),
    dateTime: (date, now) =>
      sameYear(date, now) ? shortTime.format(date) : longTime.format(date),
  };
}

/** The reader's calendar day, in the runtime's time zone, as a comparable key. */
export function calendarDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function sameYear(date: Date, now: Date): boolean {
  return date.getFullYear() === now.getFullYear();
}
