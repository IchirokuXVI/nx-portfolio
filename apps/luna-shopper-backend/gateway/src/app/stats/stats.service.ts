import { Injectable } from '@nestjs/common';
import {
  STATS_PATTERNS,
  type CoreStats,
  type IdentityStats,
  type PlatformStatsResponse,
} from '@portfolio/luna-shopper/contracts';
import { NatsClient } from '../messaging/nats-client';

/** How long one snapshot serves every visitor (plan 0017, section 8.2). */
export const STATS_CACHE_TTL_MS = 60_000;

/**
 * The platform totals the public landing figure reads (plan 0017, section 8.2).
 *
 * Two guards, because this is the only unauthenticated read in the API. The
 * first is here: an in memory, single entry, 60 second cache, so a burst of a
 * thousand visitors produces one pair of NATS calls per minute rather than a
 * thousand. `measuredAt` reports when the snapshot was taken, so staleness is
 * visible rather than hidden. The second guard is the named throttler bucket on
 * the controller.
 *
 * The fan out is parallel and each half degrades on its own: if auth does not
 * answer, its block is `null` and core's still renders. A broken auth service
 * must not take down a public page.
 */
@Injectable()
export class GatewayStatsService {
  private cached?: PlatformStatsResponse;
  private cachedAt = 0;

  constructor(private readonly nats: NatsClient) {}

  async platform(): Promise<PlatformStatsResponse> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < STATS_CACHE_TTL_MS) {
      return this.cached;
    }

    const [identity, core] = await Promise.all([
      this.ask<IdentityStats>(STATS_PATTERNS.identity),
      this.ask<CoreStats>(STATS_PATTERNS.core),
    ]);

    const response: PlatformStatsResponse = {
      identity,
      core,
      measuredAt: new Date(now).toISOString(),
    };
    this.cached = response;
    this.cachedAt = now;
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
