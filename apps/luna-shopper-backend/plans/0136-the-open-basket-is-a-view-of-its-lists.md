> **PR:** [#426](https://github.com/IchirokuXVI/nx-portfolio/pull/426)

# 0136: the open basket is a view of its lists

> The centre of the series in `0130`. A basket stops storing lines. `generated_list_lines`,
> `generated_list_line_origins` and `generated_list_line_options` are deleted, and with them
> waiting settlements, the split, the stored pick, the hand made order, the guest composer
> and every edit that lived in the basket alone. What is left is a header, a rule that says
> which lists the basket covers, and the people on it. Its rows are read from `list_lines`
> on every request, and everything that happens to a row is an event on a list line that
> names the basket it happened through.
>
> This is also where the basket that is always there is born: `GET /v1/baskets/live`
> answers a `LIVE` basket for the caller, creating it the first time.
>
> Prerequisite reading, in this order: `0130` in full (the model, the vocabulary and the
> decisions), then `0131` (the permission rules this plan asks), `0132` (soft deleted lines),
> `0133` (`kind`, the three statuses, `basket_sources`, `BasketCoverageService`), `0134`
> (`line_settlements.basketId`) and `0135` (`basket_trip_rows`). Then `0047` sections 3 and 4
> (a settlement is an append, and buying three of two records three), `0051` section 6.4
> (the owner delegated shopping, not permission), `0091` (an add lands on the line a list
> already holds), `0104` section 3.2 (a partly reverted settlement is split), `0113` (a
> basket rename renames the zone lines), and the memory notes on raw SQL in TypeORM, on Luna
> backend spec traps and on Nest `type` imports.
>
> Client half: velista `0090`. **`dev` is not releasable between this plan and velista
> `0096`** (`0130` section 12).

## Brief for the agent

### Objective

Replace the stored basket line with a read over `list_lines`: build the contracts, the read,
the five writes on a row, `GET /v1/baskets/live`, move the four reads that stood on origins
onto coverage, delete the three tables and everything that served them, and regenerate the
OpenAPI document and the wire types.

### Context

- `core/src/app/generated-lists/` holds 23 services and SQL files. Thirteen of them exist to
  keep a copy in step with its source. Section 10 lists each file and says whether it stays,
  moves or goes.
- After `0133` a basket has `kind` (`LIVE`, `GENERATED`), `status` (`OPEN`, `FINISHED`,
  `ARCHIVED`), `pricingProfileId`, and its sources in `basket_sources`. `BasketCoverageService`
  answers `listsOf(basket)` and `coveringBaskets(listId)`. No `LIVE` row exists yet.
- After `0134` a settlement carries `basketId`, dual written beside `generatedListLineId`.
  After `0135` a finished `GENERATED` basket has its `basket_trip_rows`, written from origins.
- After `0132` a deleted line is `deletedAt IS NOT NULL` and keeps its settlements.
- After `0131` a settle needs `WRITE` on both surfaces, a change of demand on an `APPROVED`
  line needs `DECIDE` or `MANAGE` on both, and both rules are methods of `ListAccessService`.
- The gateway serves the participant surface from
  `gateway/src/app/generated-lists/generated-list-sharing.controller.ts`
  (`GeneratedListParticipantController`, line 455) behind `ParticipantGuard`
  (`participant.guard.ts`), and composes the catalog half of the basket there (`GET
  :id/basket`, line 471), because every catalog route needs an account and a guest has none.
- `LineService.addQuantity` (`core/src/app/lists/line.service.ts:1985`) reads the line under
  a `pessimistic_write` lock. `LineService.update` with a quantity alone does **not**
  (`applyLineEdit`, line 1271, saves the row it read outside any lock), so a quantity edit
  that races a settle overwrites the decrement. Section 5.3 is built on the first for that
  reason.
- `LineService.add` announces `NO_LINE_CLAIM` (`line.service.ts:707` to `716`) on the
  reasoning that a line cannot be in a basket a moment after it was typed. Under coverage it
  can. Section 7.1.
- The admin back office reads basket lines and origins: `core/src/app/admin/admin-list.service.ts`
  lines 445 to 475, 535 to 560 and 631 to 638, and `AdminBasketLineView` in
  `libs/luna-shopper/contracts/src/lib/messages/admin-core.messages.ts:589`. The audit did
  not read that folder. Section 7.5.
- velista imports nothing from `@portfolio/luna-shopper/contracts` at compile time. The only
  matches under `libs/velista` are comments (`models/src/lib/enums.ts:13`,
  `models/src/lib/limits.ts:60`, `models/src/lib/attribution.ts:23`,
  `data-access/src/lib/realtime/basket-events.spec.ts:12`), and
  `data-access/src/lib/realtime/wire-contract.spec.ts` replays captured zone payloads and
  reads no backend file. Section 11.

### Target state

Every acceptance criterion in section 14 holds. No file, table, column, contract, route,
pattern or event named in section 10 exists. `npx nx run-many -t lint test build` over the
projects in section 15 is green, the integration specs of section 13 pass against a real
database on a slot, the seven services boot on that slot, and `openapi.json` and the wire
types are regenerated and committed.

### Scope

- Work only in:
  - a new folder `apps/luna-shopper-backend/core/src/app/baskets/`
  - `apps/luna-shopper-backend/core/src/app/generated-lists/` (deletions, and the edits
    sections 6 and 7 name)
  - `apps/luna-shopper-backend/core/src/app/entities/` and `db/migrations/`
  - `core/src/app/lists/line.service.ts` for the two edits in sections 5.3 and 7.1 only,
    `lists/line-merge.service.ts` for section 7.6, `lists/trips/trips.sql.ts` and
    `trips.announce.ts`, `lists/suggestions/suggestions.sql.ts`
  - `core/src/app/admin/admin-list.service.ts`, `core/src/app/realtime/realtime-access.controller.ts`
  - a new folder `apps/luna-shopper-backend/gateway/src/app/baskets/`, and
    `gateway/src/app/generated-lists/` for the routes that are deleted
  - `libs/luna-shopper/contracts` (new `basket.messages.ts`, `basket.enums.ts`,
    `basket.schemas.ts`, the event, deletions in the two `generated-list*` files and in
    `admin-core.messages.ts`)
  - `libs/luna-shopper/platform` for the one exception that goes
  - the realtime consumer only where a deleted or new subject is named
  - `libs/luna-shopper-admin/feature-people/src/lib/baskets.ts` and the generated files
- Do NOT touch: anything under `libs/velista` or `apps/velista` (section 11 proves nothing
  there breaks at compile time), `apps/velista-luna-e2e` (velista `0096`), the share link and
  participant model (`0140`), presence, the change log (`0138`), the fan out to other baskets
  (`0139`), the price columns (`0143`), the rename of the surviving tables (`0144`),
  `ListAccessService` rules (`0131` owns them).

### Constraints

- An open basket stores nothing about its rows. A column that caches `asked`, `bought`,
  `left`, a position, a pick or a state is a defect, however convenient.
- Coverage is recomputed on every request and never stored. Every access read runs before a
  transaction opens (`0130` section 13).
- Every write on a row carries `from` and is refused with `stale_quantity` when it does not
  match what the lock reads.
- New code says `basket`. Code that survives keeps `GeneratedList` until `0144`.
- A constructor dependency is never a `type` import. Boot the services before the pull
  request.
- Only make changes this plan names. No new abstraction "for later".

### Action boundaries

- Proceed with in scope edits, deletions, the migration, specs and the generators.
- Stop and ask if `0131` to `0135` are not all merged, naming what each one is missing.
- Stop and ask if the migration's two assertions (section 9, steps 1 and 2) fail on a slot
  database, because that means `0134` or `0135` left rows behind and the drop loses them.
- Stop and ask before touching any velista file. Section 11 says none is needed, so needing
  one means a fact changed.
- Stop and ask before deleting a file section 10 does not list.

### Progress evidence

Report at each stage of the session strategy with the command that proved it: the contracts
build, the read's integration spec, each write's spec, the gateway spec, the moved reads'
integration specs, the migration run up and down on a slot, the boot, the generators.

### Session strategy

One pull request, staged so that every commit builds:

1. **Contracts.** New files, nothing deleted yet.
2. **The read.** `baskets/` pure functions first (`basket-rows.ts`), then
   `BasketReadService`, `BasketLiveService`, the redaction. Old routes still work.
3. **The writes**, one service at a time, each with its spec.
4. **The gateway** `baskets/` controller and DTOs.
5. **The reads that move** (section 7), each behind its integration spec.
6. **The switch.** The finish writes trip rows from the view, the run stops composing lines,
   the old services, routes, patterns, events, contracts and specs are deleted, and the
   migration lands. This commit is the large one and cannot be cut: a state in which reads
   are derived and writes are not is the defect this plan exists to remove.
7. **Regenerate** `openapi.json`, then the wire types, then the admin screen.

Stages 3 and 5 are independent of each other once stage 2 is merged into the branch, and
either can go to a subagent with a bounded brief: "build section 5.N with its spec, touch
only the files it names". Stage 6 belongs to one owner.

## 1. What is being built

| Piece                                                          | Where                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `BasketView` and its row, entry and list ref shapes, the requests | `contracts` `basket.messages.ts`, `basket.enums.ts`, schemas |
| `BasketReadService`, the pure row functions, the redaction     | `core/src/app/baskets/`                                    |
| `BasketLiveService` and `GET /v1/baskets/live`                 | core `baskets/`, gateway `baskets/`                        |
| settle, revert, demand, add, rename on a row                   | core `baskets/`, gateway `baskets/`                        |
| `basket.linesChanged`                                          | `realtime.events.ts`, the five writes                      |
| the finish writing trip rows from the view                     | `generated-list.service.ts`, `0135`'s writer               |
| claims, trips, suggestions, history counts and the admin read on coverage | section 7                                       |
| the deletion of three tables and everything that served them   | section 10, the migration in section 9                     |

## 2. The contracts

`libs/luna-shopper/contracts/src/lib/enums/basket.enums.ts`. `BasketKind` is `0133`'s and
moves here if `0133` put it elsewhere.

```ts
export enum BasketRowState {
  WANTED = 'WANTED',
  PARTLY = 'PARTLY',
  DONE = 'DONE',
  NOT_AVAILABLE = 'NOT_AVAILABLE',
  SKIPPED = 'SKIPPED', // never produced before plan 0137
  REMOVED = 'REMOVED', // never produced before plan 0138
}

export enum BasketRowNote {
  SKIPPED_EARLIER = 'SKIPPED_EARLIER', // never produced before plan 0137
}

export enum BasketRowMark {
  ADDED = 'ADDED',
  CHANGED = 'CHANGED',
  REMOVED = 'REMOVED',
} // `mark` is null on every row before plan 0138
```

The three unions are declared whole now so that `0137` and `0138` change values and never
the wire shape. Until they land, `state` is one of the first four values, `note` is null and
`mark` is null, on every row.

`libs/luna-shopper/contracts/src/lib/messages/basket.messages.ts`:

```ts
export const BASKET_LIMITS = {
  /** Rows one read answers. Past it the read says `truncated` (section 3.6). */
  maxRows: 1000,
} as const;

export interface BasketListRef {
  listId: string;
  name: string;
  zoneId: string;
  zoneName: string;
}

export interface BasketRowEntryView {
  lineId: string;
  /** Present only when the reader was served this list's ref (0130, section 6). */
  listId?: string;
  left: number;
  bought: number;
  /** This entry's own state, by the table of 0130 section 4. Never `REMOVED`. */
  state: BasketRowState;
  approvalStatus: LineApprovalStatus; // APPROVED or PENDING, never REJECTED
  /**
   * Whether a change of demand on this entry is allowed, by the rule of `0131` asked of the
   * basket's OWNER. Served because no client can compute it: a reader never learns the
   * owner's permissions, and a guest has none of their own to ask about.
   */
  demandEditable: boolean;
}

export interface BasketRowView {
  /** The anchor's list line id. Any entry's id addresses the row on a write. */
  rowKey: string;
  content: string; // the anchor's text
  left: number;
  bought: number;
  asked: number; // bought + left, computed, never stored
  state: BasketRowState;
  note: BasketRowNote | null;
  /** When the fact behind `note` happened, on the server clock. Null exactly when `note` is. */
  noteAt: string | null;
  mark: BasketRowMark | null;
  /** At least one entry is PENDING. Named apart from the `pending` count below. */
  awaitingApproval: boolean;
  /** The union of the entries' product sets, first seen order, anchor first. */
  optionIds: string[];
  touchedBy: string | null; // participant id of the newest standing act of this basket
  touchedAt: string | null;
  entries: BasketRowEntryView[]; // oldest first, the anchor at index 0
}

export interface BasketProgress {
  done: number;
  unavailable: number;
  total: number; // rows that are not REMOVED
  pending: number; // total - done - unavailable
}

export interface BasketView {
  id: string;
  kind: BasketKind;
  name: string | null; // always null for LIVE
  status: GeneratedListStatus; // OPEN, FINISHED, ARCHIVED after 0133
  createdAt: string; // `generatedAt` until 0144
  rows: BasketRowView[];
  lists: BasketListRef[];
  participants: GeneratedListParticipantView[];
  me: GeneratedListParticipantView;
  progress: BasketProgress;
  truncated: boolean;
}
```

The gateway answers `BasketResult`, which is `BasketView` plus the catalog half today's
`GET :id/basket` composes (`products`, `scopes`, and the supermarkets and locations beside
them). That half moves unchanged, keyed on the union of every row's `optionIds`, read with
the owner's scopes. A `GENERATED` basket prices against its stored `pricingProfileId`. A
`LIVE` basket stores null there and the read resolves the owner's default profile through
`ProfileService.pricingProfileId(ownerUserId, undefined)` on every request, because a basket
that never ends cannot freeze a profile its owner goes on editing.

**Who is served shop locations.** Today the gateway withholds `locations` unless
`seesZoneData` (`generated-list-sharing.controller.ts`, the block that answers `[]`), and
this plan deletes that flag. The shops are the owner's profile and not a fact about any
list, so the per list rule of `0130` section 6 cannot answer it. The rule becomes: the
**owner and every named person** (`invitedAt` set) are served `locations`, and a link
visitor, guest or registered, is served chains and scopes and never an address. Core answers
it as `servesLocations: boolean` beside the participant context, and `0143` reads the same
flag.

**The summary of the `LIVE` basket.** `GET /v1/baskets/live/summary`, account only, answers
`BasketSummaryView { id, kind, progress }` from the same read with the rows dropped, and
creates the basket exactly as `GET /v1/baskets/live` does. The home card needs three
numbers and must not pay for a thousand rows and a catalog composition to get them.

```ts
export interface BasketSummaryView {
  id: string;
  kind: BasketKind;
  progress: BasketProgress;
}
```

Requests, all carrying `basketId` and `participantId` (the guard's, never the client's):

```ts
export interface SettleBasketRowRequest {
  rowKey: string;
  outcome: SettlementOutcome;
  quantity?: number; // required for BOUGHT, refused for NOT_AVAILABLE
  from: number; // the row's `left` as the client drew it
  itemId?: string; // must be one of the row's optionIds
  allocations?: { lineId: string; quantity: number }[];
}

export type RevertBasketRowRequest =
  | { rowKey: string; target: 'UNITS'; units: number; from: number } // from = row `bought`
  | { rowKey: string; target: 'CLOSE' }; // takes the standing NOT_AVAILABLE back

export interface SetBasketRowDemandRequest {
  rowKey: string;
  lineId?: string; // required when the row holds more than one entry
  quantity: number; // what that list asks for from now on
  from: number; // that entry's `left` as the client drew it
}

export interface AddBasketLineRequest {
  targetListId: string; // REQUIRED. There is no line without a list
  content: string;
  quantity?: number;
  itemIds?: string[];
}

export interface RenameBasketRowRequest {
  rowKey: string;
  content: string;
  confirmMerge?: boolean;
}
```

Every write answers one shape:

```ts
export interface BasketRowResult {
  /** The row as it now stands, under whatever `rowKey` it now has. */
  row: BasketRowView;
  progress: BasketProgress;
  /** Set by a revert: entries whose line was deleted since, so no units went back. */
  skippedCount?: number;
  /** Set by a rename that folded this row into another: the key the request used. */
  replacedRowKey?: string;
}
```

`row` is never null. A settle that takes `left` to zero leaves the row in the view as
`DONE`, because the purchase it just wrote is in scope (section 3.1, step 3). A rename that
merges answers the surviving row and names the key that stopped existing, so the client
drops one row and redraws the other without reading the basket again.

`BASKET_PATTERNS` beside them: `basket.live`, `basket.get`, `basket.row.settle`,
`basket.row.revert`, `basket.row.demand`, `basket.row.rename`, `basket.line.add`,
`basket.searchScope`. JSON schemas for every shape go in
`libs/luna-shopper/contracts/src/schemas/messages/basket.schemas.ts` with
`additionalProperties: false`, which is what keeps a field that reaches the wire without a
schema from happening again: `waitingSettled` did exactly that
(`generated-list-sharing.schemas.ts:327` to `367` never listed it).

## 3. The read

`core/src/app/baskets/basket-read.service.ts`, with every rule that needs no database in
`basket-rows.ts` as free functions, which is what lets a spec state the rule instead of
mocking its way to it (the reasoning `allocateOldestFirst` already gives).

### 3.1 The steps

1. **Coverage.** `BasketCoverageService.listsOf(basket)`, before any transaction. An empty
   coverage answers a basket with no rows, never an error: a person in no zone has a `LIVE`
   basket with nothing in it.
2. **The scope of "bought".** For a `GENERATED` basket, every standing settlement with this
   `basketId`. For a `LIVE` basket, the **current session**: the newest run of this basket's
   standing settlements in which no two neighbours are more than `PURCHASE_SESSION_GAP_MS`
   apart, and only when the newest of them is within that gap of `now()`. Otherwise there is
   no current session and `bought` is zero everywhere. One gaps and islands query,
   `BASKET_SESSION_SQL` in `baskets/basket.sql.ts`, over `basketId = $1 AND "revertedAt" IS
   NULL AND "settledAt" >= now() - $2`, where `$2` is `BASKET_SESSION_LOOKBACK_MS`, seven
   days, a constant beside the SQL. A session longer than seven days is cut at that edge,
   which is accepted and said in the constant's comment. `now()` is the database's clock, so
   no application server and no device decides where a session ends.
3. **Covered lines.** `COVERED_LINES_SQL`: lines of the covered lists where `"deletedAt" IS
   NULL`, `"approvalStatus" IN ('APPROVED', 'PENDING')`, and `quantity > 0` **or** the line
   has a settlement in the scope of step 2. That second half is what keeps a row on the
   screen after it is bought, so that the revert has something to be pressed on. Ordered by
   `("createdAt", id)`, which is what makes the first entry of a group its anchor. `LIMIT`
   is not applied here, because the cap is on rows and a row is several lines.
4. **Product sets**, one query for every covered line (`CANDIDATE_LINE_ITEMS_SQL` survives
   for this and moves to `basket.sql.ts`).
5. **Group** by `mergeKey` (`generated-lists/line-dedup.ts`, unchanged, moved to
   `baskets/`). The anchor is the group's first line. `content` is the anchor's.
6. **Per entry numbers**: `left` is the line's `quantity`, `bought` is the sum of `quantity`
   over the scoped settlements of that line whose outcome is `BOUGHT`.
7. **State**, in `0130` section 4's order, with the two states this plan cannot produce
   skipped. `NOT_AVAILABLE` holds when the newest scoped settlement over the row's entries,
   by `("settledAt", id)`, says so and `left > 0`. `0137` narrows that for a `LIVE` basket
   by its window, and until then the session is the window.
8. **`touchedBy` and `touchedAt`**: the participant and time of that same newest scoped
   settlement, or null.
9. **Order.** Section 3.5.
10. **The cap.** Section 3.6.
11. **Progress**, by `0130` section 4.
12. **Redaction.** Section 3.4.

### 3.2 What it costs

Four queries for the rows (session, lines, product sets, settlements in scope) and the
participant read. None of them is per line. The settlements read rides
`ix_settlements_basket_line` from `0134`.

### 3.3 Why nothing is cached

A materialized row is the copy this series removes. The read is bounded by a household's
lists, which level off (`0122` section 2: "A list grows by what a household buys, not by how
long it shops"), and every number in it changes on every purchase anybody makes, so a cache
is invalidated as often as it is read.

### 3.4 Redaction, per list

`seesZoneData` is deleted: the method on `GeneratedListSharingService` (line 738), the field
on `GeneratedListParticipantContext`, the gateway's gate on it
(`generated-list-sharing.controller.ts:1103`, `1250`, `1378`), and the contract comments
that describe it. What replaces each use:

| Today                                                          | From now on                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `seesZoneData(participant)`: `WRITE` on every source list       | `BasketRedaction.servedLists(participant, coverage)`: the covered lists the **reader** holds `WRITE` on. The owner gets all of them. A guest gets none. One call to `writableAmong(reader.userId, coverage)`, before any transaction. |
| `sourceNames(list)` on the basket view                          | `lists: BasketListRef[]` for the served lists, through `namesOfLists` (`generated-lists/list-names.ts`, which stays). |
| `origins`, `targetListId`, `origin` withheld from a line        | `entries[].listId` present only for a served list. The entry itself is always served.                   |
| `writableIntersection(owner, actor)` behind both pickers         | the served lists **are** the intersection: covered means the owner writes it, served means the reader does. The add's list picker reads `lists`. The method is deleted. |
| the settle answer's named skips (`ACCESS_GONE`, `ORIGIN_DELETED`) | gone. Coverage is recomputed per request, so a list the owner lost is not in the row, and a deleted line is not covered. |
| a broadcast projected with `seesZoneData = false`               | a broadcast carries line ids and nothing else (section 8).                                              |

A guest therefore sees the entries of a row, how much each asks for, and that there are two
of them. That a row comes from two households is already visible today as a quantity that
two settles reach, and it names nobody.

### 3.5 Order

A view has no `position`. `GeneratedListOrderService` stays and is asked on **every read**
instead of once at creation, which reverses plan `0110` section 2 ("Computed once, when the
basket is created, and never recomputed") by necessity. The reason that rule gave still
holds and is kept another way: the order learns from **finished** trips only, never from the
basket being shopped, so it cannot move under a thumb while somebody shops. A new row takes
the slot its history gives it, or the alphabetical tail, and rows below it shift by one,
once, which `0138` marks as an addition.

`ORDER_HISTORY_SQL` loses its join to `generated_list_lines`. A visit becomes a standing
settlement of a finished `GENERATED` basket joined to `list_lines` for the text and to
`list_line_items` for the products, with `min("settledAt")` per line as before. `0141` then
changes **what** it learns from (sessions). This plan changes only **where** it reads.

### 3.6 No paging, and a cap

A row spans lists, so paging by list cuts a row in two and paging by row needs the whole
grouping computed to find the page boundary, which is the entire cost of the read. So the
read is whole. `BASKET_LIMITS.maxRows` is the guard against a pathological account: past it
the rows are cut in walk order, `truncated` is true, and core logs a warning with the basket
id and the count. `GENERATED_LIST_LIMITS.maxLines` and its check in `create` are deleted,
because a run composes nothing any more and cannot refuse lines that arrive later.

## 4. The basket that is always there

`core/src/app/baskets/basket-live.service.ts`, `BASKET_PATTERNS.live`, `GET /v1/baskets/live`
behind `JwtAuthGuard`.

- Find the caller's row with `kind = 'LIVE'`. When there is none, insert one (`status =
  'OPEN'`, `name` null, `generatedAt = now()`, `pricingProfileId` null, no `idempotencyKey`,
  no sources) and the owner's participant through `ensureOwnerParticipant`, in one
  transaction. A unique violation on `0133`'s partial index means another tab won the race:
  read the winner and answer it. The route is idempotent the way `create` is.
- The answer is `BasketResult`, the same shape `GET /v1/baskets/:id` gives, so the client has
  one basket screen.
- `GeneratedListService.update` refuses `status` and `name` on a `LIVE` basket with
  `ValidationException` (`messageArgs.field` naming which), and `delete` refuses it too. The
  account deletion path (`deleteForUser`) still removes it.
- `listMine`, `listShared`'s owner side, the sweep, the claim, the trips and the order
  already exclude `kind = 'LIVE'` since `0133`. This plan adds the integration spec that
  proves each of them against a real `LIVE` row, because `0133` had only a fixture row to
  prove them against.
- A `LIVE` basket emits no `generatedList.created` and no `list.tripsChanged` when it is
  born. It is not news.

## 5. The writes on a row

All five live in `core/src/app/baskets/`, are reached through `ParticipantGuard`, carry
`ParticipantThrottle`, refuse a basket that is not `OPEN` with
`GeneratedListFinishedException`, and resolve the participant with `livePresenceEntry`.

**Resolving a row.** `BasketRowResolver.resolve(basket, coverage, rowKey)`:

1. Load the line `rowKey` names. Not found, soft deleted, `REJECTED`, or in a list outside
   the coverage: `NotFoundException('Row not found')`. The client reads the basket again.
2. Load the covered lines that share its merge key: by `"itemSetHash"` in SQL for a `set:`
   key, and the covered lines with a null hash filtered by `normalizeContent` in TypeScript
   for a `text:` key, because that fold lives in TypeScript and a second definition in SQL is
   free to drift (the reasoning `ORDER_HISTORY_SQL`'s comment gives).
3. `rowKey` is accepted when it names **any** entry. The read always serves the anchor, and
   an anchor that was bought to zero and left the view a moment ago must not turn the next
   tap on the same row into an error.

A spec proves the resolver and the read agree on the entries of every row of one fixture.

**The lock.** Inside the transaction the entries are locked `pessimistic_write` in
**ascending id order**, one order for every caller, so two settles on two rows that share a
line wait for each other instead of deadlocking (`lockListsForRename` does the same for
lists). `from` is compared with what the locked rows say.

### 5.1 Settle

`BasketSettleService.settle`, `POST /v1/baskets/:id/rows/:rowKey/settle`,
`SettleBasketRowDto`.

- `BOUGHT` needs a positive whole `quantity` no greater than `LINE_QUANTITY_MAX`. It is
  **not** capped at `left`: plan `0047` section 4.2 stands ("buying three of a line that says
  two records three"), and the double tap that today's cap existed for is caught by `from`,
  since the second tap still says the `left` the first one changed.
- `NOT_AVAILABLE` takes no quantity and is refused with `ConflictException` when `left` is
  zero.
- `itemId`, when given, must be in the union of the entries' product sets, which keeps a swap
  "a gesture at the shelf rather than a way to write an arbitrary catalog id into a
  household's purchase history" (the comment on today's `resolvePick`). Absent, a row with
  exactly one option records that one and any other row records null.
- Allocation is `allocateOldestFirst` over the entries, moved to `basket-rows.ts` unchanged,
  with the entry's `left` where it read an origin's `quantity`. `allocations` by hand is
  accepted only when every `lineId` it names belongs to a list served to the actor, must not
  add up to more than `quantity`, and is refused whole otherwise with the three validation
  messages `allocateByHand` has today.
- Per entry, as today: decrement floored at zero, `version + 1`, one `line_settlements` row
  with `basketId`, `settledByParticipantId`, `settledByUserId` null
  (`ck_line_settlements_actor`), `lineId` and `listId` always set. `NOT_AVAILABLE` writes one
  row per entry with `quantity` zero. `BOUGHT` with a zero allocation writes nothing.
- After the commit: `line.settled` per entry to the zone and list rooms with the payload it
  has today, the claim recomputed inside the transaction, then section 8's basket event,
  then `announceReleased` for entries that reached zero or were closed.

There is no branch for "no eligible origin" and no waiting row, because a row is made of
list lines and nothing else.

### 5.2 Revert

`BasketRevertService.revert`, `POST /v1/baskets/:id/rows/:rowKey/revert`. It replaces the
reopen, the raise half of `setOutstanding` and the lowering of `setOriginSettled`.

- `target: 'UNITS'`: walk the standing `BOUGHT` settlements with this `basketId` and `lineId`
  among the entries, inside the scope of section 3.1 step 2, newest first, until `units` are
  taken. A row taken in part is split exactly as plan `0104` section 3.2 says: the row is
  marked reverted and a standing row carrying the remainder is inserted with every column
  copied, `basketId` included. `0143` adds two columns to that copy and says so.
- `target: 'CLOSE'`: mark every standing `NOT_AVAILABLE` row of the newest close act (the
  rows sharing its `settledAt`) reverted. A close holds no units, so the arithmetic plan
  `0104` section 3.3 needed ("the walk takes the whole close back", charged against
  `settledQuantity`) does not exist any more.
- Each touched line gets its units back by addition, never by restoring a remembered
  number, for the reason the reopen gives today. A line that was soft deleted since is
  skipped and counted in `skippedCount` on the answer.
- **The owner's `WRITE` holds by construction**: the entries come from a coverage computed
  for this request. That closes the defect the audit found in
  `generated-list-reopen.service.ts:373` to `399`, which `0131` patched with a check and
  which this plan removes the need for.
- `revertedByParticipantId` is the actor, and `ck_line_settlements_revert` is unchanged.

### 5.3 Demand

`BasketDemandService.setDemand`, `POST /v1/baskets/:id/rows/:rowKey/demand`.

- `lineId` is required when the row has more than one entry, and that entry's list must be
  one of the lists served to the actor. A reader with no list refs, a guest for one, can
  change demand on single entry rows only (`0130` section 5).
- The permission is `0131`'s demand rule asked of the **owner**, never of the actor.
- The write goes through `LineService.addQuantity`, called as the owner with `delta =
  quantity - from`, and **`AddLineQuantityRequest` gains `expect?: number`**, compared with
  the locked row's quantity and refused with `StaleQuantityException` carrying
  `messageArgs.current`. `addQuantity` and not `update`, because `update` with a quantity
  alone reads outside any lock (Context). Through `LineService` and not a save of its own,
  so that the approval rule, the audit and `line.updated` are the list's own, which is the
  argument `promote` makes today about `LineService.add`.
- A `delta` of zero writes nothing and answers the row.
- This replaces `setOriginQuantity`, `setOutstanding`'s demand side and
  `BelowSettledException`, whose floor ("fewer than this basket has already bought for this
  list") cannot be stated when `asked` is `bought + left`.

### 5.4 Add

`BasketLineAddService.add`, `POST /v1/baskets/:id/lines`, `AddBasketLineDto` with a required
`targetListId`. Account participants only: a guest is refused with `ForbiddenException`
before anything is read, and the gateway route sits behind a guard that refuses the secret
header.

- The actor holds `WRITE` on `targetListId` themselves, **and** the list is in the basket's
  coverage. Either missing is a `ForbiddenException` that does not say which, so the route
  cannot be used to probe which lists an owner covers.
- The write is `LineService.add({ userId: actor.userId, listId, content, quantity, itemIds
  })`, so plan `0091`'s merge onto a line the list already holds and plan `0037`'s approval
  both apply, and the zone hears the ordinary `line.added` or `line.updated`.
- A result that is `PENDING` is a covered line (`0130` section 3), so the row appears with
  `awaitingApproval: true` and can be bought. Plan `0092` section 4.2 is the precedent: a
  created line "starts under the list's own approval rule" and was still settled.
- `GET /v1/baskets/:id/catalog/suggest` moves with it (`basket.searchScope`), for account
  participants, pricing against the scopes section 2 names.

This reverses plan `0055` section 3 ("A guest in an aisle who remembers the milk is exactly
the reader the shared basket exists for"), whose safety argument was that an added line
"lives in the basket and nowhere else". No such place exists now.

### 5.5 Rename

`BasketRowRenameService.rename`, `PATCH /v1/baskets/:id/rows/:rowKey`. Account participants
with `WRITE` on every entry's list, which is plan `0113`'s rule with "every origin" read as
"every entry". It keeps plan `0113`'s machinery and loses the basket half of it:

- `lockListsForRename`, then `planListRename` per list with that list's entries, every
  refusal first, one confirmation (`LineMergeRequiredException`) covering every list, then
  `writeListRename` and `announceListRename`.
- `basketCollision`, `mergeBasketLines` and the owner's rename of an origin less line are
  deleted with the rows they operated on. Two rows that end up sharing a name are one row on
  the next read, by the merge key, with nothing to fold.

### 5.6 What is not a write any more

| Gone                                | Because                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| remove a line from a basket         | `0130` section 5. Deleting is the list page, `MANAGE` on an approved line. "Not today" is `0137`.    |
| reorder                             | the order is computed.                                                                               |
| split, fold, reassign siblings      | `0130` section 11, decision 4. A settlement already names the product that was bought.               |
| switch the pick before buying       | the pick is sent with the settle. A client can hold one locally.                                     |
| send to lists, adopt, promote       | a row is already on its lists.                                                                       |
| set what one list got               | a revert of units, or a settle with `allocations`.                                                   |

## 6. Finishing and reopening

`GeneratedListService.update`, `GENERATED` baskets only.

- `OPEN` to `FINISHED`: inside one transaction with the status write, `0135`'s
  `BasketTripRowService.freeze(manager, basket)` is handed the rows of a read made at that
  moment, and writes one `basket_trip_rows` row per zone line with `asked = bought + left`
  for every entry where either is above zero. `0135` built that writer to read origins, and
  this plan changes its source to the view. The sweep finishes through this method, so it
  freezes too.
- `FINISHED` or `ARCHIVED` back to `OPEN`: the trip rows are deleted in the same
  transaction.
- The claims are released and taken again as today, from section 7.1's read.
- `basket.updated` reaching the basket room is `0139`'s. This plan keeps
  `generatedList.updated` to the owner as it is.

## 7. The reads that stood on origins

### 7.1 The claim

`LINE_CLAIMS_SQL` (`generated-lists/line-claim.sql.ts`) is rewritten onto coverage:

```sql
SELECT DISTINCT ON (ll.id)
       ll.id AS "lineId",
       gl."ownerUserId" AS "ownerUserId"
FROM "list_lines" ll
JOIN "shopping_lists" sl ON sl.id = ll."listId"
JOIN "basket_sources" bs
  ON bs."zoneId" = sl."zoneId" AND (bs."listId" IS NULL OR bs."listId" = sl.id)
JOIN "generated_lists" gl ON gl.id = bs."basketId"
JOIN "zone_memberships" m
  ON m."zoneId" = sl."zoneId" AND m."userId" = gl."ownerUserId"
WHERE ll.id = ANY($1::uuid[])
  AND ll."deletedAt" IS NULL
  AND ll.quantity > 0
  AND ll."approvalStatus" IN ('APPROVED', 'PENDING')
  AND gl.kind = 'GENERATED'
  AND gl.status = 'OPEN'
  AND gl."generatedAt" >= $2::timestamptz
  AND ${WRITABLE_LIST}
  AND NOT EXISTS (/* the basket's newest standing settlement on ll.id is NOT_AVAILABLE */)
ORDER BY ll.id, gl."generatedAt" DESC, gl.id DESC
```

- `WRITABLE_LIST` is the predicate `generated-list.sql.ts` already exports, so the claim and
  the coverage cannot disagree about which lists a basket reads.
- **`ownerInZone` is gone**, and with it plan `0052` section 6's "claimed without a name".
  Coverage needs an approved membership, so an owner who left the zone covers none of its
  lists and claims none of its lines. That is a change of behaviour and the better one: a
  basket that cannot write a line is not out buying it.
- `0137` adds "and no standing skip" to the `NOT EXISTS`.
- `BASKET_CLAIMED_LINES_SQL` and `BASKET_LINE_CLAIMED_LINES_SQL` become one read, "the
  covered lines of this basket with quantity above zero", used by create, finish, reopen and
  delete to say which lines to announce.
- **A line is born claimed.** `LineService.add` stops announcing `NO_LINE_CLAIM`
  (`line.service.ts:707` to `716`) and reads `claims.claimOf(line.id, manager)` like every
  other write in that file. Its comment ("nor be in somebody's basket a moment after it was
  typed") is no longer true and is rewritten.

### 7.2 Trips

`lists/trips/trips.sql.ts`. After `0135` a finished basket's `asked` comes from
`basket_trip_rows`. For an **open** `GENERATED` basket the `asked` half of `basketRowsCte`
read origins until now, and becomes: the covered lines of this list for that basket, with
`asked = bought + left`. A basket whose coverage includes the list and that has no covered
line in it with either number above zero is not a trip of the list, which is `0122` section
3's "a trip left with no line is not returned", unchanged.

`tripListsOfBasket` and `tripListsOfOwner` (`trips.announce.ts`) read `basket_sources`
narrowed by coverage instead of `BASKET_ORIGIN_LISTS_SQL` and `OWNER_ORIGIN_LISTS_SQL`, which
are deleted. `announceTripsChanged` is called by create, update and delete as today. The
calls that followed an origin gained or lost go with those services.

### 7.3 Suggestions

`lists/suggestions/suggestions.sql.ts` lines 48 to 50, 100 to 103 and 147 to 149 join
origins to ask "does a live basket hold this line". The test becomes section 7.1's: an open
`GENERATED` basket inside the claim window covers the line's list. Put it in one SQL
fragment, `OPEN_BASKET_COVERS_LINE`, exported from `baskets/basket.sql.ts` and used by both,
so the claim and the suggestion cannot disagree. What a staple counts is `0142`'s.

### 7.4 History counts

`GENERATED_LIST_COUNTS_SQL` counted basket lines. It becomes two reads behind `countsFor`:
a finished basket counts its `basket_trip_rows` against its standing settlements, in SQL,
for a whole page. An open basket's four numbers come from `BasketReadService.progressOf
(basket)`, the read of section 3 without the redaction and the catalog half. A page holds at
most a few open baskets, because the sweep finishes them, so one read each is acceptable and
is said in the method's comment.

### 7.5 The admin read

`admin-list.service.ts` filters baskets by zone through origins (lines 459 to 466), collects
a basket's zones from origins (`zonesForBaskets`, line 541) and serves `AdminBasketLineView`
from `generated_list_lines` (line 631). From now on: the zone filter and `zoneIds` read
`basket_sources`, `lineCount` is `countsFor`'s, and the detail's `lines` become
`AdminBasketRowView { rowKey, content, left, bought, asked }` from `progressOf`'s read for an
open basket and from trip rows for a finished one. `AdminBasketLineView` is deleted from
`admin-core.messages.ts`, the wire types are regenerated, and
`libs/luna-shopper-admin/feature-people/src/lib/baskets.ts` follows the new columns. A
`LIVE` basket is listed with `kind` shown, because an operator looking for "what is this
person shopping" needs it more than any other.

### 7.6 A line merge

`LineMergeService` moved origin rows to the survivor (`line-merge.service.ts:244` to `282`).
That block is deleted. `0135` already moves `basket_trip_rows` there, and settlements move as
they always did, so a merged row is one row on the next read with both lines' purchases.

## 8. Events

One new event, `basket.linesChanged`:

```ts
export interface BasketLinesChangedEvent {
  /** The list lines that moved. Ids only: the least privileged view of 0130, section 6. */
  lineIds: string[];
}
```

- Emitted by each of the five writes, after the commit, with `events.emitTo` addressed to
  the **acting** basket's room and to its owner's `user:` room. A client that receives it
  reads the basket again, debounced, as velista `0086` section 2 already does for
  participants.
- It carries no `basketId` in the payload, because one envelope will soon address several
  rooms: **`0139` widens the audience to every basket that covers the line** and adds
  `basketIds` to the envelope. This plan emits it to one room so that four people in one
  shop stay in step between the two plans.
- Add it to `RealtimeEvent` and to `DOMAIN_EVENT_SUBJECTS`.

Deleted from `realtime.events.ts`, from `DOMAIN_EVENT_SUBJECTS` and from every emit site:
`generatedList.lineUpdated` (line 183), `generatedList.lineAdded` (196),
`generatedList.lineRemoved` (206), `generatedList.lineSettled` (226), and their payload
types `GeneratedListLineMovedEvent`, `GeneratedListLineAddedEvent` and the removed event's.
`generatedList.created`, `updated`, `deleted`, `participantJoined`, `participantLeft`,
`shared` and `unshared` stay, and `created` and `updated` carry the header alone from now
on (`GeneratedListView` loses `lines` and `sourceSnapshot`, and gains `kind`).

The zone side is unchanged: `line.settled`, `line.updated`, `line.added`, `line.deleted`,
`line.claimChanged`, `list.tripsChanged`.

## 9. The migration

`BasketsBecomeViews<timestamp>`, the next free timestamp above the newest entry of
`db/migrations/index.ts`, registered there with a comment naming what it follows. One
transaction (`0130` section 13).

**Up**, in this order:

1. **Assert `0134`.** Count the settlements whose `generatedListLineId` names an existing
   basket line and whose `basketId` is null. Above zero: `RAISE EXCEPTION` naming the count.
   Dropping the column with that join still pending loses which basket bought what.
2. **Assert `0135`.** Count the `GENERATED` baskets that are not `OPEN`, have origin rows and
   have no `basket_trip_rows`. Above zero: `RAISE EXCEPTION`.
3. **Count, log and delete the waiting rows**: `DELETE FROM "line_settlements" WHERE
   "lineId" IS NULL`, with `RAISE NOTICE 'deleted % waiting settlements'`. Not recoverable,
   and `0093`'s own `down` already deleted exactly these rows for the same reason: "inventing
   a list for them ... would put somebody else's purchase in a household's history".
4. **Count and log what the drop loses**, as notices, so the deploy log is the record: basket
   lines on `OPEN` baskets with no origin row (typed text that reached no list), and basket
   lines whose `quantity` exceeds the sum of their origins (plan `0056`'s extra units).
5. `DROP INDEX "ix_settlements_waiting"`, `DROP INDEX "ix_settlements_basket_line_live"`
   (`0134`'s `ix_settlements_basket_line` replaces it), drop `ck_line_settlements_waiting_basket`
   and `ck_line_settlements_home`, `ALTER COLUMN "lineId" SET NOT NULL`, `ALTER COLUMN
   "listId" SET NOT NULL`, `DROP COLUMN "generatedListLineId"`, and restore the two column
   comments plan `0093` rewrote.
6. `DROP TABLE "generated_list_line_options"`, then `"generated_list_line_origins"`, then
   `"generated_list_lines"`, then `DROP TYPE "generated_line_origin"`.
7. `ALTER TABLE "generated_lists" DROP COLUMN "defaultTargetListId"`, if `0133` left it
   (it is read by `addLine` until this plan, so it cannot go earlier).

**Down** recreates the three tables, the type, the column, the two constraints and the two
indexes **empty**, relaxes `lineId` and `listId` to nullable again, and restores nothing
else. It says so in its comment: basket lines, origins, options, picks, positions and
waiting rows are not recoverable, open baskets come back with no lines, and finished baskets
keep their `basket_trip_rows`, which the older code does not read. A `down` that cannot make
the older code useful is still written, because `migrations.spec.ts` runs every migration
both ways.

## 10. What is deleted, file by file

`core/src/app/generated-lists/`:

| File                                         | Fate                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `generated-list-line.service.ts`             | deleted (add, update, delete, reorder, promote)                                               |
| `generated-list-line-rename.service.ts`      | deleted, its list half rebuilt as `baskets/basket-row-rename.service.ts`                      |
| `generated-list-origins.service.ts`          | deleted                                                                                      |
| `generated-list-origin-settled.service.ts`   | deleted                                                                                      |
| `generated-list-outstanding.service.ts`      | deleted                                                                                      |
| `generated-list-split.service.ts`            | deleted                                                                                      |
| `waiting-settlement.service.ts`              | deleted                                                                                      |
| `generated-list-basket.service.ts`           | deleted: `getBasket` is `BasketReadService`, `addLine` and `raise` are gone, `searchScope` moves |
| `generated-list-settle.service.ts`           | deleted, rebuilt as `baskets/basket-settle.service.ts`                                        |
| `generated-list-reopen.service.ts`           | deleted, rebuilt as `baskets/basket-revert.service.ts`                                        |
| `basket-merge.ts`, `basket-line-limits.ts`   | deleted. The list's own validators bound content, quantity and products                       |
| `line-dedup.ts`, `line-dedup.spec.ts`        | **stay**, moved to `baskets/`: they hold `mergeKey`                                           |
| `generated-list.mappers.ts`                  | loses every line mapper                                                                      |
| `generated-list.service.ts`                  | keeps `create`, `listMine`, `listShared`, `update`, `delete`, `deleteForUser`, `load`. Loses `dropOverlaps` if `0133` left any of it, `itemsOf`, `compose`, `resolvePick`, the line half of `write`, `lineViewsFor`, `lineViewFor`, `basketLineViewsFor`, `basketLineViewFor`, `settlementFacts`. A run writes a header, its sources and its people |
| `generated-list.sql.ts`                      | keeps `WRITABLE_LIST`, `WRITABLE_LISTS_SQL`, `ORDER_HISTORY_SQL` (rewritten). Loses `CANDIDATE_LINES_SQL`, `SHEET_CANDIDATE_LINES_SQL`, `LIVE_OVERLAP_SQL`, `GENERATED_LIST_COUNTS_SQL` |
| `generated-list-sharing.service.ts`          | loses `seesZoneData`, `writableIntersection`, `sourceListIds`. Keeps `writableAmong`          |
| `generated-list-order.service.ts`, `line-claim.*`, `generated-list-members.*`, `generated-list-sweep.service.ts`, `list-names.ts`, both controllers, the module | stay, edited as sections 3.5, 6 and 7 say |

Specs deleted with their subjects: `generated-list-basket-add.spec.ts`,
`generated-list-basket-settled.spec.ts`, `generated-list-editing.spec.ts`,
`generated-list-line-rename.spec.ts`, `generated-list-line-rename.integration.spec.ts`,
`generated-list-origins.spec.ts`, `generated-list-origin-settled.spec.ts`,
`generated-list-outstanding.spec.ts`, `generated-list-promote.integration.spec.ts`,
`generated-list-reopen.spec.ts`, `generated-list-send-to-lists.integration.spec.ts`,
`generated-list-settle.spec.ts`, `generated-list-split.spec.ts`, `waiting-settlement.spec.ts`.
Rewritten: `generated-list-run.spec.ts`, `generated-list-finished.spec.ts`,
`generated-list-history.spec.ts` and its integration twin, `generated-list-order.spec.ts` and
its twin, `generated-list-sharing.spec.ts`, `generated-list-shared-people.integration.spec.ts`,
`line-claim.spec.ts`, `generated-lists.module.spec.ts`. `line-claims.fake.ts` stays, because
list specs use it.

Elsewhere:

- Entities `generated-list-line.entity.ts`, `generated-list-line-origin.entity.ts`,
  `generated-list-line-option.entity.ts`, and their six lines in `entities/index.ts`.
  `line-settlement.entity.ts` loses `generatedListLineId`, the nullable pair and the comment
  that explains waiting rows.
- Contracts: `GeneratedLineOrigin` (`enums/generated-list.enums.ts:63`), `waitingSettled`,
  `GeneratedListLineView`, `GeneratedListBasketLineView`, `GeneratedListSourceSnapshot`,
  `GeneratedListSkippedLineView` if `0133` left it, `defaultTargetListId` on three shapes,
  every request and result of the patterns below, `AdminBasketLineView`, and their schemas.
- Patterns: from `GENERATED_LIST_PATTERNS`, `addLine`, `updateLine`, `deleteLine`,
  `reorderLines`. From the sharing patterns, `settleLine`, `reopenLine`, `basketGet`,
  `splitLine`, `addLine`, `searchScope`, `lineOrigins`, `setOriginQuantity`,
  `setOriginSettled`, `setOutstanding`, `renameLine`.
- Platform: `BelowSettledException` and `ERROR_CODES.BELOW_SETTLED`. Only
  `generated-list-origins.service.ts` throws it.
- Gateway routes and their DTOs. From `generated-list.controller.ts`: `POST :id/lines` (246),
  `PATCH :id/lines/:lineId` (277), `DELETE :id/lines/:lineId` (303), `POST :id/lines/order`
  (319). From `GeneratedListParticipantController`: `GET :id/basket` (471), `POST
  :id/basket/lines` (800), `PATCH :id/basket/lines/:lineId` (848), `GET :id/catalog/suggest`
  (902), `POST :id/lines/:lineId/products` (1043), `settle` (1082), `outstanding` (1149),
  `reopen` (1193), both `origins` routes (1242, 1280), `origins/settled` (1334). The share
  link, participant and participant token routes stay where they are until `0140` and `0144`.
  `generated-list-basket-prices.spec.ts` moves with the composition it proves.

## 11. The client, and why this pull request touches none of it

- No file under `libs/velista` or `apps/velista` imports `@portfolio/luna-shopper/contracts`
  or the admin wire types. Rule D4 keeps velista's models its own, mapped from `unknown`, so
  a contract that changes breaks the client at **run time** and nowhere at compile time.
- `wire-contract.spec.ts` replays payloads captured for zones and lists, none of which this
  plan changes. `basket-events.spec.ts` writes the basket event names out as strings, by
  design, so it keeps passing while four of those names no longer exist. It is velista
  `0090`'s to rewrite.
- `apps/velista-luna-e2e` names the gateway and core as implicit dependencies, so `nx
  affected` marks it, and its only targets there are `lint` and the `e2e` the pull request
  workflow does not run.

So `nx affected -t lint test build` is green with no client edit, and the basket screens are
broken against this backend until velista `0090` to `0092`. `0130` section 12 is the rule
that follows: nobody rolls `dev` into `main` in that window.

## 12. Not in this plan

- Skip, and the window on `NOT_AVAILABLE` for a `LIVE` basket: `0137`.
- Marks, the `REMOVED` state, the change log: `0138`.
- `basket.linesChanged` reaching **other** baskets, `basketIds` on the envelope, a finish
  reaching the room, presence per kind: `0139`.
- Links, expiry, named people: `0140`.
- What the order learns from: `0141`. A person's history and what a staple counts: `0142`.
- A price on a settlement: `0143`. The rename: `0144`.

## 13. Tests

Unit, on the free functions of `basket-rows.ts`:

1. Grouping: two lists' lines with one product set are one row, a free text pair folds by
   `normalizeContent`, the anchor is the earliest by `(createdAt, id)`.
2. Each of the four states this plan produces, and `progress` for a mixed basket.
3. `allocateOldestFirst` over entries, the excess on the last entry.
4. Redaction: an owner, a registered reader who writes one of two lists, a guest.

Integration, real database, because every rule is a `WHERE`, a join or a window:

5. Coverage of a `LIVE` basket is every list its owner writes, and a list the owner loses
   drops out on the next read with its rows.
6. A `PENDING` line is a row with `awaitingApproval`. A `REJECTED` one and a soft deleted
   one are not rows.
7. The session: purchases five hours apart are one session, seven hours apart are two, a
   row bought in the current session stays with `state = DONE`, and the same row is gone
   once the session is over.
8. Settle: decrement, one settlement per entry with `basketId`, `from` refused when another
   settle landed first, a second identical tap refused, three bought of two records three,
   `NOT_AVAILABLE` on a finished row refused, an `itemId` outside the options refused.
9. Two settles on two rows that share a line, at once, both commit (the lock order).
10. Revert: newest first, a split remainder keeps every column, a close taken back, a soft
    deleted line skipped and counted, a guest reverting on a list the owner lost finds no
    such row.
11. Demand: a guest on a two entry row refused, the owner's `DECIDE` asked and never the
    actor's, `expect` refused after a concurrent settle, `line.updated` heard by the zone.
12. Add: a guest refused, an actor without `WRITE` refused, a list outside the coverage
    refused with the same answer, a merge onto the list's existing line, a `PENDING` result
    served as a row.
13. Rename over two lists with one confirmation, and the two rows read as one afterwards.
14. `GET /v1/baskets/live` twice in parallel makes one row. The sweep, `listMine`, the claim,
    the trips and the order each ignore it. `update` refuses a status on it.
15. The claim: a line of a list covered by an open `GENERATED` basket is claimed from the
    moment it is added, released when it reaches zero, released when the basket closes it,
    and never claimed by a `LIVE` basket or by an owner who left the zone.
16. Trips: an open basket's row says `asked = bought + left` and follows a raise on the
    list. The same basket finished says what it said at the finish, after the list moves
    again. Reopened, it follows again.
17. The migration up on a database seeded with a waiting row, an origin less line and an
    extra unit logs the three counts, and refuses when a `basketId` backfill is missing.
    Down runs.

Gateway: the DTOs refuse an absent `targetListId`, an absent `from`, a `quantity` on
`NOT_AVAILABLE`. The add route refuses the secret header. Every write route is throttled.

## 14. Acceptance criteria

- [ ] `generated_list_lines`, `generated_list_line_origins`, `generated_list_line_options`
      and `line_settlements.generatedListLineId` do not exist, and `lineId` and `listId` are
      `NOT NULL`.
- [ ] No column anywhere stores a basket row's asked, bought, left, position, pick or state
      while the basket is open.
- [ ] `GET /v1/baskets/live` answers the caller's one `LIVE` basket, creating it once.
- [ ] A basket read shows a line added to a covered list by anybody, with no write to the
      basket in between.
- [ ] Settle, revert, demand, add and rename work on a row, each refused with
      `stale_quantity` when the row moved, each emitting the list's own event and
      `basket.linesChanged`.
- [ ] A guest cannot add a line, and cannot cause a write to a list the owner cannot write,
      in either direction of a purchase.
- [ ] A reader is told which list a row belongs to for exactly the covered lists they write
      themselves. `seesZoneData` does not exist.
- [ ] A finished `GENERATED` basket's trip rows come from the view, and reopening deletes them.
- [ ] The claim, the trips, the suggestions, the history counts and the admin read contain no
      reference to origins.
- [ ] Every file, contract, pattern, event and route of section 10 is gone.
- [ ] The seven services boot on a slot, and `openapi.json` and the wire types are current.

## 15. Verification

```sh
npx nx run-many -t lint test build -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper-backend-realtime luna-shopper/contracts luna-shopper/platform luna-shopper-admin/models luna-shopper-admin/feature-people
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up      # migrations run here, then the seven services boot
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down
```

Run the integration specs through their own target against that slot (memory note on Luna
backend spec traps). Grep the workspace for `generated_list_line`, `GeneratedListLine`,
`waitingSettled`, `seesZoneData` and `generatedListLineId` before opening the pull request:
the only matches left are this migration, older migrations and plan files.
