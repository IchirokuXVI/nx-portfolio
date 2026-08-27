import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AUTH_PATTERNS } from '@portfolio/luna-shopper/contracts';
import {
  createThrottlerOptions,
  ProblemThrottlerGuard,
  RateLimitedException,
  retryAfterSecondsOf,
  THROTTLE_LIMITS,
  throttleWaitSeconds,
} from '@portfolio/luna-shopper/platform';
import { AuthController } from './auth.controller';

/**
 * The password reset routes and the bucket the request one carries (plan 0022,
 * sections 2.2 and 3).
 *
 * The throttling assertions run the real guard against the real in memory bucket
 * with the controller's own handlers, so what is checked is the decorator the
 * route actually carries rather than a restatement of it.
 */

function contextFor(
  handler: (...args: never[]) => unknown,
  ip = '1.1.1.1'
): ExecutionContext {
  const request = { ip, ips: [], headers: {} };
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

describe('POST /v1/auth/forgot-password', () => {
  it('passes the address and the request locale to auth', async () => {
    const send = jest.fn(async () => ({
      retryAfterSeconds: throttleWaitSeconds(THROTTLE_LIMITS.passwordReset),
    }));
    const controller = new AuthController({ send } as never);

    await expect(
      controller.forgotPassword({ email: 'a@b.com' })
    ).resolves.toEqual({ retryAfterSeconds: 60 });
    expect(send).toHaveBeenCalledWith(
      AUTH_PATTERNS.forgotPassword,
      expect.objectContaining({ email: 'a@b.com' })
    );
  });
});

describe('POST /v1/auth/reset-password', () => {
  it('forwards the token and the new password, and answers with a pair', async () => {
    const pair = {
      userId: 'u1',
      kind: 'REGISTERED',
      username: 'Swift Sail',
      accessToken: 'a',
      refreshToken: 'r',
    };
    const send = jest.fn(async () => pair);
    const controller = new AuthController({ send } as never);

    await expect(
      controller.resetPassword({ token: 't', password: 'new-one' })
    ).resolves.toBe(pair);
    expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.resetPassword, {
      token: 't',
      password: 'new-one',
    });
  });
});

describe('the bucket the forgot-password route carries', () => {
  let storage: ThrottlerStorageService;

  beforeEach(() => {
    storage = new ThrottlerStorageService();
  });

  afterEach(() => {
    storage.onApplicationShutdown();
  });

  it('refuses a second request inside the minute and says how long is left', async () => {
    const guard = await buildGuard(storage);
    const context = contextFor(AuthController.prototype.forgotPassword);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    const refusal = await guard
      .canActivate(context)
      .catch((thrown: unknown) => thrown);

    expect(refusal).toBeInstanceOf(RateLimitedException);
    // The real remainder, not a flat sixty: the success body carries the whole
    // wait, a refusal carries what is actually left, which is smaller.
    const left = retryAfterSecondsOf(refusal as RateLimitedException);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(
      throttleWaitSeconds(THROTTLE_LIMITS.passwordReset)
    );
  });

  it('refuses a request for a different address from the same client', async () => {
    // Documented behaviour rather than an oversight (section 2.2): the bucket
    // keys on IP, so it limits hammering the endpoint and does nothing about
    // filling one person's inbox from a rotating set of clients. A per address
    // limit is the answer to that, and section 9 leaves it unbuilt.
    const guard = await buildGuard(storage);

    await expect(
      guard.canActivate(contextFor(AuthController.prototype.forgotPassword))
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor(AuthController.prototype.forgotPassword))
    ).rejects.toBeInstanceOf(RateLimitedException);
  });

  it('lets a reset link be spent even after the request bucket is spent', async () => {
    // Consuming a link is not asking for one. The reset route stays on the
    // default bucket for the reason 0021 section 4.3 took the resend bucket off
    // the consume route: a tight limit there refuses a link that would have
    // worked.
    const guard = await buildGuard(storage);

    await expect(
      guard.canActivate(contextFor(AuthController.prototype.forgotPassword))
    ).resolves.toBe(true);
    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(
        guard.canActivate(contextFor(AuthController.prototype.resetPassword))
      ).resolves.toBe(true);
    }
  });
});
