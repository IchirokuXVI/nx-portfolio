import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * "A 401 on this request is the answer, not a reason to renew" (plan 0003,
 * section 6).
 *
 * The interceptor turns a 401 into a refresh, an overlay and a retry. Two
 * requests must never take that path, and both are in {@link SessionApi}:
 *
 * - **Login.** A 401 here is a wrong password. Recovering from it would raise a
 *   re-authentication overlay over the login screen, and the overlay's own
 *   sign in would raise another one.
 * - **Refresh.** A 401 here is a dead token, which is precisely what the caller
 *   is being told. Recovering from it would call refresh again, from inside
 *   refresh, forever.
 *
 * A context flag rather than a URL match, because a URL match is a second copy
 * of the route table that a rename silently invalidates: the flag travels on the
 * request the caller built, so the two cannot drift apart.
 */
export const SKIP_SESSION_RECOVERY = new HttpContextToken<boolean>(() => false);

/** The context for a request that answers its own 401. */
export function withoutSessionRecovery(): HttpContext {
  return new HttpContext().set(SKIP_SESSION_RECOVERY, true);
}
