# 0091: the basket that is always there

> Needs velista `0090`. Backend half: `apps/luna-shopper-backend/plans/0136`, which serves
> `GET /v1/baskets/live`, and `0133`, which gives a basket its `kind`. The record of the
> series is backend `0130`. **No mock exists.** The screen is the basket page that already
> exists, with the differences of section 3, and one new card on the dashboard, described in
> section 5. The card is the one drawn thing here the product owner has not seen, and
> section "Action boundaries" says what to do about that.
>
> Until now a person had to make a basket before they were able to shop from one: pick the
> groups, pick the lists, name it, and finish it afterwards. Most trips are not that. Most
> trips are "what does anybody need", asked in a doorway. The `LIVE` basket answers it: one
> basket per person, created by the server the first time it is read, holding every line of
> every list that person can write, never finished and never named. This plan gives it a
> URL, draws it with the basket page, and puts it at the top of the dashboard. Generated
> baskets stay exactly where they are, for the trips that are planned.
>
> Prerequisite reading: backend `0130` sections 3, 4, 7 and 9, backend `0136`, velista
> `0090`, velista `0045` (the dashboard card and the history), `0057` (finish and reopen),
> `0074` and `0076` (the view store and what it remembers),
> `libs/velista/feature-shell/src/lib/routes.ts` lines 728 to 892, and
> `libs/velista/feature-home/src/lib/home-page/select-home-state.ts`.

## Brief for the agent

### Objective

Route `shopping-lists/live` to the basket page, open the caller's `LIVE` basket through
`GET /v1/baskets/live`, draw it with the differences of section 3, lead the dashboard with
a card for it, and keep it out of the history.

### Context

- The basket page is routed at `shopping-lists/:generatedListId` (`routes.ts:747`), guarded
  by `generatedListIdGuard`, which matches a UUID and nothing else
  (`libs/velista/feature-shell/src/lib/zone-guards.ts:180`). It carries no
  `authenticatedGuard`, because a guest reaches it by link. Its six sheets are children of
  that route, and `BasketSocket`, `BasketStore` and `BasketViewStore` are its providers.
- `BasketPage` reads the id from `paramMap.get('generatedListId')` (`basket-page.ts:179`),
  titles itself with the basket's name or its date (`:293`), and offers finish to the owner
  of an unfinished basket (`canFinish`, `:231`). Presence is `faces` (`:405`).
- `shopping-lists` (`routes.ts:885`) is the history, behind `authenticatedGuard`, with the
  get list sheet as its child.
- The dashboard builds one `ShoppingListCardVm` from the newest open basket and a count of
  the others (`select-home-state.ts`, `selectShoppingList`). Its store is the app scoped
  `GeneratedListStore`, loaded by `home-page.ts:399`.
- After velista `0090`, `Basket` carries `kind`, `progress` and `pending`, `BasketStore`
  has `open(basketId)`, and every sheet builds its URLs through `basket-paths.ts`.
- Backend `0130`: a `LIVE` basket has no name, is never finished, has a room and **no**
  presence room (section 7), is shareable like any basket (section 5), and its `bought`
  and its progress run over the current session only (section 4 and section 11,
  decision 5). A line bought in this session is still a covered line, so its row stays,
  `DONE`, until the session ends.

### Target state

Every acceptance criterion in section 12 holds.
`npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-shopping-lists velista/feature-home velista/feature-shell`
and `npx nx build velista` are green.

### Scope

- Work only in: `libs/velista/feature-shell/src/lib/routes.ts` and `routes.spec.ts`,
  `libs/velista/feature-shopping-lists/src/lib/` (`basket-paths.ts`, `basket-page/`, the
  sheets' URL building, `shopping-lists-page/`), `libs/velista/data-access/src/lib/
  generated-lists/` (`basket-service.ts`, `basket-api.ts`, `basket-memory.ts`,
  `basket-store.ts`, a new `live-basket-store.ts`), `libs/velista/models/src/lib/`
  (`home-view.ts`, `shopping-lists-view.ts`, `generated-list-view.ts`),
  `libs/velista/ui/src/lib/home/` (a new card), `libs/velista/feature-home/src/lib/
  home-page/`, and the two translation files.
- Do NOT touch: any backend project, the settle sheet's behaviour, the share and people
  sheets' behaviour (velista `0094`), `basket-view-memory.ts` (section 7 says why),
  `apps/velista-luna-e2e`, the navigation chrome. A tab for this screen is a decision
  nobody has taken.

### Constraints

- Load the `nx-portfolio-angular-developer` skill, and the `design-taste-frontend` skill
  for the card and for the header of the `LIVE` page.
- Rule D4 for the summary model. Rule D1: only a page injects stores.
- No page takes a `sheet` segment, and no sheet segment is written by hand.
- Every back control names a fallback: `PageNavigation.back(homeUrl)` from the `LIVE`
  page.
- Nothing a service provides imports `@angular/core/rxjs-interop`.
- One basket page. **No second component for the `LIVE` surface**, and no `@if (live)`
  scattered through the template either: the differences are one computed view model,
  `selectBasketSurface(basket, me)`, read by the template.
- Tokens only. Amber is not attention. `svh`, not `dvh`.
- Only make the changes this plan names.

### Action boundaries

- Proceed with in scope edits, specs and a slot.
- Stop and ask before adding a tab or any other entry in the navigation chrome.
- The dashboard card: build it as section 5 describes, take a screenshot at a phone
  viewport in both themes, and put both in the pull request. If the product owner asks
  for a mock first, it goes in `apps/velista/plans/mocks/live-basket/`.
- Stop and ask if `GET /v1/baskets/live` does not create the basket on first read, or
  answers anything other than the `Basket` of velista `0090`.

### Progress evidence

Report after the route and the store with their specs, after the page's surface model,
after the dashboard card, each with the run, and at the end with a slot session.

## 1. What is being built

| Piece                                              | Where                                                     |
| -------------------------------------------------- | --------------------------------------------------------- |
| `shopping-lists/live`, sharing the sheets           | `feature-shell` `routes.ts`                               |
| `BasketAddress`, URLs that work on both routes      | `feature-shopping-lists` `basket-paths.ts`                |
| `getLiveBasket`, `getLiveSummary`                   | `BasketServiceI`, `BasketApi`, `BasketMemory`             |
| `BasketStore.openLive()`                            | `data-access` `basket-store.ts`                           |
| `selectBasketSurface`: the page by kind             | `models` `basket-view.ts`, read by `basket-page`          |
| `LiveBasketStore`, `LiveBasketCardVm`               | `data-access`, `models` `home-view.ts`                    |
| `lib-live-basket-card`                              | `libs/velista/ui/src/lib/home/`                           |
| The history never lists it                          | `models` `shopping-lists-view.ts`                         |

## 2. The route

### 2.1 Why `shopping-lists/live`

The other candidate was the root of `shopping-lists`, with the history moved under it.
It loses on three counts. The history is an account screen with its own child sheet and
its own guard, and the basket page has six sheets and must stay reachable by a guest, so
one route cannot be both. Every link, test and bookmark to the history moves with it. And a
`LIVE` basket somebody **else** owns is opened by its id, from a link or from the shared
tab, so the page has to work at `shopping-lists/<uuid>` whatever this plan decides.
`shopping-lists/live` is an alias for "my own", one stable URL that is the same for every
person, which is what a dashboard card and an installed app's shortcut need.

### 2.2 The route table

```ts
function basketSheetRoutes(options: { finish: boolean }): Route[]
```

in `routes.ts`, returning the sheets that are today the children of
`shopping-lists/:generatedListId`: `rows/:rowKey/settle`, `people`, `share`, `filter/shop`,
`filter`, and `finish` only when asked. Each still goes through `sheet()`. Both basket
routes call it, so a sheet added later cannot exist on one and not the other.

```ts
{
  path: 'shopping-lists/live',
  canActivate: [authenticatedGuard],
  data: { basket: 'live' },
  loadComponent: () => import('@portfolio/velista/feature-shopping-lists').then((m) => m.BasketPage),
  providers: [BasketSocket, BasketStore, BasketViewStore],
  children: basketSheetRoutes({ finish: false }),
}
```

- Declared **before** `shopping-lists/:generatedListId`, by the house rule that the more
  specific path comes first. The UUID guard already declines `live`, so the order is a
  decision and not a rescue.
- `authenticatedGuard`, because a guest has no basket of their own. The id route stays
  unguarded.
- The path is a literal, as its neighbour's is, and `routes.spec.ts` asserts it against
  `BASKET_PATHS.live`.
- `routes.spec.ts` also asserts that both routes carry the same sheet paths apart from
  `finish`, that every one of them carries `sheetFallGuard`, and that `live` contains no
  `sheet` segment.

### 2.3 Addresses

```ts
/** Which basket a URL names: the caller's own LIVE one, or one by id. */
export type BasketAddress = 'live' | { readonly basketId: string };
```

- `BASKET_PATHS.live = 'shopping-lists/live'`.
- `basketPath(locale, basePath, address)`, and `settleSheetPath`, `filterSheetPath`,
  `shopPickerPath` and the people, share and finish paths all take a `BasketAddress`.
- `BasketStore.address: Signal<BasketAddress | null>`, set by `open` and `openLive`. A
  sheet builds its own URL and its dismiss fallback from it, and **never** from
  `paramMap`, which has no id under the `live` route. Today `filter-sheet.ts`,
  `finish-sheet.ts`, `people-sheet.ts`, `share-sheet.ts` and `settle-sheet.ts` each read
  the route. Each moves to the store.
- Requests always use `basket.id`. The address is about URLs and nothing else.

### 2.4 Opening

- `BasketPage` reads `route.snapshot.data['basket']`. `'live'` calls
  `BasketStore.openLive()`. Anything else keeps `open(paramMap.get('generatedListId'))`.
- `openLive()` calls `BasketServiceI.getLiveBasket()` (`GET /v1/baskets/live`), takes the
  id **from the answer**, sets `address` to `'live'`, and then connects the socket exactly
  as `open` does. The owner mints the participant token with their account bearer, as the
  owner of any basket does.
- A failed read draws the page's existing failed state with its retry. There is no
  network call in a guard: a guard that waits on a request is a white screen with nothing
  to retry.

## 3. One page, by kind

`selectBasketSurface(basket: Basket, me: BasketParticipant): BasketSurface`, pure, beside
the model, with a spec per row of this table. The template reads the surface and never
asks `kind` itself.

| Part of the page              | `GENERATED`                                   | `LIVE`                                                                   |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| Title                         | the name, else its date through `Intl`        | `basket.live.title` for the owner, `basket.live.titleOf` with the owner's name for anybody else |
| Subtitle                      | none                                          | `basket.live.hint`, once, under the title                                |
| Progress sentence             | `basket.progress` ("3 of 12 got")             | `basket.live.progress`: what is left, then what this trip got (section 4) |
| Finish entry, finish sheet    | the owner, while open                         | never. The route has no `finish` child                                   |
| "All done" prompt (`0057`)    | when `pending` is `0`                         | never. A basket that is never finished is never "done"                   |
| Finished banner and Reopen    | when not open                                 | never. The status is always `OPEN`                                       |
| Presence faces, person icon   | as today                                      | not drawn. The server has no presence room for it (backend `0130` section 7) |
| People and share entries      | the owner                                     | the owner. Both kinds are shareable                                      |
| Rows, reels, the settle sheet | velista `0090`                                | the same                                                                 |
| A row bought this trip        | `DONE`, with its revert, until the finish     | `DONE`, with its revert, until the session ends. Then it is not served   |
| Filter, order, grouping, shop | as today                                      | the same                                                                 |
| Empty state                   | `basket.empty`                                | `basket.live.empty` and `basket.live.emptyHint`                          |
| Back chevron fallback         | the history                                   | the dashboard                                                            |
| Unknown kind                  | the `LIVE` column, with the `GENERATED` title | (rule D4: the least capable surface)                                     |

- The owner's name for `titleOf` comes from the `OWNER` participant: `displayName`, else
  `username`. When neither is set the title is `basket.live.title`.
- A `DONE` row that stops being served arrives as a plain absence on the next read. It is
  not a removal and it gets no notice: the trip ended and the line is stocked.
- `BasketSocket` still connects for a `LIVE` basket, because `basket.linesChanged` and
  `basket.updated` arrive on it. `BasketStore.present` stays empty by itself.

## 4. The sentence on a basket that never ends

`basket.progress` of a `LIVE` basket runs over the current session (backend `0130`
section 4), so "3 of 40 got" is true and reads as a failure. The `LIVE` page says what is
left first, because that is the question the screen exists to answer:

- `pending > 0`, `done = 0`: "12 to buy".
- `pending > 0`, `done > 0`: "12 to buy, 3 got this trip".
- `pending = 0`, `done > 0`: "Nothing left, 3 got this trip".
- `unavailable > 0` appends the existing `basket.progressUnavailable` clause.

Every number is the server's. "This trip" is the session the server computed, by the six
hour gap and the server's clock, and the client never decides where one ends.

## 5. The dashboard

### 5.1 The card

`lib-live-basket-card` (`libs/velista/ui/src/lib/home/live-basket-card.*`), presentational,
one `button`-like link to `shopping-lists/live`:

- First line: `basket.live.title`, in the card title role `lib-shopping-list-card` uses.
- Second line: the sentence of section 4, from the summary.
- It is drawn **first** in the shopping list section, above the generated basket card,
  which keeps its "and N more" line and its behaviour.
- It is drawn for every authenticated person once the summary arrives, including at
  "Nothing to buy": the card is the way in, and a way in that disappears is a bug
  report. While the summary loads it holds a skeleton of its final height. A failed load
  draws the card with its title and no sentence, still tappable.
- A guest account (velista product rules: a guest is never shown register prompts) gets
  the card like anybody else.
- No presence, no date, no breakdown bar. It shares surface, radius and spacing tokens
  with `lib-shopping-list-card` and adds no literal colour.

### 5.2 The data

```ts
export interface LiveBasketSummary {
  readonly id: string;
  readonly progress: BasketProgress;
  readonly pending: number;
}
export interface LiveBasketCardVm {
  readonly sentence: { key: string; args: Record<string, number> };
  readonly unavailable: number;
}
```

- `BasketServiceI.getLiveSummary(): Promise<LiveBasketSummary>`. Backend `0136` names the
  read. If it serves a summary, `BasketApi` calls it. If it serves only the whole basket,
  `BasketApi` calls `GET /v1/baskets/live` and the mapper keeps the three fields and drops
  the rest. Either way the rest of the client sees one method.
- `LiveBasketStore`, app scoped, in `data-access/src/lib/generated-lists/`: `summary`,
  `state`, `load()`. It reads when the dashboard opens, again on `AppResumed.resumes`, and
  again on `generatedList.updated`. It holds the `_generation` guard every refetching
  store here holds. It writes nothing.
- `selectHomeState` gains `liveBasket: LiveBasketCardVm | null` beside `shoppingList`.
  `selectShoppingList` does not change.
- The card does not hear a purchase the moment it happens, for the reason velista `0090`
  section 15 gives. It is right on entry and on resume.

## 6. The history, and the get list sheet

- `GeneratedListSummary` and `SharedGeneratedListSummary` gain `kind: BasketKind`, mapped
  with its fallback.
- The server leaves `LIVE` baskets out of "mine". The selector behind
  `ShoppingListsPage` drops a `LIVE` row anyway, in one place, with a spec: a history
  that lists the basket that never ends, as a row with a date and a delete action, is the
  failure this guards against.
- The **shared** tab keeps a `LIVE` basket somebody shared with the reader. Its row is
  titled `basket.live.titleOf` with the owner's name, has no date badge and no "Finished"
  state, and opens `shopping-lists/<id>`.
- The dashboard's generated card and `otherActiveCount` count `GENERATED` baskets only.
- The get list sheet (`feature-home/src/lib/get-list-sheet/`) keeps its sources, its name
  and its people. It never drew the run's skipped lines, and velista `0090` deleted the
  model that carried them. Its action copy stays. Nothing about it says "make a basket to
  start shopping" any more, so check `home.action.*` for a sentence that does and change
  that sentence alone.

## 7. What the device remembers

`basket-view-memory.ts` does not change, and the brief for this plan asked for the
opposite, so the reasoning is written down.

- Velista `0076` keeps **one record per device**, not one per basket
  (`libs/velista/platform/src/lib/storage-keys.ts:39`): "The preference is the shopper's
  rather than this trip's". Order and grouping are how a person reads a list. The shop is
  where that person is standing. Neither is a fact about a basket, and with two surfaces
  that is more true, not less: somebody who picks Mercadona on the `LIVE` basket and then
  opens Saturday's generated one is still standing in Mercadona.
- The worry behind "one record per basket" is one basket's choice damaging the other's.
  It cannot. A remembered shop that a basket does not price is dropped from the **view**
  and kept in **storage** (`basket-view-store.ts`, `_pricesAt`), so opening a basket
  priced elsewhere forgets nothing.
- **The two hour expiry stays on the device clock**, and that is allowed where backend
  `0130` forbids it for marks. A mark decides whether a person is **told** that a line
  was removed or changed, it is shared by every device of that person, and a clock wrong
  by an hour hides information. The shop memory decides which radio starts selected. Its
  worst failure is asking "which shop" again, or not asking for an hour longer. It hides
  no row, it is read once when the basket loads, and no other device ever sees it. A
  convenience is allowed a device clock. A fact is not.
- `lists` stays never remembered (velista `0076` section 2). On a `LIVE` basket that
  matters more: it spans every household, and a filter left on from last week is a basket
  that looks half empty.

## 8. Copy

| Key                          | English                                        | Spanish                                                  |
| ---------------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| `basket.live.title`          | Everything to buy                              | Todo por comprar                                         |
| `basket.live.titleOf`        | {{name}}: everything to buy                    | {{name}}: todo por comprar                               |
| `basket.live.hint`           | Every list you can add to, in one place.       | Todas las listas en las que puedes añadir, en un sitio.  |
| `basket.live.left`           | {{pending}} to buy                             | {{pending}} por comprar                                  |
| `basket.live.leftAndGot`     | {{pending}} to buy, {{done}} got this trip     | {{pending}} por comprar, {{done}} en esta compra         |
| `basket.live.allGot`         | Nothing left, {{done}} got this trip           | No queda nada, {{done}} en esta compra                   |
| `basket.live.empty`          | Nothing to buy                                 | Nada por comprar                                         |
| `basket.live.emptyHint`      | Lines added to your lists show up here.        | Las líneas que se añadan a tus listas aparecen aquí.     |
| `home.liveBasket.open`       | Everything to buy, {{pending}} left            | Todo por comprar, quedan {{pending}}                     |

`home.liveBasket.open` is the card's accessible name. Plural forms follow what the
translator already does for `home.shoppingList.open`.

## 9. Accessibility

- The `LIVE` page's title is the page heading, and the hint under it is a paragraph, not
  part of the heading.
- The card is one link, named by `home.liveBasket.open`. Its skeleton is `aria-hidden` and
  the section announces nothing until the sentence is there.
- The sentence of section 4 is text, never a bar alone.
- Nothing announces a `DONE` row leaving at the end of a session.

## 10. Not in this plan

- Any entry in the navigation chrome.
- Skip, the composer, the demand control: `0092`. Marks and the banner: `0093`.
- The twelve hour link, the join flow and the people sheet by kind: `0094`.
- An installed app shortcut to `shopping-lists/live`.
- The dashboard hearing a purchase as it happens (velista `0090` section 15).

## 11. Tests

1. `routes.spec.ts`: `shopping-lists/live` sits before the id route, carries
   `authenticatedGuard`, has every sheet the id route has except `finish`, each under the
   `sheet` marker with `sheetFallGuard`, and its own path has no `sheet` segment.
2. `basketPath` and every sheet path build both forms from a `BasketAddress`, and a sheet
   under `live` dismisses to `…/shopping-lists/live`.
3. `openLive()` takes the id from the answer, sets `address` to `'live'`, connects the
   socket with that id, and a failed read lands in the failed state with no socket.
4. `selectBasketSurface`: one spec per row of section 3, plus the unknown kind.
5. The four sentences of section 4, and the unavailable clause.
6. The page under `live` never draws finish, the reopen banner, the "All done" prompt or
   a face, and does draw share and people for the owner.
7. `LiveBasketStore` reads on load, on a resume and on `generatedList.updated`, and drops
   an overtaken answer.
8. The dashboard draws the `LIVE` card first, keeps the generated card's count to
   `GENERATED` baskets, and draws the card at zero.
9. The history's selector drops a `LIVE` row from "mine" and titles one in "shared".
10. `basket-view-memory.spec.ts` and `basket-view-store.spec.ts` stay green untouched.
11. `no-unguarded-history-back.spec.ts` and `token-hygiene.spec.ts` stay green.

## 12. Acceptance criteria

- [ ] `…/shopping-lists/live` opens the caller's own basket, creating it on first visit,
      with no step before the rows.
- [ ] The same page draws both kinds, and the `LIVE` one has no name, no finish, no reopen
      and no faces.
- [ ] A line bought on this trip stays on the screen, done, with its revert.
- [ ] Every sheet works under both routes and dismisses to the route it was opened from.
- [ ] The dashboard leads with the `LIVE` basket, and the history never lists it.
- [ ] What the device remembers about the view is unchanged.

## 13. Verification

```sh
npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-shopping-lists velista/feature-home velista/feature-shell
npx nx build velista
tools/dev/ng-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
tools/dev/ng-slot.sh --up --apps shell,velista
```

On the slot, with an account in two groups: open the dashboard, tap the card, check that
lines of both groups are there with no creation step, settle one and see it stay as done,
open the filter and the shop sheets and dismiss each, reload on
`…/shopping-lists/live/sheet/filter` and dismiss, then make a generated basket and check
that both cards are on the dashboard and only one row is in the history. Both themes, a
phone viewport. Give the slots back.
