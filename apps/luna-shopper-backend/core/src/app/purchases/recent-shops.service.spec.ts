import { RECENT_SHOP_DAYS } from '@portfolio/luna-shopper/contracts';
import type { DataSource } from 'typeorm';
import { RecentShopsService } from './recent-shops.service';
import { RECENT_SHOPS_SQL } from './recent-shops.sql';

/**
 * The mapping around the recent shops statement (plan 0164, section 4). Which
 * rows the statement returns is `recent-shops.integration.spec.ts`'s claim,
 * because only Postgres can prove a `WHERE`.
 */
describe('RecentShopsService', () => {
  it('asks for the caller over sixty days and answers ids and ISO dates in the order given', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const dataSource = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return [
          {
            supermarketLocationId: 'loc-2',
            lastBoughtAt: new Date('2026-09-20T10:00:00.123Z'),
          },
          {
            supermarketLocationId: 'loc-1',
            lastBoughtAt: '2026-09-01 08:00:00+00',
          },
        ];
      },
    } as unknown as DataSource;

    const answer = await new RecentShopsService(dataSource).recentShops({
      userId: 'user-1',
    });

    expect(calls).toEqual([
      { sql: RECENT_SHOPS_SQL, params: ['user-1', RECENT_SHOP_DAYS] },
    ]);
    expect(answer).toEqual({
      shops: [
        {
          supermarketLocationId: 'loc-2',
          lastBoughtAt: '2026-09-20T10:00:00.123Z',
        },
        {
          supermarketLocationId: 'loc-1',
          lastBoughtAt: '2026-09-01T08:00:00.000Z',
        },
      ],
    });
  });

  it('keeps only BOUGHT settles that recorded a shop, inside the window', () => {
    // The clauses a fake cannot prove, asserted so that removing one fails
    // here as well as against a database.
    expect(RECENT_SHOPS_SQL).toContain(`m."outcome" = 'BOUGHT'`);
    expect(RECENT_SHOPS_SQL).toContain(`m."supermarketLocationId" IS NOT NULL`);
    expect(RECENT_SHOPS_SQL).toContain(
      `m."settledAt" >= now() - make_interval(days => $2::int)`
    );
  });
});
