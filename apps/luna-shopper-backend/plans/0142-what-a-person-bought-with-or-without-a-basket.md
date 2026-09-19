# 0142: what a person bought, with or without a basket

> Part of the series recorded in `0130`. Needs `0134` (a purchase names its basket) and
> `0135` (what a trip asked, written down when it ends). Client half: velista `0095`.
>
> The history page reads baskets by owner (`GeneratedListService.listMine`,
> `generated-list.service.ts:651`). That was the whole history while a purchase needed a
> basket. It does not any more: the `LIVE` basket is one row that never ends, and the
> redesign says a purchase needs no trip (`0130` section 9). A person who never creates a
> basket therefore has a history page with nothing on it, however much they buy. The same
> assumption sits in the suggestions of plan `0123`: the staple rule counts a list's ended
> **basket** trips and refuses to speak below four of them
> (`suggestions.constants.ts:31-34`), so that household gets no staples either.
>
> This plan adds the read a history is made of, which is a read of `line_settlements` and
> not of baskets, and teaches the suggestions that a session is a trip. It also takes the
> word "loose" off the wire, because `0130` section 3 says the screen never says it and a
> wire that says it keeps putting it back.
>
> Prerequisite reading: `0130` sections 3, 4, 6, 9 and 13. `0134` in full (the column, the
> two indexes, `PURCHASE_SESSION_GAP_MS`, which purchase belongs to which kind of trip).
> `0135` (`basket_trip_rows`). Plan `0122` in full, because the union, the id only cursor
> and the window are its technique and are copied here. Plan `0123` sections 2 to 5. Then
> `core/src/app/lists/trips/trips.sql.ts`, `core/src/app/lists/suggestions/` and
> `core/src/app/zones/zone-summary.sql.ts:67` (`READABLE_LIST`).

## Brief for the agent

### Objective

Build `GET /v1/purchases/sessions` and `GET /v1/purchases/sessions/:kind/:id/rows`, make the
suggestions of plan `0123` count sessions as trips, rename `TripKind.LOOSE` to `SESSION`
everywhere it is spoken, and regenerate the OpenAPI document and the wire types.

### Context

- `line_settlements` after `0134`: `lineId`, `listId`, `itemId`, `outcome`, `quantity`,
  `settledByUserId`, `settledByParticipantId` (exactly one of the two, by
  `ck_line_settlements_actor`), `settledAt`, `revertedAt`, `basketId` (no foreign key,
  null for a purchase made on the list page), `pricePaidCents` (null until `0143` fills
  it). Indexes: `ix_settlements_line`, `ix_settlements_item`, `ix_settlements_list`,
  `ix_settlements_participant`, and from `0134` `ix_settlements_basket_live` on
  `("basketId", "lineId", "settledAt")` and `ix_settlements_user` on `("settledByUserId",
  "settledAt" DESC)`, which `0134` created for this plan.
- `generated_lists` after `0133`: `kind` (`LIVE`, `GENERATED`), `status` (`OPEN`,
  `FINISHED`, `ARCHIVED`), `ownerUserId`, `name`, `generatedAt`.
- `basket_trip_rows` after `0135`: `(basketId, zoneId, listId, lineId, asked)`, written
  when a `GENERATED` basket is finished and deleted when it is reopened.
- `generated_list_participants."userId"` is set for an owner and a registered participant
  and null for a guest. The only index that leads with it is
  `ix_generated_list_participants_user_live`, which is partial on `"revokedAt" IS NULL`
  (`generated-list-participant.entity.ts:40-42`).
- Which purchase belongs to which kind of trip is `0134` section 4.1: a purchase is a
  basket's when `basketId` names a row of `generated_lists` whose `kind` is `GENERATED`.
  Every other standing purchase belongs to a session.
- `trips.sql.ts` pages a union of ended baskets and sessions in one keyset order, with a
  cursor of `{ kind, id }` and the boundary's sort key looked up from the source table,
  because an ISO timestamp loses the microseconds of a `timestamptz`.
- The suggestions service runs four statements, one after the other, and both rules are
  pure functions in `suggestion-rules.ts` that take `now` as an argument.

### Target state

Every acceptance criterion in section 13 holds, the SQL rules are proven by integration
specs against a real database, and `npx nx run-many -t lint test -p luna-shopper-backend-core
luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models
velista/models velista/data-access` is green with `openapi.json` and the wire types
regenerated.

### Scope

- Work only in:
  - a new `apps/luna-shopper-backend/core/src/app/purchases/` folder: module, NATS
    controller, service, SQL file, mappers, unit and integration specs.
  - `core/src/app/app.module.ts`, for the one import.
  - `core/src/app/lists/suggestions/` (the SQL file, the constants, the rules, the service
    and their specs) and `core/src/app/lists/trips/` (the literal `'LOOSE'` and nothing
    else).
  - one new migration in `core/src/app/db/migrations/` and its line in `index.ts`, and
    `generated-list-participant.entity.ts` for the index decorator.
  - `libs/luna-shopper/contracts`: a new `purchase.messages.ts`, its schemas, its patterns,
    `TripKind` in `enums/list.enums.ts`.
  - a new `apps/luna-shopper-backend/gateway/src/app/purchases/` (controller, DTOs, module)
    and `gateway/src/app/lists/list.controller.ts` for the path segment.
  - `libs/velista/models/src/lib/trips.ts` and `libs/velista/data-access/src/lib/trips/`,
    for the wire string and the path segment of section 7 alone.
  - the generated files.
- Do NOT touch: any settle or revert write, `LineSettlementView`, `listMine` and
  `GET /v1/generated-lists`, the claim, the trips' SQL beyond the literal, the velista
  copy and screens (velista `0095`), `0143`'s columns.

### Constraints

- **Read only.** Every number is derived on read. This plan adds one index and no column.
- `"revertedAt" IS NULL` is the definition of a purchase that counts, as everywhere else.
- An account only. The user id comes from the token and is never a parameter of the route.
- Cursors carry an id and never a timestamp (`0130` section 13).
- Every `@Query()` value lives on the DTO.
- One statement at a time, never two pooled connections in one request.
- No rule reads a clock. The service takes `now` once and hands it down.
- A row says where it was bought only while the reader holds `READ` on that list **now**.

### Action boundaries

- Proceed with in scope edits, the specs, the generators and the migration.
- Stop and ask if `0135` did not land `basket_trip_rows` with the columns above, or if
  `0134` named its indexes differently. Do not create a second index for the same read.
- Stop and ask before adding any event. Section 10 says why there is none.

### Progress evidence

Report after the entries read with its integration spec, after the rows read with its
spec, after the rename of section 7, and after the suggestions with their specs, each with
the spec run.

### Session strategy

Two independent halves. Sections 2 to 7 (the history) and section 8 (the suggestions) share
nothing but `0134`'s trip test. Build them as two commits and, if delegating, as two
subagents with those two bounded deliverables.

## 1. What is being built

| Piece                                                            | Where                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `GET /v1/purchases/sessions`                                     | gateway `purchases`, core `purchases`                      |
| `GET /v1/purchases/sessions/:kind/:id/rows`                      | the same                                                   |
| `PurchaseEntryView`, `PurchaseRowView`, the two page shapes      | contracts `purchase.messages.ts` and its schemas           |
| `ix_generated_list_participants_user`, replacing the partial one | one migration                                              |
| `TripKind.SESSION`, replacing `LOOSE`                            | contracts, `trips.sql.ts`, the gateway path, velista's map |
| suggestions that count sessions                                  | `core/src/app/lists/suggestions/`                          |

## 2. Whose purchases

A person's purchases are the standing settlements that are theirs by any of three routes:

1. **Made through a basket they own**, of either kind, by anybody. Somebody who shops a
   friend's basket bought for the friend's trip, and the friend's history is where the trip
   is.
2. **Settled by them on the list page**: `"settledByUserId"` is theirs.
3. **Settled by them on somebody else's basket**: `"settledByParticipantId"` names a
   participant row carrying their `"userId"`. Live or ended, because being removed from a
   basket afterwards does not unbuy the bread.

A purchase reachable by two routes is one purchase. It is written as a `UNION` of three
indexed reads and never as one `WHERE` with two `OR`s, which no index serves:

```sql
"mine" AS (
  SELECT s.id, s."lineId", s."listId", s."itemId", s."basketId", s."outcome",
         s."quantity", s."settledAt", s."pricePaidCents"
  FROM "generated_lists" gl
  JOIN "line_settlements" s ON s."basketId" = gl.id
  WHERE gl."ownerUserId" = $1::uuid
    AND s."revertedAt" IS NULL
  UNION
  SELECT s.id, s."lineId", s."listId", s."itemId", s."basketId", s."outcome",
         s."quantity", s."settledAt", s."pricePaidCents"
  FROM "line_settlements" s
  WHERE s."settledByUserId" = $1::uuid
    AND s."revertedAt" IS NULL
  UNION
  SELECT s.id, s."lineId", s."listId", s."itemId", s."basketId", s."outcome",
         s."quantity", s."settledAt", s."pricePaidCents"
  FROM "generated_list_participants" p
  JOIN "line_settlements" s ON s."settledByParticipantId" = p.id
  WHERE p."userId" = $1::uuid
    AND s."revertedAt" IS NULL
)
```

The three arms ride `ix_generated_lists_owner` then `ix_settlements_basket_live`,
`ix_settlements_user`, and `ix_generated_list_participants_user` (section 9) then
`ix_settlements_participant`. It is exported once, as `PERSON_PURCHASES_CTE`, from
`purchases.sql.ts`, and both reads below interpolate it.

**Not plan `0141`'s definition.** The walk order reads only the first route, on purpose
(`0141` section 3.1). Do not merge the two fragments.

## 3. The entries of a history

`GET /v1/purchases/sessions?cursor&limit`, an account.

```ts
interface PurchaseEntryView {
  id: string; // the basket id, or the id of the session's earliest settlement
  kind: TripKind; // 'BASKET' | 'SESSION' (section 7)
  name: string | null; // BASKET only. null is "shown as its date"
  open: boolean; // BASKET only: the basket's status is OPEN. false for a SESSION
  startedAt: string; // BASKET: generatedAt. SESSION: its earliest settledAt
  endedAt: string; // the newest settledAt in it
  lineCount: number; // distinct list lines it touched
  boughtLineCount: number; // of those, the ones with at least one unit bought
  spentCents: number | null; // section 3.3. null when no row carries a price
  unpricedCount: number; // bought lines with at least one purchase carrying no price
}

interface PurchaseEntryPage {
  items: PurchaseEntryView[]; // newest first
  nextCursor: string | null;
}
```

### 3.1 Which entry a purchase is in

- **`BASKET`**: the purchase names a `GENERATED` basket **the reader owns**. One entry per
  such basket that holds at least one standing purchase, open or finished. A basket nobody
  bought anything through is not in a history of purchases, which is the rule `0110` had
  for a trip. Its rows are every standing purchase made through it, by anybody.
- **`SESSION`**: every other purchase of section 2. That is the reader's `LIVE` basket
  (whoever tapped), the list page, and what the reader bought on other people's baskets.
  They are ordered by `("settledAt", id)` and a new session starts after a silence longer
  than `PURCHASE_SESSION_GAP_MS`, across lists and across baskets: a person in one shop
  ticking two households' lists made one trip. No calendar day, so no time zone.

A purchase the reader made on **another person's** `GENERATED` basket is in a session and
not under that basket's name. The name is the owner's to show, the reader can since have
been removed from it, and plan `0122` section 5 kept the disclosure of a basket's name to
readers of a list it drew from.

### 3.2 The statement

`$1` the reader, `$2` `PURCHASE_SESSION_GAP_MS`, `$3` the cursor entry's id or null, `$4`
its kind or null, `$5` the limit plus one.

```sql
WITH ${PERSON_PURCHASES_CTE},
"boundary" AS (
  SELECT b."at", b."id"
  FROM (
    SELECT gl."generatedAt" AS "at", gl.id AS "id"
    FROM "generated_lists" gl
    WHERE $4::text = 'BASKET' AND gl.id = $3::uuid
    UNION ALL
    SELECT s."settledAt" AS "at", s.id AS "id"
    FROM "line_settlements" s
    WHERE $4::text = 'SESSION' AND s.id = $3::uuid
  ) b
),
"tagged" AS (
  SELECT m.*, gl.id AS "ownBasketId"
  FROM "mine" m
  LEFT JOIN "generated_lists" gl
    ON gl.id = m."basketId"
   AND gl."kind" = 'GENERATED'
   AND gl."ownerUserId" = $1::uuid
),
"loose" AS (
  SELECT t.*
  FROM "tagged" t
  WHERE t."ownBasketId" IS NULL
    AND (
      $4::text IS DISTINCT FROM 'SESSION'
      OR t."settledAt" < (SELECT b."at" FROM "boundary" b)
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
  SELECT k.*, SUM(k."starts") OVER (ORDER BY k."settledAt", k."id") AS "session"
  FROM "marked" k
),
"sessioned" AS (
  SELECT n.*,
         FIRST_VALUE(n."id") OVER (
           PARTITION BY n."session" ORDER BY n."settledAt", n."id"
         ) AS "entryId"
  FROM "numbered" n
),
"purchases" AS (
  SELECT 'SESSION'::text AS "kind", x."entryId" AS "entryId", x."lineId", x."outcome",
         x."quantity", x."settledAt", x."pricePaidCents"
  FROM "sessioned" x
  UNION ALL
  SELECT 'BASKET'::text, t."ownBasketId", t."lineId", t."outcome",
         t."quantity", t."settledAt", t."pricePaidCents"
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
  LEFT JOIN "generated_lists" gl ON e."kind" = 'BASKET' AND gl.id = e."id"
)
SELECT d."id", d."kind", d."name", d."open", d."startedAt", d."endedAt",
       d."lineCount", d."boughtLineCount", d."spentCents", d."unpricedCount"
FROM "dated" d
WHERE $3::uuid IS NULL
   OR (d."startedAt", d."id") < (SELECT b."at", b."id" FROM "boundary" b)
ORDER BY d."startedAt" DESC, d."id" DESC
LIMIT $5
```

Rules the statement carries, each to be stated beside it:

- **A `BASKET` entry starts at `generatedAt` and a `SESSION` at its earliest `settledAt`**,
  as a trip does in `TRIPS_CTE`. Both are one primary key read from the source table, so
  the cursor carries `{ kind, id }` and the boundary is looked up at full precision.
  A `GENERATED` basket lives at most the claim window before the sweep finishes it, so its
  `generatedAt` and its shopping are days apart at most.
- **The window can be narrowed from above, and only when the boundary is a session.** A
  session's id names its earliest settlement, so the silence before that moment is longer
  than the gap, and every purchase before it belongs to sessions that are whole. That is
  the `"loose"` predicate. It is **not** applied when the boundary is a basket: a session
  can straddle a basket's `generatedAt`, and cutting it there reports half a session.
  `trips.sql.ts:113-115` says its window "cannot be narrowed to a page". That is true from
  below and is why there is no lower bound here either.
- **A reverted boundary still works.** The boundary row is read from `line_settlements`
  whether or not it still stands, so a session whose first purchase was taken back after
  the page was served continues from the same moment.
- `::bigint` before the multiplication, because a sum of cents over a long history passes
  `int` long before it means anything else is wrong. The mapper turns it into a number and
  answers null for a null sum.
- A line since soft deleted (`0132`) still counts. It was bought. A settlement whose line
  is gone for good cascaded away with it, so there is nothing to skip.

### 3.3 What it cost

`spentCents` is the sum of `pricePaidCents * quantity` over the entry's standing `BOUGHT`
purchases that carry a price, and null when none does. `pricePaidCents` is the price of
**one** unit (`0143` section 2). `unpricedCount` is how many bought lines hold at least one
purchase with no price, so a screen can say "12.40, and 3 lines with no price" instead of
passing a partial sum off as a total.

Before `0143` is built every `pricePaidCents` is null, `spentCents` is null everywhere and
`unpricedCount` equals `boughtLineCount`. That is a correct answer and needs no flag.
`0143` adds a currency beside the amount and changes `spentCents` and a row's
`pricePaidCents` into a money shape in its own section 7. This plan does not wait for it.
If `0143` is already built when this plan is, build the shapes of its section 7 directly
and read `spentCents` and `pricePaidCents` in this file as the names they replaced.

## 4. The rows of one entry

`GET /v1/purchases/sessions/:kind/:id/rows?cursor&limit`, an account, `kind` being `basket`
or `session`. The house page, 100 at most, in the order the purchases were made.

```ts
interface PurchaseRowView {
  id: string; // the earliest settlement of the row. The cursor's key
  itemId: string | null; // the product bought, or null for free text
  outcome: SettlementOutcome; // NOT_AVAILABLE only when nothing was bought
  quantity: number; // standing BOUGHT units. 0 for NOT_AVAILABLE
  pricePaidCents: number | null; // of one unit
  settledAt: string; // the row's earliest purchase
  // Served only while the reader holds READ on the list, and null together otherwise:
  lineId: string | null;
  listId: string | null;
  listName: string | null;
  zoneId: string | null;
  content: string | null;
}
```

- **One row per `(lineId, itemId, pricePaidCents)`** of the entry. Three partial settles of
  one milk at one price are one row of three. The same milk at two prices, which is two
  shops in one session, is two rows, because a history that averaged them says a price
  nobody paid.
- A line with a standing `NOT_AVAILABLE` and no unit bought is one row with `quantity` 0.
  A line with both is its bought rows alone.
- **Order**: `(MIN("settledAt"), MIN(id))` ascending, which is the order the shopper
  walked. The cursor carries the row's `id` and the boundary is looked up in SQL.
- **The five location fields** are served when `READABLE_LIST`
  (`zones/zone-summary.sql.ts:67`) holds for the reader on the line's list at request time,
  interpolated with its usual aliases (`sl` the list, `m` the reader's membership of its
  zone, joined with a `LEFT JOIN` so a reader who left the zone gets nulls and not a
  missing row). `content` is the line's text as it stands now, and a soft deleted line
  still serves it.
- **A reader who lost `READ`** gets the product, the quantity, the date and the price and
  nothing else. It is still their purchase, which is why the row is served at all. It is
  no longer their household's list, which is why the row does not say what the line is
  called today or where it lives. A free text row then identifies nothing, and the client
  draws it as a purchase on a list the reader no longer sees (velista `0095`).
- An entry that does not exist, is not the reader's, or has no standing purchase left
  answers the house not found error, with a cursor or without one, for the reason
  `TripsService.rows` gives: a reverted purchase can split a session and take its id away,
  and the client's answer is to read the entries again.
- A `BASKET` entry is `"basketId" = $2` restricted to a `GENERATED` basket whose
  `"ownerUserId"` is the reader. A `SESSION` entry recomputes the window of section 3.2
  without the narrowing and keeps `"entryId" = $2`, as `LOOSE_TRIP_ROWS_SQL` does.

**Messages.** `PURCHASE_PATTERNS.listSessions = 'purchase.listSessions'` with
`ListPurchaseSessionsRequest { userId, cursor?, limit? }`, and
`PURCHASE_PATTERNS.listSessionRows = 'purchase.listSessionRows'` with
`ListPurchaseSessionRowsRequest { userId, kind, entryId, cursor?, limit? }`. The gateway
DTOs are `ListPurchaseSessionsQueryDto` and `ListPurchaseSessionRowsQueryDto`, and the path
kind is lower case on the URL and upper cased by the gateway, as the trips route does it
(`list.controller.ts:321-334`). `PurchasesService` validates `kind` with the same guard and
the id against the same uuid pattern as `TripsService`, because both reach a `::uuid` cast.

## 5. What this discloses

Nothing a person did not already know, to nobody else. The read is the reader's own
purchases. What needs saying is the one case where it serves something they can no longer
reach: section 4 keeps a purchase on a list they left and withholds the list. A purchase
**made by somebody else** reaches a reader only through a basket the reader owns, where
they were always told who was on it.

It never serves `settledByUserId`, `settledByParticipantId` or `basketId`. Who tapped is
the basket screen's business and is attributed there.

## 6. What the old history becomes

`GET /v1/generated-lists` and `listMine` stay exactly as they are, minus the `LIVE` row
`0133` already excludes. They answer "the baskets I made", which the "My lists" tab and
the shared tab still need (velista `0085` section 5). What changes is which read the
**history** is: it reads this plan, and a finished basket appears in it as a `BASKET`
entry whose `id` opens the same basket page as before. `GeneratedListSummaryView` keeps its
four counts. velista `0095` decides what the page looks like.

## 7. `LOOSE` becomes `SESSION`

`0130` section 3: "The screen never says 'loose'." The wire stops saying it too, because
the word describes an absence (no basket) and the thing has a name now.

| Where                                                                   | Change                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `contracts/src/lib/enums/list.enums.ts:135-138`                         | `TripKind.LOOSE = 'LOOSE'` becomes `SESSION = 'SESSION'`     |
| `trips.sql.ts`: `'LOOSE'::text` in `TRIPS_CTE`, `$6::text = 'LOOSE'`    | `'SESSION'`. The CTE names stay until `0144` tidies them.    |
| `trips.service.ts:157`, `:203-205` and the message of the validation    | `BASKET or SESSION`                                          |
| `gateway/src/app/lists/list.controller.ts:321`                          | `enum: ['basket', 'session']`                                |
| `libs/velista/models/src/lib/trips.ts:15-17`                            | `TRIP_KINDS = ['BASKET', 'SESSION']`, fallback `'SESSION'`   |
| `tripPathKind` in the same file, and `trip-api.ts:49`                   | the segment `session`                                        |
| the trips schemas in contracts, `openapi.json`, the wire types          | regenerated                                                  |

No alias and no period where both are accepted. `0130` section 12 already says `dev` is not
releasable inside this series, and a gateway that answered both words is a second rule to
delete later. The velista edit is the wire string and the path segment alone: the copy
"Loose buys" (`libs/velista/ui/assets/i18n/en.json:673`) is velista `0095`'s.

## 8. Suggestions that count sessions

Plan `0123` section 4: a line is a staple when the list's recent **basket** trips nearly
always ask for it, over the last `STAPLE_TRIPS` (six) ended basket trips, and says nothing
below `STAPLE_MIN_TRIPS` (four). Section 5: a suggestion's `quantity` is what "the newest
ended basket trip asked for". A household that shops from the `LIVE` basket has no basket
trips, so it has no staples and every quantity falls back.

### 8.1 What a trip is, for a suggestion

The ended trips of a list are the union plan `0122` already serves, read by one new
statement, `SUGGESTION_RECENT_TRIPS_SQL`, which replaces the one of that name:

- **An ended basket trip**: a `GENERATED` basket with a row in `basket_trip_rows` for this
  list. The rows exist exactly while the basket is finished (`0135`), so their existence
  is the test, and the two parameters that carried "live" (`$2`, `$3`) leave this
  statement. An `OPEN` basket that outlived the claim window is finished by the sweep
  within its interval, and until then it is not ended. A line is **present** where the trip
  asked for more than zero of it.
- **An ended session of the list**: the list's standing purchases that belong to no
  `GENERATED` basket (`0134` section 4.1), windowed by `PURCHASE_SESSION_GAP_MS`, whose
  newest purchase is older than `now - PURCHASE_SESSION_GAP_MS`. A session still running
  is a shop in progress, and counting it calls every line not bought yet absent. A
  line is **present** where the session holds a standing settlement on it of **either**
  outcome: a household that tried to buy it wanted it.
- **A session counts only when it touched at least `STAPLE_SESSION_MIN_LINES` (three)
  distinct lines of the list.** A basket trip states everything a household wanted, so a
  line missing from it was not wanted. A session states only what was bought, so somebody
  who went out for bread alone otherwise makes every other line "absent", and two
  such errands in a row end every staple the list has ("never absent from two in a row",
  `suggestion-rules.ts:140`). Three is a new constant in `suggestions.constants.ts` with
  that reason beside it.

```sql
-- $1 the list, $2 the candidate line ids, $3 how many trips (STAPLE_TRIPS),
-- $4 PURCHASE_SESSION_GAP_MS, $5 now, $6 STAPLE_SESSION_MIN_LINES
WITH "basket_trips" AS (
  SELECT r."basketId" AS "tripId",
         gl."generatedAt" AS "startedAt",
         ARRAY_AGG(DISTINCT r."lineId"::text)
           FILTER (WHERE r."asked" > 0 AND r."lineId" = ANY($2::uuid[])) AS "lineIds"
  FROM "basket_trip_rows" r
  JOIN "generated_lists" gl ON gl.id = r."basketId" AND gl."kind" = 'GENERATED'
  JOIN "list_lines" ll ON ll.id = r."lineId" AND ll."listId" = $1::uuid
  WHERE r."listId" = $1::uuid
  GROUP BY r."basketId", gl."generatedAt"
),
"loose" AS (
  SELECT s.id, s."lineId", s."settledAt"
  FROM "line_settlements" s
  JOIN "list_lines" ll ON ll.id = s."lineId" AND ll."listId" = $1::uuid
  WHERE s."listId" = $1::uuid
    AND s."revertedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "generated_lists" gl
      WHERE gl.id = s."basketId" AND gl."kind" = 'GENERATED'
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
  HAVING MAX(n."settledAt") < $5::timestamptz - ($4::double precision * interval '1 millisecond')
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
```

If `0135` or `0136` already rewrote the statement of this name over `basket_trip_rows`,
keep their spelling of the first CTE and add the rest. `STAPLE_TRIPS` and
`STAPLE_MIN_TRIPS` keep their numbers and lose the word "basket" from their comments: six
trips looked at, four needed, over the union. `isStaple` does not change at all, which is
the point of having put the rule in a pure function: it takes a list of booleans, newest
first, and never knew what a trip was.

### 8.2 The quantity

`SUGGESTION_LAST_ASKED_SQL` reads `basket_trip_rows` and also answers which trip and when:

```sql
SELECT DISTINCT ON (r."lineId")
       r."lineId" AS "lineId",
       r."asked" AS "asked",
       r."basketId" AS "tripId",
       gl."generatedAt" AS "startedAt"
FROM "basket_trip_rows" r
JOIN "generated_lists" gl ON gl.id = r."basketId" AND gl."kind" = 'GENERATED'
WHERE r."listId" = $1::uuid
  AND r."lineId" = ANY($2::uuid[])
  AND r."asked" > 0
ORDER BY r."lineId", gl."generatedAt" DESC, r."basketId" DESC
```

`basket_trip_rows` holds one row per basket and zone line (`0135`), so the `SUM` over
sibling basket lines that plan `0123` needed is gone with the siblings.

`SUGGESTION_PURCHASES_SQL` gains `s."basketId" AS "basketId"`, and `Purchase` in
`suggestion-rules.ts` carries it through `mergePurchases` as the basket of the newest
folded row. The rule of plan `0123` section 5 becomes:

- `quantity` is what the newest ended basket trip asked for the line **when that trip is
  where the line was last bought, or is newer than its last purchase**. Otherwise it is the
  units of the last merged purchase. Never below 1.

Without the second half a basket from last spring decides the quantity for a household
that has shopped from the `LIVE` basket every week since. It is one comparison in
`suggest`, under a unit spec.

### 8.3 The candidates

`SUGGESTION_CANDIDATES_SQL` and its "held by no open basket" test are left as `0136` left
them. A `LIVE` basket holds nothing (`0130` section 7), so it never blocks a suggestion.

## 9. Migration

One migration, `PersonPurchases<timestamp>`.

```sql
-- up
CREATE INDEX "ix_generated_list_participants_user"
  ON "generated_list_participants" ("userId")
  WHERE "userId" IS NOT NULL;
DROP INDEX "ix_generated_list_participants_user_live";

-- down
CREATE INDEX "ix_generated_list_participants_user_live"
  ON "generated_list_participants" ("userId")
  WHERE "userId" IS NOT NULL AND "revokedAt" IS NULL;
DROP INDEX "ix_generated_list_participants_user";
```

- The third arm of section 2 needs a person's participant rows **live or ended**, and the
  partial index cannot find an ended one. The wider index serves the shared baskets read
  of plan `0114` section 8 as well: that read filters `"revokedAt" IS NULL` over one
  person's rows, which are a handful. One index for one column, so the narrow one goes.
  Change the `@Index` decorator on the entity to match, and check
  `generated-list-members.sql.ts` still plans on the new index in the integration spec.
- No column, no backfill, nothing lossy. `down` restores the index as it was.
- `0144` renames the table and this index with it.

## 10. Events

None. A history is opened, read and closed, and the client reads it again when it is
opened again. A purchase made while the page is open is a purchase the reader is making on
another screen. If a later plan wants the page live, the event is
`purchase.sessionsChanged {}` to the `user:{id}` rooms of the three routes of section 2,
and it says "read again" and nothing else, as `list.tripsChanged` does.

## 11. Not in this plan

- The price. `0143` fills `pricePaidCents`, adds the currency, and changes `spentCents`
  into a money shape.
- A household's spend. This is one person's history. What a zone spent is a sum over a
  zone's lists, a different authorization and a different plan.
- The screens and the copy. velista `0095`.
- A lower bound or a horizon on the history. Trips grow without bound and the entries are
  paged for that reason.
- Restating plan `0123`'s period rule. `0134` section 7 already moved its merge constant.

## 12. Tests

Integration specs, real database, their own target on a slot, because every rule here is a
`WHERE`, a `UNION` or a window:

1. Each of the three routes of section 2 alone puts a purchase in the reader's history, and
   a purchase reachable by two routes appears once.
2. A purchase made by a guest through the reader's `LIVE` basket is in the reader's
   session. A purchase made by the reader on another owner's `GENERATED` basket is in the
   reader's session and not under that basket's name.
3. A `GENERATED` basket the reader owns is one `BASKET` entry with `open` following its
   status, holding purchases by every participant. One with no standing purchase is absent.
4. Purchases on two lists of two zones five hours apart are one session, seven hours apart
   are two, exactly six hours apart are one, and two either side of midnight UTC are one.
5. `lineCount`, `boughtLineCount`, `spentCents` and `unpricedCount` over a mix of priced,
   unpriced, `NOT_AVAILABLE` and reverted rows. No price anywhere answers null and not 0.
6. Paging visits every entry once across a boundary where a basket and a session share a
   `startedAt` to the millisecond, and across a page boundary that falls inside a run of
   sessions (the narrowing of section 3.2 changes no answer: assert the same entries with
   the predicate removed).
7. A boundary session whose first purchase was reverted after the page was served still
   continues from the same moment.
8. Rows: three partial settles at one price are one row, the same line at two prices is
   two, and a line with `NOT_AVAILABLE` and nothing bought is one row of 0.
9. Rows: a reader with `READ` gets the five location fields, and the same reader after
   losing access gets nulls for all five and keeps the product, quantity, date and price.
   A soft deleted line still serves its text to a reader who holds `READ`.
10. An entry that is not the reader's, a session id that names no session, and an entry
    whose purchases were all reverted answer not found on the rows route.
11. The migration's index serves both the third arm and `SHARED_BASKETS_SQL` (assert the
    plan of each names it).
12. Suggestions: a list with four ended sessions of three lines or more and no basket at
    all yields a staple. The same list with sessions of one line yields none.
13. Suggestions: a session still inside the gap is not a trip, and the first run after it
    ends counts it.
14. Suggestions: `quantity` follows the basket trip when the last purchase came from it,
    and follows the last purchase when a newer session bought a different number.

Unit specs: `isStaple` untouched and still green, `suggest` with the comparison of section
8.2, `mergePurchases` carrying `basketId`, the mappers (`spentCents` null and bigint to
number), the gateway's kind parsing, and velista's `tripPathKind` and mapper for `SESSION`.

## 13. Acceptance criteria

- [ ] A person who never created a basket has a history: their purchases grouped by a six
      hour gap across lists, newest first, a page at a time, with no time zone anywhere.
- [ ] A `GENERATED` basket the person owns is one named entry, open or finished.
- [ ] A row says which list and what text only while the reader can read that list.
- [ ] `spentCents` is null, never 0, when nothing in the entry carries a price, and
      `unpricedCount` says how much of a sum is missing.
- [ ] `GET /v1/generated-lists` is unchanged.
- [ ] No route, schema, SQL literal or client map says `LOOSE` or `loose`.
- [ ] A list whose household shops without baskets gets staples, and an errand for one
      thing does not end them.
- [ ] One new index, one index dropped, no column. `openapi.json` and the wire types are
      current.

## 14. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models velista/models velista/data-access
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx build luna-shopper-backend-core
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

Run the integration specs through core's integration target against a slot, boot core and
the gateway on it once (a new module and a new controller are exactly where a `type`
import erases a token, `0130` section 13), and give the slot back. Check the two project
names with `npx nx show projects | grep velista` first: `run-many` drops a name it does
not know without saying so (memory note on Nx workspace traps).
