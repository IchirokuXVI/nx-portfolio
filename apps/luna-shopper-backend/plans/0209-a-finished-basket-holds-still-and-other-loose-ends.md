> **PR:** [#724](https://github.com/IchirokuXVI/nx-portfolio/pull/724)

# 0209: a finished basket holds still, and other loose ends

> Asked for by the owner on 2026-10-14: "create a cleanup plan for the backend to fix the
> remaining defects you mentioned". Every backend plan up to `0207` is built. What is left
> is what the status reports [`0149`](./0149-plan-0130-status-2026-09-23.md) section 6,
> [`0171`](./0171-plan-status-2026-09-29.md) section 3 and
> [`0208`](./0208-plan-status-2026-10-11.md) sections 4 and 6 found and nobody fixed: four
> defects, stale text, and plan headers that do not match the code.
>
> Every fact below was read on `dev` at `2052cf7b` on 2026-10-14.
>
> Prerequisite reading: `0130` sections 4, 11 and 13, `0138` (the edit of a line in a
> transaction), `0201` "What the build decided" (rows of products, and why a finished
> basket still counts lines), `0204` (the events of a basket),
> `core/src/app/baskets/basket-read.service.ts`, `basket-read.sql.ts`,
> `basket-trip-rows.sql.ts`, `basket.sql.ts`, `core/src/app/lists/line.service.ts`,
> `core/src/app/baskets/basket-demand.service.ts`,
> `libs/luna-shopper/contracts/src/schemas/events/realtime.schemas.ts` and
> `contracts/src/schemas/asyncapi.ts`.

## What the build decided

The build of 2026-10-15 settled the points below. Each one is a choice of the builder that the
owner can overturn. Where this section and a later section disagree, this section is right. The
base was `dev` at `f7c49941`.

Point 1 is a decision of the owner.

1. **The owner decided on 2026-10-15: a finished basket draws a line deleted after the
   finish.** The trips read differs on this one case and does not draw it. Section
   1.1 says the deleted line is drawn and asks to match the trips read, and section 7 tests it
   drawn. The trips read (`lists/trips/trips.sql.ts`, `basketRowsCte`) joins `list_lines` with
   `"deletedAt" IS NULL`, so a finished trip drops a line deleted after it (plan `0132`). The
   two cannot be matched. The build draws it, which is what the history count of a finished
   basket already did (`FINISHED_BASKET_COUNTS_SQL` read no `list_lines`) and what the admin
   detail still does (`FINISHED_BASKET_ROWS_SQL`). `FROZEN_LINES_SQL` therefore has no
   `"deletedAt"` predicate. A list the owner lost is drawn on both reads.
2. **The frozen read is one statement for any number of baskets.** `FROZEN_LINES_SQL` takes
   basket ids, so the screen asks it for one basket and the history for a page.
3. **The history count is computed in TypeScript and not in SQL.** Section 1.2 says to read the
   rule of a row from `groupEntries` and not to write a second one, and SQL cannot call it.
   `FINISHED_BASKET_COUNTS_SQL` is removed. `BasketReadService.finishedProgressOf` reads the
   frozen lines, their products and the purchases for a whole page in three queries
   (`BASKETS_SETTLEMENTS_SQL` is the purchases of several baskets), groups them with no picks
   and counts with `progressOf`. The admin list and detail take the same count, because they
   ask `BasketService.countsFor`.
4. **The count does not apply the cap of 1,000 rows.** The screen cuts after the walk order, and
   the history reads no walk order. The two differ only above 1,000 rows.
5. **A finished basket reads no change marks**, so its `unseenChangeCount` is 0 and its
   `newestUnseenChangeId` is null. Before this plan it counted the changes of its lists after the
   finish.
6. **The full read with picks can group one line differently from the count**, the case plan
   `0201` point 1 already names. The count takes no picks.
7. **The edit authorizes again under the lock**, as `applyRename` does, because the approval of
   the line can move between the two reads.
8. **A rename checks `from` too.** It takes the same lock, so a rename that also sends a
   quantity is refused the same way.
9. **`from` is checked whenever it is present**, also on an edit that sends no `quantity`.
10. **`PATCH /v1/lines/:id` documents `409 stale_quantity`.** The error code exists already.
11. **One payload schema was already there.** `event/BasketLinesChangedEvent` was written by
    plan `0204`. The build added `event/BasketUpdatedEvent` and two envelopes,
    `event/DomainEvent/basket.linesChanged` and `event/DomainEvent/basket.updated`, whose
    `payload` is a `ref` to those schemas. The envelope schema of every other event keeps
    `payload` as anything.
12. **`list-names.ts` has no caller.** `namesOfLists` is called by nothing on this base. The
    build corrected its comment and kept it.
13. **`BASKET_CLAIMED_LINES_SQL` is now `BASKET_ZONE_LINES_SQL`.**
14. **The velista copies of `seesZoneData`** (`libs/velista/...`, five places, comments and one
    spec fixture) are not changed, because the action boundaries leave velista alone.
15. **Plan `0087` is built in part.** The header names what `0182` built and what it did not:
    D7, D8, D10, D11, the views of section 9 and the relation of section 3.2.
16. **Prettier reordered the imports** of some files whose comments this plan corrects. Those
    files were not formatted on `dev`.
17. **The changes routes read no marks for a finished basket either** (follow up PR
    [#729](https://github.com/IchirokuXVI/nx-portfolio/pull/729)). The marks route answers none, the changes page lists the history with
    `unseen: false` on each item, and an acknowledgement answers `unseenChangeCount: 0`, so
    all three agree with the full read (decision 5).
18. **The admin detail of a finished basket draws its rows by product** (follow up PR
    [#729](https://github.com/IchirokuXVI/nx-portfolio/pull/729)). `getBasket` reads `BasketReadService.unredactedRows` (was `openRows`) on
    every status, so its rows are the frozen rows grouped as `countsFor` groups them, and
    `FINISHED_BASKET_ROWS_SQL` is gone. No wire shape changed. The contract comments say
    that a row is one product.

17. **The velista copies were changed after the build** ([#730](https://github.com/IchirokuXVI/nx-portfolio/pull/730)). Their comments name the old
    all or nothing flag, and the people sheet spec fixture no longer sets it.

## Brief for the agent

### Objective

Close the four defects that the status reports found in the basket series, remove the
text that describes code which no longer exists, and make the plan headers say what the
code does. Change no behaviour that a person asked for.

### Context

- **A finished basket reads today's lists.** `BasketReadService.rowsOf`
  (`basket-read.service.ts:371`) always runs `COVERED_LINES_SQL` (`:397`) against the live
  lists. So does `keyedLinesOf` (`:148`). Only `skipsOf` (`:593`) and `elsewhereGapOf`
  (`:667`) branch on the status. The two rows routes of `0205` ask the same `basket.get`,
  so they share the defect.
- **What a finished basket asked is already frozen.** `BasketService.update`
  (`basket.service.ts:740`) runs `BASKET_TRIP_ROWS_FREEZE_SQL` on the way to `FINISHED` or
  `ARCHIVED` and `THAW` on the way back, in the transaction of the status change. A row of
  `basket_trip_rows` holds `basketId`, `listId`, `lineId` and `asked`, one for each zone
  line. The trips read (`lists/trips/basket-asked.sql.ts`), the suggestions, the history
  counts (`FINISHED_BASKET_COUNTS_SQL`, `basket.sql.ts:96`) and the admin detail
  (`admin-list.service.ts:689`) read it. The screen of the basket does not.
- **A finished basket counts lines, an open one counts products.** `0201` made a row one
  product and `progressOf` of `@portfolio/luna-shopper/basket-rules` counts rows.
  `FINISHED_BASKET_COUNTS_SQL` counts lines. The owner chose to count products (`0201`).
  `0201` left the finished count alone because its scope did not reach it.
- **The plain edit of a line takes no lock.** `LineService.update` (`line.service.ts:1555`)
  reads the line through `listAccess.getLine` outside any transaction. `applyLineEdit`
  (`:1623`) and `prepareEdit` change that object, and `writeEdit` (`:2692`) saves it in a
  transaction (`:1661`). A settle that lands between the read and the save is lost.
  `UpdateLineRequest` (`contracts/.../messages/list.messages.ts:745`) and `UpdateLineDto`
  (`gateway/.../lists/list.dto.ts:245`) carry no `from`.
- **The basket already does this right.** `BasketDemandService.setDemand`
  (`basket-demand.service.ts:72`) calls `LineService.addQuantity` with `expect`.
  `addQuantity` (`line.service.ts:2528`) reads the line again `FOR UPDATE` and throws
  `StaleQuantityException` when the quantity is not the one expected. `applyRename`
  (`:1877`) locks the same way.
- **Two request schemas still declare a field that no type has.** `defaultTargetListId` is
  in `createRequest` (`basket.schemas.ts:922`) and `updateRequest` (`:976`). No TypeScript
  type in `contracts/src/lib` has it. `core/docs/data-model.md:248` still names it, with
  `sourceSnapshot` and "default DRAFT".
- **The AsyncAPI document describes the envelope and not the events.** Every subject of
  `DOMAIN_EVENT_SUBJECTS` (`realtime.events.ts:362`, 40 events) maps to one envelope whose
  `payload` is `any()` (`realtime.schemas.ts:49`). The envelope still declares `basketId`
  "for one release" (`:42` to `:48`), and nothing reads it: `basketsOf`
  (`realtime/.../consumer/sweeps.ts:24`) reads `basketIds`. `buildAsyncApiDocument()`
  (`contracts/src/schemas/asyncapi.ts:11`) is exported and called by nothing. No target
  writes a document, and no spec checks one.
- **The two rules for a settle differ, and the difference cannot be reached.**
  `WRITABLE_LIST` (`basket.sql.ts:28`) asks for a literal `WRITE` grant or a zone `OWNER`
  or `ADMIN`. `canSettle` (`lists/list-acts.ts:34`) accepts `WRITE` or `MANAGE`.
  `normalizeGrant` (`lists/list.service.ts:123`) adds `WRITE` to every grant that holds
  `MANAGE`, and every other path writes `WRITE` too. Only a row written by hand in SQL can
  hold `MANAGE` without `WRITE`. `0130` decision 1 says both surfaces ask `WRITE`.

### Target state

1. A finished basket shows what it asked when it finished, and its numbers never move
   again. Its history card counts products, as an open basket does (section 1).
2. A quantity typed on the list page can no longer overwrite a purchase, and a client can
   send the quantity it saw (section 2).
3. The contracts describe what is sent: no dead field, a correct comment on a settle, and a
   schema for each basket event (section 3).
4. Both surfaces ask one rule for a settle (section 4).
5. The stale text of section 5 is gone, and the headers and documents of section 6 say
   what the code does.

### Scope

- `apps/luna-shopper-backend/core/src/app/baskets`: `basket-read.service.ts`,
  `basket-read.sql.ts`, `basket-line-facts.ts`, `basket.sql.ts`, `basket.service.ts`,
  `basket-redaction.ts`, `list-names.ts`, `basket-sharing.service.ts`,
  `baskets.module.ts`, `line-claim.sql.ts`, and their specs.
- `apps/luna-shopper-backend/core/src/app/lists`: `line.service.ts`, `list-acts.ts`,
  their specs.
- `apps/luna-shopper-backend/core/src/app/admin/admin-list.service.ts` (one comment).
- `apps/luna-shopper-backend/core/docs/data-model.md`.
- `apps/luna-shopper-backend/gateway/src/app/lists`: `list.dto.ts`, `list.controller.ts`.
  `gateway/src/app/baskets`: `baskets.controller.ts`, `participant.guard.ts`. Their specs.
- `apps/luna-shopper-backend/realtime/src/app/consumer/jetstream.consumer.ts` (one
  comment).
- `libs/luna-shopper/contracts`: `list.messages.ts`, `basket.messages.ts`,
  `realtime.events.ts`, `basket.schemas.ts`, `realtime.schemas.ts`, `asyncapi.ts`, the list
  schemas, `schemas.spec.ts`.
- `apps/luna-shopper-backend/gateway/docs/openapi.json` and
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, both regenerated.
- The plan files and the document of section 6.

### Constraints

- **No migration.** Every fix reads or writes tables that exist.
- **The thaw stays as it is.** A basket that goes back to `OPEN` reads the live lists
  again, as it does today.
- **`from` is optional.** A request without it behaves as today, apart from the lock.
  Velista, the back office and the assistant keep working with no change.
- **A refusal reuses what exists.** A stale `from` answers the error the demand route of
  the basket answers today for a stale `from`. Add no error code.
- **Raw SQL is checked against a real Postgres**, as the other basket reads are.
- **`openapi.json` and the wire types are generated output.** Run both targets and commit
  the diffs. Never edit either by hand.

### Action boundaries

- Do not change velista, the back office or the e2e projects. Section 2 names the client
  follow up.
- Do not drop the old section tables of `0200`. Section 8 says why.
- Do not change what an open basket reads, or the rules of `0201` to `0205`.
- Stop and ask before you change the shape of a basket answer, or add a column or a table.

### Progress evidence

- `npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper-backend-realtime luna-shopper/contracts`
  pass, and `npx nx build` passes for core and the gateway.
- The integration specs of section 7 ran on a Luna slot against a real Postgres.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types` are run and their diffs committed.
- The pull request lists each item of section 5 with the file it was removed from.

## 1. A finished basket holds still

### 1.1 The read

A `GENERATED` basket that is not open reads its lines from `basket_trip_rows` and not
from today's coverage.

- Add `FROZEN_LINES_SQL` to `basket-read.sql.ts`. It answers the same `CoveredLineRow` that
  `COVERED_LINES_SQL` answers, from `basket_trip_rows` joined to `list_lines`, with
  `quantity` taken as what is still left of `asked` after the purchases of this basket.
- `rowsOf` and `keyedLinesOf` use it when the basket is `GENERATED` and not open (the test
  `isOpenBasket` already exists). For that case they skip the reads that only an open
  basket needs: the purchases made elsewhere and the change marks.
- `toEntries`, `groupEntries` and `toRowView` do not change. A finished basket is thus
  drawn by the same code as an open one, from numbers that stop.
- **A line that was deleted after the finish is still drawn**, and so is a list the reader
  lost, because the trip happened. Match what the trips read
  (`lists/trips/basket-asked.sql.ts`) does for both cases. If the two cannot be matched,
  stop and ask.
- **The redaction of names does not change.** A reader who cannot see a list today sees the
  same placeholder that an open basket shows them.
- A `LIVE` basket is never frozen, and nothing here changes it.

**What stays live.** The name of a line, its products and its favourite are read from
today's rows. A finished trip thus keeps its numbers and shows today's names. That is
enough for the defect, which is about numbers, and it needs no new column.

### 1.2 The count

`FINISHED_BASKET_COUNTS_SQL` (`basket.sql.ts:96`) counts what a finished basket asked and
got in products, as `progressOf` does for an open one. Group the frozen lines by the
product of their row, with the rule that `0201` uses to build rows. Read that rule from
`basket-rules` or from `groupEntries`, and do not write a second one.

If the history card of the same basket then shows a number that differs from its screen,
the build is wrong. Section 7 tests it.

### 1.3 The two comments

`basket-read.service.ts:589` and `basket-line-facts.ts:79` say "A finished basket reads
none. Its rows come from `basket_trip_rows`". After this section they are true. Check that
each still describes the code next to it, and correct the wording if not.

## 2. A quantity typed on the list page waits for the purchase

### 2.1 The lock

In `applyLineEdit`, inside the transaction that `update` opens, read the line again with a
`pessimistic_write` lock, as `applyRename` does, and hand that row to `prepareEdit`. It
already takes a manager. The object read before the transaction is then used for the
access check only.

`updateAsOperator` goes through `applyLineEdit` and gets the lock with no change.

### 2.2 `from`

`UpdateLineRequest`, its schema and `UpdateLineDto` gain an optional `from`: the quantity
the client saw.

- When it is present, the locked quantity must equal it, or the edit is refused with the
  error the basket's demand route answers for a stale `from`.
- When it is absent, the edit writes the value it was given, as today.
- The DTO accepts a whole number of 0 or more, with the rules of `quantity`.

**The client follow up.** Velista does not send `from` today. A velista plan sends it from
the quantity control of the list page and the line page, and reads the refusal the way the
basket reads it. Name that follow up in the pull request. It is not built here.

### 2.3 Text that becomes false

- The `writeEdit` docstring (`line.service.ts:2681`): "update opens one only when it is
  also rewriting the product set" has been false since `0138`.
- `line.service.ts:2515`: "`update` needs no lock because the value it writes is one the
  caller chose" is false after this section.
- The docstring of `basket-demand.service.ts:48` describes the race on `update`. Keep the
  reason it gives for `expect`, and remove the claim that `update` races.

## 3. The contracts say what is sent

### 3.1 `defaultTargetListId`

Remove it from `createRequest` and `updateRequest` in `basket.schemas.ts`. Correct the
block of `core/docs/data-model.md` around line 248: no `defaultTargetListId`, no
`sourceSnapshot`, and the default status that the entity has today. Leave the migrations
alone. They are history.

### 3.2 The comment on a settle

`basket.messages.ts:705` says the quantity is "Required for `BOUGHT`, refused for
`NOT_AVAILABLE`". `resolveUnits` (`basket-settle.service.ts:327`) takes what the row still
asks for when the quantity is absent, and ignores the quantity on `NOT_AVAILABLE`. Write
what the code does.

### 3.3 A schema for each basket event

- Add payload schemas for `BasketLinesChangedEvent` (`realtime.events.ts:298`) and
  `BasketUpdatedEvent` (`:341`). Reuse a view schema where a payload already has one.
- In the event contracts, map the subject of each of those events to an envelope whose
  `payload` is a `ref` to its schema. Every other event keeps `any()`. Its payload has no
  type in `contracts/src/lib/events` today, and writing forty types is not this plan.
- Remove `basketId` from the envelope schema and the comment above it.
- Add a spec in `schemas.spec.ts` that builds the document with `buildAsyncApiDocument()`
  and asserts that every `$ref` in it resolves, and that the two basket events name their
  own payload.

Nothing writes the document to a file today, and nothing reads one. This plan adds no
target and no committed file. The spec is what keeps the schemas honest.

## 4. One rule for a settle

`canSettle` (`list-acts.ts:34`) asks `WRITE`, as `WRITABLE_LIST` does and as `0130`
decision 1 says. No grant that the app writes changes its answer, because every grant with
`MANAGE` also holds `WRITE` (`normalizeGrant`). Only a row written by hand in SQL is
affected, and both surfaces then refuse it the same way.

Add one spec that a grant of `MANAGE` without `WRITE` settles on neither surface.

## 5. Stale text

None of these changes behaviour. Each misleads the next reader. Remove or correct each one.

| Where | What |
| ----- | ---- |
| `core/.../baskets/list-names.ts:24`, `basket-redaction.ts:9`, `basket-sharing.service.ts:782` and `:1003`, gateway `participant.guard.ts:42` | `seesZoneData`, a name that no code holds. Write what the code checks now |
| `gateway/.../basket-prices.spec.ts:537`, `participant-throttler.guard.spec.ts:61`, `core/.../basket-shared-people.integration.spec.ts:834`, `basket-sharing.spec.ts` (six places) | `seesZoneData` in spec fixtures and names. Remove it from each fixture and rename each case after what it tests |
| gateway `baskets.controller.ts:217` | "the four statuses". `BasketStatus` has three |
| gateway `baskets.controller.ts:234` | the delete docstring names generated rows and copied lines |
| gateway `baskets.controller.ts:250` | an orphan "Reorder the basket" docstring with no method under it |
| realtime `jetstream.consumer.ts:391` | "Both names are read, for one release". The code reads one |
| core `baskets.module.ts:170` to `:197` | comments about the split by product (`0094`) and the waiting purchases, with no provider under them |
| core `line-claim.sql.ts:129` | `BASKET_CLAIMED_LINES_SQL`. No claim exists. It lists the zone lines a generated basket covers. Rename it after that, with its callers |
| contracts `realtime.events.ts:346` and core `admin-list.service.ts:523` | "renaming it is plan 0144's". `0144` did it |

Search for each name once more before you finish. If a name is also in a plan file, leave
the plan file alone.

## 6. Headers and documents

- **`0087`**: its header says "not built, pending re-evaluation". `0208` section 4.1 found
  that `0182` built what it asks. Compare `0087` with `0182` section by section. If
  nothing remains, replace the header with a status line that names `0182` and the PR that
  built it. If something remains, name it in the header and in the pull request.
- **Backlog `0010`**: `0048` says it is dropped. Change its status line to say so, with the
  date and `0048`.
- **`0207`**: the paragraph that says two decisions wait for the owner. He answered on
  2026-10-13 and the build took both answers. Add one line under it that says so.
- **`k8s/catalog-seed/README.md:7`**: "Every chain's `supermarket_sources` row is off".
  Since `0206` the owner turns a row on from the back office, and a schedule needs it left
  on. Say that the rows are off by default.

## 7. Tests

- **Integration, real Postgres:**
  - A generated basket that finishes. A list line changes after the finish, another is
    deleted, and the reader loses access to a third list. The full read and both rows
    reads answer what the basket asked when it finished, with the names redacted as before.
  - The same basket reopened reads the live lists again.
  - The history count of that basket equals the progress its screen shows, in products,
    with two lines of one product.
  - The edit of a line and a settle of the same line in two transactions: the settle is
    kept, and an edit with a stale `from` is refused.
- **Unit:** `from` absent, equal and stale. `canSettle` with `MANAGE` and no `WRITE`.
- **Contracts:** the AsyncAPI spec of section 3.3, and the schemas spec without
  `defaultTargetListId`.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass after regeneration.

## 8. Not in this plan

- **The client half of `from`** (section 2.2), a velista plan.
- **Dropping the old section tables of `0200`.** Release task `0004` empties them, and it
  runs with the release. A table can be dropped only after the task has run in both
  clusters.
- **A schema for each of the other events.** They have no payload type to write a schema
  from.
- **A frozen name, product or favourite on a finished basket** (section 1.1).
- **`velista-luna-e2e`.** It is red on `dev` until velista `0138` to `0143`, for reasons
  that are not in the backend.

## 9. Choices that are mine

The owner asked for the plan and did not choose these. Each is open to his correction.

1. A finished basket freezes its numbers and not its names (section 1.1).
2. Its history card counts products (section 1.2), which follows his choice in `0201`.
3. `from` is optional, and velista sends it in a later plan (section 2.2).
4. `canSettle` moves to `WRITE` and not `WRITABLE_LIST` to `MANAGE` (section 4), because
   `0130` decision 1 says `WRITE`.
5. Only the two basket events get a schema, and no document is written to a file
   (section 3.3).
