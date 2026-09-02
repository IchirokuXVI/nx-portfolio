/**
 * The narrowing primitives every mapper is built from.
 *
 * Rule D4 (plan 0004, section 4.1): a mapper takes `unknown`, because typing the
 * parameter as the DTO asserts precisely the thing the rule exists to stop assuming.
 * These are what let it do that without every mapper hand-rolling the same guards.
 *
 * The rule of the file: **nothing here throws on bad input.** A mapper's job is to
 * produce something the UI can render, or to say clearly that it could not. Throwing
 * from inside a realtime handler would take down the socket subscription over one bad
 * payload.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A required string. Returns `null` when absent or the wrong type. */
export function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A string that is allowed to be absent or null, collapsing both to `null`. */
export function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A string with a default, for fields where absence is not worth rejecting a record over. */
export function strOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * A finite number, with a default.
 *
 * `Number.isFinite` rather than `typeof === 'number'` because `NaN` and `Infinity`
 * both pass the typeof check and then render as "NaN" in the middle of a quantity.
 */
export function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A finite number that is allowed to be absent or null, collapsing both to `null`.
 *
 * The sibling of {@link nullableStr}, for the catalog fields where **absent is a
 * fact worth keeping**: a product whose size the catalog does not know is not a
 * product of size zero, and no default could stand in for it without stating
 * something about the packet that nobody measured.
 */
export function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Narrows a string to one of a known set, falling back when it is not among them.
 *
 * This is the function that makes a newer backend safe: a status this build has never
 * heard of lands on a value the UI already has a treatment for, rather than reaching a
 * template as an unstyled string (plan 0004, section 4.1).
 */
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * An ISO 8601 timestamp.
 *
 * Returns `null` for anything unparseable, including a string that `Date` accepts but
 * turns into an Invalid Date, which is the failure that otherwise surfaces as
 * "NaN/NaN/NaN" somewhere in the UI.
 */
export function date(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Maps an array, dropping every element the mapper rejects.
 *
 * A single malformed row must not cost the user the whole list. What it costs instead
 * is that the list is quietly short, so callers that need to know use
 * {@link mapArrayCounting}.
 */
export function mapArray<T>(
  value: unknown,
  map: (raw: unknown) => T | null
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<T[]>((kept, raw) => {
    const mapped = map(raw);
    if (mapped !== null) {
      kept.push(mapped);
    }
    return kept;
  }, []);
}

/** As {@link mapArray}, but reports how many elements were dropped. */
export function mapArrayCounting<T>(
  value: unknown,
  map: (raw: unknown) => T | null
): { items: T[]; dropped: number } {
  if (!Array.isArray(value)) {
    return { items: [], dropped: 0 };
  }

  const items = mapArray(value, map);
  return { items, dropped: value.length - items.length };
}
