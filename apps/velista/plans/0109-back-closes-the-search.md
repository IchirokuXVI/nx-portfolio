> **PR:** [#486](https://github.com/IchirokuXVI/nx-portfolio/pull/486)

# 0109: back closes the search

On a zone list or a basket, the search icon opens a search field (`ListTools`). With the field
open, the phone's back button leaves the page. The user expects it to close the search, the
way it closes a sheet.

## The decision: the open search is a query parameter

The open state lives only in `ListTools` today (`_open`, a signal). The search term lives in
the view stores. Nothing is in the URL, so back has nothing to pop.

Opening the search pushes a router navigation that adds `?search=1`. Back pops it and the field
closes. This is the only mechanism that fits the history rules in CLAUDE.md:

- `AppHistory` counts entries from router events only. A raw `history.pushState` is not
  counted, and every back control after it then walks to its fallback.
- `no-unguarded-history-back.spec.ts` forbids `.back()` outside `page-navigation.ts` and
  `sheet-navigation.ts`, so a close handler goes through `PageNavigation`.

Only the open state goes into the URL, never the term. The term pushes an entry on every
keystroke.

## Brief for the agent

### Objective

Make the phone's back button close an open list search on the zone list page and on the basket
page, without leaving the page, and without breaking any other back control.

### Context

- `libs/velista/ui/src/lib/list/list-tools.{ts,html}`: `_open`, `openSearch()`, `close()`
  (emits `queryChange('')`, closes, returns focus to the search button), `clear()`. Cancel and
  Escape call `close()`.
- Its two users: `libs/velista/feature-lists/src/lib/list-page/list-page.html` (`fieldId="list-search"`)
  and `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.html`
  (`fieldId="basket-search"`). The terms live in `ListViewStore` and `BasketViewStore`
  (`search()`, `_query`).
- History: `libs/velista/platform/src/lib/app-history.ts` (a navigation is a push when it does
  not set `replaceUrl` and its URL differs, query included), `page-navigation.ts` (`back(fallbackUrl)`),
  `sheet-navigation.ts`.
- The list page also reads `?line=` (`lineQueryOf` in `platform/src/lib/route-params.ts`), so
  merge query parameters, never replace them.
- The filter button is inside the open search. Opening the filter sheet with `sheetSegments()`
  and `relativeTo` drops query parameters unless told to keep them.

### Target state

- `ListTools` takes `open` as an input and reports `openChange` (or two outputs with names
  that are not DOM event names, since `no-output-native` applies in `velista/ui`). It keeps its
  focus behavior: focus the field on open, focus the search button on close.
- The page owns the state: open means the route's query has `search=1`.
  - Opening navigates to the same page with `search=1` merged in, as a push.
  - The phone's back button pops that entry: the field closes and the term is cleared.
  - Cancel and Escape close through `PageNavigation.back(<the page URL without search>)`. On a
    cold load of a URL with `?search=1`, that falls back to a replace, so it never leaves the
    app.
  - Opening the filter sheet from the open search keeps `search=1`, so closing the sheet
    returns to the open search.
- The rest stays as it is: `clear()` empties the field and keeps it open, reordering on the
  list page still hides the tools, and leaving the page resets the term.
- If `?search=1` is present when the page loads, the field is open and empty.

### Scope

Work in `libs/velista/ui/src/lib/list/list-tools.*`, the search wiring in `list-page.{ts,html}`
and `basket-page.{ts,html}`, the filter sheet navigation on those two pages, `libs/velista/platform`
only if a small helper belongs there, and their specs.

Other agents edit `basket-page.{html,ts}` and `list-page.{html,ts}` at the same time (the
header, the composer dock, the product link). Touch only the search wiring and the filter
navigation.

### Constraints

- Use the `nx-portfolio-angular-developer` skill.
- `ListTools` is in `velista/ui`: plain values in, events out, no store, no router.
- Do not add a third file to `MAY_POP` in `no-unguarded-history-back.spec.ts`.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- putting the search term in the URL
- changing how sheets or pages go back
- changing `AppHistory`

### Progress evidence

- `npx nx run-many -t lint,test -p velista-ui velista-platform velista-feature-lists velista-feature-shopping-lists`
  green, and `npx nx build velista` green.
- Specs: opening pushes `search=1`, a popstate without it closes the field and clears the term,
  Cancel goes through `PageNavigation.back` with the URL without `search`, the filter sheet
  keeps the parameter, a cold load with `?search=1` opens the field.
- A Playwright check against slot 3: open a list, open the search, type, `page.goBack()`, and
  assert that the URL is still the list, the field is closed and every line is shown. A second
  `page.goBack()` leaves the list as before.
