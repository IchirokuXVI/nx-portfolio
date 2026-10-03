# 0042 A chain holds its shops

> Second of the seven remodel plans. Needs `0041` (the frame, `PageHeader`, `PageTabs`,
> `InfoButton`, `ScopeMark`). Prerequisite reading: `0041`, `0037` (sections), `0028` (a shop
> priced at several scopes), `0040` (the map notice).
>
> Mock: `plans/mocks/remodel/`, boards `Main`, `Phone-Chain` and `Phone-Shop`, published at
> <https://claude.ai/artifact/KJTKDyRWfdJTL9PCUPwjQv>.

Supermarkets, shops, shop sections, price scopes and the products in a shop are five screens in
one flat row. Three of them cannot load until the operator picks a chain or a shop in a filter,
and each one opens with a paragraph that says so. The data already has a shape: a shop, a
section and a price scope each belong to one chain, and a shop product row belongs to one shop.

This plan makes that shape the navigation. A chain is a page. Its shops, its sections and its
price scopes are tabs of that page. A shop is a page inside the chain, and its section order
and its products are tabs of the shop.

## Brief for the agent

### Objective

Replace five catalog screens with one "Chains" section where a chain holds its shops, sections
and price scopes, and a shop holds its section order and its products. Use the
`nx-portfolio-angular-developer` skill.

### Context

- **Descriptors today**: `SUPERMARKETS`, `LOCATIONS`, `SECTIONS`, `PRICE_SCOPES` and
  `LOCATION_ITEMS` in `libs/luna-shopper-admin/feature-catalog/src/lib/`. `LOCATIONS`,
  `SECTIONS` and `LOCATION_ITEMS` use `requires`, and `collectionPath` with `pathParams`.
- **Panels that exist**: `chain-sections.ts` (the chain's sections), `location-sections.ts`
  (a shop's ordered list, with the map notice of `0040`), `price-scope-notice.ts`.
- **The gateway** lists shops under `/v1/admin/catalog/supermarkets/{id}/locations`, sections
  under `/supermarkets/{id}/sections`, scopes at `/price-scopes?supermarketId=`, and shop
  products at `/location-items?supermarketLocationId=`. All four fit a parent in the address.
- **A descriptor can already take a path parameter from a filter.** This plan lets it take
  one from the route.

### Target state

1. **Section "Chains"** replaces the catalog entries Supermarkets, Shops, Shop sections, Price
   scopes and Products in a shop. It sits second on the rail, after Overview.
2. **`/chains`**: the list of chains with a search field and "Add a chain". At 72 rem and
   above the list is a column 216 px wide that stays beside the open chain. Below that it is
   a page of its own, and a chain opens over it.
3. **`/chains/:chainId`** redirects to `shops`. The header shows the chain name, a state that
   says whether a harvester source exists and may be fetched (a link to Setup after `0044`),
   the info button and "Edit chain". Tabs: Shops, Sections, Price scopes, Details. Sections and
   Price scopes show their count. Shops shows a count only when the gateway gives one
   (section 2).
4. **Shops tab**, `/chains/:chainId/shops`: search by address, city or postal code, filters for
   the postal code source and for a price scope, and "Add a shop". A row shows the address,
   the city and postal code, and at most three states: "Own section order", "Map", "Postal
   code guessed". At 72 rem and above the list is 340 px wide and the open shop sits beside it.
5. **A shop**, `/chains/:chainId/shops/:shopId`, redirects to `details`. Above its tabs a
   "Priced by" line shows each price scope of the shop with its `ScopeMark`, a "Change"
   button that edits `priceScopeIds`, and an info button. Tabs:
   - **Details**: the form of `LocationFormPage` without the sections panel.
   - **Sections**: `location-sections.ts`. On a wide screen a row moves by drag and by the
     keyboard. On a phone each row has "Move up" and "Move down" buttons 44 px wide. "Save this
     order" and "Discard" sit in a bar at the bottom of the tab. The map notice is a waiting
     state with its own info button.
   - **Products**: the rows of `LOCATION_ITEMS` for this shop. The product column shows the
     product name and brand, not the id (section 2).
6. **Sections tab of the chain**, `/chains/:chainId/sections`: `chain-sections.ts` as the tab,
   with add, edit, delete and reorder.
7. **Price scopes tab**, `/chains/:chainId/scopes`: the scopes of the chain, most general
   first, each with its `ScopeMark`, its kind, its source key and the number of shops it
   covers when the gateway gives it. The chain's default scope carries a "Default" state and
   a "Make default" action sits on the others. Create, edit and delete as today.
8. **Details tab**: the form of `SupermarketFormPage` without its inner tabs.
9. **Old addresses redirect.** `/catalog/supermarkets` and `/catalog/supermarkets/:id` go to
   `/chains` and `/chains/:id`. `/catalog/locations/:id` reads the shop and goes to its place
   under its chain. `/catalog/locations`, `/catalog/sections`, `/catalog/price-scopes` and
   `/catalog/location-items` go to `/chains`, and keep a `supermarketId` query parameter as the
   chain when one is present. Links from other screens (`errorLinks`, the places queue, the
   postal code page, the dashboard tiles) point at the new addresses.
10. **Texts.** The three notes that said "Choose a chain to begin" are deleted. The info of
    the chain page: "A chain holds its shops, its sections and its price scopes." "Open a shop
    to set its section order, its products and the scopes that price it." The info of "Priced
    by": "A shop shows the price of its most specific scope." "A chain region covers many
    shops. A single shop scope covers one."

### Scope

- In: `feature-catalog` (new `chains/` pages, the five descriptors, routes), `feature-resource`
  (a descriptor mounted under a parent route), `models` (the descriptor field for a route
  parameter), `apps/luna-shopper-admin/src/app/sections.ts`, `en.json`, specs.
- Out: products, product groups, categories, prices and price rules (`0043`). The harvester
  (`0044`). The gateway, except what section 2 allows.

### Constraints

- Keep the descriptors. A tab that is a list is still a `ResourceListPage`, given its parent
  from the route. Add to the contract: `parent: { param, filter }`, which reads a route
  parameter and feeds the filter or path parameter that `requires` names today. Do not write a
  second list component.
- `no-literal-resource-path.spec.ts` stays green. Compose addresses through the registry.
- The split views are plain CSS grid with three states (see `0041`). Between 48 rem and 72 rem
  one pane shows at a time, as on a phone.
- The page of a chain and the page of a shop keep their scroll position and their filter when
  the operator opens a shop and comes back.
- Do not show a number that the gateway does not give.

### Action boundaries

- Do not delete a gateway route.
- Section 2 names two small gateway changes. Build them only if the owner agreed in the pull
  request that wrote this plan. Otherwise build the screens without them and say so.
- If you change a gateway route or DTO, run `luna-shopper-backend-gateway:openapi` and then
  `luna-shopper-admin/models:wire-types`, and commit both outputs.

### Progress evidence

- `npx nx lint` and `npx nx test` for `luna-shopper-admin/feature-catalog`,
  `luna-shopper-admin/feature-resource`, `luna-shopper-admin/models` and `luna-shopper-admin`.
- `npx nx build luna-shopper-admin`.
- A spec for each redirect of target 9.
- A browser walk on a slot at 390 px and 1360 px: open a chain, find a shop by postal code,
  reorder its sections and save, change its scopes, add a shop product, edit a price scope,
  then use the browser back button through each step. Attach screenshots that match the three
  boards.

## 1. Not in this plan

- A search for a shop across every chain. The gateway lists shops under one chain only.
- The shop map. It has its own screens.

## 2. What the gateway does not serve yet

| The mock shows | Today | In this plan |
| --- | --- | --- |
| The shop count of each chain | Only the total over every chain, on the dashboard | Leave the number out. Follow up: `locationCount` on the admin supermarket view. |
| The product name in a shop's Products tab | `CatalogSupermarketLocationItemView` has `itemId` only | Resolve names with the `nameLookup` that reference columns use (plan `0023`). Follow up: `itemName` on the view, as the price list has. |
| The shop count of each price scope | Not on `CatalogPriceScopeView` | Leave the number out. |
| The total of the Shops tab | The list is cursor paged with no total | Show no count on the tab. |

## 3. Decisions for the owner

- **The two follow ups in section 2** (`locationCount` on a chain, `itemName` on a shop
  product row). Small backend changes. The screens work without them.
- **Whether a shop can also be reached without its chain.** This plan says no, apart from the
  redirect of an old address.

## 4. What this plan deletes

- The sections entries Supermarkets, Shops, Shop sections, Price scopes and Products in a
  shop, and their flat routes. The redirects of target 9 stay until `0047`.
- `requires` on `LOCATIONS`, `SECTIONS` and `LOCATION_ITEMS`, and the blocked state "choose a
  chain first" of the list for these three.
- `catalog.locations.note`, `catalog.sections.note`, `catalog.locationItems.note` and
  `catalog.chainSections.says`.
- The inner tabs of `SupermarketFormPage` (`catalog.chainTabs`), and the sections panel inside
  `LocationFormPage`. Both panels live on as tabs.
- The chain filter of the shops, sections and price scopes lists, which the address replaces.
