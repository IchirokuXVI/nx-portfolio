/**
 * A shelf, in a past session of a person (plan 0141, section 3.3).
 *
 * `$1` is the owner, `$2` the horizon (`now - WALK_HISTORY_HORIZON_MS`), `$3`
 * `PURCHASE_SESSION_GAP_MS`, `$4` `now` and `$5` how many sessions.
 *
 * It answers one row per shelf per past session, carrying how many seconds into
 * that session the shopper stood at it. {@link BasketOrderService} takes the
 * median of those offsets per row and draws the basket in that order.
 *
 * ## A session, not a basket
 *
 * Plan 0110 read the owner's last seven **finished baskets**. Plan 0136 leaves
 * the `LIVE` basket, which is never created on purpose and never finishes, so a
 * shopper who only ever uses it would have no history at all. So the unit here
 * is a run of the owner's purchases with no gap of `$3` in it, across **every**
 * basket they own: somebody who settles two rows on a generated basket and one
 * on the permanent basket in the same aisle walked one shop.
 *
 * ## Facts rather than keys
 *
 * The query stops one step short of the matching key on purpose (plan 0141,
 * constraints): one of the two keys is `normalizeContent`, a fold that lives in
 * TypeScript and that the add, the grouping and this read all have to agree on.
 * A second definition in SQL is free to drift from the first, so the query
 * answers the content and the product ids and the service forms both keys.
 *
 * ## The predicates that carry rules
 *
 * - **`"endedAt" < now - gap`** leaves the **current** session out, which is what
 *   keeps a row from moving under a thumb (section 2, rule 1). It is a strict
 *   `<` so that a session whose newest purchase is exactly one gap old is still
 *   current, which agrees with `continuesPurchaseSession`, where a gap of
 *   exactly this long continues the session.
 * - **`"startedAt" >= horizon + gap`** drops the one session the horizon can have
 *   cut in half. A session whose first purchase inside the window is less than a
 *   gap after the horizon can have started before it, and a session missing its
 *   beginning reports every offset too small. Dropping it costs at most one of
 *   seven and only for an owner with fewer than eight sessions in the window.
 * - **`"revertedAt" IS NULL`**, and **both outcomes** (plan 0110, section 2
 *   unchanged). A purchase somebody took back is not a shelf they stood at; a
 *   line closed as `NOT_AVAILABLE` is one.
 * - **The join to `list_lines` does not filter `"deletedAt"`.** A line removed
 *   since (plan 0132) was still a shelf. A line merged away no longer exists and
 *   its settlements moved to the survivor with the merge, so the join finds the
 *   survivor's text. A settlement whose line is gone for good, because its list
 *   was deleted, drops out of the join, and a session left with no row
 *   contributes nothing, which costs one of the seven and is accepted.
 * - **`ll."content"` is the line's text as it stands now**, not as it stood when
 *   it was bought. That is an improvement on plan 0110, which read the basket
 *   line's frozen copy: a line renamed from "leche" to "milk" still matches
 *   itself.
 *
 * A line settled twice inside one session counts from the first: `MIN` over the
 * session, and the session's own start is the earliest of every purchase in it.
 *
 * `"itemId"::text` inside the aggregate, for the reason
 * `SUGGESTION_RECENT_TRIPS_SQL` gives: the driver hands back an array for
 * `text[]` and the literal `{...}` for `uuid[]`.
 *
 * The order is `("settledAt", id)` everywhere, so two purchases written in the
 * same microsecond still have one answer to which came first.
 */
export const WALK_HISTORY_SQL = `
  WITH "mine" AS (
    SELECT s.id AS "id",
           s."lineId" AS "lineId",
           s."itemId" AS "itemId",
           s."settledAt" AS "settledAt"
    FROM "generated_lists" gl
    JOIN "line_settlements" s ON s."basketId" = gl.id
    WHERE gl."ownerUserId" = $1::uuid
      AND s."revertedAt" IS NULL
      AND s."settledAt" >= $2::timestamptz
  ),
  "marked" AS (
    SELECT m."id", m."lineId", m."itemId", m."settledAt",
           CASE
             WHEN m."settledAt" - LAG(m."settledAt") OVER w
                  > ($3::double precision * interval '1 millisecond')
             THEN 1
             ELSE 0
           END AS "starts"
    FROM "mine" m
    WINDOW w AS (ORDER BY m."settledAt", m."id")
  ),
  "numbered" AS (
    SELECT k."id", k."lineId", k."itemId", k."settledAt",
           SUM(k."starts") OVER (ORDER BY k."settledAt", k."id") AS "session"
    FROM "marked" k
  ),
  "sessions" AS (
    SELECT n."session" AS "session",
           (ARRAY_AGG(n."id" ORDER BY n."settledAt", n."id"))[1] AS "sessionId",
           MIN(n."settledAt") AS "startedAt",
           MAX(n."settledAt") AS "endedAt"
    FROM "numbered" n
    GROUP BY n."session"
  ),
  "past" AS (
    SELECT x."session", x."sessionId", x."startedAt"
    FROM "sessions" x
    WHERE x."endedAt" < $4::timestamptz - ($3::double precision * interval '1 millisecond')
      AND x."startedAt" >= $2::timestamptz + ($3::double precision * interval '1 millisecond')
    ORDER BY x."startedAt" DESC, x."sessionId" DESC
    LIMIT $5
  )
  SELECT p."sessionId" AS "sessionId",
         ll."content" AS "content",
         array_remove(array_agg(DISTINCT n."itemId"::text), NULL) AS "settledItemIds",
         extract(epoch FROM (MIN(n."settledAt") - p."startedAt"))::double precision
           AS "offsetSeconds"
  FROM "past" p
  JOIN "numbered" n ON n."session" = p."session"
  JOIN "list_lines" ll ON ll.id = n."lineId"
  GROUP BY p."sessionId", p."startedAt", n."lineId", ll."content"
`;

/** One row of {@link WALK_HISTORY_SQL}: one shelf, in one past session of the owner. */
export interface WalkHistoryRow {
  sessionId: string;
  content: string;
  settledItemIds: string[];
  offsetSeconds: number;
}
