import { Injectable, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { minutes, type ThrottlerOptions } from '@nestjs/throttler';
import type { GeneratedListParticipantContext } from '@portfolio/luna-shopper/contracts';
import { ProblemThrottlerGuard } from '@portfolio/luna-shopper/platform';

/** The bucket these limits are counted under, kept apart from `default`. */
const PARTICIPANT_BUCKET = 'participant';

/** The metadata key {@link ParticipantThrottle} writes and the guard reads. */
const PARTICIPANT_THROTTLE = 'luna:participantThrottle';

/** One per route limit: a window and how many requests fit in it. */
export interface ParticipantThrottleLimit {
  ttl: number;
  limit: number;
}

/**
 * What one participant may do, per route (plan 0055, section 7).
 *
 * The surface plan 0055 widens is reachable by anybody holding a link that
 * anybody may have forwarded, so the numbers are sized for one person in one
 * shop rather than for a client that is behaving.
 *
 * Revocation is the real control and it already exists: an owner who sees a
 * basket being spoiled revokes the participant, or the link with its guests, and
 * the live presence check refuses their next request. These bound the damage
 * before anybody notices they need to use it.
 */
export const PARTICIPANT_THROTTLE_LIMITS = {
  /**
   * Every write on the participant surface: adding a line, settling one,
   * swapping a pick.
   *
   * The settle route needs it for the same reason the new add does and did not
   * have it. Sixty a minute is one a second, which no shopper reaches and which
   * makes filling somebody's basket with rubbish slow enough to be noticed and
   * revoked. `checkRoom` is what bounds the total.
   */
  write: { ttl: minutes(1), limit: 60 },
  /**
   * Searching the catalog through a basket.
   *
   * **Tighter than the write limit**, which reads backwards until you price the
   * two: a write is one insert, and a suggestion is two ranked full text
   * searches across the catalog with a trigram fallback behind each. Twenty a
   * minute is looser than a keystroke and tighter than a keystroke's worth of
   * requests, because velista debounces at the composer and the server must not
   * depend on it having done so.
   */
  suggest: { ttl: minutes(1), limit: 20 },
} as const;

/** Declares what one participant may do on this route, per {@link ParticipantThrottlerGuard}. */
export const ParticipantThrottle = (limit: ParticipantThrottleLimit) =>
  SetMetadata(PARTICIPANT_THROTTLE, limit);

/**
 * Rate limits the participant surface **per participant** (plan 0055,
 * section 7).
 *
 * ## Why the global throttler cannot do this
 *
 * It keys on the caller's IP, and it runs before {@link ParticipantGuard}: Nest
 * executes global guards, then the controller's, then the route's, so at the
 * moment the global one counts a request nothing has yet turned a credential
 * into a participant. This guard is applied **at the route**, after the
 * controller's guard has resolved one, which is what lets it key on the
 * participant id: a value the caller cannot forge, that names one person rather
 * than one household's wifi, and that revocation already invalidates.
 *
 * ## Why it carries its own limits rather than reusing `@Throttle`
 *
 * Because `@Throttle` overrides the **default** bucket, which the global guard
 * is also reading, so declaring one here would apply the same numbers a second
 * time keyed by IP. Everybody in one flat shares an address, and a per person
 * limit silently enforced per household is a limit that bites three people for
 * one person's typing. So the route declares {@link ParticipantThrottle}, this
 * guard reads it, and the global guard sees nothing to override and keeps its
 * ordinary bucket underneath.
 */
@Injectable()
export class ParticipantThrottlerGuard extends ProblemThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const declared = this.reflector.getAllAndOverride<
      ParticipantThrottleLimit | undefined
    >(PARTICIPANT_THROTTLE, [context.getHandler(), context.getClass()]);
    if (!declared) {
      return true;
    }

    const { req } = this.getRequestResponse(context);
    const participant = req['participant'] as
      | GeneratedListParticipantContext
      | undefined;
    if (!participant) {
      // Only reachable if this guard is ever placed before the one that resolves
      // a participant. Counting the request against nobody would be a limit that
      // does not exist, so it is left to that guard to refuse.
      return true;
    }

    const throttler: ThrottlerOptions = {
      name: PARTICIPANT_BUCKET,
      ttl: declared.ttl,
      limit: declared.limit,
    };
    return this.handleRequest({
      context,
      limit: declared.limit,
      ttl: declared.ttl,
      throttler,
      blockDuration: declared.ttl,
      // The whole point of the guard. `generateKey` already namespaces by
      // controller, handler and bucket, so each route counts separately and
      // neither collides with the default bucket's IP keyed entries.
      getTracker: async () => participant.participantId,
      generateKey: this.generateKey.bind(this),
    });
  }
}
