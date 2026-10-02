/** What `horariosTienda` became, or why it could not be read. */
export interface DiaOpeningHours {
  /** An OpenStreetMap `opening_hours` string, or null when unreadable. */
  openingHours: string | null;
  /** False when a value could not be read and the raw object must be kept. */
  readable: boolean;
}

/** Keys `1` to `7` are Monday to Sunday (plan 0174, section 5.5). */
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** `09:00 - 21:30`, or a split day `09:00 - 14:30 | 17:00 - 21:00`. */
const RANGE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

/**
 * `horariosTienda` as an OpenStreetMap `opening_hours` string.
 *
 * **Monday first, confirmed on the samples**: the shops whose key `7` differs
 * from keys `1` to `6` list every Sunday of the month among their holiday
 * dates, and a shop that closes on Sunday has no key `7` at all. So a missing
 * day is a closed day, written `off`.
 *
 * Consecutive days with equal hours are joined: `Mo-Sa 09:00-21:30; Su
 * 10:00-15:00`. One value the parser cannot read makes the whole answer
 * unreadable, because a string that is right for six days and silent about the
 * seventh reads as a closed day.
 */
export function parseOpeningHours(raw: unknown): DiaOpeningHours {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { openingHours: null, readable: false };
  }
  const hours = raw as Record<string, unknown>;
  const known = Object.keys(hours).filter((key) => /^[1-7]$/.test(key));
  if (known.length === 0 || known.length !== Object.keys(hours).length) {
    return { openingHours: null, readable: false };
  }

  const perDay: string[] = [];
  for (let day = 1; day <= 7; day += 1) {
    const value = hours[String(day)];
    if (value === undefined || value === null || value === '') {
      perDay.push('off');
      continue;
    }
    const ranges = typeof value === 'string' ? rangesOf(value) : null;
    if (ranges === null) {
      return { openingHours: null, readable: false };
    }
    perDay.push(ranges);
  }

  const parts: string[] = [];
  let start = 0;
  for (let day = 1; day <= 7; day += 1) {
    if (day < 7 && perDay[day] === perDay[start]) {
      continue;
    }
    const label =
      day - 1 === start ? DAYS[start] : `${DAYS[start]}-${DAYS[day - 1]}`;
    parts.push(`${label} ${perDay[start]}`);
    start = day;
  }
  return { openingHours: parts.join('; '), readable: true };
}

function rangesOf(value: string): string | null {
  const ranges: string[] = [];
  for (const piece of value.split('|')) {
    const match = RANGE.exec(piece.trim());
    if (!match) {
      return null;
    }
    const [, fromHour, fromMinute, toHour, toMinute] = match;
    if (
      Number(fromHour) > 24 ||
      Number(toHour) > 24 ||
      Number(fromMinute) > 59 ||
      Number(toMinute) > 59
    ) {
      return null;
    }
    ranges.push(
      `${fromHour.padStart(2, '0')}:${fromMinute}-` +
        `${toHour.padStart(2, '0')}:${toMinute}`
    );
  }
  return ranges.length > 0 ? ranges.join(',') : null;
}
