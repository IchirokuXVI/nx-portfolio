# 0187: the products a scope has no price for

> Asked for by admin plan `0043` (a product and its prices), section 2. Build it after admin
> `0043` is merged. Prerequisite reading: admin `0043` target 2, plan `0080` (every price a
> source gave and the one a shopper sees), plan `0146` (the products one chain sells), and
> admin plan `0012` section 2 (how `none` reaches a service as a flag).

The back office can list the products that have an out of date price at a scope, and the ones
a scope says it does not sell. It cannot list the products that a scope has no price for at
all. That list is the curation worklist: after a crawl of a chain, it is what the crawl did
not reach. Today the only way to get it is SQL.

## Brief for the agent

### Objective

Let the admin products list answer "which products have no shown price at this price scope",
with a count, and prove on a realistic catalog that the query is fast enough to page.

### Context

- **The list** is `GET /v1/admin/catalog/items` in
  `apps/luna-shopper-backend/gateway/src/app/catalog/catalog-admin.controller.ts`, which sends
  the catalog search message. The service side is `ItemService.search` in
  `apps/luna-shopper-backend/catalog/src/app/catalog/item.service.ts`.
- **The pattern to copy** is `productGroupId=none`: the gateway turns the literal into the
  flag `withoutProductGroup`, and the service adds the condition in two places (the page and
  its count path).
- **A shown price** is a row of `supermarket_items` for an item and a price scope with a price
  that is not null. The table is materialized on write (plan `0080`). Read it. Do not work a
  shown price out again from `item_prices`.
- **A scope that says "not sold"** is a row with `available = false`. That is an answer, not
  a missing price, and it stays out of this list.

### Target state

1. `GET /v1/admin/catalog/items` takes `withoutPriceAtScopeId`, a uuid. With it, the page
   holds only products that have no row with a price in `supermarket_items` for that scope,
   and no row there with `available = false`.
2. The filter combines with every filter the list has: text, category, product group, sort
   and cursor.
3. An unknown scope id answers 404 with the code the price scope read uses.
4. The response of this route gains `total` when `withoutPriceAtScopeId` is set, and only
   then: the number of products that match, so that the back office shows it on the state.
5. The contract schema, the message type, `openapi.json` and the admin wire types all carry
   the new parameter and field.
6. The back office draws the "No price" state of admin `0043` target 2, with its count. That
   is one change in `libs/luna-shopper-admin/feature-catalog`, in this pull request.

### Scope

- In: `libs/luna-shopper/contracts` (the search message and its schema), the catalog service
  (`item.service.ts`, a migration if section 2 calls for an index), the gateway DTO and
  controller, `openapi.json`, the admin wire types, the "No price" state in the admin list.
- Out: the shopper search, how a shown price is chosen, the sweep.

### Constraints

- One query for the page and one for the count. No query per product.
- The condition is `NOT EXISTS` on `supermarket_items`, not a left join with a null check, so
  that the planner can use the index on `(price_scope_id, item_id)`.
- Never write to `supermarket_items` here.
- The parameter is a uuid and nothing else. `none` has no meaning for it.

### Action boundaries

- Add an index only if section 2 shows that the query needs it, and say what you measured.
- Do not measure on the locked slot 3 catalog volume. Copy it to a slot of your own first.
- Regenerate, never edit: `npx nx run luna-shopper-backend-gateway:openapi`, then
  `npx nx run luna-shopper-admin/models:wire-types`. Commit both outputs.

### Progress evidence

- `npx nx test luna-shopper-backend-catalog`, `luna-shopper-backend-gateway`,
  `luna-shopper-admin/models` and `luna-shopper-admin/feature-catalog` pass, and
  `npx nx build luna-shopper-admin` passes.
- An integration spec against real Postgres on an ephemeral slot with four products at one
  scope: priced, not sold, out of date, and no row. Only the fourth is in the page, and
  `total` is 1.
- The numbers of section 2, in the pull request.

## 1. Not in this plan

- "No price at any scope of this chain". Plan `0146` already answers which products a chain
  sells.
- The same filter on the shopper search.

## 2. What to measure

On a copy of a realistic catalog (about 48,000 products, the largest scope of the largest
chain), run `EXPLAIN (ANALYZE, BUFFERS)` for the first page and for the count, with no other
filter and with a text filter. Record the plan and the time of each. The target is under
200 ms for the page and under 500 ms for the count. If the count misses the target, return
`total` only for the first page of a query and say so in the route's description.
