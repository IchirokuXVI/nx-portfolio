# 0043 A product and its prices

> Third of the seven remodel plans. Needs `0041` (the frame) and `0042` (the "Chains" section,
> which this plan links to). Prerequisite reading: `0041`, `0033` (prices at every scope),
> `0035` (bulk work), `0036` (the category tree), backend `0080` (prices side by side).
>
> Mock: `plans/mocks/remodel/`, boards `Products`, `Product`, `Phone-Product` and
> `Phone-Info`, published at <https://claude.ai/artifact/KJTKDyRWfdJTL9PCUPwjQv>.

Products, product groups, categories, prices and price policies are five screens. The Prices
screen lists rows of one product at one scope with no product context, and its title on a row
is an id. Price policies are six fixed rows that have a screen of their own. To answer "what
does this product cost at each chain" the operator opens three screens.

This plan makes one "Products" section. A price is read in two places: on the product, by
chain and scope, and on the product list, as a column for one chosen scope. The Prices screen
goes away. Price policies become a tab named "Price rules".

## Brief for the agent

### Objective

Build the "Products" section: a product list that can show the price at one scope, a product
page with a Prices tab by chain and scope, and tabs for groups, categories and price rules.
Remove the Catalog section. Use the `nx-portfolio-angular-developer` skill.

### Context

- **Descriptors today**: `ITEMS`, `PRODUCT_GROUPS`, `CATEGORIES`, `PRICES` and
  `PRICE_POLICIES` in `libs/luna-shopper-admin/feature-catalog/src/lib/`.
- **Price pages today**: `item-prices-page.ts` (read only, every scope of one product, from
  `GET /v1/admin/catalog/items/{id}/prices`), `PriceDetailPage` (one product at one scope:
  the shown price, the rows behind it, remove), `PriceFormPage` (add a price, with the unit
  price proposal and `price-scope-notice`).
- **`CatalogItemScopePricesView`** already carries what the Prices tab needs: the scope, its
  kind and label, `rows[]`, `shownItemPriceId`, `shownBecause`, `stale`, `protectedUntil`.
- **Panels on the product editor**: `item-sections-panel` and `item-source-entries`.
- **Bulk panels**: `SetGroupPanel`, `SetCategoriesPanel`.

### Target state

1. **Section "Products"**, third on the rail. Tabs: Products (`/products`), Groups
   (`/products/groups`), Categories (`/products/categories`), Price rules
   (`/products/price-rules`). The three fixed words are routes declared before `:id`.
2. **Product list.** Search by name or barcode, a group filter, and sorting as today.
   - At 72 rem and above a category tree 236 px wide sits at the left: "All products", each
     top level category with its product count, its children on expand. A press filters the
     list. Below 72 rem the tree is a "Category" filter that opens a sheet with the same tree.
   - **"Prices at"** is a picker of one price scope (chain, then scope, each with its
     `ScopeMark`). The choice is kept in `localStorage` for the operator. With a scope chosen
     the list gains a Price column and a Seen column, and a row of states: Any price, Out of
     date, Not sold here. "No price" is added by backend plan `0187` (section 2).
   - A row shows the name and brand, size, barcode in the mono face, group, and with a scope
     the price or a state. On a phone a row is two lines: name and brand, then size and price.
   - Ticking rows shows a bar at the bottom with "Set group", "Set categories" and "Clear".
3. **Product page**, `/products/:id`, redirects to `details`. The header has a back link to
   the list, the name, the brand and size, the info button and "Edit product". At 72 rem and
   above a summary 300 px wide stays at the right on every tab: brand (a link to the brand),
   size, barcode, group (a link), categories. Tabs:
   - **Details**: the form of `ItemFormPage`, without the panels that became tabs.
   - **Prices**: one panel per chain that has a scope. A row is one scope: `ScopeMark`, label,
     the number of shops it covers, the source of the shown price, when it was seen, the unit
     price, the price, and the states "Out of date" and "Held until" a date. Opening a row
     shows every price behind it (source, run or person, date, price, state Shown, Ended or
     Too old), "Remove" on each row that can be removed, the sentence from `shownBecause`,
     and "Add a price here". A scope with no price says "No price yet" and offers the same
     action. "Add a price" in the tab opens the form with a chain and scope picker. The form
     is `PriceFormPage`, in a panel on a wide screen and a sheet on a phone.
   - **Where it is**: `item-sections-panel`.
   - **Sources**: `item-source-entries`, with its count on the tab.
4. **Groups tab**: the `PRODUCT_GROUPS` list. A group opens at `/products/groups/:id` with its
   form and the "Add items" block.
5. **Categories tab**: the two levels drawn as a tree, with the product count of each, a
   search field, and create, edit and delete as today. A press on a count opens the product
   list filtered by that category.
6. **Price rules tab**: the six rows of `PRICE_POLICIES` in rank order. A row shows the rank,
   the source name, "Out of date after N days" and a switch. A row opens its form in place.
   The form carries the caution from `0041`.
7. **The Prices screen is removed.** `/catalog/prices` redirects to `/products`.
   `/catalog/prices/:id` redirects to the Prices tab of its product with that scope open.
   The "Prices written" tab of a run stays, and each row links to the product's Prices tab.
8. **The Catalog section is removed.** `/catalog` redirects to `/`. The tiles and the chart of
   `CatalogDashboard` become a block of the Overview page. Every other `/catalog/...` address
   of these five screens redirects to its new place and keeps its query parameters.
9. **Texts.** Info of the list: "Tick products to set their group or categories together."
   "Choose a scope in Prices at to see what each product costs there." Info of the Prices
   tab: "One row is the price a shopper sees at one scope." "Open a row to see every price
   behind it." "A price typed in by an admin is held for seven days, then sources compete
   again." Info of Price rules: the three points on the `Phone-Info` board.

### Scope

- In: `feature-catalog` (new `products/` pages, the five descriptors, routes),
  `feature-dashboard` (the catalog block), `feature-harvest/run-page.ts` (links only),
  `apps/luna-shopper-admin/src/app/sections.ts`, `en.json`, specs. The two gateway changes
  that section 2 marks "In" (`itemIds` and "No category"), with the contract, the catalog
  service, `openapi.json` and the wire types.
- Out: chains (`0042`), the harvester (`0044`), how a shown price is chosen.

### Constraints

- Never write a price to `supermarket_items`, and never decide in the browser which source
  wins. The tab shows `shownItemPriceId` and `shownBecause` as the gateway gives them.
- Money stays a number on the wire and is formatted with `Intl.NumberFormat`.
- The list stays a `ResourceListPage`. The price column is a joined read for the ids of the
  loaded page, one request per page, never one request per row.
- The category tree and the "Prices at" picker are components in `ui` with no data access.
- The content language switch must clear the name caches of the tree as well as the list.
- Do not show a state filter that the gateway cannot answer.

### Action boundaries

- If you change a gateway route or DTO, run `luna-shopper-backend-gateway:openapi` and then
  `luna-shopper-admin/models:wire-types`, and commit both outputs.
- Do not change `price_policies` behavior or the sweep.
- Do not build any part of `0044`.

### Progress evidence

- `npx nx lint` and `npx nx test` for `luna-shopper-admin/feature-catalog`,
  `luna-shopper-admin/feature-dashboard`, `luna-shopper-admin/ui`, `luna-shopper-admin` and,
  when the gateway changed, `luna-shopper-backend-gateway` and `luna-shopper-backend-catalog`.
- `npx nx build luna-shopper-admin`.
- A spec for each redirect of targets 7 and 8.
- A browser walk on a slot with a priced catalog, at 390 px and 1360 px: filter by a category,
  choose a scope, open a product, open a scope row, add a price, remove it, set the group of
  three products, edit a price rule. Attach screenshots that match the four boards.

## 1. Not in this plan

- Registered brands stay with the harvester (`0044`). The product page links to a brand.
- Price history as a chart.

## 2. What the gateway does not serve yet

| The mock shows | Today | In this plan |
| --- | --- | --- |
| The price of every listed product at one scope | `GET /v3/admin/catalog/supermarket-items` filters by one `itemId` | **In.** Add `itemIds` (at most 100) to that route and to the catalog read behind it. |
| "Out of date" and "Not sold here" for a scope | The same route filters by `priceScopeId`, `stale` and `available`, and returns `itemName` | In, with no gateway change. With one of these states the list is read from that route. |
| "No price" for a scope | No route lists the products that lack a price at a scope | Out of this plan. Backend plan `0187` adds the filter and its count, and draws the state. Until it lands the state is not drawn. |
| "No category" in the tree | The `categoryId` filter does not take `none` | **In.** Give that filter `IsUuidOrNone` and a `withoutCategory` flag in the catalog search, as `productGroupId` has `withoutProductGroup`. |
| The counts on the Out of date and Not sold states | No count per scope | Out. The states carry no number. |

## 3. Decisions made

The owner settled these on 2026-10-03.

- **No Prices screen.** A price is reached through its product or through the list at a scope.
  "Every out of date price over every scope" stays a tile on the Overview.
- **Price rules sit under Products**, beside the prices they decide.
- **"No category" is part of this plan. "No price" is backend plan `0187`**, built after this
  one, because it is a new query on a large table and needs its own measurement.

## 4. What this plan deletes

- The `PRICES` descriptor as a list screen, `PriceDetailPage` as a page, and
  `item-prices-page.ts`. Their content is the Prices tab. `PriceFormPage` stays as the form.
- `CatalogDashboard` and the Catalog section with its `home`.
- The sections entries Products, Categories, Product groups, Prices and Price policies.
- `catalog.prices.note`, `catalog.prices.byItem.lead`, `catalog.pricePolicies.note`,
  `catalog.productGroups.addItems.lead`, and the link text "Prices at every scope".
- The two panels inside `ItemFormPage`, which are tabs now.
- The path constants of `catalog-sources.ts` that nothing imports after the move.
