import {
  hours,
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
 * strict buckets registered, the tightest of them governed every request, health
 * probes included.
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
  /**
   * Email verification resend (plan 0021, section 4.2). One at a time, so the
   * countdown the client renders means something, and so the whole of the
   * enforcement is this bucket rather than a second limiter in the domain.
   */
  verifyResend: { [DEFAULT_BUCKET]: { ttl: minutes(1), limit: 1 } },
  /**
   * Consuming a verification link (plan 0021, section 4.3). Brute forcing a 256
   * bit single use token is not a threat worth designing around, so this exists
   * only to make hammering pointless. Ten a minute covers every honest pattern,
   * a mail client that prefetches links included; the resend bucket used to sit
   * here and could refuse a link that would have worked.
   */
  verifyConsume: { [DEFAULT_BUCKET]: { ttl: minutes(1), limit: 10 } },
  /**
   * Asking for a password reset link (plan 0022, section 2.2). One a minute, the
   * same shape as the resend and for the same reason: the whole of the
   * enforcement is this bucket, so `retryAfterSeconds` can be read from it rather
   * than restated. It keys on the caller's IP, which is what makes it a limit on
   * hammering the endpoint rather than a limit on filling one person's inbox; a
   * per address limit is the answer to that, and section 9 leaves it unbuilt.
   */
  passwordReset: { [DEFAULT_BUCKET]: { ttl: minutes(1), limit: 1 } },
  /** Join code redemption (enumeration protection). */
  joinCode: { [DEFAULT_BUCKET]: { ttl: seconds(30), limit: 5 } },
  /**
   * The public platform totals (plan 0017, section 8.2). Tighter than the
   * default because an unauthenticated endpoint is the cheapest thing to hammer,
   * and loose enough that a real visitor never meets it: the gateway serves this
   * from a 60 second cache, so a client polling faster than this gains nothing.
   */
  publicStats: { [DEFAULT_BUCKET]: { ttl: minutes(1), limit: 30 } },
  /**
   * Renaming, global or per zone (plan 0018, section 6). Usernames are public,
   * non unique and freely changeable, so rapid renaming is a plausible
   * harassment pattern: take a target's name, act under it, change back. Five an
   * hour leaves ordinary editing untouched and makes that loop impractical.
   */
  usernameChange: { [DEFAULT_BUCKET]: { ttl: hours(1), limit: 5 } },
} as const;

/** One per route override, as {@link THROTTLE_LIMITS} publishes them. */
export type ThrottleLimit = Record<
  typeof DEFAULT_BUCKET,
  { ttl: number; limit: number }
>;

/**
 * The wait a client owes after spending a bucket, in whole seconds (plan 0021,
 * section 4.2).
 *
 * A route that returns the wait in its own success body reads it from here
 * rather than restating the number, so the bucket and the response cannot drift
 * apart when the limit is retuned. The 429 path does not use this: a refusal
 * carries what is actually left on the bucket, which is smaller.
 */
export function throttleWaitSeconds(limit: ThrottleLimit): number {
  return Math.ceil(limit[DEFAULT_BUCKET].ttl / 1000);
}
