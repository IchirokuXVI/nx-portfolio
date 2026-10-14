/**
 * The answers of the two operator actions on a reset grant (backend plan 0210,
 * target states 7 and 8), in this app's own words.
 *
 * Read from `unknown` and never passed through (rule D4): the back office
 * draws these, and a reshaped answer must land in one mapper rather than in a
 * panel. A field that is missing or of the wrong kind makes the whole answer
 * unreadable, and the caller reports it as an error rather than draw half a
 * link.
 */

/** A reset mail an operator had sent: when its links stop working. */
export interface PasswordResetSent {
  /** ISO 8601 UTC. */
  readonly expiresAt: string;
}

/**
 * The two links of one grant, for an operator to share by hand.
 *
 * A key to the account until one of them is used or the day is over. The
 * panel that shows them holds them in a component and nowhere else: not a
 * store, not `localStorage`, not the URL.
 */
export interface RecoveryLinks {
  readonly resetUrl: string;
  readonly signInUrl: string;
  /** ISO 8601 UTC. */
  readonly expiresAt: string;
}

/** The answer of `send-password-reset`, or null when it cannot be read. */
export function toPasswordResetSent(raw: unknown): PasswordResetSent | null {
  const record = asRecord(raw);
  const expiresAt = instant(record['expiresAt']);
  return expiresAt === null ? null : { expiresAt };
}

/** The answer of `recovery-links`, or null when it cannot be read. */
export function toRecoveryLinks(raw: unknown): RecoveryLinks | null {
  const record = asRecord(raw);
  const resetUrl = link(record['resetUrl']);
  const signInUrl = link(record['signInUrl']);
  const expiresAt = instant(record['expiresAt']);
  return resetUrl === null || signInUrl === null || expiresAt === null
    ? null
    : { resetUrl, signInUrl, expiresAt };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** An absolute http(s) URL, and nothing else an operator might be handed. */
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

/** A date the browser can read. */
function instant(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}
