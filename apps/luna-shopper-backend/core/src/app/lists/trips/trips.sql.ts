/**
 * The reads behind the trips of a zone list (plan 0122, sections 3 and 4).
 *
 * Raw SQL rather than a query builder, for the reason `line-claim.sql.ts` gives:
 * every camelCase column is quoted by hand, because TypeORM does not rewrite
 * `alias.property` inside a raw select expression, and every rule here is a
 * `WHERE`, a `GROUP BY` or a window that no mocked repository could prove.
 *
 * Nothing here is stored. A trip is derived on every read from two tables that
 * already exist: `generated_list_line_origins` says what each basket asked of
 * each zone line, and `line_settlements` says what was bought and when.
 *
 * ## Which purchase belongs to which kind of trip
 *
 * One test, asked the same way in every query below: **does the basket line the
 * settlement names still exist?** `generatedListLineId` has no foreign key, so
 * after a basket is deleted it names a row that is gone. A purchase whose basket
 * line exists is that basket's. Every other purchase, the ones made by hand and
 * the ones a deleted basket left behind, is loose. So every standing purchase of
 * the list is in exactly one trip.
 *
 * `revertedAt IS NULL` is the definition of a purchase that counts, as everywhere
 * else in core.
 */

/**
 * How long a silence ends a loose trip: six hours.
 *
 * Elapsed time and never a calendar day, so no time zone is involved and a shop
 * that crosses midnight stays one trip. A gap of exactly this long continues the
 * session: only a longer one starts the next.
 */
export const LOOSE_TRIP_GAP_MS = 6 * 60 * 60 * 1000;

/**
 * One row per (basket, zone line) of the list: what the basket's origins asked
 * of the line, and what its standing settlements bought of it.
 *
 * `$1` is the list. `basketFilter` narrows both halves to one basket, for the
 * rows read, and is empty for the heads.
 *
 * **One row per zone line, however many sibling basket lines or origins fed it**
 * (plan 0094): both halves group by the basket and the zone line, never by the
 * basket line.
 *
 * A `FULL JOIN`, because either half can stand alone. Asked and never bought is
 * the ordinary unfinished line. Bought and no longer asked is a purchase whose
 * origin was taken back to zero afterwards, and dropping it would make a
 * standing purchase belong to no trip at all.
 *
 * The join to `list_lines` is what skips a line that was deleted or merged away:
 * an origin's `lineId` has no foreign key and may name no row.
 */
function basketRowsCte(basketFilter: string): string {
  return `
  "asked" AS (
    SELECT gll."generatedListId" AS "tripId",
           o."lineId" AS "lineId",
           SUM(o."quantity")::int AS "asked"
    FROM "generated_list_line_origins" o
    JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
    WHERE o."listId" = $1::uuid ${basketFilter}
    GROUP BY gll."generatedListId", o."lineId"
  ),
  "bought" AS (
    SELECT gll."generatedListId" AS "tripId",
           s."lineId" AS "lineId",
           COALESCE(
             SUM(s."quantity") FILTER (WHERE s."outcome" = 'BOUGHT'), 0
           )::int AS "bought",
           (ARRAY_AGG(s."outcome"::text ORDER BY s."settledAt" DESC, s.id DESC))[1]
             AS "lastOutcome"
    FROM "line_settlements" s
    JOIN "generated_list_lines" gll ON gll.id = s."generatedListLineId"
    WHERE s."listId" = $1::uuid
      AND s."revertedAt" IS NULL ${basketFilter}
    GROUP BY gll."generatedListId", s."lineId"
  ),
  "basket_rows" AS (
    SELECT COALESCE(a."tripId", b."tripId") AS "tripId",
           ll.id AS "lineId",
           ll."position" AS "position",
           COALESCE(a."asked", 0) AS "asked",
           COALESCE(b."bought", 0) AS "bought",
           b."lastOutcome" AS "lastOutcome"
    FROM "asked" a
    FULL JOIN "bought" b
      ON b."tripId" = a."tripId" AND b."lineId" = a."lineId"
    JOIN "list_lines" ll
      ON ll.id = COALESCE(a."lineId", b."lineId") AND ll."listId" = $1::uuid
  )`;
}

/**
 * One row per (loose trip, zone line) of the list. `$1` is the list, `$2` is
 * {@link LOOSE_TRIP_GAP_MS}.
 *
 * Four steps, each a CTE:
 *
 * 1. `loose`: the standing purchases of the list that belong to no basket.
 * 2. `marked`: a purchase starts a session when the one before it is more than
 *    the gap away. The first has no predecessor, so `LAG` is null, the comparison
 *    is null and it lands in session zero, which is what it should do.
 * 3. `sessioned`: the running sum of those marks numbers the sessions, and a
 *    session's id is the id of its earliest settlement. That id is stable while
 *    the session grows at its newer end, which is the only end an ordinary
 *    purchase can reach.
 * 4. `loose_rows`: one row per zone line of each session.
 *
 * The order is `(settledAt, id)` everywhere, so two purchases written in the same
 * microsecond still have one answer to "which came first".
 *
 * The window is over the list's loose purchases, which `ix_settlements_list`
 * serves. It cannot be narrowed to a page, because where a session starts depends
 * on every purchase before it.
 */
const LOOSE_ROWS_CTE = `
  "loose" AS (
    SELECT s.id AS "id",
           s."lineId" AS "lineId",
           ll."position" AS "position",
           s."settledAt" AS "settledAt",
           s."outcome"::text AS "outcome",
           s."quantity" AS "quantity",
           s."settledByUserId" AS "settledByUserId"
    FROM "line_settlements" s
    JOIN "list_lines" ll ON ll.id = s."lineId" AND ll."listId" = $1::uuid
    WHERE s."listId" = $1::uuid
      AND s."revertedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "generated_list_lines" gll
        WHERE gll.id = s."generatedListLineId"
      )
  ),
  "marked" AS (
    SELECT l.*,
           CASE
             WHEN l."settledAt" - LAG(l."settledAt") OVER w
                  > ($2::double precision * interval '1 millisecond')
             THEN 1
             ELSE 0
           END AS "starts"
    FROM "loose" l
    WINDOW w AS (ORDER BY l."settledAt", l."id")
  ),
  "numbered" AS (
    SELECT m.*,
           SUM(m."starts") OVER (ORDER BY m."settledAt", m."id") AS "session"
    FROM "marked" m
  ),
  "sessioned" AS (
    SELECT n.*,
           FIRST_VALUE(n."id") OVER (
             PARTITION BY n."session" ORDER BY n."settledAt", n."id"
           ) AS "tripId"
    FROM "numbered" n
  ),
  "loose_rows" AS (
    SELECT x."tripId" AS "tripId",
           x."lineId" AS "lineId",
           x."position" AS "position",
           MIN(x."settledAt") AS "firstSettledAt",
           COALESCE(
             SUM(x."quantity") FILTER (WHERE x."outcome" = 'BOUGHT'), 0
           )::int AS "bought",
           (ARRAY_AGG(x."outcome" ORDER BY x."settledAt" DESC, x."id" DESC))[1]
             AS "lastOutcome",
           (ARRAY_AGG(x."settledByUserId" ORDER BY x."settledAt" DESC, x."id" DESC))[1]
             AS "buyer"
    FROM "sessioned" x
    GROUP BY x."tripId", x."lineId", x."position"
  )`;

/**
 * Every trip of the list, as one relation both head queries select from.
 *
 * `$3` is the statuses that count as live and `$4` the oldest a basket may have
 * been generated and still be live. They are the claim's own two values, read
 * from the same two places (`LIVE_GENERATED_LIST_STATUSES` and
 * `LineClaimService.since`), so a trip is live exactly while its basket can
 * claim a line.
 *
 * **A trip left with no line is not here at all**: both halves are built from
 * rows that already joined `list_lines`, so a trip whose only line was deleted
 * has no row to be counted from.
 *
 * `boughtLineCount` is the number of rows whose outcome reads `BOUGHT`, stated
 * here the way `toTripRowView` states it: something was bought and nothing is
 * left.
 */
const TRIPS_CTE = `
  ${basketRowsCte('')},
  ${LOOSE_ROWS_CTE},
  "trips" AS (
    SELECT gl.id AS "id",
           'BASKET'::text AS "kind",
           gl."name"::text AS "name",
           gl."generatedAt" AS "startedAt",
           (
             gl."status"::text = ANY($3::text[])
             AND gl."generatedAt" >= $4::timestamptz
           ) AS "live",
           COUNT(*)::int AS "lineCount",
           (COUNT(*) FILTER (
             WHERE r."bought" > 0 AND r."bought" >= r."asked"
           ))::int AS "boughtLineCount"
    FROM "basket_rows" r
    JOIN "generated_lists" gl ON gl.id = r."tripId"
    GROUP BY gl.id
    UNION ALL
    SELECT r."tripId" AS "id",
           'LOOSE'::text AS "kind",
           NULL::text AS "name",
           MIN(r."firstSettledAt") AS "startedAt",
           false AS "live",
           COUNT(*)::int AS "lineCount",
           (COUNT(*) FILTER (WHERE r."lastOutcome" = 'BOUGHT'))::int
             AS "boughtLineCount"
    FROM "loose_rows" r
    GROUP BY r."tripId"
  )`;

const TRIP_COLUMNS = `
  t."id", t."kind", t."name", t."startedAt", t."live",
  t."lineCount", t."boughtLineCount"`;

/**
 * The live trips of a list, newest first. `$1` to `$4` as {@link TRIPS_CTE}.
 *
 * Not paged (section 2): they are bounded by the claim window, and a client
 * needs all of them to know where a claimed line is drawn.
 */
export const LIVE_TRIPS_SQL = `
  WITH ${TRIPS_CTE}
  SELECT ${TRIP_COLUMNS}
  FROM "trips" t
  WHERE t."live"
  ORDER BY t."startedAt" DESC, t."id" DESC
`;

/**
 * A page of ended trips, newest first: the union of ended baskets and loose
 * trips in one keyset order. `$1` to `$4` as {@link TRIPS_CTE}, `$5` the cursor
 * trip's id or null, `$6` its kind or null, `$7` the limit.
 *
 * The cursor carries `{ kind, id }` and the boundary's `startedAt` is looked up
 * here, after `SettlementService`: an ISO timestamp in a token is milliseconds
 * and a `timestamptz` is microseconds, so a token carrying the value skips or
 * repeats the boundary row.
 *
 * The lookup goes to the **source table** and not back to `trips`. A basket's
 * `startedAt` is its `generatedAt` and a session's is the `settledAt` of the
 * settlement its id names, so both are one primary key read. It also keeps
 * working when the boundary session has since split or merged: the settlement
 * still exists, so the page continues from the same moment.
 *
 * The id breaks a tie between a basket and a session that share a `startedAt`,
 * and both ids are uuids, so the row comparison is over one pair of types.
 */
export const ENDED_TRIPS_SQL = `
  WITH ${TRIPS_CTE}
  SELECT ${TRIP_COLUMNS}
  FROM "trips" t
  WHERE NOT t."live"
    AND (
      $5::uuid IS NULL
      OR (t."startedAt", t."id") < (
        SELECT b."at", b."id"
        FROM (
          SELECT gl."generatedAt" AS "at", gl.id AS "id"
          FROM "generated_lists" gl
          WHERE $6::text = 'BASKET' AND gl.id = $5::uuid
          UNION ALL
          SELECT s."settledAt" AS "at", s.id AS "id"
          FROM "line_settlements" s
          WHERE $6::text = 'LOOSE' AND s.id = $5::uuid
        ) b
      )
    )
  ORDER BY t."startedAt" DESC, t."id" DESC
  LIMIT $7
`;

/** The keyset over the zone line's `(position, id)`, shared by both row reads. */
function lineKeyset(cursorParam: string): string {
  return `(
      ${cursorParam}::uuid IS NULL
      OR (r."position", r."lineId") > (
        SELECT b."position", b.id
        FROM "list_lines" b
        WHERE b.id = ${cursorParam}::uuid
      )
    )`;
}

/**
 * The rows of one basket trip, in the zone line's own order. `$1` is the list,
 * `$2` the basket, `$3` the cursor line's id or null, `$4` the limit.
 */
export const BASKET_TRIP_ROWS_SQL = `
  WITH ${basketRowsCte('AND gll."generatedListId" = $2::uuid')}
  SELECT r."lineId", r."asked", r."bought", r."lastOutcome"
  FROM "basket_rows" r
  WHERE ${lineKeyset('$3')}
  ORDER BY r."position", r."lineId"
  LIMIT $4
`;

/**
 * The rows of one loose trip, in the zone line's own order. `$1` is the list,
 * `$2` is {@link LOOSE_TRIP_GAP_MS}, `$3` the session's id, `$4` the cursor
 * line's id or null, `$5` the limit.
 *
 * The buyer is served only while they are an approved member of the list's zone,
 * which is the rule `LINE_CLAIMS_SQL` follows for a claim: somebody who has left
 * reports as nobody rather than as an id the reader can no longer resolve. A
 * purchase a deleted basket left behind has no user at all, only a participant,
 * so it reads null by itself.
 */
export const LOOSE_TRIP_ROWS_SQL = `
  WITH ${LOOSE_ROWS_CTE}
  SELECT r."lineId",
         r."bought",
         r."lastOutcome",
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM "shopping_lists" sl
             JOIN "zone_memberships" zm ON zm."zoneId" = sl."zoneId"
             WHERE sl.id = $1::uuid
               AND zm."userId" = r."buyer"
               AND zm.status = 'APPROVED'
           )
           THEN r."buyer"
         END AS "settledByUserId"
  FROM "loose_rows" r
  WHERE r."tripId" = $3::uuid
    AND ${lineKeyset('$4')}
  ORDER BY r."position", r."lineId"
  LIMIT $5
`;

/**
 * The lists one basket has an origin in. `$1` is the basket.
 *
 * Asked **before** a delete, because the origins cascade away with the basket
 * and there would be nothing left to ask afterwards.
 */
export const BASKET_ORIGIN_LISTS_SQL = `
  SELECT DISTINCT o."listId" AS "listId"
  FROM "generated_list_line_origins" o
  JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
  WHERE gll."generatedListId" = $1::uuid
`;

/** The lists any basket of one owner has an origin in. `$1` is the owner. */
export const OWNER_ORIGIN_LISTS_SQL = `
  SELECT DISTINCT o."listId" AS "listId"
  FROM "generated_list_line_origins" o
  JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
  JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
  WHERE gl."ownerUserId" = $1::uuid
`;

/** One row of {@link LIVE_TRIPS_SQL} and {@link ENDED_TRIPS_SQL}. */
export interface TripRow {
  id: string;
  kind: string;
  name: string | null;
  startedAt: string | Date;
  live: boolean;
  lineCount: number;
  boughtLineCount: number;
}

/** One row of either rows read. `asked` is absent for a loose trip. */
export interface TripLineRow {
  lineId: string;
  asked?: number;
  bought: number;
  lastOutcome: string | null;
  settledByUserId?: string | null;
}
