import type { ImpersonationSession } from './directory-service';

/**
 * How long a handoff code is good for, when the answer does not say. The
 * `codeTtlMs` of the answer is the number (backend plan 0194); this is for a
 * gateway that is older than that field, which a staging deploy of only the
 * affected images can leave beside a newer back office.
 */
export const FALLBACK_CODE_TTL_MS = 60 * 1000;

/**
 * The answer of the start of a support session (backend plan 0194), read
 * from `unknown`.
 *
 * The shape is the wire type: admin plan 0004 makes the wire types the view
 * models, and admin plan 0062 adds no type beside them. What this adds is the
 * check that each field is what the dialog will use it as. `url` becomes the
 * `href` of a link, so only an absolute http(s) address passes, and the two
 * times must be dates the browser can read. A field that fails makes the
 * whole answer unreadable, and the caller reports an error rather than draw
 * half a link. The one exception is `codeTtlMs`: an answer without a usable
 * one reads as {@link FALLBACK_CODE_TTL_MS}, because the link still works.
 */
export function toImpersonationSession(
  raw: unknown
): ImpersonationSession | null {
  const record =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const sessionId = record['sessionId'];
  const url = link(record['url']);
  const codeExpiresAt = instant(record['codeExpiresAt']);
  const expiresAt = instant(record['expiresAt']);
  const codeTtlMs = duration(record['codeTtlMs']) ?? FALLBACK_CODE_TTL_MS;
  return typeof sessionId !== 'string' ||
    sessionId === '' ||
    url === null ||
    codeExpiresAt === null ||
    expiresAt === null
    ? null
    : { sessionId, url, codeExpiresAt, codeTtlMs, expiresAt };
}

/** An absolute http(s) URL, and nothing else a link may point at. */
function link(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/** A whole number of milliseconds above zero. */
function duration(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/** A date the browser can read. */
function instant(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}
