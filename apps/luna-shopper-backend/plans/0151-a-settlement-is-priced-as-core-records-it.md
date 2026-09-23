# 0151: a settlement is priced as core records it

> Found by `0150` (report finding 2, shopper F14). Prerequisite reading: `0143` section 4.2
> (the five steps that price a settle), `0142` (what a purchase is), and in the code
> `settle-price.service.ts` in the gateway and `basket-settle.service.ts` in core.

A shopper settled 11 basket rows at a shop that had a price for every product, and every
`line_settlements.pricePaidCents` came back empty. The trip reads `spent: null` and
`unpricedCount: 9`. The request was correct: `SettleBasketRowDto` tells the caller to send
`itemId` only "when it is not what the row suggests", so the caller left it out. The gateway
prices a settle from `dto.itemId` alone, and core fills the item in afterwards. The two
services use two different defaulting rules, and the price falls between them.

Velista always sends `itemId` for a row with a single option
(`libs/velista/data-access/src/lib/baskets/basket-store.ts:424-435`), which is why the app
never showed the defect. Any other client does.

## Brief for the agent

### Objective

Make the gateway price a settle for the same item that core records, when the request names
no `itemId`, on the basket route and on the list route.

### Context

- `gateway/src/app/baskets/basket.controller.ts:297` passes `itemId: dto.itemId`, which is
  undefined when the caller follows the DTO's own advice.
- `gateway/src/app/baskets/settle-price.service.ts:199-201` answers `null` at once when
  there is no `itemId`, without asking catalog. Lines 150 to 160 then return the scope and
  location with two null prices. `settle-price.spec.ts:227` asserts this on purpose, because
  `0143` section 4.2 step 3 says "No itemId gives the two nulls and keeps the scope".
- Core picks the item after the price was read: `core/src/app/baskets/basket-settle.service.ts:92`
  calls `resolvePick`, and lines 393 to 400 choose the row's only option when `itemId` is
  absent. So the settlement stores item `031cdaa4` and no price.
- The list route has the same shape: `gateway/src/app/lists/list.controller.ts:566-573`
  passes `dto.itemId`. Check what `core/src/app/lists/settlement.service.ts:381` does when it
  is absent before you decide whether the list route has the same defect.
- On a timeout, `settle-price.service.ts:105-119` returns the scope even when step 2 has not
  passed. `0143` section 4.2 step 5 says "null otherwise".
- `settledByUserId` is null on a basket settle **by design**. A basket settle names the
  participant, and `ck_line_settlements_actor`
  (`core/src/migrations/1756001200000-SettlementParticipants.ts:57-60`) requires exactly one
  of the two actor columns. The gap is the view: `core/src/app/lists/list.mappers.ts:170`
  exposes `settledByUserId` and leaves out `settledByParticipantId` and
  `supermarketLocationId`, so the API does not say who settled.

### Target state

- A basket settle with a scope and no `itemId`, on a row that has exactly one option, stores
  the catalog price of that option at that scope.
- A row with several options and no `itemId` still stores no price, because nobody said which
  product was bought. That case is a 400 or a null price, and the plan picks one in section 2.
- The list route behaves the same way, or the plan records why it cannot differ.
- A timeout while pricing keeps the scope only when step 2 passed.
- The settlement view carries `settledByParticipantId` and `supermarketLocationId` beside
  `settledByUserId`.

### Scope

Work only in:

- `apps/luna-shopper-backend/gateway/src/app/baskets/` (settle price service, controller, specs)
- `apps/luna-shopper-backend/gateway/src/app/lists/list.controller.ts` and its spec
- `apps/luna-shopper-backend/core/src/app/baskets/` (the scope search answer)
- `apps/luna-shopper-backend/core/src/app/lists/list.mappers.ts` and the settlement view type
- `libs/luna-shopper/contracts` for the `BASKET_PATTERNS.searchScope` request and answer and
  the settlement view, plus the regenerated `openapi.json` and `wire-types.ts`

Do not touch: `effective-price.ts`, price policies, catalog's price tables, anything under
`apps/velista/` or `libs/velista/`, or the actor check constraint.

### Constraints

- **The gateway prices the item core will record, never a guess of its own.** Core owns
  `resolvePick`, so core answers which item a row resolves to. Do not copy the rule into the
  gateway.
- No backfill. Old settlements stay unpriced, because the price at settle time was never read
  and today's price is a different fact.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding a migration, changing the actor check constraint, or changing
what velista sends.

### Progress evidence

- A gateway spec: "no itemId, single option row, scope with a price, stores the price".
- A gateway spec: "no itemId, several options" behaves as section 2 decides.
- `settle-price.spec.ts:227` is rewritten to the new rule, and the rewrite says why.
- A core spec for the scope search answer that now carries the resolved item.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types` are run, and their diffs are committed.
- `npx nx test luna-shopper-backend-gateway` and `npx nx test luna-shopper-backend-core` pass.

## 1. Where the item comes from

Option A, which this plan takes: the gateway already asks core for the row's scope through
`BASKET_PATTERNS.searchScope`. Add `rowKey` to that request, and let core answer
`pickedItemId`, which is `resolvePick(row, undefined)`: the row's only option, or null. The
gateway then prices `dto.itemId ?? scope.pickedItemId`. This costs no extra request.

Option B, rejected: make `itemId` required whenever a scope is sent. It breaks every client
that follows the DTO today, and it moves core's rule into each client.

## 2. A row with several options and no item

Answer 400 `item_required` when the row has more than one option, a scope was sent, and no
`itemId` was sent. A price cannot be read without an item, and a settlement with a scope and
no product says less than the caller knows. Velista never sends this shape, so nothing in
the app changes.

## 3. The list route

Read `core/src/app/lists/settlement.service.ts:381`. If core also defaults the item there,
apply section 1 to `lists/settle` with the same contract field. If it does not default, the
list route has no defect, and this plan says so in its PR description.

## 4. The timeout

`settle-price.service.ts:105-119`: on a timeout, keep the scope only when the scope was
resolved before the timeout. Otherwise store no scope. This is `0143` section 4.2 step 5 as
written.

## 5. Who settled

Add `settledByParticipantId` and `supermarketLocationId` to the settlement view in
`list.mappers.ts:170` and to its contract type. Keep `settledByUserId`. The trips query
already resolves the buyer with `COALESCE(settledByUserId, p.userId)` (`trips.sql.ts:169`),
so no reader loses anything.

## 6. Checking it by hand

On a slot with the `0150` data or the seed, settle one single option row through
`POST /v1/baskets/{id}/rows/{rowKey}/settle` with a scope and no `itemId`, then read
`GET /v1/purchases/sessions`. `spent` is not null, and `unpricedCount` drops by one.
