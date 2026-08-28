import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';
import { RedisService } from '../redis/redis.service';

/**
 * What `ThrottlerStorage.increment` answers with.
 *
 * Declared here rather than imported: `@nestjs/throttler`'s barrel re exports
 * only `throttler-storage.interface`, so the record type is reachable only
 * through a `dist/` path, and reaching into a package's build output is how a
 * patch release breaks a build. The shape is structural, so an object matching
 * it satisfies the interface exactly.
 *
 * Both times are in **whole seconds**, while the `ttl` and `blockDuration`
 * arguments arrive in milliseconds. That asymmetry is the library's, and it is
 * the single easiest thing to get wrong in this file.
 */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * The counter and the block, evaluated together in one round trip.
 *
 * It has to be a script rather than a pipeline: read, decide, write from the
 * application would let two pods interleave between the read and the write and
 * both conclude they were the first request of the window, which is the exact
 * defect a shared counter exists to remove.
 *
 * Returned as `{ hits, windowMs, blocked, blockMs }`.
 *
 * The one judgement in here is what to do when a caller goes over the limit. The
 * window already refuses every further request until it expires, so a *separate*
 * block is only meaningful when `blockDuration` is configured **longer than the
 * window**. When it is not, which is every bucket this repo configures (nothing
 * sets `blockDuration`, so it defaults to the ttl), the remaining window is
 * reported as the wait instead of a freshly minted full one.
 *
 * That is what makes the countdown honest: a caller refused forty seconds into a
 * sixty second window is told twenty, not sixty. `identity.service.ts` renders
 * the same number from `throttleWaitSeconds`, and plan 0028's exit criteria ask
 * for exactly this.
 */
const INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttlMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockMs = tonumber(ARGV[3])

-- An explicit block outlasting the window refuses without touching the counter,
-- mirroring the in memory storage, which stops counting hits while blocked.
local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  local blockedHits = tonumber(redis.call('GET', hitsKey)) or (limit + 1)
  local blockedWindow = redis.call('PTTL', hitsKey)
  if blockedWindow < 0 then
    blockedWindow = 0
  end
  return {blockedHits, blockedWindow, 1, blockTtl}
end

local hits = redis.call('INCR', hitsKey)
-- Only the request that opens the window sets its expiry, which is what makes
-- this a fixed window rather than one a busy caller can extend indefinitely.
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttlMs)
end

local windowMs = redis.call('PTTL', hitsKey)
if windowMs < 0 then
  -- The key exists with no expiry, which should not happen; repair it rather
  -- than leak a counter that would refuse this caller forever.
  redis.call('PEXPIRE', hitsKey, ttlMs)
  windowMs = ttlMs
end

if hits > limit then
  -- Compared against the CONFIGURED window, not the remaining one. A refusal
  -- normally lands partway through a window, so the remainder is almost always
  -- smaller than blockDuration; comparing against it would mint a fresh full
  -- block on nearly every refusal and hand the caller a countdown longer than
  -- the window it is actually waiting on.
  if blockMs > ttlMs then
    redis.call('SET', blockKey, 1, 'PX', blockMs)
    return {hits, windowMs, 1, blockMs}
  end
  return {hits, windowMs, 1, windowMs}
end

return {hits, windowMs, 0, 0}
`;

/** Namespace, so a FLUSH of the throttle keys cannot touch presence or a cache. */
const HITS_PREFIX = 'throttle:hits';
const BLOCK_PREFIX = 'throttle:block';

/** Milliseconds in, whole seconds out: what the guard and its headers expect. */
function toSeconds(milliseconds: number): number {
  return Math.ceil(Math.max(milliseconds, 0) / 1000);
}

/**
 * Rate limit counters in Redis (plan 0028, section 2.4).
 *
 * The library's in memory storage gives each replica its own counter, so two
 * gateway pods behind one Service double every limit. That is a tuning annoyance
 * for the default bucket at 120 a minute and a real defect for `verifyResend`
 * and `passwordReset`, which are `limit: 1` and whose entire enforcement is the
 * bucket.
 *
 * `ProblemThrottlerGuard` is unchanged and needs to be: it reads `timeToExpire`
 * and `timeToBlockExpire` off whatever storage is configured, so it is storage
 * agnostic by construction.
 *
 * **This fails closed** (plan 0028, section 5), which is the one deliberate
 * departure from every other Redis caller in the codebase. The throttler
 * package's own instinct on a storage error is to let the request through, and
 * that turns a Redis outage into an open registration and password reset
 * endpoint. A refusal is a bad minute for honest callers; an open reset endpoint
 * is a security incident, so the outage answers 429 rather than 200.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: Logger
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `${HITS_PREFIX}:${throttlerName}:${key}`;
    const blockKey = `${BLOCK_PREFIX}:${throttlerName}:${key}`;

    try {
      const [hits, windowMs, blocked, blockMs] = (await this.redis.client.eval(
        INCREMENT_SCRIPT,
        2,
        hitsKey,
        blockKey,
        String(ttl),
        String(limit),
        String(blockDuration)
      )) as [number, number, number, number];

      return {
        totalHits: hits,
        timeToExpire: toSeconds(windowMs),
        isBlocked: blocked === 1,
        timeToBlockExpire: toSeconds(blockMs),
      };
    } catch (err) {
      this.logger.error(
        { err, throttlerName },
        'redis throttler storage failed, refusing the request'
      );

      // Fail closed. `isBlocked` is what the guard reads to refuse, and the wait
      // handed back is the bucket's own ttl: it is the only honest answer with
      // no counter to read, and it is never longer than the real window.
      return {
        totalHits: limit + 1,
        timeToExpire: toSeconds(ttl),
        isBlocked: true,
        timeToBlockExpire: toSeconds(ttl),
      };
    }
  }
}
