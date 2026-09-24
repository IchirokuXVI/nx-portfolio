# 0102: buying at one shop

> **Mock first.** Every velista page is mocked before it is built. There is no mock for this
> plan yet. The session that builds it draws `mocks/buying-at/` first (the filter sheet's
> "Buying at" fieldset in its three states, the locked fieldset, the unavailable mark on a
> row, the "Buying at" row of the get a list sheet, and the warning for a shop outside the
> person's areas), and stops for the user's review before any code.
>
> Backend half: `apps/luna-shopper-backend/plans/0163`, a basket names the shop it is bought
> at. Followed by `0103` (the picker that finds you) and `0104` (what you usually buy here).
>
> Prerequisite reading: `0076` (what the sheet remembers), `0078` (prices from one shop),
> `0091` section 7 (the shop is where the person is standing), `0092` (the shop had none),
> `0095` section 6 (a settle names the scope it showed), and backend `0163` in full.

"Prices from" becomes "Buying at". The person says which shop they are in, not only which
prices to show, and the app uses that answer three ways: it prices every row at that shop,
it marks the rows the shop is known not to have, and it records the shop on every purchase.

There is no trip entity and no "start trip" button on the LIVE basket. On the LIVE basket,
"Buying at" is a filter of this device, as `0091` section 7 decided. **Starting a trip at a
shop** means generating a list with a shop chosen in the get a list sheet: the shop is then
saved on that basket and fixed for everybody in it, owner and guests alike.

## Brief for the agent

### Objective

Rename "Prices from" to "Buying at", hold a shop (not only a scope) in the view state, price
rows and mark unavailable rows from the basket read at that shop, send the shop on every
settle made at a chosen shop, let the get a list sheet create a basket with a shop, and lock
the choice on such a basket.

### Context

- **The view state** is `BasketViewState` in `libs/velista/models/src/lib/compose-basket-view.ts`
  (around lines 39 to 60). `shop` holds a price scope id today. `BasketViewStore`
  (`libs/velista/data-access/src/lib/baskets/basket-view-store.ts`) sets it (`setShop`,
  around line 325) and names it (`chosenShop`, around lines 153 to 170). It is kept on the
  device for two hours (`basket-view-memory.ts`, around lines 72 to 78).
- **The picker** is `ShopPickerSheet`
  (`libs/velista/feature-shopping-lists/src/lib/shop-picker-sheet/shop-picker-sheet.ts`). It
  lists `basket.scopes[].locations` and, on a pick, keeps only `priceScopeId` (around lines
  336 to 350). The fieldset is in `filter-sheet/filter-sheet.html` (around lines 117 to 208).
  `ShopList` and `FranchiseButtons` are in `libs/velista/ui/src/lib/shops/`.
- **The pipeline** in `compose-basket-view.ts` prices, filters, orders, sinks the rows the
  chosen scope does not list (`sinkUnlisted`), and groups.
- **The settle body** is built in `libs/velista/models/src/lib/basket-view.ts` (around lines
  814 to 838, `shownPriceScope` around line 638) and sent by `BasketApi.settle`
  (`libs/velista/data-access/src/lib/baskets/basket-api.ts`, around lines 210 to 240) from the
  row, the reel and the settle sheet (`basket-page.ts` around lines 938 to 962 and 1033,
  `settle-sheet.ts` around lines 1014 to 1022). It never sends a shop today.
- **The get a list sheet** is `libs/velista/feature-home/src/lib/get-list-sheet/`. It sends
  `CreateBasketRequest` (`libs/velista/models/src/lib/basket-summary.ts`, around lines 126 to
  138) through `BasketListService.create`.
- **Copy** is `basket.view.shop.*` in `libs/velista/ui/assets/i18n/en.json` and `es.json`.
- **Rule D4**: map the new read fields (`shop`, `atShop`, `inProfile`) from `unknown` in the
  data access mappers into velista's own models. Never pass a backend DTO through.

### Target state

- The legend and the sheet title read "Buying at" and "Comprando en". The two options stay:
  any of your shops, or one shop.
- `BasketViewState.shop` holds a shop id. A stored value from before this plan is dropped on
  read, which costs at most one choice, because it expires in two hours anyway.
- On the LIVE basket, the basket read is requested with `locationId` when a shop is chosen.
- With a shop chosen, a row's price is its product's `atShop` price, the "not listed at"
  mark and the sink use `atShop` having no price, and "cheaper elsewhere" compares against
  `atShop`.
- A row is marked "Not available at this shop" / "No disponible en esta tienda" when every
  product it offers has `atShop.available` false. When the product the row buys by default is
  known unavailable but another option is not, the row suggests that option instead. Rows
  that are available or unknown are never marked. A marked row does not move.
- Every settle made while a shop is chosen sends `supermarketLocationId` and the
  `atShop.priceScopeId` of the product bought. In "any of your shops" mode, no shop is sent.
- The get a list sheet has a "Buying at" row, "Any of your shops" by default, that opens the
  picker. Generate sends `supermarketLocationId` when a shop is chosen. The shop can be changed
  as often as the person likes until Generate.
- On a basket with its own shop, the fieldset shows that shop, disabled, with the line "Set
  when this list was started" / "Fijada al empezar esta lista". Nobody can change it,
  including the owner. The LIVE basket is never locked.
- A shop outside the person's areas (`inProfile` false) carries the note "Outside your areas"
  / "Fuera de tus zonas" wherever it is named.
- A guest picks from the same shops the owner sees, and sees the locked shop on a locked
  basket.

### Scope

Work only in `libs/velista/models`, `libs/velista/data-access`, `libs/velista/ui`,
`libs/velista/feature-shopping-lists`, `libs/velista/feature-home` (the get a list sheet),
their specs and the two translation files.

Move the picker's list body into `libs/velista/ui/src/lib/shops/` so the get a list sheet
can use it. It stays in velista's `ui`, not in `@portfolio/shared/ui`, because it speaks
velista's vocabulary.

Do not touch: the backend, geolocation (`0103`), recent shops (`0103`), the usual filter
(`0104`), availability filters (backend backlog `0016`), order or grouping.

### Constraints

- Use the `nx-portfolio-angular-developer` skill for Angular conventions and
  `design-taste-frontend` for the fieldset and the marks, inside the design system of `0002`.
- **The server decides the price at a shop.** Do not pick a scope from the shop's scopes on
  the client. Read `atShop`.
- **"Any shop" sends no shop, ever.** The cheapest price's scope is not where the person
  stood.
- **The lock is the server's fact.** Draw it from `BasketView.shop`, never from local state.
- The copy for "Buying at" is exactly the user's: "Buying at", "Comprando en".
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- writing code before the mock is reviewed
- adding a way to change a basket's shop after Generate
- moving or hiding a row because it is marked unavailable
- remembering the shop for longer than `0076` does

### Progress evidence

After each step, state what was built and paste the output that proves it:

- Model specs: the pipeline with a shop prices from `atShop`, sinks rows with no price there,
  and marks a row unavailable only when every option is false.
- Data access specs: the settle body with a shop carries both ids, and without one carries
  neither. A stored scope id from before this plan is dropped.
- Component specs: the locked fieldset, the get a list sheet sending the shop.
- `npx nx build velista` and the affected lint and tests.
- A browser walk on a slot: choose a shop, buy a row, and read the settlement's shop back
  from the item history.
