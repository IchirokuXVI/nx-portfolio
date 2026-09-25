> **PR:** [#512](https://github.com/IchirokuXVI/nx-portfolio/pull/512) (the zone list), [#513](https://github.com/IchirokuXVI/nx-portfolio/pull/513) (the basket)

# 0117: one field finds and adds

A zone list and the basket each have two ways to type: a search field in the tools row that
nobody opens, and the composer at the bottom that adds. Typing "Cheese" in the composer and
pressing the plus makes a second line beside "Cheese slices", because the typeahead's "already
in your list" block matches by product id and the server merges only an exact name. The user
decided on 2026-09-25 that the composer's field is the only search: typing shows the lines that
match first, then the catalog's products, in the list container, and the plus still adds the
words as written. The suggestion panel of plan `0101` is gone, the search row of plans `0074`,
`0082` and `0109` is gone, and the nav bar hides while the field has focus, so the results get
the whole page.

Plan `0116` lands first: it removes the basket's locked field, and a field that is locked
cannot search.

The mock is `plans/mocks/one-field/`, and the canvas is
https://claude.ai/artifact/3TQcq1qAQcF12We8s4a6pu. Six rules on it, F1 to F4 and the two
notes beside them, are the design.

## Brief for the agent

### Objective

On the zone list page and on the basket page, make the composer's field the search. While it
holds words, the list container shows the lines that match, then the catalog cards, and the
nav bar and the tools row are hidden. Remove the search row and the suggestion panel.

### Context

- **The search today** (plans `0074`, `0082`, `0109`): `ListTools` in
  `libs/velista/ui/src/lib/list/list-tools.{ts,html,scss}` (`query`, `open`, `queryChange`,
  `openFilter`), used by `libs/velista/feature-lists/src/lib/list-page/list-page.html` and
  `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.html`. The term lives in
  `ListViewStore` and `BasketViewStore` (`search(query)`, `query`, `searching`). The open state
  is `?search=1`, pushed and popped through `ListSearchNavigation` and `searchOpenOf` in
  `libs/velista/platform`. Matching is `foldForSearch`, `matchesBasketRow` and
  `basketMatchRange` in `libs/velista/models/src/lib/basket-search.ts`: the folded query in a
  line's name, any of its products' names, or any of its category labels, with the match
  drawn in `<mark>`. The list page draws "one flat search" instead of To buy and the trips
  while `searching`, and hides the tools row while reordering.
- **The composer** (`libs/velista/ui/src/lib/list/line-composer.{ts,html,scss}`): emits
  `queryChanged` on every keystroke, takes `suggestions`, `suggesting`, `suggestedFor`,
  `holdingsOf` and `productLink`, and hosts `<lib-suggestion-list>` above the field. The
  catalog is asked from the third character (plan `0043`, section 6). `submit()` emits
  `submitted` with the words and no `itemIds`. `choose()` emits it with the card's. After
  either, the field clears, the quantity resets and focus returns to the field.
- **The panel** (`suggestion-list.{ts,html,scss}`, plan `0101`): the cards, the group help
  popover, the `already` block with `lib-quantity-stepper`, the no results row of plan `0108`,
  the ARIA combobox with a grid popup, and the keyboard arithmetic:
  `--app-suggestions-max-height`, `--app-viewport` written from `window.visualViewport`, and
  `margin-top: auto` on the first child. Every control in it cancels `mousedown` (rule T2).
- **The nav** (plan `0097`): `AppNav` in `libs/velista/ui/src/lib/layout/`, shown by
  `NavChrome` in `libs/velista/platform/src/lib/nav-chrome.ts`: `visible = reserved() &&
  !sheetOpen()`, and `reserved` is what `AppLayout` keeps room for (`.nav-room`), so a sheet
  does not reflow the page under it. Plan `0106` made the nav and the composer dock two flex
  rows of the app column, no longer fixed or sticky.
- **The rows**: the zone list draws a line as a card row with a quantity chip, and the basket draws
  a row with the settle circle, the `from <list>` caption and the chip. Both already draw the
  `<mark>` on a match while searching.
- **History rules** (CLAUDE.md, plan `0109`): a push is a router navigation without
  `replaceUrl` whose URL differs. `AppHistory` counts those only. `.back()` is called only in
  `page-navigation.ts` and `sheet-navigation.ts`. The term never goes in the URL.
- Plan `0116` removed the basket's target chip and lock, so the field takes words without a
  list, and the plus and the cards open the list picker.

### Target state

1. **One field.** The composer's `queryChanged` drives the view store's `search(query)` from
   the first character and the catalog suggest from the third, on both pages. `ListTools`
   loses its search glyph, its open field, Cancel, `query`, `open` and `queryChange`, and keeps
   the count, the filter button and, on the zone list, the sort. The `basket.search.*` keys that
   only the search row used are gone. `ListSearchNavigation` and `searchOpenOf` stay, and the
   entry they manage now means "the field holds words" (rule F2).
2. **Results in the list container.** While the query is not empty, the list body (To buy, the
   trips, the chip row on the basket) is replaced by the results:
   - a heading "On your list · N" ("On your lists · N" on the basket), then the matching lines
     drawn by the same row the list uses, with their chip, their controls and the `<mark>`.
     When nothing matches, a sentence in the heading's place: "Nothing on your list says
     “que”" / "Nada en tu lista dice “que”", and the basket's plural. Said, never skipped.
   - from the third character, under a rule and a change of surface, a heading "From the
     catalog" and `<lib-suggestion-list>` with its cards unchanged, including the `already`
     block, the group help popover, the loading state and the no results row of plan `0108`.
   - The results container scrolls with the page, top anchored. The panel's keyboard
     arithmetic goes with the panel: `--app-suggestions-max-height`, `--app-viewport` and its
     writer, and the `margin-top: auto` anchoring.
   - When the first results appear, the page scrolls so the results heading sits under the app
     bar (the page head is above the fold while typing and comes back with the list).
3. **The chrome hides.** While the field has focus, or holds words, `NavChrome` reports the nav
   as neither visible nor reserved, so the page takes its room (the reflow is the point, unlike
   a sheet). The tools row is hidden while results show, the way the zone list hides it while
   reordering. The composer is the last row above the keyboard.
4. **Back clears the field** (rule F2). The first character pushes `search=1` through
   `ListSearchNavigation`. The phone's back button pops it, and the page clears the field and
   the term. Emptying the field by hand pops the entry through `PageNavigation.back(<the page
   URL>)`. Escape in the field does the same. A cold load with `?search=1` and an empty field
   replaces the parameter away. Nothing about sheets, `AppHistory` or `MAY_POP` changes.
5. **Adding in runs survives.** An add, from the plus or from a card, clears the field, the
   results go, the list returns with the new line, and focus stays in the field. On the basket
   the plus and the card's button open the picker of plan `0116` first.
6. **The rows act.** A found line's controls are live (the chip, the settle circle, the tap to
   the line page). Every control in the results, including those, cancels `mousedown` so the
   keyboard stays up (rule T2). The field is no longer a combobox with a grid popup: it is a
   search field that controls the results region (`role="searchbox"`, `aria-controls`), and the
   results heading is announced.
7. **Copy.** `list.add.placeholder` becomes "Add or find something" / "Añade o busca algo".
   The card and its labels do not change.
8. **The mic.** With voice on and the field empty, the button is still the microphone, and the
   recording strip is unchanged.

### Scope

Work in `list-page.{html,ts,scss}` and `basket-page.{html,ts,scss}` and their specs,
`list-tools.*`, `line-composer.*` and `suggestion-list.*` in `libs/velista/ui/src/lib/list/`,
`nav-chrome.ts` and `list-search-navigation` in `libs/velista/platform`, `ListViewStore` and
`BasketViewStore` only for the search's entry point, `libs/velista/ui/assets/i18n/{en,es}.json`,
and the specs of each.

Two pull requests are fine and preferred: the zone list page first, then the basket page
stacked on it. Each one deletes only what its page no longer uses, and `ListTools`'s search parts
go with the second.

Translation anchor: new keys for the two headings and the two "nothing says" sentences go in
the `list.add` block after `placeholder`, and the basket's plural forms in `basket.add`.

### Constraints

- Use the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- The card does not change. Its stylesheet is at the `anyComponentStyle` budget, so the results
  container's styles belong to the page, not to `suggestion-list.scss`.
- Nothing created per app imports `@angular/core/rxjs-interop` (CLAUDE.md).
- The term never goes in the URL. Only the open state does, as plan `0109` decided.
- `token-hygiene.spec.ts` rejects raw pixel values except `0px` and `1px`, and sizing is `100svh`.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- changing the card, the `already` block or the picker of plan `0116`
- hiding the page head or the app bar while typing
- changing `AppHistory`, `PageNavigation` or `SheetNavigation`
- changing how the server searches or suggests
- collapsing the two pull requests into one

### Progress evidence

- `npx nx run-many -t lint,test -p velista-ui velista-platform velista-models velista-feature-lists velista-feature-shopping-lists`
  green, and `npx nx build velista` green with no new budget warning.
- Specs:
  - one keystroke sets the store's query and pushes `search=1`
  - two characters show lines and no catalog section, three show both, lines first
  - the nothing sentence with no match
  - a popstate without `search=1` clears the field and shows the list
  - emptying the field goes through `PageNavigation.back`
  - the nav is not reserved while the field has focus
  - the tools row is absent while results show
  - an add clears the field and keeps focus
  - no search glyph in `ListTools`
- A Playwright check at 390 px against a slot with a list holding "Queso en lonchas": type
  "que" and assert the row is the first result with its mark, the nav is gone and the catalog
  heading is below the rows. Then `page.goBack()` and assert the field is empty, the list is
  back and the URL is still the list. Repeat on the basket. Screenshots of both typing states in the PR
  body.
