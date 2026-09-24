# 0105: the home dock and the tab's basket

Three small fixes the user asked for after using the app on a phone. Two are on the home
page's dock and one is on the basket page's header. They share a theme: the basket tab in the
bottom bar is now the way into the current basket, so the home page and the basket page stop
repeating it.

## Brief for the agent

### Objective

Remove the live basket card ("Todo por comprar") from the home page, label the trip card under
it so a reader knows what the dated row is, and remove the back chevron from the basket the
bottom bar's basket tab opens.

### Context

- **The home dock** is at the end of `@case ('populated')` in
  `libs/velista/feature-home/src/lib/home-page/home-page.html`. It draws
  `<lib-live-basket-card>` and, under it, `<lib-shopping-list-card>` for
  `page.shoppingList`.
- **The live basket card** is `libs/velista/ui/src/lib/home/live-basket-card.{ts,html}`. The
  home page reads it from `LiveBasketStore` (`home-page.ts`, `_live`, `liveBasketLoading`,
  `openLiveBasket()`).
- **The trip card** is `libs/velista/ui/src/lib/home/shopping-list-card.{ts,html}`. It shows
  the newest ACTIVE generated basket (`selectShoppingList` in `select-home-state.ts`). Its
  title is the name the user typed or, when there is none, the generation date from
  `formatGeneratedDate` ("17 de septiembre"). Nothing on screen says what the row is.
- **The basket page** is `libs/velista/feature-shopping-lists/src/lib/basket-page/`. Its
  header draws the back chevron under `@if (canGoBack())` (`basket-page.html`, near the top,
  and `back()` in `basket-page.ts`). The live route (`shopping-lists/live`, `data.basket ===
  'live'`) and every generated basket (`shopping-lists/:basketId`) use this one component.
- **The basket tab** in `libs/velista/ui/src/lib/layout/app-nav.ts` links to
  `shopping-lists/current`. `BasketCurrentPage` redirects that, with `replaceUrl`, to
  `BasketListStore.active()[0]`, the newest active generated basket.
- Translations: `libs/velista/ui/assets/i18n/en.json` and `es.json`, the `home.shoppingList`
  block.

### Target state

1. The home page draws no live basket card, in any state. Every spec, input and store read
   that only existed to draw it on the home page goes with it. `LiveBasketStore` and the
   `shopping-lists/live` route stay: other screens use them.
2. The trip card carries a short label above its title: "Your recent trip" / "Tu compra
   reciente". The title keeps the typed name or the date. The label is part of the card's
   accessible name, so a screen reader hears what the row is before its date.
3. The basket page draws no back chevron when it shows:
   - the live basket (`shopping-lists/live`), or
   - the basket that `shopping-lists/current` resolves to, that is the basket whose id equals
     `BasketListStore.active()[0].id`.

   The bottom bar is on screen in both cases and its basket tab is lit, so the bar is the way
   out. Any other basket (an older one, opened from the history) keeps its chevron exactly as
   today.

### Scope

Work only in `libs/velista/feature-home`, `libs/velista/ui/src/lib/home`, the basket page's
header and its `back()`/`canGoBack()` logic in `libs/velista/feature-shopping-lists`, their
specs, and the two translation files.

Translation anchor: add the new key as the first key inside `home.shoppingList`. Do not
reorder other keys.

Other agents are editing `basket-page.{html,ts,scss}` at the same time (the composer dock,
the search tools, the product link). Touch only the header block and `canGoBack`, so that the
merge stays clean.

### Constraints

- Use the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- `live` is already a field name on `BasketPage` (the realtime connection state). Pick
  another name for the new flag.
- Copy is for people who are not at home with apps: short, ordinary words.
- Keep the label inside the existing card. Do not add a section heading to the home page.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- deleting `LiveBasketCard` or the live route if something outside the home page still uses
  them. Report what uses them instead.
- adding a new way into the live basket to replace the removed card. If removing the card
  leaves `shopping-lists/live` with no way in at all, say so in the PR body and leave it; the
  user decides.
- changing the chevron on any basket other than the two named above.

### Progress evidence

- `npx nx run-many -t lint,test -p velista-feature-home velista-ui velista-feature-shopping-lists`
  green, and `npx nx build velista` green (only `build` type checks templates).
- New or changed specs: the home page draws no live basket card, the trip card's accessible
  name starts with the label, and the basket page has no back button on the live route and on the
  current basket, and has one on an older basket.
- A browser check on the phone width (390 px) in Spanish and English: the home dock shows one
  card with its label, and the basket tab's page has no chevron.
