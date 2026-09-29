> **PR:** [#534](https://github.com/IchirokuXVI/nx-portfolio/pull/534)

# 0124: one shop picker, and the Supermarket button

> Mock: `mocks/shop-picker/`, reviewed and approved on 2026-09-29, published at
> https://claude.ai/artifact/DbDzEKYhHZ6UdfuxAP1L9W. Read its notes before any code: they
> carry the decisions this plan builds.
>
> Needs backend `0170` (a logo and section names on every shop view, and
> `GET /v1/catalog/items?locationId=`). Prerequisite reading: `0100` (the catalog tab, rules C1
> and C3), `0078` section 4 and `0102` (the picker and Buying at), `0103` (Near me and Recent),
> `0059` section 3 (the supermarkets page, whose buttons this plan redraws), `0120` (a shop's
> sections) and the sheet and back rules in `CLAUDE.md`.

The catalog narrows to a chain with a row of text chips, and the basket asks which shop with
a picker whose chain buttons are small chips of their own. Two pickers that look almost alike
confuse people, so there is one. The catalog's chips become one **Supermarket** button that
opens the picker as a page of its own, where a chain is enough and a shop is optional, and the
picker everywhere gets big chain buttons with the chain's logo and shop rows that show the
shop's own name, its address and its sections.

## Brief for the agent

### Objective

Redraw `lib-shop-picker` and its parts in `libs/velista/ui/src/lib/shops/` to the mock, in
all four places that draw it, and replace the catalog tab's `lib-chain-chips` with a
Supermarket button that opens a routed picker page and keeps the choice in the catalog's URL.
Use the `nx-portfolio-angular-developer` skill, and `design-taste-frontend` for the buttons,
the row and the section chips.

### Context

- **The picker body**: `ShopPicker` (`shop-picker.ts`, `.html`) draws, top to bottom, the
  Near me answer, Recent, the search, `FranchiseButtons`, then either the matches or the open
  chain's groups below the buttons. `ShopList` (`shop-list.ts`) draws a `<label class="row">`
  per shop around a radio. `shop-rows.ts` builds rows (`shopRowOf`, `nearbyShopRow`,
  `recentShopRow`). `NearMeButton` sits in each host's title row.
- **Its four hosts**:
  - `ShopPickerSheet` (`feature-shopping-lists/src/lib/shop-picker-sheet/`), route
    `sheet({ path: 'filter/shop' })` (`feature-shell/src/lib/routes.ts:316-322`). Shops from
    `BasketViewStore.priceScopes()`, chains built locally at `:256-276` and keyed by
    `chainKeyOf(scope)`, a name string (`:482`), search local with `foldForSearch`.
  - `GetListShopPane` (`feature-home/src/lib/get-list-sheet/`) and `BoughtShopPane`
    (`feature-lists/src/lib/line-detail-sheet/`): `ShopStore` over the profile, chains keyed by
    `supermarketId` (or `OTHER_CHAINS`), search through `ShopStore.search()`.
  - All three read Near me and Recent through `ShopFinder`
    (`data-access/src/lib/shops/shop-finder.ts`).
- **The fourth user of the buttons**: the supermarkets page
  (`feature-account/src/lib/supermarkets-page/supermarkets-page.html:120-124`) draws
  `FranchiseButtons` with the two exclusion states and `ShopList` in `exclude` mode.
- **The catalog**: `CatalogPage` holds the chain in a component signal
  (`catalog-page.ts:158`), **not** in the URL (only `?category=` is). `chips()` (`:184-190`)
  comes from `CatalogContext` (`catalog-context.ts`), whose mapper `toCatalogBrowseContext`
  (`data-access/src/lib/mapping/catalog-browse-mappers.ts:127-139`) drops `logoUrl`.
  `_request()` (`:540-557`) sends `soldBy` and the chain's scopes. Route `catalog`
  (`routes.ts:1013-1020`) with the product sheet as a child. `catalog/categories` and
  `catalog/categories/:parentSlug` are sibling pages, for the reason at `:1027-1030`.
- **Models** (rule D4, mapped from `unknown`): `BasketShop` (`models/src/lib/basket-view.ts:448`),
  `NearbyShop` and `RecentShop` (`nearby-shops.ts`), `FranchiseButton` (`shop.ts:113`),
  `ShopChainSummary` (`shop.ts:54`), `CatalogChain` (`catalog-browse.ts:129`). No model carries
  a logo or a shop's sections.
- **Copy**: `libs/velista/ui/assets/i18n/en.json` and `es.json`: `catalog.chips.*`,
  `catalog.chain.shops`, `shops.*`, `basket.view.shop.*`.
- **The e2e**: `apps/velista-luna-e2e/src/shop.spec.ts:170-195` and `aisles.spec.ts:109-131`
  click `lib-franchise-buttons button` with the text Mercadona, then `label.row` with Colón.
  No spec clicks the catalog chips.

### Target state

1. **Models.** `logoUrl: string | null` on `BasketShop`, `FranchiseButton`, `ShopChainSummary`
   and `CatalogChain`, and `sections: readonly ShopSectionName[]` (`{ id, name: LocalizedName }`)
   on `BasketShop` and `Shop`, mapped in the existing mappers from backend `0170`'s fields.
   The basket's chains key by `supermarketId`, which `PriceScopeChainView` carries, and
   `chainKeyOf` goes.
2. **The chain button.** `FranchiseButtons` becomes the mock's grid: two columns, a 108px
   button, the logo at 48px, the name and the shop count under it, a chevron, and a tick on
   the chosen one. The logo is a `ChainLogo` component in `velista/ui` drawing `logoUrl`, else
   the chain's initial in the app's colours (the typeahead's chain mark, bigger), else the
   store glyph for Other. Sizes 32, 36, 48 and 56 as tokens. The two exclusion states stay,
   drawn on the new button, for the supermarkets page.
3. **The row.** `ShopList` in `pick` mode draws the mock's row, left to right:
   - the logo where the chains are mixed (Near you, Recent, a search), and none inside one chain
   - the shop's own name as the title when it has one, else its street
   - under it the chain and the address, or the chain and the town when the street is the title
   - the aside (a day, or a distance drawn strongly) at the end of the title line
   - the radio at the right

   `<label class="row">` stays the target and stays the class, so the e2e selectors hold. `exclude` mode keeps today's row.
4. **The sections.** A `SectionChips` component in `velista/ui` under the row's label, never
   inside it, so a tap on it never picks the shop. One line of chips in the shop's order.
   **`+X` counts only what is not drawn**: nine sections with five drawn is `+4`. The count is
   measured with a `ResizeObserver` on the line, never a fixed number. `+X` is a button named
   "Show all 9 sections". Pressed, the chips wrap and end in "Show fewer". The open state is
   the row's own and resets when the list changes. A shop with no sections draws no line.
5. **The picker body.** `ShopPicker` keeps Near me, Recent and the search at the root, then the
   grid. **While the search holds something, the grid is hidden** and the matches take its
   place, and the grid returns when the field is empty. A chosen chain replaces the whole root
   with that chain's groups, and the host draws the chain's head (see 7 and 8). A new optional
   input draws one "any" row at the top of the root and one at the top of a chain, with words
   the host passes, and a new output reports it.
6. **Recent is the usual shops.** No new section: Recent (`0103`) is what the brief calls the
   usual shops.
7. **The three sheets.** A chosen chain opens inside the sheet: the title row shows a back
   chevron, the chain's logo at 32px and its name, and hides Near me. Back returns to the root
   and never leaves the sheet. Nothing else about those sheets changes, and none of them draws
   an any row: Buying at is a door, and Any of your shops stays in the filter sheet.
8. **The catalog.**
   - `lib-chain-chips` goes from the page (and the component, if nothing else uses it). In its
     place, under the search, the mock's **Supermarket** button: the logo, the word
     SUPERMARKET, then All supermarkets, or Mercadona · any shop, or Mercadona · Calle Mayor 3.
     With a choice, the chevron becomes an x button that goes back to every supermarket.
   - The choice moves into the URL: `?chain=<supermarketId>` and `?shop=<locationId>` (a shop
     also sets its chain), beside `?category=`, and the page reads them on every navigation. The
     product sheet carries them like it carries the category.
   - A picker page, `CatalogSupermarketPage` in `feature-catalog`, at `catalog/supermarket` and
     `catalog/supermarket/:supermarketId`, siblings of the catalog like the category pages. The
     root draws the any row All supermarkets, then the body. A chain draws the mock's head (the
     logo at 56px, the name, the count), then Any Mercadona shop, then its groups. Shops come
     from `ShopStore` over the default profile, refused chains out and states forced to none,
     as `GetListShopPane` does. Near me uses `ShopFinder.nearProfile`, and its candidates sit
     above the any row.
   - A pick, an any row, or a Near me pick navigates to the catalog with the choice in the URL
     and **replaces** the picker's entry, so back from the catalog does not reopen the picker.
     The chevron uses `PageNavigation.back(fallbackUrl)` with the catalog as the fallback.
   - With a chain, the read is today's. With a shop, the read sends `locationId` (backend
     `0170`) and no scopes, the note under the button reads "Prices at Calle Mayor 3, Córdoba",
     and a product with no price there reads "No price" over "not priced here". The shop's
     words come from `GET /v1/catalog/locations/:id`.
9. **Copy**, en and es, every string a key: Supermarket, All supermarkets, Every product from
   every chain, Any {{chain}} shop, Every {{chain}} product, {{count}} shops in your areas,
   Prices at {{shop}}, not priced here, Show all {{count}} sections, Show fewer, Show every
   supermarket (the x's label). The old `catalog.chips.*` keys go.
10. **The e2e.** `shop.spec.ts` and `aisles.spec.ts` keep passing. A new case in
    `catalog.spec.ts`: open the Supermarket button, choose Mercadona, see only Mercadona's
    products and the URL's `chain`, go back to every supermarket with the x, then choose one
    shop and see the "Prices at" note.

### Scope

Work in `libs/velista/models` (the fields and their specs), `libs/velista/data-access` (the
mappers and their specs), `libs/velista/ui/src/lib/shops/` and a new `ChainLogo` and
`SectionChips` there, `libs/velista/ui/src/lib/catalog/` (removing `chain-chips` if unused),
`libs/velista/feature-catalog` (the page, its new sibling page, their specs),
`libs/velista/feature-shell/src/lib/routes.ts` (the two routes), the three sheet hosts
(`shop-picker-sheet`, `get-list-shop-pane`, `bought-shop-pane`), the supermarkets page only as
far as the new buttons reach it, the locale files and the three e2e specs.

Do not touch: Buying at's rules, the filter sheet's Any of your shops, the pick message,
`ShopFinder`'s decisions, the basket's aisle grouping, or any backend code.

### Constraints

- Rule D4 for every new field. `catalogName`, never `inLocale`, for chain and section names.
- No `@angular/core/rxjs-interop`. Zoneless, `OnPush`, signals.
- Raw pixels only as tokens (`token-hygiene.spec.ts`). `100svh`, never `dvh`.
- Outputs are never named like DOM events (`chosen`, `toggled`, not `select`, `toggle`).
- A `<label>` never wraps a button. The chips are the row's sibling.
- Icons come from `libs/shared/ui` or the existing velista icon set, and the store glyph is
  added there if missing, never inlined.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding a search or Near me to a chain's screen, remembering the catalog's
choice across visits, giving the basket an any row, drawing a chain colour that the wire does
not send, changing `ShopFinder`'s pick rule, or deleting a locale key some other screen reads.

### Progress evidence

Per target, the files changed and the spec run, including a spec of `SectionChips` that stubs
the measured widths and asserts `+4` for nine sections with five drawn. At the end:
`npx nx test` and `npx nx lint` for every touched library, `npx nx build velista`, the three
e2e specs against a slot serving backend `0170`, and a walk at 390 by 844 on Day through the
catalog, the Buying at sheet and the get a list sheet, compared with the mock's artboards.

## 1. Why the catalog's picker is a page and the basket's is a sheet

The catalog is a tab, and a choice there changes the whole tab, so its picker is a page with a
URL that back leaves. Buying at is one question inside the filter sheet, and a page there takes
the person away from the basket they are filtering. The body is one component, so the two
cannot drift: only the frame differs.

## 2. Why a chain opens on its own screen

Six buttons of 108px fill the screen. Opening a chain's shops under them, as the small chips
did, pushes the shops below the fold, and the person sees no change after a tap.

## 3. Not in this plan

- Filling in the chains' logos: an operator sets them in the back office, and the initial is
  drawn until then (backend `0170` section 3).
- Availability at a shop in the catalog.
- The chain page's own search, and Near me inside a chain.
