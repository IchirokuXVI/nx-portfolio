> **PR:** [#493](https://github.com/IchirokuXVI/nx-portfolio/pull/493)

# 0114: "I bought it" asks the shop

On a zone list, the line sheet's "I bought it" asks how many were bought and which product, then
settles the line. It never asks where. The basket records the shop it is buying at (plan
`0102`), and backend `0165` counts where each line is usually bought from those records, so
purchases made from a zone list are invisible to it. The user wants the same step to ask for the
shop too, as an optional choice.

## What exists

- The step: `libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.{ts,html}`.
  `startBought()` opens the `howMany` step (quantity stepper, product choice), and
  `recordBought()` calls `_settle('BOUGHT', howMany)`, which calls
  `LineStore.settle(lineId, outcome, { quantity, itemId })`.
- The client: `libs/velista/data-access/src/lib/lines/line-api.ts` POSTs
  `/v1/lines/:id/settle`. `SettleLineRequest` in `libs/velista/models/src/lib/requests.ts`
  and the service options in `line-service.ts` carry only `quantity` and `itemId`.
  `line-memory.ts` is the in memory double.
- The gateway: `apps/luna-shopper-backend/gateway/src/app/lists/list.controller.ts`,
  `@Post(':id/settle')`. `SettleLineDto` already accepts optional `priceScopeId` and
  `supermarketLocationId`, but the shop is used **only when `priceScopeId` is present**: the
  gateway reads the price for that scope and shop and sends it to core as `paid`.
- The database: `line_settlements` has a check that a shop requires a price scope
  (`"supermarketLocationId" IS NULL OR "priceScopeId" IS NOT NULL`).
- The shop picker: `ShopPicker` (`libs/velista/ui/src/lib/shops/shop-picker.ts`) is
  presentational and already reused by the get list sheet. `NearMeButton` is beside it.
  `ShopFinderServiceI.nearProfile(point, profileId?)` and `recentShops()` need no basket.
  `ShopPickerSheet` in feature-shopping-lists is tied to the basket and is not reusable as is.

## The decision

The client sends only the shop. The gateway works out the price scope from the shop when the
request has a shop and no scope, reads the price as it already does, and passes both to core.
The database check stays, so a settlement never names a shop without a scope. A shop whose price
scope cannot be resolved for that product is recorded as no shop, and the purchase still
succeeds: the shop is optional and never blocks "I bought it".

## Brief for the agent

### Objective

Let the zone list's "I bought it" step record, optionally, the shop the product was bought at,
so that backend `0165` counts it.

### Target state

1. **The step.** Under the quantity and the product, the `howMany` step shows an optional
   "Where did you buy it?" / "¿Dónde lo compraste?" row, collapsed by default and showing
   "Not specified" / "Sin indicar". Opening it shows `lib-shop-picker` with the recent shops
   first and a "near me" button, fed by `recentShops()` and `nearProfile()`. The choice can be
   cleared. Confirming with no shop settles exactly as today.
2. **Remembering.** The last chosen shop on this device is preselected the next time, the way
   the basket remembers its shop, and can be cleared.
3. **The request.** `LineStore.settle` and the API send `supermarketLocationId` when a shop is
   chosen. The models own their types (rule D4).
4. **The gateway.** When `supermarketLocationId` is present and `priceScopeId` is not, resolve
   the shop's price scope for the settled item (through the catalog, the same way the basket
   resolves the scope it shows), then read the price as today. If nothing resolves, send no
   `paid` and no shop, log it at debug level, and answer as today.
5. **Backend `0165`.** A zone list purchase with a shop counts toward "usually bought here" for
   that chain. Prove it with an integration test or a read after the write.

### Scope

Work in `libs/velista/feature-lists/src/lib/line-detail-sheet`, `libs/velista/data-access`
(the line store, service, API, memory double, and a small "last shop" memory if needed),
`libs/velista/models`, `libs/velista/ui/src/lib/shops` only if the picker needs a small input,
the two translation files, the gateway's settle handler and its specs, and, only if the DTO
changes, `openapi.json` and `wire-types.ts` regenerated with the two commands in CLAUDE.md.

Translation anchor: new keys go in the block that holds the sheet's `bought` key, after it.

### Constraints

- Use the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- Do not relax the `line_settlements` check and write no migration.
- Copy is for people not at home with apps: short, and the shop is plainly optional.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- adding a migration or changing the database check
- making the shop required
- changing the basket's settle flow

### Progress evidence

- `npx nx run-many -t lint,test -p velista/feature-lists velista/data-access velista/models velista/ui luna-shopper-backend-gateway`
  green, `npx nx build velista` green, and the gateway's `openapi-document.spec.ts` green.
- Specs: the step with and without a shop, the remembered shop, the gateway resolving the scope
  from the shop, and the fallback when nothing resolves.
- A browser check against a backend running this branch: buy a line with a shop from a zone
  list, then read `line_settlements` and see the shop and the scope.
