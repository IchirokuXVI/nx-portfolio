> **PR:** [#424](https://github.com/IchirokuXVI/nx-portfolio/pull/424)

# 0134: a purchase names its basket

> Part of the series `0130` records. Needs `0133`. Plan `0135` needs this one, and `0136`
> finishes what this one starts.
>
> A settlement made through a basket says so by naming a **basket line**:
> `line_settlements.generatedListLineId`. Plan `0136` deletes basket lines, so every read
> that asks "which basket was this bought through" is standing on a row that is about to
> go. This plan moves that question onto the basket itself, in a new column `basketId`,
> while the old column still exists. It is the expand half of an expand and contract: the
> column is added, backfilled and written by every settle path beside the old one, and the
> reads that only ever wanted the basket switch to it now. The reads that really want the
> basket line keep the old column until `0136` deletes both.
>
> It also changes what decides whether a purchase belongs to a basket's trip. Today the
> test is "the basket line the settlement names still exists" (plan `0122`). It becomes
> "the basket exists and its kind is `GENERATED`", which is what lets a `LIVE` basket have
> purchases without becoming one endless trip (`0130` sections 3 and 9).
>
> Prerequisite reading: `0130` in full. Plans `0047` (section 3, the settlement), `0051`
> (section 6, who a basket settle is attributed to), `0054` and `0104` (the revert and its
> split), `0093` (waiting settlements), `0122` (trips) and `0123` (section 3, the merge of
> purchases). Code: `core/src/app/entities/line-settlement.entity.ts`,
> `core/src/app/lists/trips/trips.sql.ts` and `trips.service.ts` in full,
> `core/src/app/generated-lists/generated-list.sql.ts` (`ORDER_HISTORY_SQL`),
> `core/src/app/lists/suggestions/suggestion-rules.ts`, and the memory notes on raw SQL in
> TypeORM and on Luna backend spec traps.

## Brief for the agent

### Objective

Add `line_settlements.basketId`, backfill it, write it from every path that writes a basket
settlement, and move the trips reads and the trip test of `ORDER_HISTORY_SQL` onto it, with
the loose rows naming a buyer who bought through a basket. Replace the two session
constants with the one `PURCHASE_SESSION_GAP_MS`.

### Context

- `line_settlements` rows are created in exactly five places (grep for `pricePaidCents`,
  which every create names):
  - `core/src/app/lists/settlement.service.ts:155-176`, the list page, with
    `generatedListLineId: null`.
  - `core/src/app/generated-lists/generated-list-settle.service.ts:224-244`, one row per
    origin, and `:312-332`, the waiting row of plan `0093`.
  - `core/src/app/generated-lists/generated-list-reopen.service.ts:336-352`, the split of
    plan `0104` section 3.2, which copies every column of the row it splits.
  - `core/src/app/generated-lists/waiting-settlement.service.ts:275-292`, the split of a
    waiting row that comes home in part, which also copies every column.
- Three sites **rewrite** `generatedListLineId` on existing rows, and none of them moves a
  purchase to another basket: `generated-list-line-rename.service.ts:516-521` (a rename
  that merges two basket lines), `generated-list-split.service.ts:391-396` (a split that
  folds siblings), and nothing else. `lists/line-merge.service.ts:148-150` rewrites
  `lineId` and leaves the basket alone.
- These reads ask for the **basket** and reach it through the basket line:
  `trips.sql.ts:65-78` (the `bought` half), `trips.sql.ts:126-134` (the loose test), and
  `generated-list.sql.ts:307-313` (the `EXISTS` of `ORDER_HISTORY_SQL`).
- These reads ask for the **basket line** and stay as they are until `0136`:
  `GeneratedListService.settlementFacts` (`generated-list.service.ts:1063-1113`),
  `GENERATED_LIST_COUNTS_SQL` (`generated-list.sql.ts:228-251`), the `visits` half of
  `ORDER_HISTORY_SQL` (`:317-329`, which reads the basket line's text and pick), the revert
  walk (`generated-list-reopen.service.ts:239-251`), `WaitingSettlementService.rehome`
  (`waiting-settlement.service.ts:116`, `:125`),
  `GeneratedListOriginsService.settlementsOf` (`generated-list-origins.service.ts:1107`)
  and `GeneratedListSplitService.settledPerOrigin` (`generated-list-split.service.ts:540`).
- **The suggestions SQL reads no settlement's basket line.** All four statements of
  `suggestions.sql.ts` reach a basket through `generated_list_line_origins`, and
  `SUGGESTION_PURCHASES_SQL` reads purchases by `lineId` alone. So nothing in that file
  switches to `basketId`. What this plan changes there is the merge constant.
- Two constants say how long a silence ends a run of purchases, and they disagree:
  `LOOSE_TRIP_GAP_MS`, six hours (`trips.sql.ts:33`), and `PURCHASE_MERGE_MS`, twelve hours
  (`suggestions.constants.ts:22`). They also disagree about the boundary. A gap of exactly
  six hours continues a loose trip (`trips.sql.ts:139`, a strict `>`). A gap of exactly
  twelve hours starts a new purchase (`suggestion-rules.ts:67`, a strict `<`, and
  `suggestion-rules.spec.ts:50` proves it).
- velista keeps its own copy of the twelve hours, because rule D4 forbids it a contract
  import: `libs/velista/models/src/lib/line-detail-view.ts:25`, used by
  `libs/velista/feature-lists/src/lib/line-detail-sheet/select-line-detail.ts:262`, under
  velista plan `0089` section 4, which says the estimate merges "as the server does".
- A basket settle leaves `settledByUserId` null and names a participant
  (`generated-list-settle.service.ts:233-234`, `ck_line_settlements_actor`). The loose rows
  read `settledByUserId` (`trips.sql.ts:125`, `:169-170`), so a purchase a deleted basket
  left behind names nobody. `ix_settlements_participant` already exists (migration
  `1756001200000-SettlementParticipants.ts:63-66`). There is no index on `settledByUserId`.
- `core/src/migrate.ts` runs every pending migration in one transaction (`0130`
  section 13).

### Target state

Every acceptance criterion in section 11 holds. Every basket settlement written after the
deploy carries both columns. `trips.sql.ts` names `generatedListLineId` only inside the
`asked` half, which reads origins and not settlements. `LOOSE_TRIP_GAP_MS` and
`PURCHASE_MERGE_MS` are gone from the repository, velista's copy included.

### Scope

- Work only in:
  - a new migration in `core/src/app/db/migrations/`, and `index.ts` beside it
  - `core/src/app/entities/line-settlement.entity.ts`
  - the five create sites named in Context
  - `core/src/app/lists/trips/` (SQL, service, specs)
  - `core/src/app/generated-lists/generated-list.sql.ts` (`ORDER_HISTORY_SQL` only) and
    the order specs
  - `core/src/app/lists/suggestions/` (the constant, `suggestion-rules.ts`, the specs)
  - `core/src/app/lists/line-settlements.fake.ts`
  - `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts` (the constant)
  - `libs/velista/models/src/lib/line-detail-view.ts`,
    `libs/velista/feature-lists/src/lib/line-detail-sheet/select-line-detail.ts` and its
    spec, for the constant and the boundary alone
- Do NOT touch: `generatedListLineId` itself, any read listed under "stay as they are",
  `toLineSettlementView`, `LineSettlementView`, `TripView`, `TripRowView`, the check
  constraints of `line_settlements`, waiting settlements, the claim SQL, any gateway file.
  Dropping the old column is `0136`. Trip rows are `0135`. A person's history is `0142`.

### Constraints

- `basketId` has **no foreign key**, for the reason the entity gives for
  `settledByParticipantId`: a settlement is a zone fact and a basket is not, so deleting a
  basket leaves the purchase standing.
- Dual write is a service rule, proven by specs. No check constraint ties the two columns,
  because a row whose basket line was deleted before this plan legitimately has one and
  not the other.
- The basket of a split row is **copied from the row it splits**, never looked up again.
- `revertedAt IS NULL` stays the definition of a purchase that counts.
- A basket id is never served. `toLineSettlementView` does not change.
- Raw SQL quotes every camelCase column by hand. Every rule here is a `WHERE` or a join,
  so every rule is proven by an integration spec against a real database.

### Action boundaries

- Proceed with in scope edits, the migration, unit and integration specs.
- Stop and ask if `0133` is not merged (`generated_lists.kind` does not exist), if a sixth
  site that creates a `LineSettlement` turns up, or if the backfill leaves a row whose
  basket line exists with a null `basketId`.

### Progress evidence

Report after the migration with its backfill count, after the five write sites with their
specs, after the trips SQL with its integration spec, and after the constant with both
suggestion specs and the velista spec. Each with the run.

## 1. What is being built

| Piece                                                  | Where                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `line_settlements.basketId`, backfilled, two indexes   | a new migration, `line-settlement.entity.ts`                     |
| dual write                                             | the five create sites                                            |
| the trip test by basket and kind                       | `trips.sql.ts`                                                   |
| the buyer of a session purchase made through a basket  | `trips.sql.ts`                                                   |
| the trip test of the walk order                        | `generated-list.sql.ts`, `ORDER_HISTORY_SQL`                     |
| `PURCHASE_SESSION_GAP_MS`, one boundary rule           | contracts `list.messages.ts`, trips, suggestions, velista mirror |

## 2. The column

```ts
/**
 * The basket this purchase was made through, or null when it was made on the
 * list page (plan 0134).
 *
 * The basket and not a line of it, because an open basket stores no lines
 * (plan 0130, section 2). Stored and never served, for the reason plan 0047
 * section 3.1 gives: the purchase is a zone fact and the basket is private.
 *
 * No foreign key. A settlement outlives the basket it came off, and a basket
 * id that names no row is how a read learns the basket was deleted.
 */
@Column({ type: 'uuid', nullable: true })
basketId!: string | null;
```

The name follows `0130` section 3: a new column says `basket`, although the table it
points at is called `generated_lists` until `0144`.

**Null means the list page.** A `LIVE` basket does not exist before `0136`, so after this
plan a non null `basketId` always names a `GENERATED` basket or a deleted one. The reads of
sections 4 and 5 already test the kind, so they are correct the day `0136` creates the
first `LIVE` row.

## 3. Who writes it

| Site                                                            | Value                                   |
| --------------------------------------------------------------- | --------------------------------------- |
| `settlement.service.ts:155-176`                                 | `null`                                  |
| `generated-list-settle.service.ts:224-244`, one row per origin  | `list.id`                               |
| `generated-list-settle.service.ts:312-332`, the waiting row     | `list.id`                               |
| `generated-list-reopen.service.ts:336-352`, the revert split    | `row.basketId`, copied                  |
| `waiting-settlement.service.ts:275-292`, the rehome split       | `row.basketId`, copied                  |

The two splits copy, and the reason is the one `generated-list-reopen.service.ts:333-335`
gives for `settledAt`: a split is two parts of one purchase, so every fact about the
purchase travels. Plan `0143` adds two more columns to the same copy.

The two sites that rewrite `generatedListLineId` (`generated-list-line-rename.service.ts:
516-521`, `generated-list-split.service.ts:391-396`) move a purchase between two lines of
**one** basket. They do not touch `basketId`, and a comment at each says why.

`line-settlements.fake.ts:36` and `:133-134` learn the field, so a unit spec can filter by
it the way it filters by `generatedListLineId` today.

## 4. The trips of a list

### 4.1 Which purchase belongs to which kind of trip

Plan `0122` section 3: a loose trip is "live settlements of this list whose
`generatedListLineId` is null, **or names a basket line that no longer exists**". That
rule is replaced:

> A purchase belongs to a basket's trip when its `basketId` names a row of
> `generated_lists` whose `kind` is `GENERATED`. Every other standing purchase of the list
> is a session purchase: the ones made on the list page, the ones made through a `LIVE`
> basket, and the ones a deleted basket left behind.

One consequence is new and is wanted. Today a line **taken out of a basket that still
exists** (`GeneratedListLineService.deleteLine`) drops its purchases into a loose trip,
because the basket line is gone. With the new test they stay in the basket's trip, where
they were made. The `FULL JOIN` of `basket_rows` already draws a row that was bought and
is no longer asked, so nothing else moves.

### 4.2 `basketRowsCte`

`basketRowsCte(basketFilter: string)` takes one fragment today and splices it into both
halves, which works only because both halves join `generated_list_lines gll`. The `bought`
half stops joining it, so the function takes the **parameter** and builds each half's own
predicate:

```ts
/** `basketParam` is `'$2'` for the rows read and `null` for the heads. */
function basketRowsCte(basketParam: string | null): string {
  const askedFilter = basketParam
    ? `AND gll."generatedListId" = ${basketParam}::uuid`
    : '';
  const boughtFilter = basketParam
    ? `AND s."basketId" = ${basketParam}::uuid`
    : '';
  return `
  "asked" AS (
    SELECT gll."generatedListId" AS "tripId",
           o."lineId" AS "lineId",
           SUM(o."quantity")::int AS "asked"
    FROM "generated_list_line_origins" o
    JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
    WHERE o."listId" = $1::uuid ${askedFilter}
    GROUP BY gll."generatedListId", o."lineId"
  ),
  "bought" AS (
    SELECT s."basketId" AS "tripId",
           s."lineId" AS "lineId",
           COALESCE(
             SUM(s."quantity") FILTER (WHERE s."outcome" = 'BOUGHT'), 0
           )::int AS "bought",
           (ARRAY_AGG(s."outcome"::text ORDER BY s."settledAt" DESC, s.id DESC))[1]
             AS "lastOutcome"
    FROM "line_settlements" s
    JOIN "generated_lists" gl
      ON gl.id = s."basketId" AND gl."kind" = 'GENERATED'
    WHERE s."listId" = $1::uuid
      AND s."revertedAt" IS NULL ${boughtFilter}
    GROUP BY s."basketId", s."lineId"
  ),
  "basket_rows" AS (
    SELECT COALESCE(a."tripId", b."tripId") AS "tripId",
           ll.id AS "lineId",
           ll."position" AS "position",
           COALESCE(a."asked", 0) AS "asked",
           COALESCE(b."bought", 0) AS "bought",
           b."lastOutcome" AS "lastOutcome"
    FROM "asked" a
    FULL JOIN "bought" b
      ON b."tripId" = a."tripId" AND b."lineId" = a."lineId"
    JOIN "list_lines" ll
      ON ll.id = COALESCE(a."lineId", b."lineId") AND ll."listId" = $1::uuid
  )`;
}
```

`TRIPS_CTE` calls `basketRowsCte(null)` and `BASKET_TRIP_ROWS_SQL` calls
`basketRowsCte('$2')`. The `asked` half is untouched, and plan `0135` is the one that
changes where it reads from. Whatever predicate `0132` added to the `list_lines` join for
a soft deleted line stays exactly where `0132` put it.

### 4.3 `LOOSE_ROWS_CTE`, and who bought

```sql
"loose" AS (
  SELECT s.id AS "id",
         s."lineId" AS "lineId",
         ll."position" AS "position",
         s."settledAt" AS "settledAt",
         s."outcome"::text AS "outcome",
         s."quantity" AS "quantity",
         COALESCE(s."settledByUserId", p."userId") AS "buyerUserId"
  FROM "line_settlements" s
  JOIN "list_lines" ll ON ll.id = s."lineId" AND ll."listId" = $1::uuid
  LEFT JOIN "generated_list_participants" p
    ON p.id = s."settledByParticipantId"
  WHERE s."listId" = $1::uuid
    AND s."revertedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "generated_lists" gl
      WHERE gl.id = s."basketId"
        AND gl."kind" = 'GENERATED'
    )
)
```

The four steps below it (`marked`, `numbered`, `sessioned`, `loose_rows`) keep their shape.
`loose_rows` aggregates `x."buyerUserId"` where it aggregates `x."settledByUserId"` today
(`trips.sql.ts:169-170`), and `LOOSE_TRIP_ROWS_SQL` keeps its gate word for word: the buyer
is served only while they are an approved member of the list's zone (`:326-336`).

- **What this discloses.** A reader of a list learns that a named member bought a line,
  where today they learn it only when the member used the list page. They never learn
  through which basket, and the basket id is never on the wire. It is the same fact plan
  `0122` section 4 already serves for a purchase made by hand, and `0130` section 9 says a
  purchase through a `LIVE` basket is that kind of purchase.
- **A guest** has no `userId`, so the row reads null, as it does today.
- **A deleted basket** took its participant rows with it (the cascade of plan `0051`), so
  its purchases read null, as they do today. Nothing new is kept to name them.
- The left join is one primary key lookup per loose settlement, and `ix_settlements_list`
  still serves the window.

### 4.4 The cursor

`ENDED_TRIPS_SQL` looks its boundary up in `generated_lists` for a `BASKET` cursor and in
`line_settlements` for a `LOOSE` one (`trips.sql.ts:261-283`). Neither lookup reads a basket
line, so the cursor does not change.

## 5. The walk order

`ORDER_HISTORY_SQL` (`generated-list.sql.ts:301-344`) asks two things of a settlement. The
`trips` CTE asks whether a basket has a standing purchase, which is a question about the
basket. The `visits` CTE reads the basket line's `content` and `itemId`, which is a
question about the basket line and stays one until plan `0141` rewrites the read over
sessions.

```sql
WITH "trips" AS (
  SELECT gl.id
  FROM "generated_lists" gl
  WHERE gl."ownerUserId" = $1
    AND gl."kind" = 'GENERATED'
    AND gl.status::text = ANY($2::text[])
    AND EXISTS (
      SELECT 1
      FROM "line_settlements" ls
      WHERE ls."basketId" = gl.id
        AND ls."revertedAt" IS NULL
    )
  ORDER BY gl."generatedAt" DESC, gl.id DESC
  LIMIT $3
),
```

`visits` and `starts` are unchanged. If `0133` already wrote the `kind` predicate into this
statement, keep its spelling: the target is the text above and not a second copy of the
predicate. The `EXISTS` now rides `ix_settlements_basket_live` (section 6).

## 6. Migration

`<next free timestamp>-SettlementBasket.ts`, class `SettlementBasket<timestamp>`, listed
last in `CORE_MIGRATIONS` with a comment saying it alters the table
`LineSettlements1756000800000` created and follows the migration of `0133`, which creates
`generated_lists.kind`.

**Up**

```sql
ALTER TABLE "line_settlements" ADD COLUMN "basketId" uuid;

COMMENT ON COLUMN "line_settlements"."basketId" IS
  'The basket this purchase was made through, or null for the list page (plan 0134). No foreign key: a settlement outlives its basket. Stored and never served.';

UPDATE "line_settlements" s
SET "basketId" = gll."generatedListId"
FROM "generated_list_lines" gll
WHERE gll.id = s."generatedListLineId";

CREATE INDEX "ix_settlements_basket_live"
  ON "line_settlements" ("basketId", "lineId", "settledAt")
  WHERE "revertedAt" IS NULL AND "basketId" IS NOT NULL;

CREATE INDEX "ix_settlements_user"
  ON "line_settlements" ("settledByUserId", "settledAt" DESC)
  WHERE "settledByUserId" IS NOT NULL;
```

- The backfill is **exact for every row today's reads call a basket purchase**. Today's
  test is "the basket line exists", and the update joins exactly those rows. A row whose
  basket line is already gone keeps a null `basketId` and stays a session purchase, which is
  what it is today. Nothing that was in a basket's trip leaves it, and nothing enters one.
- `ix_settlements_basket_live` serves the `bought` half, the `EXISTS` of section 5, and the
  revert walk and the arithmetic of `0136`, which both ask for one basket and one line.
  `ix_settlements_basket_line_live` (migration `1756001300000`, on `generatedListLineId`)
  stays until `0136` drops its column.
- `ix_settlements_user` is for plan `0142`, which reads one person's purchases newest
  first. It is created here because this is the migration that reshapes the table's
  indexes, and because a second pass over the largest table in core to add it later is the
  cost plan `0047` section 3.4 warned about. `ix_settlements_participant` already exists.
- One transaction holds every pending migration (`0130` section 13). Nothing here adds an
  enum value, so nothing here trips on it.

**Down**

```sql
DROP INDEX "ix_settlements_user";
DROP INDEX "ix_settlements_basket_live";
ALTER TABLE "line_settlements" DROP COLUMN "basketId";
```

Lossless, because `generatedListLineId` still holds what `basketId` was derived from. That
stops being true at `0136`, and `0136` says so in its own down.

The entity declares both indexes with `@Index(..., { where })`, as
`generated-list-participant.entity.ts` declares its partial ones.

## 7. One constant for a session

`0130` section 3: a session is a run of purchases with no silence longer than
`PURCHASE_SESSION_GAP_MS`, six hours, "one constant, in contracts".

```ts
// libs/luna-shopper/contracts/src/lib/messages/list.messages.ts, beside TripView

/**
 * How long a silence ends a session of purchases: six hours (plan 0130,
 * section 3; plan 0134, section 7).
 *
 * Elapsed time and never a calendar day, so no time zone is involved and a shop
 * that crosses midnight stays one session. A gap of exactly this long continues
 * the session. Only a longer one starts the next.
 */
export const PURCHASE_SESSION_GAP_MS = 6 * 60 * 60 * 1000;

/** Whether `next` continues the session `previous` belongs to. */
export function continuesPurchaseSession(previous: Date, next: Date): boolean {
  return next.getTime() - previous.getTime() <= PURCHASE_SESSION_GAP_MS;
}
```

- `trips.sql.ts:33` loses `LOOSE_TRIP_GAP_MS`. `trips.service.ts:25`, `:111` and `:183`
  import the contract constant, and `trips.spec.ts:18`, `:196` and `:269` follow. The SQL at
  `:139-141` already starts a session on a strict `>`, which is the boundary rule above.
- `suggestions.constants.ts:16-22` loses `PURCHASE_MERGE_MS`. `mergePurchases`
  (`suggestion-rules.ts:57-76`) folds a purchase into the one before it when
  `continuesPurchaseSession(previous, at)` holds. That is two changes to plan `0123` section
  3 step 1, and both are deliberate:
  1. **Twelve hours becomes six.** Plan `0123` chose twelve so that "a trip is one purchase
     however many rows it wrote". A trip is now defined once, by the session, and a
     suggestion that folded purchases the trips read shows as two trips was two
     definitions of one word.
  2. **Exactly on the boundary now folds.** `suggestion-rules.spec.ts:50` ("keeps purchases
     twelve hours apart as two") becomes two cases: exactly six hours apart are one
     purchase, and six hours and one millisecond apart are two.
- What it does to a household. A slow partial settle that writes a row every few hours
  still folds, because the comparison is with the previous row and not with the first
  (`suggestion-rules.ts:52-55`). Two shops on one day, nine hours apart, were one purchase
  and are now two, which shortens that line's median period a little. Plan `0123` section
  3 step 2 still refuses a period below three merged purchases, so no line becomes a
  suggestion on the strength of this alone.
- The table in plan `0123` section 5 that lists `PURCHASE_MERGE_MS | 12 hours` is history.
  Do not edit a built plan. This plan is where the number changed.
- **velista's mirror.** `libs/velista/models/src/lib/line-detail-view.ts:25` becomes
  `PURCHASE_SESSION_GAP_MS`, six hours, with a comment naming the contract constant it
  mirrors. `select-line-detail.ts:262` starts a new purchase on `at - previous >
  PURCHASE_SESSION_GAP_MS`, a strict `>`, where it has `>=` today. The case at
  `select-line-detail.spec.ts:224-230` (rows eight hours apart folding into one) moves to
  rows five hours apart, and a case for the exact boundary is added. It is in this plan and
  not a velista plan because velista `0089` section 4 promises the estimate merges "as the
  server does", and a server at six beside a client at twelve shows one line two periods.

## 8. Events

None. No payload changes, and no new write is announced. The buyer of a loose row is read
on the next read of the trip's rows, which `line.settled` already triggers on a client in
the list room (velista `0088`).

## 9. Not in this plan

- Dropping `generatedListLineId`, `ix_settlements_basket_line_live`,
  `ix_settlements_waiting` and the two waiting constraints, and making `lineId` and
  `listId` required again: `0136`.
- `settlementFacts`, the counts, the revert walk and the `visits` half of the walk order
  moving off the basket line: `0136` and `0141`.
- Where a basket trip reads what it asked: `0135`.
- A person's own history, which is what `ix_settlements_user` is for: `0142`.
- Serving the buyer on `LineSettlementView` or on `line.settled`. A basket settle still
  announces `settledByUserId: null` to the zone, as plan `0051` section 6 wrote it.
- The suggestions statements. They read origins, and `0136` rewrites them over coverage.

## 10. Tests

Unit:

1. Each of the four basket create sites writes `basketId` beside `generatedListLineId`, and
   the list page writes null for both.
2. A revert that splits a row (`generated-list-reopen.spec.ts`) and a rehome that splits a
   waiting row (`waiting-settlement.spec.ts`) both produce a remainder carrying the
   original's `basketId`.
3. A rename merge and a split fold leave `basketId` alone.
4. `mergePurchases`: exactly six hours folds, one millisecond more does not, and a chain of
   rows five hours apart over a day is one purchase.
5. `continuesPurchaseSession` on the boundary and either side of it.
6. velista `select-line-detail.spec.ts`: the same three cases.

Integration, real database, through the integration target on a slot:

7. The migration backfills a settlement whose basket line exists, and leaves null one
   whose basket line was deleted and one made on the list page. Down and up again are
   lossless.
8. A purchase through a `GENERATED` basket is in that basket's trip. After the basket
   **line** is deleted and the basket stays, the purchase is still in the basket's trip,
   as a row with `asked` 0.
9. A purchase whose `basketId` names a `LIVE` basket (a fixture row, since `0136` creates
   the real ones) is a session purchase, and it folds into one session with a list page
   purchase five hours later.
10. A purchase of a deleted basket is a session purchase with a null buyer.
11. A session purchase made through a basket by a participant with an account names that
    account, only while the account is an approved member of the list's zone. A guest's
    names nobody.
12. Sessions five hours apart are one trip, seven hours apart are two, exactly six hours
    apart are one, and two either side of midnight UTC are one. This is test 4 of plan
    `0122` with the boundary added.
13. `BASKET_TRIP_ROWS_SQL` with a basket parameter reads only that basket's purchases,
    when a second basket bought the same zone line.
14. `ORDER_HISTORY_SQL` ignores a basket with no standing purchase, ignores a `LIVE`
    fixture basket, and returns the same rows as before for a finished `GENERATED` one.

## 11. Acceptance criteria

- [ ] `line_settlements.basketId` exists, has no foreign key, and is backfilled for every
      row whose basket line exists.
- [ ] Every path that creates a basket settlement writes `basketId` and
      `generatedListLineId` together, and both splits copy it.
- [ ] A purchase belongs to a basket's trip exactly when its basket exists and is
      `GENERATED`. `trips.sql.ts` reads no settlement's basket line.
- [ ] A session purchase made through a basket names its buyer under the same zone
      membership gate as a purchase made by hand.
- [ ] `PURCHASE_SESSION_GAP_MS` is the only session constant in the repository, with one
      boundary rule, in core and in velista's mirror.
- [ ] `TripView`, `TripRowView`, `LineSettlementView` and every event payload are
      unchanged, and `openapi.json` and the wire types have no diff.

## 12. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper/contracts velista/models velista/feature-lists
npx nx build luna-shopper-backend-core
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
git status --short apps/luna-shopper-backend/gateway/docs libs/luna-shopper-admin/models
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

The two generators are run to prove the last criterion: they must leave no diff. Run the
integration specs through their own target against a slot (memory note on Luna backend
spec traps), boot core once on that slot so a `type` import that erased a token shows
itself, then give the slot back.
