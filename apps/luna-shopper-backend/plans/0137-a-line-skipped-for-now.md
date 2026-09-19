# 0137: a line skipped for now

> A shopper can no longer take a line out of a basket (`0130` section 5, `0136` section
> 5.6). What they can say instead is "not today": the row is marked as skipped, stays where
> it is, and after twelve hours becomes an ordinary row again that carries a note saying it
> was skipped earlier. Buying it, or taking the skip back, ends it.
>
> A skip is one trip's intention. It is not a fact about the household's line, nobody
> outside the basket ever sees it, and it expires. So it lives in a table of its own,
> `basket_line_skips`, per basket and per list line, shaped like a settlement (append only,
> taken back with a `revertedAt`) and read by nothing but the basket.
>
> This plan also puts the clock on the other "not today" a `LIVE` basket has: a row the shop
> did not have becomes ordinary again after the same window.
>
> Prerequisite reading: `0130` sections 3, 4, 5 and 11 (decision 3), `0136` in full (the
> read this plan fills two values into, the row resolver, the lock order, `basket.linesChanged`),
> `0047` section 4 (a skipped settle "writes nothing at all", which is the distinction this
> plan finally gives a home), `0052` sections 3 and 4 (the claim), and the memory notes on
> raw SQL in TypeORM and on Luna backend spec traps.
>
> Client half: velista `0092`.

## Brief for the agent

### Objective

Build `basket_line_skips`, the two routes that write it, and the three places `0136`'s read
and claim consult it, so that a row can be `SKIPPED`, can carry `note: 'SKIPPED_EARLIER'`,
and so that `NOT_AVAILABLE` on a `LIVE` basket ends with the window. Regenerate the OpenAPI
document and the wire types.

### Context

- `0136` declared `BasketRowState.SKIPPED` and `BasketRowNote.SKIPPED_EARLIER` and produces
  neither. Its read decides `NOT_AVAILABLE` for a `LIVE` basket from the current session
  alone (`0136` section 3.1, step 7).
- `0136`'s claim SQL (`generated-lists/line-claim.sql.ts`, section 7.1 of that plan) has a
  `NOT EXISTS` that excludes a line the basket closed as `NOT_AVAILABLE`, and says this plan
  adds the skip beside it.
- Every write on a row resolves it through `BasketRowResolver.resolve(basket, coverage,
  rowKey)` and locks the entries `pessimistic_write` in ascending id order.
- `SettlementOutcome` is `BOUGHT` and `NOT_AVAILABLE`
  (`libs/luna-shopper/contracts/src/lib/enums/list.enums.ts:93`). The client's copy says why
  there is no third (`libs/velista/models/src/lib/enums.ts:98`: "there is deliberately no
  `SKIPPED` member").
- `ck_line_settlements_revert`
  (`core/src/app/db/migrations/1756001300000-ParticipantUsernameAndReopen.ts:83` to `89`) is
  the shape of a "both or neither" constraint in this database.
- Core's configuration is `core/src/app/config/app-config.ts`: a Joi key with a default
  (line 95 for the claim window), parsed by `parseDurationMs` from `./duration` into a typed
  group (line 232). A key with a default needs no chart, compose or slot change.
- `LineMergeService.merge` (`core/src/app/lists/line-merge.service.ts`) moves everything an
  absorbed line owns onto the survivor before deleting it, and `list_lines` cascades to
  whatever still points at the absorbed row.

### Target state

Every acceptance criterion in section 11 holds, the rules that are a `WHERE` are proven by
integration specs against a real database, the services boot on a slot, and `openapi.json`
and the wire types are regenerated and committed.

### Scope

- Work only in:
  - `apps/luna-shopper-backend/core/src/app/entities/` (one new entity, the index)
  - `core/src/app/db/migrations/` (one migration, the index)
  - `core/src/app/baskets/` (a new `basket-skip.service.ts`, the read, `basket.sql.ts`,
    `basket-rows.ts`, the core controller, the module)
  - `core/src/app/generated-lists/line-claim.sql.ts` and `line-claim.service.ts`
  - `core/src/app/lists/line-merge.service.ts` (one block)
  - `core/src/app/config/app-config.ts`
  - `apps/luna-shopper-backend/gateway/src/app/baskets/` (two routes, no DTO body)
  - `libs/luna-shopper/contracts` (`basket.messages.ts`, `basket.schemas.ts`, two patterns)
  - the generated files
- Do NOT touch: `SettlementOutcome`, `line_settlements`, `LineView`, the trips SQL, the
  suggestions SQL, `ORDER_HISTORY_SQL`, the settlement history routes, the settle and revert
  services (section 3 is why they need no edit), anything under `libs/velista`.

### Constraints

- A skip is served by the basket read and by nothing else. Section 6 lists the reads that
  must stay ignorant of it, and a spec asserts each.
- Every comparison with the window happens in SQL against `now()`. No `Date.now()` of an
  application server and no device clock decides whether a row is skipped.
- The table is append only. A skip is never updated except to be taken back, and never
  deleted except by a cascade.
- The settle and the revert do not learn that skips exist.

### Action boundaries

- Proceed with in scope edits, the migration, specs and the generators.
- Stop and ask if `0136` is not merged, or if its read does not expose the two seams section
  4 names.
- Stop and ask before adding a value to `SettlementOutcome`, a column to `line_settlements`
  or a field to `LineView`. Section 7 says why none is wanted.

### Progress evidence

Report after the migration runs up and down on a slot, after the two routes pass their
integration spec, after the read produces the two values, and after the claim spec, each
with the command that proved it.

### Session strategy

One session, one pull request, no subagent: the pieces share one table and one SQL fragment.

## 1. What is being built

| Piece                                                        | Where                                              |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `basket_line_skips` and `BasketLineSkip`                     | a migration, `entities/basket-line-skip.entity.ts` |
| `BASKET_SKIP_WINDOW`, `core.basket.skipWindowMs`             | `config/app-config.ts`                             |
| `PUT` and `DELETE /v1/baskets/:id/rows/:rowKey/skip`         | gateway `baskets/`, core `basket-skip.service.ts`  |
| `SKIPPED`, `SKIPPED_EARLIER`, the window on `NOT_AVAILABLE`  | `BasketReadService`, `basket-rows.ts`              |
| a skip releases the claim                                    | `line-claim.sql.ts`, `line-claim.service.ts`       |
| a merge carries skips to the survivor                        | `line-merge.service.ts`                            |

## 2. The table

```sql
CREATE TABLE "basket_line_skips" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "basketId" uuid NOT NULL,
  "lineId" uuid NOT NULL,
  "skippedByParticipantId" uuid NOT NULL,
  "skippedAt" timestamptz NOT NULL,
  "revertedAt" timestamptz,
  "revertedByParticipantId" uuid,
  CONSTRAINT "pk_basket_line_skips" PRIMARY KEY ("id"),
  CONSTRAINT "fk_basket_line_skips_basket" FOREIGN KEY ("basketId")
    REFERENCES "generated_lists" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_basket_line_skips_line" FOREIGN KEY ("lineId")
    REFERENCES "list_lines" ("id") ON DELETE CASCADE,
  CONSTRAINT "ck_basket_line_skips_revert" CHECK (
    ("revertedAt" IS NULL AND "revertedByParticipantId" IS NULL)
    OR ("revertedAt" IS NOT NULL AND "revertedByParticipantId" IS NOT NULL)
  )
);

CREATE INDEX "ix_basket_line_skips_standing"
  ON "basket_line_skips" ("basketId", "lineId")
  WHERE "revertedAt" IS NULL;
```

- **Both foreign keys cascade**, which is where a skip differs from a settlement on purpose.
  A settlement is a zone fact and outlives the basket it came off, so `basketId` carries no
  key there (`line-settlement.entity.ts`, the comment on `settledByParticipantId`). A skip
  means nothing without its basket, and nothing without its line.
- **The two participant columns carry no foreign key**, as on `line_settlements`: they are
  attribution. A participant row is never deleted apart from its basket, so nothing dangles
  in practice, and `0144` renames that table without a constraint to carry.
- **The index is not unique.** A row can be skipped, bought in part (which ends the skip,
  section 3), and skipped again for the rest, and both rows keep a null `revertedAt`. What
  stops two standing skips on one line is the lock the write takes, not the index.
- The entity does not extend `BaseEntity`, for `LineSettlement`'s reason: written once,
  never edited, and `skippedAt` is the time that matters.
- Migration `BasketLineSkips<timestamp>`, the next free timestamp, registered in
  `db/migrations/index.ts` with a comment that it follows `0136`'s migration because it
  references `list_lines` and `generated_lists` and nothing newer. **Up** loses nothing.
  **Down** drops the index and the table, and every skip with them, which is said in its
  comment: a skip is an intention with a twelve hour life, and an older schema has nowhere to
  put one.

## 3. When a skip stands

> A skip **stands** while `"revertedAt" IS NULL` and this basket has no standing settlement
> on that line with `"settledAt"` later than the skip's `"skippedAt"`.

It is **fresh** while it stands and `"skippedAt" > now() - BASKET_SKIP_WINDOW`.

One SQL fragment says it, `STANDING_SKIPS_SQL` in `baskets/basket.sql.ts`, `$1` the basket
and `$2` the window in milliseconds:

```sql
SELECT DISTINCT ON (k."lineId")
       k."lineId" AS "lineId",
       k."skippedAt" AS "skippedAt",
       k."skippedByParticipantId" AS "skippedByParticipantId",
       (k."skippedAt" > now() - ($2::double precision * interval '1 millisecond')) AS "fresh"
FROM "basket_line_skips" k
WHERE k."basketId" = $1::uuid
  AND k."revertedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "line_settlements" s
    WHERE s."basketId" = k."basketId"
      AND s."lineId" = k."lineId"
      AND s."revertedAt" IS NULL
      AND s."settledAt" > k."skippedAt"
  )
ORDER BY k."lineId", k."skippedAt" DESC, k.id DESC
```

### 3.1 Derived, and not a write inside the settle

The other way to end a skip is for the settle to mark it, in its own transaction. That makes
the read one join shorter, and it is rejected, for three reasons:

1. **A revert puts the skip back for nothing.** Skip the milk, buy it by mistake, take the
   purchase back: the settlement is no longer standing, so the `NOT EXISTS` is true again
   and the row is skipped, which is the state the shopper left it in. A settle that had
   ended the skip needs the revert to find it and revive it, and `BasketRevertService`
   walks settlements and knows nothing else.
2. **Three writers stay ignorant.** `BasketSettleService`, `BasketRevertService` and any
   later path that buys through a basket end skips without naming them. A rule that lives
   in one `WHERE` cannot be forgotten by the fourth writer.
3. **The table stays append only**, like the one it is shaped after, so "who skipped this
   and when" is a history and not a current value.

The cost is one `NOT EXISTS` per standing skip on the read, served by `0134`'s
`ix_settlements_basket_line`. A basket holds a handful of skips.

### 3.2 Either outcome ends it, and the newer act wins

The `NOT EXISTS` filters on no outcome, on purpose. `0130` section 4 tests `SKIPPED` before
`NOT_AVAILABLE`, which is right when the skip is the newer act and wrong when it is the
older one: somebody skips the bread at ten, a second shopper looks for it at eleven and the
shop has none, and the row has to say the shop had none. With a close ending the skip that
came before it, the order in `0130` gives the right answer in both directions, because only
the newer of the two acts is left standing:

| Sequence                         | Standing skip | Newest standing settlement | State           |
| -------------------------------- | ------------- | -------------------------- | --------------- |
| skip                             | yes           | none                       | `SKIPPED`       |
| skip, then the shop had none     | no            | `NOT_AVAILABLE`            | `NOT_AVAILABLE` |
| the shop had none, then skip     | yes           | `NOT_AVAILABLE`            | `SKIPPED`       |
| skip, then bought in part        | no            | `BOUGHT`                   | `PARTLY`        |
| skip, bought, purchase taken back | yes          | none                       | `SKIPPED`       |

A purchase made on the **list page**, or through **another basket**, does not end this
basket's skip: it carries another `basketId` or none. It lowers `left`, and a row whose
`left` reaches zero is `DONE` or gone whatever it was before.

## 4. What the read does with it

`BasketReadService` reads `STANDING_SKIPS_SQL` once per basket, after the settlements in
scope, and hands the map to the free functions in `basket-rows.ts`. These are the two seams
`0136` left: `stateOf(row, facts)` and `noteOf(row, facts)`, where `facts` gains
`skips: Map<lineId, { skippedAt, skippedByParticipantId, fresh }>`.

- **`SKIPPED`**: `left > 0`, and every entry with `left > 0` has a fresh standing skip.
  Tested after `REMOVED` and before `NOT_AVAILABLE`, as `0130` section 4 orders them.
- **One unskipped entry makes the row wanted again.** A row of two lists' milk is skipped as
  one gesture (section 5). When a third household asks for milk an hour later, that entry
  has no skip, so the row is `WANTED` and carries the note. New demand is a reason to look at
  the row again, and `0138` marks the row as changed for the same reason.
- **`note: 'SKIPPED_EARLIER'`**: the row's state is not `SKIPPED`, not `DONE` and not
  `REMOVED`, and at least one entry has a standing skip, fresh or not. That covers the skip
  that outlived the window, which is the case the product owner described, and the partly
  skipped row above. It clears when the skip stops standing: bought, closed, or taken back.
- **`NOT_AVAILABLE` on a `LIVE` basket gets the window.** `0136` holds the state while the
  close is in the current session. From now on it also needs `"settledAt" > now() -
  BASKET_SKIP_WINDOW`, whichever ends first, computed in the same query that reads the
  settlements in scope as a boolean `fresh` column beside each row. A `GENERATED` basket is
  unchanged: the shop not having it holds until the trip is finished (`0130` section 4).
  After the window the row is `WANTED` with no note. `touchedBy` and `touchedAt` still say
  who looked and when, which is all the screen needs to say it.
- **`touchedBy` and `touchedAt`** become the newest of the row's scoped settlements **and**
  its standing skips, by time. A skip is an act on the row, and "Marta, 10:42" under a
  skipped row is the same answer to the same question.
- **Counts.** A `SKIPPED` row is in `total` and in `pending` and in neither `done` nor
  `unavailable` (`0130` section 4). `progressOf` needs no change beyond the state.
- **A finished basket** reads no skips. Its rows come from `basket_trip_rows`.

Every one of these is decided from values SQL computed against `now()`. `basket-rows.ts`
receives booleans and never a clock.

## 5. The two routes

`BasketSkipService` in `core/src/app/baskets/basket-skip.service.ts`. Patterns
`basket.row.skip` and `basket.row.unskip`. Both routes sit on the participant surface
behind `ParticipantGuard` with `ParticipantThrottle`, open to **any live participant, a
guest included** (`0130` section 5). The permission is the owner's `WRITE`, which holds by
construction because the row is resolved from a coverage computed for this request. Both
refuse a basket that is not `OPEN` with `GeneratedListFinishedException`. Neither takes a
body, and both answer `BasketRowResult`.

```ts
export interface SkipBasketRowRequest {
  basketId: string;
  participantId: string;
  rowKey: string;
}
```

**Neither carries `from`**, which is the one exception to `0130` section 8's "every write on
a row carries `from`". That guard exists because a number's meaning depends on where it
started. "Not today" means the same thing whether the row says two or three, and refusing a
skip because a flatmate raised the milk a second earlier is friction that protects nothing.
What the state refuses instead is below.

### 5.1 `PUT /v1/baskets/:id/rows/:rowKey/skip`

1. Resolve the row. Compute coverage before the transaction.
2. In one transaction, lock the entries in ascending id order (`0136` section 5).
3. `left` of the locked row is zero: `ConflictException('This row has nothing left to
   skip')`. It was bought while the sheet was open, and the client reads again.
4. For each entry with `quantity > 0` that has **no** standing skip (section 3, asked
   through the transaction's manager), insert one row with `skippedAt = now()` and the
   actor's participant id. An entry that already has one is left alone.
5. So the route is idempotent: a second `PUT` inserts nothing and answers the same row. A
   stale skip (standing, not fresh) is **not** refreshed by a `PUT`. To skip again for another
   twelve hours the shopper takes it back and skips again, which is two gestures for a rare
   wish and keeps the table append only.

### 5.2 `DELETE /v1/baskets/:id/rows/:rowKey/skip`

Same resolution and lock. Every row of `basket_line_skips` for this basket and these entries
with a null `revertedAt` gets `revertedAt = now()` and `revertedByParticipantId`, **standing
or not**: marking one that a purchase already ended costs nothing and leaves no stray row
that a later revert of that purchase can bring back to life. None found is not an error.

### 5.3 After the commit

- `basket.linesChanged { lineIds }` to the **acting basket's** room and its owner's `user:`
  room, as `0136` section 8 emits it. **`0139` must not widen this one.** A skip is private
  to its basket, so it never reaches another basket that covers the same line, and the emit
  site passes that intent explicitly (`0139` names how: a flag on the emit, or a second
  method). Until `0139` lands there is only the one audience and nothing to get wrong.
- The claim, section 5.4.
- **No zone event.** `line.updated` is not emitted, because the line did not change.

### 5.4 A skip releases the claim

A household is told "Marta is buying this" so that nobody buys it twice. Marta said she is
not buying it today, so the line is free while the skip is **fresh**.

- `OPEN_BASKET_COVERS_LINE` and `LINE_CLAIMS_SQL` (`0136` section 7.1) gain a second `NOT
  EXISTS`: no fresh standing skip of that basket on that line. The window travels as a
  parameter from `LineClaimService`, which reads `core.basket.skipWindowMs` beside
  `claimWindowMs`.
- After a `PUT`, `claims.announceReleased(refs)` for the entries it skipped. It already asks
  the derivation rather than assuming, so a line another open basket still holds stays
  claimed.
- After a `DELETE`, and after a settle is reverted onto a skipped row, nothing special: the
  claim is read again by the events those paths already emit. After a `DELETE` alone,
  `claims.announce(true, basket.ownerUserId, refs)` for the entries, when the basket is
  `GENERATED` and inside the claim window, which is one `claimsOf` read and an announce for
  the lines it says are claimed.
- **When the window runs out, no event fires**, because nothing happened except the clock.
  A cold read says claimed and a socket that was listening still says free, until the next
  event on that line. Plan `0052` section 4.1 accepted exactly this for the claim window
  itself ("an old live basket simply stops claiming"), and a sweep that emitted an event per
  expired skip is more machinery than a twelve hour courtesy deserves.
- The suggestions test shares the fragment (`0136` section 7.3), so a skipped line can be
  suggested to the household again. That is the intended consequence and not an accident.
- A `LIVE` basket claims nothing, so its skips release nothing.

## 6. Who never sees a skip

| Read                                                             | Why it stays ignorant                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `LineView` and the list page (`lists/list.mappers.ts`)           | the household's line did not change, and whose trip skipped it is private        |
| `line_settlements` and `GET /v1/lines/:id/settlements`, `GET /v1/items/:id/settlements` | a skip is not a purchase and not an attempt             |
| the trips SQL (`lists/trips/trips.sql.ts`)                       | a trip row says asked, bought and left. A skipped line reads `NOT_BOUGHT`, which is true |
| `basket_trip_rows` at the finish (`0136` section 6)              | **finishing does nothing with a standing skip.** The frozen row says asked and not bought, and the skip dies with nothing to say |
| the suggestions (`lists/suggestions/`)                           | except through the claim fragment of section 5.4                                 |
| the walk order (`ORDER_HISTORY_SQL`, `0141`)                     | a skipped shelf is a shelf nobody stood at                                       |
| a person's history (`0142`)                                      | it is a read of purchases                                                        |
| the admin basket read                                            | an operator sees rows and numbers. A skip is not a number                        |
| any broadcast                                                    | `basket.linesChanged` carries ids                                                |

A spec greps the compiled SQL constants of the first six for `basket_line_skips` and fails
on a match other than the claim fragment, which is the cheapest guard against a later plan
reaching for the table because it was there.

**It dies with its basket** (the cascade), with its line's hard removal (the cascade), and
with the account (`deleteForUser` deletes the baskets). A soft deleted line (`0132`) keeps
its skip rows, which are unreachable because the line is no longer covered, and harmless.

**A line merge carries them.** In `LineMergeService.merge`, before the absorbed row is
deleted: `UPDATE "basket_line_skips" SET "lineId" = survivor WHERE "lineId" = absorbed`.
There is no unique index to collide with, and two standing skips on the survivor for one
basket read as the newer one (`DISTINCT ON` in section 3). Without this the cascade deletes
the absorbed line's skips, and a row the shopper skipped comes back as wanted because
somebody fixed a spelling.

## 7. Why this is not a third `SettlementOutcome`

`0130` section 11, decision 3, written out so that nobody reopens it. The product owner's
own framing was that buying, skipping and the shop having none are all events on a list
line, and two of them already are rows of `line_settlements`. The third is not, for reasons
that are about what the table **means** and about who reads it.

**What it means.** A settlement is a household fact: "A zone line stopped carrying a trip
status here, so what happened on a trip has to live somewhere" (`line-settlement.entity.ts`),
and every member who reads the list reads it. A skip is one shopper's intention for one
trip. It is private, it expires, and it is ended by other events. Plan `0047` section 4
drew this line first: a skipped settle "writes nothing at all", because "I decided not to
buy this today" must not look like "this is done".

**Who reads it.** Every one of these takes any outcome, or the newest outcome, and needs a
filter added and remembered the day a third value exists:

| Read                                                                                     | What a `SKIPPED` row does to it                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `LineView.settlements.lastOutcome`, written at `lists/settlement.service.ts:205` to `211` and by every basket settle | the household's line says "skipped" under everybody's eyes |
| `trips.sql.ts`, `lastOutcome` by `ARRAY_AGG` (lines 71 and 167)                           | a trip row's outcome becomes a skip                              |
| `toTripRowView` (`lists/trips/trips.mappers.ts:53`)                                       | its four outcomes have no branch for a fifth input               |
| `ORDER_HISTORY_SQL`: "Both outcomes count ... so the join filters on no outcome at all"    | a skipped shelf is learned as a visited one                      |
| the suggestions, where `NOT_AVAILABLE` rows "are not purchases" (plan `0123`)             | a third kind of not a purchase, in every rule                    |
| `GET /v1/lines/:id/settlements` and `GET /v1/items/:id/settlements`                       | served to every reader of the list, with the basket's act in it  |
| the loose trip sessions (`LOOSE_ROWS_CTE`)                                                | a skip starts or bridges a session                               |
| `ck_line_settlements_actor`, the revert split of plan `0104` section 3.2                  | both now carry a row kind that has no units and no buyer         |

A filter missed in any one of them fails silently, toward telling a household something
private or teaching the order something false. A separate table fails the other way: a read
that never heard of it shows nothing. **Under inclusion is the safe way to be wrong**, which
is the rule `AppHistory` states for the client and it holds here.

What the two tables share is deliberate: append only, a participant, a time, taken back by a
timestamp and an actor with a "both or neither" constraint. A skip is an event. It is not a
zone event.

## 8. Configuration

`BASKET_SKIP_WINDOW: Joi.string().default('12h')` beside `GENERATED_LIST_CLAIM_WINDOW`
(`app-config.ts:95`), parsed with `parseDurationMs` into a new group:

```ts
basket: {
  /** How long a skip, and a LIVE basket's "the shop had none", keep a row marked. */
  skipWindowMs: number;
};
```

`basket` and not `generatedList`, because new names say `basket` (`0130` section 3). It has
a default, so the Helm chart, `compose.apps.yml` and `luna-slot.sh` need no edit.

## 9. Not in this plan

- The screen: velista `0092`.
- A mark on a row that gained an entry: `0138`.
- The fan out that must leave a skip alone: `0139`, which reads section 5.3.
- A note on a `LIVE` row whose `NOT_AVAILABLE` ran out. `0130` section 3 defines one note,
  and the row's `touchedBy` already says who looked.
- Skipping from the list page. A list has no trip to skip for.

## 10. Tests

Unit, on `basket-rows.ts`, with booleans for the clock:

1. `SKIPPED` needs every entry with `left > 0` skipped and fresh. One unskipped entry gives
   `WANTED` with the note.
2. A standing skip that is not fresh gives `WANTED` with the note. No standing skip gives no
   note.
3. The five sequences of the table in section 3.2, as facts in and a state out.
4. A `SKIPPED` row counts in `total` and `pending` and nowhere else.
5. A `LIVE` row whose close is not fresh is `WANTED` with no note. The same facts on a
   `GENERATED` basket are `NOT_AVAILABLE`.

Integration, real database:

6. `PUT` on a two entry row inserts two rows in one transaction, a second `PUT` inserts
   none, and a guest can do both.
7. `PUT` on a row whose `left` is zero is a conflict. `PUT` and `DELETE` on a finished
   basket are refused with the finished code.
8. Skip, buy one of three through the same basket: the skip no longer stands, the row is
   `PARTLY` with no note. Revert that purchase: the row is `SKIPPED` again with no new row
   written.
9. Skip, then a purchase of the same line from the list page: the skip still stands, and
   `left` fell.
10. Skip, then `NOT_AVAILABLE`: the row says `NOT_AVAILABLE`. The other order says
    `SKIPPED`.
11. `DELETE` marks every unreverted row, including one a purchase ended, and a later revert
    of that purchase leaves the row `WANTED`.
12. The window is the database's: a row inserted with `skippedAt = now() - interval '13
    hours'` reads as not fresh with `BASKET_SKIP_WINDOW` at its default, and as fresh when
    the spec configures `14h`.
13. The claim: a line of a list covered by an open `GENERATED` basket stops being claimed
    on `PUT` and `line.claimChanged` says so, is claimed again on `DELETE`, stays claimed
    when a second open basket covers it, and a stale skip does not release it.
14. A merge of a skipped line into another moves the skip, and the merged row reads
    `SKIPPED`.
15. Deleting the basket removes its skips. Finishing it writes trip rows that say asked and
    not bought, and leaves the skip rows where they are.
16. The guard of section 6: none of the named SQL constants mentions `basket_line_skips`.
17. The migration runs up and down.

Gateway: both routes refuse a caller who is not a participant, and both are throttled.

## 11. Acceptance criteria

- [ ] A participant, a guest included, can skip a row and take the skip back, and doing
      either twice changes nothing.
- [ ] A skipped row reads `SKIPPED` for twelve hours by the database's clock, then `WANTED`
      with `note: 'SKIPPED_EARLIER'`, until it is bought, closed or taken back.
- [ ] Buying through the basket ends a skip with no write to `basket_line_skips`, and
      taking that purchase back restores it with no write either.
- [ ] A `LIVE` basket's `NOT_AVAILABLE` row becomes `WANTED` when the window runs out. A
      `GENERATED` basket's does not.
- [ ] A fresh skip releases the line's claim, and nothing else outside the basket changes.
- [ ] `SettlementOutcome`, `line_settlements` and `LineView` are unchanged, and none of the
      reads in section 6 mentions the new table.
- [ ] A skipped row counts as pending and toward the total.
- [ ] A line merge keeps a skip, and deleting a basket removes its skips.
- [ ] `openapi.json` and the wire types are current.

## 12. Verification

```sh
npx nx run-many -t lint test build -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down
```

Run the integration specs through their own target against that slot, boot the services
once before the pull request (memory note on Nest `type` imports), and give the slot back.
