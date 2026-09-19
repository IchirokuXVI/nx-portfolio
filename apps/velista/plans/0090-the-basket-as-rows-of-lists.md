# 0090: the basket as rows of lists

> Backend half: `apps/luna-shopper-backend/plans/0136`, which must be merged first, with
> `0133` (kind and status) under it. The record of the whole series is backend `0130`, and
> this plan uses its vocabulary (section 3), its arithmetic (section 4), its redaction
> (section 6) and its routes (section 8) word for word. **No mock exists.** Nothing here
> changes what the basket page looks like: the same rows, the same sheets, drawn from a
> different model. Section 9 says what is drawn where, in words.
>
> A basket on this client is a copy of a copy. `BasketLine` mirrors `generated_list_lines`,
> `BasketLineOrigin` mirrors the provenance rows, and the store keeps both in step from four
> line events, two origin writes and a split. Backend `0136` deletes every one of those
> tables. What it serves instead is a header and **rows read from the lists themselves**: a
> row is the covered lines that share one merge key, each of them an entry, addressed by the
> id of its anchor. This plan rewrites the client's basket model, its mappers, its HTTP and
> memory gateways, its store and the pure view pipeline around that shape, deletes what the
> old shape needed, and fixes the one defect the audit found that is this client's alone:
> the basket never reads again after its socket reconnects or the app comes back.
>
> Prerequisite reading: backend `0130` in full, backend `0136`, velista `0054` (absolute
> writes and `from`), `0060` section 4 (counts are the server's), `0069` section 3.1 and
> `0084` section 5 (a sheet whose line vanished), `0074` to `0078` (the view pipeline, the
> grouping by list, the shop), `0086` (the generation counter and the queued read),
> `libs/velista/models/src/lib/basket-view.ts` and `compose-basket-view.ts` in full, and
> `libs/velista/data-access/src/lib/generated-lists/basket-store.ts` in full.

## Brief for the agent

### Objective

Replace the client's basket model with `Basket`, `BasketRow` and `BasketRowEntry` of
section 3, rebuild the gateways, the store and `composeBasketView` on it, address every
row sheet by `rowKey`, make the store read again on reconnect, on resume and on
`basket.linesChanged`, and delete everything section 2 names.

### Context

- `libs/velista/models/src/lib/basket-view.ts` holds `BasketLine` (line 241),
  `BasketLineOrigin` (115), `BasketLineOriginDetail` (350), `BasketOriginCandidate` (400),
  a `BasketListRef` (435) that is **not** backend `0130`'s, `basketLineState` (598),
  `outstanding` (606), `basketLinesProgress` (659), `BasketView` (681) and the request and
  result types of a settle, a split, a rename and the two origin writes.
- `compose-basket-view.ts` is the pure pipeline of velista `0075`: filter, order, group. It
  owns a `BasketRowMark` (line 112) that is a **price** mark (`cheaper`, `unlisted`), and
  a `BasketViewRow` (145) that holds a `BasketLine` and, under `grouping: 'list'`, one
  `BasketLineOrigin`.
- `BasketServiceI` (`data-access/src/lib/generated-lists/basket-service.ts:49`) has an HTTP
  twin (`basket-api.ts`) and a memory twin (`basket-memory.ts`). Both talk
  `/v1/generated-lists`.
- `BasketStore` (`basket-store.ts`) folds `generatedList.lineSettled`, `lineUpdated`,
  `lineAdded` and `lineRemoved` by line id (lines 210 to 247), counts `progress` with
  `basketLinesProgress` (528) and `unsettled` by subtraction (434), and schedules a
  coalesced refresh (`_scheduleRefresh`, 1374) guarded by `_generation` (197).
- **The defect.** `BasketSocket._onConnected` (`basket-socket.ts:292`) sets a flag and a
  health timer and nothing else. Neither `BasketStore`, `BasketSocket` nor `BasketPage`
  injects `AppResumed` (`libs/velista/platform/src/lib/app-resumed.ts:56`). Two comments
  (`basket-page.ts:100` and `basket-store.ts:599`) say the screen reads again on resume.
  No code does. A phone that spent ten minutes in a pocket shows the basket as it was.
- The basket route is `shopping-lists/:generatedListId` in
  `libs/velista/feature-shell/src/lib/routes.ts:747`, with `BasketSocket`, `BasketStore` and
  `BasketViewStore` as route providers, and the settle sheet at `lines/:lineId/settle`
  (778).
- Backend `0136` serves `GET /v1/baskets/:id` and the row writes of backend `0130`
  section 8. The join, the participant token, the share link and the participants stay on
  `/v1/generated-lists` until backend `0144`.

### Target state

Every acceptance criterion in section 17 holds. No symbol of section 2 is left in
`libs/velista` or `apps/velista`.
`npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-shopping-lists velista/feature-home velista/feature-shell`
and `npx nx build velista` are green.

### Scope

- Work only in: `libs/velista/models/src/lib/` (`basket-view.ts`, `compose-basket-view.ts`,
  `enums.ts`, `generated-list-view.ts`, `basket-search.ts`, their specs),
  `libs/velista/data-access/src/lib/generated-lists/`, `.../mapping/basket-mappers.ts` and
  its specs, `.../realtime/realtime-events.ts`, `realtime-event-mapper.ts`,
  `realtime-memory.ts` and their specs, `libs/velista/feature-shopping-lists/`,
  `libs/velista/feature-shell/src/lib/routes.ts` and `routes.spec.ts`, the callers in
  `libs/velista/feature-home/` that stop compiling, and the two translation files.
- Do NOT touch: any backend project, the zone list pages (`feature-lists`), the trips
  models, the join page's flow, the share and people sheets beyond what stops compiling,
  `BasketSessionStore`, `BasketViewStore`'s memory rules, `apps/velista-luna-e2e` (velista
  `0096` owns it).

### Constraints

- Load the `nx-portfolio-angular-developer` skill before writing Angular, and the
  `design-taste-frontend` skill before touching anything that is drawn.
- Rule D4: every model here is this scope's own, every enum has a fallback, and every
  value crosses `basket-mappers.ts` from `unknown`. A backend DTO is never passed through.
- The server counts. Nothing in this scope subtracts `bought` from `asked`, and nothing
  decides a row's state from its numbers (velista `0060` section 4, backend `0130`
  section 4).
- Zoneless components. Nothing a service provides imports `@angular/core/rxjs-interop`
  (`no-rxjs-interop-in-the-live-basket.spec.ts` stays green, and keeps its name).
- The three route providers are never destroyed by the router. `BasketPage` tears them
  down, as it does today.
- The memory gateway is rewritten in the same commit as the HTTP one, to the same model.
- Dates through `Intl`. Tokens only. Icons only as components from `@portfolio/shared/ui`,
  and this plan adds none.
- Only make the changes this plan names. Skip, the composer, the demand control and the
  pick are velista `0092`. The `LIVE` surface is `0091`. Marks are carried by the model
  here and drawn by `0093`.

### Action boundaries

- Proceed with in scope edits, specs, and a front end slot pointed at a backend that has
  `0136` (`tools/dev/ng-slot.sh --list` first, `--apps shell,velista`, `--down` after).
- Stop and ask when backend `0136` as merged does not serve a field section 3 marks
  "needed from `0136`", when a row write does not answer the row and the counts
  (section 5.3), or when `apps/velista-luna-e2e` fails for a reason other than the old
  selectors and routes this plan removes.

### Progress evidence

Report after the models and mappers with their specs, after the two gateways, after the
store with the resync specs, after the view pipeline, and after the page and the sheet
with a slot run. Each report names the command and its result.

### Session strategy

New session. The work is one chain (models, mappers, gateways, store, pipeline, screen)
and each link needs the one before it, so no subagent is worth its hand over.

## 1. What is being built

| Piece                                                           | Where                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| `Basket`, `BasketRow`, `BasketRowEntry`, `BasketListRef`, enums | `models/src/lib/basket-view.ts`, `enums.ts`                    |
| Mappers from `unknown`                                          | `data-access/src/lib/mapping/basket-mappers.ts`                |
| `BasketServiceI`, `BasketApi`, `BasketMemory`                   | `data-access/src/lib/generated-lists/`                         |
| `BasketStore` over rows, keyed by `rowKey`                      | the same folder                                                |
| Reading again: reconnect, resume, `basket.linesChanged`         | `basket-socket.ts`, `basket-store.ts`, the realtime event files |
| `composeBasketView` over rows and entries                       | `models/src/lib/compose-basket-view.ts`                        |
| `lib-basket-row`, `lib-row-entries`, the settle sheet on a row  | `feature-shopping-lists/src/lib/`                              |
| `rows/:rowKey/settle`                                           | `feature-shell` `routes.ts`, `basket-paths.ts`                 |

## 2. What is deleted

Delete, do not deprecate. A grep for each name over `libs/velista` and `apps/velista`
answers nothing when this plan is done.

**Models** (`basket-view.ts`, `enums.ts`, `generated-list-view.ts`):

- `BasketLine`, `BasketLineOrigin`, `BasketLineOriginDetail`, `BasketOriginCandidate`,
  `BasketLineOrigins`, and today's `BasketListRef` (the name is reused, section 3.3).
- `BasketLineState`, `basketLineState`, `outstanding`, `basketLinesProgress`.
- `BasketOutstandingRequest`, `BasketOriginQuantityRequest`, `BasketOriginQuantityResult`,
  `BasketOriginSettledRequest`, `BasketOriginSettledResult`.
- `BasketSplitRequest`, `BasketSplitResult`, and every field of a split. Backend `0130`
  section 11, decision 4, drops split on both surfaces, and it cannot outlive
  `BasketLine`, so it goes here and not in `0092`.
- `BasketSettleSkip`, `skippedCount` and `skipped` on `BasketSettleResult`. Coverage is
  recomputed on every request, so no `ACCESS_GONE` skip is left to report (backend `0130`
  section 5).
- `waitingSettled`, `kind: 'DERIVED' | 'ADDED'` with `BASKET_LINE_KINDS` and
  `BasketLineKind`, `targetListId`, `pickId`, `BASKET_ORIGIN_UNAVAILABLE_REASONS` and
  `BasketOriginUnavailableReason`.
- `BasketView.seesZoneData`, `sources`, `listNames`. Section 3.4 says what replaces each.
- `GeneratedListSkippedLine` and `GeneratedListRun.skipped`, if backend `0133`'s pull
  request left them.
- `GENERATED_LIST_STATUSES`, `LIVE_GENERATED_LIST_STATUSES`, `isLiveGeneratedList`,
  `WritableGeneratedListStatus`, if backend `0133`'s pull request left them. Section 3.1
  names what replaces them.

**Data access**:

- `BasketServiceI.reopen`, `splitLine`, `setOutstanding`, `getLineOrigins`,
  `setOriginQuantity`, `setOriginSettled`, `addLine` (the target free add, whose route
  backend `0136` deletes. Velista `0092` brings an add back, with a list).
- `BasketStore.lines`, `unsettled`, `lastSplit`, `seesZoneData`, `listNames`,
  `pendingTargets`, `append`, `_insert`, `_namesUnknownProducts`, `drop`, `apply`,
  `splitLine`, `setOutstanding`, `loadLineOrigins`, `setOriginQuantity`,
  `setOriginSettled`, `_recordApproval`, `rememberListNames`, `addLine`, `adding`,
  `lastAdded`.
- The realtime events `generatedList.lineSettled`, `generatedList.lineUpdated`,
  `generatedList.lineAdded` and `generatedList.lineRemoved`, in `realtime-events.ts`, the
  mapper, `realtime-memory.ts`, `basket-events.spec.ts` and `wire-contract.spec.ts`.
- `BASKET_REOPEN_AVAILABLE` (`basket-service.ts:402`). A revert is always available.

**Feature**:

- The folder `feature-shopping-lists/src/lib/line-lists-summary/` (four files). Its
  `commitAsked` and `commitGot` arithmetic goes with it. `lib-row-entries` replaces it.
- The folder `basket-line-row/` is **renamed** `basket-row/`, the component
  `BasketLineRow` to `BasketRow`, the selector to `lib-basket-row`, and its three side
  specs (`-price`, `-share`, `-shop-price`) move with it. `basket-line-row-share.spec.ts`
  is about a split share and is deleted.
- In `settle-sheet.ts`: `setShare`, `onSharePreview`, the share pane, and the origin
  rows. In `basket-page.*`: the composer (template lines 465 to 488 and `addLine` at
  `basket-page.ts:1064`). No composer is drawn between this plan and velista `0092`.

## 3. Models

All in `libs/velista/models/src/lib/`. Every interface is `readonly` through and through,
as the file already is.

### 3.1 Enums (`enums.ts`)

```ts
export const BASKET_KINDS = ['LIVE', 'GENERATED', 'UNKNOWN'] as const;
export type BasketKind = (typeof BASKET_KINDS)[number];
export const BASKET_KIND_FALLBACK: BasketKind = 'UNKNOWN';

export const BASKET_STATUSES = ['OPEN', 'FINISHED', 'ARCHIVED', 'UNKNOWN'] as const;
export type BasketStatus = (typeof BASKET_STATUSES)[number];
export const BASKET_STATUS_FALLBACK: BasketStatus = 'UNKNOWN';
export type WritableBasketStatus = 'OPEN' | 'FINISHED';
export function isOpenBasket(status: string): boolean;

export const BASKET_ROW_STATES = [
  'WANTED', 'PARTLY', 'DONE', 'NOT_AVAILABLE', 'SKIPPED', 'REMOVED',
] as const;
export type BasketRowState = (typeof BASKET_ROW_STATES)[number];
export const BASKET_ROW_STATE_FALLBACK: BasketRowState = 'WANTED';

export const BASKET_ROW_NOTES = ['SKIPPED_EARLIER'] as const;
export type BasketRowNote = (typeof BASKET_ROW_NOTES)[number];

export const BASKET_CHANGE_MARKS = ['ADDED', 'CHANGED', 'REMOVED'] as const;
export type BasketChangeMark = (typeof BASKET_CHANGE_MARKS)[number];
```

- `UNKNOWN` is the kind's fallback because it is the least capable surface: a basket of an
  unknown kind draws no finish, no presence and no name editor, and the server refuses
  whatever it does not allow anyway.
- `WANTED` is the state's fallback because it is the one state that hides nothing. A row
  this build cannot classify is still a thing to buy.
- A note and a mark this build does not know map to `null`, never to a guess.
- The word "live" now names a kind. `isLiveGeneratedList` becomes `isOpenBasket` at every
  caller (`shopping-lists-page.ts:434`, `select-home-state.ts`, `shopping-lists-view.ts`),
  after backend `0130` section 3.

### 3.2 The row and its entries (`basket-view.ts`)

```ts
/** One covered line inside a row (backend 0130, section 3). */
export interface BasketRowEntry {
  readonly lineId: string;
  /** Present only when the reader was served this list's ref (section 3.3). */
  readonly listId: string | null;
  readonly left: number;
  readonly bought: number;
  readonly asked: number;
  /** The entry's own state, by the server (backend `0136`, `BasketRowEntryView.state`). */
  readonly state: BasketRowState;
  /** The line awaits the household's approval. Mapped from the wire's `approvalStatus`. */
  readonly awaitingApproval: boolean;
  /**
   * Whether this entry's demand can be changed, by the server, which asks the rule of the
   * basket's owner (backend `0136`, `demandEditable`). No client rule can replace it.
   */
  readonly demandEditable: boolean;
}

/** What the screen draws: the covered lines that share one merge key. */
export interface BasketRow {
  /** The anchor's list line id. The key on the wire and in a sheet's URL. */
  readonly rowKey: string;
  readonly content: string;
  readonly left: number;
  readonly bought: number;
  readonly asked: number;
  readonly state: BasketRowState;
  readonly note: BasketRowNote | null;
  /** When the fact behind `note` happened, on the server clock. Null exactly when `note` is. */
  readonly noteAt: string | null;
  /** What changed recently, for this viewer. Carried here, drawn by 0093. */
  readonly mark: BasketChangeMark | null;
  /** True while any entry awaits approval. Never named `pending`: that word is the count. */
  readonly awaitingApproval: boolean;
  /** The union of the entries' product sets, in the server's order. */
  readonly optionIds: readonly string[];
  /** The participant of the newest event on the row, or null. */
  readonly touchedBy: string | null;
  readonly touchedAt: string | null;
  readonly entries: readonly BasketRowEntry[];
}
```

- `left`, `bought`, `asked` and `state` are **read**, on the row and on the entry. No
  function in this scope derives one from another. `basketLineState` and `outstanding`
  have no successor.
- `BasketRowEntry.state` exists because a row under a list's heading is drawn for one
  entry (velista `0077` section 4), and whether **that** list's share is done is a
  question only the arithmetic answers. The server owns the arithmetic. Backend `0130`
  section 4 states a row's state, and backend `0136` serves the entry's beside it, with
  `approvalStatus` and `demandEditable`.
- There is no `pickId`. The product somebody bought travels with the settle (velista
  `0092`), and `optionIds` is what the row offers.
- `touchedBy` is a participant id, resolved against `Basket.participants` exactly as
  `BasketLine.touchedBy` is today.

### 3.3 The lists a reader was served

```ts
/** A covered list the READER holds WRITE on (backend 0130, section 6). */
export interface BasketListRef {
  readonly listId: string;
  readonly name: string;
  readonly zoneId: string;
  readonly zoneName: string;
}
```

The name is reused on purpose. Today's `BasketListRef` (a list this basket was able to send a
line to, with `fromRun`) described the send picker of velista `0068`, and that picker has
nothing left to pick: a line is on a list or it does not exist. An entry whose `listId`
is `null` belongs to a list this reader was not served, and the client knows how much and
never where.

### 3.4 The basket

```ts
export interface BasketProgress {
  readonly done: number;
  readonly unavailable: number;
  readonly total: number;
}

export interface Basket {
  readonly id: string;
  readonly kind: BasketKind;
  /** Null on a LIVE basket, and on a GENERATED one shown as its date. */
  readonly name: string | null;
  readonly status: BasketStatus;
  readonly createdAt: string;
  readonly rows: readonly BasketRow[];
  readonly lists: readonly BasketListRef[];
  readonly participants: readonly BasketParticipant[];
  readonly me: BasketParticipant;
  readonly products: ReadonlyMap<string, BasketProduct>;
  readonly scopes: ReadonlyMap<string, BasketPriceScope>;
  /** Over rows that are not REMOVED. The server's, never recounted. */
  readonly progress: BasketProgress;
  /**
   * total - done - unavailable, by the server. A SKIPPED row is pending. The wire carries it
   * inside `progress` (backend `0136`, `BasketProgress.pending`), and the mapper lifts it here
   * because the finish sheet and the home card read it on its own.
   */
  readonly pending: number;
}
```

| Gone                        | What a caller reads now                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `BasketView` (the name)     | `Basket`. `BasketLoad` keeps its shape around it.                                                |
| `seesZoneData`              | `basket.lists.length > 0` for "is allowed to group by list", and `entry.listId !== null` per entry.        |
| `sources`, `listNames`      | `basket.lists`, and `basketListsById(basket)` beside the model for the headings.                 |
| `generatedAt`               | `createdAt`.                                                                                     |
| `basketLinesProgress(lines)`| `basket.progress`, and `basketRowsProgress` for a section (section 8.3).                         |
| `BasketStore.unsettled`     | `basket.pending`. The finish sheet (`finish-sheet.ts:99`) and `allSettled` (`basket-page.ts:248`) read it. |
| `basketTakesLines(status)`  | `isOpenBasket(status)`.                                                                          |

`BasketParticipant`, `BasketPresenceEntry`, `BasketProduct`, `BasketPriceScope`,
`ScopeLocation`, `offerAt`, `BasketLinkPreview`, `BasketSession`, `BasketShareLink`,
`BasketShare`, `BasketLoad` and the rename's merge question types do not change.

### 3.5 Requests and results

```ts
export interface BasketSettleRequest {
  readonly outcome: SettlementOutcome;
  /** Required for BOUGHT. Absent for NOT_AVAILABLE. */
  readonly quantity?: number;
  /** The row's `left` the person was looking at. */
  readonly from: number;
  readonly itemId?: string;
  /** Units per entry, for a reader who named them. Entries served only. */
  readonly allocations?: readonly { lineId: string; quantity: number }[];
}

export interface BasketRevertRequest {
  readonly units: number;
  readonly from: number;
}

/** What every row write answers (backend `0136`, `BasketRowResult`). */
export interface BasketRowResult {
  /** Never null. A row bought to zero stays in the view as `DONE`. */
  readonly row: BasketRow;
  readonly progress: BasketProgress;
  /** Set by a rename that folded this row into another: the key the request used. */
  readonly replacedRowKey: string | null;
  /** Set by a revert: entries whose line was deleted since, so no units went back. */
  readonly skippedCount: number;
}
```

`BasketRenameRequest` and `BasketRenameResult` keep their shape with `rowKey` in place of
the line id, and the absorbed row is named by its `rowKey`. The demand request is velista
`0092`'s.

## 4. Mapping (`basket-mappers.ts`)

- `toBasket(raw: unknown): Basket | null`, `toBasketRow`, `toBasketRowEntry`,
  `toBasketListRef`, `toBasketProgress`, `toBasketRowResult`. Each refuses a value that is
  not an object, and a row without a `rowKey`, a `content` or an `entries` array.
- A row with **no entry** is refused, except a row whose `state` is `REMOVED`: every entry
  of such a row left the coverage, which is what the state means.
- Enums go through the fallbacks of section 3.1. `note` and `mark` map an unknown string to
  `null`.
- Numbers go through `numOr(…, 0)` and are clamped at zero. A negative `left` is a server
  defect this client does not draw.
- `entry.listId` is `null` unless it is a string **and** `basket.lists` holds that id. A
  list id with no ref is dropped to `null`, so the rest of the client has one test for
  "served" and cannot disagree with itself.
- `progress`, with its `pending` count inside it, is required. A basket without it is refused, because the
  alternative is to recount, and recounting is what section 3 removed.
- `mappers.spec.ts` and `basket-mappers.spec.ts` lose every case about origins, waiting
  units, the run's skipped lines and the split, and gain the cases of section 16.

## 5. The gateways

### 5.1 `BasketServiceI`

```ts
getBasket(basketId: string): Promise<Basket>;
settle(basketId: string, rowKey: string, body: BasketSettleRequest): Promise<BasketRowResult>;
revert(basketId: string, rowKey: string, body: BasketRevertRequest): Promise<BasketRowResult>;
renameRow(basketId: string, rowKey: string, body: BasketRenameRequest): Promise<BasketRenameResult>;
suggest(basketId: string, query: string): Promise<readonly CatalogSuggestion[]>;
```

beside `previewLink`, `join`, `listParticipants`, `refreshSocketToken`, the share link
methods, `revokeParticipant`, `addParticipant` and `leaveBasket`, which keep their
signatures. The parameter called `generatedListId` becomes `basketId` everywhere in this
interface.

### 5.2 `BasketApi`

Two bases, one constant each, so backend `0144` changes one line:

- `BASKETS = '/v1/baskets'`: `GET /:id`, `POST /:id/rows/:rowKey/settle`,
  `POST /:id/rows/:rowKey/revert`, `PATCH /:id/rows/:rowKey`.
- `GENERATED_LISTS = '/v1/generated-lists'`: the participant token, the share link, the
  participants, leave, and `catalog/suggest` until `0136` says it moved. Read `0136` for
  which of these it moved, and follow it.
- The guest header `x-participant-secret` and the account bearer are chosen exactly as
  `basket-api.ts:57` and `:579` choose them today.
  `participant-token-never-travels.spec.ts` stays green.

### 5.3 What a write answers

Every row write answers `BasketRowResult`. The store folds `row` by `rowKey`, replaces
`progress`, and drops the row named by `replacedRowKey` when a rename folded it into
another. `row` is never null: a row bought to zero stays as `DONE`. It never patches a
number. If `0136` as merged answers anything less, stop and ask: the fallback (a full
read after every tap) is a worse product and is not this plan's to choose.

### 5.4 `BasketMemory`

Rewritten to the same model: it holds lists with lines, a coverage per basket, and
settlements that name a basket, and it **derives** rows the way backend `0130` section 4
states them (group by merge key, anchor by `(createdAt, id)`, `asked = bought + left`,
the state table in its order). It is the one place in this scope allowed to do that
arithmetic, because it stands in for the server. `basket-memory.spec.ts` asserts the
state table row by row. Everything about waiting units (`basket-memory.ts:791`, `:919`,
`:1103` to `:1130`), origins and splits is deleted.

## 6. `BasketStore`

- `rows = computed(() => this._basket()?.rows ?? [])`, `lists`, `progress`, `pending`,
  `kind`, `open = computed(() => isOpenBasket(status))`, `finished` as its negation.
- `busyRows: Signal<ReadonlySet<string>>`, keyed by `rowKey`.
- `settle(rowKey, body)`, `revert(rowKey, body)`, `renameRow(rowKey, body)`, and
  `setLeft(rowKey, next, from)`: the row reel's one call. `next < from` is a `BOUGHT`
  settle of `from - next`. `next > from` is a revert of `next - from`. The ceiling the reel
  offers is `row.asked`, read and never computed.
- **`from` on every write.** A `stale_quantity` refusal reads the basket again and sets
  the row's notice to `basket.error.staleLine` ("Somebody else changed this line."),
  which is velista `0054` section 4.1 unchanged.
- `rowFor(key: string): BasketRow | null`: the row whose `rowKey` is `key`, else the row
  one of whose entries has `lineId === key`, else `null`. Section 7.3 is why.
- `_fold(result: BasketRowResult, rowKey: string)`: the single place a write lands.
- `open(basketId)`, `leave()`, `refresh()`, `_generation`, `_reading`, `_queued` and
  `_scheduleRefresh()` keep the behaviour velista `0086` gave them.

## 7. Staying current

### 7.1 The three reasons to read again

| Reason                                   | Source                                                         | Read        |
| ---------------------------------------- | -------------------------------------------------------------- | ----------- |
| the socket connected **again**           | `BasketSocket.reconnects`, a counter signal                    | at once     |
| the app came back                        | `AppResumed.resumes`, the counter `connection-recovery.ts` reads | at once   |
| `basket.linesChanged { lineIds }`        | the basket socket (backend `0139`)                             | coalesced, 1500 ms |
| `basket.updated`, a participant joined or left | the basket socket                                        | coalesced, 1500 ms |

- `BasketSocket` gains `reconnects = signal(0)`, incremented in `_onConnected` on every
  connect after the first of a visit, and reset by `close()`. A counter and not a boolean,
  for the reason `AppResumed.resumes` is one: a reader that missed the transition cannot
  tell it happened.
- `BasketStore` reads both counters in one `effect`, compares each against the value it
  last acted on, and calls `refresh()` when either moved and a basket is open. An `effect`
  is core, not `rxjs-interop`. The route injector is never destroyed, so the effect
  outlives the page: it does nothing while `_id` is `null`, which `leave()` guarantees.
- The two comments that claimed this already happened (`basket-page.ts:100`,
  `basket-store.ts:599`) are rewritten to say what the code does.
- `basket.linesChanged` carries ids and nothing else (backend `0130` section 6), so the
  store never merges it. It reads again. This plan maps the event now and needs nothing
  from backend `0139` to be correct: until `0139` ships, a basket stays current from its
  own writes, the reconnect and the resume.
- `GeneratedListStore` (the home card and the history) stops listening for the four
  deleted line events (`generated-list-store.ts:162`) and reads again on
  `generatedList.updated` and on `AppResumed`. A settle no longer reaches the owner's own
  room with a line in it. Section 15 says where that goes.

### 7.2 A refetch is quiet

No skeleton and no spinner once rows are drawn. A failed quiet read leaves the rows as
they are and sets the `degraded` treatment the socket already has.

### 7.3 A sheet whose row was re-keyed

A row's key is its anchor, and an anchor can change under an open sheet: somebody adds
an earlier "Milk" on another list, a rename merges two lines, the anchor is deleted. The
sheet holds `:rowKey` from its URL and asks `BasketStore.rowFor(key)` on every change.

- It finds the same `rowKey`: nothing happens.
- It finds a row through one of its **entries**: the row is the same thing under a new
  key. The sheet replaces its own URL with the new `rowKey` (`replaceUrl: true`, through
  `sheetSegments()`), keeps its pane and its typed values, and says nothing.
- It finds nothing: the row left the basket. The sheet dismisses to the basket with
  `SheetNavigation.dismiss(basketUrl)` and the page draws `basket.row.gone` once, which
  is what velista `0069` section 3.1 and `0084` section 5 do for a vanished line.

## 8. `composeBasketView` over rows

The pipeline stays pure and stays in its order: filter, order, group (velista `0075`
section 3). What changes is what it walks.

### 8.1 Names

- `BasketRowMark` becomes `BasketPriceMark`, and `BasketViewRow.mark` becomes `priceMark`.
  The word "mark" belongs to backend `0130`'s change mark now, and two marks on one row
  need two names. `lib-basket-row`'s input `mark` is renamed with it.
- `BasketViewRow` holds `row: BasketRow` and `entry: BasketRowEntry | null`, in place of
  `line` and `origin`. `key` is `rowKey`, or `rowKey + ':' + entry.lineId` for an entry
  row.

### 8.2 Filter

- The search (`basket-search.ts`) matches `row.content`. It matched the line's content
  before, and nothing else changes in it.
- The `lists` filter keeps a row when **any** served entry is in a kept list, **or** the
  row has an entry with `listId === null`. A reader cannot filter out what they cannot
  name. This is the successor of "Lines on no list yet are always shown" (velista `0075`
  section 6), which described rows that no longer exist.
- A `REMOVED` row passes every filter. It is information about the basket, not a thing to
  find.

### 8.3 Order, group, and a section's count

- `order: 'shop'` is the array as the server sent it. `alpha` sorts by `row.content` with
  the existing `Intl.Collator`. Rows the chosen shop does not list still sink (velista
  `0078`), and a `REMOVED` row sinks below them.
- `grouping: 'list'` draws one view row per **entry**, under its list's name from
  `basket.lists`. Every entry with `listId === null` goes under **one** heading,
  `basket.group.otherLists`, last. The grouping is offered only when `basket.lists` is not
  empty, which is the test `BasketViewStore._offersGrouping` already asks of
  `sourceLists()`. A guest is never offered it.
- `basketRowsProgress(units: readonly { state: BasketRowState }[]): BasketProgress` is
  the one counting function left, and it counts **states**: `done` is the units in
  `DONE`, `unavailable` the units in `NOT_AVAILABLE`, `total` every unit not `REMOVED`.
  It compares no number with another. A section passes its rows, or its entries under the
  list grouping. A spec asserts that over an unfiltered, ungrouped basket it equals
  `basket.progress` for every fixture, so the heading and the sentence above it cannot
  disagree.

## 9. The screen

Nothing moves. The page keeps its header, its tools row, its sections, its sheets and its
banners. What each part reads changes.

### 9.1 `lib-basket-row`

Inputs: `row` (required), `entry` (`BasketRowEntry | null`), `people`, `products`,
`lists` (`ReadonlyMap<string, BasketListRef>`), `shop`, `priceMark`, `meId`, `ownName`,
`busy`, `finished`, `notice`, `highlight`. `canReopen`, `awaitingApproval`, `origin` and
`listNames` are gone: the first is always true on an open basket, the second is
`row.awaitingApproval`, and the last two are `entry` and `lists`.

| State           | What the row draws                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `WANTED`        | the name, the reel at `left`, the price. As a wanted line draws today.                                |
| `PARTLY`        | the same, and "`bought` of `asked`" under the name.                                                   |
| `DONE`          | the tick, the name quiet, "`bought` of `asked`", and the revert glyph.                                |
| `NOT_AVAILABLE` | the cross and `basket.line.notAvailable`, and the revert glyph. As today.                             |
| `SKIPPED`       | as `WANTED` in this plan. Velista `0092` draws it.                                                    |
| `REMOVED`       | as `WANTED` with every control disabled in this plan. Velista `0093` draws it.                        |

- Under an entry, the numbers and the state are the **entry's**. The name and the price
  are the row's.
- `row.awaitingApproval` draws the existing "waiting for the list to agree" caption
  (`basket.units.pending`) and leaves the row buyable, after backend `0130` section 3.
- The reel's ceiling is `asked`, of the row or of the entry. Lowering commits a settle,
  raising commits a revert, both through `BasketStore.setLeft`.

### 9.2 The settle sheet, on a row

- Routed at `rows/:rowKey/settle`. It reads `BasketStore.rowFor(rowKey)`.
- The three actions send `from: row.left`. "Got them all" sends
  `{ outcome: 'BOUGHT', quantity: row.left, from }`. "Got some" sends the number chosen.
  "The shop had none" sends `{ outcome: 'NOT_AVAILABLE', from }`. An explicit quantity on
  every `BOUGHT` replaces the server side cap that made a double tap safe (backend `0130`
  section 8).
- The name editor calls `renameRow` and keeps its merge question. It is drawn when
  `basket.me` has an account and **every** entry's `listId` is served, which is the client
  half of "actor holds `WRITE` on every entry's list".
- **`lib-row-entries`** replaces `lib-line-lists-summary`. It is drawn when the row has
  more than one entry, or one entry whose list is served. One line per entry: the list's
  name and its group's name from `basket.lists`, or `basket.entries.otherList` when
  `listId` is `null`. Then "asks for `left`", "got `bought`". For a served entry on an
  open basket the "got" number is a reel from `0` to `entry.asked`: raising it sends a
  settle with `allocations: [{ lineId, quantity }]`, lowering it sends a revert with the
  units and `from: row.left`. The "asks for" number is text here. Velista `0092` makes it
  a control.
- The history pane is unchanged.
- The share pane, `setShare` and `onSharePreview` are deleted with the split.

### 9.3 The page

- The progress sentence reads `basket.progress`. The finish sheet's count and
  `allSettled` read `basket.pending`.
- The chip count (`basket-page.ts:901`) counts composed rows that are not `REMOVED`.
- The composer is not drawn.
- The reopen banner, the finish entry, the people and share entries and presence do not
  change. Velista `0091` decides them by kind.

## 10. Routes and paths

- `routes.ts:778`: `sheet({ path: 'rows/:rowKey/settle', … })`. Stamped by `sheet()`, so
  the URL is `…/shopping-lists/<id>/sheet/rows/<rowKey>/settle`. Never write the `sheet`
  segment by hand.
- `basket-paths.ts`: `settleSheetPath(locale, basePath, basketId, rowKey)` through
  `sheetSegments()`. Every caller opening the sheet goes through it.
- The sheet's cancel, scrim and Escape go through `SheetNavigation.dismiss(basketUrl)`.
  The page's chevron keeps `PageNavigation.back(fallbackUrl)`.
  `no-unguarded-history-back.spec.ts` stays green.
- `routes.spec.ts` asserts the new path, and that no page path contains `sheet`.
- `generatedListIdGuard` keeps its name until backend `0144`.

## 11. Copy

New keys, in `libs/velista/ui/assets/i18n/en.json` and `es.json` (the assets sit beside
`src`, not inside it):

| Key                         | English                           | Spanish                                  |
| --------------------------- | --------------------------------- | ---------------------------------------- |
| `basket.group.otherLists`   | Other lists                       | Otras listas                             |
| `basket.entries.title`      | Lists that ask for this           | Listas que lo piden                      |
| `basket.entries.otherList`  | Another list                      | Otra lista                               |
| `basket.entries.asks`       | asks for {{count}}                | pide {{count}}                           |
| `basket.entries.got`        | got {{count}}                     | {{count}} conseguidos                    |
| `basket.entries.gotLabel`   | {{name}}, got                     | {{name}}, conseguidos                    |
| `basket.row.boughtOf`       | {{bought}} of {{asked}}           | {{bought}} de {{asked}}                  |
| `basket.row.gone`           | That line is no longer in this list. | Esa línea ya no está en esta lista.   |

Deleted with their callers: every key under `basket.units` except `pending`, every key
under `basket.send`, and the split keys under `basket.product`. Check each against a grep
before deleting it, and keep a key another screen reads.

## 12. Accessibility

- A row is named by its content, then its state in words, then "`bought` of `asked`".
  The state is never colour alone (velista `0052` section 6.3).
- `lib-row-entries` is a list. Each reel is labelled `basket.entries.gotLabel` with the
  list's name, or with `basket.entries.otherList`.
- A quiet refetch announces nothing. A `stale_quantity` notice and `basket.row.gone` go
  through the page's polite status element, once.
- A sheet that re-keys itself keeps focus where it was.

## 13. Realtime

Covered by section 7. The basket socket still joins `generated:{id}` server side, and the
client still sends no subscribe. Presence keeps its event and its store field.

## 14. Rules this plan reverses

- Velista `0055` section 4.2: "The basket is a snapshot and this is the one screen where
  the snapshot and the live list are both in front of somebody." There is no snapshot.
  `contributed` and `listQuantity` were two numbers for one fact, and the entry has one.
- Velista `0068` section 3: "Asked for… A snapshot: buying does not move it, only this
  sheet does, and a finished basket freezes it." `asked` is `bought + left` while the
  basket is open, and the server freezes it at the finish.
- Velista `0074`, introduction: "every line… is already in the store" still holds, and is
  now a statement about rows.
- Velista `0075` section 6: "Lines on no list yet are always shown." No such line exists.
  Section 8.2 states its successor.
- Velista `0077` section 4: a row under a list is drawn for an origin. It is drawn for an
  entry.
- Velista `0073` section 3.2: sending a line to a list from the sheet was "the only way
  an added line reaches a household". A line names its list when it is created (`0092`).

## 15. Not in this plan

- The `LIVE` surface, its route and the home card: `0091`.
- Skip, `NOT_AVAILABLE` against a skip, the composer with its list, the demand control,
  the product sent with a settle: `0092`.
- Drawing `mark` and `REMOVED`, the banner and the changes sheet: `0093`.
- Links, the join flow, people, presence by kind: `0094`.
- A price sent with a settle: `0095`.
- The e2e suites: `0096`.
- Renaming `GeneratedListSummary`, `GeneratedListStore` and `generated-list-api.ts`:
  backend `0144`'s client piece.
- The home card hearing a purchase the moment it happens. Today the owner's own room
  carries the settled line, and backend `0130` section 7 names no successor. The card
  reads again on entry and on resume until a backend plan says otherwise.

## 16. Tests

1. `toBasket` refuses a basket without `progress`, a row without `rowKey`, and a row with
   no entry unless it is `REMOVED`. Unknown kind, status and state take their fallbacks,
   and an unknown note and mark become `null`.
2. An entry's `listId` naming a list with no ref maps to `null`.
3. `basketRowsProgress` equals `basket.progress` on every fixture when nothing is filtered
   or grouped, and never counts a `REMOVED` row.
4. The `lists` filter keeps a row with one unserved entry, and drops a row whose served
   entries are all in lists that were filtered out.
5. Grouping by list draws a two entry row twice with each entry's numbers, puts unserved
   entries under one last heading, and is not offered when `lists` is empty.
6. `setLeft` below `from` sends a `BOUGHT` settle with the difference and `from`. Above
   `from` it sends a revert. Neither patches a number: the row on screen is the answer's.
7. A write answering `row: null` drops the row and takes the answer's counts.
8. `stale_quantity` reads again once and sets the notice.
9. `BasketSocket.reconnects` stays at zero on the first connect, moves on the second, and
   resets on `close()`.
10. A reconnect, a resume and a burst of three `basket.linesChanged` cause, respectively,
    one read, one read and one read, and an overtaken answer is dropped (`_generation`).
11. With no basket open, neither counter causes a read.
12. `rowFor` finds a row by its key, then by an entry's line id, then nothing. The sheet
    replaces its URL in the second case and dismisses with the notice in the third.
13. `BasketMemory` derives each state of backend `0130` section 4 in its order, and
    `asked = bought + left` on an open basket.
14. "Got them all" sends an explicit quantity. The entries pane sends `allocations` naming
    one line, and only for a served entry.
15. `routes.spec.ts`, `no-unguarded-history-back.spec.ts`, `token-hygiene.spec.ts`,
    `participant-token-never-travels.spec.ts` and
    `no-rxjs-interop-in-the-live-basket.spec.ts` stay green.

## 17. Acceptance criteria

- [ ] A basket is drawn from rows and entries, and no symbol of section 2 is left.
- [ ] Every number and every state on the screen is one the server sent.
- [ ] A row's sheet is addressed by `rowKey`, survives a re-key without a flicker, and
      closes with one sentence when its row leaves the basket.
- [ ] A basket left in a pocket is current a moment after the phone wakes, and a moment
      after its socket comes back.
- [ ] Every row write carries `from`, and every `BOUGHT` carries its quantity.
- [ ] A reader sees a list's name only for a list they were served, and one "Other lists"
      heading for the rest.
- [ ] The memory gateway and the HTTP gateway serve the same model.

## 18. Verification

```sh
npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-shopping-lists velista/feature-home velista/feature-shell
npx nx build velista
tools/dev/ng-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
tools/dev/ng-slot.sh --up --apps shell,velista
```

On the slot, against a backend with `0136`, at a phone viewport in both themes: open a
generated basket with a line two lists ask for, settle part of it from the row and the
rest from one entry, revert one unit, rename the row. Then lock the phone (or background
the tab), change the list from a second account, wake it, and watch the row move with no
tap. Give the slots back.
