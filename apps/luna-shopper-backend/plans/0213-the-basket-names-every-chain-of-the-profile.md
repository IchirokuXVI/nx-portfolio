# 0213: the basket names every chain of the profile, and says which quote it

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". This is finding F5.3 of
> `docs/reports/2026-10-16-velista-e2e-slot1.md` (major): the basket shop picker leaves out
> Lidl although the profile's postal codes hold three Lidl shops, because the basket read
> names only the scopes that quote one of its products. It also covers S17 (the Deza shop
> count changes between two opens of the picker). Velista `0153` draws the answer.
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0124` and backend `0170` (the shop picker and what it reads),
> `apps/luna-shopper-backend/gateway/src/app/baskets/basket-catalog.service.ts` (`scopesOf`,
> `locationsOf`, `scopesOfRead`), `gateway/src/app/catalog/catalog-suggest.service.ts`
> (`productScopeIds`, `chainsOf`), `catalog/catalog.controller.ts:350-383` (the shop summary
> that the supermarkets page reads), and `BasketPriceScopeView` in
> `libs/luna-shopper/contracts/src/lib/messages/basket.messages.ts`.

## Brief for the agent

### Objective

A basket read names every price scope that the profile's postal codes resolve to, with a
flag that says whether the scope quotes any product of this basket, and lists the shops of
each scope by the profile's postal codes so that the count does not move with the rows.

### Context

- **The picker reads only `basket.scopes`.** Velista's `shop-picker-sheet.ts:346-372` and
  `:385-404` iterate `priceScopes()`, which is `basket().scopes`. It never reads the profile's
  supermarkets.
- **`scopesOf` starts from the products.** `basket-catalog.service.ts:653-709` calls
  `productScopeIds(products)` (`:666`), which is every scope that an offer on the basket's
  products names (`catalog-suggest.service.ts:160-172`), and returns `[]` when none
  (`:667-669`). `chainsOf` (`:114-150`) names only those scope ids. A chain whose scopes
  quote nothing on this basket is absent. In the slot 2 catalog the Lidl shops have a STORE
  scope with no prices on top of REGION 43 with 67 prices, and the basket's products are
  not among them.
- **The supermarkets page counts by postal code.** `catalog.controller.ts:350-383` calls
  `summarizeByChain` over the profile's postal codes with no reference to prices. That is
  why it lists Lidl with three shops.
- **The shop count moves with the rows.** `locationsOf` (`:802-826`) lists the shops of each
  scope by `priceScopeId` with no postal code filter (`:808-813`). A line bought or a product
  changed changes `referenced`, so the set of scopes and of shops changes with it. That is
  S17. `scopesOf` also swallows any failure into `[]` (`:707-708`), and `chainsOf` drops an
  unnamed scope, so a partial failure is silent.
- **The client refuses a shop outside the scopes.** `_offersShop` and `_named` in velista's
  basket code and `restore()` check a chosen shop against `scopes`. So a chain must be in
  `scopes` to be choosable at all, which is why the answer belongs in this read and not in
  a second request from the picker.

### Target state

1. `scopesOf` returns every scope of the profile's resolution (`resolved.scopes`), not only
   the referenced ones. Each `BasketPriceScopeView` carries a new boolean, for example
   `quotesBasket`, true when at least one product of the basket has an offer in that scope.
2. `locationsOf` lists the shops of a scope that lie in the profile's postal codes (the
   same source that `summarizeByChain` uses), so two opens of the picker give one count.
3. A failure inside `scopesOf` is logged with the correlation id and surfaces as an empty
   `scopes` **and** a `scopesIncomplete: true` flag on the basket view, so the client can
   say "shops could not be listed" instead of drawing an empty picker.
4. The contract (`basket.messages.ts`, `basket.schemas.ts`), the gateway mapper, the OpenAPI
   document and the admin wire types carry the two new fields.

### Scope

- `apps/luna-shopper-backend/gateway/src/app/baskets/basket-catalog.service.ts` and its
  spec; `catalog-suggest.service.ts` if `chainsOf` must accept unreferenced scopes.
- `libs/luna-shopper/contracts/src/lib/messages/basket.messages.ts` and
  `src/schemas/messages/basket.schemas.ts`.
- `apps/luna-shopper-backend/gateway/docs/openapi.json` and
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, both regenerated, never edited.
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- Both new fields are optional in the schema until velista `0153` reads them, so a mixed
  fleet during a staging deploy keeps working.
- No change to which products a scope quotes, to `scopesOfRead`, or to the price policy
  (plan `0080`). Only the list of scopes and their shops changes.
- Run both generators and commit the diffs:
  `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types`. On Windows a stale file is line endings
  first, see the repo notes. Then `npx nx build luna-shopper-admin`, because the PR checks
  do not build it.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change `BasketRowView`, the basket
  read's price fields, or anything in `libs/velista`.
- If listing every scope of the profile makes the basket read measurably slower on the
  slot (more than about 50 ms on `GET /v1/baskets/:id`), stop and report the number. The
  read is already the slowest route in the report.

### Progress evidence

- New specs, each failing before the change:
  - a profile that resolves to a Lidl scope that quotes no product of the basket still
    gets that scope in `scopes`, with `quotesBasket: false`;
  - a scope that quotes one product gets `quotesBasket: true`;
  - the shops of a scope are the ones inside the profile's postal codes, and a change of
    the basket's rows does not change them;
  - a thrown lookup gives `scopes: []` and `scopesIncomplete: true`.
- `npx nx run-many -t lint test -p luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models`
  passes, including `openapi-document.spec.ts` and `wire-types.spec.ts`.
- `npx nx build luna-shopper-admin` passes.

## 1. Not in this plan

- Drawing "no prices here yet" on a chain. Velista `0153` does that from `quotesBasket`.
- Pricing a basket at a shop that quotes nothing (F5.2). That is velista `0153` too.
- Freezing the amounts of a finished trip (F5.6). It needs recorded prices on the row
  view and a product decision on "left". See the priorities note of the e2e report.

## 2. Choices that are mine

- **Every scope of the profile, with a flag, rather than a second request.** The client
  already refuses a shop outside `scopes`, so a chain must be in the read to be choosable.
  One field keeps the picker on one source.
- **Shops by postal code.** It is what the supermarkets page shows, and a person expects
  the two lists to agree.
- **A visible `scopesIncomplete`.** A silent `[]` is what hid S17 and part of F5.3.
