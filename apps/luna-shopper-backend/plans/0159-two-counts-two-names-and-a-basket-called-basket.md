# 0159: two counts, two names, and a basket called basket

> Found by `0150` (shopper F15 and F17). Prerequisite reading: `0122` (trips), `0142`
> (purchases), `0144` (a generated list is called a basket), and in velista
> `purchase-mappers.ts`, `trip-mappers.ts` and `mappers.ts` in
> `libs/velista/data-access/src/lib/`.

After one trip, two screens counted the same basket differently. `GET /v1/purchases/sessions`
said `lineCount` 11 and `boughtLineCount` 9. `GET /v1/lists/{id}/trips` said 14 and 8. Each
query matches the plan that wrote it. The defect is that two different questions use the
same field names. Separately, `POST /v1/baskets` answers `{ "list": { … } }`, so a client
reads a basket under a key named after the other thing a shopper has.

## Brief for the agent

### Objective

Give the purchase counts and the trip counts names that say what they count, and answer a
basket under `basket`, changing velista's mappers in the same change so the app never breaks.

### Context

- **Purchases** (`core/src/app/purchases/purchases.sql.ts:246-285`): `lineCount` is lines
  this person settled (9 bought + 2 not available = 11). `boughtLineCount` is lines with
  `bought > 0`, so the partly bought dorada counts (9). `0142` defines exactly this.
- **Trips** (`core/src/app/lists/trips/trips.sql.ts:84-124, 253-256`): rows come from
  `basket_rows`, so all 14 lines count, pending ones too. `boughtLineCount` is
  `bought > 0 AND bought >= asked`, fully bought (8). `0122` defines exactly this, and it
  matches the basket's own `done: 8`.
- Velista reads both: `purchase-mappers.ts`, `trip-mappers.ts`, `select-trip-groups.ts`.
- **The basket key.** `libs/luna-shopper/contracts/src/lib/messages/basket.messages.ts:665-667`
  (`BasketRunResult { list: BasketHeaderView }`), whose doc says the wrapper "stays for one
  plan". Schema: `contracts/src/schemas/messages/basket.schemas.ts:508-512`. Written by
  `core/src/app/baskets/basket.service.ts:182` and after `:213`. Passed through by
  `gateway/src/app/baskets/baskets.controller.ts:93-96`.
- Velista reads `raw['list']` (`libs/velista/data-access/src/lib/mapping/mappers.ts:1351`),
  and `basket-list-api.ts:117` throws through `required(…)` when it is missing, then
  `basket-list-store.ts:308` uses `run.list`. A rename alone breaks basket creation.
- Also reading the key: core `basket-run.spec.ts:323, 566, 593`, velista
  `basket-list-store.spec.ts:357`, `openapi.json`, and admin `wire-types.ts:1926`.

### Target state

- Purchases answer `settledLineCount` (was `lineCount`) and `anyBoughtLineCount` (was
  `boughtLineCount`).
- Trips answer `lineCount` (all lines the basket covers) and `fullyBoughtLineCount` (was
  `boughtLineCount`).
- For one release, each answer also carries the old names with the old values, marked
  deprecated in the OpenAPI document. Velista reads only the new names.
- `POST /v1/baskets` answers `{ basket: … }` and, for one release, `list` beside it with the
  same value. Velista reads `basket`.
- A follow up is recorded in `plans/backlog/` to drop the old names.

### Scope

Work only in:

- `apps/luna-shopper-backend/core/src/app/purchases/`, `core/src/app/lists/trips/`,
  `core/src/app/baskets/basket.service.ts`, and their specs
- `apps/luna-shopper-backend/gateway/src/app/baskets/baskets.controller.ts` and the purchase
  and trip controllers, if they shape the answer
- `libs/luna-shopper/contracts` for the three answers, plus the regenerated `openapi.json`
  and `wire-types.ts`
- `libs/velista/data-access/src/lib/` (the three mappers and their specs), which is the only
  velista code this plan touches
- one new backlog plan in `apps/luna-shopper-backend/plans/backlog/`

Do not touch: velista components or templates, what any count means, or the basket's own
`done` and `pending` counts.

### Constraints

- **No count changes meaning.** Only names change.
- Velista mappers follow the D4 rule: they map from `unknown` and never pass a backend DTO
  through.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: removing an old name in this plan, or changing a velista screen.

### Progress evidence

- Core integration specs assert both old and new names on both answers.
- `basket-run.spec.ts` asserts `basket` and `list`.
- Velista mapper specs read the new names. `npx nx test velista-data-access` passes (use the
  real project name from `nx show projects`).
- Tests pass for core and gateway, and the OpenAPI and wire types are regenerated.
