import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DiscoveredPlaceStatus,
  PostalCodeDiscoveryStatus,
  type AddPostalCodeDiscoveryRequest,
  type AdminCredential,
  type DiscoveredPlaceCounts,
  type ListPostalCodeDiscoveryRequestsRequest,
  type PostalCodeDiscoveryIdRequest,
  type PostalCodeDiscoveryRequestPage,
  type PostalCodeDiscoveryRequestView,
  type PostalCodeDiscoverySummaryView,
  type PostalCodesAddedEvent,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  PostalCodeUnknownException,
  RunInProgressException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { DiscoveredPlace, PostalCodeDiscoveryRequest } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { toPostalCodeDiscoveryRequestView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeDiscoveryStore } from './postal-code-discovery.store';

interface QueueCursor {
  value: string;
  id: string;
}

/** One `(country, postalCode)` pair's four numbers, keyed by that pair. */
type CountsByCode = Map<string, DiscoveredPlaceCounts>;

const codeKey = (country: string, postalCode: string): string =>
  `${country}/${postalCode}`;

const noCounts = (): DiscoveredPlaceCounts => ({
  total: 0,
  imported: 0,
  rejected: 0,
  undecided: 0,
});

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
    @InjectRepository(DiscoveredPlace)
    private readonly places: Repository<DiscoveredPlace>,
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
   * The queue's own rows, which plan 0063 defined and left unconsumed and plan
   * 0097 gives a screen.
   *
   * **The order is `requestedAt` descending, and it is not by demand.** Sorting
   * by the number of profiles waiting would mean core's counts inside the
   * harvester's `ORDER BY`, which is the join plan 0074 section 3 says does not
   * exist and never will. Demand is a decoration on a page of rows, so it can be
   * shown and not sorted on.
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
    // A prefix rather than a contains match, exactly as catalog's own postal
    // code listing does it: a code is read left to right, so "140" means Córdoba
    // city rather than every code with a 140 in the middle of it. The gateway
    // DTO is what keeps a `%` out of here.
    if (req.postalCode) {
      qb.andWhere('q."postalCode" LIKE :prefix', {
        prefix: `${req.postalCode.trim()}%`,
      });
    }
    // Absent means the working set, which is the undismissed rows (section 7).
    // True lists the dismissed ones alone, so an operator can find one to undo.
    qb.andWhere('q.dismissed = :dismissed', {
      dismissed: req.dismissed === true,
    });
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
      items: await this.decorate(page),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.requestedAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * The queue at a glance (section 7.1).
   *
   * `draining` is why this is a subject rather than three counts on a screen. A
   * queue that fills and never empties is the designed behaviour of a cluster
   * with `HARVEST_ENABLED` false, and an operator pressing "discover again"
   * there deserves to be told so instead of watching a row sit at `QUEUED` for a
   * week.
   */
  async summary(req: AdminCredential): Promise<PostalCodeDiscoverySummaryView> {
    await this.admin.requireAdmin(req);
    const { byStatus, oldestQueuedAt } = await this.store.summarize();
    return {
      queued: byStatus[PostalCodeDiscoveryStatus.QUEUED],
      running: byStatus[PostalCodeDiscoveryStatus.RUNNING],
      done: byStatus[PostalCodeDiscoveryStatus.DONE],
      failed: byStatus[PostalCodeDiscoveryStatus.FAILED],
      parked: byStatus[PostalCodeDiscoveryStatus.PARKED],
      oldestQueuedAt: oldestQueuedAt ? oldestQueuedAt.toISOString() : null,
      draining: this.settings().harvestEnabled,
    };
  }

  /**
   * An operator adds one code (section 6.1).
   *
   * **A code catalog does not hold is refused.** The centroid table is the whole
   * national list, so a code missing from it is a typo, and accepting it would
   * buy four failed Nominatim attempts and a `FAILED` row that reads like an
   * outage. Catalog is asked once, and before anything is written.
   */
  async add(
    req: AddPostalCodeDiscoveryRequest
  ): Promise<PostalCodeDiscoveryRequestView> {
    await this.admin.requireAdmin(req);
    const country = (req.country ?? '').trim().toLowerCase();
    const postalCode = (req.postalCode ?? '').trim();
    if (!(await this.catalogHolds(country, postalCode))) {
      throw new PostalCodeUnknownException(
        `We hold no postal code ${postalCode} in ${country}, so it is ` +
          'probably a typo.'
      );
    }
    const row = await this.store.add(country, postalCode, req.discoverNow);
    return this.one(row);
  }

  /**
   * Discover it again, ignoring the cooldown (section 6.2).
   *
   * Refused on a `RUNNING` row: that row has a run against it, and clearing the
   * attempt count of an attempt still in progress is not something to do
   * quietly. **It queues, and it does not run**, because the queue drains
   * serially and the active run index allows one run at a time, so the honest
   * answer is that the row is waiting.
   */
  async requeue(
    req: PostalCodeDiscoveryIdRequest
  ): Promise<PostalCodeDiscoveryRequestView> {
    await this.admin.requireAdmin(req);
    const row = await this.store.byId(req.requestId);
    if (row.status === PostalCodeDiscoveryStatus.RUNNING) {
      throw new RunInProgressException(
        `Postal code ${row.country}/${row.postalCode} is being discovered ` +
          'right now, so it cannot be queued again yet.'
      );
    }
    await this.store.requeue(row);
    return this.one(await this.store.byId(row.id));
  }

  /**
   * Hide a failed code from the working set (section 6.3).
   *
   * **Nothing is deleted.** The row is the record that we looked and what
   * happened, so it stays in the table, leaves the default listing, and comes
   * back when a requeue clears the flag.
   */
  async dismiss(
    req: PostalCodeDiscoveryIdRequest
  ): Promise<PostalCodeDiscoveryRequestView> {
    await this.admin.requireAdmin(req);
    const row = await this.store.byId(req.requestId);
    await this.store.setDismissed(row.id, true);
    return this.one(await this.store.byId(row.id));
  }

  /**
   * Does catalog's shipped centroid table hold this code at all?
   *
   * `nearby` is asked rather than a read of its own, because `known` is exactly
   * this question and catalog already publishes it. The radius is zero: the
   * neighbours are not wanted here, only the flag.
   */
  private async catalogHolds(
    country: string,
    postalCode: string
  ): Promise<boolean> {
    if (!country || !postalCode) {
      return false;
    }
    const view = await this.catalog.nearbyPostalCodes(country, postalCode, 0);
    return view.known;
  }

  private async one(
    row: PostalCodeDiscoveryRequest
  ): Promise<PostalCodeDiscoveryRequestView> {
    const [view] = await this.decorate([row]);
    return view;
  }

  /**
   * The four counts, twice, for a page of rows (section 2).
   *
   * Two grouped queries for the whole page rather than two per row, and they
   * answer different questions on purpose:
   *
   * - **found by its runs** counts the work a code caused. A run centred on
   *   14013 with a 3 km radius returns places in four other postcodes, and every
   *   one of them is this code's doing.
   * - **located in it** counts what somebody living in the code would be shown,
   *   whichever run found them.
   *
   * Six numbers on a row is more than a table wants, and one number that
   * silently means one of two things is worse.
   */
  private async decorate(
    rows: PostalCodeDiscoveryRequest[]
  ): Promise<PostalCodeDiscoveryRequestView[]> {
    if (rows.length === 0) {
      return [];
    }
    const countries = [...new Set(rows.map((row) => row.country))];
    const codes = [...new Set(rows.map((row) => row.postalCode))];
    const [found, located] = await Promise.all([
      this.countFoundByItsRuns(countries, codes),
      this.countLocatedIn(countries, codes),
    ]);
    return rows.map((row) => {
      const key = codeKey(row.country, row.postalCode);
      return {
        ...toPostalCodeDiscoveryRequestView(row),
        foundByItsRuns: found.get(key) ?? noCounts(),
        locatedInIt: located.get(key) ?? noCounts(),
      };
    });
  }

  /**
   * Places written by a run **of** this code, wherever they turned out to be.
   *
   * A run's own code is in its `input`, where `StoreDiscoveryInput` put it, so
   * this joins through `harvest_runs` rather than reading a column on the place.
   * The queue row's `runId` is only the **last** run, and a code discovered
   * twice caused both.
   */
  private async countFoundByItsRuns(
    countries: string[],
    postalCodes: string[]
  ): Promise<CountsByCode> {
    const rows: CountRow[] = await this.places.query(
      `SELECT lower(r."input"->>'country') AS "country",
              r."input"->>'postalCode'     AS "postalCode",
              p."status"                   AS "status",
              COUNT(*)::text               AS "count"
         FROM "discovered_places" AS p
         JOIN "harvest_runs" AS r ON r."id" = p."runId"
        WHERE r."mode" = 'STORE_DISCOVERY'
          AND lower(r."input"->>'country') = ANY($1::text[])
          AND r."input"->>'postalCode' = ANY($2::text[])
        GROUP BY 1, 2, 3`,
      [countries, postalCodes]
    );
    return foldCounts(rows);
  }

  /** Places whose own postal code is this one, whichever run found them. */
  private async countLocatedIn(
    countries: string[],
    postalCodes: string[]
  ): Promise<CountsByCode> {
    const rows: CountRow[] = await this.places.query(
      `SELECT lower(p."country") AS "country",
              p."postalCode"     AS "postalCode",
              p."status"         AS "status",
              COUNT(*)::text     AS "count"
         FROM "discovered_places" AS p
        WHERE lower(p."country") = ANY($1::text[])
          AND p."postalCode" = ANY($2::text[])
        GROUP BY 1, 2, 3`,
      [countries, postalCodes]
    );
    return foldCounts(rows);
  }
}

interface CountRow {
  country: string | null;
  postalCode: string | null;
  status: DiscoveredPlaceStatus;
  count: string;
}

/**
 * One grouped result set into four numbers per code.
 *
 * Both queries ask for every country of the page against every code of it, so
 * the result can carry pairs nobody asked about. They are kept rather than
 * filtered: the caller looks its own pairs up by key, and a pair it does not
 * hold is never read.
 */
function foldCounts(rows: CountRow[]): CountsByCode {
  const counts: CountsByCode = new Map();
  for (const row of rows) {
    if (!row.country || !row.postalCode) {
      continue;
    }
    const key = codeKey(row.country, row.postalCode);
    const entry = counts.get(key) ?? noCounts();
    const found = Number(row.count);
    entry.total += found;
    if (row.status === DiscoveredPlaceStatus.IMPORTED) {
      entry.imported += found;
    } else if (row.status === DiscoveredPlaceStatus.REJECTED) {
      entry.rejected += found;
    } else {
      entry.undecided += found;
    }
    counts.set(key, entry);
  }
  return counts;
}
