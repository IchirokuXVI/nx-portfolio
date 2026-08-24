import {
  minutes,
  seconds,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';

/**
 * Named rate limit buckets (plan 0004, section 8).
 *
 * A permissive `default` bucket applies to every route via the global guard;
 * the open, abusable surfaces opt into a stricter, named bucket with
 * `@Throttle({ [THROTTLE_BUCKETS.login]: ... })` on their controller. Join code
 * redemption is limited per client to frustrate enumeration, which pairs with the
 * high entropy join codes designed in 0006. The values are conservative starting
 * points, tunable from config later.
 */
export const THROTTLE_BUCKETS = {
  default: 'default',
  /** Login attempts. */
  login: 'login',
  /** Account registration. */
  registration: 'registration',
  /** Anonymous zone create / join. */
  anonymousZone: 'anonymous-zone',
  /** Email verification resend. */
  verifyResend: 'verify-resend',
  /** Join code redemption (enumeration protection). */
  joinCode: 'join-code',
} as const;

export function createThrottlerOptions(): ThrottlerModuleOptions {
  return {
    throttlers: [
      { name: THROTTLE_BUCKETS.default, ttl: minutes(1), limit: 120 },
      { name: THROTTLE_BUCKETS.login, ttl: minutes(1), limit: 5 },
      { name: THROTTLE_BUCKETS.registration, ttl: minutes(1), limit: 3 },
      { name: THROTTLE_BUCKETS.anonymousZone, ttl: minutes(1), limit: 10 },
      { name: THROTTLE_BUCKETS.verifyResend, ttl: minutes(10), limit: 3 },
      { name: THROTTLE_BUCKETS.joinCode, ttl: seconds(30), limit: 5 },
    ],
  };
}
