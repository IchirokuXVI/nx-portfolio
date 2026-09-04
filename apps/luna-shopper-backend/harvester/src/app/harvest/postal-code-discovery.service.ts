import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type ListPostalCodeDiscoveryRequestsRequest,
  type PostalCodeDiscoveryRequestPage,
  type PostalCodesAddedEvent,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
} from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../config/app-config';
import { CatalogClient } from './catalog-client.service';
import { toPostalCodeDiscoveryRequestView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeDiscoveryStore } from './postal-code-discovery.store';

interface QueueCursor {
  value: string;
  id: string;
}

/**
 * The consumer of core's `postalCode.added` (plan 0063).
 *
 * A code lands on somebody's profile, catalog holds no shops in it, and the code
 * is queued for a `STORE_DISCOVERY` run. This class does the deciding and the
 * queueing; {@link PostalCodeDiscoveryWorker} does the running, and they are
 * separate because the queue must fill whether or not anything is draining it.
 *
 * **`HARVEST_ENABLED` does not gate this half** (section 6). With the switch
 * false the queue still fills and nothing drains, which is the desired behaviour
 * rather than a compromise: turning the switch on later drains a real backlog of
 * the codes users actually asked about, instead of starting from nothing.
 *
 * Nothing here is reachable by a user. The enqueue path is an event handler and
 * has no request, and the one read is platform admin gated like the rest of the
 * harvester's surface.
 */
@Injectable()
export class PostalCodeDiscoveryService {
  private readonly logger = new Logger(PostalCodeDiscoveryService.name);

  constructor(
    private readonly store: PostalCodeDiscoveryStore,
    private readonly catalog: CatalogClient,
    private readonly admin: PlatformAdminService,
    private readonly config: ConfigService
  ) {}

  private settings(): HarvesterConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester');
  }

  /**
   * Consider the codes one profile write announced.
   *
   * **This throws nothing at its caller.** It is driven by an event core emits
   * fire and forget after a profile save commits, so there is nobody to return
   * an error to and a failure here must not look like a failure of anything
   * else. A code that could not be considered is logged and lost, and the next
   * profile write in that postcode announces it again.
   */
  async considerAnnounced(event: PostalCodesAddedEvent): Promise<void> {
    const country = (event.country ?? '').trim().toLowerCase();
    const codes = [
      ...new Set(
        (event.postalCodes ?? []).map((code) => code.trim()).filter(Boolean)
      ),
    ];
    if (!country || codes.length === 0) {
      return;
    }

    try {
      const unknown = await this.unknownOf(country, codes);
      if (unknown.length === 0) {
        return;
      }
      let queued = 0;
      for (const postalCode of unknown) {
        if (
          await this.store.enqueue(
            country,
            postalCode,
            this.settings().discoveryCooldownDays
          )
        ) {
          queued += 1;
        }
      }
      if (queued > 0) {
        this.logger.log(
          `Queued ${queued} postal code(s) in ${country} for store discovery: ` +
            unknown.join(', ')
        );
      }
    } catch (error) {
      this.logger.error(
        `Could not consider announced postal codes ${codes.join(', ')} in ` +
          `${country}: ${String(error)}`
      );
    }
  }

  /**
   * Which of these codes catalog holds no shops in (section 5).
   *
   * Counting `SupermarketLocation` rows whose `postalCode` matches, asked of
   * catalog over NATS in one round trip. The count is only meaningful after plan
   * 0061, which is what stopped two thirds of imported locations having a null
   * postcode; before it almost every code looked unknown and this queue would
   * have re discovered the country.
   *
   * A code stays unknown for a long time afterwards, and that is correct: a
   * discovery run creates no catalog location, so a code becomes known only when
   * an admin imports a place from the review queue.
   */
  private async unknownOf(
    country: string,
    postalCodes: string[]
  ): Promise<string[]> {
    const view = await this.catalog.countLocationsByPostalCode(
      country,
      postalCodes
    );
    return view.counts
      .filter((count) => count.locations === 0)
      .map((count) => count.postalCode);
  }

  /**
   * The queue's own rows (section 8), for backlog 0009 to render.
   *
   * Defined and left unconsumed on purpose: stating the shape beside the queue
   * that produces it is cheaper than retrofitting it afterwards.
   */
  async list(
    req: ListPostalCodeDiscoveryRequestsRequest
  ): Promise<PostalCodeDiscoveryRequestPage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as QueueCursor | undefined;

    const qb = this.store
      .repository()
      .createQueryBuilder('q')
      .orderBy('q.requestedAt', 'DESC')
      .addOrderBy('q.id', 'DESC')
      .take(limit + 1);
    if (req.country) {
      qb.andWhere('q.country = :country', {
        country: req.country.trim().toLowerCase(),
      });
    }
    if (req.status) {
      qb.andWhere('q.status = :status', { status: req.status });
    }
    if (cursor) {
      qb.andWhere('(q."requestedAt", q.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toPostalCodeDiscoveryRequestView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.requestedAt.toISOString(), id: last.id })
          : null,
    };
  }
}
