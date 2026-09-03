/**
 * The signed in operator and the token that proves it (plan 0002, sections 3
 * and 6).
 *
 * Mapped from the gateway's `AdminAuthTokens` rather than passed through it
 * (rule D4). The backend's interface is a Node library this bundle has no
 * business depending on, and the two shapes already differ where it matters:
 * `expiresAt` arrives as an ISO string and is held here as a `Date`, because
 * every consumer of it does arithmetic and a string that failed to parse should
 * fail once, here, rather than at whichever comparison happens to run first.
 */
export interface AdminSession {
  readonly adminId: string;
  readonly username: string;
  /** The operator's own name for themselves, or `null` if they never set one. */
  readonly displayName: string | null;
  readonly accessToken: string;
  /**
   * When the token stops being accepted.
   *
   * Stated by the server rather than decoded out of the JWT, so this app never
   * has to understand a token it only has to carry. `0003` is what acts on it;
   * this plan holds it, and holding it now is what lets a restored session be
   * discarded on sight when it is already over.
   */
  readonly expiresAt: Date;
}

/**
 * A login or refresh response, as this app's own session.
 *
 * Returns `null` for anything that is not a complete, usable session, and every
 * missing or mistyped field is the same answer. A half read session is worse
 * than none: it produces an app that believes it is signed in and cannot make a
 * single request, which is indistinguishable on screen from the backend being
 * broken.
 *
 * `expiresAt` must parse **and** be a real instant. `new Date('nonsense')` is a
 * `Date` whose `getTime()` is `NaN`, and every comparison against it is false,
 * so a token would look permanently valid rather than obviously wrong.
 */
export function toAdminSession(value: unknown): AdminSession | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const body = value as Record<string, unknown>;
  const adminId = body['adminId'];
  const username = body['username'];
  const accessToken = body['accessToken'];
  const expiresAt = asInstant(body['expiresAt']);
  const displayName = body['displayName'];

  if (
    typeof adminId !== 'string' ||
    adminId === '' ||
    typeof username !== 'string' ||
    username === '' ||
    typeof accessToken !== 'string' ||
    accessToken === '' ||
    expiresAt === null
  ) {
    return null;
  }

  return {
    adminId,
    username,
    displayName: typeof displayName === 'string' ? displayName : null,
    accessToken,
    expiresAt,
  };
}

/** An ISO instant, or `null` for anything that is not one. */
export function asInstant(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
