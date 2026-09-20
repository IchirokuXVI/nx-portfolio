/**
 * The two statements that freeze and thaw a trip's ask (plan 0135, section 3).
 *
 * Raw SQL rather than a query builder, for the reason `line-claim.sql.ts` gives:
 * every camelCase column is quoted by hand, because TypeORM does not rewrite
 * `alias.property` inside a raw select expression, and an insert from a select
 * is not something a repository can state at all.
 *
 * **A file of its own, because the `SELECT` is the seam.** Plan 0136 replaces it
 * with `bought + left` over the basket's coverage and changes nothing else in
 * this plan.
 */

/**
 * Write what one basket asked of every zone line. `$1` is the basket.
 *
 * Idempotent: `ON CONFLICT DO NOTHING` on the unique key, so a freeze that runs
 * twice leaves one set of rows. That matters because the caller is a status
 * change, and a status set to the value it already holds must not be a second
 * write.
 *
 * **The list comes from the line, not from the origin's copy.** The two agree in
 * every row that exists, and reading it from `list_lines` is what makes the
 * unique key safe to group under: one line is in one list.
 *
 * **The inner join to `list_lines` drops an origin whose line is gone**, which
 * the foreign key requires and which loses nothing: `basket_rows` drops the same
 * origin on every read today. A soft deleted line (plan 0132) is still a row, so
 * it is frozen like any other, and the trips read decides whether to draw it, as
 * it does for an open basket.
 *
 * **One row per zone line, however many sibling basket lines or origins fed it**
 * (plan 0094), which is the grouping `basketRowsCte` already applies on read.
 * Zero is a value: an origin taken back to zero is a trip that stopped asking,
 * and it is still a row of that trip.
 */
export const BASKET_TRIP_ROWS_FREEZE_SQL = `
  INSERT INTO "basket_trip_rows" ("basketId", "listId", "lineId", "asked")
  SELECT gll."generatedListId",
         ll."listId",
         ll.id,
         SUM(o."quantity")::int
  FROM "generated_list_line_origins" o
  JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
  JOIN "list_lines" ll ON ll.id = o."lineId"
  WHERE gll."generatedListId" = $1::uuid
  GROUP BY gll."generatedListId", ll."listId", ll.id
  ON CONFLICT ON CONSTRAINT "uq_basket_trip_rows_line" DO NOTHING
`;

/** Forget them. The basket is open again and its lists answer for it. `$1` is the basket. */
export const BASKET_TRIP_ROWS_THAW_SQL = `
  DELETE FROM "basket_trip_rows" WHERE "basketId" = $1::uuid
`;
