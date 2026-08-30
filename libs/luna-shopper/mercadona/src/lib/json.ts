/**
 * Small readers that pull typed values out of `unknown`.
 *
 * Everything this library receives is third party JSON that nobody promised us,
 * so nothing is cast: a field that is missing, null, or the wrong type reads as
 * absent rather than throwing halfway through a 4,000 product run. The rule is
 * the same one the frontend follows for backend DTOs, applied to a source we
 * control even less.
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
  const raw = value[key];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  // Mercadona sends product ids as numbers in some payloads and strings in
  // others, and the id is the key everything else joins on.
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw);
  }
  return null;
}

/**
 * A number. The prices arrive as decimal **strings** ("1.80"), which is correct
 * of the source and would silently become NaN under a cast.
 */
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
