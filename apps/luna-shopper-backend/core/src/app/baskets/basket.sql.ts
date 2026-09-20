import type { LineApprovalStatus } from '@portfolio/luna-shopper/contracts';
import { WRITABLE_LIST } from '../generated-lists/generated-list.sql';
import { OPEN_GENERATED_BASKET } from './open-basket.sql';

/**
 * The five reads behind a basket (plan 0136, section 3; plan 0137, section 3).
 *
 * Raw SQL rather than a query builder, for the reason `generated-list.sql.ts`
 * gives at length: every camelCase column is quoted by hand, because TypeORM does
 * not rewrite `alias.property` inside a raw select expression, and an unquoted
 * `ll."listId"` reaches Postgres as `listid` and fails at runtime where no mocked
 * repository could catch it.
 *
 * **None of them is per line.** A basket read is the session, the covered lines,
 * their product sets, the settlements in scope and the standing skips, whatever
 * the basket holds.
 */

/**
 * How far back the session scan looks. `$2` of {@link BASKET_SESSION_SQL}.
 *
 * A session longer than this is cut at the edge, which is accepted and is why
 * the constant sits beside the query rather than in a configuration file: a
 * single trip through a shop is hours, and an unbounded scan would grow without
 * limit on an account that has shopped for years.
 */
export const BASKET_SESSION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The current shopping session of a basket that never ends. `$1` is the basket,
 * `$2` is {@link BASKET_SESSION_LOOKBACK_MS}, `$3` is `PURCHASE_SESSION_GAP_MS`.
 *
 * A `LIVE` basket has no end, so "what has been bought" cannot mean "everything
 * ever". The answer is the newest run of standing purchases in which no two
 * neighbours are further apart than the gap, **and only when that run is still
 * going**, which is what the `HAVING` asks: the newest purchase has to be within
 * one gap of now.
 *
 * It answers at most one row. No row means there is no current session, so
 * `bought` is zero on every row of the basket and yesterday's shop does not
 * reappear as today's progress.
 *
 * ## `now()` is the database's clock
 *
 * Neither an application server nor a device decides where a session ends. The
 * same reasoning as `LOOSE_ROWS_CTE`, which numbers a list's loose sessions with
 * the same window: two readers must not disagree about which purchases are in
 * the session because their clocks differ by a minute.
 *
 * The order is `("settledAt", id)` everywhere, so two purchases written in the
 * same microsecond still have one answer to which came first.
 */
export const BASKET_SESSION_SQL = `
  WITH "scoped" AS (
    SELECT s.id AS "id", s."settledAt" AS "settledAt"
    FROM "line_settlements" s
    WHERE s."basketId" = $1::uuid
      AND s."revertedAt" IS NULL
      AND s."settledAt" >= now() - ($2::double precision * interval '1 millisecond')
  ),
  "marked" AS (
    SELECT x.*,
           CASE
             WHEN x."settledAt" - LAG(x."settledAt") OVER w
                  > ($3::double precision * interval '1 millisecond')
             THEN 1
             ELSE 0
           END AS "starts"
    FROM "scoped" x
    WINDOW w AS (ORDER BY x."settledAt", x."id")
  ),
  "numbered" AS (
    SELECT m.*,
           SUM(m."starts") OVER (ORDER BY m."settledAt", m."id") AS "session"
    FROM "marked" m
  )
  SELECT MIN(n."settledAt") AS "startedAt"
  FROM "numbered" n
  WHERE n."session" = (SELECT MAX("session") FROM "numbered")
  HAVING MAX(n."settledAt")
         >= now() - ($3::double precision * interval '1 millisecond')
`;

/** The one row {@link BASKET_SESSION_SQL} answers, or none. */
export interface BasketSessionRow {
  startedAt: Date;
}

/**
 * The lines a basket shows. `$1` is the covered list ids, `$2` the basket, `$3`
 * the session start or null for no lower bound, `$4` whether any purchase is in
 * scope at all.
 *
 * Three predicates carry rules, and the fourth is the one that is easy to miss:
 *
 * - **`deletedAt IS NULL`** (plan 0132). A line the household deleted is not on
 *   anybody's list, so it is not a row here either. Its purchases survive on the
 *   settlement, which is what that plan bought.
 * - **`approvalStatus IN ('APPROVED', 'PENDING')`.** A `PENDING` line is a
 *   request nobody has agreed to yet and is still coverable, because plan 0092
 *   made one adoptable and plan 0136 section 5.4 lets one be bought. A
 *   `REJECTED` line is a decision, and a decision is not shopping.
 * - **`quantity > 0` OR a purchase in scope.** The second half is what keeps a
 *   row on the screen after it is bought to zero, so the revert has something to
 *   be pressed on. Without it a settle would make its own row vanish.
 * - **No `LIMIT`.** The cap is on rows and a row is several lines, so it cannot
 *   be applied here. It is applied to the grouping, in TypeScript.
 *
 * Ordered by `("createdAt", id)`, which is what makes the first line of a group
 * its anchor: the oldest ask for a thing names the row.
 */
export function coveredLinesSql(narrow: CoveredLineNarrowing): string {
  const extra =
    narrow === 'SET'
      ? 'AND ll."itemSetHash" = $5'
      : narrow === 'TEXT'
        ? 'AND ll."itemSetHash" IS NULL'
        : '';
  return `
  SELECT
    ll.id AS "id",
    ll."listId" AS "listId",
    ll.content AS "content",
    ll.quantity AS "quantity",
    ll."itemSetHash" AS "itemSetHash",
    ll."approvalStatus" AS "approvalStatus",
    ll."createdAt" AS "createdAt"
  FROM "list_lines" ll
  WHERE ll."listId" = ANY($1::uuid[])
    AND ll."deletedAt" IS NULL
    AND ll."approvalStatus" IN ('APPROVED', 'PENDING')
    AND (
      ll.quantity > 0
      OR (
        $4::boolean
        AND EXISTS (
          SELECT 1
          FROM "line_settlements" s
          WHERE s."lineId" = ll.id
            AND s."basketId" = $2::uuid
            AND s."revertedAt" IS NULL
            AND ($3::timestamptz IS NULL OR s."settledAt" >= $3::timestamptz)
        )
      )
    )
    ${extra}
  ORDER BY ll."createdAt", ll.id
`;
}

/**
 * Which slice of the coverage a read wants.
 *
 * `ALL` is the basket read. The other two are the row resolver, which wants the
 * entries of **one** row: a `set:` merge key is a hash the database can compare,
 * and a `text:` key is `normalizeContent`, a fold that lives in TypeScript. A
 * second definition of that fold in SQL would be free to drift from the first,
 * which is the reasoning `ORDER_HISTORY_SQL` gives for stopping one step short
 * of the key, so `TEXT` narrows to the lines that have no hash and the caller
 * folds them.
 */
export type CoveredLineNarrowing = 'ALL' | 'SET' | 'TEXT';

/** Every covered line of the basket. `$1` to `$4` as above. */
export const COVERED_LINES_SQL = coveredLinesSql('ALL');

/** One row of {@link COVERED_LINES_SQL}: one covered list line. */
export interface CoveredLineRow {
  id: string;
  listId: string;
  content: string;
  quantity: number;
  itemSetHash: string | null;
  approvalStatus: LineApprovalStatus;
  createdAt: Date;
}

/**
 * The product sets of the covered lines, in attachment order. `$1` is the line
 * ids.
 *
 * One query for every line rather than a relation load per line: a basket reads a
 * few hundred lines and the N+1 would be the whole cost of the read. It came
 * from `generated-list.sql.ts`, where the generation run used it for exactly the
 * same job.
 */
export const COVERED_LINE_ITEMS_SQL = `
  SELECT lli."lineId" AS "lineId", lli."itemId" AS "itemId"
  FROM "list_line_items" lli
  WHERE lli."lineId" = ANY($1::uuid[])
  ORDER BY lli."lineId", lli.position ASC, lli."createdAt" ASC
`;

/** One row of {@link COVERED_LINE_ITEMS_SQL}. */
export interface CoveredLineItemRow {
  lineId: string;
  itemId: string;
}

/**
 * This basket's standing purchases of these lines, in scope. `$1` is the basket,
 * `$2` the line ids, `$3` the session start or null, `$4` the skip window in
 * milliseconds.
 *
 * It rides `ix_settlements_basket_live` from plan 0134, which is
 * `("basketId", "lineId", "settledAt")` over the standing rows: exactly this
 * query's three predicates and its order.
 *
 * Oldest first per line, so the caller reading the newest act of a row takes the
 * last entry rather than sorting again.
 *
 * ## `fresh`, and why it is computed here
 *
 * A `LIVE` basket's "the shop had none" runs out with the skip window (plan
 * 0137, section 4), and the comparison is the database's rather than an
 * application server's: two readers must not disagree about whether a close
 * still holds because their clocks differ by a minute. It is computed for every
 * row and read for none of a `GENERATED` basket's, where the close holds until
 * the trip is finished.
 */
export const BASKET_SETTLEMENTS_SQL = `
  SELECT
    s.id AS "id",
    s."lineId" AS "lineId",
    s."outcome"::text AS "outcome",
    s.quantity AS "quantity",
    s."settledAt" AS "settledAt",
    s."settledByParticipantId" AS "settledByParticipantId",
    (s."settledAt" > now() - ($4::double precision * interval '1 millisecond'))
      AS "fresh"
  FROM "line_settlements" s
  WHERE s."basketId" = $1::uuid
    AND s."lineId" = ANY($2::uuid[])
    AND s."revertedAt" IS NULL
    AND ($3::timestamptz IS NULL OR s."settledAt" >= $3::timestamptz)
  ORDER BY s."lineId", s."settledAt", s.id
`;

/** One row of {@link BASKET_SETTLEMENTS_SQL}: one standing purchase in scope. */
export interface BasketSettlementRow {
  id: string;
  lineId: string;
  outcome: string;
  quantity: number;
  settledAt: Date;
  settledByParticipantId: string | null;
  /** Inside the skip window, by the database's clock. Read for `LIVE` alone. */
  fresh: boolean;
}

/**
 * "This skip still stands", for a `basket_line_skips` row aliased `k` (plan
 * 0137, section 3).
 *
 * A skip stands while nobody took it back **and** its basket has no standing
 * settlement on that line later than it. The second half is the whole of section
 * 3.1: the settle, the revert and any later path that buys through a basket end
 * a skip without naming one, because a rule that lives in one `WHERE` cannot be
 * forgotten by the fourth writer. A purchase taken back stops being standing, so
 * the skip comes back with no write either.
 *
 * It filters on **no outcome**. A close ends a skip that came before it and a
 * skip ends a close that came before it, so only the newer of the two acts is
 * ever left standing and the state order of plan 0130 section 4 then answers
 * correctly in both directions.
 *
 * One definition, read by the basket and by the two writes, so none of them can
 * disagree with the others about what is still skipped.
 */
export const SKIP_STANDS = `
    k."revertedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "line_settlements" s
      WHERE s."basketId" = k."basketId"
        AND s."lineId" = k."lineId"
        AND s."revertedAt" IS NULL
        AND s."settledAt" > k."skippedAt"
    )`;

/**
 * The standing skips of one basket, newest per line. `$1` is the basket, `$2`
 * the skip window in milliseconds (plan 0137, section 3).
 *
 * A skip **stands** while it was not taken back and this basket has no standing
 * settlement on that line later than it. That second half is the whole of
 * section 3.1: the settle, the revert and any later path that buys through a
 * basket end a skip without naming one, because a rule that lives in one
 * `WHERE` cannot be forgotten by the fourth writer, and a purchase taken back
 * puts the skip back with no write either.
 *
 * **It filters on no outcome**, on purpose. A close ends a skip that came before
 * it and a skip ends a close that came before it, so only the newer of the two
 * acts is left standing and the state order of plan 0130 section 4 then gives
 * the right answer in both directions.
 *
 * `fresh` is the twelve hour window, computed against the database's `now()` for
 * the reason {@link BASKET_SESSION_SQL} gives about its own: two readers must
 * agree, and `basket-rows.ts` receives booleans and never a clock.
 *
 * The `NOT EXISTS` is one index lookup per standing skip on
 * `ix_settlements_basket_line`, and a basket holds a handful of skips.
 */
export const STANDING_SKIPS_SQL = `
  SELECT DISTINCT ON (k."lineId")
         k."lineId" AS "lineId",
         k."skippedAt" AS "skippedAt",
         k."skippedByParticipantId" AS "skippedByParticipantId",
         (k."skippedAt" > now() - ($2::double precision * interval '1 millisecond'))
           AS "fresh"
  FROM "basket_line_skips" k
  WHERE k."basketId" = $1::uuid
    AND ${SKIP_STANDS}
  ORDER BY k."lineId", k."skippedAt" DESC, k.id DESC
`;

/**
 * Which of these lines already carry a standing skip of this basket. `$1` is the
 * basket, `$2` the line ids.
 *
 * The `PUT` asks it through its own transaction's manager, so it sees the
 * purchases and the skips that transaction has written, and inserts a row only
 * for an entry that has none (plan 0137, section 5.1). That is what makes a
 * second `PUT` write nothing.
 *
 * It shares {@link SKIP_STANDS} with the read, which is the point: a skip the
 * read calls standing and the write calls gone would let one row be skipped
 * twice.
 */
export const STANDING_SKIP_LINES_SQL = `
  SELECT DISTINCT k."lineId" AS "lineId"
  FROM "basket_line_skips" k
  WHERE k."basketId" = $1::uuid
    AND k."lineId" = ANY($2::uuid[])
    AND ${SKIP_STANDS}
`;

/**
 * Which of these lines this basket holds an unreverted skip on. `$1` is the
 * basket, `$2` the line ids.
 *
 * The `DELETE` asks it under the lock, immediately before
 * {@link REVERT_SKIPS_SQL}, so it knows which entries actually changed and
 * announces those alone.
 *
 * **Standing or not**, which is where it differs from
 * {@link STANDING_SKIP_LINES_SQL}: section 5.2 marks a skip a purchase already
 * ended, so it has to name one too.
 *
 * A separate statement rather than a `RETURNING` on the update, because what
 * TypeORM's `manager.query` hands back for an `UPDATE ... RETURNING` is not the
 * plain row array a `SELECT` gives, and a rule that only works when the driver
 * shapes its answer a particular way is a rule that breaks silently: the
 * announce simply stops firing, and nothing fails.
 */
export const UNREVERTED_SKIP_LINES_SQL = `
  SELECT DISTINCT k."lineId" AS "lineId"
  FROM "basket_line_skips" k
  WHERE k."basketId" = $1::uuid
    AND k."lineId" = ANY($2::uuid[])
    AND k."revertedAt" IS NULL
`;

/**
 * Take back every skip this basket still holds on these lines. `$1` is the
 * basket, `$2` the line ids, `$3` the participant taking them back.
 *
 * **Standing or not** (plan 0137, section 5.2). Marking one a purchase already
 * ended costs nothing and leaves no stray row that a later revert of that
 * purchase could bring back to life. Finding none is not an error.
 */
export const REVERT_SKIPS_SQL = `
  UPDATE "basket_line_skips" k
  SET "revertedAt" = now(),
      "revertedByParticipantId" = $3::uuid
  WHERE k."basketId" = $1::uuid
    AND k."lineId" = ANY($2::uuid[])
    AND k."revertedAt" IS NULL
`;

/**
 * One line id, as {@link STANDING_SKIP_LINES_SQL} and
 * {@link UNREVERTED_SKIP_LINES_SQL} answer it.
 */
export interface BasketSkipLineRow {
  lineId: string;
}

/** One row of {@link STANDING_SKIPS_SQL}: one line's newest standing skip. */
export interface BasketLineSkipRow {
  lineId: string;
  skippedAt: Date;
  skippedByParticipantId: string;
  fresh: boolean;
}

/**
 * "This basket holds no fresh skip on this line" (plan 0137, section 5.4).
 *
 * A household is told "Marta is buying this" so that nobody buys it twice, and
 * Marta has said she is not buying it today, so the line is free again. The
 * claim and the coverage test both ask it, from the one definition, so a line
 * the suggestions offer back while the claim calls it taken cannot happen.
 *
 * **Fresh, not merely standing.** A skip that outlived its window says nothing
 * about the claim any more, and a stale one holding a line free for ever would
 * be a claim that expired quietly rather than one that was released.
 *
 * When the window runs out **no event fires**, because nothing happened except
 * the clock: a cold read says claimed and a socket that was listening still says
 * free until the next event on that line. Plan 0052 section 4.1 accepted exactly
 * that for the claim window itself, and a sweep emitting an event per expired
 * skip is more machinery than a twelve hour courtesy deserves.
 */
export function noFreshSkip(
  basketAlias: string,
  lineAlias: string,
  windowParam: string
): string {
  return `NOT EXISTS (
    SELECT 1
    FROM "basket_line_skips" k
    WHERE k."basketId" = ${basketAlias}.id
      AND k."lineId" = ${lineAlias}.id
      AND k."skippedAt"
          > now() - (${windowParam}::double precision * interval '1 millisecond')
      AND ${SKIP_STANDS}
  )`;
}

/**
 * "An open trip covers this line's list", as one fragment (plan 0136, section
 * 7.3).
 *
 * The claim and the suggestions both ask it, and they are written against this
 * one definition so that they cannot disagree: a line the suggestions call
 * claimed and the claim calls free would put the same line in two states on one
 * screen.
 *
 * `lineAlias` is the `list_lines` row being asked about, `sinceParam` is the
 * oldest a basket may have been generated and still claim anything, which is
 * `LineClaimService.since`, and `skipWindowParam` is `LineClaimService.skipWindow`.
 *
 * **A basket a shopper skipped this line on does not cover it** (plan 0137,
 * section 5.4). The suggestions share the fragment, so a skipped line can be
 * suggested to the household again, and that is the intended consequence rather
 * than an accident: nobody is out buying it.
 *
 * **It answers for `GENERATED` baskets alone.** The permanent basket has no
 * `basket_sources` rows, so the join excludes it before `OPEN_GENERATED_BASKET`
 * has to: it covers every list its owner can write, and a claim over all of them
 * would tell every household that somebody is always out buying everything.
 *
 * {@link WRITABLE_LIST} is imported rather than restated, so the claim and the
 * coverage cannot disagree about which lists a basket reads.
 */
export function openBasketCoversLine(
  lineAlias: string,
  sinceParam: string,
  skipWindowParam: string
): string {
  return `EXISTS (
    SELECT 1
    FROM "shopping_lists" sl
    JOIN "basket_sources" bs
      ON bs."zoneId" = sl."zoneId"
     AND (bs."listId" IS NULL OR bs."listId" = sl.id)
    JOIN "generated_lists" gl ON gl.id = bs."basketId"
    JOIN "zone_memberships" m
      ON m."zoneId" = sl."zoneId" AND m."userId" = gl."ownerUserId"
    WHERE sl.id = ${lineAlias}."listId"
      AND ${OPEN_GENERATED_BASKET}
      AND gl."generatedAt" >= ${sinceParam}::timestamptz
      AND ${WRITABLE_LIST}
      AND ${noFreshSkip('gl', lineAlias, skipWindowParam)}
  )`;
}

/**
 * The lists a reader was served, named for a caption. `$1` is the list ids.
 *
 * One query rather than `namesOfLists` plus a second read for the zone, because
 * `BasketListRef` carries the zone's id as well as its name and the caption
 * ("from Weekly shop, in Flat 3B") needs both.
 *
 * **It does no access check and must not be called without one.** The caller
 * passes the lists the redaction has already decided are served, which is the
 * rule `namesOfLists` states for itself: a reader who may not have the names
 * costs no query rather than costing one and having the answer discarded.
 *
 * A list deleted since simply drops out, which is the intended answer rather
 * than an error: naming fewer households is better than a raw id.
 */
export const BASKET_LIST_REFS_SQL = `
  SELECT sl.id AS "listId",
         sl.name AS "name",
         sl."zoneId" AS "zoneId",
         z.name AS "zoneName"
  FROM "shopping_lists" sl
  JOIN "zones" z ON z.id = sl."zoneId"
  WHERE sl.id = ANY($1::uuid[])
  ORDER BY z.name, sl.name, sl.id
`;

/** One row of {@link BASKET_LIST_REFS_SQL}. */
export interface BasketListRefRow {
  listId: string;
  name: string;
  zoneId: string;
  zoneName: string;
}
