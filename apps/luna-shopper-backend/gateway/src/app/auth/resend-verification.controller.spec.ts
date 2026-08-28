import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AUTH_PATTERNS, UserKind } from '@portfolio/luna-shopper/contracts';
import {
  createThrottlerOptions,
  ProblemThrottlerGuard,
  RateLimitedException,
  retryAfterSecondsOf,
  THROTTLE_LIMITS,
  throttleWaitSeconds,
} from '@portfolio/luna-shopper/platform';
import { AuthController } from './auth.controller';
import type { CurrentUser } from './jwt.strategy';

/**
 * The resend endpoint and the bucket it took off the consume route (plan 0021,
 * sections 4.1 to 4.3).
 *
 * The throttling assertions run the real guard against the real in memory bucket
 * with the controller's own handlers, so what is checked is the decorator the
 * route actually carries rather than a restatement of it.
 */

const caller: CurrentUser = { userId: 'u1', kind: UserKind.REGISTERED };

function contextFor(handler: (...args: never[]) => unknown): ExecutionContext {
  const request = { ip: '1.1.1.1', ips: [], headers: {} };
  const response = { header: jest.fn() };
  return {
    getHandler: () => handler,
    getClass: () => AuthController,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

async function buildGuard(storage: ThrottlerStorageService) {
  const guard = new ProblemThrottlerGuard(
    createThrottlerOptions(),
    storage,
    new Reflector()
  );
  await guard.onModuleInit();
  return guard;
}

describe('POST /v1/auth/resend-verification', () => {
  it('asks auth to resend for the caller in the token, never a body', async () => {
    const send = jest.fn(async () => ({
      retryAfterSeconds: throttleWaitSeconds(THROTTLE_LIMITS.verifyResend),
    }));
    const controller = new AuthController({ send } as never);

    await expect(controller.resendVerification(caller)).resolves.toEqual({
      retryAfterSeconds: 60,
    });
    expect(send).toHaveBeenCalledWith(
      AUTH_PATTERNS.resendVerification,
      expect.objectContaining({ userId: 'u1' })
    );
  });
});

describe('the buckets the auth routes carry', () => {
  let storage: ThrottlerStorageService;

  beforeEach(() => {
    storage = new ThrottlerStorageService();
  });

  afterEach(() => {
    storage.onApplicationShutdown();
  });

  it('refuses a second resend and says how long is left', async () => {
    const guard = await buildGuard(storage);
    const context = contextFor(AuthController.prototype.resendVerification);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    const refusal = await guard
      .canActivate(context)
      .catch((thrown: unknown) => thrown);

    expect(refusal).toBeInstanceOf(RateLimitedException);
    expect(retryAfterSecondsOf(refusal as RateLimitedException)).toBeGreaterThan(
      0
    );
  });

  it('lets a link be consumed four times over, which the old bucket refused', async () => {
    // The resend bucket used to sit on this route at three per ten minutes, so a
    // prefetching mail client plus a double tap plus one honest retry left a user
    // rate limited on a link that would have worked.
    const guard = await buildGuard(storage);
    const context = contextFor(AuthController.prototype.verifyEmail);

    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
  });
});
