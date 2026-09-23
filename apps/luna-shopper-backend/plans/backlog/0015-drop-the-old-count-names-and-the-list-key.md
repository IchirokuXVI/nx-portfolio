# 0015 (backlog) Drop the old count names and the list key

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> **Priority: low.** Plan `0159` gave the purchase counts and the trip counts names that say
> what they count, and answered a new basket under `basket`. It kept the old names beside the
> new ones for one release, marked deprecated, so that a velista build from before `0159` keeps
> working. This file is the other half: remove them once that release is out.

## Brief for the agent

### Objective

Remove the deprecated names that plan `0159` kept for one release, from the contracts, from
core, and from the OpenAPI document.

### Context

- **Purchases** (`GET /v1/purchases/sessions`): `PurchaseEntryView` carries `lineCount` (same
  value as `settledLineCount`) and `boughtLineCount` (same value as `anyBoughtLineCount`).
  Written by `core/src/app/purchases/purchases.mappers.ts`.
- **Trips** (`GET /v1/lists/{id}/trips`): `TripView` carries `boughtLineCount` (same value as
  `fullyBoughtLineCount`). Its `lineCount` is **not** deprecated and stays. Written by
  `core/src/app/lists/trips/trips.mappers.ts`.
- **Basket run** (`POST /v1/baskets`): `BasketRunResult` carries `list` (same value as
  `basket`). Written by `core/src/app/baskets/basket.service.ts`, in `create`.
- The schemas are in `libs/luna-shopper/contracts/src/schemas/messages/`
  (`purchase.schemas.ts`, `list.schemas.ts`, `basket.schemas.ts`), each marked
  `deprecated: true`.
- Velista reads only the new names since `0159`, so nothing in velista changes.

### Target state

- The three answers carry only the new names and `basket`.
- The core specs that assert the old names beside the new ones assert only the new ones.
- `openapi.json` and admin `wire-types.ts` are regenerated.

### Constraints

- Do not start before a velista release that includes `0159` is in production. An older build
  reads the old names, and a new basket then fails to open in it.
- No count changes meaning.
- The SQL row aliases (`lineCount`, `boughtLineCount` in `purchases.sql.ts` and `trips.sql.ts`)
  are internal, and renaming them is optional.

### Progress evidence

- `grep -rn "deprecated: true" libs/luna-shopper/contracts/src/schemas/messages/` finds none of
  the four fields.
- `npx nx test luna-shopper-backend-core` and `npx nx test luna-shopper-backend-gateway` pass.
- The purchases, trips and basket integration suites pass under `test-integration`.
