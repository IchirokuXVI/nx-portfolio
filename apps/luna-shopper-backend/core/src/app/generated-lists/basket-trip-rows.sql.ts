import { WRITABLE_LIST } from './generated-list.sql';

/**
 * The two statements that freeze and thaw a trip's ask (plan 0135, section 3).
 *
 * Raw SQL rather than a query builder, for the reason `line-claim.sql.ts` gives:
 * every camelCase column is quoted by hand, because TypeORM does not rewrite
 * `alias.property` inside a raw select expression, and an insert from a select
 * is not something a repository can state at all.
 *
 * **A file of its own, because the `SELECT` is the seam.** Plan 0135 wrote it
 * over `generated_list_line_origins` and said plan 0136 would replace it with
 * `bought + left` over the basket's coverage, changing nothing else. That is
 * exactly what happened, and the two callers, the finish and the reopen, are
 * untouched.
 */

/**
 * Write what one basket asked of every zone line. `$1` is the basket.
 *
 * Idempotent: `ON CONFLICT DO NOTHING` on the unique key, so a freeze that runs
 * twice leaves one set of rows. That matters because the caller is a status
 * change, and a status set to the value it already holds must not be a second
 * write.
 *
 * ## `asked` is `bought + left`, computed here and stored once
 *
 * That is the whole of plan 0136's arithmetic (section 4 of plan 0130): while a
 * basket is open nothing about a row is stored, and the finish is the moment the
 * numbers stop moving. `left` is the zone line's own `quantity` and `bought` is
 * the sum over this basket's standing purchases of that line, so a line bought
 * to zero freezes at what it asked for rather than at nothing.
 *
 * ## It reads the coverage, and the coverage is read **at this moment**
 *
 * The predicates are `basketAskedCte`'s open half, word for word, so the number
 * the finish writes is the number the trips read a moment before it. A list the
 * owner had lost by then is not covered, contributes no row, and its household
 * sees no trip: the same answer the open basket was already giving.
 *
 * It asks the **kind** and not the status, which is the one place it departs
 * from `basketAskedCte`. The caller saves the new status and freezes inside one
 * transaction, so by the time this runs the row already reads `FINISHED` and a
 * status test would match nothing. The kind is kept and is load bearing: the
 * permanent basket never finishes and must never freeze.
 *
 * **One row per zone line**, which is the grouping the trips read applies, and a
 * line every covered list shares still belongs to exactly one list.
 *
 * **A soft deleted line is not frozen** (plan 0132). It is not covered, so it is
 * not a row of the open basket either, and the trips read drops it on both
 * sides.
 */
export const BASKET_TRIP_ROWS_FREEZE_SQL = `
  INSERT INTO "basket_trip_rows" ("basketId", "listId", "lineId", "asked")
  SELECT gl.id,
         sl.id,
         ll.id,
         (ll.quantity + b."bought")::int
  FROM "generated_lists" gl
  JOIN "zone_memberships" m ON m."userId" = gl."ownerUserId"
  JOIN "shopping_lists" sl ON sl."zoneId" = m."zoneId"
  JOIN "list_lines" ll ON ll."listId" = sl.id
  LEFT JOIN LATERAL (
    SELECT COALESCE(
             SUM(s."quantity") FILTER (WHERE s."outcome" = 'BOUGHT'), 0
           )::int AS "bought"
    FROM "line_settlements" s
    WHERE s."basketId" = gl.id
      AND s."lineId" = ll.id
      AND s."revertedAt" IS NULL
  ) b ON TRUE
  WHERE gl.id = $1::uuid
    AND gl."kind" = 'GENERATED'
    AND EXISTS (
      SELECT 1 FROM "basket_sources" bs
      WHERE bs."basketId" = gl.id
        AND bs."zoneId" = sl."zoneId"
        AND (bs."listId" IS NULL OR bs."listId" = sl.id)
    )
    AND ${WRITABLE_LIST}
    AND ll."deletedAt" IS NULL
    AND ll."approvalStatus" IN ('APPROVED', 'PENDING')
    AND (ll.quantity > 0 OR b."bought" > 0)
  ON CONFLICT ON CONSTRAINT "uq_basket_trip_rows_line" DO NOTHING
`;

/** Forget them. The basket is open again and its lists answer for it. `$1` is the basket. */
export const BASKET_TRIP_ROWS_THAW_SQL = `
  DELETE FROM "basket_trip_rows" WHERE "basketId" = $1::uuid
`;
