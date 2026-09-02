import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import {
  ParticipantKind,
  type GeneratedListParticipantContext,
} from '@portfolio/luna-shopper/contracts';
import {
  createThrottlerOptions,
  RateLimitedException,
  retryAfterSecondsOf,
} from '@portfolio/luna-shopper/platform';
import {
  PARTICIPANT_THROTTLE_LIMITS,
  ParticipantThrottle,
  ParticipantThrottlerGuard,
} from './participant-throttler.guard';

/**
 * The participant surface is rate limited **per participant** (plan 0055,
 * section 7).
 *
 * What is actually being pinned here is that the bucket is the person and not
 * the address. The surface is reachable by anybody holding a link that anybody
 * may have forwarded, and the obvious implementation, letting the global guard
 * do it, counts by IP: everybody in one flat shares one, so a per person limit
 * enforced per household bites three people for one person's typing. It also
 * runs before the guard that resolves a participant, so at the moment it counts
 * there is nobody to count against.
 */

/** Two routes carrying the two limits, so the guard reads real metadata. */
class BasketRoutes {
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  addLine(): void {
    return undefined;
  }

  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.suggest)
  suggest(): void {
    return undefined;
  }
}

/** A route with no declaration at all, which the guard must wave through. */
class UnlimitedRoute {
  read(): void {
    return undefined;
  }
}

function participant(id: string): GeneratedListParticipantContext {
  return {
    participantId: id,
    generatedListId: 'gl-1',
    kind: ParticipantKind.GUEST,
    userId: null,
    seesZoneData: false,
  };
}

function contextFor(options: {
  participantId?: string;
  ip?: string;
  handler?: 'addLine' | 'suggest';
}): ExecutionContext {
  const request: Record<string, unknown> = {
    ip: options.ip ?? '1.1.1.1',
    headers: {},
  };
  if (options.participantId) {
    request['participant'] = participant(options.participantId);
  }
  const name = options.handler ?? 'addLine';
  return {
    getHandler: () => BasketRoutes.prototype[name],
    getClass: () => BasketRoutes,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ header: jest.fn() }),
    }),
  } as unknown as ExecutionContext;
}

function undeclaredContext(): ExecutionContext {
  return {
    getHandler: () => UnlimitedRoute.prototype.read,
    getClass: () => UnlimitedRoute,
    switchToHttp: () => ({
      getRequest: () => ({ ip: '1.1.1.1', headers: {} }),
      getResponse: () => ({ header: jest.fn() }),
    }),
  } as unknown as ExecutionContext;
}

/** Spends a route's whole allowance, leaving the next call to be refused. */
async function exhaust(
  guard: ParticipantThrottlerGuard,
  context: ExecutionContext,
  limit: number
): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    await guard.canActivate(context);
  }
}

describe('ParticipantThrottlerGuard', () => {
  let storage: ThrottlerStorageService;
  let guard: ParticipantThrottlerGuard;

  beforeEach(async () => {
    jest.useFakeTimers();
    storage = new ThrottlerStorageService();
    guard = new ParticipantThrottlerGuard(
      createThrottlerOptions(),
      storage,
      new Reflector()
    );
    await guard.onModuleInit();
  });

  afterEach(() => {
    storage.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('lets an ordinary request through', async () => {
    await expect(
      guard.canActivate(contextFor({ participantId: 'p-1' }))
    ).resolves.toBe(true);
  });

  it('refuses one participant past their allowance, with the wait', async () => {
    const context = contextFor({ participantId: 'p-1' });
    await exhaust(guard, context, PARTICIPANT_THROTTLE_LIMITS.write.limit);

    const error = await guard
      .canActivate(context)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(RateLimitedException);
    // The house envelope carries the countdown, as every refusal does.
    expect(retryAfterSecondsOf(error as RateLimitedException)).toBeGreaterThan(
      0
    );
  });

  it('counts each participant separately, however they arrived', async () => {
    // The whole point. Two guests on one flat's wifi share an address and must
    // not share an allowance: one person shopping enthusiastically cannot lock
    // out the person standing next to them.
    const busy = contextFor({ participantId: 'p-1', ip: '5.5.5.5' });
    const quiet = contextFor({ participantId: 'p-2', ip: '5.5.5.5' });

    await exhaust(guard, busy, PARTICIPANT_THROTTLE_LIMITS.write.limit);

    await expect(guard.canActivate(busy)).rejects.toBeInstanceOf(
      RateLimitedException
    );
    await expect(guard.canActivate(quiet)).resolves.toBe(true);
  });

  it('counts each route separately, so searching does not spend the write budget', async () => {
    const writes = contextFor({ participantId: 'p-1', handler: 'addLine' });
    const searches = contextFor({ participantId: 'p-1', handler: 'suggest' });

    await exhaust(guard, searches, PARTICIPANT_THROTTLE_LIMITS.suggest.limit);

    await expect(guard.canActivate(searches)).rejects.toBeInstanceOf(
      RateLimitedException
    );
    // The same person may still put something in the basket, which is the
    // gesture that matters: a dropdown is an offer, and adding a line must never
    // fail because a search did.
    await expect(guard.canActivate(writes)).resolves.toBe(true);
  });

  it('holds searches to a tighter limit than writes', async () => {
    // Which reads backwards until you price the two: a write is one insert, and
    // a suggestion is two ranked catalog searches with a trigram fallback.
    expect(PARTICIPANT_THROTTLE_LIMITS.suggest.limit).toBeLessThan(
      PARTICIPANT_THROTTLE_LIMITS.write.limit
    );
  });

  it('lets the window lapse rather than blocking for good', async () => {
    const context = contextFor({ participantId: 'p-1' });
    await exhaust(guard, context, PARTICIPANT_THROTTLE_LIMITS.write.limit);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      RateLimitedException
    );

    jest.advanceTimersByTime(PARTICIPANT_THROTTLE_LIMITS.write.ttl * 2 + 1_000);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('waves through a route that declares no limit', async () => {
    // The guard is opt in per route, so mounting it on a controller does not
    // silently rate limit everything under it.
    await expect(guard.canActivate(undeclaredContext())).resolves.toBe(true);
  });

  it('counts nothing when no participant has been resolved', async () => {
    // Only reachable if it is ever placed before the guard that resolves one.
    // Counting against nobody would be a limit that does not exist, so it defers
    // to that guard to refuse rather than inventing a bucket.
    const context = contextFor({});
    await exhaust(guard, context, PARTICIPANT_THROTTLE_LIMITS.write.limit + 5);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
