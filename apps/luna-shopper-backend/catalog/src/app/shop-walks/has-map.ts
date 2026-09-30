import { isUuid } from '@portfolio/luna-shopper/platform';

/** Anything that runs a query: a repository, a manager or a data source. */
interface Queryable {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

/**
 * Which of `locationIds` have a walk shown to shoppers (backend plan 0168), in
 * one statement over the partial unique index, so a page of shops asks once.
 * Answers lower case ids.
 */
export async function shopsWithMap(
  db: Queryable,
  locationIds: readonly string[]
): Promise<Set<string>> {
  const ids = [...new Set(locationIds.filter(isUuid))];
  if (ids.length === 0) {
    return new Set();
  }
  const rows = (await db.query(
    `SELECT w."supermarketLocationId"::text AS "id"
       FROM "shop_walks" w
      WHERE w."supermarketLocationId" = ANY($1::uuid[])
        AND w."shown" AND w."deletedAt" IS NULL`,
    [ids]
  )) as { id: string }[];
  return new Set(rows.map((row) => row.id.toLowerCase()));
}
