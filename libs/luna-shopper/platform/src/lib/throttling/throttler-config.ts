import {
  minutes,
  seconds,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';

/**
 * Rate limiting (plan 0004, section 8).
 *
 * Exactly one bucket is registered, because the global `ThrottlerGuard` applies
 * *every* configured throttler to *every* route. Registering the strict limits as
 * additional named throttlers therefore rate limits the whole API at the
 * strictest of them rather than only the routes that name it, and
 * `@Throttle({ [name]: {} })` does not opt a route in either: it overrides that
 * throttler's options for one handler, while the rest keep counting. With the
 * five strict buckets registered, `verify-resend` (3 per 10 minutes) governed
 * every request, health probes included.
 *
 * So the open, abusable surfaces override this single bucket's limit for
 * themselves with `@Throttle(THROTTLE_LIMITS.login)`. The values are
 * conservative starting points, tunable from config later.
 */
const DEFAULT_BUCKET = 'default';

export function createThrottlerOptions(): ThrottlerModuleOptions {
  return {
    throttlers: [{ name: DEFAULT_BUCKET, ttl: minutes(1), limit: 120 }],
  };
}

/**
 * Per route overrides of the single bucket. Join code redemption is limited per
 * client to frustrate enumeration, which pairs with the high entropy join codes
 * designed in 0006.
 */
export const THROTTLE_LIMITS = {
  /** Login attempts. */
  login: { [DEFAULT_BUCKET]: { ttl: minutes(1), limit: 5 } },
  /** Account registration. */
  registration: { [DEFAULT_BUCKET]: { ttl: minutes(1), limit: 3 } },
  /** Anonymous zone create / join. */
  anonymousZone: { [DEFAULT_BUCKET]: { ttl: minutes(1), limit: 10 } },
  /** Email verification resend. */
  verifyResend: { [DEFAULT_BUCKET]: { ttl: minutes(10), limit: 3 } },
  /** Join code redemption (enumeration protection). */
  joinCode: { [DEFAULT_BUCKET]: { ttl: seconds(30), limit: 5 } },
  /**
   * The public platform totals (plan 0017, section 8.2). Tighter than the
   * default because an unauthenticated endpoint is the cheapest thing to hammer,
   * and loose enough that a real visitor never meets it: the gateway serves this
   * from a 60 second cache, so a client polling faster than this gains nothing.
   */
  publicStats: { [DEFAULT_BUCKET]: { ttl: minutes(1), limit: 30 } },
} as const;
