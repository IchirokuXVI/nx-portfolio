# 0161: a suggestion carries what the card draws

> Frontend half: velista `0101`, the product suggestion card, and its mock at
> `apps/velista/plans/mocks/typeahead/`. That plan cannot draw a chain, a price per chain or
> the products of a group until this one lands.
>
> Prerequisite reading: `0048` section 3 (the composer's one call), `0066` section 4 (the
> scope map the basket read carries), `0109` section 2 (`offers: 'all'`), `0157` (the best
> offer is one with a price), and in the code `search`, `searchOffers`, `offersFor`,
> `allOffersFor` and `membersOf` in catalog's `item.service.ts`, plus `scopesOf` in the
> gateway's `basket-catalog.service.ts`.

The composer's dropdown is about to become a card. The card names the cheapest chain, lists
every chain's price when it is opened, and shows the cheapest five products of a group behind
a reveal. `GET /v1/catalog/suggest` and `GET /v1/baskets/{id}/catalog/suggest` answer none of
that today:

- **Every chain's price is not sent.** velista `0101` section 2 says `ItemView.offers` is
  already on the wire. It is not, on these two routes: catalog fills `offers` only when a
  request asks for `offers: 'all'`, and only `getMany` reads that option. `search` and
  `searchOffers` never do.
- **No scope can be named.** An offer carries a `priceScopeId` and the response carries
  nothing that turns it into a chain. The basket read has that map (`0066` section 4). The
  suggest response has no equivalent.
- **A group names one product.** `ProductGroupOfferView` carries `cheapestItem` and the ids
  of the rest. The card draws five, cheapest first, with a name, a brand and a price.

All three are gaps in one response, so they are one plan.

## Brief for the agent

### Objective

Make both suggest routes answer every scope's price for each product, a map that names the
chain behind every scope an offer on the response mentions, and the cheapest five products of
each group, without changing any other catalog read.

### Context

- **The two routes.** `CatalogSuggestController.suggest` in
  `apps/luna-shopper-backend/gateway/src/app/catalog/catalog.controller.ts` (around line 597)
  and `BasketController.suggest` in `.../gateway/src/app/baskets/basket.controller.ts` (around
  line 589). Both send `ITEM_PATTERNS.searchOffers` and `ITEM_PATTERNS.search` in parallel
  and assemble `{ suggestions }`. Each half fails empty on its own.
- **Scopes.** The catalog route calls `ScopeResolutionService.forRead`, which returns ids
  only. `describe` returns the whole `CatalogScopeView`, whose `scopes` name the
  `supermarketId` of each scope, and `forRead` is `describe` with the rest thrown away, so
  switching costs nothing. The basket route already goes through
  `BasketCatalogService.describeScopes`, which calls `describe`.
- **When a caller names scope ids outright**, `describe` answers `scopes: []`
  (`scope-resolution.service.ts`, around line 129). velista never does this on suggest: it
  sends `profileId`. The map is then empty, and the constraint below says what that means.
- **Every price.** `allOffersFor` in catalog's `item.service.ts` (around line 828) is one
  query for a page of items, ordered by `orderOffers`, and `getMany` (around line 404) sets
  `bestOffer` to its first entry so the two cannot disagree. `search` (around line 476) calls
  `offersFor` instead, which returns one offer per item.
- **Groups.** `searchOffers` (around line 524) picks the cheapest member with a
  `LEFT JOIN LATERAL ... LIMIT 1`, ordered `price IS NULL`, then unit price, then price, then
  item id (`0157`). `membersOf` (around line 690) returns every member's id, capped in the
  database by a window function and ordered by English name. Neither returns more than one
  member as a product.
- **Naming a chain.** `BasketCatalogService.scopesOf` (around line 118) collects every scope
  id named by `offers` or `bestOffer`, lists the chains once with `SUPERMARKET_PATTERNS.list`,
  and joins them through `resolved.scopes`. It also fetches shop addresses per scope, which
  this plan does not want.
- **What the card draws**, read from the mock: the expanded row lists one price per
  **chain** ("Mercadona 1,19 €, Carrefour 1,25 €, Dia 1,29 €") with no shop address, and a
  stale price as "seen 12 days ago". A group's reveal draws name, brand and price for each of
  five products and "and 1 more". No shop address appears anywhere on the card.
- velista asks for 10 suggestions per kind (`SUGGEST_LIMIT_PER_KIND`). The basket route is
  throttled at 20 a minute per participant (`participant-throttler.guard.ts`).
- Chain names reach every basket participant, guests included (`BasketPriceScopeView` in
  `basket.messages.ts` says why). Shop addresses do not, which is one more reason the map
  here carries none.

### Target state

- `SearchItemsRequest` and `SearchOffersRequest` accept `offers?: 'best' | 'all'`, read
  exactly as `GetItemsRequest.offers` is. With `all`, `search` fills `ItemView.offers` for
  every item on the page, and `searchOffers` fills it on each group's `cheapestItem`.
  `bestOffer` is the first entry of `offers` wherever both are present.
- `SearchOffersRequest` accepts `members?: number`, at most 5. With it, each
  `ProductGroupOfferView` carries `members?: ItemView[]`: up to that many members, ordered by
  the same keys the cheapest member lateral uses, each with `bestOffer` and without `offers`.
  `members[0]` is `cheapestItem` whenever both exist. Absent when not asked for.
- `CatalogSuggestResponse` carries `scopes: PriceScopeChainView[]`, one entry per scope id
  named by any offer anywhere on the response, and no other. A `PriceScopeChainView` is
  `{ priceScopeId, supermarketId, supermarketName }`.
- Both suggest routes ask for `offers: 'all'` and `members: 5`, and fill `scopes`.
- The basket read's response is unchanged, field for field.
- The OpenAPI document and the admin wire types are regenerated.

### Scope

Work only in:

- `libs/luna-shopper/contracts`: `SearchItemsRequest`, `SearchOffersRequest`,
  `ProductGroupOfferView`, `CatalogSuggestResponse`, the new `PriceScopeChainView`, and their
  JSON schemas
- `apps/luna-shopper-backend/catalog/src/app/catalog/item.service.ts` and its specs
- the two gateway suggest routes, `basket-catalog.service.ts`, and one new gateway helper
  that both use to name chains
- `apps/luna-shopper-backend/gateway/docs/openapi.json` and
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, regenerated only

Do not touch: search matching or ranking (`0156`), the order of the suggestions, the offer
ordering (`0157`), price policies, `getMany`, the basket read's shape, the admin app's
screens, or any velista code.

### Constraints

- **Read the new fields only when asked.** Every other caller of `search` and `searchOffers`
  (the admin listings, `GET /v1/catalog/items`, `GET /v1/catalog/product-groups/:id/items`)
  must answer byte for byte what it answers today.
- **One helper names chains for both reads.** Split the chain naming half of `scopesOf` out
  so that the basket and the suggestion cannot name the same scope differently. The basket
  keeps its locations. The suggestion asks for none.
- **A scope the map cannot name is left out, never guessed.** That covers a caller who named
  scope ids outright and a chain the listing did not return. The offer still comes back.
  velista draws it without a chain, which `Edge` already allows for.
- **Naming never takes the dropdown down.** If the chain listing fails, `scopes` is `[]` and
  the suggestions are unchanged, the rule `scopesOf` already follows.
- `members` are ranked **in the database**, per group, with a window function, as
  `membersOf` already caps. Ten groups must not pull ten whole ranges out of Postgres.
- `itemIds` keeps its meaning and its order. The card reads the total from it.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- adding shop addresses to the suggestion's map
- changing `bestOffer`, `offer` or `cheapestItem` on any read
- adding a cache, or changing the participant throttle
- changing the shape of `BasketPriceScopeView` on the wire

### Progress evidence

After each step, state what was built and paste the output of the target that proves it:

- Catalog specs: `search` with `offers: 'all'` fills `offers` and agrees with `bestOffer`,
  and without it answers what it answers today. `searchOffers` with `members: 5` returns at
  most five, cheapest first, `members[0]` equal to `cheapestItem`, unpriced members last.
- Gateway specs for both routes: `scopes` names every scope an offer mentions, only those,
  is empty when the chain listing throws, and leaves out a scope the resolution did not name.
- A basket read spec that proves its `scopes` did not change.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types`, with the diff committed.

## 1. Every scope's price on both searches

Add `offers?: 'best' | 'all'` to `SearchItemsRequest` and `SearchOffersRequest`, with the
documentation `GetItemsRequest.offers` already carries: `best` is the default, `all` adds
`ItemView.offers`, and it is read only when `priceScopeIds` names a scope.

In `search`, `all` calls `allOffersFor` for the page and sets `bestOffer` to the first entry,
exactly as `getMany` does, instead of calling `offersFor`. The two orderings must not be
allowed to disagree: `0157` made them agree for `bestOffer`, and a spec asserts it for these
reads too.

In `searchOffers`, `all` fills `offers` on each `cheapestItem`. The group's own `offer` is
untouched.

## 2. The cheapest five of a group

`members?: number` on `SearchOffersRequest`, clamped to 5, adds `members?: ItemView[]` to each
`ProductGroupOfferView`. The order is the lateral's (`0157`): a member with a till price
first, then unit price ascending, then price ascending, then item id. A member with no price
at the requested scopes comes after every priced one, ordered by name, so a group none of
whose members is priced still reveals five named products.

Each member carries `bestOffer` and not `offers`. The reveal draws one price per product, and
every scope's price for five products in ten groups is weight that nothing on the card reads.

`members` is its own field and not a replacement for `itemIds`: `itemIds` is what choosing the
group copies onto a line (`0048` section 1.1), and its length is the "and N more".

## 3. The map that names a chain

`CatalogSuggestResponse` gains `scopes: PriceScopeChainView[]`:

```ts
export interface PriceScopeChainView {
  priceScopeId: string;
  supermarketId: string;
  /** The chain, both locales, resolved by the client. */
  supermarketName: LocalizedText;
}
```

`BasketPriceScopeView` becomes `PriceScopeChainView` plus `locations`, declared by extending
it, so the basket's JSON does not change.

The scope ids collected are every `priceScopeId` on the response: each item's `offers` (or
`bestOffer` where `offers` is absent), each group's `offer`, each `cheapestItem`'s `offers`,
and each member's `bestOffer`. A scope named twice appears once.

The catalog route replaces `forRead` with `describe` and hands `priceScopeIds` to the reads,
then the resolved view to the helper. The basket route already holds the view. Neither route
fetches locations.

**A chain can appear under more than one scope**, a regional scope and a national one for
instance. The map keeps them as separate entries. The card draws one price per chain, and
choosing the cheapest of a chain's scopes is the client's, because it is a display rule and
not a fact about the price.

## 4. What it costs

Per keystroke, this adds one chain listing, one offers query per search, and one ranked member
query. Measure it before opening the PR: on a Luna slot with the seeded Mercadona catalog and
postal code 14013, time twenty requests of `GET /v1/catalog/suggest?q=leche&limit=10` before
and after, and put both medians, both p95 figures and both response sizes in the PR
description. Do not add a cache to improve them without asking.

## 5. Not in this plan

- Shop addresses on the suggestion. The card names chains.
- A packaging format. That is `0162`.
- Photographs. `imageUrl` stays empty until `0126` to `0129` land, and velista `0101` draws
  the card without one until then.
- velista's mapping of the new fields, which is velista `0101`.

## 6. Acceptance criteria

- [ ] Both suggest routes answer `offers` on every item, and `bestOffer` is its first entry.
- [ ] Every group suggestion carries at most five `members`, cheapest first, `members[0]`
      equal to `cheapestItem`, with unpriced members after the priced ones.
- [ ] `scopes` names every scope any offer on the response mentions, and nothing else.
- [ ] A guest on a shared basket gets the same `members` and `scopes` as the owner gets.
- [ ] `GET /v1/catalog/items`, `GET /v1/catalog/items/offers`,
      `GET /v1/catalog/product-groups/:id/items` and the basket read answer exactly what they
      answered before.
- [ ] The PR states the before and after latency and size of section 4.
- [ ] The OpenAPI document and the wire types are regenerated and committed.

## 7. Verification

```sh
npx nx test luna-shopper-backend-catalog
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-admin/models
npx nx build luna-shopper-backend-gateway
```

`nx test` for catalog runs no real Postgres for the raw SQL in section 2. Run the member query
against an ephemeral Luna slot as well, the way the catalog integration specs do.
