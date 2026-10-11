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

| The shopper | What is kept | The buy |
| --- | --- | --- |
| Presses a shop | The shop, as the filter keeps it | With that shop |
| Presses "No shop" | An answer for this trip, for 2 hours | With no shop |
| Presses "Don't ask again" | A flag on the device, under a new storage key, with no end | With no shop |
| Closes the sheet (the cross, the scrim, Escape, back) | An answer for this trip, for 2 hours | With no shop |

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
