import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ADMIN_DASHBOARD_RECENT_RUN_LIMIT,
  DiscoveredPlaceStatus,
  HarvestRunStatus,
  SourceEntryStatus,
  SourceLocationStatus,
  type AdminDashboardRequest,
  type AdminHarvestDashboard,
  type HarvestRunView,
} from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import {
  DiscoveredPlace,
  HarvestRun,
  SourceCatalogEntry,
  SourceLocation,
  SupermarketSource,
} from '../entities';
import { toHarvestRunView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';

/**
 * The harvester's block of the back office dashboard (plan 0088, section 3.4).
 *
 * There is no activity feed here, and that is not an omission. The harvester has
 * no audit table: what it changes, it changes in catalog through
 * `CatalogClient`, attributed to the service actor, and those rows are in
 * catalog's trail.
 *
 * The queues are reported per chain because the queue screens are per chain. A
 * count summed over the chains would link nowhere, so the chain is named by id
 * and the screen resolves the name through the supermarket reference it already
 * holds, exactly as the sources screen does.
 */
@Injectable()
export class HarvestDashboardService {
  constructor(
    @InjectRepository(HarvestRun) private readonly runs: Repository<HarvestRun>,
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    @InjectRepository(DiscoveredPlace)
    private readonly places: Repository<DiscoveredPlace>,
    @InjectRepository(SourceLocation)
    private readonly shops: Repository<SourceLocation>,
    @InjectRepository(SupermarketSource)
    private readonly sources: Repository<SupermarketSource>,
    private readonly gate: PlatformAdminService
  ) {}

  async dashboard(req: AdminDashboardRequest): Promise<AdminHarvestDashboard> {
    await this.gate.requireAdmin(req);

    // Every chain the harvester knows, read once: both queues are reported per
    // chain and both need the same list, including the chains whose queue is
    // empty, so that one emptying does not make the chain vanish.
    const chains = await this.chainIds();

    const [
      byStatus,
      inWindow,
      running,
      recent,
      entries,
      placesQueued,
      shops,
      sources,
    ] = await Promise.all([
      this.runsByStatus(),
      this.runsInWindow(req),
      this.runInFlight(),
      this.recentRuns(),
      this.entryQueues(chains),
      this.places.count({ where: { status: DiscoveredPlaceStatus.NEW } }),
      this.shopQueues(chains),
      this.countSources(),
    ]);

    return {
      runs: { byStatus, inWindow },
      running,
      recent,
      queues: { entries, places: placesQueued, shops },
      sources,
    };
  }

  /**
   * How many runs ended each way, over all time.
   *
   * Every status in the enum is returned, in enum order, even at zero: the chart
   * that draws this assigns colours by position, so a bar that appears only once
   * something has failed would recolour the whole chart the day it does.
   */
  private async runsByStatus(): Promise<
    AdminHarvestDashboard['runs']['byStatus']
  > {
    const rows = await this.runs
      .createQueryBuilder('r')
      .select('r.status', 'status')
      .addSelect('count(*)::int', 'count')
      .groupBy('r.status')
      .getRawMany<{ status: HarvestRunStatus; count: number }>();

    const counted = new Map(rows.map((row) => [row.status, row.count]));
    return Object.values(HarvestRunStatus).map((status) => ({
      status,
      count: counted.get(status) ?? 0,
    }));
  }

  /**
   * Runs requested inside the window.
   *
   * Only a lower bound, because the window ends today and a run cannot be
   * requested after now.
   */
  private runsInWindow(req: AdminDashboardRequest): Promise<number> {
    return this.runs
      .createQueryBuilder('r')
      .where(`r."requestedAt" >= :from::timestamptz`, {
        from: `${req.window.from}T00:00:00Z`,
      })
      .getCount();
  }

  /**
   * The run in flight: `RUNNING`, else `PENDING`, the most recently requested.
   *
   * Asked in that order rather than as one query over both statuses, because a
   * running run always outranks a queued one and an ordering expression that
   * says so is harder to read than asking twice. A harvester with nothing to do
   * answers null, which is the ordinary state of a cluster: no storefront is
   * enabled in either.
   */
  private async runInFlight(): Promise<HarvestRunView | null> {
    for (const status of [HarvestRunStatus.RUNNING, HarvestRunStatus.PENDING]) {
      const row = await this.runs.findOne({
        where: { status },
        order: { requestedAt: 'DESC', id: 'DESC' },
      });
      if (row) {
        return toHarvestRunView(row);
      }
    }
    return null;
  }

  /** The most recently requested runs, newest first, whatever their status. */
  private async recentRuns(): Promise<HarvestRunView[]> {
    const rows = await this.runs.find({
      order: { requestedAt: 'DESC', id: 'DESC' },
      take: ADMIN_DASHBOARD_RECENT_RUN_LIMIT,
    });
    return rows.map(toHarvestRunView);
  }

  /**
   * The product queue per chain: what a run proposed, and what it could not.
   *
   * `CANDIDATE` and `UNRESOLVED` are the two statuses waiting for a person, and
   * neither writes a price. Every chain with a `supermarket_sources` row is
   * present, in `supermarketId` order, even at zero, so a queue emptying does
   * not make its chain vanish from the screen.
   */
  private async entryQueues(
    chains: readonly string[]
  ): Promise<AdminHarvestDashboard['queues']['entries']> {
    const rows = await this.entries
      .createQueryBuilder('e')
      .select('e."supermarketId"', 'supermarketId')
      .addSelect(
        `count(*) FILTER (WHERE e.status = :candidate)::int`,
        'candidate'
      )
      .addSelect(
        `count(*) FILTER (WHERE e.status = :unresolved)::int`,
        'unresolved'
      )
      .where('e.status IN (:...queued)', {
        queued: [SourceEntryStatus.CANDIDATE, SourceEntryStatus.UNRESOLVED],
      })
      .setParameters({
        candidate: SourceEntryStatus.CANDIDATE,
        unresolved: SourceEntryStatus.UNRESOLVED,
      })
      .groupBy('1')
      .getRawMany<{
        supermarketId: string;
        candidate: number;
        unresolved: number;
      }>();

    const counted = new Map(rows.map((row) => [row.supermarketId, row]));

    return chains.map((supermarketId) => ({
      supermarketId,
      candidate: counted.get(supermarketId)?.candidate ?? 0,
      unresolved: counted.get(supermarketId)?.unresolved ?? 0,
    }));
  }

  /** The shop queue per chain: places a run saw and nobody has mapped. */
  private async shopQueues(
    chains: readonly string[]
  ): Promise<AdminHarvestDashboard['queues']['shops']> {
    const rows = await this.shops
      .createQueryBuilder('l')
      .select('l."supermarketId"', 'supermarketId')
      .addSelect('count(*)::int', 'unmapped')
      .where('l.status = :unmapped', {
        unmapped: SourceLocationStatus.UNMAPPED,
      })
      .groupBy('1')
      .getRawMany<{ supermarketId: string; unmapped: number }>();

    const counted = new Map(
      rows.map((row) => [row.supermarketId, row.unmapped])
    );

    return chains.map((supermarketId) => ({
      supermarketId,
      unmapped: counted.get(supermarketId) ?? 0,
    }));
  }

  /** Every chain the harvester knows, in id order, whether or not it is enabled. */
  private async chainIds(): Promise<string[]> {
    const rows = await this.sources.find({
      select: { supermarketId: true },
      order: { supermarketId: 'ASC' },
    });
    return rows.map((row) => row.supermarketId);
  }

  private async countSources(): Promise<AdminHarvestDashboard['sources']> {
    const [total, enabled] = await Promise.all([
      this.sources.count(),
      this.sources.count({ where: { enabled: true } }),
    ]);
    return { total, enabled };
  }
}
