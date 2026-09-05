import { ValidationException } from '@portfolio/luna-shopper/platform';

/**
 * A leaflet's dates are **local days in Spain** (plan 0081, section 5).
 *
 * - `validFrom` is `starts_on` at 00:00 `Europe/Madrid`.
 * - `validUntil` is the day *after* `ends_on` at 00:00 `Europe/Madrid`, and it
 *   is exclusive: a leaflet valid "to 23 September" is valid through the whole
 *   of the 23rd.
 *
 * No other code in this backend names a timezone, and this one has to, because
 * Spain moves its clocks: a leaflet spanning the last Sunday of October is one
 * hour longer in UTC than the same span in July, and a fixed `+02:00` would end
 * it an hour early or late. `Intl.DateTimeFormat` with `timeZone: 'Europe/Madrid'`
 * is what makes the arithmetic follow the rule rather than a guess about it.
 *
 * **The admin's override is required when either bound is null**, and offered
 * always. A run with a null bound is refused at spawn rather than written with
 * an open window nobody chose.
 */

/** The Spanish civil timezone, named once. */
export const LEAFLET_TIMEZONE = 'Europe/Madrid';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface LeafletWindow {
  validFrom: Date;
  /** Exclusive. */
  validUntil: Date;
}

/**
 * The UTC instant of local midnight at the start of a `YYYY-MM-DD` day in a
 * timezone.
 *
 * The trick, and the reason this is not two lines: there is no API that turns a
 * local wall clock time into an instant. So take the naive UTC reading of that
 * midnight, ask what wall clock time it is in the target zone, and subtract the
 * difference. One correction is enough for every real offset, and the second
 * pass settles the two hours a year where the first lands inside a clock change.
 */
export function localMidnightUtc(
  day: string,
  timeZone: string = LEAFLET_TIMEZONE
): Date {
  if (!DATE_PATTERN.test(day)) {
    throw new ValidationException(`${day} is not a YYYY-MM-DD date`, {
      details: { validity: 'must be a YYYY-MM-DD date' },
    });
  }
  const naive = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(naive)) {
    throw new ValidationException(`${day} is not a real date`, {
      details: { validity: 'must be a real calendar date' },
    });
  }
  let instant = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    const shift = offsetMillis(instant, timeZone);
    const corrected = naive - shift;
    if (corrected === instant) {
      return new Date(instant);
    }
    instant = corrected;
  }
  return new Date(instant);
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function offsetMillis(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  // `hour12: false` renders midnight as 24 in some engines; both mean the start
  // of the day the other parts already name.
  const hour = read('hour') % 24;
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    hour,
    read('minute'),
    read('second')
  );
  return asUtc - instant;
}

/**
 * The window a run writes its prices with (section 5).
 *
 * The admin's values win where he gave them, the document's are used where he
 * did not, and a bound that is null in both is refused: a price row with no
 * start is one that applies now, which is exactly what a leaflet published three
 * days early does not mean.
 */
export function resolveLeafletWindow(input: {
  documentStartsOn: string | null;
  documentEndsOn: string | null;
  overrideFrom?: string | null;
  overrideUntil?: string | null;
  timeZone?: string;
}): LeafletWindow {
  const timeZone = input.timeZone ?? LEAFLET_TIMEZONE;
  const startDay = firstOf(input.overrideFrom, input.documentStartsOn);
  const endDay = firstOf(input.overrideUntil, input.documentEndsOn);

  if (!startDay) {
    throw new ValidationException(
      'This leaflet states no start date, so give one: a price row with no ' +
        'start applies now, and a leaflet published before its prices do is ' +
        'exactly the case that is not.',
      { details: { validFrom: 'required when the document states none' } }
    );
  }
  if (!endDay) {
    throw new ValidationException(
      'This leaflet states no end date, so give one: a leaflet price that ' +
        'never expires outranks the crawl for ever.',
      { details: { validUntil: 'required when the document states none' } }
    );
  }

  const validFrom = localMidnightUtc(startDay, timeZone);
  // The day after the last day it is valid, at local midnight, exclusive. Taken
  // by adding a day to the calendar day rather than 24 hours to the instant, so
  // a clock change inside the window does not move the boundary.
  const validUntil = localMidnightUtc(nextDay(endDay), timeZone);

  if (validUntil.getTime() <= validFrom.getTime()) {
    throw new ValidationException(
      `That leaflet ends (${endDay}) before it starts (${startDay}).`,
      { details: { validUntil: 'must be on or after validFrom' } }
    );
  }
  return { validFrom, validUntil };
}

function firstOf(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/** The calendar day after a `YYYY-MM-DD` day, by UTC arithmetic on the label. */
function nextDay(day: string): string {
  if (!DATE_PATTERN.test(day)) {
    throw new ValidationException(`${day} is not a YYYY-MM-DD date`, {
      details: { validity: 'must be a YYYY-MM-DD date' },
    });
  }
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);
}
