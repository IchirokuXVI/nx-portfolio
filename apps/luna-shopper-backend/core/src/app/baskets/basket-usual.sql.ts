/**
 * Each line's window of recent purchases, counted at one chain (plan 0165,
 * section 1).
 *
 * `$1` is the basket's line ids, `$2` the read's chain and `$3`
 * `BASKET_USUAL_WINDOW`.
 *
 * **One statement per read, never one per row.** A window function numbers each
 * line's standing purchases newest first, and the outer query keeps the first
 * `$3` of every line and counts them. It rides `ix_settlements_line`
 * (`"lineId"`, `"settledAt" DESC`), which already answers "the last purchases
 * of a line" for the line page.
 *
 * ## What counts
 *
 * - **`outcome = 'BOUGHT'` and `"revertedAt" IS NULL`.** A `NOT_AVAILABLE`
 *   close is not a purchase, and a purchase somebody took back did not happen.
 *   A skip is not in this table at all.
 * - **Every settle on the line**, whoever made it and through whichever basket
 *   or list page, because a line belongs to one list in one zone: that is the
 *   household scope the user asked for. So there is no filter on the basket or
 *   on the person.
 * - **Each settle is one purchase.** Two taps on one trip write two rows and
 *   both count; collapsing them by trip is not in this plan.
 *
 * ## What leaves the database
 *
 * Three counts per line, and nothing else: how many purchases the window
 * holds, how many name the read's chain, and how many name any chain. No shop,
 * no time, no person and no other chain's id is selected, so none can reach the
 * wire by accident.
 *
 * A line with no standing purchase answers no row. The caller reads that as a
 * line never bought.
 *
 * `::int` on the counts, because `pg` hands a `bigint` back as a string.
 */
export const USUAL_WINDOWS_SQL = `
  SELECT
    w."lineId" AS "lineId",
    count(*)::int AS "of",
    count(*) FILTER (WHERE w."supermarketId" = $2::uuid)::int AS "bought",
    count(w."supermarketId")::int AS "named"
  FROM (
    SELECT
      s."lineId",
      s."supermarketId",
      row_number() OVER (
        PARTITION BY s."lineId"
        ORDER BY s."settledAt" DESC, s.id DESC
      ) AS "position"
    FROM "line_settlements" s
    WHERE s."lineId" = ANY($1::uuid[])
      AND s."outcome" = 'BOUGHT'
      AND s."revertedAt" IS NULL
  ) w
  WHERE w."position" <= $3::int
  GROUP BY w."lineId"
`;

/** One row of {@link USUAL_WINDOWS_SQL}: one line's window, as counts. */
export interface UsualWindowRow {
  lineId: string;
  /** Purchases in the window, 1 to `BASKET_USUAL_WINDOW`. */
  of: number;
  /** Of those, how many name the read's chain. */
  bought: number;
  /** Of those, how many name any chain at all. */
  named: number;
}
