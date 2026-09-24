# 0163: a basket names the shop it is bought at

> Frontend half: velista `0102`, buying at one shop. Followed by `0164` (shops near a point,
> and the shops you bought at recently) and `0165` (where a line is usually bought), which
> both read what this plan starts to record.
>
> Prerequisite reading: `0109` section 2.1 (the per shop rows the basket read leaves
> unread), `0116` and `0117` (a shop holds a stack of scopes, and the narrowest valid price
> wins), `0136` section 2 (who is served shop addresses), `0143` (the price and the shop a
> settle records), `0151` (the shop served on the settlement), and velista `0078` (prices
> from one shop) and `0091` section 7 (the shop is where the person is standing).

Today a shopper can say "prices from" one price scope, and nothing more. The picker drops the
shop the person tapped and keeps the scope, so a settle never names the shop, the basket read
never answers for a shop, and a shop outside the owner's postal codes cannot be priced at all.

This plan makes the shop a first class input:

1. A **generated** basket can be created with a shop. That shop is fixed for the life of the
   basket and applies to everybody in it. This is what the product calls "starting a trip
   at a shop". There is no trip entity: the basket is the trip, as it already is.
2. The basket read takes a shop as a request parameter. With one, it prices every product at
   that shop's scope stack, whether or not the shop is in the owner's profile, and answers
   what catalog knows about the product's availability at that shop.
3. A settle made with a shop chosen records the shop and its chain. A settle made in "any
   shop" mode records neither.

The LIVE basket keeps its current rule from velista `0091` section 7. The shop is a choice of
the device, not of the basket, because two people in one household stand in two shops. It
reaches the server only as the read parameter and on each settle.

## Brief for the agent

### Objective

Let a generated basket carry a fixed shop, let the basket read price and report availability
at a shop named by the basket or by the request, and record the shop and its chain on every
settle made at a chosen shop.

### Context

- **Baskets** are `baskets` rows in core (`apps/luna-shopper-backend/core/src/app/entities/basket.entity.ts`).
  `CreateBasketRequest` and `BasketView` are in
  `libs/luna-shopper/contracts/src/lib/messages/basket.messages.ts`. `POST /v1/baskets` is in
  `apps/luna-shopper-backend/gateway/src/app/baskets/baskets.controller.ts`.
- **The basket read is composed in the gateway**, `BasketController.get` in
  `gateway/src/app/baskets/basket.controller.ts` (around line 185): core answers the rows,
  then `BasketCatalogService.resolvedScopesOf` (`basket-catalog.service.ts`, around line 195)
  resolves the owner's profile scopes, `productsOf` prices the products at them, and
  `scopesOf` lists the scopes and their shops.
- **Shops** are `supermarket_locations` in catalog
  (`catalog/src/app/entities/supermarket-location.entity.ts`), each holding several scopes
  through `supermarket_location_price_scopes`, always including its own STORE scope.
- **Availability per shop** is `supermarket_location_items.available` (true, false, or null
  for unknown), keyed by item and shop, written today only by the DEZA runner
  (`catalog/src/app/catalog/supermarket-location-item.service.ts`, around lines 147 to 243).
- **Who is served shops** is `servesLocations` in
  `core/src/app/baskets/basket-redaction.ts` (around line 90): the owner and invited people,
  never a link visitor.
- **A settle** is `POST /v1/baskets/:id/rows/:rowKey/settle`. Its price and shop come from
  `SettlePriceService` (`gateway/src/app/baskets/settle-price.service.ts`). `shopIn` (around
  line 296) keeps the shop only when it belongs to a scope of the owner's resolution and the
  reader is served locations. The row is `line_settlements`
  (`core/src/app/entities/line-settlement.entity.ts`), which already has
  `priceScopeId` and `supermarketLocationId`.

### Target state

- `baskets."supermarketLocationId"`, a nullable uuid. It is set only by `POST /v1/baskets` and
  never changed after, by anybody. A LIVE basket never has one.
- `CreateBasketRequest.supermarketLocationId?: string`. The shop must exist. It does not
  need coordinates, and it does **not** have to be in the owner's profile.
- `BasketView.shop: BasketShopView | null`, the basket's own shop: id, chain id and name,
  label, address, city, postal code, and `inProfile` (section 3).
- `GET /v1/baskets/:id?locationId=<uuid>` prices at that shop (section 2). On a basket with its
  own shop, the basket's shop is used, and a different `locationId` is refused with the error
  code `BASKET_SHOP_LOCKED` (409).
- Each product in a read made at a shop carries `atShop` (section 2).
- Every participant of a basket is served shops, including a link visitor (section 4).
- A settle at a shop records `supermarketLocationId` and the new `line_settlements."supermarketId"`,
  and prices the settle at that shop even when it is outside the owner's profile.
- The OpenAPI document and the admin wire types are regenerated.

### Scope

Work only in:

- core: the basket entity and a migration, the basket create path, the basket view mapper,
  `basket-redaction.ts`, the settlement entity and a migration, and the settle write
- catalog: one message that answers a shop's scope stack and its items' availability for a
  set of item ids
- gateway: `baskets.controller.ts`, `basket.controller.ts`, `basket-catalog.service.ts`,
  `settle-price.service.ts`, their DTOs, and the error code
- `libs/luna-shopper/contracts` for the new fields and message
- the regenerated `openapi.json` and `wire-types.ts`

Do not touch: velista, the admin app, the harvester, how availability is written, the price
policies, the walk order (`0141`), or any other basket kind's lifecycle.

### Constraints

- **A shop on a basket is fixed.** No route changes it, including a `PATCH` by the owner.
  Velista lets the owner change the shop in the sheet before the basket is created, and that
  is the only moment it can change.
- **"Any shop" records no shop.** A settle with no `supermarketLocationId` records neither a
  shop nor a chain, even though it records the scope of the price shown. The scope of the
  cheapest price is not where the person stood.
- **Prices at a shop come from the shop's scope stack**, with the `0117` rule: the narrowest
  scope with a valid price wins. Do not add a second rule.
- **Availability is read, never inferred.** `atShop.available` is the stored value or null.
  Do not derive a shop value from the chain's `supermarket_items.available`.
- **A user's coordinates never reach this plan.** Only a shop id travels.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- adding a way to change or clear a basket's shop after creation
- serving a link visitor anything about a shop beyond what section 4 lists
- backfilling `supermarketId` onto old settlements (section 5 says why it is not needed)
- changing how `supermarket_location_items` is written

### Progress evidence

After each step, state what was built and paste the output that proves it:

- A core spec: a basket created with a shop reads it back, and no path changes it.
- A gateway spec: a read with `locationId` outside the owner's profile prices at that shop's
  scope stack; a read of a basket with its own shop and another `locationId` answers 409.
- A gateway spec: `atShop.available` is true, false and null for the three stored states.
- A settle spec: with a shop outside the profile, the price and both ids are recorded; in any
  shop mode, neither id is recorded.
- A redaction spec: a link visitor is served shops.
- Both migrations run against an ephemeral Luna slot, and the regenerated documents.

## 1. The basket's shop

`POST /v1/baskets` accepts `supermarketLocationId`. Core stores it. Catalog confirms that the
shop exists before core writes, through the gateway, and an unknown id answers the usual 404
problem for a location.

The shop does not change the basket's sources, its rows or its pricing profile. It is a fixed
value of the read parameter in section 2 and of the settle in section 5. The owner's profile
still decides which other scopes the basket lists, so the "cheaper elsewhere" marks keep
working.

## 2. The read at a shop

The shop of a read is, in order: the basket's own shop, else the `locationId` parameter,
else none. With no shop, the read is exactly today's read.

With a shop, the gateway asks catalog once for the shop's scope stack and for the stored
availability of the basket's products at that shop. Each product in `products` gains:

```ts
atShop: {
  priceScopeId: string | null; // the scope whose price won, by the 0117 rule
  price: number | null;
  currency: string | null;
  available: boolean | null; // supermarket_location_items.available, or null if no row
} | null; // null when the read has no shop
```

The shop's scopes are added to the scopes the read prices at, so a shop outside the owner's
postal codes is priced correctly. Nothing about the owner's profile is checked for this, as
the user decided on 2026-09-24. If a later need requires a profile check, it is a new plan.

`scopesOf` also includes the shop's scopes and the shop itself in `scopes[].locations`, so a
client can draw the chosen shop's name from the read even when it is not in the profile.

## 3. `inProfile`

`inProfile` is true when the shop's postal code is one of the owner's pricing profile's
postal codes. It is a fact for the client to warn about ("this shop is outside your areas"),
and it changes nothing on the server. The same definition is used by `0164`.

## 4. Link visitors are served shops

`servesLocations` becomes true for every participant. This reverses `0136` section 2 for
baskets, as the user decided on 2026-09-24: a guest picks a shop from the same list the owner
sees. A guest is still not served recent shops (`0164`) or anything about the owner's
purchases.

This exposes the addresses of the owner's profile shops to anybody holding the link, which
tells a link visitor roughly where the owner shops. Write that consequence in the comment
that replaces the old rule, so the next reader knows it was chosen.

The comment on `line_settlements.supermarketLocationId` also changes: the shop is still
served back only in a person's own history and on the item history of `0151`. `0165` reads
it only as counts.

## 5. The settle at a shop

`SettlePriceService` resolves the settle's scopes as the owner's scopes **plus** the scope
stack of the settle's shop, where the settle's shop is the basket's own shop if it has one,
else the `supermarketLocationId` the client sent. `shopIn` then accepts the shop because its
scopes are in the resolution.

On a basket with its own shop, a settle that names a different shop is refused with
`BASKET_SHOP_LOCKED`. A settle that names none records the basket's shop.

`line_settlements` gains `supermarketId`, a nullable uuid, written together with
`supermarketLocationId` and never without it. Add it to the existing check
(`ck_line_settlements_location_scope`) so that a chain without a shop is refused. The chain
is known in `shopIn` already. Core cannot join catalog, and `0165` counts by chain, which is
why the chain is copied onto the row.

Old rows are not backfilled. Velista never sent a shop before this plan, so there is nothing
to fill.

## 6. Out of scope

- Finding shops by distance, and recent shops: `0164`.
- Counting where a line is usually bought: `0165`.
- Availability learned from shoppers, and availability filters: backlog `0016`.
