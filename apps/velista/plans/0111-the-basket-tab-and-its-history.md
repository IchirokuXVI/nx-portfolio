# 0111: the basket tab and its history

The bottom bar's basket tab opens `shopping-lists/current`, which goes to the newest open
generated basket, or shows an empty screen when there is none. The live basket (plan `0091`,
"Todo por comprar") is reachable from nowhere since plan `0105` removed its home card. The user
decided how the three fit together:

- The tab opens the newest open shopping list, or the live basket when there is none.
- No basket page has a back chevron. Every basket has a history button instead.
- The history always shows the live basket first.

## Brief for the agent

### Objective

Make the basket tab always open a basket, replace every basket's back chevron with a history
button, and put the live basket at the top of the history.

### Context

- The tab: `libs/velista/ui/src/lib/layout/app-nav.ts` (`basketUrl`, `activeNavTab()`).
- The redirect: `libs/velista/feature-shopping-lists/src/lib/basket-current/basket-current.{ts,html}`,
  route `shopping-lists/current` in `libs/velista/feature-shell/src/lib/routes.ts`. It reads
  `BasketListStore.active()[0]` and otherwise draws an empty state with "Make my shopping list"
  and a history button (`ClockIcon`).
- The live basket: route `shopping-lists/live` (`data.basket === 'live'`, `BasketPage`),
  `LiveBasketStore` in `libs/velista/data-access`. The server creates it on first read
  (`ensure`), so every account has one. `BasketListStore` never holds it, because the server's
  `listMine` returns generated baskets only.
- The badge: an effect in `BasketListStore` writes `LiveBasketBadge` from `active()[0]`.
- The basket page header: `basket-page.html` (the `@if (canGoBack())` block), `canGoBack`,
  `_isTabBasket` (plan `0105`) and `back()` in `basket-page.ts`.
- The history: `libs/velista/feature-shopping-lists/src/lib/shopping-lists-page/`, route
  `shopping-lists`, tabs `mine` and `shared` by `?tab=`. `mine` filters out `LIVE`.
- The only history glyph is velista's `ClockIcon` (`libs/velista/ui/src/lib/icons/icons.ts`).

### Target state

1. **The tab.** `shopping-lists/current` redirects, with `replaceUrl`, to the newest open
   generated basket when there is one, and to `shopping-lists/live` when there is none. It never
   draws the empty state. While `BasketListStore` loads, it shows the existing loading state. On
   a load error it goes to the live basket rather than showing an error, because the live basket
   is always there.
2. **The badge** counts the pending lines of the basket the tab opens: the newest open generated
   basket, or the live basket when there is none (read the live summary from
   `LiveBasketStore`).
3. **No back chevron on any basket page**, live or generated, for every viewer kind. Remove
   `canGoBack`, `_isTabBasket` and `back()` if nothing else uses them.
4. **A history button** in the same header place, for OWNER and REGISTERED viewers: the clock
   icon, accessible name "History" / "Historial", navigating to `shopping-lists` (a push). A
   GUEST on a shared basket gets no button, because the history needs an account.
5. **The history's `mine` tab starts with the live basket**, always, above the generated
   baskets and outside their date ordering and paging. It is a row titled with
   `basket.live.title` and its pending count from the live summary, opening
   `shopping-lists/live`. It is shown also when the account has no generated basket, so the
   history's empty state becomes "the live basket row, then the empty message".
6. The "Make my shopping list" offer that lived in the removed empty state stays reachable. Check
   where else it is (the live basket page, home). If the empty state was its only entry, keep it
   as a button on the history page and say so in the PR.

### Scope

Work in `libs/velista/ui/src/lib/layout/app-nav.*`, `libs/velista/feature-shopping-lists`
(basket-current, the basket page header and its `canGoBack`/`back()` logic, the history page),
the badge effect in `libs/velista/data-access`, `routes.ts` only if a route changes, the two
translation files, and their specs.

Translation anchor: a new `basket.history` key goes in the top level `basket` block, after
`back` (remove `back` if it is no longer used).

Other agents edit `basket-page.{html,ts,scss}` at the same time (the composer dock and its
popover). Touch only the header block and the back logic there.

### Constraints

- Use the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- CLAUDE.md "Going back never leaves the app" still applies to every remaining back control.
- Keep `shopping-lists/current` as the tab's URL, so links and the tour keep working.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- deleting the `shopping-lists/current` route
- changing what the server returns from `listMine`
- showing a shared LIVE basket of another person differently in the `shared` tab

### Progress evidence

- `npx nx run-many -t lint,test -p velista/ui velista/feature-shopping-lists velista/data-access velista/feature-shell`
  green, and `npx nx build velista` green.
- Specs: the redirect with and without an open generated basket, the badge source in both
  cases, no chevron on the live and on a generated basket, the history button for OWNER and not
  for GUEST, the live row first in `mine` with and without generated baskets.
- A browser check on a new account (no generated basket: the tab opens the live basket) and
  after generating a list (the tab opens it), with the history showing the live row first.
