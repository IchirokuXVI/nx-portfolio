import { Injectable } from '@nestjs/common';
import {
  STATS_PATTERNS,
  type CoreStats,
  type IdentityStats,
  type PlatformStatsResponse,
} from '@portfolio/luna-shopper/contracts';
import { RedisService } from '@portfolio/luna-shopper/platform';
import { NatsClient } from '../messaging/nats-client';

/** How long one snapshot serves every visitor (plan 0017, section 8.2). */
export const STATS_CACHE_TTL_MS = 60_000;

/** The shared entry. One key, because there is one public snapshot. */
export const STATS_CACHE_KEY = 'stats:platform';

/**
 * The platform totals the public landing figure reads (plan 0017, section 8.2).
 *
 * Two guards, because this is the only unauthenticated read in the API. The
 * first is here: a single entry, 60 second cache, so a burst of a thousand
 * visitors produces one pair of NATS calls per minute rather than a thousand.
 * `measuredAt` reports when the snapshot was taken, so staleness is visible
 * rather than hidden. The second guard is the named throttler bucket on the
 * controller.
 *
 * The entry lives in Redis as of plan 0028, section 2.7, which makes the cache
 * shared: N replicas make one origin call a minute between them instead of N.
 * That is the whole of the change. `measuredAt` keeps meaning exactly what it
 * meant, and it is what makes a shared cache safe to read: a client can always
 * see how old the snapshot it was handed is.
 *
 * The fan out is parallel and each half degrades on its own: if auth does not
 * answer, its block is `null` and core's still renders. A broken auth service
 * must not take down a public page. Redis is the third thing that may be absent,
 * and it degrades the same way: a cache that cannot be read is a miss, and a
 * miss goes to the origin (section 5).
 */
@Injectable()
export class GatewayStatsService {
  constructor(
    private readonly nats: NatsClient,
    private readonly redis: RedisService
  ) {}

  async platform(): Promise<PlatformStatsResponse> {
    const cached = await this.redis.tryCommand(
      (client) => client.get(STATS_CACHE_KEY),
      'stats read'
    );

    if (cached) {
      try {
        return JSON.parse(cached) as PlatformStatsResponse;
      } catch {
        // An unreadable entry is a miss. Falling through rather than throwing
        // keeps a bad write from making a public page permanently 500.
      }
    }

    const now = Date.now();
    const [identity, core] = await Promise.all([
      this.ask<IdentityStats>(STATS_PATTERNS.identity),
      this.ask<CoreStats>(STATS_PATTERNS.core),
    ]);

    const response: PlatformStatsResponse = {
      identity,
      core,
      measuredAt: new Date(now).toISOString(),
    };

    // `PX` rather than a bare SET: the entry expires on its own, so there is no
    // timestamp comparison here and no way for the stored value and the window
    // to disagree. Two replicas racing to fill it write the same shape, and the
    // loser's snapshot is at most a moment older.
    await this.redis.tryCommand(
      (client) =>
        client.set(
          STATS_CACHE_KEY,
          JSON.stringify(response),
          'PX',
          STATS_CACHE_TTL_MS
        ),
      'stats write'
    );

    return response;
  }

  /** One downstream block, or `null` when that service did not answer. */
  private async ask<T>(subject: string): Promise<T | null> {
    try {
      return await this.nats.send<T>(subject, {});
    } catch {
      return null;
    }
  }
}
