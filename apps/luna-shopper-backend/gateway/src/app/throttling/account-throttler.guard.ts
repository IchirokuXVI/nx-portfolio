import { Injectable, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { minutes, type ThrottlerOptions } from '@nestjs/throttler';
import {
  ProblemThrottlerGuard,
  scaleThrottleLimit,
} from '@portfolio/luna-shopper/platform';
import type { CurrentUser } from '../auth/jwt.strategy';

/** The bucket these limits are counted under, kept apart from `default`. */
const ACCOUNT_BUCKET = 'account';

/** The metadata key {@link AccountThrottle} writes and the guard reads. */
export const ACCOUNT_THROTTLE = 'luna:accountThrottle';

/** One per route limit: a window and how many requests fit in it. */
export interface AccountThrottleLimit {
  ttl: number;
  limit: number;
}

/** What one account may do, per route. */
export const ACCOUNT_THROTTLE_LIMITS = {
  /**
   * Appending an entry to a walk (backend plan 0168, section 3).
   *
   * A walk saves every 20 s while walking and once on every stop, rewind or
   * edit, so an honest phone sends three or four a minute. Ten leaves room for
   * the retry of a save whose answer was lost, and an entry is up to 256 KB and
   * a fold of the whole map, so a loop is refused well before it costs much.
   */
  shopWalkEntries: { ttl: minutes(1), limit: scaleThrottleLimit(10) },
};

/** Declares what one account may do on this route, per {@link AccountThrottlerGuard}. */
export const AccountThrottle = (limit: AccountThrottleLimit) =>
  SetMetadata(ACCOUNT_THROTTLE, limit);

/**
 * Rate limits a route **per account** rather than per address.
 *
 * The same shape as `ParticipantThrottlerGuard`, for the same reason: the global
 * throttler keys on the caller's IP and runs before any guard has verified a
 * token, so it cannot count one person. This guard is applied **at the route,
 * after** `JwtAuthGuard`, and keys on the verified user id. It declares its own
 * limit rather than `@Throttle`, which would override the default bucket the
 * global guard also reads and apply the number a second time per household.
 *
 * Put `@UseGuards(AccountThrottlerGuard)` above the decorator that applies
 * `JwtAuthGuard` (such as `@RequirePermission`): decorators apply bottom up, so
 * the one written above runs after.
 */
@Injectable()
export class AccountThrottlerGuard extends ProblemThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const declared = this.reflector.getAllAndOverride<
      AccountThrottleLimit | undefined
    >(ACCOUNT_THROTTLE, [context.getHandler(), context.getClass()]);
    if (!declared) {
      return true;
    }

    const { req } = this.getRequestResponse(context);
    const user = req['user'] as CurrentUser | undefined;
    if (!user?.userId) {
      // Only reachable if this guard runs before the one that verifies the
      // token, which refuses the request itself.
      return true;
    }

    const throttler: ThrottlerOptions = {
      name: ACCOUNT_BUCKET,
      ttl: declared.ttl,
      limit: declared.limit,
    };
    return this.handleRequest({
      context,
      limit: declared.limit,
      ttl: declared.ttl,
      throttler,
      blockDuration: declared.ttl,
      getTracker: async () => user.userId,
      generateKey: this.generateKey.bind(this),
    });
  }
}
