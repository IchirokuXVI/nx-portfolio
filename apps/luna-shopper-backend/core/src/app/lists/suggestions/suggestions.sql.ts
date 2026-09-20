import { openBasketCoversLine } from '../../baskets/basket.sql';
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
 * **A trip is a `GENERATED` basket, always** (plan 0133, section 6). The
 * permanent basket holds every line its owner can write, so counting it would
 * hold every candidate and suggest nothing, for ever. The two history reads ask
 * it inside {@link basketAskedCte}; the candidates read asks it itself.
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
 * A basket trip of a list is a basket that asked something of it (plan 0122),
 * which since plan 0135 is a row of `basket_trip_rows` for an ended basket. A
 * line since deleted contributes no trip, as in `TRIPS_CTE`, and a deleted
 * basket took its rows with it, so it is not a trip at all and cannot count as
 * an absence.
 *
 * Only trips of **this list** are read, so a basket that drew from another list
 * says nothing about this one.
 *
 * A line is present where the trip asked for more than zero of it. It was "an
 * origin with `quantity > 0`" before plan 0135 and is a frozen trip row now, and
 * the two differ only where sibling origins of one zone line (plan 0094) split a
 * positive ask with a zero. One row per zone line is the honest reading of "the
 * trip asked for it".
 *
 * `lineIds` is cast to `text[]` so the driver hands back an array and not the
 * literal `{...}` it answers for a `uuid[]`.
 */
export const SUGGESTION_RECENT_TRIPS_SQL = `
  WITH ${basketAskedCte(null)},
  "ended" AS (
    SELECT gl.id AS "tripId",
           gl."generatedAt" AS "generatedAt"
    FROM "basket_asked" a
    JOIN "list_lines" ll
      ON ll.id = a."lineId"
     AND ll."listId" = $1::uuid
     AND ll."deletedAt" IS NULL
    JOIN "generated_lists" gl ON gl.id = a."basketId"
    WHERE gl."status" <> 'OPEN'
    GROUP BY gl.id
    ORDER BY gl."generatedAt" DESC, gl.id DESC
    LIMIT $3
  )
  SELECT e."tripId" AS "tripId",
         COALESCE(
           ARRAY_AGG(DISTINCT a."lineId"::text)
             FILTER (WHERE a."lineId" IS NOT NULL),
           '{}'
         ) AS "lineIds"
  FROM "ended" e
  LEFT JOIN "basket_asked" a
    ON a."basketId" = e."tripId"
   AND a."lineId" = ANY($2::uuid[])
   AND a."asked" > 0
  GROUP BY e."tripId", e."generatedAt"
  ORDER BY e."generatedAt" DESC, e."tripId" DESC
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
 */
export const SUGGESTION_LAST_ASKED_SQL = `
  WITH ${basketAskedCte(null)}
  SELECT DISTINCT ON (a."lineId")
         a."lineId" AS "lineId",
         a."asked" AS "asked"
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
