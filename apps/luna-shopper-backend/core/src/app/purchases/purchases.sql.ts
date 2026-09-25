import { GENERATED_BASKET } from '../baskets/open-basket.sql';
import { READABLE_LIST } from '../zones/zone-summary.sql';

/**
 * The reads behind one person's history of purchases (plan 0142).
 *
 * Raw SQL for the reason `trips.sql.ts` gives, and every camelCase column is
 * quoted by hand for the same one: TypeORM rewrites no `alias.property` inside
 * a raw select expression, and every rule here is a `WHERE`, a `UNION` or a
 * window that no mocked repository could prove.
 *
 * ## Read only
 *
 * Every number is derived on read from `line_settlements`. This plan adds one
 * index and no column, so a history cannot drift from the purchases it counts
 * and there is nothing to backfill.
 *
 * ## It is not the trips read, and not plan 0141's either
 *
 * `trips.sql.ts` answers "what touched **this list**", for anybody who can read
 * the list. This answers "what did **I** buy", across every list and every
 * basket, for one account. Plan 0141's walk order reads only the first of the
 * three routes below, on purpose (plan 0141, section 3.1). Three questions,
 * three fragments, and merging any two of them would give one of them the
 * wrong rows.
 */

/**
 * The standing settlements that are one person's, by any of three routes
 * (section 2). `$1` is the reader.
 *
 * 1. **Made through a basket they own**, of either kind, by anybody. Somebody
 *    who shops a friend's basket bought for the friend's trip, and the friend's
 *    history is where that trip is.
 * 2. **Settled by them on the list page**: `settledByUserId` is theirs.
 * 3. **Settled by them on somebody else's basket**: a participant row carrying
 *    their `userId`. Live or ended, because being removed from a basket
 *    afterwards does not unbuy the bread.
 *
 * **A `UNION` of three indexed reads, and never one `WHERE` with two `OR`s**,
 * which no index serves. The arms ride `ix_baskets_owner` then
 * `ix_settlements_basket_live`; `ix_settlements_user`; and
 * `ix_basket_participants_user` (section 9) then
 * `ix_settlements_participant`. `UNION` rather than `UNION ALL`, because a
 * purchase reachable by two routes is one purchase.
 *
 * `revertedAt IS NULL` is the definition of a purchase that counts, as
 * everywhere else in core.
 */
export const PERSON_PURCHASES_CTE = `
  "mine" AS (
    SELECT s.id, s."lineId", s."listId", s."itemId", s."basketId", s."outcome",
           s."quantity", s."settledAt", s."pricePaidCents", s."pricePaidCurrency",
           s."priceScopeId", s."supermarketLocationId"
    FROM "baskets" gl
    JOIN "line_settlements" s ON s."basketId" = gl.id
    WHERE gl."ownerUserId" = $1::uuid
      AND s."revertedAt" IS NULL
    UNION
    SELECT s.id, s."lineId", s."listId", s."itemId", s."basketId", s."outcome",
           s."quantity", s."settledAt", s."pricePaidCents", s."pricePaidCurrency",
           s."priceScopeId", s."supermarketLocationId"
    FROM "line_settlements" s
    WHERE s."settledByUserId" = $1::uuid
      AND s."revertedAt" IS NULL
    UNION
    SELECT s.id, s."lineId", s."listId", s."itemId", s."basketId", s."outcome",
           s."quantity", s."settledAt", s."pricePaidCents", s."pricePaidCurrency",
           s."priceScopeId", s."supermarketLocationId"
    FROM "basket_participants" p
    JOIN "line_settlements" s ON s."settledByParticipantId" = p.id
    WHERE p."userId" = $1::uuid
      AND s."revertedAt" IS NULL
  )`;

/**
 * Which of the reader's purchases belong to a basket of their own.
 *
 * The test is plan 0134 section 4.1's, narrowed by ownership: a purchase is a
 * `BASKET` entry's when its `basketId` names a `GENERATED` basket **the reader
 * owns**. Every other purchase of {@link PERSON_PURCHASES_CTE} is in a session.
 *
 * So a purchase the reader made on somebody **else's** `GENERATED` basket lands
 * in a session and not under that basket's name (section 3.1). The name is the
 * owner's to show, the reader can since have been removed from the basket, and
 * plan 0122 section 5 kept the disclosure of a basket's name to readers of a
 * list it drew from.
 *
 * A `LEFT JOIN` and not an `EXISTS`, because the basket's id is the entry's id.
 */
const TAGGED_CTE = `
  "tagged" AS (
    SELECT m.*, gl.id AS "ownBasketId"
    FROM "mine" m
    LEFT JOIN "baskets" gl
      ON gl.id = m."basketId"
     AND ${GENERATED_BASKET}
     AND gl."ownerUserId" = $1::uuid
  )`;

/**
 * The session window: number the reader's basketless purchases into sessions.
 *
 * `gapParam` is {@link PURCHASE_SESSION_GAP_MS}. `narrowing` is an extra
 * predicate on the purchases the window is computed over, and is empty when
 * there is none.
 *
 * Four steps, the technique of `LOOSE_ROWS_CTE` (plan 0122) over one person
 * rather than over one list:
 *
 * 1. `loose`: the purchases that belong to no basket of the reader's.
 * 2. `marked`: a purchase starts a session when the one before it is more than
 *    the gap away. The first has no predecessor, so `LAG` is null, the
 *    comparison is null and it lands in session zero, which is what it should
 *    do.
 * 3. `numbered`: the running sum of those marks numbers the sessions.
 * 4. `sessioned`: a session's id is the id of its earliest settlement, which is
 *    stable while the session grows at its newer end.
 *
 * The order is `(settledAt, id)` throughout, so two purchases written in the
 * same microsecond still have one answer to "which came first". A session is
 * elapsed time across lists and across baskets: a person in one shop ticking
 * two households' lists made one trip, and no calendar day is involved, so no
 * time zone is either.
 */
function sessionWindowCtes(gapParam: string, narrowing: string): string {
  return `
  "loose" AS (
    SELECT t.*
    FROM "tagged" t
    WHERE t."ownBasketId" IS NULL ${narrowing}
  ),
  "marked" AS (
    SELECT l.*,
           CASE
             WHEN l."settledAt" - LAG(l."settledAt") OVER w
                  > (${gapParam}::double precision * interval '1 millisecond')
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
  "sessioned" AS (
    SELECT n.*,
           FIRST_VALUE(n."id") OVER (
             PARTITION BY n."session" ORDER BY n."settledAt", n."id"
           ) AS "entryId"
    FROM "numbered" n
  )`;
}

/**
 * A page of a person's history, newest first (section 3.2).
 *
 * `$1` the reader, `$2` {@link PURCHASE_SESSION_GAP_MS}, `$3` the cursor
 * entry's id or null, `$4` its kind or null, `$5` the limit plus one.
 *
 * ## Where an entry starts
 *
 * A `BASKET` entry starts at its basket's `generatedAt` and a `SESSION` at its
 * earliest `settledAt`, as a trip does in `TRIPS_CTE`. Both are one primary key
 * read from the source table, so the cursor carries `{ kind, id }` and the
 * boundary is looked up here at full precision: an ISO timestamp in a token is
 * milliseconds and a `timestamptz` is microseconds, so a token carrying the
 * value would skip or repeat the boundary row.
 *
 * A `GENERATED` basket lives at most the claim window before the sweep finishes
 * it, so its `generatedAt` and its shopping are days apart at most.
 *
 * ## The window can be narrowed from above, and only for a session boundary
 *
 * A session's id names its earliest settlement, so the silence before that
 * moment is longer than the gap and every purchase before it belongs to
 * sessions that are whole. That is the `"loose"` predicate, and it is a cost
 * saving that changes no answer.
 *
 * It is **not** applied when the boundary is a basket: a session can straddle a
 * basket's `generatedAt`, and cutting the window there would report half a
 * session. There is no lower bound either, for the reason `trips.sql.ts` gives:
 * where a session starts depends on every purchase before it.
 *
 * **A reverted boundary still works.** The boundary row is read from
 * `line_settlements` whether or not it still stands, so a session whose first
 * purchase was taken back after the page was served continues from the same
 * moment.
 *
 * `narrow` is that predicate, and it is a parameter so a spec can run the
 * statement without it and assert the same entries come back. A narrowing that
 * changed an answer would be a bug, and the only honest way to say so is to
 * compare the two.
 *
 * ## The numbers
 *
 * `spentCents` multiplies with a `::bigint` cast before the multiplication,
 * because a sum of cents over a long history passes `int` long before it means
 * anything else is wrong. It is null and never zero when nothing in the entry
 * carries a price, and `unpricedCount` says how much of the sum is missing
 * (section 3.3).
 *
 * A line since soft deleted (plan 0132) still counts: it was bought. A
 * settlement whose line is gone for good cascaded away with it, so there is
 * nothing to skip.
 */
export function purchaseEntriesSql(narrow = true): string {
  return `
  WITH ${PERSON_PURCHASES_CTE},
  "boundary" AS (
    SELECT b."at", b."id"
    FROM (
      SELECT gl."generatedAt" AS "at", gl.id AS "id"
      FROM "baskets" gl
      WHERE $4::text = 'BASKET' AND gl.id = $3::uuid
      UNION ALL
      SELECT s."settledAt" AS "at", s.id AS "id"
      FROM "line_settlements" s
      WHERE $4::text = 'SESSION' AND s.id = $3::uuid
    ) b
  ),
  ${TAGGED_CTE},
  ${sessionWindowCtes(
    '$2',
    narrow
      ? `AND (
      $4::text IS DISTINCT FROM 'SESSION'
      OR t."settledAt" < (SELECT b."at" FROM "boundary" b)
    )`
      : ''
  )},
  "purchases" AS (
    SELECT 'SESSION'::text AS "kind", x."entryId" AS "entryId", x."lineId",
           x."outcome", x."quantity", x."settledAt", x."pricePaidCents",
           x."pricePaidCurrency"
    FROM "sessioned" x
    UNION ALL
    SELECT 'BASKET'::text, t."ownBasketId", t."lineId",
           t."outcome", t."quantity", t."settledAt", t."pricePaidCents",
           t."pricePaidCurrency"
    FROM "tagged" t
    WHERE t."ownBasketId" IS NOT NULL
  ),
  "entry_lines" AS (
    SELECT p."kind", p."entryId", p."lineId",
           COALESCE(SUM(p."quantity") FILTER (WHERE p."outcome" = 'BOUGHT'), 0)::int
             AS "bought",
           SUM(p."pricePaidCents"::bigint * p."quantity")
             FILTER (WHERE p."outcome" = 'BOUGHT' AND p."pricePaidCents" IS NOT NULL)
             AS "spent",
           BOOL_OR(p."outcome" = 'BOUGHT' AND p."pricePaidCents" IS NULL) AS "unpriced",
           -- Plan 0143, section 7: how many currencies the priced rows carry,
           -- and which one when they carry exactly one. An entry whose rows
           -- carry two has no total, and the mapper is what decides that.
           COUNT(DISTINCT p."pricePaidCurrency")
             FILTER (WHERE p."outcome" = 'BOUGHT' AND p."pricePaidCents" IS NOT NULL)
             AS "currencies",
           MIN(p."pricePaidCurrency")
             FILTER (WHERE p."outcome" = 'BOUGHT' AND p."pricePaidCents" IS NOT NULL)
             AS "currency",
           MIN(p."settledAt") AS "firstAt",
           MAX(p."settledAt") AS "lastAt"
    FROM "purchases" p
    GROUP BY p."kind", p."entryId", p."lineId"
  ),
  "entries" AS (
    SELECT e."kind", e."entryId" AS "id",
           MIN(e."firstAt") AS "firstAt",
           MAX(e."lastAt") AS "endedAt",
           COUNT(*)::int AS "lineCount",
           (COUNT(*) FILTER (WHERE e."bought" > 0))::int AS "boughtLineCount",
           SUM(e."spent")::bigint AS "spentCents",
           -- Two currencies anywhere below make two here, whether they met on
           -- one line or across two. Counting the lines own currency column
           -- alone would miss the first case, because that column is already a
           -- MIN over the line's values and a line carrying two answers with
           -- one of them. So a line that said two is carried up, not recounted.
           (CASE
              WHEN MAX(e."currencies") > 1 THEN 2
              ELSE COUNT(DISTINCT e."currency")
            END)::int AS "currencies",
           MIN(e."currency") AS "currency",
           (COUNT(*) FILTER (WHERE e."unpriced"))::int AS "unpricedCount"
    FROM "entry_lines" e
    GROUP BY e."kind", e."entryId"
  ),
  "dated" AS (
    SELECT e.*,
           gl."name"::text AS "name",
           COALESCE(gl."status"::text = 'OPEN', false) AS "open",
           COALESCE(gl."generatedAt", e."firstAt") AS "startedAt"
    FROM "entries" e
    LEFT JOIN "baskets" gl ON e."kind" = 'BASKET' AND gl.id = e."id"
  )
  SELECT d."id", d."kind", d."name", d."open", d."startedAt", d."endedAt",
         d."lineCount", d."boughtLineCount", d."spentCents", d."currencies",
         d."currency", d."unpricedCount"
  FROM "dated" d
  WHERE $3::uuid IS NULL
     OR (d."startedAt", d."id") < (SELECT b."at", b."id" FROM "boundary" b)
  ORDER BY d."startedAt" DESC, d."id" DESC
  LIMIT $5
`;
}

/** The statement the service runs. */
export const PURCHASE_ENTRIES_SQL = purchaseEntriesSql();

/**
 * The rows of one entry, folded and located. `readerParam` is the reader and
 * `cursorParam` the boundary row's id or null; both reads below select this.
 *
 * ## One row per `(lineId, itemId, pricePaidCents, pricePaidCurrency)`
 *
 * Three partial settles of one milk at one price are one row of three. The same
 * milk at two prices, which is two shops in one session, is two rows, because a
 * history that averaged them says a price nobody paid. The currency is part of
 * the key for the same reason (plan 0143, section 7): 120 in two currencies is
 * two prices, and folding them would report one.
 *
 * The scope and the shop ride the group rather than keying it, and each is
 * served only when the whole group agrees on it. Two shops charging the same
 * for the same milk fold into one row, and naming either of them would say the
 * shopping happened somewhere it may not have; null is the same answer `spent`
 * gives when two currencies meet, for the same reason.
 *
 * A group holding any `BOUGHT` row reads `BOUGHT`, and the units are that
 * group's standing bought units. A line whose only word in this entry is
 * `NOT_AVAILABLE` is one row of zero; a line with both is its bought rows
 * alone, which is what `"kept"` drops.
 *
 * ## The five location fields (section 4)
 *
 * Served while {@link READABLE_LIST} holds for the reader on the line's list
 * **at request time**, and null together otherwise. Interpolated with its usual
 * aliases, `sl` the list and `m` the reader's membership of its zone, joined
 * with a `LEFT JOIN` so a reader who left the zone gets nulls rather than a
 * missing row: it is still their purchase, which is why the row is served at
 * all, and it is no longer their household's list, which is why the row does
 * not say what the line is called today or where it lives.
 *
 * `content` carries no `deletedAt` predicate. A soft deleted line (plan 0132)
 * still serves its text, because the purchase is what it is there to show.
 *
 * ## The order and the cursor
 *
 * `(MIN(settledAt), MIN(id))` ascending, which is the order the shopper walked.
 * The cursor carries the row's id and the boundary is looked up in SQL, at full
 * precision, for the reason the entries read gives.
 */
function foldedRows(readerParam: string, cursorParam: string): string {
  return `
  "folded" AS (
    SELECT e."lineId", e."itemId", e."pricePaidCents", e."pricePaidCurrency",
           (ARRAY_AGG(e.id ORDER BY e."settledAt", e.id))[1] AS "id",
           MIN(e."settledAt") AS "settledAt",
           COALESCE(SUM(e."quantity") FILTER (WHERE e."outcome" = 'BOUGHT'), 0)::int
             AS "quantity",
           BOOL_OR(e."outcome" = 'BOUGHT') AS "anyBought",
           -- Served only when every row of the group names it and they all
           -- name the same one (plan 0143, section 6). Both halves matter: two
           -- shops charging the same fold into one row, and naming either
           -- would say the shopping happened somewhere it may not have, while
           -- a group where only some rows named a shop knows less than one
           -- value would claim.
           --
           -- An ordered array rather than MIN, which Postgres does not define
           -- over uuid.
           CASE
             WHEN COUNT(DISTINCT e."priceScopeId") = 1
              AND COUNT(e."priceScopeId") = COUNT(*)
             THEN (ARRAY_AGG(DISTINCT e."priceScopeId"))[1]
           END AS "priceScopeId",
           CASE
             WHEN COUNT(DISTINCT e."supermarketLocationId") = 1
              AND COUNT(e."supermarketLocationId") = COUNT(*)
             THEN (ARRAY_AGG(DISTINCT e."supermarketLocationId"))[1]
           END AS "supermarketLocationId"
    FROM "entry" e
    GROUP BY e."lineId", e."itemId", e."pricePaidCents", e."pricePaidCurrency"
  ),
  "kept" AS (
    SELECT f.*
    FROM "folded" f
    WHERE f."anyBought"
       OR NOT EXISTS (
         SELECT 1 FROM "folded" o
         WHERE o."lineId" = f."lineId" AND o."anyBought"
       )
  ),
  "located" AS (
    SELECT k.*,
           sl.id AS "listId",
           sl."name" AS "listName",
           sl."zoneId" AS "zoneId",
           ll."content" AS "content",
           COALESCE((${READABLE_LIST}), false) AS "readable"
    FROM "kept" k
    LEFT JOIN "list_lines" ll ON ll.id = k."lineId"
    LEFT JOIN "shopping_lists" sl ON sl.id = ll."listId"
    LEFT JOIN "zone_memberships" m
      ON m."zoneId" = sl."zoneId" AND m."userId" = ${readerParam}::uuid
  )
  SELECT k."id",
         k."itemId",
         CASE WHEN k."anyBought" THEN 'BOUGHT' ELSE 'NOT_AVAILABLE' END AS "outcome",
         k."quantity",
         k."pricePaidCents",
         k."pricePaidCurrency",
         k."priceScopeId",
         k."supermarketLocationId",
         k."settledAt",
         CASE WHEN k."readable" THEN k."lineId" END AS "lineId",
         CASE WHEN k."readable" THEN k."listId" END AS "listId",
         CASE WHEN k."readable" THEN k."listName" END AS "listName",
         CASE WHEN k."readable" THEN k."zoneId" END AS "zoneId",
         CASE WHEN k."readable" THEN k."content" END AS "content"
  FROM "located" k
  WHERE ${cursorParam}::uuid IS NULL
     OR (k."settledAt", k."id") > (
       SELECT b."settledAt", b.id
       FROM "line_settlements" b
       WHERE b.id = ${cursorParam}::uuid
     )
  ORDER BY k."settledAt", k."id"
  LIMIT`;
}

/**
 * The rows of one `BASKET` entry. `$1` the reader, `$2` the basket, `$3` the
 * cursor row's id or null, `$4` the limit.
 *
 * The entry is `basketId = $2` restricted to a `GENERATED` basket whose owner
 * is the reader, which is exactly what makes it the reader's entry: a basket
 * they do not own is not in their history under its name, and its purchases
 * reach them through a session instead.
 *
 * Its rows are every standing purchase made through it, **by anybody**. A
 * basket is one household's trip however many people shopped it.
 */
export const PURCHASE_BASKET_ROWS_SQL = `
  WITH "entry" AS (
    SELECT s.id, s."lineId", s."itemId", s."outcome", s."quantity",
           s."settledAt", s."pricePaidCents", s."pricePaidCurrency",
           s."priceScopeId", s."supermarketLocationId"
    FROM "line_settlements" s
    JOIN "baskets" gl ON gl.id = s."basketId"
    WHERE s."basketId" = $2::uuid
      AND s."revertedAt" IS NULL
      AND ${GENERATED_BASKET}
      AND gl."ownerUserId" = $1::uuid
  ),
  ${foldedRows('$1', '$3')} $4
`;

/**
 * The rows of one `SESSION` entry. `$1` the reader, `$2`
 * {@link PURCHASE_SESSION_GAP_MS}, `$3` the session, `$4` the cursor row's id
 * or null, `$5` the limit.
 *
 * It recomputes the window of the entries read **without the narrowing** and
 * keeps `entryId = $3`, as `LOOSE_TRIP_ROWS_SQL` does: where a session starts
 * depends on every purchase before it, so the window cannot be cut to the one
 * session being read.
 */
export const PURCHASE_SESSION_ROWS_SQL = `
  WITH ${PERSON_PURCHASES_CTE},
  ${TAGGED_CTE},
  ${sessionWindowCtes('$2', '')},
  "entry" AS (
    SELECT x.id, x."lineId", x."itemId", x."outcome", x."quantity",
           x."settledAt", x."pricePaidCents", x."pricePaidCurrency",
           x."priceScopeId", x."supermarketLocationId"
    FROM "sessioned" x
    WHERE x."entryId" = $3::uuid
  ),
  ${foldedRows('$1', '$4')} $5
`;

/** One row of {@link PURCHASE_ENTRIES_SQL}. */
export interface PurchaseEntryRow {
  id: string;
  kind: string;
  name: string | null;
  open: boolean;
  startedAt: string | Date;
  endedAt: string | Date;
  lineCount: number;
  boughtLineCount: number;
  /** A `bigint`, which the driver hands back as a string. Null when unpriced. */
  spentCents: string | number | null;
  /**
   * How many currencies the entry's priced purchases carry, and which one when
   * they carry exactly one (plan 0143, section 7). Two of them have no total,
   * and the mapper is what decides that.
   */
  currencies: number;
  currency: string | null;
  unpricedCount: number;
}

/** One row of either rows read. */
export interface PurchaseLineRow {
  id: string;
  itemId: string | null;
  outcome: string;
  quantity: number;
  pricePaidCents: number | null;
  pricePaidCurrency: string | null;
  /** Null when the folded group did not agree on one (plan 0143, section 6). */
  priceScopeId: string | null;
  supermarketLocationId: string | null;
  settledAt: string | Date;
  lineId: string | null;
  listId: string | null;
  listName: string | null;
  zoneId: string | null;
  content: string | null;
}
