# 0095: a history without baskets, and what it cost

> Backend halves: `apps/luna-shopper-backend/plans/0142` (what a person bought, with or
> without a basket) and `0143` (what was paid, recorded at the shelf). Both must be on `dev`
> first. Mock: none exists. The "Bought" tab of section 3 is a layout the product owner has
> not seen, and the action boundaries say to draw it first.
>
> The history is a list of baskets today, so a person who shops from the basket that is
> always there, or straight from a zone list, has an empty history, and nothing anywhere
> answers "what did I spend last week". Backend `0130` section 9 moves the history off
> baskets: a finished generated basket is a named trip, every other purchase is grouped
> into sessions by a six hour silence, and a purchase records the unit price the screen
> was showing. This plan draws that: a third tab on the shopping lists page, sessions on
> the zone list without the word "loose", a settle that says which price scope it was
> looking at and never a price, and the unit price on a line's own history.
>
> Prerequisite reading: backend `0130` (sections 3, 4, 9 and 11 points 5 and 11), backend
> `0142` and `0143`, velista `0085` section 5 (the tabs), `0088` in full (the zone list's
> groups), `0078` (prices from one shop), `0062` section 5.1 (a scope is not a location),
> and `libs/velista/feature-shopping-lists/src/lib/shopping-lists-page/`,
> `libs/velista/feature-lists/src/lib/select-trip-groups.ts`,
> `libs/velista/models/src/lib/compose-list-groups.ts`.

## Brief for the agent

### Objective

Add the "Bought" tab that reads a person's purchases as named trips and dated sessions
with what each cost, rename the zone list's loose trip to a session titled by its date,
fix the To buy rule of section 5, delete the `nowAsks` caption, send the price scope with
every settle, and show the unit price in a line's history.

### Context

- `ShoppingListsPage` (`shopping-lists-page.ts`) has two tabs through `lib-tabs`,
  `HistoryTab = 'mine' | 'shared'` (line 54), the chosen one in the `tab` query parameter,
  each with its own store and its own first page read when first on screen. Its copy is
  under `history.*`. Both tabs list **baskets**.
- The zone list draws trips (`select-trip-groups.ts`, `ui/src/lib/list/trip-group.ts`,
  `trip-row.ts`). `TRIP_KINDS = ['BASKET', 'LOOSE']` with fallback `LOOSE`
  (`models/src/lib/trips.ts`). `trip-group.ts` lines 51 to 58 print `list.trips.loose`,
  "Loose buys" / "Compras sueltas", through `list.trips.labelNamed`. `tripPathKind`
  answers `'basket' | 'loose'` for the rows route.
- `select-trip-groups.ts` lines 74 to 82 compute `nowAsks` under the comment "The basket
  holds a copy taken when it was composed. On a live trip this one sentence is all the
  page says about a difference." Velista `0088` section 5 promised the caption "until the
  improvements phase makes the basket follow the list". This series is that phase.
- `composeListGroups` (`compose-list-groups.ts` lines 104 to 165) leaves a line with
  `quantity === 0` and `boughtCount > 0` out of To buy, on the comment "A line at zero
  with purchases is in no live group: it lives in its trips." It never checks that a trip
  was loaded to hold it.
- A settle sends no price and no shop. `BasketSettleRequest` is
  `{ outcome, quantity?, allocations?, itemId? }` and `LineServiceI.settle(lineId, outcome,
  { quantity, itemId })` (`data-access/src/lib/lines/line-service.ts` line 133) is the
  list page's hand settle, called from `line-detail-sheet.ts` line 463.
- The basket row draws a price from `BasketViewStore.pricedShop` when a shop is chosen,
  else the product's cheapest offer across the basket's scopes (`basket-line-row.ts`).
  Every offer carries `priceScopeId` and `currency`. **The zone list page has no price
  scope and draws no price** (checked: nothing under `feature-lists` or
  `data-access/src/lib/lines` reads a scope), so the hand settle has nothing to send.
- `LineSettlement` (`models/src/lib/domain.ts` line 341) has no price. The line page's
  history rows are built in `feature-lists/src/lib/line-page/select-line-page.ts`.
- Backend `0142` serves `GET /v1/purchases/sessions` and the rows of one entry. Backend
  `0143` stores `pricePaidCents`, `pricePaidCurrency` and `priceScopeId` on a settlement, read by the
  gateway as the owner. A client never sends money (backend `0130` section 9).

### Target state

Sections 2 to 8 hold at a phone viewport in both themes, no screen prints "loose" or
"sueltas", no request from velista carries an amount of money, and
`npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-lists velista/feature-shopping-lists velista/feature-shell`
plus `npx nx build velista` are green.

### Scope

- Work only in: `libs/velista/models/src/lib/` (purchase models, `trips.ts`,
  `compose-list-groups.ts`, `basket-view.ts` for the settle request, `domain.ts` for the
  settlement), `libs/velista/data-access/src/lib/` (a `purchases/` folder: client, memory
  twin, mapper, store. The trip mapper and client. The settle calls of the basket and of
  lines), `libs/velista/ui/src/lib/` (a purchase entry row, `list/trip-group.ts`,
  `list/trip-row.ts`), `libs/velista/feature-shopping-lists/src/lib/shopping-lists-page/`
  and the settle call sites under `basket-page/`, `basket-line-row/` and `settle-sheet/`,
  `libs/velista/feature-lists/src/lib/` (`select-trip-groups.ts`, `line-page/`), and the
  two translation files.
- Do NOT touch: any backend project, the basket page's layout, the get list sheet, the
  zone list's To buy rows, `apps/velista-luna-e2e` (velista `0096`).

### Constraints

- Load the `nx-portfolio-angular-developer` skill, and the `design-taste-frontend` skill
  for the purchase entry and its rows.
- **Never a total that pretends to be complete.** An amount is always printed beside how
  many purchases had no price, when that number is above zero.
- **Never a price in a request.** The client names a scope. Assert it with a spec that
  scans the settle bodies.
- Money through `Intl.NumberFormat` with `style: 'currency'`, the currency the server
  served and the reader's locale. Dates through `Intl.DateTimeFormat`. Never `DatePipe`,
  never a hand built "12,40 €".
- Rule D4: purchases are mapped from `unknown` into models this scope owns, with a
  fallback kind. Rule D1: only the page injects the store.
- Zoneless components. Nothing a service provides imports `@angular/core/rxjs-interop`.
- Tokens only. Amber is not attention. `svh`, not `dvh`.
- `PurchaseStore` is provided where `SharedListStore` is. Route providers are never
  destroyed, so its socket listeners are removed by the page.
- The memory gateway twin is kept in step for purchases, for the renamed trip kind and
  for the settle bodies.
- Only make the changes this plan names.

### Action boundaries

- Proceed with in scope edits, specs and a slot against a backend with `0142` and `0143`.
- Stop and ask if either backend plan is not on `dev`, if the sessions read serves no
  currency beside an amount, if the wire still says `LOOSE` for a session and backend
  `0142` has no plan to change it, or before settling the layout of the "Bought" tab:
  draw it as a mock in `apps/velista/plans/mocks/purchases/` first and show the product
  owner.

### Progress evidence

Report after the purchase models and store, after the tab, after the zone list changes
with the `compose-list-groups` spec, after the settle bodies, and after the line history,
each with its spec run.

## 1. What is being built

| Piece                                             | Where                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `PurchaseEntry`, `PurchaseEntryRow`, their mapper | `models`, `data-access/src/lib/purchases/`                       |
| `PurchaseStore`: heads, rows on open, refetch     | `data-access/src/lib/purchases/`                                 |
| The "Bought" tab                                  | `shopping-lists-page.*`                                          |
| `lib-purchase-entry`                              | `libs/velista/ui/src/lib/history/` (or beside `shopping-list-row`) |
| `TripKind` `SESSION`, the label by date           | `models/trips.ts`, `trip-mappers.ts`, `trip-group.ts`            |
| `nowAsks` deleted                                 | `trips.ts`, `select-trip-groups.ts`, `trip-row.ts`               |
| The To buy rule fixed                             | `compose-list-groups.ts`                                         |
| `priceScopeId` on a settle                        | `basket-view.ts`, the basket settle call sites, the memory twin  |
| The unit price in a line's history                | `domain.ts`, the settlement mapper, `select-line-page.ts`        |
| Copy                                              | `en.json`, `es.json`                                             |

## 2. Models and data access

```ts
export const PURCHASE_ENTRY_KINDS = ['BASKET', 'SESSION'] as const;
export type PurchaseEntryKind = (typeof PURCHASE_ENTRY_KINDS)[number];
export const PURCHASE_ENTRY_KIND_FALLBACK: PurchaseEntryKind = 'SESSION';

export interface PurchaseSpend {
  /** The sum of unit price times quantity over the purchases that had a price. */
  readonly cents: number;
  readonly currency: string;
  /** Purchases with no recorded price. The amount above says nothing about them. */
  readonly unpricedCount: number;
}

export interface PurchaseEntry {
  /** A basket's id, or the id of a session's earliest purchase. */
  readonly id: string;
  readonly kind: PurchaseEntryKind;
  /** A finished basket's name. Null for a session and for an unnamed basket. */
  readonly name: string | null;
  readonly startedAt: Date;
  /** How many purchases the entry holds. */
  readonly purchaseCount: number;
  /** Null when no purchase of the entry had a price. */
  readonly spend: PurchaseSpend | null;
}

export interface PurchaseEntryRow {
  readonly id: string;
  /** Null when the reader can no longer read the list it was on (backend `0142`). */
  readonly content: string | null;
  readonly itemId: string | null;
  readonly quantity: number;
  readonly unitPriceCents: number | null;
  readonly currency: string | null;
  /** Served only for a list the reader can still read. */
  readonly listName: string | null;
}

export function purchaseEntryKey(entry: Pick<PurchaseEntry, 'kind' | 'id'>): string {
  return `${entry.kind}:${entry.id}`;
}
```

- The wire names are backend `0142`'s. The mapper reads them from `unknown`, refuses an
  entry with no id or no date, maps an unknown kind to `SESSION`, and treats an amount
  with no currency as **no amount** (`spend: null`), because an amount in no currency is
  a number that cannot be printed honestly.
- `PurchaseServiceI.sessions(cursor?)` is `GET /v1/purchases/sessions` and
  `PurchaseServiceI.rows(entry, cursor?)` is the rows read of one entry, under the path
  backend `0142` gives it. Both need an account. A guest has no history page.
- **`PurchaseStore`**: `entries`, `state`, `hasMore`, `loadFirst()`, `loadMore()`,
  `rowsOf(key)`, `open(key)`. Rows are read the first time an entry is opened and kept
  for the visit, every page of them, as `TripStore` does for a trip. Every read carries a
  generation counter, and an overtaken answer is dropped (velista `0086`).
- It refetches its first page, quietly and coalesced, on the account socket's
  `line.settled` for any list and on `generatedList.updated`, the two signals that can add
  or regroup a purchase. An entry whose id disappeared (a reverted purchase split a
  session) is dropped, the way `TripStore` drops a group.

## 3. The "Bought" tab

`HistoryTab` becomes `'mine' | 'shared' | 'bought'` and the tab list gains
`{ id: 'bought', labelKey: 'history.tabs.bought' }`, last. `tab=bought` in the query
string, so a reload and the back button keep it. "My lists" and "Shared lists" are
untouched: they are the baskets a person made and was given, which is what they always
were. The default tab stays "My lists", and its empty state gains one sentence pointing
at the third tab, because a person who never makes a basket lands on an empty first tab
with a full third one.

**An entry** (`lib-purchase-entry`), newest first:

- A disclosure: a real `button` with `aria-expanded` and `aria-controls` over a region,
  the pattern `lib-trip-group` already is. Reuse its fold (grid rows `0fr` to `1fr`,
  `inert` while closed, `--app-motion-slow`) by extracting nothing: copy the structure,
  because a trip group joins zone lines and this does not.
- **The label.** A `BASKET` entry with a name: "Saturday shop · 14 Sep". Without a name,
  and every `SESSION` entry: the date alone, through the same `Intl` date formatter
  `select-trip-groups.ts` uses (`dateFormatter`), moved to `models` if it is not already
  shareable. A session is never called anything.
- **The trailing edge**, two lines: "`n` bought", and under it the spend.
  - All priced: "12,40 €".
  - Some priced: "12,40 €" and, muted, "3 without a price".
  - None priced: no amount at all, and "No prices recorded".
- **Open**, the entry lists its rows: the text (or, when `content` is null, the product's
  name from the catalog store if `itemId` is held, else `history.bought.row.gone`), the
  quantity, and on the right the line amount, unit price times quantity, or a muted dash
  with the accessible text "no price". Under the text, muted, the list's name when served.
- **States**, the four the other tabs have: loading skeletons, failed with a retry, empty
  (`history.bought.empty`), and rows. Load more on scroll with the page's existing
  announcement per page loaded.
- An entry opens nothing else. A `BASKET` entry does **not** navigate to the basket: the
  "My lists" tab does that, and one row that both unfolds and navigates is two gestures
  fighting over one tap.

**No grand total.** The tab prints no "this month" sum. That is a different question with
a different read, and section 9 lists it as not built.

## 4. The zone list: a session, titled by its date

- `TRIP_KINDS` becomes `['BASKET', 'SESSION']` and the fallback `SESSION`. The trip
  mapper maps the wire's session value to `SESSION`, and tolerates `LOOSE` as the same
  thing, so the client does not break inside the window in which `dev` is not releasable
  (backend `0130` section 12).
- `tripPathKind` answers the segment backend `0142` serves for a session. If that is
  still `loose`, the function keeps returning it and **only** that function knows the
  word.
- `trip-group.ts`: the `vm.kind === 'LOOSE'` branch goes. A session takes the branch an
  unnamed basket already takes, `{{ vm.date }}`. The key `list.trips.loose` is deleted
  from both files. Velista `0088` section 2 said 'A loose trip is labelled "Loose buys"
  and its date', and its acceptance criterion 'Purchases made by hand appear under "Loose
  buys" and a date' becomes "under a date". Backend `0130` section 3: "The screen never
  says "loose"."
- Two groups with the same date are told apart by their count and, on a session row, by
  the buyer the row already names. `select-trip-groups.ts` adds the time of day to a
  session's date when another group of the list shares its calendar day
  (`Intl.DateTimeFormat` with `timeStyle: 'short'`), and only then.
- A session's head still counts its lines (`list.trips.lines`) and a basket's still
  counts "bought of total". A session row still names its buyer. Since backend `0134` the
  buyer of a purchase made through a basket is resolved through its participant, so a
  purchase from the basket that is always there names a person, which it did not before.
- **`nowAsks` goes.** Delete the field from `TripRowVm` (`models/src/lib/trips.ts` line
  110), the computation and its comment in `select-trip-groups.ts` lines 74 to 82, the
  `@if (vm.nowAsks !== null)` block in `trip-row.ts` lines 63 to 66, and the key
  `list.trips.row.nowAsks`. An open basket's `left` **is** the list's quantity now
  (backend `0130` section 4), so the two numbers the caption compared cannot differ, and
  a finished trip never drew it.

## 5. To buy no longer trusts a trip it has not seen

Today: a line with `quantity === 0 && boughtCount > 0` is dropped from To buy
unconditionally, on the belief that a trip group holds it. When the trips heads failed
to load (velista `0088` section 8: "A failed heads read leaves To buy fully usable"), or
before they arrive, no group holds it and the line is on **neither** side. It is
reachable only by a search somebody has to think of. The audit of 2026-09-19 found it,
and purchases that need no basket make it the common case and not the rare one.

The rule becomes:

- `ListGroupsInput` gains `readonly tripsReady: boolean`: true once a heads read has
  succeeded for this list, false while it is loading or failed. `ListPage` passes it from
  `TripStore`.
- A line at zero with purchases leaves To buy **only when** `tripsReady` and
  `input.live.length + input.past.length > 0`. Otherwise it is drawn with the lines at
  zero that were never bought, last in To buy, where it can be raised.
- Nothing else in `composeListGroups` changes. The claimed rule (a claimed line leaves
  only once a live trip's rows name it) is the same guarantee for the other half, and
  this makes the two halves agree: **no line is ever on neither side.**
- The doc comment at the top of the function is rewritten to say so, and the sentence "it
  lives in its trips" goes.

## 6. A settle names the scope it was looking at

```ts
export interface BasketSettleRequest {
  // …what velista 0090 leaves (outcome, quantity, from, itemId), plus:
  /** The price scope of the offer the row was drawing. Absent when it drew no price. */
  priceScopeId?: string;
}
```

- **Which scope.** Exactly the offer on screen: when `BasketViewStore.pricedShop()` is
  not null, that shop's scope. When it is null and the row drew the product's cheapest
  offer, that offer's `priceScopeId`. When the row drew no price (no pick, no offer),
  the field is absent. One function in `models`, `shownPriceScope(row, product, shop)`,
  is used by the row and by the request, so what is sent is what was drawn by
  construction.
- **Every basket settle sends it**: the row's status control, the reel that lowers
  `left`, and the settle sheet's three actions. A `NOT_AVAILABLE` settle sends none. A
  revert sends none.
- **Never an amount.** No `price`, `cents` or `amount` key exists on any settle body. The
  gateway reads the price, as the owner, at that scope (backend `0143`).
- A guest sends the scope too. Guests get chains and never shops (velista `0062` section
  5.1: "a scope is not a location"), and a scope id is what they already hold.
- **The list page's hand settle sends nothing new.** The zone list draws no price and
  holds no scope, so `LineServiceI.settle` and `line-detail-sheet.ts` are unchanged. A
  purchase made there is recorded with no price, and the "Bought" tab counts it under
  "without a price". That is honest, and it is the reason section 3 never prints an
  amount alone.

## 7. The unit price in a line's history

- `LineSettlement` gains `readonly unitPriceCents: number | null` and
  `readonly currency: string | null`, mapped from what backend `0143` serves on
  `LineSettlementView`, null when absent.
- `select-line-page.ts` `toSettlementRow` adds a formatted `price: string | null` to the
  row view model: unit price times quantity through `Intl.NumberFormat`, with the unit
  price in the accessible text when the quantity is above one ("3 at 1,15 € each").
  The line page and the line detail sheet draw it at the trailing edge of a `BOUGHT` row
  and draw nothing for a row with no price. A reverted row draws its price muted, as the
  rest of it is.

## 8. Copy

| Key                                | English                                   | Spanish                                        |
| ---------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `history.tabs.bought`              | Bought                                    | Comprado                                       |
| `history.empty.bodyBought`         | What you buy without making a list is under Bought. | Lo que compras sin crear una lista está en Comprado. |
| `history.bought.count_one`         | {{count}} bought                          | {{count}} comprado                             |
| `history.bought.count_other`       | {{count}} bought                          | {{count}} comprados                            |
| `history.bought.unpriced_one`      | {{count}} without a price                 | {{count}} sin precio                           |
| `history.bought.unpriced_other`    | {{count}} without a price                 | {{count}} sin precio                           |
| `history.bought.noPrices`          | No prices recorded                        | Sin precios registrados                        |
| `history.bought.empty`             | Nothing bought yet.                       | Todavía no has comprado nada.                  |
| `history.bought.loading`           | Loading what you bought                   | Cargando lo que has comprado                   |
| `history.bought.failed`            | We could not load what you bought         | No se ha podido cargar lo que has comprado     |
| `history.bought.row.gone`          | Something on a list you have left         | Algo de una lista en la que ya no estás        |
| `history.bought.row.noPrice`       | no price                                  | sin precio                                     |
| `history.bought.row.each`          | {{count}} at {{price}} each               | {{count}} a {{price}} cada uno                 |
| `history.bought.row.inList`        | in {{list}}                               | en {{list}}                                    |
| `history.announce.boughtLoaded_one`  | {{count}} more day of shopping loaded   | {{count}} día de compra más cargado            |
| `history.announce.boughtLoaded_other` | {{count}} more days of shopping loaded | {{count}} días de compra más cargados          |
| `list.history.each`                | {{count}} at {{price}} each               | {{count}} a {{price}} cada uno                 |

Deleted keys: `list.trips.loose`, `list.trips.row.nowAsks`. Put `list.history.each` where
the line page's other history keys live (find them before adding a sibling namespace).

## 9. Accessibility

- An entry's button is named by its label, then the count, then the spend in words, then
  "`n` without a price" when there are any. The amount is read as a currency by the
  screen reader because it is formatted text, not digits glued to a symbol.
- The closed region is `inert`. Opening does not move focus or the scroll position.
- A missing price is a muted dash for the eye and "no price" for the ear
  (`visually-hidden`, which velista `0082` made a shared class, not a global).
- The tab list keeps the roving `tabindex`, arrows, Home and End of velista `0085`
  section 5, with three tabs.

## 10. Realtime

Section 2's two signals, on the account socket the page already holds. Nothing new is
subscribed. A refetch is quiet: no skeleton once entries are on screen.

## 11. Not in this plan

- A sum for a week or a month, budgets, charts. The read of backend `0142` is per entry.
- Prices on the zone list page, and therefore a price on a hand settle.
- Editing or correcting a recorded price.
- Opening a finished basket from the "Bought" tab.
- The e2e journey for the history: velista `0096`.

## 12. Tests

1. The purchase mapper refuses a malformed entry and row, falls back to `SESSION`, and
   maps an amount with no currency to `spend: null`.
2. The tab: `tab=bought` survives a reload, the first page is read only when the tab is
   first on screen, and the four states draw.
3. An entry's label: named basket, unnamed basket and session, in both locales, through
   `Intl`. The string "Loose" appears nowhere in the built templates (a spec greps the
   two translation files for `loose` and `sueltas`).
4. Spend: all priced, some priced with the count beside the amount, none priced with no
   amount. The amount is `Intl.NumberFormat` output for `es` and `en`.
5. Rows are read once on first open and never again, a second page is read through, and
   an overtaken answer is dropped.
6. The trip mapper maps both the wire's session value and `LOOSE` to `SESSION`. A session
   group draws its date alone, and adds the time only when another group shares its day.
7. `nowAsks` is gone: the type has no field and the row draws no caption.
8. `composeListGroups`: with `tripsReady` false, a line at zero with purchases is last in
   To buy. With `tripsReady` true and no trip at all, the same. With `tripsReady` true and
   at least one trip, it is in neither To buy nor due. A claimed line's rule is unchanged.
9. `shownPriceScope`: the chosen shop's scope, the cheapest offer's scope, and absent.
   Every basket settle call site sends it, `NOT_AVAILABLE` and revert send none, and a
   spec that serializes every settle body asserts there is no key matching
   `/price|cents|amount/i` other than `priceScopeId`.
10. The line history draws a line amount on a priced `BOUGHT` row, nothing on an unpriced
    one, and the "each" text only above one unit.
11. `token-hygiene.spec.ts`, `no-unguarded-history-back.spec.ts` and `routes.spec.ts` stay
    green.

## 13. Acceptance criteria

- [ ] A person who has never made a basket sees what they bought, grouped by day of
      shopping, newest first.
- [ ] A finished named basket and a dated session sit in one list.
- [ ] Every amount says how many purchases it does not cover, and an entry with no priced
      purchase shows no amount.
- [ ] No screen says "Loose buys" or "Compras sueltas".
- [ ] The zone list never says "The list now asks for".
- [ ] A line at zero with purchases is never missing from the zone list page, whether or
      not the trips loaded.
- [ ] A basket settle names the price scope of the price on the row, and no request
      carries money.
- [ ] A line's history shows what each purchase cost when the server knows.

## 14. Verification

```sh
npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-lists velista/feature-shopping-lists velista/feature-shell
npx nx build velista
tools/dev/ng-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
tools/dev/ng-slot.sh --up --apps velista
```

On the slot, with a basket that has price scopes (memory note on the basket with price
scopes on slot 0: postal code 14013 and a Mercadona priced line): buy one line from the
basket with a shop chosen, one with none chosen, and one by hand from the zone list.
Check the "Bought" tab shows one session with an amount and "1 without a price", that
the zone list shows the same session under its date, and that the network panel shows
`priceScopeId` and no amount. Block the trips request in the browser and check the
bought line is still on the zone list page. Give the slots back.
