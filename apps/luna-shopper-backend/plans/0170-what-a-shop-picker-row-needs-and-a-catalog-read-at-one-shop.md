> **PR:** [#533](https://github.com/IchirokuXVI/nx-portfolio/pull/533)

# 0170: what a shop picker row needs, and a catalog read at one shop

> Needed by velista `0124` (one shop picker, and the catalog's Supermarket button). Mock:
> `apps/velista/plans/mocks/shop-picker/`, reviewed and approved on 2026-09-29, published at
> https://claude.ai/artifact/DbDzEKYhHZ6UdfuxAP1L9W. Prerequisite reading: `0167` sections 3
> and 5 (the rule that decides a shop's sections, and `GET /v1/catalog/locations/:id/sections`),
> `0163` section 2 (the basket read at a shop, and how `atShop` picks a scope), `0038` section
> 5.1 (price scopes) and `0068` section 6 (the shops read).

velista's redrawn shop picker shows, on every shop row, the chain's logo and the shop's
sections, and its catalog tab can be narrowed to one shop. The wire has none of the three
today in the shape a list needs: a logo is only on the supermarket views, sections come one
shop per request, and `GET /v1/catalog/items` narrows to a chain and never to a shop. This
plan adds the three and changes nothing else.

## Brief for the agent

### Objective

Put the chain's `logoUrl` and the shop's section names on every location view a picker row is
built from, and give `GET /v1/catalog/items` a `locationId` that prices the read at that one
shop and lists that shop's chain. Regenerate the OpenAPI document and the admin wire types.

### Context

- **The three location views a picker row is built from** (`libs/luna-shopper/contracts/src/lib/messages/`):
  - `BasketShopView`, `basket.messages.ts:388`: the basket's chosen shop, and the base of
    `NearbyShopView` (`catalog.messages.ts:1645`, `POST /v1/catalog/shops/nearby` and
    `POST /v1/baskets/:id/shops/nearby`) and of `RecentShopView.shop`
    (`purchase.messages.ts:219`, `GET /v1/account/recent-shops`).
  - `BasketScopeLocationView`, `basket.messages.ts:406`: the shops under each
    `BasketPriceScopeView` of the basket read. Its chain half is `PriceScopeChainView`
    (`catalog.messages.ts:3159`), which already names `supermarketId` and `supermarketName`.
  - `SupermarketLocationView`, `catalog.messages.ts:648`: the `location` of `ShopView`
    (`:748`), answered by `GET /v1/catalog/shops` (`catalog.controller.ts:356`).
    `ShopView.supermarket` is a `SupermarketView`, which already carries `logoUrl`.
- **Logos.** `supermarkets.logoUrl` exists, `SupermarketView.logoUrl` (`:626`) and
  `SupermarketLocationChainSummaryView.logoUrl` (`:714`) carry it, and every row holds null
  today. The admin create and update requests already write it.
- **Sections.** `0167` built them (PR #527). `SECTION_PATTERNS.forLocation` answers one shop's
  sections in its order, with `source` `LOCATION` or `CHAIN`, and
  `GET /v1/catalog/locations/:id/sections` (`catalog.controller.ts:258-274`, public) serves it.
- **The catalog read.** `CatalogItemsController.search` (`catalog.controller.ts:402-431`) takes
  `SearchItemsQueryDto` (`catalog.dto.ts:1348-1391`): `query`, `categoryId`,
  `productGroupId`, `soldBy[]`, and through `PriceScopedQueryDto` (`:1285-1336`)
  `priceScopeId[]`, `postalCode[]`, `supermarketId[]` and `profileId`, resolved by
  `ScopeResolutionService.forRead` (`scope-resolution.service.ts:119`), which has no location
  rung.
- **Pricing at a shop, as the basket does it.** `basket-shop.ts:88-90` `quotedScopeOf(shop)` is
  `shop.location.priceScopeIds[0]`, the most specific scope of the location's stack, and
  catalog materializes each scope's price over its whole stack.

### Target state

1. **A logo on each location view.** `supermarketLogoUrl: string | null` on `BasketShopView`
   (and so on `NearbyShopView` and `RecentShopView.shop`) and on `PriceScopeChainView` (and
   so on `BasketPriceScopeView` and the suggestions that carry it). Filled from
   `supermarkets.logoUrl` wherever the view already joins the chain's name. `ShopView` needs
   nothing: its `supermarket` has the field.
2. **Section names on each location view.** `sections: LocationSectionNameView[]` on
   `BasketShopView`, `BasketScopeLocationView` and `SupermarketLocationView`, where
   `LocationSectionNameView` is `{ id: string; name: LocalizedText }`, in the shop's own order,
   by exactly the rule `SECTION_PATTERNS.forLocation` applies (present sections of the
   location, else the chain's default). Empty when the chain has no sections. Always present,
   never absent, so a client does not have to tell "none" from "not asked".
3. **One batched read.** A new catalog message `SECTION_PATTERNS.namesForLocations` takes up to
   200 location ids and answers a map of id to names, in one statement. Every gateway read in
   target 2 calls it once per response, never once per row.
4. **A catalog read at one shop.** `locationId?: string` (UUID, any version) on
   `SearchItemsQueryDto`. When present:
   - the read is priced at the location's `priceScopeIds[0]` alone, and any `priceScopeId`,
     `postalCode`, `supermarketId` or `profileId` sent beside it is refused with 400
     `CATALOG_LOCATION_EXCLUSIVE`
   - `soldBy` defaults to the location's `supermarketId`, and a `soldBy` naming another chain
     is refused with the same code
   - a product that chain sells with no price at that scope stays in the page with no offer,
     exactly as a chain's product with no price does today
   - an unknown location answers 404 `SUPERMARKET_LOCATION_NOT_FOUND`
5. **The committed outputs.** `npx nx run luna-shopper-backend-gateway:openapi`, then
   `npx nx run luna-shopper-admin/models:wire-types`, both diffs committed.

### Scope

Work in `libs/luna-shopper/contracts` (the three views, the new name view, the message and
the error code), `apps/luna-shopper-backend/catalog` (the batched section names and the
location lookup for the items read), `apps/luna-shopper-backend/gateway` (the mappers and
services that build the views in target 1 and 2, the items DTO and controller, their specs),
and the two generated files.

Do not touch: the section rule itself, the admin section routes, the basket's own `atShop`
logic, the price materialization, or any velista code.

### Constraints

- The section names must come from the same query `forLocation` uses, extracted and shared, so
  the list and the per shop read cannot disagree. A spec asserts that for one configured shop
  and one unconfigured shop of the same chain.
- One batched call per response. A spec on the shops read with 30 rows asserts one message.
- `soldBy` accepts every UUID version, as fixed in PR #472. `locationId` does too.
- Never edit `openapi.json` or `wire-types.ts` by hand.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding a column, seeding any `logoUrl`, adding a field for a chain colour,
changing what `GET /v1/catalog/locations/:id/sections` answers, or letting `locationId` combine
with the profile's own scopes.

### Progress evidence

Per target, the files changed and the spec run. At the end: `npx nx affected -t lint test`,
the two regenerations with a clean `git status` after them, and one ephemeral slot run
(`luna-slot.sh --ephemeral --up <n>`) where `GET /v1/catalog/shops` shows sections for a shop
with two configured and `GET /v1/catalog/items?locationId=` lists one chain priced at one scope.

## 1. Why the logo travels on the view and is not looked up

A basket guest reads the basket with a participant credential and no account, and
`GET /v1/catalog/supermarkets` needs one. A client side table of logos is also a second
directory of chains that has to agree with the first. A nullable string on views that already
name the chain costs nothing and reaches every reader the name reaches.

## 2. Why names and not ids

A picker row draws the names and does nothing else with them. Ids beside the names keep the
row's chips keyed for Angular, and the full section views stay behind the per shop read, which
the basket's aisle grouping (`0167`, velista `0120`) already uses.

## 3. Not in this plan

- Filling in the logos. That is an operator's work in the back office, and until it is done the
  picker draws the chain's initial.
- Availability at a shop in the catalog read. The basket has it through `atShop`. The catalog
  shows a price or no price, as the mock draws.
- A search of shops by section name.
