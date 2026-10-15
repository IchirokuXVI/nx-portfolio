# 0141: the first buy asks where you are

> Asked for by the owner on 2026-10-11: "When you start buying, you will get a prompt
> telling you to select a shop. If the app has permissions, it will start searching for the
> place and tell the user Are you buying here? The user always has the option to not select
> any shop but prices will still be recorded (go with the cheapest one in this case)."
>
> His later points, in his words:
>
> - "The automatic shop discovery is only done if it's already enabled, otherwise the user
>   needs to click on near me or something like that, just like when you are picking a shop
>   from the filter."
> - "The shop selection on first buy has to re-use the existing component. The user can
>   also answer Don't ask anymore and it will be saved to his device. If the auto discovery
>   didn't work, just show the normal shop picker."
> - "Add a message for Are you buying here? At the bottom, with the Don't ask again, it
>   will tell you that you can select a shop from the basket filter."
>
> **The mock is the design.** It is `apps/velista/plans/mocks/basket-by-product/`
> (`BuyingHere.dc.html`), published at https://claude.ai/artifact/TNn8WVuoznc9Zsabozn9c7.
>
> **The record of a buy with no shop needs backend plan `0202`.** The prompt itself needs
> nothing new from the backend. If plan `0202` is not on your base branch, build the
> prompt, say plainly that a buy with no shop still records what it records today, and
> stop.
>
> Prerequisite reading: velista `0102` (buying at one shop), `0103` (the shop picker that
> finds you), `0124` (one shop picker), `0114` ("I bought it" asks the shop, on a zone
> list), `0095` (purchases and their sessions), backend `0202` section 2, `libs/velista/feature-shopping-lists/src/lib/shop-picker-sheet/`,
> `libs/velista/ui/src/lib/shops/`, `libs/velista/data-access/src/lib/shops/shop-finder.ts`,
> `libs/velista/data-access/src/lib/baskets/basket-view-memory.ts`, `basket-view-store.ts`,
> `libs/velista/platform/src/lib/geolocation-reader.ts`, `storage-keys.ts` and
> `libs/velista/feature-shopping-lists/src/lib/basket-paths.ts`.

A buy records its shop only when a shop is chosen in the filter, and nothing asks for one.
Most buys therefore name no place. This plan asks once, at the first buy of a trip.

## What the build decided

The build of 2026-10-15 settled the points below. Each one is a choice of the builder that
the owner can overturn. Backend `0202` was on the base branch, so a buy with no shop records
the cheapest price with no shop and no chain. The basket of the base branch had rows that
are products (`0139`), crossed out rows (`0142`), held product choices (`0140`, `0149`) and
patches from events (`0143`). Nothing that the context section names had moved: the paths,
`BasketViewMemory.location`, `BasketViewStore.settleShop` and `permission()` are where it
says.

**Where the pieces are.**

1. **The route is `sheet/shop`** over both basket routes, declared with `sheet()` after
   `sheet/filter`. It is `ShopPickerSheet` again, with `data: { shopAsk: true }`. The
   filter's own picker stays at `sheet/filter/shop` and never asks. `shopAskPath` and
   `SHOP_ASK_SEGMENTS` are in `basket-paths.ts`.
2. **The holder is `HeldBuy`**, provided by `BasketPage` beside `ChangeAcknowledger`, so the
   page, the settle sheet and the question reach one instance through the page's outlet. It
   holds the **write**, not its body. The body names the shop, so it is built when the
   answer releases it, and a shop chosen there is the shop the buy records. A second press
   while the sheet is open waits behind the first, and both are written in order.
3. **The settle sheet replaces itself with the question** (`leaveTo`), so one back gesture
   from the question lands on the basket, not on the settle sheet. "Got all" and "They had
   none" both ask. A held write reaches nothing of the destroyed sheet: a failure is the
   page's to show, as it is for the circle of a row. A settle never reports
   `skippedCount`, so the reopen that the circle has for a revert is not needed.
4. **The reel asks only when it buys.** A drag that takes units back names no shop, so it is
   written at once.
5. **The rule is `asksForShop` in `data-access`**, a pure function over four facts. The
   store reads them at the press and watches nothing: the shop of the view (which includes
   the basket's own shop), the lock, the device flag and the trip answer against now.
6. **The trip answer is `shopAnswered`** in `BasketViewMemory`, with the lifetime of
   `location` (one constant, `TRIP_MS`). "Don't ask again" is `StorageKeys.shopAskOff`,
   holding `'true'`, with no end.

**The sheet.**

7. **The look by itself selects the server's pick when it names a candidate, else the
   nearest.** The section says "the nearest". The pick is the nearest one that the server
   is sure of, so the two agree in the usual case.
8. **The title changes only once a shop is found.** While the look runs, the title is the
   plain "Buying at" over the loading rows of "Near you". A title that asked "Are you buying
   here?" and then went back to "Buying at" when nothing was found would say something that
   was not true for a moment.
9. **A look nobody pressed for draws no failure line.** No shop near, a refused position, a
   timeout and a failed read are all the plain picker, with Near me. The reason line of the
   server ("Several shops are close") is not drawn either: the title asks the question. A
   press on Near me is drawn exactly as in the filter, lines included.
10. **Near me pressed in the question chooses the server's pick and closes**, as in the filter,
    and writes the buy. It leaves no message, because the message is the filter sheet's and
    the question does not land on it.
11. **A press on the selected shop chooses it.** A checked radio fires no `change`, so
    `ShopList` and `ShopPicker` take a new input, `pickChecked`. Only the question sets it:
    on the filter's picker the checked shop is the one already chosen.
12. **"No shop" sits after "Near you" and before "Recent"**, as in the mock, as a card of its
    own with the store glyph. It is gone while a word is searched, like the recent shops.
    `ShopPicker` takes `offerNoShop` and emits `noShop`.
13. **The cross is at the end of the title row, and the root draws no chevron.** There is no
    filter to go back to. On a chain's screen the chevron still goes back to the chains.
14. **The foot is the sheet shell's footer**, which already draws the hairline and no
    container. The sentence is the plan's, word for word.
15. **Every way out answers.** The cross, the scrim and Escape go through `close()`. The back
    gesture only destroys the sheet, so its teardown records the trip answer and releases the
    buy when nothing else answered first. A buy is written once, whichever came first.
16. **A cold load of `sheet/shop` draws the question**, "No shop" and the foot included, and
    an answer there keeps what it keeps (the shop, the trip answer or the flag) and writes no
    buy, because none waits.

**Things the plan did not say.**

17. **A guest is asked too.** The plan excludes nobody, and a guest's buy records a shop like
    anybody's.
18. **A shop chosen in the question records no trip answer**, which is the table of section 3.
    So a shopper who chooses a shop and later sets the filter back to "Any of your shops" is
    asked again at the next buy of that trip.
19. **Reset in the filter forgets the trip answer**, because Reset writes an empty record. The
    question then comes back at the next buy. "Don't ask again" is a key of its own and Reset
    leaves it.
20. **The e2e suite sets "Don't ask again" in its setup**: `storageState` in
    `apps/velista-luna-e2e/playwright.config.ts`, and the same state stated in
    `newVisitor`. Its specs buy with no shop, and the question is the browser walk's to
    prove. The suite stays at 8 specs. The runner's `browser.newContext()` applies the
    config's storage state, so the walk passed an empty one to see the question.

**The browser walk.** At 390 pixels, in English and in Spanish, on a Luna slot with the
Valencia Colón shop given coordinates by SQL (the demo world has none) and a throwaway spec:
with location allowed, the question found Colón at 34 m, selected it, and one press chose it
and wrote the buy with the shop and the chain. With location not allowed, the plain picker
opened and the page made no position read at all. "No shop" wrote the buy with the cheapest
price and no shop or chain. The next buy of that trip did not ask. "Don't ask again" stopped
the question on the trip after. The filter still chose a shop.

## Brief for the agent

### Objective

Open the shop picker at the first buy of a trip with no shop chosen, find the shop by
itself when the device already allows location, and let the shopper answer with a shop,
with no shop, or with "Don't ask again".

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills.

### Context

Every statement below was read on `dev` at `6cced1bd`.

- **`ShopPickerSheet`** is the routed sheet `sheet/filter/shop`, opened from the filter
  sheet (`shopPickerPath` in `basket-paths.ts`). It has no inputs. `pickShop(locationId)`
  calls `BasketViewStore.setShop` and dismisses to the filter. `findNear()` runs "Near
  me".
- **`ShopPicker`** (`libs/velista/ui/src/lib/shops/shop-picker.ts`) is the presentational
  part: chains, groups, a search, `near`, `recent`, a `state` and the outputs `queried`,
  `chosen`, `picked`, `about`.
- **"Near me"** is `ShopFinder.find`, which reads `GEOLOCATION_READER` and then asks
  `POST /v1/baskets/:id/shops/nearby`.
- **The reader can say whether location is allowed without asking.**
  `BrowserGeolocationReader.permission()` wraps `navigator.permissions.query`. The setup
  flow and the location sheet of the account call it. The shop picker does not.
- **The chosen shop is remembered** in `BasketViewMemory.location` for 2 hours
  (`BASKET_VIEW_LIFETIME_MS`), under `StorageKeys.basketView`.
- **A basket started at a shop** has its own shop, and another one is refused
  (`basket_shop_locked`).
- **A buy sends `supermarketLocationId`** from `BasketViewStore.settleShop`, only when a
  shop is chosen.

### Target state

1. The first buy of a trip with no shop chosen opens the shop picker before the buy is
   written (section 1).
2. With location already allowed, the picker finds the shop and asks "Are you buying
   here?". Otherwise it is the plain picker (section 2).
3. The shopper can answer "No shop", and "Don't ask again" is kept on the device
   (section 3).
4. After any answer the buy is written, with the shop or with none (section 4).

### Scope

- `libs/velista/feature-shopping-lists`: the page (where a buy starts), the shop picker
  sheet in its asking mode, the buy that waits, their specs.
- `libs/velista/ui`: only what `ShopPicker` needs for the title, the "No shop" row and the
  foot. Add inputs, and do not fork the component.
- `libs/velista/data-access`: the memory of the answer for the trip, the key of "Don't ask
  again".
- `libs/velista/platform`: one storage key.
- `libs/velista/feature-shell`: one sheet route.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.

### Constraints

- **It is the shop picker of the filter**, with another title and a foot. The search, the
  chains, "Near me", the recent shops and the section chips are the same component.
- **The app never raises the permission dialog of the browser by itself.** It looks for
  the shop without a press only when `permission()` answers granted. A browser that cannot
  answer counts as not granted.
- **The buy is never lost.** Whatever the shopper does with the sheet, the buy that opened
  it is written.
- **Once for each trip.** After an answer the prompt does not return for 2 hours, the
  lifetime the chosen shop already has.
- **The mock decides the look.** The note and "Don't ask again" are at the foot, on a
  hairline, with no container.
- **Copy is for people not at home with apps.**

### Action boundaries

- Do not change the backend.
- Do not change what the filter does with a shop, or the 2 hours a shop is remembered.
- Do not ask on a basket that has its own shop, or when a shop is already chosen.
- Do not add a setting screen for "Don't ask again". The filter still chooses a shop, and
  the note says so.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/ui velista/data-access velista/feature-shopping-lists velista/feature-shell velista/platform`
  pass. `routes.spec.ts` passes.
- `npx nx e2e velista-luna-e2e` passes on a slot. Its specs buy with no shop, so they have
  to answer or dismiss the sheet, or set "Don't ask again" in their setup. Say which you
  chose.
- A browser walk at 390 pixels, in English and Spanish: with location allowed the shop is
  found and chosen in one press, with location not allowed the plain picker opens and no
  browser dialog appears, "No shop" writes the buy, "Don't ask again" stops the sheet on
  the next trip, and the filter still chooses a shop.

## 1. When it opens

A press that would write a buy (the circle of a row, the reel, the buttons of the row
sheet, "They had none") opens the sheet first when all of these are true:

- No shop is chosen in the view, and the basket has no shop of its own.
- The device does not hold "Don't ask again".
- No answer for this trip is remembered.

The buy waits in a small holder of the page. The route is a sheet under the shopping list,
declared with `sheet()`. A cold load of its URL with no buy waiting shows the picker, and
an answer there only chooses the shop.

## 2. The sheet

Artboard `BuyingHere.dc.html`.

- **Location already allowed**: the sheet opens with "Near you" loading, then the shops
  within the distance "Near me" uses. The nearest is selected, and the title is "Are you
  buying here?". A press on a shop chooses it, as in the filter.
- **Location not allowed, not known, or no shop found**: the plain picker, with its own
  title and its "Near me" button. A press on "Near me" asks the browser, as in the filter.
- **"No shop"** is a row of its own, where the filter has its row for every shop. Its
  second line is "The cheapest price is recorded".
- **The foot**: the sentence "You can also choose the shop from the filter of your
  shopping list.", then the text button "Don't ask again".

## 3. The answers

| The shopper                                           | What is kept                                               | The buy        |
| ----------------------------------------------------- | ---------------------------------------------------------- | -------------- |
| Presses a shop                                        | The shop, as the filter keeps it                           | With that shop |
| Presses "No shop"                                     | An answer for this trip, for 2 hours                       | With no shop   |
| Presses "Don't ask again"                             | A flag on the device, under a new storage key, with no end | With no shop   |
| Closes the sheet (the cross, the scrim, Escape, back) | An answer for this trip, for 2 hours                       | With no shop   |

- The answer for the trip is a new field of `BasketViewMemory` with the lifetime of
  `location`.
- "Don't ask again" is for the device and for every shopping list on it. Clearing the data
  of the app brings the question back.
- Choosing a shop regroups the list by the sections of that shop (plan `0138`). The row
  that was pressed is bought first, then the list regroups.

## 4. The buy with no shop

The page sends no shop. After backend plan `0202` the gateway records the cheapest price
with no shop and no chain. Before that plan a buy with no shop records what it does today.

## 5. Strings and tests

**Strings.** New keys under `basket.shopAsk` in both files: the title "Are you buying
here?", "No shop" and its second line, the sentence of the foot, "Don't ask again".

**Tests.**

- The rule of section 1 as a pure function: each of its three conditions, a basket with
  its own shop.
- The sheet: location granted finds and selects, not granted shows the plain picker and
  calls no position read, no shop found, a failed read.
- The four answers of section 3: what each keeps, and that the buy is written each time.
- The memory: the answer of a trip ends after its lifetime, the flag does not.
- A cold load of the route with no buy waiting.
- `routes.spec.ts`: the new sheet under the marker, and the count.

## 6. Not in this plan

A screen that turns the question back on, a prompt on the list page of a zone, and a shop
guessed from the last trip.
