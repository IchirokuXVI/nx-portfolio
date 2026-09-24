import { PERSON_PURCHASES_CTE } from './purchases.sql';

/**
 * The shops one person bought at recently (plan 0164, section 4). `$1` is the
 * reader and `$2` is {@link RECENT_SHOP_DAYS}.
 *
 * Over the reader's own purchases, the union of three routes that plan 0142
 * defined once in {@link PERSON_PURCHASES_CTE}: baskets they own, their list
 * page settles, and their participant rows on somebody else's basket. That
 * fragment already keeps only standing settles (`revertedAt` null).
 *
 * A shop counts when a `BOUGHT` settle recorded it within the window, and that
 * is the whole rule: no ranking by frequency and no minimum count. A
 * `NOT_AVAILABLE` settle says the person stood in the shop and did not buy,
 * which is not a purchase. Each shop answers its latest `settledAt`, newest
 * first, then by id so two shops bought at in the same microsecond have one
 * order.
 *
 * Per person, never per household: a shop says where this person stands, which
 * is why plan 0143 keeps it private.
 */
export const RECENT_SHOPS_SQL = `
  WITH ${PERSON_PURCHASES_CTE}
  SELECT m."supermarketLocationId" AS "supermarketLocationId",
         MAX(m."settledAt") AS "lastBoughtAt"
  FROM "mine" m
  WHERE m."outcome" = 'BOUGHT'
    AND m."supermarketLocationId" IS NOT NULL
    AND m."settledAt" >= now() - make_interval(days => $2::int)
  GROUP BY m."supermarketLocationId"
  ORDER BY MAX(m."settledAt") DESC, m."supermarketLocationId"
`;

/** One row of {@link RECENT_SHOPS_SQL}. */
export interface RecentShopRow {
  supermarketLocationId: string;
  lastBoughtAt: string | Date;
}
