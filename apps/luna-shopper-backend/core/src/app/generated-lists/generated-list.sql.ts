import type { LineApprovalStatus } from '@portfolio/luna-shopper/contracts';
import { GENERATED_BASKET } from '../baskets/open-basket.sql';

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
 * `GeneratedListService.countsFor` sends those to `BasketReadService.progressOf`
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
  SELECT c."basketId" AS "generatedListId",
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
  generatedListId: string;
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

/**
 * The order the owner walked their last trips in (plan 0110, section 2). `$1` is
 * the owner, `$2` the statuses an ended trip may be in, `$3` how many trips.
 *
 * It answers one row per line that was settled on one of those trips, carrying
 * how many seconds into the trip the shopper stood at that shelf. A basket
 * composed afterwards is ordered by the median of those offsets, so somebody who
 * settles milk and then skimmed milk three seconds later gets them side by side
 * however the source lists were written.
 *
 * ## Facts rather than keys
 *
 * Section 2 describes the answer as `(key, offsetSeconds)` pairs, and this query
 * stops one step short of the key on purpose: one of the two keys is
 * `normalizeContent`, a fold that lives in TypeScript and that the add, the run
 * and this read all have to agree on. Reimplementing it in SQL would be a second
 * definition of "the same thing" free to drift from the first, so the query
 * answers the content and the product ids and {@link GeneratedListOrderService}
 * forms both keys from them.
 *
 * ## The three predicates that carry rules
 *
 * - **`revertedAt IS NULL`** (plan 0104). A purchase somebody took back is not a
 *   shelf they stood at, and the partial index this rides on exists for it.
 * - **Both outcomes count.** A line closed as `NOT_AVAILABLE` was still a visit
 *   to the shelf, so the join filters on no outcome at all.
 * - **`EXISTS` a live settlement.** A basket nobody settled anything in is not a
 *   trip and must not use up one of the seven, or a shopper who composed three
 *   baskets and shopped none of them would read as having no history. It is asked
 *   of the settlement's own `basketId` (plan 0134, section 5), because whether a
 *   basket was shopped is a question about the basket, and it rides
 *   `ix_settlements_basket_live`. The `visits` CTE below still reads the basket
 *   line, because what it wants is the line's own text and pick, and that stays
 *   true until plan 0141 rewrites this read over sessions.
 *
 * A line settled twice, in two shops, counts from the first: `min(settledAt)`
 * per line, and the trip's own start is the earliest of those.
 *
 * ## It reads the zone line, because plan 0136 deleted the basket line
 *
 * A visit is a standing settlement of a finished trip joined to `list_lines`
 * for the text and to `list_line_items` for the products.
 *
 * `pickItemId` is **always null** now: it was the basket line's stored pick, and
 * a basket stores none. The column stays on the row so
 * {@link GeneratedListOrderService} keeps one shape to match on, and what it
 * held moves into `settledItemIds`, which is the union of what the shopper said
 * they got and what the line itself names. Both belong there: the order matches
 * a composed row by **any** product that identifies it, and a line whose only
 * settle recorded no product would otherwise be matchable by its text alone.
 *
 * The grouping is by `(basket, zone line)` rather than by basket line, which is
 * the same grouping the trips read applies and for the same reason (plan 0094):
 * one zone line is one shelf, however many baskets or rows reached it.
 */
export const ORDER_HISTORY_SQL = `
  WITH "trips" AS (
    SELECT gl.id
    FROM "generated_lists" gl
    WHERE gl."ownerUserId" = $1
      AND ${GENERATED_BASKET}
      AND gl."status"::text = ANY($2::text[])
      AND EXISTS (
        SELECT 1
        FROM "line_settlements" ls
        WHERE ls."basketId" = gl.id
          AND ls."revertedAt" IS NULL
      )
    ORDER BY gl."generatedAt" DESC, gl.id DESC
    LIMIT $3
  ),
  "visits" AS (
    SELECT
      ls."basketId" AS "tripId",
      ll.content AS "content",
      NULL::uuid AS "pickItemId",
      array_remove(
        array_agg(DISTINCT ls."itemId") || array_agg(DISTINCT lli."itemId"),
        NULL
      ) AS "settledItemIds",
      min(ls."settledAt") AS "settledAt"
    FROM "line_settlements" ls
    JOIN "list_lines" ll ON ll.id = ls."lineId"
    LEFT JOIN "list_line_items" lli ON lli."lineId" = ll.id
    WHERE ls."basketId" IN (SELECT id FROM "trips")
      AND ls."revertedAt" IS NULL
    GROUP BY ls."basketId", ll.id, ll.content
  ),
  "starts" AS (
    SELECT "tripId", min("settledAt") AS "startedAt"
    FROM "visits"
    GROUP BY "tripId"
  )
  SELECT
    v."tripId" AS "tripId",
    v."content" AS "content",
    v."pickItemId" AS "pickItemId",
    v."settledItemIds" AS "settledItemIds",
    extract(epoch FROM (v."settledAt" - s."startedAt"))::double precision
      AS "offsetSeconds"
  FROM "visits" v
  JOIN "starts" s ON s."tripId" = v."tripId"
`;

/**
 * One row of {@link ORDER_HISTORY_SQL}: one shelf, on one past trip.
 *
 * `pickItemId` is what the basket line was pointing at and `settledItemIds` is
 * what the shopper said they actually got, which differ exactly when the pick
 * was swapped in the aisle. Both are matching keys, because the composed line's
 * option set is what the run composed from and either product identifies it.
 */
export interface OrderHistoryRow {
  tripId: string;
  content: string;
  pickItemId: string | null;
  settledItemIds: string[];
  offsetSeconds: number;
}

