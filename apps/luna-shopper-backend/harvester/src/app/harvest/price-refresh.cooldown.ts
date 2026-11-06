import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RateLimitedException,
  RedisService,
  RETRY_AFTER_SECONDS_DETAIL,
} from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../config/app-config';

/** The wait a refusal states when Redis cannot answer (section 5). */
export const REDIS_DOWN_RETRY_SECONDS = 60;

/** How long a shopper who joined a refresh may read it (section 7.3). */
const VIEWER_MS = 120_000;

/** The keys of section 5, one place, so a spec and the code cannot disagree. */
export const REFRESH_KEYS = {
  chain: (supermarketId: string) => `harvest:refresh:chain:${supermarketId}`,
  product: (entryId: string, fetchScopeId: string) =>
    `harvest:refresh:product:${entryId}:${fetchScopeId}`,
  blocked: (supermarketId: string) =>
    `harvest:refresh:blocked:${supermarketId}`,
  viewer: (refreshId: string, userId: string) =>
    `harvest:refresh:viewer:${refreshId}:${userId}`,
} as const;

/** One product of one chain at one fetch scope, as the keys name it. */
export interface RefreshTarget {
  supermarketId: string;
  entryId: string;
  fetchScopeId: string;
}

/**
 * The chain and product cooldowns of plan 0216, section 5, in Redis.
 *
 * A cooldown is a rate counter of the same kind as the throttler storage and
 * the dedupe window of realtime, which plan 0028 put in Redis. It is not a
 * queue, a lock or a scheduler: a refused request is refused, never queued.
 *
 * **No claim is released.** A fetch that fails keeps the chain and the product
 * keys to their end, because releasing them turns a failing source into a loop
 * of requests.
 *
 * **Redis that cannot answer refuses every refresh**, with a 429 and 60
 * seconds, as the throttler fails: a refresh with no working cooldown is an
 * open proxy to a third party. Runs do not use this and do not notice.
 */
@Injectable()
export class PriceRefreshCooldown {
  private readonly logger = new Logger(PriceRefreshCooldown.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {}

  /**
   * Step 8 of section 7.1, in the plan's order: the blocked key is read, the
   * product key is read, the chain key is claimed with `SET NX PX`, then the
   * product key is set. A chain slot is never spent on a product that is still
   * cooling down. Throws a {@link RateLimitedException} with the remaining
   * seconds of whichever key refused.
   */
  async claim(target: RefreshTarget): Promise<void> {
    const settings = this.settings();
    let wait: number;
    try {
      wait = await this.claimOrWait(target, settings);
    } catch (error) {
      this.logger.warn(
        `Redis could not answer a refresh claim, so it is refused: ${String(error)}`
      );
      throw refused(REDIS_DOWN_RETRY_SECONDS);
    }
    if (wait > 0) {
      throw refused(wait);
    }
  }

  /**
   * The seconds until a request could pass the cooldowns, read without
   * claiming anything (section 7.2). Redis that cannot answer reads as the
   * wait a request would be refused with.
   */
  async remaining(target: RefreshTarget): Promise<number> {
    try {
      const client = this.redis.client;
      const [blocked, product, chain] = await Promise.all([
        client.pttl(REFRESH_KEYS.blocked(target.supermarketId)),
        client.pttl(REFRESH_KEYS.product(target.entryId, target.fetchScopeId)),
        client.pttl(REFRESH_KEYS.chain(target.supermarketId)),
      ]);
      return Math.max(seconds(blocked), seconds(product), seconds(chain));
    } catch {
      return REDIS_DOWN_RETRY_SECONDS;
    }
  }

  /**
   * A 403 holds every refresh of the chain off for the blocked window (section
   * 5). Best effort: a Redis that cannot take it is logged, and the chain and
   * product keys of the claim that led here still stand.
   */
  async block(supermarketId: string): Promise<void> {
    const ms = this.settings().refreshBlockedMinutes * 60_000;
    await this.redis.tryCommand(
      (client) =>
        client.set(REFRESH_KEYS.blocked(supermarketId), '1', 'PX', ms),
      'price refresh blocked key'
    );
  }

  /** A shopper joined a refresh, so may read it for two minutes (section 7.3). */
  async addViewer(refreshId: string, userId: string): Promise<void> {
    await this.redis.tryCommand(
      (client) =>
        client.set(
          REFRESH_KEYS.viewer(refreshId, userId),
          '1',
          'PX',
          VIEWER_MS
        ),
      'price refresh viewer key'
    );
  }

  /** Whether a shopper joined this refresh in the last two minutes. */
  async isViewer(refreshId: string, userId: string): Promise<boolean> {
    const held = await this.redis.tryCommand(
      (client) => client.exists(REFRESH_KEYS.viewer(refreshId, userId)),
      'price refresh viewer read'
    );
    return held === 1;
  }

  private async claimOrWait(
    target: RefreshTarget,
    settings: HarvesterConfig
  ): Promise<number> {
    const client = this.redis.client;
    const blocked = seconds(
      await client.pttl(REFRESH_KEYS.blocked(target.supermarketId))
    );
    if (blocked > 0) {
      return blocked;
    }
    const productKey = REFRESH_KEYS.product(
      target.entryId,
      target.fetchScopeId
    );
    const product = seconds(await client.pttl(productKey));
    if (product > 0) {
      return product;
    }
    const chainKey = REFRESH_KEYS.chain(target.supermarketId);
    const claimed = await client.set(
      chainKey,
      '1',
      'PX',
      settings.refreshChainSeconds * 1000,
      'NX'
    );
    if (claimed !== 'OK') {
      // Another shopper took the chain's slot. At least one second, because a
      // key that expired between the two commands still refused this request.
      return Math.max(1, seconds(await client.pttl(chainKey)));
    }
    await client.set(
      productKey,
      '1',
      'PX',
      settings.refreshProductMinutes * 60_000
    );
    return 0;
  }

  private settings(): HarvesterConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester');
  }
}

/** A `PTTL` answer as whole seconds of wait: -2 and -1 are none. */
function seconds(pttl: number): number {
  return pttl > 0 ? Math.ceil(pttl / 1000) : 0;
}

function refused(retryAfterSeconds: number): RateLimitedException {
  return new RateLimitedException(
    'This price was refreshed a moment ago. Try again shortly.',
    { details: { [RETRY_AFTER_SECONDS_DETAIL]: retryAfterSeconds } }
  );
}
