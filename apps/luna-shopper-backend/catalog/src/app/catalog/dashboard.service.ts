import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ADMIN_DASHBOARD_ACTIVITY_LIMIT,
  PriceSourceKind,
  type AdminCatalogDashboard,
  type AdminDashboardRequest,
  type AdminPricesWrittenSeries,
} from '@portfolio/luna-shopper/contracts';
import { fillDailyWindow } from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import {
  Item,
  ItemPrice,
  ProductGroup,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { PlatformAdminService } from './platform-admin.service';

/** A day of prices for one source kind, as the grouped query answers it. */
interface PriceRow {
  day: string;
  kind: PriceSourceKind;
  count: string;
}

/**
 * Catalog's block of the back office dashboard (plan 0088, section 3.3).
 *
 * Counts over catalog's own tables, no write, and one grouped query for the
 * prices chart. The gate runs first, as it does on every write path here, even
 * though these are reads: the dashboard is an operator's screen and its numbers
 * are not part of the open read surface.
 */
@Injectable()
export class CatalogDashboardService {
  constructor(
    @InjectRepository(Supermarket)
    private readonly supermarkets: Repository<Supermarket>,
    @InjectRepository(SupermarketLocation)
    private readonly locations: Repository<SupermarketLocation>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(ProductGroup)
    private readonly groups: Repository<ProductGroup>,
    @InjectRepository(SupermarketItem)
    private readonly supermarketItems: Repository<SupermarketItem>,
    @InjectRepository(ItemPrice)
    private readonly prices: Repository<ItemPrice>,
    private readonly gate: PlatformAdminService,
    private readonly audit: CatalogAuditService
  ) {}

  async dashboard(req: AdminDashboardRequest): Promise<AdminCatalogDashboard> {
    await this.gate.requireAdmin(req);

    const [
      supermarkets,
      locations,
      items,
      productGroups,
      supermarketItems,
      pricesWritten,
      activity,
    ] = await Promise.all([
      this.supermarkets.count(),
      this.locations.count(),
      this.items.count(),
      this.groups.count(),
      this.countSupermarketItems(),
      this.pricesWritten(req),
      this.audit.recent(ADMIN_DASHBOARD_ACTIVITY_LIMIT),
    ]);

    return {
      supermarkets,
      locations,
      items,
      productGroups,
      supermarketItems,
      pricesWritten,
      activity,
    };
  }

  /**
   * The per chain rows, split by what a shopper would see.
   *
   * `priced` reads the materialized `price` column rather than counting
   * `item_prices`: which source wins is decided on every read and written back
   * onto this row, so this column is the answer and the price table is the
   * evidence behind it.
   */
  private async countSupermarketItems(): Promise<
    AdminCatalogDashboard['supermarketItems']
  > {
    const row = await this.supermarketItems
      .createQueryBuilder('si')
      .select('count(*)::int', 'total')
      .addSelect(`count(*) FILTER (WHERE si.price IS NOT NULL)::int`, 'priced')
      .addSelect(`count(*) FILTER (WHERE si.stale)::int`, 'stale')
      .addSelect(`count(*) FILTER (WHERE NOT si.available)::int`, 'unavailable')
      .getRawOne<{
        total: number;
        priced: number;
        stale: number;
        unavailable: number;
      }>();

    return {
      total: row?.total ?? 0,
      priced: row?.priced ?? 0,
      stale: row?.stale ?? 0,
      unavailable: row?.unavailable ?? 0,
    };
  }

  /**
   * Prices first observed per day, one series per source kind.
   *
   * Counted on `observedAt`, never on `lastObservedAt`. A walk that confirms
   * four thousand unchanged prices touches `lastObservedAt` on four thousand
   * rows and writes nothing new, and this chart is about what was written; the
   * confirmations are counters on the run itself, in the harvest block.
   *
   * Every kind in the enum is returned, in enum order, with a full window each,
   * even when a kind has never written a price. Admin plan 0015 assigns chart
   * colours by position in a fixed order, and a series that appears only when it
   * has data would take a different colour each month.
   */
  private async pricesWritten(
    req: AdminDashboardRequest
  ): Promise<AdminPricesWrittenSeries[]> {
    const rows = await this.prices
      .createQueryBuilder('p')
      .select(
        `to_char(date_trunc('day', p."observedAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
        'day'
      )
      .addSelect('p."sourceKind"', 'kind')
      .addSelect('count(*)', 'count')
      // Only a lower bound: the window ends today, and `fillDailyWindow` drops a
      // row past the last day if a clock ever puts one there.
      .where(`p."observedAt" >= :from::timestamptz`, {
        from: `${req.window.from}T00:00:00Z`,
      })
      .groupBy('1')
      .addGroupBy('2')
      .getRawMany<PriceRow>();

    return Object.values(PriceSourceKind).map((sourceKind) => ({
      sourceKind,
      points: fillDailyWindow(
        req.window,
        rows.filter((row) => row.kind === sourceKind)
      ),
    }));
  }
}
