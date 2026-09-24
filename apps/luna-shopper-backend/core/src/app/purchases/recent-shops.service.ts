import { Injectable } from '@nestjs/common';
import {
  RECENT_SHOP_DAYS,
  type ListRecentShopsRequest,
  type RecentShopIdsView,
} from '@portfolio/luna-shopper/contracts';
import { DataSource } from 'typeorm';
import { RECENT_SHOPS_SQL, type RecentShopRow } from './recent-shops.sql';

/**
 * The shops the caller bought at in the last sixty days (plan 0164, section 4).
 *
 * Ids and dates only. Core holds a shop as an opaque catalog id, so the gateway
 * names the shops through catalog, and a shop that no longer exists drops out
 * there.
 *
 * The caller's own purchases and nobody else's: the user id comes from the
 * token and is never a parameter of the route, and the statement is the
 * authorization, as it is for the history reads beside it.
 */
@Injectable()
export class RecentShopsService {
  constructor(private readonly dataSource: DataSource) {}

  async recentShops(req: ListRecentShopsRequest): Promise<RecentShopIdsView> {
    const rows: RecentShopRow[] = await this.dataSource.query(
      RECENT_SHOPS_SQL,
      [req.userId, RECENT_SHOP_DAYS]
    );
    return {
      shops: rows.map((row) => ({
        supermarketLocationId: row.supermarketLocationId,
        lastBoughtAt: new Date(row.lastBoughtAt).toISOString(),
      })),
    };
  }
}
