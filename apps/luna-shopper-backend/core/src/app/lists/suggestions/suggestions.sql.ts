import {
  GENERATED_BASKET,
  OPEN_GENERATED_BASKET,
} from '../../baskets/open-basket.sql';

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
 * **A trip is a `GENERATED` basket, always** (plan 0133, section 6). The
 * permanent basket holds every line its owner can write, so counting it would
 * hold every candidate and suggest nothing, for ever.
 *
 * **"Live" is the claim's own test, and "ended" is the trip being over.** The
 * candidates read asks `OPEN_GENERATED_BASKET` beside the claim's own window,
 * from `LineClaimService.since`, so a line is held exactly while a basket may
 * claim it. The two history reads ask for a trip that is no longer open, and
 * they do not ask the window: an open basket past it is finished by the sweep
 * within one tick, and until then it is a trip in progress rather than a trip to
 * learn from.
 */

/**
 * The candidates of section 2: lines of the list at zero, approved, bought at
 * least once, and held by no open trip. `$1` is the list, `$2` the oldest a
 * basket may have been generated and still hold anything.
 *
 * **The hold is an origin in a live basket, and not `claimed`.** A claim ends the
 * moment its basket line is settled all the way through, which is the moment a
 * shopper still in the shop has just bought the line. Suggesting it then is wrong,
 * so this asks only whether a live basket has an origin for the line, however much
 * of it is settled. The line becomes a candidate when that basket ends.
 *
 * A deleted line is skipped by hand (plan 0132). It has to be: a line at zero
 * that was bought before is precisely what the rest of this matches, so a
 * deleted one would be suggested back onto the list it was deleted from.
 *
 * `ix_lines_list_quantity` serves the list and the zero, and since plan 0132 it
 * holds only standing lines, so it serves the new predicate too. Both `EXISTS`
 * are index lookups by line: `ix_settlements_line` and
 * `ix_generated_list_line_origins_source`.
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
    AND NOT EXISTS (
      SELECT 1
      FROM "generated_list_line_origins" o
      JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
      JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
      WHERE o."lineId" = ll.id
        AND ${OPEN_GENERATED_BASKET}
        AND gl."generatedAt" >= $2::timestamptz
    )
`;

/**
 * Every purchase of every candidate, in one statement. `$1` is the line ids.
 *
 * A purchase is a standing `BOUGHT` row. `NOT_AVAILABLE` rows carry no units and
 * reverted rows were taken back, so neither is a purchase. The rows come as they
 * are, one per settlement: folding the ones a single trip wrote is
 * `mergePurchases`, which is a pure function under a unit spec.
 */
export const SUGGESTION_PURCHASES_SQL = `
  SELECT s."lineId" AS "lineId",
         s."settledAt" AS "settledAt",
         s."quantity" AS "quantity"
  FROM "line_settlements" s
  WHERE s."lineId" = ANY($1::uuid[])
    AND s."outcome" = 'BOUGHT'
    AND s."revertedAt" IS NULL
  ORDER BY s."lineId", s."settledAt", s.id
`;

/**
 * The list's newest ended basket trips, newest first, each with the candidates it
 * asked for (section 4). `$1` is the list, `$2` the candidate line ids, `$3` how
 * many trips.
 *
 * A basket trip of a list is a basket with an origin in it (plan 0122). It is
 * found from the list's own lines, so every join is an index lookup, and a line
 * since deleted contributes no trip, as in `TRIPS_CTE`. A deleted basket has no
 * origins left, so it is not a trip at all and cannot count as an absence.
 *
 * Only trips of **this list** are read, so a basket that drew from another list
 * says nothing about this one.
 *
 * A line is present where the trip asked for more than zero of it. An origin
 * taken back to zero is a trip that stopped asking.
 *
 * `lineIds` is cast to `text[]` so the driver hands back an array and not the
 * literal `{...}` it answers for a `uuid[]`.
 */
export const SUGGESTION_RECENT_TRIPS_SQL = `
  WITH "ended" AS (
    SELECT gl.id AS "tripId",
           gl."generatedAt" AS "generatedAt"
    FROM "list_lines" ll
    JOIN "generated_list_line_origins" o
      ON o."lineId" = ll.id AND o."listId" = $1::uuid
    JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
    JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
    WHERE ll."listId" = $1::uuid
      AND ll."deletedAt" IS NULL
      AND ${GENERATED_BASKET}
      AND gl."status" <> 'OPEN'
    GROUP BY gl.id
    ORDER BY gl."generatedAt" DESC, gl.id DESC
    LIMIT $3
  )
  SELECT e."tripId" AS "tripId",
         COALESCE(
           ARRAY_AGG(DISTINCT o."lineId"::text)
             FILTER (WHERE o."lineId" IS NOT NULL),
           '{}'
         ) AS "lineIds"
  FROM "ended" e
  LEFT JOIN "generated_list_lines" gll ON gll."generatedListId" = e."tripId"
  LEFT JOIN "generated_list_line_origins" o
    ON o."generatedListLineId" = gll.id
   AND o."listId" = $1::uuid
   AND o."lineId" = ANY($2::uuid[])
   AND o."quantity" > 0
  GROUP BY e."tripId", e."generatedAt"
  ORDER BY e."generatedAt" DESC, e."tripId" DESC
`;

/**
 * What the newest ended basket trip that asked for each candidate asked for it
 * (section 5). `$1` is the list, `$2` the line ids.
 *
 * Summed over the trip's basket lines, because sibling basket lines (plan 0094)
 * each carry a part of one ask. A line no ended basket ever asked for has no row,
 * and the service falls back to its last purchase.
 */
export const SUGGESTION_LAST_ASKED_SQL = `
  SELECT DISTINCT ON (a."lineId")
         a."lineId" AS "lineId",
         a."asked" AS "asked"
  FROM (
    SELECT o."lineId" AS "lineId",
           gl.id AS "tripId",
           gl."generatedAt" AS "generatedAt",
           SUM(o."quantity")::int AS "asked"
    FROM "generated_list_line_origins" o
    JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
    JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
    WHERE o."lineId" = ANY($2::uuid[])
      AND o."listId" = $1::uuid
      AND ${GENERATED_BASKET}
      AND gl."status" <> 'OPEN'
    GROUP BY o."lineId", gl.id
  ) a
  WHERE a."asked" > 0
  ORDER BY a."lineId", a."generatedAt" DESC, a."tripId" DESC
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
}
