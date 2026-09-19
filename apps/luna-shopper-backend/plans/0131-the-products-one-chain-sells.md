# 0131: the products one chain sells

> Frontend half: velista `0093` (the catalog tab), which is blocked on this one.
> Mock: `apps/velista/plans/mocks/catalog/`, published at
> https://claude.ai/artifact/9UppvQ8HfCVouog2WK7fi7.
>
> velista's catalog screen offers a row of chain chips: press Mercadona and see what
> Mercadona sells. The read behind it cannot do that. `supermarketId` on
> `GET /v1/catalog/items` selects **price scopes**, so it decides where the prices come
> from and not which products are listed, and choosing one chain today would list every
> product in the catalog with most of them unpriced. This plan adds the filter that
> chip promises, as a separate parameter, and leaves the scope selection exactly as it
> is.
>
> Prerequisite reading: `0048` (the ranked read and its scopes), `0069` section 2 (no
> scopes is not an empty catalog), `0080` (every source's price side by side), `0086`
> (one source product), `0109` (every shop's price), and `ItemService.search` in
> `apps/luna-shopper-backend/catalog/src/app/catalog/item.service.ts`.

## Brief for the agent

### Objective

Add a chain filter to the item search that narrows which products are returned, keep it
separate from the scope selection, and keep both branches of the search agreeing.

### Context

- `ItemService.search` has two branches. A query goes through the ranked branch, which
  assembles its own SQL; no query goes through `listedItems`, which is keyset paged by
  name, creation or update. **Both apply the same filters**, written twice, and the
  code says so in a comment. A filter added to one and not the other is the defect this
  service has already had.
- `SearchItemsRequest` carries `query`, `category`, `productGroupId`,
  `withoutProductGroup` and `priceScopeIds`. `priceScopeIds` prices the rows and never
  filters them: absent and empty both mean "rank and page as usual, every price null"
  (`0069`, section 2).
- The gateway resolves scopes with `ScopeResolutionService.forRead`, out of
  `PriceScopedQueryDto`'s `postalCode`, `supermarketId` and `profileId`. Those three
  are about **where the caller shops**.
- What a chain sells is `supermarket_item` rows, which hang off a `price_scope`, which
  names a `supermarket`. `supermarket_location_price_scope` maps shops to scopes.
- Paging is keyset, and the cursor must stay stable under the filter.

### Target state

`GET /v1/catalog/items?soldBy=<uuid>` lists only the products that chain sells, ranked
and paged exactly as before, priced from the caller's scopes exactly as before. Two
`soldBy` values list what either sells.

### Scope

Work only in:

- `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts` and its schema
- `apps/luna-shopper-backend/catalog/src/app/catalog/item.service.ts` and its specs
- `apps/luna-shopper-backend/catalog/src/app/db/migrations/` (one index)
- `apps/luna-shopper-backend/gateway/src/app/catalog/catalog.dto.ts` and
  `catalog.controller.ts`
- `apps/luna-shopper-backend/gateway/docs/openapi.json` (regenerated)
- `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts` (regenerated)

Do not touch: `priceScopeIds`, `ScopeResolutionService`, the offers read, the suggest
read, or anything in velista.

### Constraints

- The new parameter is **not** called `supermarketId`. That name already means
  something else on the same DTO, and a reader who confuses the two gets a silently
  wrong answer rather than an error.
- Every rule you add goes in both branches of the search, and a spec proves they agree.
- Rules that live in SQL need an integration spec against a real database. A fake
  repository proves nothing about a `WHERE` clause.

### Action boundaries

Stop and ask before: changing what `priceScopeIds` means, adding a column to
`supermarket_items`, or adding a second parameter for the same idea.

### Progress evidence

After each section output: the files changed, the spec you ran, and the `EXPLAIN` of
the new clause on a seeded database.

## 1. The parameter

`soldBy`, repeatable, up to the same `MAX_SELECTORS` the DTO already uses for its other
lists. On the contract:

```ts
export interface SearchItemsRequest extends PageQuery {
  // ...
  /** Only products this chain sells. Empty and absent both mean every chain. */
  soldBy?: string[];
}
```

Two names were considered and rejected. `supermarketId` is taken, by the scope
selector on the same query string. `chainId` is not a word this system uses: the entity
is a supermarket, and the interface says chain only in English copy.

**Absent and empty mean every chain**, which is the same reading `priceScopeIds`
already has, so a client that sends an empty array after the person cleared the chips
gets the catalog rather than nothing.

## 2. What it means

A product is sold by a chain when the chain has a `supermarket_item` row for it that is
available. In SQL, as an `EXISTS` rather than a join, so a product sold in nine of the
chain's scopes is still one row:

```sql
EXISTS (
  SELECT 1
    FROM supermarket_items si
    JOIN price_scopes ps ON ps.id = si."priceScopeId"
   WHERE si."itemId" = i.id
     AND ps."supermarketId" IN (:...soldBy)
     AND si.available
)
```

Verify every column name against the entities before you write it. `0086` moved what a
source product is, and this plan must not be the reason that move is half undone.

**`available` is part of the meaning, not an optimization.** A row saying the chain does
not stock the product is exactly the row that must not make it appear in that chain's
catalog, and it is already excluded from `bestOffer` and from the `scopes` array for
the same reason (`0109`, section 2).

**It says nothing about price.** A product this chain sells with no price row is listed
with its price fields null, as it would be without the filter. The filter is about the
assortment, and `0069`'s rule holds: having no price is not the same as not existing.

## 3. Both branches

Apply it in the ranked branch and in `listedItems`, beside the `category` and
`productGroupId` clauses, and add a spec that runs the same filter through both and
asserts the same set of ids comes back. The comment in that service already warns that
these two have to stay one rule, and this is the third filter to join them.

The keyset cursor does not change. The filter narrows the set, it does not reorder it,
so a cursor issued with the filter on stays valid for the same filter.

## 4. The index

The `EXISTS` runs per candidate row, so it needs a covering path from
`supermarket_items` to the item:

```sql
CREATE INDEX IF NOT EXISTS "idx_supermarket_items_item_scope_available"
  ON supermarket_items ("itemId", "priceScopeId")
  WHERE available;
```

Measure it before and after on a seeded database and put the two `EXPLAIN` outputs in
the PR. The catalog holds thousands of products and tens of thousands of source rows,
and a filter that scans them on every page of the browse screen is the one way this
plan can make the app slower rather than better.

## 5. The gateway

`SearchItemsQueryDto` gains `soldBy`, `@IsUUID('4', { each: true })`, `@IsOptional()`,
capped at `MAX_SELECTORS`, documented as what it is: the products a chain sells, not
where the prices come from. The controller passes it through. Nothing else moves.

The DTO comment matters more here than usual. Two parameters on one query string that
both name a supermarket and mean different things is the kind of thing an OpenAPI
reader gets wrong once and then ships.

## 6. Not in this plan

- Ordering by price. It is not offered on this screen and the read cannot do it.
- Any notion of an offer or a discount. Nothing in the read model marks a price as a
  promotion.
- Filtering the offers read or the suggest read by chain. Neither screen asks for it.
- A count of how many products a chain sells. The page is a cursor page and says
  nothing about totals, and a count over this filter is a second query.

## 7. Tests

- `item-search.spec.ts`: absent, empty and one id; two ids union; an unknown id answers
  an empty page rather than an error.
- `catalog-search.integration.spec.ts`: a product sold only by chain A is absent from
  chain B's answer; a product with an unavailable row for chain A is absent from chain
  A's answer; a product sold by A with no price row is present with null prices; the
  ranked branch and the listing branch agree on all four cases.
- A paging spec: page through a filtered set of more rows than the limit and assert no
  row is repeated or skipped.
- `openapi-document.spec.ts` passes.

## 8. Acceptance criteria

- [ ] `soldBy` narrows the products, and `supermarketId` still only selects scopes.
- [ ] Both branches of the search apply it, proved by a spec that compares them.
- [ ] Unavailable source rows do not make a product appear.
- [ ] A filtered page is still priced from the caller's own scopes.
- [ ] The index exists and the two `EXPLAIN` outputs are in the PR.
- [ ] The OpenAPI document and the admin wire types are regenerated and committed.

## 9. Verification

```sh
npx nx test luna-shopper-backend-catalog
npx nx test luna-shopper-backend-catalog-integration
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

Then, against a luna slot with the seeded Mercadona catalog: read the items with no
filter, with Mercadona, and with two chains, and compare the counts and the first page
of each.
