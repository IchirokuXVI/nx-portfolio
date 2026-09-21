import { openBasketCoversLine } from '../../baskets/basket.sql';
import { GENERATED_BASKET } from '../../baskets/open-basket.sql';
import { basketAskedCte } from '../trips/basket-asked.sql';

/**
 * The reads behind the lines a list suggests (plan 0123, sections 2, 4 and 5).
 *
 * Raw SQL for the reason `trips.sql.ts` gives: every camelCase column is quoted by
 * hand, because TypeORM does not rewrite `alias.property` inside a raw select
 * expression, and every rule here is a `WHERE` no mocked repository could prove.
 *
 * Four statements, each over a set of lines and never one per line. The service
 * runs them one after the other, so a request never holds two pooled connections.
 *
 * **A basket trip is a `GENERATED` basket, always** (plan 0133, section 6). The
 * permanent basket holds every line its owner can write, so counting it would
 * hold every candidate and suggest nothing, for ever. The two history reads ask
 * it inside {@link basketAskedCte}; the candidates read asks it itself.
 *
 * **A trip is not only a basket** (plan 0142, section 8). A run of purchases
 * with no `GENERATED` basket behind it is a session, and a session that is over
 * is a trip the staple rule learns from, so the household that never composes a
 * basket is no longer silent to it. That widening lives in
 * {@link SUGGESTION_RECENT_TRIPS_SQL} alone: the quantity of section 5 still
 * reads what a basket asked, because a session asked for nothing.
 *
 * **What an ended trip asked is read from `basket_trip_rows`** (plan 0135). Its
 * finish wrote the numbers down, so the two history reads go through
 * {@link basketAskedCte} rather than naming origins, and they went on working
 * when plan 0136 dropped that table. The relation also answers for an `OPEN`
 * basket, from its coverage, and both reads then set that half aside with their
 * own `status <> 'OPEN'`: "ended" is a status here and nothing else.
 *
 * **"Live" is the claim's own test, and "ended" is the trip being over.** The
 * candidates read asks {@link openBasketCoversLine}, which is the claim's own
 * fragment and carries the claim's own window, from `LineClaimService.since`, so
 * a line is held exactly while a basket may claim it. The two history reads ask
 * for a trip that is no longer open, and they do not ask the window: an open
 * basket past it is finished by the sweep within one tick, and until then it is a
 * trip in progress rather than a trip to learn from.
 */

/**
 * The candidates of section 2: lines of the list at zero, approved, bought at
 * least once, and held by no open trip. `$1` is the list, `$2` the oldest a
 * basket may have been generated and still hold anything, `$3` the skip window
 * in milliseconds.
 *
 * **A trip a shopper skipped the line on does not hold it** (plan 0137, section
 * 5.4). The fragment carries that rule too, so the line is suggested back while
 * the skip is fresh. That is the intended consequence and not an accident:
 * nobody is out buying it.
 *
 * **The hold is coverage, and not `claimed`** (plan 0136, section 7.3). A claim
 * ends the moment the line is bought all the way through, which is the moment a
 * shopper still in the shop has just bought it. Suggesting it back then is wrong,
 * so this asks the wider question {@link openBasketCoversLine} answers: is a live
 * basket looking at this list at all, however much of the line is settled. The
 * line becomes a candidate when that basket ends.
 *
 * It is one fragment shared with the claim on purpose, so the two cannot
 * disagree: a line the suggestions offer back while the claim calls it taken
 * would be the same line in two states on one screen.
 *
 * A deleted line is skipped by hand (plan 0132). It has to be: a line at zero
 * that was bought before is precisely what the rest of this matches, so a
 * deleted one would be suggested back onto the list it was deleted from.
 *
 * `ix_lines_list_quantity` serves the list and the zero, and since plan 0132 it
 * holds only standing lines, so it serves the new predicate too. The purchase
 * `EXISTS` is an index lookup by line, on `ix_settlements_line`.
 */
export const SUGGESTION_CANDIDATES_SQL = `
  SELECT ll.id AS "lineId",
         ll."position" AS "position"
  FROM "list_lines" ll
  WHERE ll."listId" = $1::uuid
    AND ll."deletedAt" IS NULL
    AND ll."quantity" = 0
    AND ll."approvalStatus" = 'APPROVED'
    AND EXISTS (
      SELECT 1
      FROM "line_settlements" s
      WHERE s."lineId" = ll.id
        AND s."outcome" = 'BOUGHT'
        AND s."revertedAt" IS NULL
    )
    AND NOT ${openBasketCoversLine('ll', '$2', '$3')}
`;

/**
 * Every purchase of every candidate, in one statement. `$1` is the line ids.
 *
 * A purchase is a standing `BOUGHT` row. `NOT_AVAILABLE` rows carry no units and
 * reverted rows were taken back, so neither is a purchase. The rows come as they
 * are, one per settlement: folding the ones a single trip wrote is
 * `mergePurchases`, which is a pure function under a unit spec.
 *
 * `basketId` rides along for the quantity rule of plan 0142, section 8.2: the
 * estimate uses what a basket trip asked only while that trip is where the line
 * was last bought, or is newer than its last purchase. It is the raw column and
 * not a trip: a purchase made through a deleted basket names a row that is gone
 * and matches no trip, which is the right answer.
 */
export const SUGGESTION_PURCHASES_SQL = `
  SELECT s."lineId" AS "lineId",
         s."settledAt" AS "settledAt",
         s."quantity" AS "quantity",
         s."basketId" AS "basketId"
  FROM "line_settlements" s
  WHERE s."lineId" = ANY($1::uuid[])
    AND s."outcome" = 'BOUGHT'
    AND s."revertedAt" IS NULL
  ORDER BY s."lineId", s."settledAt", s.id
`;

/**
 * The list's newest ended trips, newest first, each with the candidates it
 * asked for (section 4, as plan 0142 section 8.1 widened it). `$1` is the list,
 * `$2` the candidate line ids, `$3` how many trips, `$4`
 * {@link PURCHASE_SESSION_GAP_MS}, `$5` now, `$6`
 * {@link STAPLE_SESSION_MIN_LINES}.
 *
 * **A trip is not only a basket any more.** A household that shops from the
 * permanent basket, or ticks the list off in the shop, makes no basket trips at
 * all, so the staple rule never spoke to it however regular its shopping was.
 * The ended trips of a list are the union plan 0122 already serves on the list
 * page, read here in one statement.
 *
 * ## An ended basket trip
 *
 * A `GENERATED` basket that is no longer `OPEN`, read through
 * {@link basketAskedCte} as before. A line is **present** where the trip asked
 * for more than zero of it. An `OPEN` basket that outlived the claim window is
 * finished by the sweep within its interval, and until then it is a trip in
 * progress rather than a trip to learn from.
 *
 * ## An ended session of the list
 *
 * The list's standing purchases that belong to no `GENERATED` basket (plan
 * 0134, section 4.1), windowed by the session gap the same way
 * `LOOSE_ROWS_CTE` windows them, whose newest purchase is older than
 * `now - gap`. **A session still running is a shop in progress**, and counting
 * it would call every line not bought yet absent.
 *
 * A line is present where the session holds a standing settlement on it of
 * **either** outcome: a household that tried to buy it wanted it.
 *
 * **A session counts only when it touched at least `$6` distinct lines of the
 * list.** A basket trip states everything a household wanted, so a line missing
 * from it was not wanted. A session states only what was bought, so somebody
 * who went out for bread alone otherwise makes every other line absent, and two
 * such errands in a row end every staple the list has ("never absent from two
 * in a row", `suggestion-rules.ts`).
 *
 * The two halves cannot double count: a purchase belongs to a `GENERATED`
 * basket or to a session and never to both, which is the one test plan 0134
 * section 4.1 states.
 *
 * `lineIds` is cast to `text[]` so the driver hands back an array and not the
 * literal `{...}` it answers for a `uuid[]`, and a trip that asked for no
 * candidate reads `{}` rather than dropping out: it is an absence, and the
 * staple rule counts absences.
 */
export const SUGGESTION_RECENT_TRIPS_SQL = `
  WITH ${basketAskedCte(null)},
  "basket_trips" AS (
    SELECT a."basketId" AS "tripId",
           gl."generatedAt" AS "startedAt",
           ARRAY_AGG(DISTINCT a."lineId"::text)
             FILTER (WHERE a."asked" > 0 AND a."lineId" = ANY($2::uuid[]))
             AS "lineIds"
    FROM "basket_asked" a
    JOIN "list_lines" ll
      ON ll.id = a."lineId"
     AND ll."listId" = $1::uuid
     AND ll."deletedAt" IS NULL
    JOIN "generated_lists" gl ON gl.id = a."basketId"
    WHERE gl."status" <> 'OPEN'
    GROUP BY a."basketId", gl."generatedAt"
  ),
  "loose" AS (
    SELECT s.id AS "id", s."lineId" AS "lineId", s."settledAt" AS "settledAt"
    FROM "line_settlements" s
    JOIN "list_lines" ll ON ll.id = s."lineId" AND ll."listId" = $1::uuid
    WHERE s."listId" = $1::uuid
      AND s."revertedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "generated_lists" gl
        WHERE gl.id = s."basketId" AND ${GENERATED_BASKET}
      )
  ),
  "marked" AS (
    SELECT l.*,
           CASE
             WHEN l."settledAt" - LAG(l."settledAt") OVER w
                  > ($4::double precision * interval '1 millisecond')
             THEN 1
             ELSE 0
           END AS "starts"
    FROM "loose" l
    WINDOW w AS (ORDER BY l."settledAt", l."id")
  ),
  "numbered" AS (
    SELECT k.*, SUM(k."starts") OVER (ORDER BY k."settledAt", k."id") AS "session"
    FROM "marked" k
  ),
  "session_trips" AS (
    SELECT (ARRAY_AGG(n."id" ORDER BY n."settledAt", n."id"))[1] AS "tripId",
           MIN(n."settledAt") AS "startedAt",
           ARRAY_AGG(DISTINCT n."lineId"::text)
             FILTER (WHERE n."lineId" = ANY($2::uuid[])) AS "lineIds"
    FROM "numbered" n
    GROUP BY n."session"
    HAVING MAX(n."settledAt")
             < $5::timestamptz - ($4::double precision * interval '1 millisecond')
       AND COUNT(DISTINCT n."lineId") >= $6
  )
  SELECT t."tripId", COALESCE(t."lineIds", '{}') AS "lineIds"
  FROM (
    SELECT * FROM "basket_trips"
    UNION ALL
    SELECT * FROM "session_trips"
  ) t
  ORDER BY t."startedAt" DESC, t."tripId" DESC
  LIMIT $3
`;

/**
 * What the newest ended basket trip that asked for each candidate asked for it
 * (section 5). `$1` is the list, `$2` the line ids.
 *
 * One number per zone line, because sibling basket lines (plan 0094) each used
 * to carry a part of one ask. That sum is what a finished basket's trip rows
 * already hold (plan 0135), so this reads them rather than repeating it. A line
 * no ended basket ever asked for has no row, and the service falls back to its
 * last purchase.
 *
 * `DISTINCT ON` keeps the newest trip per line, by `generatedAt` and then by the
 * basket's id, so two baskets generated in the same microsecond still have one
 * answer.
 *
 * It answers **which** trip and **when** as well as how many (plan 0142,
 * section 8.2). Without those two the estimate cannot tell a basket that is
 * still the last word on the line from one last spring, and a household that
 * has shopped from the permanent basket every week since would go on being
 * offered what that old basket asked.
 */
export const SUGGESTION_LAST_ASKED_SQL = `
  WITH ${basketAskedCte(null)}
  SELECT DISTINCT ON (a."lineId")
         a."lineId" AS "lineId",
         a."asked" AS "asked",
         a."basketId" AS "tripId",
         gl."generatedAt" AS "startedAt"
  FROM "basket_asked" a
  JOIN "generated_lists" gl ON gl.id = a."basketId"
  WHERE a."lineId" = ANY($2::uuid[])
    AND a."asked" > 0
    AND gl."status" <> 'OPEN'
  ORDER BY a."lineId", gl."generatedAt" DESC, gl.id DESC
`;

/** One row of {@link SUGGESTION_CANDIDATES_SQL}. */
export interface CandidateRow {
  lineId: string;
  position: number;
}

/** One row of {@link SUGGESTION_PURCHASES_SQL}. */
export interface PurchaseRow {
  lineId: string;
  settledAt: string | Date;
  quantity: number;
  /** The basket it was bought through, or null off the list page. */
  basketId: string | null;
}

/** One row of {@link SUGGESTION_RECENT_TRIPS_SQL}. */
export interface RecentTripRow {
  tripId: string;
  lineIds: string[];
}

/** One row of {@link SUGGESTION_LAST_ASKED_SQL}. */
export interface LastAskedRow {
  lineId: string;
  asked: number;
  /** The basket that asked, so the rule can ask whether it is still the newest. */
  tripId: string;
  startedAt: string | Date;
}
