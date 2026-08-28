import { minutes } from '@nestjs/throttler';
import { describeIntegration } from '@portfolio/luna-shopper/test-fixtures/jest';
import Redis from 'ioredis';
import type { Logger } from 'nestjs-pino';
import { RedisThrottlerStorage } from '../throttling/redis-throttler.storage';
import { createRedisOptions } from './redis.options';
import { RedisService } from './redis.service';

/**
 * The Redis pieces of plan 0028, against a real server.
 *
 * The unit suites use doubles, which is right for the translation either side of
 * a command but cannot prove the commands themselves. Everything here is
 * something a double would happily get wrong: whether the throttler's Lua script
 * is atomic and expires on schedule, whether `SET NX EX` really refuses the
 * second caller, whether `EXPIRE ... NX` really declines to extend a window, and
 * whether a sorted set prunes by score the way presence assumes.
 *
 * Run it with a Redis up:
 *
 *   docker compose -f k8s/e2e/luna-shopper-backend/compose.yml up -d redis
 *   LUNA_INTEGRATION=1 npx nx run luna-shopper/platform:test-integration
 */

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

const silentLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

describeIntegration('Redis, against a real server', () => {
  let service: RedisService;
  let raw: Redis;

  beforeAll(async () => {
    service = new RedisService(redisUrl, silentLogger);
    raw = new Redis(redisUrl, createRedisOptions('command', 'test-raw'));
    // The offline queue is off, so the first command has to wait for the
    // connection rather than be rejected as early. This is the same wait the
    // realtime service does at boot.
    await service.whenReady();
    // Polled rather than awaited on the event: `ready` may already have fired by
    // the time the listener is attached, and a `once` on a past event never
    // resolves.
    await waitFor(() => raw.status === 'ready');
  });

  afterAll(async () => {
    await service.onApplicationShutdown();
    await raw.quit();
  });

  beforeEach(async () => {
    // A clean slate per test, scoped to the namespaces this plan owns so a
    // developer's own stack is never flushed out from under them.
    const keys = await raw.keys('throttle:*');
    const more = await raw.keys('dedupe:*');
    const presence = await raw.keys('presence:*');
    const access = await raw.keys('access:*');
    const all = [...keys, ...more, ...presence, ...access];
    if (all.length > 0) {
      await raw.del(...all);
    }
  });

  describe('the connection itself', () => {
    it('connects and answers a health check', async () => {
      await expect(service.check('redis')).resolves.toEqual({
        redis: { status: 'up' },
      });
      expect(service.isConnected).toBe(true);
    });

    it('hands out an independent second connection for pub/sub', async () => {
      const subscriber = service.duplicate('pubsub', 'test-sub');
      const received: string[] = [];

      await subscriber.subscribe('test:channel');
      subscriber.on('message', (_channel, raw) => received.push(raw));

      await service.client.publish('test:channel', 'hello');
      await waitFor(() => received.length > 0);

      // The rule this encodes: a connection in subscribe mode cannot publish, so
      // the publisher has to be a different connection.
      expect(received).toEqual(['hello']);
      await subscriber.unsubscribe('test:channel');
    });
  });

  describe('the throttler storage', () => {
    function storage() {
      return new RedisThrottlerStorage(service, silentLogger);
    }

    it('counts one bucket across two independent storages', async () => {
      const podA = storage();
      const podB = storage();

      const first = await podA.increment('k1', minutes(1), 1, minutes(1), 'default');
      const second = await podB.increment('k1', minutes(1), 1, minutes(1), 'default');

      // The exit criterion: `verifyResend` refuses the second request in a
      // minute regardless of which pod served the first.
      expect(first.isBlocked).toBe(false);
      expect(second.isBlocked).toBe(true);
      expect(second.totalHits).toBe(2);
    });

    it('reports the remaining window rather than a fresh one', async () => {
      const store = storage();
      // A two second window, so the countdown can actually be observed shrinking.
      await store.increment('k2', 2_000, 1, 2_000, 'default');
      await sleep(1_100);
      const refused = await store.increment('k2', 2_000, 1, 2_000, 'default');

      expect(refused.isBlocked).toBe(true);
      // One second left of two, not two: the number the client renders is the
      // real remaining window.
      expect(refused.timeToExpire).toBe(1);
      expect(refused.timeToBlockExpire).toBe(1);
    });

    it('opens a new window once the old one expires', async () => {
      const store = storage();

      await store.increment('k3', 1_000, 1, 1_000, 'default');
      await sleep(1_200);
      const afterExpiry = await store.increment('k3', 1_000, 1, 1_000, 'default');

      expect(afterExpiry.isBlocked).toBe(false);
      expect(afterExpiry.totalHits).toBe(1);
    });

    it('does not let a busy caller extend its own window', async () => {
      const store = storage();

      await store.increment('k4', 1_500, 10, 1_500, 'default');
      await sleep(600);
      await store.increment('k4', 1_500, 10, 1_500, 'default');
      await sleep(600);
      const third = await store.increment('k4', 1_500, 10, 1_500, 'default');

      // A fixed window: only the request that opened it set the expiry, so the
      // remainder keeps falling rather than resetting on every hit.
      expect(third.timeToExpire).toBeLessThanOrEqual(1);
    });

    it('honours a block that outlasts the window', async () => {
      const store = storage();

      await store.increment('k5', 1_000, 1, 10_000, 'default');
      const refused = await store.increment('k5', 1_000, 1, 10_000, 'default');
      expect(refused.timeToBlockExpire).toBe(10);

      await sleep(1_200);
      // The window is gone, the explicit block is not.
      const stillRefused = await store.increment('k5', 1_000, 1, 10_000, 'default');
      expect(stillRefused.isBlocked).toBe(true);
    });
  });

  describe('the JetStream dedupe window', () => {
    it('lets exactly one caller claim an event id', async () => {
      const key = 'dedupe:event:e-integration';

      const first = await service.client.set(key, 1, 'EX', 300, 'NX');
      const second = await service.client.set(key, 1, 'EX', 300, 'NX');

      expect(first).toBe('OK');
      // `null` is what tells the second pod it is holding a redelivery.
      expect(second).toBeNull();
    });

    it('expires the claim, so the window is a span of time', async () => {
      const key = 'dedupe:event:e-short';

      await service.client.set(key, 1, 'EX', 1, 'NX');
      await sleep(1_200);

      expect(await service.client.set(key, 1, 'EX', 1, 'NX')).toBe('OK');
    });
  });

  describe('presence liveness', () => {
    it('prunes by score, so one dead member goes and a live one stays', async () => {
      const key = 'presence:zone:z-int';
      const now = Date.now();

      await service.client.zadd(key, now, 'user-live:s1');
      await service.client.zadd(key, now - 120_000, 'user-dead:s2');

      const removed = await service.client.zremrangebyscore(
        key,
        0,
        now - 90_000
      );

      expect(removed).toBe(1);
      expect(await service.client.zrange(key, 0, -1)).toEqual(['user-live:s1']);
    });

    it('refreshes a member in place rather than adding a second entry', async () => {
      const key = 'presence:zone:z-int2';

      await service.client.zadd(key, 1_000, 'user-a:s1');
      await service.client.zadd(key, 2_000, 'user-a:s1');

      // A heartbeat re scores; it must not duplicate the member.
      expect(await service.client.zrange(key, 0, -1)).toEqual(['user-a:s1']);
      expect(await service.client.zscore(key, 'user-a:s1')).toBe('2000');
    });
  });

  describe('the access cache window', () => {
    it('does not extend an existing expiry, so a stale answer cannot live on', async () => {
      const key = 'access:zone:z-int';

      await service.client.hset(key, 'u1', '1');
      await service.client.expire(key, 60, 'NX');
      await sleep(1_100);

      await service.client.hset(key, 'u2', '1');
      const declined = await service.client.expire(key, 60, 'NX');

      // 0 means Redis refused to reset the clock, which is the whole reason the
      // write uses NX: a busy zone must not hold an entry past its window.
      expect(declined).toBe(0);
      expect(await service.client.ttl(key)).toBeLessThan(60);
    });

    it('drops every user of a zone in one DEL', async () => {
      await service.client.hset('access:zone:z-kick', 'u1', '1');
      await service.client.hset('access:zone:z-kick', 'u2', '1');
      await service.client.hset('access:zonestaff:z-kick', 'u1', '0');

      await service.client.del('access:zone:z-kick', 'access:zonestaff:z-kick');

      // This is why the cache is a hash per resource rather than a key per pair:
      // an invalidation is one command on a key the event already names.
      expect(await service.client.hgetall('access:zone:z-kick')).toEqual({});
      expect(await service.client.hgetall('access:zonestaff:z-kick')).toEqual({});
    });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await sleep(20);
  }
  throw new Error('condition was not met in time');
}
