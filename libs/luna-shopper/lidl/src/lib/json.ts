/**
 * Small readers that pull typed values out of `unknown`.
 *
 * Everything this library receives is third party JSON that nobody promised us,
 * so nothing is cast: a field that is missing, null, or the wrong type reads as
 * absent rather than throwing halfway through a run. The rule is the same one
 * the frontend follows for backend DTOs, applied to a source we control even
 * less.
 *
 * Not exported from the library (plan 0089, section 6).
 */

export type Json = unknown;

export function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRecord(value: Json, key: string): Record<string, Json> {
  if (!isRecord(value)) {
    return {};
  }
  const nested = value[key];
  return isRecord(nested) ? nested : {};
}

export function readArray(value: Json, key: string): Json[] {
  if (!isRecord(value)) {
    return [];
  }
  const nested = value[key];
  return Array.isArray(nested) ? nested : [];
}

/** A string, trimmed. Empty and whitespace only read as null, like an absent field. */
export function readString(value: Json, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return asString(value[key]);
}

/**
 * One value as a string. LIDL sends a product id as a number in the index and
 * the same id as a string in the region map, and the id is what everything else
 * joins on.
 */
export function asString(raw: Json): string | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw);
  }
  return null;
}

export function readNumber(value: Json, key: string): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const raw = value[key];
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readBoolean(value: Json, key: string): boolean | null {
  if (!isRecord(value)) {
    return null;
  }
  const raw = value[key];
  return typeof raw === 'boolean' ? raw : null;
}

/**
 * An instant, or null.
 *
 * The source prints `2026-09-03T22:00Z`, which is a legal ISO 8601 instant with
 * no seconds, and `2026-09-06T21:59:59Z` beside it. Both parse; a value that
 * does not is read as absent rather than as an Invalid Date that reaches a
 * column.
 */
export function readDate(value: Json, key: string): Date | null {
  const raw = readString(value, key);
  if (raw === null) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
