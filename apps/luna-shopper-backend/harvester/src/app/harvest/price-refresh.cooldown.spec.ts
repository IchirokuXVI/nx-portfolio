import type { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  RateLimitedException,
  type RedisService,
} from '@portfolio/luna-shopper/platform';
import {
  PriceRefreshCooldown,
  REDIS_DOWN_RETRY_SECONDS,
  REFRESH_KEYS,
} from './price-refresh.cooldown';

/**
 * The cooldowns of plan 0216, section 5, over a fake Redis that keeps keys
 * with an expiry on a hand moved clock. The real `SET NX PX` is proved in
 * `price-refresh.integration.spec.ts`.
 */

const TARGET = {
  supermarketId: 'chain-1',
  entryId: 'entry-1',
  fetchScopeId: 'scope-1',
};

class FakeRedis {
  now = 0;
  readonly expiries = new Map<string, number>();
  readonly commands: string[] = [];
  failing = false;

  private alive(key: string): number | undefined {
    const at = this.expiries.get(key);
    if (at === undefined || at <= this.now) {
      this.expiries.delete(key);
      return undefined;
    }
    return at;
  }

  async pttl(key: string): Promise<number> {
    this.check();
    this.commands.push(`PTTL ${key}`);
    const at = this.alive(key);
    return at === undefined ? -2 : at - this.now;
  }

  async set(
    key: string,
    _value: string,
    _px: 'PX',
    ms: number,
    nx?: 'NX'
  ): Promise<'OK' | null> {
    this.check();
    this.commands.push(`SET ${key}${nx ? ' NX' : ''}`);
    if (nx && this.alive(key) !== undefined) {
      return null;
    }
    this.expiries.set(key, this.now + ms);
    return 'OK';
  }

  async exists(key: string): Promise<number> {
    this.check();
    return this.alive(key) === undefined ? 0 : 1;
  }

  private check(): void {
    if (this.failing) {
      throw new Error('Connection is closed.');
    }
  }
}

function build() {
  const redis = new FakeRedis();
  const service = {
    client: redis,
    tryCommand: async <T>(op: (client: FakeRedis) => Promise<T>) => {
      try {
        return await op(redis);
      } catch {
        return undefined;
      }
    },
  } as unknown as RedisService;
  const config = {
    getOrThrow: () => ({
      refreshChainSeconds: 30,
      refreshProductMinutes: 30,
      refreshBlockedMinutes: 30,
    }),
  } as unknown as ConfigService;
  return { redis, cooldown: new PriceRefreshCooldown(service, config) };
}

async function waitOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RateLimitedException);
    const refused = error as RateLimitedException;
    expect(refused.code).toBe(ERROR_CODES.RATE_LIMITED);
    return refused.details?.['retryAfterSeconds'] as number;
  }
  return 0;
}

describe('PriceRefreshCooldown (plan 0216, section 5)', () => {
  it('claims the chain, then sets the product, in that order', async () => {
    const { redis, cooldown } = build();
    await cooldown.claim(TARGET);
    expect(redis.commands).toEqual([
      `PTTL ${REFRESH_KEYS.blocked('chain-1')}`,
      `PTTL ${REFRESH_KEYS.product('entry-1', 'scope-1')}`,
      `SET ${REFRESH_KEYS.chain('chain-1')} NX`,
      `SET ${REFRESH_KEYS.product('entry-1', 'scope-1')}`,
    ]);
    expect(REFRESH_KEYS.chain('chain-1')).toBe('harvest:refresh:chain:chain-1');
    expect(REFRESH_KEYS.product('entry-1', 'scope-1')).toBe(
      'harvest:refresh:product:entry-1:scope-1'
    );
  });

  it('refuses another product of the chain with the chain time left', async () => {
    const { redis, cooldown } = build();
    await cooldown.claim(TARGET);
    redis.now = 12_000;
    expect(
      await waitOf(cooldown.claim({ ...TARGET, entryId: 'entry-2' }))
    ).toBe(18);
  });

  it('refuses the same product with the product time left, before the chain claim', async () => {
    const { redis, cooldown } = build();
    await cooldown.claim(TARGET);
    // The chain key has ended; the product key has not.
    redis.now = 60_000;
    redis.commands.length = 0;
    expect(await waitOf(cooldown.claim(TARGET))).toBe(29 * 60);
    // The chain slot is not spent on a product that is still cooling down.
    expect(redis.commands.some((command) => command.startsWith('SET'))).toBe(
      false
    );
  });

  it('refuses every product of a blocked chain with the blocked time left', async () => {
    const { redis, cooldown } = build();
    await cooldown.block('chain-1');
    redis.now = 5 * 60_000;
    expect(
      await waitOf(cooldown.claim({ ...TARGET, entryId: 'entry-9' }))
    ).toBe(25 * 60);
  });

  it('releases nothing: a failed fetch keeps both keys to their end', async () => {
    const { redis, cooldown } = build();
    await cooldown.claim(TARGET);
    // Whatever the fetch answered, nothing here is ever deleted.
    redis.now = 29_000;
    expect(await cooldown.remaining(TARGET)).toBe(30 * 60 - 29);
    redis.now = 30 * 60_000;
    expect(await cooldown.remaining(TARGET)).toBe(0);
    await cooldown.claim(TARGET);
  });

  it('refuses with 60 seconds when Redis cannot answer', async () => {
    const { redis, cooldown } = build();
    redis.failing = true;
    expect(await waitOf(cooldown.claim(TARGET))).toBe(REDIS_DOWN_RETRY_SECONDS);
    expect(await cooldown.remaining(TARGET)).toBe(REDIS_DOWN_RETRY_SECONDS);
    // Best effort writes do not throw.
    await expect(cooldown.block('chain-1')).resolves.toBeUndefined();
    await expect(cooldown.isViewer('r', 'u')).resolves.toBe(false);
  });

  it('lets a shopper who joined read the refresh for two minutes', async () => {
    const { redis, cooldown } = build();
    await cooldown.addViewer('refresh-1', 'user-2');
    expect(await cooldown.isViewer('refresh-1', 'user-2')).toBe(true);
    expect(await cooldown.isViewer('refresh-1', 'user-3')).toBe(false);
    redis.now = 120_000;
    expect(await cooldown.isViewer('refresh-1', 'user-2')).toBe(false);
  });
});
