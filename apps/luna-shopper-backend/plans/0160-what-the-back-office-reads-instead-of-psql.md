# 0160: what the back office reads instead of psql

> Found by `0150` (the three findings read with psql, and the gaps in the back office that
> forced a script). Admin plans `0033` and `0035` in `apps/luna-shopper-admin/plans` draw the
> screens. This plan is the gateway half, and they are blocked on it. Prerequisite reading:
> `0080` sections 4 and 5 (the overrides snapshot and protection), and in the gateway
> `catalog-admin.controller.ts`, `harvest.controller.ts` and the admin basket views.

The `0150` operator needed psql three times. It showed that settlements carry no paid price
(finding 2). It found the four rows walk 2 inserted for Dorada (finding 5). It counted which
EANs several products share. The operator also needed a Node script to register 65 brands
and another to write prices with a past `observedAt`. None of these is a screen problem
alone: the gateway has no route that answers them.

## Brief for the agent

### Objective

Add the admin reads and writes an operator needs to check a catalog without a database
client: the price rows a run wrote, why a price is shown, an item's source bindings, a
basket row's paid price, a past `observedAt` on a hand price, and registering many brands at
once.

### Context

- `GET /v1/admin/catalog/item-prices` filters by `itemId` and `priceScopeId` only. There is
  no run filter. `item_prices.sourceRunId` and `lastObservedRunId` exist.
- The admin price detail shows every row for one item and scope with a "shown" badge, but
  nothing says why a row wins, `protectedUntil` is never sent as a date, and there is no read
  of one item across all its scopes.
- `POST /v1/admin/catalog/item-prices` takes no `observedAt`. Protection lasts 7 days from
  `observedAt` (`effective-price.ts`), so a row written now cannot show expiry for a week.
- There is no gateway admin route for an item's source entries
  (`source_catalog_entries` in the harvester, with `externalId`, `ean`, `status`,
  `matchedBy`). The entries queue answers from the entry side only.
- `AdminBasketRowView` carries `rowKey, content, left, bought, asked` and no settlement.
  `line_settlements` holds `pricePaidCents`, `priceScopeId`, `supermarketLocationId`,
  `outcome`, `quantity` and the actor columns.
- Brands: `POST brands` and `POST brands/register-suggestion`, one at a time
  (`catalog-admin.controller.ts:575-625, 763`). The admin brands page says "There is no bulk
  register" on purpose, to keep each registration a decision. A bulk route keeps that: a
  person still chooses every name on the list.
- Response envelope: admin routes answer the object itself, not `{ tokens, data }`.

### Target state

- `GET /v1/admin/catalog/item-prices?runId=` lists the rows a run inserted
  (`sourceRunId`) or confirmed (`lastObservedRunId`), each with a `writtenBy` of `INSERTED`
  or `CONFIRMED`, paged.
- `GET /v1/admin/catalog/items/{id}/prices` answers every scope of the item, each with all
  its rows, the shown row, and `shownBecause`: one of `PROTECTED_ADMIN`, `POLICY_PRIORITY`,
  `ONLY_ROW`, `NEWEST`, plus `protectedUntil` and the overrides snapshot where they apply.
  The reason comes from the same function that decides, never from a second copy of the rule.
- `POST /v1/admin/catalog/item-prices` accepts `observedAt` up to 30 days in the past and
  never in the future. Protection still runs from `observedAt`, so a past date protects a row
  for less time, never more.
- `GET /v1/admin/harvest/items/{itemId}/entries` lists the source entries bound to an item,
  and for each EAN, how many entries of that chain share it.
- `AdminBasketRowView` carries its settlements: outcome, quantity, `pricePaidCents`, scope,
  location and who settled.
- `POST /v1/admin/catalog/brands/register-many` takes up to 200 `{ label, privateLabelOf? }`
  and answers one outcome per name: `CREATED`, `EXISTS` with the id, or `REFUSED` with the
  reason. It never fails the whole batch for one name.

### Scope

Work only in:

- `apps/luna-shopper-backend/gateway/src/app/catalog/`, `harvest/` and `admin/` (routes,
  DTOs, specs)
- `apps/luna-shopper-backend/catalog/src/app/catalog/` for the price reads, the reason, the
  `observedAt` write and the brand batch
- `apps/luna-shopper-backend/harvester/src/app/harvest/` for the entries by item read
- `apps/luna-shopper-backend/core/src/app/` for the admin basket row settlements
- `libs/luna-shopper/contracts`, plus the regenerated `openapi.json` and `wire-types.ts`

Do not touch: the price decision itself, price policies, the admin app, or shopper routes.

### Constraints

- **Explaining a price never changes it.** `shownBecause` is returned by the decision
  function beside its answer. Do not reimplement the decision.
- Every new read is admin only and paged where it can grow past 200 rows.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: allowing `observedAt` in the future, a migration, or changing
`effective-price.ts` beyond returning the reason it already computes.

### Progress evidence

- Gateway specs for each new route and field, including the 30 day and future limits.
- A catalog spec: `shownBecause` for a protected `ADMIN` row, a disputed one, a policy win
  and a single row.
- A brand batch spec with one new, one existing and one refused name.
- Tests pass for gateway, catalog, harvester and core, and the OpenAPI and wire types are
  regenerated.
