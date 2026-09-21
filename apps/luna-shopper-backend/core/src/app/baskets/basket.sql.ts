/**
 * The three reads a generation run makes (plan 0050, sections 2 and 3).
 *
 * Raw SQL rather than a query builder, for the reason `zone-summary.sql.ts`
 * gives about its own fragments: the predicates below are written with **every
 * camelCase column quoted by hand**, because TypeORM does not rewrite
 * `alias.property` inside raw SQL the way it does inside `where`, and an
 * unquoted `sl."zoneId"` reaches Postgres as `zoneid` and fails at runtime where
 * no mocked repository could catch it.
 */

/**
 * The single definition of "a list this caller may draw a basket from".
 *
 * It mirrors `ListAccessService.requireWrite` exactly as `READABLE_LIST` mirrors
 * `requireRead`: an APPROVED membership, and then either the derived staff grant
 * (a zone OWNER or ADMIN holds all four permissions on every list in their zone)
 * or a `list_access` row that actually carries `WRITE`.
 *
 * **`WRITE` and not `READ`**, which is where this departs from plan 0050 section
 * 2 as written. That section allowed a reader to generate, arguing that
 * generation is a pure read and that restricting it would break the household
 * where the shopper is not the admin. Plan 0051 section 2 overrides it: a basket
 * settles the lines it drew from, and settling is a write, so taking the line
 * into a basket takes `WRITE`. The argument the original made still holds
 * against `DECIDE`, and `DECIDE` is not what is being asked for here.
 */
export const WRITABLE_LIST = `
  m.status = 'APPROVED'
  AND (
    m.role IN ('OWNER', 'ADMIN')
    OR EXISTS (
      SELECT 1 FROM "list_access" la
      WHERE la."listId" = sl.id
        AND la."membershipId" = m.id
        AND 'WRITE' = ANY(la."permissions")
    )
  )
`;

/**
 * Every list, in every zone, that this caller may draw a basket from. `$1` is the
 * caller.
 *
 * Asked once for the whole run rather than once per source, and filtered in the
 * service afterwards. A person belongs to a handful of zones holding a few dozen
 * lists between them, so one query over their memberships is cheaper than a
 * permission resolution per named source, and it is the same answer for the
 * `ALL` case, which has no named sources to resolve.
 *
 * The zone comes back beside the list because a source may name a zone and mean
 * every list in it, and because the provenance rows record both.
 */
export const WRITABLE_LISTS_SQL = `
  SELECT sl.id AS "listId", sl."zoneId" AS "zoneId"
  FROM "shopping_lists" sl
  JOIN "zone_memberships" m
    ON m."zoneId" = sl."zoneId" AND m."userId" = $1
  WHERE ${WRITABLE_LIST}
  ORDER BY sl."zoneId", sl."updatedAt" DESC, sl.id
`;

/**
 * The four numbers a **finished** basket's history row shows, for a whole page
 * (plan 0136, section 7.4). `$1` is the basket ids.
 *
 * A basket has no lines to count any more, so the two halves of plan 0135's
 * freeze are what is counted instead: `basket_trip_rows` says what the trip
 * asked of each zone line, and `line_settlements` under the same `basketId`
 * says what was bought of it. Every number below is the same arithmetic
 * `basket-rows.ts` does on the screen, written once more in SQL because a page
 * of finished baskets must not cost a read each.
 *
 * **Only a finished basket is asked here.** The rows exist exactly while the
 * basket is not `OPEN`, so an open one would answer zero for everything;
 * `BasketService.countsFor` sends those to `BasketReadService.progressOf`
 * instead.
 *
 * The three states, and they are `stateOf`'s, in its order:
 *
 * - **`NOT_AVAILABLE`**: the newest standing act said so and something is still
 *   left. Guarded on `left` for the reason `stateOf` guards it: a line the shop
 *   did not have and somebody bought afterwards is bought.
 * - **`DONE`**: nothing left and something bought.
 * - Everything else is pending, and is counted by `lineCount` alone.
 *
 * `settledLineCount` stays the sum of the other two, as plan 0053 defined it:
 * `NOT_AVAILABLE` closes a line's outstanding amount exactly as a purchase does,
 * so it has always meant "nothing left to do on this line" and it still does.
 *
 * The lateral is one aggregate per trip row over its settlements, ordered by
 * `("settledAt", id)` as every other reader of "the newest act" in core is. A
 * settle writes one row per line it touched with the same `settledAt`, so the
 * tie break on the id is what gives that one act one answer.
 */
export const FINISHED_BASKET_COUNTS_SQL = `
  WITH "counted" AS (
    SELECT r."basketId" AS "basketId",
           GREATEST(r."asked" - b."bought", 0) AS "left",
           b."bought" AS "bought",
           b."lastOutcome" AS "lastOutcome"
    FROM "basket_trip_rows" r
    LEFT JOIN LATERAL (
      SELECT COALESCE(
               SUM(s."quantity") FILTER (WHERE s."outcome" = 'BOUGHT'), 0
             )::int AS "bought",
             (ARRAY_AGG(s."outcome"::text ORDER BY s."settledAt" DESC, s.id DESC))[1]
               AS "lastOutcome"
      FROM "line_settlements" s
      WHERE s."basketId" = r."basketId"
        AND s."lineId" = r."lineId"
        AND s."revertedAt" IS NULL
    ) b ON TRUE
    WHERE r."basketId" = ANY($1::uuid[])
  )
  SELECT c."basketId" AS "basketId",
         count(*)::int AS "lineCount",
         count(*) FILTER (
           WHERE (c."left" = 0 AND c."bought" > 0)
              OR (c."left" > 0 AND c."lastOutcome" = 'NOT_AVAILABLE')
         )::int AS "settledLineCount",
         count(*) FILTER (
           WHERE c."left" = 0 AND c."bought" > 0
         )::int AS "boughtLineCount",
         count(*) FILTER (
           WHERE c."left" > 0 AND c."lastOutcome" = 'NOT_AVAILABLE'
         )::int AS "notAvailableLineCount"
  FROM "counted" c
  GROUP BY c."basketId"
`;

/** One row of {@link FINISHED_BASKET_COUNTS_SQL}. */
export interface BasketCountsRow {
  basketId: string;
  lineCount: number;
  settledLineCount: number;
  boughtLineCount: number;
  notAvailableLineCount: number;
}

/** One row of {@link WRITABLE_LISTS_SQL}. */
export interface WritableListRow {
  listId: string;
  zoneId: string;
}
