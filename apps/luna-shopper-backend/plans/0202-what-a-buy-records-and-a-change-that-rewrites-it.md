# 0202: what a buy records, and a change that rewrites it

> Asked for by the owner on 2026-10-11, with the redesign of the shopping list:
>
> - "When you buy a line, the product that it had assigned must be recorded, along with its
>   current price. It is also needed to save the chain and shop where you bought it."
> - "If the line's products are changed from its line detail page, the previous buys aren't
>   affected. If the product is changed from the basket, the recent buys (the ones
>   displayed on the basket list) will be overwritten with the new selected product."
> - A change from the basket can be kept or can hold for this trip only: "you need to be
>   able to do both things from the basket". For the trip only: "Can't it be recorded on
>   the buy record? I bought X product, and the buy is linked to the line, so you know it
>   was bought a single time because the line's product wasn't changed."
> - On a buy with no shop: "The user always has the option to not select any shop but
>   prices will still be recorded (go with the cheapest one in this case)." Shop and chain
>   stay empty.
>
> Build plan `0201` first. Velista plans `0140` and `0141` are the screens.
>
> Prerequisite reading: plan `0201`, plan `0143` and `0151` (what was paid, recorded at the
> shelf), plan `0163` and `0165` (the shop and the chain of a settlement), plan `0142` (the
> purchase history), plan `0199` (the favourite), plan `0076` section 3 (what a writer may
> change on an approved line), backlog `0020` (a merged product),
> `core/src/app/entities/line-settlement.entity.ts`,
> `core/src/app/baskets/basket-settle.service.ts`, `basket-revert.service.ts`,
> `core/src/app/lists/line.service.ts`, `core/src/app/purchases/`,
> `gateway/src/app/baskets/settle-price.service.ts` and `basket.controller.ts`
> (`paidFor`).

A buy already copies the id of the product, the price of one unit, the price scope, the
shop and the chain. Three things are missing: what the product was called, a price when no
shop is chosen and the page drew none, and a way to correct the product of the buys of a
trip.

## Brief for the agent

### Objective

Record the name of the product on every buy, let the gateway choose the price of a buy,
and add one route that changes the product of basket lines: it rewrites the buys of the
trip, and it writes the favourite of the line when the change is kept.

### Context

Every statement below was read on `dev` at `6cced1bd`. Check each one before you rely on
it.

- **A settlement** (`line_settlements`) holds `lineId`, `listId`, `basketId`, `itemId`,
  `outcome`, `quantity`, who and when, `revertedAt`, `pricePaidCents` (one unit),
  `pricePaidCurrency`, `priceScopeId`, `supermarketLocationId` and `supermarketId`.
- **No name is copied.** The history shows the name of the line as it is today
  (`purchases.sql.ts`). A catalog product that is merged or removed later leaves an id
  that names nothing.
- **The gateway reads the price, never the client** (`SettlePriceService.read`, a budget
  of 750 ms, null on any failure). It reads only at the `priceScopeId` the client sends.
  With no `priceScopeId` it records nothing and does not ask the catalog.
- **The chain is stored from the scope**, also when no shop was chosen.
- **The table has a check that a shop needs a price scope**
  (`"supermarketLocationId" IS NULL OR "priceScopeId" IS NOT NULL`, velista plan `0114`).
  Read every check of the table before you write the migration.
- **Velista sends `priceScopeId`** as the scope of the price the row drew, and
  `supermarketLocationId` only when a shop is chosen.
- **A revert never deletes.** It sets `revertedAt` and gives the units back to the line.
- **`PATCH /v1/lines/:id`** takes `itemIds` (the whole set), `adoptItemIds` and
  `favoriteItemId`, which must be in the set after the update.

### Target state

1. A settlement holds a copy of what the product was called (section 1).
2. The gateway chooses the price: at the shop when there is one, else the cheapest across
   the scopes of the owner, with no shop and no chain (section 2).
3. `POST /v1/baskets/:id/lines/product` changes the product of the named lines
   (section 3).
4. The history answers the copied name (section 4).

### Scope

- `apps/luna-shopper-backend/core`: one migration, the settlement entity, the settle
  services of the basket and of the list page, the new operation, the purchase reads.
- `apps/luna-shopper-backend/gateway`: `SettlePriceService`, `paidFor`, the new route and
  its DTO, `openapi.json`.
- `libs/luna-shopper/contracts`: `SettlementPaid`, the settlement and purchase views, the
  new pattern and its schemas.
- `libs/luna-shopper-admin/models`: the regenerated wire types only.

### Constraints

- **A settlement is never deleted and never edited in place**, except for its own
  `revertedAt`. A rewrite is a new row beside the old one.
- **A change from the line page touches no buy.** Only the new route rewrites.
- **The price read keeps its budget and never fails a buy.** No price is a valid answer.
- **A guest cannot use the new route.**
- **`openapi.json` and the wire types are generated output.**

### Action boundaries

- Do not build velista plans `0140` or `0141`.
- Do not change the session rule, the totals of a trip, or the usual shop of plan `0165`
  beyond what section 2 states.
- Do not store a choice "for this trip only" that has no buy yet. The owner decided it
  lives on the device for now.

### Progress evidence

- `npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway`
  pass, with the integration specs of the migration, the rewrite and the price read run on
  a slot.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types` are run and their diffs committed.

## 1. The name on a buy

- `line_settlements` gains `itemSnapshot jsonb null`: the name, the brand and the size of
  the product, with the field names `ItemView` uses. Read `ItemView` first and copy only
  those three.
- The gateway reads the item for the price already. It hands the snapshot to core inside
  `SettlementPaid`. With no catalog answer inside the budget the snapshot is null.
- The settle of the list page (`POST /v1/lines/:id/settle`) records it too.
- Rows from before this plan stay null. There is no backfill.

## 2. The price the gateway chooses

For a buy with a product:

- **With a shop** (`supermarketLocationId`, or the basket's own shop): the price at the
  quoted scope of that shop. The settlement stores the scope, the shop and the chain, as
  today.
- **With no shop**: the cheapest offer across the resolved scopes of the owner
  (`offers: 'best'`). The settlement stores the price and that scope. **The shop and the
  chain are null.** This is a change: today the chain is stored from the scope.
- A buy with no shop therefore counts for no chain in "usual" (plan `0165`). The owner
  accepted that a buy with no shop names no place.
- `priceScopeId` in the request becomes optional and is no longer read. Keep it in the DTO
  for one release, because staging deploys only what changed.
- The shop lock of a basket started at a shop (`basket_shop_locked`) does not change.

## 3. Changing the product of lines from the basket

`POST /v1/baskets/:id/lines/product` with `{ lineIds, itemId, keep }`.

For each named line, in one transaction:

1. **Rewrite the buys of the trip.** Every settlement of the line through this basket in
   the current trip, with the outcome bought and no revert, gets `revertedAt`. A new row
   is inserted beside it with the same line, list, basket, quantity, person and
   `settledAt`, the new `itemId`, its snapshot and its price, and `replacesSettlementId`
   set to the old row. **The quantity of the line does not move.** A rewrite gives no unit
   back.
2. **When `keep` is true, write the line.** The product is added to the products of the
   line when it is not there, and it becomes `favoriteItemId`. Call the update of
   `LineService`, so its permissions, its change row and its events apply.

- **The price of a rewrite** is read by the gateway at the price scope of the old row.
  With none there, section 2 applies.
- **`replacesSettlementId uuid null`** is the second new column. The history uses it to
  tell a correction from a revert: a replaced row is not shown as given back.
- **`keep: false` with no buy in the trip writes nothing**, and the route answers the lines
  unchanged. The page holds that choice on the device until the first buy (velista plan
  `0140`). After that buy, plan `0201` section 1 step 1 makes the line follow it.
- **Who may call it**: an account participant. `keep: true` also needs the right to edit
  each line (plan `0076`). A line that fails that check fails the whole request with
  `forbidden`, and nothing is written.
- The answer is `BasketRowResult` as plan `0201` defines it.

## 4. The history

- The session rows (`GET /v1/purchases/sessions/:kind/:id/rows`) and the settlements of a
  line (`GET /v1/lines/:id/settlements`) answer `itemSnapshot` beside `itemId`.
- A row with `revertedAt` that another row replaces is left out of both reads. A plain
  revert is shown as today.
- The totals of a session use the rows that are shown.

## 5. Tests

- The migration, up and down, on a real Postgres.
- A buy at a shop, a buy with no shop (the cheapest scope, no shop, no chain), a buy when
  the catalog does not answer (no price, no snapshot, the buy is still written).
- The rewrite: two buys of one line in the trip become two new rows, a buy outside the
  trip is untouched, a reverted buy is untouched, the quantity of the line is unchanged,
  the history shows the new product once.
- `keep: true`: the product joins the line and is the favourite. `keep: false`: the line
  is unchanged.
- A guest, a line that is not covered, a line the actor may not edit with `keep: true`.

## 6. Not in this plan

A choice for this trip that is stored before its first buy, a backfill of old buys, and
the product of a merged catalog entry (backlog `0020`).
