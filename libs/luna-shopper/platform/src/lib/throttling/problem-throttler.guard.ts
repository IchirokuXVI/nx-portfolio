import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import {
  RateLimitedException,
  RETRY_AFTER_SECONDS_DETAIL,
} from '../errors/domain-exception';

/**
 * The global rate limit guard, answering a refusal in the house envelope with the
 * wait the client should count down (plan 0021, section 2.3).
 *
 * `ThrottlerGuard` throws a bare `ThrottlerException`, which the exception filter
 * renders as a 429 with no number in it, and the library's `Retry-After` header is
 * unreadable by a cross origin browser client because it is not CORS safelisted.
 * So the one method that builds the refusal is overridden to throw a
 * {@link RateLimitedException} instead, and the seconds ride the envelope.
 *
 * It lives beside `throttler-config.ts` rather than in the gateway because any
 * service that grows an HTTP surface wants the same answer.
 *
 * The number is honest about what it measures and no more: the throttler's
 * storage is in memory per process and its tracker is the client IP, so with more
 * than one gateway replica a bucket is per pod and per IP (section 2.4). A client
 * renders what it was given rather than assuming a fixed wait.
 */
@Injectable()
export class ProblemThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail
  ): Promise<void> {
    // `timeToExpire` is the remainder on the window and `timeToBlockExpire` the
    // remainder on an explicit block; whichever is longer is when the caller can
    // actually retry. Both arrive as seconds; the ceiling guards a storage
    // backend that returns fractions, and the floor keeps a lapsed value from
    // becoming a negative countdown.
    const seconds = Math.max(detail.timeToExpire, detail.timeToBlockExpire, 0);
    throw new RateLimitedException('Too many requests', {
      details: { [RETRY_AFTER_SECONDS_DETAIL]: Math.ceil(seconds) },
    });
  }
}
