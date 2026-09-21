> **PR:** [#431](https://github.com/IchirokuXVI/nx-portfolio/pull/431)

# 0141: the order a shopper walks, learned from sessions

> Part of the series recorded in `0130`. Needs `0136` (the open basket is a view) and the
> index `0134` creates. No client half: the wire carries an array, and the array arrives in
> the right order.
>
> Plan `0110` orders a basket the way its owner walks the shop, and it does so once, when
> the basket is created, from the owner's finished baskets. Both halves of that sentence
> stopped being possible. A `LIVE` basket is never created on purpose and never finishes,
> so it has no moment to be ordered at and its owner has no finished basket to learn from.
> And `0136` deleted `generated_list_lines`, so there is no `position` column left to write
> an order into. This plan computes the order **on read**, for both kinds of basket, from
> the owner's past **sessions**, and it keeps the one property plan `0110` was protecting:
> a row never moves under a thumb.
>
> Prerequisite reading: `0130` sections 3, 4 and 13. Plan `0110` in full, because every
> rule about matching and about the median survives. `0134` sections 5, 6 and 7 (the
> interim walk order, `ix_settlements_basket_live`, `PURCHASE_SESSION_GAP_MS`). `0136` for
> the name of the read service and the shape of a row. Then
> `core/src/app/generated-lists/generated-list-order.service.ts` and its two specs, and
> `ORDER_HISTORY_SQL` in `generated-list.sql.ts`, in whatever state `0136` left them.

## Brief for the agent

### Objective

Replace the order plan `0110` wrote once at creation with an order the basket read of
`0136` computes on every read, from the owner's last seven ended sessions, with the
current session excluded, and delete what is left of the old order service.

### Context

- Today `GeneratedListOrderService.order(userId, composed)`
  (`core/src/app/generated-lists/generated-list-order.service.ts:77-113`) is called once, by
  `GeneratedListService.create`, between `compose` and `write`. It runs `ORDER_HISTORY_SQL`
  (`generated-list.sql.ts:301-344`), which reads the owner's last seven `COMPLETED` or
  `ARCHIVED` baskets that hold a standing settlement, and answers one row per basket line
  with how many seconds into the trip it was first settled.
- The matching and the arithmetic live in pure functions of that file: `index` (`:136`),
  `itemIdsOf` (`:153`), `medianOffset` (`:179`), `median` (`:202`) and `compareKeys`
  (`:225`). **They are correct and they stay**, moved and renamed. What changes is where
  the history comes from and when the order is asked for.
- `0134` section 5 kept the statement alive by swapping its `EXISTS` onto `basketId`. It
  still reads `generated_list_lines` for a line's text and pick, and `0136` deletes that
  table. `0136` section 3.5 already calls the order on **every read**, because no `position`
  is stored any more, and drops the join to `generated_list_lines`. What it leaves is an
  order that still learns from finished `GENERATED` baskets alone, so somebody who only
  ever uses the `LIVE` basket gets the alphabet. This plan replaces where it learns from.
- After `0136` a row is a group of covered lines sharing one merge key. It carries its
  text, the union of its entries' product sets as `optionIds`, and the id of its anchor as
  its key (`0130` section 3). There is no stored pick. A settlement records the product
  that was bought in `line_settlements.itemId`, as it always did.
- `0134` section 6 creates `ix_settlements_basket_live` on `("basketId", "lineId",
  "settledAt")` where `"revertedAt" IS NULL AND "basketId" IS NOT NULL`, and section 7
  creates `PURCHASE_SESSION_GAP_MS` (six hours) and `continuesPurchaseSession` in
  `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts`.
- `0132` made a delete of a list line a soft delete, so a purchase made on a line that was
  later removed still joins to its text.

### Target state

Every acceptance criterion in section 9 holds. `generated-list-order.service.ts`, both of
its specs, `ORDER_HISTORY_SQL` and `OrderHistoryRow` are gone. `npx nx run-many -t lint test
-p luna-shopper-backend-core` is green, and the integration spec of section 8 passes against
a slot.

### Scope

- Work only in:
  - `apps/luna-shopper-backend/core/src/app/baskets/`: new `basket-order.service.ts`,
    `basket-order.sql.ts`, `basket-order.spec.ts`, `basket-order.integration.spec.ts`. New
    files say `basket` (`0130` section 3). If `0136` put its read service somewhere else,
    put these beside it.
  - the basket read service of `0136`, for the one call of section 4.
  - the module that provides that service, for the one provider.
  - `apps/luna-shopper-backend/core/src/app/generated-lists/`: the deletions of section 6.
  - `libs/luna-shopper/contracts` only if section 5 finds a `position` on the row view.
- Do NOT touch: the zone list's own order (`list_lines.position`, `LineService.reorder`,
  the list page drag), `mergeKey` and `normalizeContent`, any settle or revert write, the
  trips and suggestions reads, any migration. **This plan adds no column, no table and no
  index.**

### Constraints

- The service never reads a clock inside a rule. `order` takes `now` as an argument, the
  read service passes `new Date()`, and the SQL takes it as a parameter. That is the
  convention of `suggestion-rules.ts`, and it is what lets a spec state the rule.
- The two matching keys of plan `0110` section 2.1 are formed in TypeScript, never in SQL.
  `normalizeContent` is a fold that lives in one place, and a second definition in SQL is
  free to drift from it. The query answers facts, the service forms keys.
- Raw SQL, every camelCase column quoted by hand (`0130` section 13).
- One query per basket read, and no cache (section 3.4 argues it). An integration spec
  counts the queries.
- The order is a pure function of the history and of a row's text and products. It never
  depends on the order the rows came in, on a position, or on which pod answered.

### Action boundaries

- Proceed with in scope edits, the unit specs, the integration spec on a slot, and the
  deletions.
- Stop and ask if the read service of `0136` does not hold the owner's user id and the
  grouped rows at one point, which is the only place section 4 can be called from.
- Stop and ask if `0136` left a `position` on `BasketRowView` that the velista client of
  `0090` already reads. Section 5 says what to do when it did not.

### Progress evidence

Report after the SQL with its integration spec, after the service with its unit specs, and
after the deletions, each with the spec run that proves it.

## 1. What is being built

| Piece                                                      | Where                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `WALK_HISTORY_SQL`: a shelf, in a past session of a person | new `core/src/app/baskets/basket-order.sql.ts`             |
| `BasketOrderService.order(ownerUserId, rows, now)`         | new `core/src/app/baskets/basket-order.service.ts`         |
| the call, after grouping and before the counts             | the basket read service of `0136`                          |
| the deletion of the order that was written once            | `core/src/app/generated-lists/`, `generated-list.sql.ts`   |

No route, no contract, no event, no migration.

## 2. The rule plan 0110 set, and what replaces its reason

Plan `0110` section 3 ends: "None of those recompute anything, and neither does a settle.
**The order is written once.**" Section 4 adds: "It does not learn while the trip runs. The
order is the basket's, written at creation, and a line typed in the aisle goes last." The
service's own header gives the reason: "A shopping list that rearranges itself while
somebody is in the shop is hostile, which is the same reasoning that makes the basket a
snapshot (plan 0050, section 4)."

This plan reverses "written once" and keeps the reason. The reason was never that an order
has to be stored. It was that **nothing a shopper does in the shop is allowed to move a row
they are about to touch**. Writing the order once was one way to guarantee that. It stopped
being available when the basket stopped having lines of its own, and it never was available
to a basket that is not created.

The guarantee is now carried by two rules instead of by a column:

1. **The current session teaches nothing.** A session is "current" while its newest
   purchase is younger than `PURCHASE_SESSION_GAP_MS`. Its purchases are left out of the
   history entirely, so settling milk does not change where milk, or anything else, is
   drawn. That is plan `0110` section 4 word for word: it does not learn while the trip
   runs.
2. **The order is a pure function.** A row's slot depends on the history and on that row's
   own text and products, and on nothing else. So the same basket read twice in one shop
   gives the same order, on any pod, whatever arrived in between.

What does change during a shop is the set of rows, because the basket follows its lists.
A line that arrives is inserted at its computed slot. Every row above it stays where it
was, and every row below it moves down by one, which is what inserting a row is. Plan
`0110` sent a typed line to the end because it had no other slot to give it. A row that
leaves (`REMOVED`, `0138`) keeps its slot for as long as the viewer's mark lasts, because
its slot is computed from its text and products like any other row's.

The history moves only **between** shops. When a shopper comes back after more than six
hours, the session they finished last time joins the seven, the oldest of the seven leaves,
and the basket opens in the new order. Nobody is holding the phone at that moment.

## 3. The history

### 3.1 Whose, and what counts

**The basket's owner's**, as in plan `0110`, including on a shared basket. A named person
who shops the owner's basket sees the owner's order. Learning one order per participant
makes four people in one shop look at four different screens of one basket, and "it
is near the top" stops being something they can say to each other.

A purchase belongs to the owner's walk when it was made **through a basket they own**, of
either kind, by anybody: `line_settlements."basketId"` names a row of `generated_lists`
whose `ownerUserId` is the owner. A guest settling on the owner's basket walked the same
shop, and their taps are as good a record of the aisles as the owner's.

A purchase settled by hand on the list page (`basketId` null) is left out. It is usually
made at home, from the sofa, in the order the list is written in, and it says nothing about
a shop. Plan `0142` defines "a person's purchases" more widely, for a history. This plan's
definition is narrower on purpose, and the two are not to be merged into one fragment.

Standing purchases only (`"revertedAt" IS NULL`), and **both outcomes**, which is plan
`0110` section 2 unchanged: a line closed as `NOT_AVAILABLE` was still a shelf the shopper
stood at.

### 3.2 Sessions

The owner's standing purchases inside the horizon (section 3.3), ordered by `("settledAt",
id)`, start a new session whenever the silence before one is longer than
`PURCHASE_SESSION_GAP_MS`. That is the window of `LOOSE_ROWS_CTE` in `trips.sql.ts`, over a
person instead of over a list. `0130` section 3 defines a session as a run of one basket's
purchases. **Here a session is a run of one owner's purchases across every basket they
own**, because a shopper who settles two rows on a generated basket and one on the `LIVE`
basket in the same aisle walked one shop. Say so in the service's header, in those words.

- A session's id is the id of its earliest settlement, as in plan `0122` section 3.
- A session's start is its earliest `settledAt`. A line's offset is its earliest
  `settledAt` in that session minus the start, in seconds. A line settled twice counts from
  the first.
- **The seven newest ended sessions** are the history. A session is ended when its newest
  purchase is older than `now - PURCHASE_SESSION_GAP_MS`. One that is not is the current
  session, and rule 1 of section 2 leaves it out.
- A session holding a single purchase is a session. It contributes one offset of zero for
  one shelf, which is true and harmless: the median of plan `0110` is what stops one odd
  trip from deciding anything.

### 3.3 The statement

`$1` the owner, `$2` the horizon (`now - WALK_HISTORY_HORIZON_MS`), `$3`
`PURCHASE_SESSION_GAP_MS`, `$4` `now`, `$5` how many sessions (`WALK_SESSIONS`, seven).

```sql
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
```

The predicates that carry rules, each to be stated beside the SQL as `ORDER_HISTORY_SQL`
states its own:

- **`"endedAt" < now - gap`** is rule 1 of section 2. It is a strict `<` so that a session
  whose newest purchase is exactly one gap old is still current, which agrees with
  `continuesPurchaseSession`, where a gap of exactly this long continues the session.
- **`"startedAt" >= horizon + gap`** drops the one session the horizon can have cut in
  half. A session whose first purchase inside the window is less than a gap after the
  horizon can have started before it, and a session missing its beginning reports every
  offset too small. Dropping it costs at most one of seven and only for an owner with
  fewer than eight sessions in the window.
- **The join to `list_lines` does not filter `"deletedAt"`.** A line removed since (`0132`)
  was still a shelf. A line merged away no longer exists, and its settlements moved to the
  survivor with the merge (`line-merge.service.ts`), so the join finds the survivor's text.
  A settlement whose line is gone for good (its list was deleted) drops out of the join,
  and a session left with no row contributes nothing, which costs one of the seven and is
  accepted.
- **`ll."content"` is the line's text as it stands now**, not as it stood when it was
  bought. That is an improvement on plan `0110`, which read the basket line's frozen copy:
  a line renamed from "leche" to "milk" still matches itself.
- `"itemId"::text` inside the aggregate, for the reason `SUGGESTION_RECENT_TRIPS_SQL`
  gives: the driver hands back an array for `text[]` and the literal `{...}` for `uuid[]`.

`WALK_HISTORY_HORIZON_MS` is 180 days and `WALK_SESSIONS` is 7. Both are named constants
at the top of `basket-order.service.ts`, beside the rule, and not environment variables,
for the reason `suggestions.constants.ts` gives: they are a product rule, and a cluster
that answered a different rule from the one the specs prove is a bug nobody can reproduce.
The horizon exists only to bound the window. A shop somebody has not visited for half a
year was rearranged since.

```ts
/** One row of WALK_HISTORY_SQL: one shelf, in one past session of the owner. */
export interface WalkHistoryRow {
  sessionId: string;
  content: string;
  settledItemIds: string[];
  offsetSeconds: number;
}
```

`pickItemId` of `OrderHistoryRow` is gone with the stored pick. What a settlement copied
is the only product a past shelf names, and it is the better key: it is what the shopper
took, not what the run guessed.

### 3.4 Cost, and why there is no cache

The statement runs once per basket read. Its input is the owner's baskets, which
`ix_generated_lists_owner` finds (a `LIVE` one and a handful of `GENERATED` ones), then
their standing settlements, which `ix_settlements_basket_live` of `0134` serves on its
leading `"basketId"` with `"revertedAt" IS NULL` already in the index predicate. The
`"settledAt"` bound is a filter over that range. A household that shops twice a week
for thirty lines writes about 1,500 rows in the horizon, and a window over 1,500 rows is
well under a millisecond of sorting.

Plan `0110` section 3.1 refused a cache because "a create is rare and the answer changes
with every trip". A read is not rare, so the question is asked again here, and the answer
is still no:

- **A cache per process breaks rule 2 of section 2.** Core runs more than one replica. Two
  pods holding histories of different ages answer two orders for one basket, and a client
  that refetches on every event (velista `0086` section 2) lands on either. That is a row
  moving under a thumb, produced by the thing that was meant to make the read cheaper.
- **There is little to save.** The history is stable for the length of a shop by
  construction, so the statement returns the same rows again and again, from an index
  range that stays in the buffer pool.
- **The invalidation rule is not simple.** The history changes when a session ends, which
  no write announces because it is the absence of a write, and when a purchase in a past
  session is reverted.

A shared cache in Redis keeps rule 2 and is the design to reach for **if a measurement
asks for one**: key `walk-history:{ownerUserId}`, the value the rows of section 3.3, a time
to live of ten minutes, deleted by any revert on a basket of that owner. It is not built
here. The integration spec of section 8 asserts one statement per read, which is the number
to watch.

## 4. The order

```ts
/** The little a row has to carry to be ordered. `BasketRowView` of 0136 satisfies it. */
export interface OrderableRow {
  /** The anchor's id (0130, section 3). The last tie break. */
  key: string;
  content: string;
  /** The union of the entries' product sets. Empty for free text. */
  optionIds: string[];
}

@Injectable()
export class BasketOrderService {
  order<T extends OrderableRow>(
    ownerUserId: string,
    rows: T[],
    now: Date
  ): Promise<T[]>;
}
```

1. No rows, no query, as today (`generated-list-order.service.ts:81-83`).
2. One `WALK_HISTORY_SQL`, through the `DataSource` and outside any transaction.
3. `index(rows)` files each history row under every id of `settledItemIds` and under
   `normalizeContent(content)`, exactly as today, with `sessionId` where it had `tripId`.
4. `medianOffset(history, row)`: **the product first, the text second**, and the second
   only when the first finds nothing. `row.optionIds` takes the place of `line.options`.
   `median` still takes one value per session, the earliest, before the median, and the
   median rather than the mean, for the reasons its comment gives.
5. Rows with an offset come first, ascending. Rows with none follow, by
   `normalizeContent(content)` ascending through `compareKeys`, the plain comparison that
   keeps a server's locale out of it.
6. **Ties break on the text and then on `key`**, in both halves. Today two equal offsets
   "keep the order the run composed them in", and there is no composed order any more: the
   rows arrive in whatever order the grouping produced, and leaning on it breaks rule
   2 of section 2. So the comparator of the walked half is `(offset, normalized text, key)`
   and of the other half `(normalized text, key)`. `key` is a uuid and compares as a plain
   string.

**Where it is called.** In the basket read service of `0136`, after the covered lines are
grouped into rows and after `0138` has added any `REMOVED` rows for this viewer, before
`progress` is counted (the counts do not depend on the order, the position of the call
does not matter to them) and before the projection per reader. One call per read, for both
kinds. The owner's id is `generated_lists."ownerUserId"` of the basket being read, never
the reader's.

**A `REMOVED` row.** It carries the text it had, and the products it had when `0138` knows
them. It is ordered by the same function, so it stands where it stood. When it carries no
products it falls back to the text key, which for a line that matched by product can move
it. That is accepted for a disabled row that lives for minutes, and it is to be stated in
the spec rather than hidden.

**The first basket of a new account** is every row in the second half, A to Z. Plan `0110`
section 3 said that is a better order than the one it had, and it still is.

**The client.** velista `0075` section 2 defines `order: 'shop'` as the order of the
server's array, used as it arrives, and `'alpha'` as its own sort. Neither changes. The
caption "Calculated from your last trips" stays true.

## 5. What is left of `position`

`0136` deletes `generated_list_lines`, and with it `position`, `nextPosition`
(`basket-line-limits.ts`) and the owner's reorder route (`0130` section 10). Make sure of
it:

- `grep -rn "position" apps/luna-shopper-backend/core/src/app/baskets
  apps/luna-shopper-backend/core/src/app/generated-lists` finds no basket position. The
  zone list's `list_lines."position"` is a different thing and stays.
- If `BasketRowView` in `libs/luna-shopper/contracts` carries a `position`, remove it from
  the interface, the JSON schema and the mapper, regenerate `openapi.json` and the wire
  types (`0130` section 13), and say so in the pull request. The array is the order. A
  second statement of it is a second thing to keep true.
- If it carries none, this plan changes no contract and regenerates nothing.

## 6. What is deleted

| Deleted                                                                          | Replaced by                                  |
| -------------------------------------------------------------------------------- | -------------------------------------------- |
| `generated-lists/generated-list-order.service.ts`                                | `baskets/basket-order.service.ts`            |
| `generated-lists/generated-list-order.spec.ts`                                   | `baskets/basket-order.spec.ts`               |
| `generated-lists/generated-list-order.integration.spec.ts`                       | `baskets/basket-order.integration.spec.ts`   |
| `ORDER_HISTORY_SQL` and `OrderHistoryRow` in `generated-list.sql.ts`             | `WALK_HISTORY_SQL`, `WalkHistoryRow`         |
| `PAST_TRIP_STATUSES` and `TRIPS` in the old service                              | `WALK_SESSIONS`, `WALK_HISTORY_HORIZON_MS`   |
| the `order` dependency of `GeneratedListService` and its call in `create`        | nothing. A create composes no rows.          |
| the provider in `generated-lists.module.ts`, and its case in the module spec     | the provider beside the basket read service |

Move the pure functions rather than rewriting them, and carry their comments: the reasons
for the median, for one value per trip and for the plain comparison are the design. Where
a comment says "trip", say "session". Where one names plan `0094` (a line split by the
product that was got), name the real case that is left: two lines of one name in two lists,
settled in one session, are one shelf.

## 7. Not in this plan

- An order per participant. Section 3.1.
- An order per shop. `generated_lists` carries `pricingProfileId` since `0133` and a
  settlement carries `priceScopeId` since `0143`, so a later plan can key the history on
  the chain. Nothing here reads either, and `0143` is not a prerequisite.
- A cache. Section 3.4.
- The zone list. A list's order is the aisles as its author wrote them (plan `0012` section
  9), and its drag still writes `list_lines."position"`.
- Learning from purchases settled by hand. Section 3.1.

## 8. Tests

Unit specs (`basket-order.spec.ts`), with the query faked, moved from the old spec and
restated over sessions:

1. Three past sessions settling milk, then skimmed milk, then juice, order those three
   rows that way whatever order the rows arrive in.
2. A product in two of seven sessions takes the median of two. A row with no history comes
   after every row with some, A to Z by normalized text.
3. A row matches by any id of `optionIds` when a past settlement copied that product, and
   a free text row matches by normalized text. The product key wins when both find history.
4. Two history rows of one session under one key count once, from the earlier.
5. Two rows with equal offsets order by normalized text and then by `key`, and the answer
   is the same for every permutation of the input. This is rule 2 of section 2, stated as a
   property over shuffled inputs.
6. A row added to the input takes its slot and the relative order of every other row is
   unchanged.
7. No rows runs no query.

Integration specs (`basket-order.integration.spec.ts`, real database, through their own
target on a slot), because every rule of section 3 is a `WHERE` or a window:

8. Purchases five hours apart are one session and seven hours apart are two. A gap of
   exactly six hours continues the session.
9. **The current session is excluded.** With `now` one hour after the newest purchase, that
   session's rows are absent and the order is the one the older sessions teach. With `now`
   seven hours after it, they are present.
10. Settling a row during a session does not change the order of a read made before and
    after the settle, with `now` fixed inside the session.
11. A reverted settlement is ignored. A `NOT_AVAILABLE` one counts as a visit.
12. Only the seven newest ended sessions are read: an eighth, older one teaches nothing.
13. Purchases through a `LIVE` basket and through a `GENERATED` basket of one owner, inside
    one gap, are one session. A purchase through another owner's basket, and one with a
    null `basketId`, are not in it.
14. A session cut by the horizon is dropped whole, and one that starts a gap after the
    horizon is kept.
15. A purchase on a soft deleted line still teaches its shelf, under the text the line has
    now.
16. One statement per `order` call (counted on the `DataSource`).
17. The basket read of `0136` returns its rows in this order for both kinds, and a guest
    reading the owner's basket gets the owner's order.

Spec traps: no fixed calendar date anywhere (memory note on time bombs). Build every
timestamp from the `now` the spec passes in.

## 9. Acceptance criteria

- [ ] A basket of either kind opens in the order its owner walked their last seven ended
      sessions, with rows they have never bought after the rest, alphabetically.
- [ ] Nothing a shopper does during a session changes the order of the rows on screen.
- [ ] A line that arrives during a shop appears at its computed slot and moves nothing
      above it.
- [ ] The same basket read twice with nothing bought in between gives the same order,
      whatever order the database returned the lines in.
- [ ] The order is computed by one statement per read, served by `ix_generated_lists_owner`
      and `ix_settlements_basket_live`, and nothing caches it.
- [ ] `generated-list-order.service.ts`, its specs, `ORDER_HISTORY_SQL` and any basket
      `position` are gone. No migration was added.

## 10. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper/contracts
npx nx build luna-shopper-backend-core
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

Run `basket-order.integration.spec.ts` through core's integration target against a slot
(memory note on Luna backend spec traps), boot core on that slot once so a broken provider
shows itself (`0130` section 13, the `type` import trap), then give the slot back. Only if
section 5 changed a contract:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```
