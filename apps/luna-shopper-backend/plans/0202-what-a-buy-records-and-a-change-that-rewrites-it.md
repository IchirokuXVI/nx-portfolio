> **PR:** [#703](https://github.com/IchirokuXVI/nx-portfolio/pull/703)

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

## Review of 2026-10-11: settle these before you build

A review of pull request #693 checked this plan against the code on `dev`. Where this
section and a later section disagree, this section is right.

1. **"The chain is stored from the scope, also when no shop was chosen" is false, and so
   is "This is a change".** `gateway/src/app/baskets/settle-price.service.ts` (`shopOf`,
   `shopIn`) sets `supermarketId` only from a named shop. The constraint
   `ck_line_settlements_location_scope` in
   `core/src/app/db/migrations/1756003500000-SettlementChain.ts` forbids a chain with no
   shop. A buy with no shop stores no chain today. Do not look for code that stores one.
   The check that the context quotes is the older form with one clause. The live one has
   two.
2. **Section 1 copies "the name, the brand and the size".** `ItemView`
   (`catalog.messages.ts`) has no size field. The size is `unitSize` with `defaultUnit`
   and `packCount`, and `name` is localized. State which fields and which locale are
   copied.
3. **The rewrite of section 3 sets `revertedAt`.** `ck_line_settlements_revert` also
   needs `revertedByParticipantId`. State who that participant is.
4. **The price of section 3 is "read at the price scope of the old row" inside one core
   transaction.** The gateway reads prices, so it needs a read of those rows first. The
   plan does not state that read.
5. **Section 3 names no error code** for a line that the basket does not cover or for an
   unknown item.
6. **`readAtShop` prices a buy at the quoted scope of a shop today**, for the settle of
   the list page. "With no `priceScopeId` it does not ask the catalog" is true for the
   basket path only.

## What the build decided

The build of 2026-10-13 settled the points below. Each one is a choice of the builder that
the owner can overturn. Where this section and a later section disagree, this section is
right. Plans `0201`, `0203` and `0204` were on the base branch.

**The four review points.**

1. **Review point 2: the snapshot copies five fields, in every locale.** `name`, `brand`,
   `unitSize`, `packCount` and `defaultUnit`, under the names of `ItemView`. The size of a
   product is `unitSize` with `defaultUnit`, and `packCount` tells a pack of six cartons of
   one litre from one bottle of six litres. `name` is the whole `LocalizedText`, with every
   locale that the catalog held. A buy has no reader yet, so no locale is chosen at the
   shelf. The reader of a history chooses it, as for a product. The contract type is
   `ItemSnapshot`. Core checks the shape, copies those five fields and drops every other
   field.
2. **Review point 3: `revertedByParticipantId` is the person who made the change.** It is
   the participant who sent `lines/product`. That person ended the row, as the person who
   takes a buy back does. The buyer stays on the new row in `settledByParticipantId`. So a
   rewritten buy can name two people: who bought, and who corrected the product.
3. **Review point 4: the gateway asks `basket.searchScope` where the buys were priced.**
   The request takes `tripBuys: true` beside `lineIds`. The answer gains
   `tripBuys: { priceScopeIds, unscoped }`: the distinct price scopes of the standing buys
   of those lines in the trip, and whether a buy has no scope. No new pattern is needed,
   because the gateway already asks this question before every priced write, for the owner,
   the profile and the shop of the basket.
   - The gateway reads the new product once at those scopes (`offers: 'all'`) and sends
     `prices: { priceScopeId, pricePaidCents, pricePaidCurrency }[]`.
   - For a buy with no scope it sends `paid`, chosen by the rule of section 2: at the shop
     of the basket when it has one, else the cheapest.
   - Core applies them by scope. A rewritten buy **keeps the scope, the shop and the chain
     of the buy it replaces**, because the place did not change. It takes the price of the
     new product at that scope, or no price.
   - The prices are keyed by scope and not by settlement, so a buy made between the read and
     the write is still rewritten. It keeps its place and gets no price when its scope was
     not read.
   - One budget of 750 ms covers the price read. When the catalog does not answer in time,
     the buys are still rewritten, with no price and no name. Core still sees no price.
4. **Review point 5: the error codes.**

   | Case | Answer |
   | --- | --- |
   | A named line is not a row of the basket | 404 `not_found`, "Row not found", for the whole write. This is the answer of `BasketRowResolver` |
   | The catalog answers, and `itemId` is not in the answer | 400 `validation_failed` on `itemId`, from the gateway. Core is not asked |
   | The catalog fails or is slow | no refusal. This is decision 3 of plan `0201` |
   | A guest | 403 `forbidden`, from the gateway, before core or the catalog is asked. Core refuses a guest too |
   | `keep: true` and a line that the actor may not edit | 403 `forbidden`, and nothing is written |
   | A finished basket | 409 `basket_finished` |

**Review points 1 and 6.** A buy with no shop stored no chain before this plan, and it
stores none now. The build looked for no code that stores one. The check
`ck_line_settlements_location_scope` is not changed. The migration spec asserts that each
of the six checks of the table still refuses what it refused.

**What a buy records (sections 1 and 2).**

5. **The snapshot is beside `paid`, not inside it.** Section 1 puts it inside
   `SettlementPaid`. That type cannot be sent with no price scope, and a product with no
   price in any scope still has a name. So `itemSnapshot` is a field of its own on both
   settle messages and on the message of the new route.
6. **Core stores the snapshot only on a row that records a product.** A free text buy has
   no name to copy. "They had none" of a product keeps the name, because the row names the
   product.
7. **A shop with no price for the product records no price and no shop.** That is "as
   today": before this plan the client sent the scope of the price it drew, and it drew none
   at such a shop. The checks allow a shop with a scope and no price, so the owner can ask
   for the place alone. That would count more buys in "usual" (plan `0165`), and the action
   boundaries say not to change that.
8. **A shop that the catalog cannot name records nothing.** The cheapest price of the
   scopes of the owner is not used in its place, because it is not the price of that shop.
   This is the reason of plan `0201`, decision 21.
9. **The list page settle follows section 2 too.** `POST /v1/lines/:id/settle` with no shop
   now records the cheapest price across the scopes of the caller. Before, it recorded
   nothing. The owner said that a buy with no shop still records a price, and he did not
   limit that to the basket.
10. **`priceScopeId` is read on neither settle.** Both DTOs keep the field for one release
    and mark it deprecated.
11. **What is left of the pick.** `basket.searchScope` still answers `pick`. Its only use
    is the product to price and to name when the body names none. The refusal for "several
    products and none named" is removed, on the list page too. It needed a scope from the
    client, and none is read now. Such a settle records no product, no price and no name.
12. **Every basket settle asks core one question more.** Before, a settle with no scope and
    no shop asked nothing before the write. Now each settle asks `basket.searchScope`. A
    settle of lines with no product then asks the catalog nothing.
13. **A basket that was started at a shop always records at that shop.** Before, it did so
    only when the client also sent a scope.
14. **A slow catalog now costs the scope too.** Before, a scope that was already confirmed
    was kept when the budget ran out. The gateway now learns the scope from the price, so
    with no price there is no scope.

**The rewrite (section 3).**

15. **Which buys are rewritten.** Every standing `BOUGHT` settlement of the named lines
    through this basket in its trip, of any buyer, whose product is not the new one. "They
    had none", a buy that was taken back, a buy through another basket and a buy of an
    earlier session are not touched. A `LIVE` basket with no session has no trip, so nothing
    is rewritten.
16. **The same request twice writes nothing the second time.** A buy that already names the
    product is skipped. A later change replaces the row that replaced the first buy. A row
    is replaced one time, and a unique index holds that.
17. **A rewrite moves no quantity, and the sums read the same.** The line is not written,
    its `version` does not rise, and no change row is written (plan `0203`, section 1). The
    new row keeps `settledAt`, so the order of the buys does not change. A test on a real
    Postgres compares the session of a `LIVE` basket, the rows and the progress of the
    basket, the rows of another basket (`boughtElsewhere`, `BOUGHT_ELSEWHERE`, the note and
    its time) and the answer of `BASKET_ELSEWHERE_SQL`, before and after. They are equal.
18. **No rule of `libs/luna-shopper/basket-rules` changed.** The line moves to the row of
    its new product through `tripItemIdOf` as it is.
19. **What the other devices are told, with `keep: false`.** `BasketAnnouncer.basketMoved`
    sends one `basket.linesChanged` to this basket alone. Its entries state `tripItemId`,
    the new product. By plan `0204`, section 7, a device that holds the line in the row of
    another product reads the basket again. `marksMoved` is false. No other basket is told,
    because none reads anything differently. The zone is told nothing, because the line did
    not change. No event and no payload changed.
20. **What they are told with `keep: true`.** The line is edited, so the zone hears
    `line.updated`, and every basket that covers the list gets the ids alone and reads again.
    That reaches this basket too, so it gets no second envelope.
21. **`keep: true` is in the same transaction as the rewrite.** `LineService` gained
    `keepProductWithin`, which is the edit of `update` with no transaction of its own and no
    announcement, and `announceKept` for after the commit. The edit of the line page now
    runs through the same two steps. So one refusal rolls back the buys of every line, as
    section 3 asks.
22. **`keep: true` is the edit of the line page.** The actor needs `WRITE` or `MANAGE` on
    the list, themselves. A writer who does not approve puts an approved line back to
    pending (plan `0076`). The bound on the products of a line applies. A line that already
    holds the product as its favourite is not written. The permission is asked first, also
    for that line.
23. **`keep: true` with no buy in the trip writes the line.** Section 3 states only the
    case `keep: false`.
24. **`keep: false` needs no right on the list.** Any participant with an account can
    correct a buy of the trip, also on a list that they do not write. Who can settle did not
    change, and this corrects what was settled.

**The history (section 4).**

25. **A history has its own view.** `LineSettlementView` is also half of the `line.settled`
    event, and this plan changes no event. So the two history reads answer
    `LineSettlementHistoryView`, which is that view with `itemSnapshot`. The answer of a
    settle and the event keep the view with no snapshot. The owner can ask for one view. That
    adds a field to the event.
26. **Three reads leave out a replaced row.** The two of section 4, and the settlements of a
    product (`GET /v1/items/:id/settlements`), which also serves reverted rows. Without it
    the old product reads as bought and given back. The reads that count only standing rows
    need no change: a replaced row is always marked reverted.
27. **The back office is not changed.** Its list of the settlements of a line still shows a
    replaced row as reverted, with no sign that it was a correction.
28. **A folded row of the purchase history answers the newest snapshot of its group.**
29. **The id of a session can change.** The id of a `SESSION` entry is the id of its
    earliest settlement. A rewrite of that settlement gives the session another id. A revert
    that splits that settlement already did this. A `BASKET` entry keeps its id.

**The migration.** `1756003800000-SettlementSnapshotAndReplacement`: the two columns, and
the unique partial index `ux_settlements_replaces`. No check changes and no foreign key is
added. `down` drops both columns and keeps every row, so a correction then reads as a buy
that was taken back and another buy made at the same moment. It was run up, down and up on
a real Postgres, on a table that holds corrections.

**Velista after this plan.** Read from the code of velista and of the suite, not run.

- This plan adds nothing to what velista cannot do before velista `0139`. A basket row
  still cannot be written, because the app sends no `lineIds`.
- The app still sends `priceScopeId`. The field is accepted and not read.
- A buy on the list page with no shop now records a price. The app shows it nowhere new.
- The history reads answer one field more. The mappers of velista read from `unknown` and
  drop a field that they do not know.
- **Velista `0140`** sends `POST /v1/baskets/:id/lines/product` with
  `{ lineIds, itemId, keep }`.
  - With `keep: false` and no buy yet, the route writes nothing. The page holds the choice
    and sends it as `itemId` on the settle.
  - The answer is `{ entries, progress }`. Each entry states `tripItemId`, and with `keep`
    also `itemIds` and `favoriteItemId`. The page builds its rows again from them, or reads
    the basket.
  - It handles 404 (read the basket again), 403 (the line cannot be edited, offer "for this
    trip only") and 400 on `itemId`.
  - It offers the checkbox "keep" only when `canWrite` is true on every entry.
- **Velista `0141`** sends no shop for a buy with no shop, and no `priceScopeId` at all. The
  gateway records the cheapest price, with no shop and no chain. With a shop it sends
  `supermarketLocationId` alone.
- **A history page** can draw `itemSnapshot` when the catalog no longer knows `itemId`. No
  plan of velista asks for that yet.
- **`apps/velista-luna-e2e`**: this plan makes no step fail that passed before it. Four of
  its five files already fail after plan `0201`. `shop.spec.ts` steps 7 and 8 read
  `GET /v1/lines/:id/settlements` and compare `id`, `itemId` and `revertedAt`. Those fields
  did not change, and the suite never changes a product from the basket. The helper
  `buyBasketRow` in `support/api.ts` sends no `lineIds`, which velista `0139` must fix.

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
