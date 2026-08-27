import { minutes } from '@nestjs/throttler';
import type { Logger } from 'nestjs-pino';
import type { RedisService } from '../redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * The Lua script is exercised against a real Redis by the integration suite; what
 * is asserted here is the translation either side of it, and the failure mode.
 */
describe('RedisThrottlerStorage', () => {
  const logger = { error: jest.fn(), warn: jest.fn() } as unknown as Logger;

  function storageWith(evalResult: unknown) {
    const evaluate = jest.fn().mockResolvedValue(evalResult);
    const redis = { client: { eval: evaluate } } as unknown as RedisService;
    return { storage: new RedisThrottlerStorage(redis, logger), evaluate };
  }

  it('reports a request inside the limit as allowed, in seconds', async () => {
    const { storage, evaluate } = storageWith([1, 45_000, 0, 0]);

    const record = await storage.increment('abc', minutes(1), 5, minutes(1), 'default');

    expect(record).toEqual({
      totalHits: 1,
      timeToExpire: 45,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    // Two keys, then ttl / limit / blockDuration as strings.
    expect(evaluate).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'throttle:hits:default:abc',
      'throttle:block:default:abc',
      String(minutes(1)),
      '5',
      String(minutes(1))
    );
  });

  /**
   * The exit criterion from plan 0028, section 7: the countdown the client
   * renders is the real remaining window, not a fresh full one. Forty seconds
   * into a sixty second window, a refusal owes twenty seconds.
   */
  it('reports the remaining window as the wait when it refuses', async () => {
    const { storage } = storageWith([2, 20_000, 1, 20_000]);

    const record = await storage.increment('abc', minutes(1), 1, minutes(1), 'default');

    expect(record.isBlocked).toBe(true);
    expect(record.timeToExpire).toBe(20);
    expect(record.timeToBlockExpire).toBe(20);
  });

  /**
   * Section 5's one deliberate departure. The package's instinct is to let the
   * request through on a storage error, which would leave registration and
   * password reset unlimited for the length of a Redis outage.
   */
  it('fails closed when Redis cannot answer', async () => {
    const evaluate = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const redis = { client: { eval: evaluate } } as unknown as RedisService;
    const storage = new RedisThrottlerStorage(redis, logger);

    const record = await storage.increment('abc', minutes(1), 5, minutes(1), 'default');

    expect(record.isBlocked).toBe(true);
    expect(record.totalHits).toBeGreaterThan(5);
    expect(record.timeToExpire).toBe(60);
    expect(logger.error).toHaveBeenCalled();
  });

  it('rounds a partial second up rather than down to zero', async () => {
    const { storage } = storageWith([3, 400, 1, 400]);

    const record = await storage.increment('abc', minutes(1), 1, minutes(1), 'default');

    // A zero would tell the client to retry immediately into a refusal.
    expect(record.timeToExpire).toBe(1);
  });
});
