> **PR:** [#485](https://github.com/IchirokuXVI/nx-portfolio/pull/485)

# 0107: the product sheet over the list

The "Details" link on a suggestion card in the composer's typeahead opens
`/catalog/sheet/products/:itemId`. That leaves the list the user was adding to, switches the
bottom bar to the catalog tab, and closing the sheet lands on the catalog. The user wants the
sheet to open over the page they are on. A full product page will replace the sheet later, so
this plan only registers the existing sheet in more places.

## Brief for the agent

### Objective

Open the product sheet over the zone list page and over the basket page when "Details" is
pressed in their composers, and close it back onto the same page.

### Context

- The link: `libs/velista/ui/src/lib/list/suggestion-list.html` (`<a [routerLink]="link"
  class="details">`, `linkFor(card)` in `suggestion-list.ts`), fed by the `productLink` input
  that `LineComposer` passes through.
- The two builders of that URL:
  - `libs/velista/feature-lists/src/lib/list-page/list-page.ts` (`productLink`, built with
    `appPath(locale, basePath, 'catalog', ...sheetSegments('products', itemId))`), asserted by
    `list-page.spec.ts`
  - `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.ts` (the same URL,
    `null` for a GUEST)
- The route: `libs/velista/feature-shell/src/lib/routes.ts`, the `catalog` route's child
  `sheet({ path: 'products/:itemId', loadComponent: ... ProductSheet })`. Sheets are addressed
  under a `sheet` segment (CLAUDE.md). `listSheetRoutes()` and `basketSheetRoutes()` hold the
  sheets of the zone list page and of both basket routes (`shopping-lists/live` and
  `shopping-lists/:basketId`).
- The sheet: `libs/velista/feature-catalog/src/lib/product-sheet/product-sheet.ts`.
  - It reads `itemId` from its own route, so any parent works.
  - Its data comes from app wide services (`CATALOG_SERVICE`, `CATALOG_BROWSE_SERVICE`).
  - It injects `CatalogContext` optionally and falls back to its own context read, so it works
    without the catalog page.
  - The one coupling: `dismiss()` falls back to `appPath(locale, basePath, 'catalog')` on a
    cold load.

### Target state

- `productSheetRoutes()` (or a similarly named helper next to `sheet()` in `routes.ts`)
  returns the product sheet route, and the catalog route, `listSheetRoutes()` and
  `basketSheetRoutes()` all use it. The component stays in `feature-catalog`, loaded lazily as
  today.
- "Details" on the zone list page navigates to
  `<list page URL>/sheet/products/:itemId`, and on a basket to
  `<basket URL>/sheet/products/:itemId`. The bottom bar's lit tab does not change.
- Closing the sheet (cancel, scrim, Escape) returns to the page under it. On a cold load of
  that URL, the fallback is the covered page, not the catalog. Read the fallback the way the
  other sheets on those pages do (route `data`, or the covered page's URL), not from a literal
  in the component.
- On the catalog, the sheet behaves exactly as today.
- A GUEST on a shared basket still gets no "Details" link.
- The composer's typed text and open suggestions: check what happens to them when the sheet
  opens and closes. The list page is not destroyed by a child sheet route, so the text is expected to
  survive. Report it in the PR body either way, and do not build a mechanism to preserve it in
  this plan.

### Scope

Work in `libs/velista/feature-shell/src/lib/routes.ts` and `routes.spec.ts`, the product sheet
in `libs/velista/feature-catalog`, the `productLink` computeds in `list-page.ts` and
`basket-page.ts`, and their specs.

Other agents edit `basket-page.{html,ts}` and `list-page.{html,ts}` at the same time. Touch
only the `productLink` computed and its imports there.

### Constraints

- Use the `nx-portfolio-angular-developer` skill.
- Never write the `sheet` segment by hand: `sheet()` in the route table, `sheetSegments()` in
  callers.
- `routes.spec.ts` counts sheets and asserts the catalog product route. Update those counts
  honestly, do not loosen the assertions.
- Back controls follow "Going back never leaves the app" in CLAUDE.md.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- moving `ProductSheet` into another library
- registering the sheet under any page other than the catalog, the zone list and the baskets
- building the full product page

### Progress evidence

- `npx nx run-many -t lint,test -p velista-feature-shell velista-feature-catalog velista-feature-lists velista-feature-shopping-lists`
  green, and `npx nx build velista` green.
- Specs: the product sheet route exists under the list page and both basket routes, the list
  page and the basket page build the new URL, and the sheet's cold load fallback is the
  covered page.
- A browser check: type in a list's composer, press "Details", see the sheet over the list with
  the list tab still lit, press Escape, and land on the list.
