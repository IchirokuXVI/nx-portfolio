import { HttpContext, HttpContextToken } from '@angular/common/http';
import { SKIP_SESSION_RECOVERY } from '../auth/session-http-context';

/**
 * "This request is the probe. Do not probe about it" (plan 0008, section 2).
 *
 * The interceptor answers a request that never arrived by asking the health
 * endpoint whether anything is there. That question is itself a request, and
 * without this flag a failing probe would ask about itself. The probe is single
 * flight, so the result is not an infinite loop, but it is a service reporting
 * its own failure to itself and a state machine that is much harder to read.
 *
 * A context flag rather than a URL match, for the reason `SKIP_SESSION_RECOVERY`
 * is one: a URL match is a second copy of the route table that a rename silently
 * invalidates.
 */
export const SKIP_REACHABILITY_PROBE = new HttpContextToken<boolean>(
  () => false
);

/**
 * The context the probe travels on.
 *
 * It opts out of session recovery as well. The probe is unauthenticated, so a
 * 401 from it means the gateway is answering something unexpected rather than
 * that this app's token died, and raising a password prompt over that would be
 * an overlay caused by a health check.
 */
export function probeContext(): HttpContext {
  return new HttpContext()
    .set(SKIP_REACHABILITY_PROBE, true)
    .set(SKIP_SESSION_RECOVERY, true);
}
