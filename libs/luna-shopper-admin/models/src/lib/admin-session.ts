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
  /**
   * When this app took the token (plan 0003).
   *
   * Not stated by the server, because the server states no `issuedAt` and the
   * wire shape is deliberately five fields. This is the client's own record of
   * when the token arrived, and with `expiresAt` it is the only way to know the
   * token's **lifetime** rather than merely what is left of it.
   *
   * The lifetime is what `0003` needs: the warning fires at a fraction of it, so
   * a session renewed at half a lifetime and one restored from storage with two
   * minutes left must not be treated as the same shape of thing. Persisted
   * alongside the token for exactly that reason, so a reload does not shrink the
   * lifetime to whatever happened to remain.
   */
  readonly receivedAt: Date;
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
export function toAdminSession(
  value: unknown,
  receivedAt: Date = new Date()
): AdminSession | null {
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
    // Defaulted to now, because the ordinary caller is mapping a response that
    // has just arrived. Storage passes the instant it recorded instead, so a
    // restored session keeps the lifetime it was actually issued with rather
    // than being reborn with a shorter one on every reload.
    receivedAt,
  };
}

/**
 * Whether a session that arrived from another tab replaces the one held here
 * (plan 0013, section 3).
 *
 * Every tab of this app shares one token, so a tab is constantly offered a
 * session it may already have, and occasionally offered one older than what it
 * holds: the browser delivers a `storage` event per tab and says nothing about
 * the order two writes landed in. Both cases answer `false`, and the second is
 * the one that matters. Adopting an older token would replace a live session
 * with one closer to expiry and start the whole app renewing against it.
 *
 * A different operator is the exception, and it is checked first. Signing out
 * and signing in as somebody else produces a session that is a different admin's
 * and every other tab must take it, whatever the two expiries say, because the
 * alternative is a tab that keeps making requests as the operator who left.
 */
export function supersedes(
  incoming: AdminSession,
  held: AdminSession | null
): boolean {
  if (held === null || incoming.adminId !== held.adminId) {
    return true;
  }

  // The same token, offered back. Not an error and not worth a signal write:
  // this is what a tab sees when it reads storage during its own renewal.
  if (incoming.accessToken === held.accessToken) {
    return false;
  }

  return incoming.expiresAt.getTime() > held.expiresAt.getTime();
}

/** An ISO instant, or `null` for anything that is not one. */
export function asInstant(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
