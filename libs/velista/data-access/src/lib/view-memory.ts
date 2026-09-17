import { isRecord } from './mapping/primitives';

/**
 * The pieces every remembered view shares: the basket's (velista `0076`) and the zone
 * list's (velista `0082`).
 *
 * A screen that remembers how it was read keeps one record per device, and every
 * property on it names a lifetime and carries the date that lifetime produced. The
 * record's shape is each screen's own. What is here is the part that has to mean the
 * same thing on both: what a lifetime is, when a date has passed, and how one stored
 * property is read back under rule D4.
 */

/** One stored value and the date after which it is ignored. */
export interface Remembered<T> {
  readonly value: T;
  /** ISO instant after which the value is ignored, or null for never. */
  readonly until: string | null;
}

/**
 * How long a property is worth keeping.
 *
 * - A number of milliseconds, for a choice that is true for a while: a shop is
 *   true for the trip and not for the month.
 * - `null`, for ever: an order is how somebody reads a list.
 * - `'visit'`, never stored at all (velista `0082`, section 8). The property is part
 *   of the screen's state, and it starts from its default on every visit. A table
 *   entry rather than an omission, so a property added later still has to answer the
 *   question.
 */
export type ViewLifetime = number | null | 'visit';

/**
 * The date a value set now stops applying, or null for never.
 *
 * Only for a lifetime that is stored: a `'visit'` property is never written, so it has
 * no date to compute.
 */
export function untilFor(
  lifetime: Exclude<ViewLifetime, 'visit'>,
  now: number
): string | null {
  return lifetime === null ? null : new Date(now + lifetime).toISOString();
}

/**
 * Whether a remembered value's date has passed.
 *
 * A null `until` never passes. The comparison is made **once**, by whoever asks: this
 * is a date to compare against, not a timer, so a value read at 11:50 and due at 12:00
 * stays applied while the screen is open and is ignored by the next one to open.
 */
export function hasExpired(
  remembered: Remembered<unknown>,
  now: number
): boolean {
  if (remembered.until === null) {
    return false;
  }

  return Date.parse(remembered.until) <= now;
}

/**
 * That a stored property was present and could not be read, as distinct from absent.
 *
 * An unreadable property condemns the **whole** record, because a build that wrote a
 * shape this one cannot read may have written the rest of it differently too.
 */
export const UNREADABLE = Symbol('unreadable');

export type ReadRemembered<T> = Remembered<T> | undefined | typeof UNREADABLE;

/**
 * One stored property: present and well formed, absent, or unreadable.
 *
 * A `value` its reader rejects and an `until` that is neither null nor a real instant
 * are both unreadable.
 */
export function readRemembered<T>(
  raw: unknown,
  readValue: (value: unknown) => T | null
): ReadRemembered<T> {
  if (raw === undefined) {
    return undefined;
  }

  if (!isRecord(raw)) {
    return UNREADABLE;
  }

  const value = readValue(raw['value']);
  if (value === null) {
    return UNREADABLE;
  }

  const until = raw['until'];
  if (until === null) {
    return { value, until: null };
  }

  if (typeof until !== 'string' || Number.isNaN(Date.parse(until))) {
    return UNREADABLE;
  }

  return { value, until };
}

/**
 * A member of a union, or null.
 *
 * `oneOf` in `mapping/primitives.ts` falls back to a default instead, which is right
 * for a response body a screen has to draw something for and wrong here: a stored
 * value outside its union is a record this build cannot read, and quietly reading it
 * as the default would apply a choice nobody made.
 */
export function oneOfOrNull<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}
