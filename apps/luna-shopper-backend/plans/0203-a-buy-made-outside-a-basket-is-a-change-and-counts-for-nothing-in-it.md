# 0203: a buy made outside a basket is a change, and counts for nothing in it

> Asked for by the owner on 2026-10-11: "If someone is buying things from a different list,
> you see that as bought and can't remove it. It's fine that you can't remove it because
> it's a change from a different shopping list, but the line should just say it was updated
> and now it needs less amount. Same should happen if someone records a sparse buy from a
> zone list, you didn't buy it so it shouldn't be recorded on your shopping list. This
> doesn't apply to other users using your shopping list, if they buy something, it must be
> reflected accordingly in your shopping list."
>
> His rules, in his words:
>
> - "If a line is settled from a different shopping list, you don't see that buy, the line
>   is crossed out just like when it is deleted from a zone list."
> - "If a line is partially settled from a different shopping list, the amount in your list
>   goes down accordingly."
> - "If, in a different shopping list, a buy is reverted, the amount in your shopping list
>   will go up accordingly, going from settled to partial buy if needed."
> - "In any case, a notification is shown at the top, just like when lines are edited from
>   a zone list. You can see who modified the line, but the shopping list name won't be
>   shown, just the owner of that list."
>
> His answers of the same day to six questions:
>
> 1. A guest sees "Someone".
> 2. "Live basket and generated basket are different lists and won't share anything."
> 3. A buy made on the zone list reads "Bought from the list by X".
> 4. This basket bought some and another bought the rest: "It moves to Done because no
>    units are remaining (instead of 3 now you only have to get 2)."
> 5. "Buys from other baskets don't count toward anything in your shopping list (prices,
>    remaining lines...). If it gets crossed out because it was bought from another
>    shopping list before you bought anything of that line, it is dropped from the
>    progress."
> 6. "Deleted lines will also stay for 6 hours."
>
> **This plan reverses rules that earlier plans wrote down.** Plan `0188` targets 5, 6 and
> 7 (the row is `DONE`, it counts in the progress, nobody is named). Plan `0130` section 11,
> decision 12 (a purchase somebody else made is not a change). Plan `0138` section 2 (a
> settle and a revert write no change row) and the lifetime of a removed row in its
> section 7. Section 9 lists each one.
>
> Velista plan `0142` is the screen. Plan `0204` makes the change arrive at once. Neither is
> needed to build this plan.
>
> Prerequisite reading: plan `0188` in full, plan `0138` in full, plan `0130` sections 4, 6
> and 11, plan `0134` (a purchase names its basket), plan `0137` (a skip and its window),
> plan `0201` section 2 if it is on your base branch,
> `core/src/app/baskets/basket-rows.ts`, `basket-read.sql.ts`, `basket-read.service.ts`,
> `basket-settle.service.ts`, `basket-revert.service.ts`, the folder
> `core/src/app/baskets/changes/`, `core/src/app/lists/changes/line-change.recorder.ts`,
> `core/src/app/lists/settlement.service.ts`,
> `libs/luna-shopper/contracts/src/lib/enums/basket.enums.ts`, `basket.messages.ts` and
> `basket-changes.messages.ts`.

In this plan an **outside buy** of a basket is a purchase of a covered line that was made
through another basket, or on the zone list page with no basket. A buy made through the
reading basket, by any of its people, is an **own buy**.

## Review of 2026-10-11: settle these before you build

A review of pull request #694 checked this plan against the code on `dev`. It found no
false statement about that code. Two things are absent.

1. **This plan does not say what to do when backend `0204` is built first.** Backend
   `0204` moves `stateOf`, `isSkipped`, `closeHolds` and `progressOf` out of
   `basket-rows.ts` into `libs/luna-shopper/basket-rules`. The scope of this plan names
   `basket-rows.ts` and not that library. If `0204` is on your base branch, make the
   changes of this plan to those functions in the library.
2. **This plan reverses backend `0138` sections 2 and 7, and that file has no note.**
   Plans `0130`, `0188` and velista `0131` got one. Add the same kind of note to `0138` in
   the pull request that builds this plan.

## What the build decided

The build of 2026-10-13 settled the points below. Each one is a choice of the builder that
the owner can overturn. Where this section and a later section disagree, this section is
right.

1. **Backend `0204` was on the base branch.** The state `BOUGHT_ELSEWHERE` and its rule for
   the progress are in `libs/luna-shopper/basket-rules` (`rowStateOf`, `progressOf`), as
   review point 1 says. `basket-rows.ts` holds only the note.
2. **The basket is not one more parameter.** Section 2 says that the basket id is a new
   parameter of the three statements. A participant row belongs to one basket, so the
   statements read the basket off the participant they are already given. No caller can
   hand a basket that is not the participant's.
3. **Which change removes a line (section 6).** The new read selects a delete, a quantity
   taken to zero and a rejection, by the columns of the change. An add at zero, a merge and
   a buy are not removals. The newest removal of a line decides, and the rule of the viewer
   is applied after that. One case reads differently: somebody renamed a line and the
   viewer then deleted it. The rename was marked, so the old fold drew a removed row for
   the viewer's own delete. It is not drawn now.
4. **A buy never makes a removed row.** A `BOUGHT` change can outlive its window: the line
   is at zero, the outside buy is older than six hours and the change is still unseen. It
   still counts in `unseenChangeCount`, and it draws no row and no mark.
5. **A `BOUGHT_ELSEWHERE` row has no note `SKIPPED_EARLIER`.** Nothing is left to decide
   about the row, so a skip that still stands says nothing, as on a `DONE` row. The row
   carries the note of the outside buy. Section 3 says that `SKIPPED_EARLIER` wins over
   both notes, and that holds for every state that had it before.
6. **A member is told two people for a buy through another basket.** `origin.owner` is the
   owner of that basket. `actor` keeps its rule, so it is the account of the buyer beside a
   served list. A guest is told neither.
7. **The owner of the other basket is redacted in the statement.** It is loaded only for a
   buy through another basket on a list the reader was served. The mapper has nothing to
   drop.
8. **`marksMoved` is decided for each basket**, as plan `0204` section 3 says.
   `BasketAnnouncer.linesMoved` takes the basket the write was made through, and that
   basket is not told. A write names the lines it recorded a change for, so "they had
   none" tells nobody. A buy on the list page names no basket, so every basket is told.
9. **A buy of a line that is already at zero writes no change row.** The quantities are
   equal, so section 1 says nothing is written. The other baskets still receive the patch
   of plan `0204`, with `boughtElsewhere` raised, and no mark.
10. **No route takes back a buy made on the list page.** `basket-revert.service.ts` is the
    only writer of `revertedAt`, and it loads the settlements of its own basket. So nothing
    writes `BUY_REVERTED` for a list page buy.
11. **The migration replaces a check, and extends no type.** `kind` is a `varchar`.

**Velista reads the new values through its fallbacks until velista `0142` is built.** A
state it does not know reads as `WANTED`, a note it does not know draws nothing, and a
change kind it does not know reads as "something changed". So with this plan alone a row
that another basket bought is drawn as a row still to buy with nothing left.
`apps/velista-luna-e2e/src/member.spec.ts` step 4 asserts the row of plan `0188` (`DONE`,
"Bought on another basket"). That suite gates the staging deploy and does not run on a pull
request. It fails after this plan and before velista `0142`, which must rewrite that step.

The measurement that "Progress evidence" asks for, on a slot with one covered list of 300
lines, 35,000 changes on it over 29 days (30,000 of them buys and taken back buys), 100,000
changes on 20 other lists and 20 lines deleted in the last five hours. The viewer
acknowledged a day ago. `EXPLAIN (ANALYZE, BUFFERS)`:

| Statement | Execution | Shared buffers | How it reads the changes |
| --- | --- | --- | --- |
| The marked changes | 0.29 ms | 223 | backward on `ix_list_line_changes_created`, stops at the cap |
| The unseen count | 0.14 ms | 12 | stops at the cap |
| The removed rows | 0.20 ms | 60 | a range of six hours on `ix_list_line_changes_list` |

## Brief for the agent

### Objective

Record every buy and every taken back buy as a change of its line. Show an outside buy to
a basket as a change, with the person behind it. Give a row that an outside buy closed its
own state, which counts toward nothing. Keep every removed row for six hours.

### Context

Every statement below was read on `dev` at `6cced1bd`. Check each one before you rely on
it.

- **A buy names its basket.** `line_settlements.basketId` is the basket of a basket buy and
  null for a buy on the zone list page. `settledByParticipantId` is set for a basket buy
  and `settledByUserId` for a list page buy, and exactly one of the two is set.
- **A basket counts only its own buys in `bought`.** `BASKET_SETTLEMENTS_SQL` reads
  `s."basketId" = $1`. `left` is `list_lines.quantity`, which every buy lowers.
- **Outside buys are a second sum.** `BASKET_ELSEWHERE_SQL` sums the standing `BOUGHT`
  purchases that are not of this basket, inside `PURCHASE_SESSION_GAP_MS` (six hours). It
  loads a quantity and a time and no person. `coveredLinesSql` keeps a line at zero as a
  row because of the same predicate, `boughtElsewhere()`.
- **Such a row is `DONE` today.** `stateOf` (`basket-rows.ts`) answers `DONE` for
  `left === 0 && (bought > 0 || boughtElsewhereOf(entries) > 0)`. `progressOf` counts it in
  `done` and in `total`. `noteOf` answers `BOUGHT_ON_ANOTHER_BASKET`.
- **A settle and a revert write no change row.** Only `LineService` and
  `LineMergeService` call `LineChangeRecorder`. The check `ck_list_line_changes_kind`
  allows six kinds.
- **A change is hidden from the person who made it.** `NOT_THIS_VIEWERS`
  (`basket-changes.sql.ts`) excludes a change by the participant of the viewer and by the
  account of the viewer.
- **A removed row lives as long as its mark.** `BasketMarksReader` builds a `RemovedGroup`
  from the changes that are still marked for the viewer: unseen, or acknowledged less
  than `changeMarkWindowMs` (ten minutes) ago. `removedRows()` turns each group into a row
  with the state `REMOVED`, no entries, and no part in the progress.
- **One note covers both kinds of outside buy.** `noteOf` answers
  `BOUGHT_ON_ANOTHER_BASKET` for a buy through another basket and for a buy on the list
  page alike.
- **The changes view names a person two ways.** `actorViewOf` serves `{ participantId }`
  for a change made through the reading basket, `{ userId }` only beside a `listId` that
  the reader was served, and null otherwise. A guest is served no `listId`.
- **A basket cannot take back a buy of another basket.** `basket-revert.service.ts` loads
  the settlements of its own basket only and answers `stale_quantity` for the rest.

### Target state

1. A buy that lowers the quantity of a line, and a revert that raises it, each write one
   change row in the transaction of the write (section 1).
2. A buy change is shown to every basket but the one it was made through (section 2).
3. A row that only outside buys closed has the new state `BOUGHT_ELSEWHERE`. It counts
   toward no number of the basket (sections 3 and 4).
4. The changes view says where an outside buy came from, and names the owner of that
   basket by the redaction rule that exists (section 5).
5. A removed row is served for six hours after the change that removed it (section 6).

### Scope

- `apps/luna-shopper-backend/core/src/app/db/migrations/`: one migration.
- `core/src/app/lists/changes/`: the recorder and its kinds.
- `core/src/app/baskets/`: `basket-settle.service.ts`, `basket-revert.service.ts`,
  `basket-rows.ts`, `basket-read.service.ts`, `basket.mappers.ts`, and the folder
  `changes/`.
- `core/src/app/lists/settlement.service.ts`: the buy of the list page.
- `libs/luna-shopper/contracts`: `basket.enums.ts`, `basket.messages.ts`,
  `basket-changes.messages.ts` and their schemas.
- The generated `gateway/docs/openapi.json` and
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`.

### Constraints

- **A change row is written inside the transaction of the write that caused it**, through
  the `EntityManager` of the caller. This is the rule of plan `0138`.
- **Every time is the `now()` of the database.** No application clock decides what is
  recent.
- **Redaction is by omission.** Core serves no name. A column that a reader must not
  receive is not loaded for that reader.
- **The six kinds of today keep their rules.** This plan adds two kinds and one rule for
  them.
- **`openapi.json` and the wire types are generated output.** Run
  `npx nx build luna-shopper-admin` after the regeneration, because the checks do not
  build that app.
- **A fixture never covers a whole zone** (`listId: null`), and a `LIVE` basket fixture
  gets its own zone for each owner (plan `0149`).

### Action boundaries

Stop and ask before any of these:

- Letting one basket take back a buy of another basket.
- Serving the name or the id of the other basket to any reader.
- A window other than `PURCHASE_SESSION_GAP_MS`.
- Writing a row of an outside buy into `basket_trip_rows`.
- A new event or a change to a payload. Plan `0204` owns that.

Do not build velista plan `0142`, plan `0204` or plan `0205`.

### Progress evidence

- `npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models`
  passes.
- The integration specs of section 8 run on a slot against a real Postgres, red before
  and green after.
- `EXPLAIN (ANALYZE)` of the marked changes query and of the removed rows query, on a list
  with a few hundred lines and a long history of buys, is in the pull request.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types` are run and their diffs committed.

## 1. A buy and a taken back buy are changes

`LineChangeKind` gains `BOUGHT` and `BUY_REVERTED`. The migration replaces
`ck_list_line_changes_kind` with a check that allows the eight kinds. The down migration
deletes the rows of the two new kinds and puts the old check back.

`LineChangeRecorder` gains two methods, `bought` and `buyReverted`. Each takes the manager,
the list, the line id, the quantity before and after, and the actor. Each fills
`quantityBefore` and `quantityAfter` and no other pair. **Each writes nothing when the two
quantities are equal.**

| Write | Row |
| --- | --- |
| A basket buy with the outcome bought (`basket-settle.service.ts`) | `BOUGHT`, one for each line it lowered, with `actorParticipantId` and `basketId`, and `actorUserId` when the participant has an account |
| A basket revert that gives units back (`basket-revert.service.ts`) | `BUY_REVERTED`, with the same three columns |
| A buy on the list page (`SettlementService.settle`) | `BOUGHT`, with `actorUserId` and no basket |
| "They had none", a skip, a skip taken back | none. The quantity of the line does not move |
| The rewrite of a buy by plan `0202` | none. It moves no quantity |

Read first whether a buy made on the list page can be taken back, and where. If a route
does it, that route writes `BUY_REVERTED` too. If none does, say so in the pull request.

The actor of a basket buy by a guest has a participant and no account. That is the shape
plan `0138` already stores for a change of demand by a guest.

## 2. Who a buy change is for

For the two new kinds, and only for them:

- **A basket is shown the change exactly when `ch."basketId"` is distinct from that
  basket.** A null `basketId` is distinct from every basket.
- **`NOT_THIS_VIEWERS` does not apply.** A buy made through one basket of an account is a
  change in the other basket of the same account. That is the owner's answer 2. A buy on
  the list page is a change in the basket of the person who made it. That last point
  follows from his words ("you didn't buy it so it shouldn't be recorded on your shopping
  list") and is the reading of this plan.

The rule is the same for every reader of one basket. Plan `0204` relies on that.

Change `MARKED_CHANGES_SQL`, the count of unseen changes and the acknowledgement so that a
change is selected by its own rule: the new rule for the two new kinds, `NOT_THIS_VIEWERS`
for the six old ones. The basket id is one more parameter. The changes view
(`GET /v1/baskets/:id/changes`) is a history and lists every change of the covered lists,
as today. The own buys of the reading basket are in it too, served with their participant.

## 3. The state of a row

`BasketRowState` gains `BOUGHT_ELSEWHERE`. An entry can have it too.

| Nothing left, and | State |
| --- | --- |
| this basket bought some of it | `DONE`, as today. `asked` is `bought`, so a row that asked for 3 and bought 2 reads "2 of 2" |
| this basket bought none, and an outside buy is inside the window | `BOUGHT_ELSEWHERE` |
| neither | not a row, as today |

- With something left, the state is what the table of plan `0130` section 4 gives. An
  outside buy changes only `left`.
- A skip and "they had none" are tested first and need something left, as today. So they
  never meet the new state.
- A row of several lines is `BOUGHT_ELSEWHERE` only when nothing is left on any of them
  and this basket bought none of them.
- `boughtElsewhere` stays on the row and on the entry, as a number that no count uses.
- **The note says which kind of outside buy it was.** The owner asked on 2026-10-11 that
  the row says "Bought from another shopping list" when that is the cause.
  `BOUGHT_ON_ANOTHER_BASKET` now means that the newest outside buy of the row was made
  through a basket. A new value, `BOUGHT_ON_THE_LIST`, means that it was made on the zone
  list page. `noteAt` is the time of that buy in both cases. `SKIPPED_EARLIER` still wins
  over both.
- `BASKET_ELSEWHERE_SQL` therefore answers one more column for each line: whether its
  newest outside buy has a basket. A boolean, never the id.

A `BOUGHT_ELSEWHERE` row is not a `REMOVED` row. Its lines are covered, it has its
entries, and a change of demand on it works by the rule that exists (`demandEditable`).
Raising a line above zero makes the row `WANTED` again. A revert sent from this basket is
refused, as today.

## 4. What an outside buy counts toward

Nothing.

- `progressOf` leaves a `BOUGHT_ELSEWHERE` row out of `done`, `unavailable`, `total` and
  `pending`, as it leaves a `REMOVED` row out.
- `bought` and `asked` already count the own buys alone. Check every other sum of the
  read and of the history counts (`BasketHistoryView`, the summary of a shared basket)
  for a use of `boughtElsewhere` or of the state `DONE` that an outside buy reached.
- A finished basket writes no trip row for a line it never bought (plan `0188`,
  target 10). That does not change.
- The usual shop of plan `0165` counts the buys of a line, whoever made them. It is a fact
  about the household and it does not change.

## 5. The changes view names where a buy came from

`BasketChangeView` gains `origin`:

```ts
type BasketChangeOrigin =
  | { kind: 'ANOTHER_BASKET'; owner: BasketChangeActorView | null }
  | { kind: 'LIST' };

interface BasketChangeView {
  // ...as today
  /** Set for `BOUGHT` and `BUY_REVERTED` that were not made through this basket. */
  origin: BasketChangeOrigin | null;
}
```

- `ANOTHER_BASKET` is a change with a `basketId` that is not the reading basket. `LIST` is
  a change with no `basketId`. A buy of the reading basket has `origin: null` and its
  participant in `actor`, as a change of demand has today.
- **`owner` is the owner of the other basket** (`baskets."ownerUserId"`, read with a left
  join on the stored `basketId`). It is served as `{ userId }` only beside a served
  `listId`, which is the rule `actorViewOf` applies to an account today. Otherwise it is
  null. A guest is served no `listId`, so a guest gets null and the client says "Someone".
  A basket that was deleted since gives null too.
- `actor` keeps its rule. For a buy on the list page it is the buyer, by the same
  `listId` rule.
- **The id and the name of the other basket are never loaded** beyond the join above, and
  never served.

## 6. A removed row stays for six hours

The owner's answer 6 gives both kinds of crossed out row one lifetime.

- A row whose lines left the coverage (a line deleted, a demand set to zero, an approval
  that became `REJECTED`) is served while the change that removed it is younger than
  `PURCHASE_SESSION_GAP_MS`, by the clock of the database, and while the basket is open.
- It no longer leaves ten minutes after the viewer acknowledged it. `mark` is `REMOVED`
  while the change is still marked for the viewer, and null after that. The state stays
  `REMOVED` in both cases.
- **Who is served the row does not change.** The removal a viewer made is still not drawn
  for that viewer. Only the lifetime moves.
- `BasketMarksReader` therefore reads the removing changes of the window with one more
  query, apart from the marked changes. Measure it (see "Progress evidence").
- `changeMarkWindowMs` keeps its meaning for the marks `ADDED` and `CHANGED`.

## 7. The marks of the two new kinds

| The change, for a basket it is shown to | The row |
| --- | --- |
| `BOUGHT` | the row that holds the line gets `mark: 'CHANGED'` |
| `BUY_REVERTED` | the same |

`ADDED` still wins over `CHANGED` on one row. A row with the state `BOUGHT_ELSEWHERE` and
the mark `CHANGED` is the ordinary case of a line that somebody else just bought.

`unseenChangeCount` and `newestUnseenChangeId` count these changes by the rule of
section 2.

## 8. Tests

Unit specs for the recorder (each method writes one row, and none for equal quantities),
for `stateOf` and `progressOf`, and for the fold of the two kinds into marks. Integration
specs on a real Postgres for everything below. Two `LIVE` baskets, A and B, over one list.

1. A buys a line to zero. B reads the row as `BOUGHT_ELSEWHERE` with `bought: 0`, the
   mark `CHANGED` and one unseen change. The progress of B does not count the row. The
   read of A is what it is today, with no mark and no unseen change.
2. A buys one of three. The row of B has `left: 2`, the state of today and the mark.
3. B buys two of three, then A buys the last. The row of B is `DONE` with `bought: 2` and
   `asked: 2`, and it counts as done.
4. A takes its buy back. The row of B has the units back, the mark, and a second change.
   From `DONE` with own buys it becomes `PARTLY`.
5. A second participant of B buys a line. B reads an own buy, with `touchedBy`, no mark
   and no unseen change.
6. A buy on the list page gives B the row of test 1 with the note `BOUGHT_ON_THE_LIST`
   and a change with `origin.kind` `LIST`. The basket of the buyer is shown the change
   too. A later buy of the same line through A turns the note into
   `BOUGHT_ON_ANOTHER_BASKET`.
7. The same account owns a `LIVE` and a `GENERATED` basket over one list. A buy through
   one is a change in the other.
8. The changes view: a member who writes the list gets `origin.owner` as `{ userId }`. A
   guest gets `owner: null` and no `listId`. No answer holds a basket id but the own one.
9. "They had none" and a skip write no change row.
10. A revert from B of the buy of A is refused, and the buy of A stands.
11. A demand raised from B on a `BOUGHT_ELSEWHERE` row makes it `WANTED`.
12. An outside buy older than the window gives no row. Move the clock through
    `settledAt`, never through a mocked `Date`.
13. A deleted line is a `REMOVED` row five hours after the delete and after an
    acknowledgement, with `mark: null`. It is no row seven hours after.
14. The migration, up and down.
15. `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

## 9. What this plan reverses

| Earlier rule | Now |
| --- | --- |
| `0188` target 5: nothing left and no own buy is `DONE` | `BOUGHT_ELSEWHERE` |
| `0188` target 6: the row counts in `total` and `done` | it counts toward nothing |
| `0188` target 7: nobody is named | the owner of the other basket is named, by the rule of section 5 |
| `0130` decision 12: a purchase somebody else made is not a change | an outside buy is a change. An own buy is still not marked |
| `0138` section 2: a settle and a revert write no row | each writes one when the quantity moved |
| `0138` section 7: a removed row lives as long as its mark | six hours from the change |

Unchanged: `0188` targets 1 to 4 and 8 to 12.

## 10. Not in this plan

- The row, the banner and the sentences of the changes sheet (velista `0142`).
- Telling a basket at once that a line moved (plan `0204`).
- A push notification about a buy.
- A way to take back the buy of another basket.
