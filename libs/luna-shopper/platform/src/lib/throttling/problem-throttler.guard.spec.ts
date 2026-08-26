import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  Throttle,
  ThrottlerStorageService,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import {
  RateLimitedException,
  retryAfterSecondsOf,
} from '../errors/domain-exception';
import { ProblemThrottlerGuard } from './problem-throttler.guard';
import {
  createThrottlerOptions,
  THROTTLE_LIMITS,
  throttleWaitSeconds,
} from './throttler-config';

/**
 * A refusal carries the wait in the body (plan 0021, sections 2.3 and 4.2), and
 * the number is the bucket's real remainder rather than a constant, which is what
 * lets a client count down instead of guessing.
 */

/** A route carrying the resend override, so the guard reads the real metadata. */
class ResendRoute {
  @Throttle(THROTTLE_LIMITS.verifyResend)
  resendVerification(): void {
    return undefined;
  }
}

function contextFor(ip: string): ExecutionContext {
  const request = { ip, ips: [], headers: {} };
  const response = { header: jest.fn() };
  return {
    getHandler: () => ResendRoute.prototype.resendVerification,
    getClass: () => ResendRoute,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

async function buildGuard(storage: ThrottlerStorage) {
  const guard = new ProblemThrottlerGuard(
    createThrottlerOptions(),
    storage,
    new Reflector()
  );
  await guard.onModuleInit();
  return guard;
}

/** A storage double that answers one fixed record, to pin down which field is read. */
const fixedStorage = (
  timeToExpire: number,
  timeToBlockExpire: number
): ThrottlerStorage => ({
  increment: jest.fn(async () => ({
    totalHits: 2,
    timeToExpire,
    isBlocked: true,
    timeToBlockExpire,
  })),
});

describe('ProblemThrottlerGuard', () => {
  it('throws a domain exception carrying the seconds left on the window', async () => {
    const guard = await buildGuard(fixedStorage(17, 0));

    const error = await guard
      .canActivate(contextFor('1.1.1.1'))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(RateLimitedException);
    expect(retryAfterSecondsOf(error as RateLimitedException)).toBe(17);
  });

  it('reports the block when a block outlives the window', async () => {
    // Whichever runs longer is when the caller can actually retry; reporting the
    // shorter one would send them back into a refusal.
    const guard = await buildGuard(fixedStorage(17, 41));

    const error = await guard
      .canActivate(contextFor('1.1.1.1'))
      .catch((thrown: unknown) => thrown);

    expect(retryAfterSecondsOf(error as RateLimitedException)).toBe(41);
  });

  describe('against the real in memory bucket', () => {
    let storage: ThrottlerStorageService;

    beforeEach(() => {
      jest.useFakeTimers();
      storage = new ThrottlerStorageService();
    });

    afterEach(() => {
      storage.onApplicationShutdown();
      jest.useRealTimers();
    });

    it('lets the first resend through and counts the next one down', async () => {
      const guard = await buildGuard(storage);
      const context = contextFor('2.2.2.2');
      const full = throttleWaitSeconds(THROTTLE_LIMITS.verifyResend);

      await expect(guard.canActivate(context)).resolves.toBe(true);

      const first = await guard
        .canActivate(context)
        .catch((thrown: unknown) => thrown);
      const firstWait = retryAfterSecondsOf(first as RateLimitedException);
      expect(first).toBeInstanceOf(RateLimitedException);
      expect(firstWait).toBeLessThanOrEqual(full);
      expect(firstWait).toBeGreaterThan(0);

      // Five seconds later the refusal reports five fewer seconds. This is the
      // assertion velista's countdown rule leans on: the number is the state of
      // the bucket, not the bucket's configured size restated.
      jest.advanceTimersByTime(5_000);
      const later = await guard
        .canActivate(context)
        .catch((thrown: unknown) => thrown);

      expect(retryAfterSecondsOf(later as RateLimitedException)).toBe(
        (firstWait as number) - 5
      );
    });

    it('counts each client separately, so one caller cannot lock another out', async () => {
      const guard = await buildGuard(storage);

      await expect(guard.canActivate(contextFor('3.3.3.3'))).resolves.toBe(true);
      await expect(guard.canActivate(contextFor('4.4.4.4'))).resolves.toBe(true);
    });
  });
});
