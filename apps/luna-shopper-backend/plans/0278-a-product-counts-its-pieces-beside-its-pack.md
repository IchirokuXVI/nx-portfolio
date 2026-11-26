> **PR:** [#1114](https://github.com/IchirokuXVI/nx-portfolio/pull/1114)

# 0278 A product counts its pieces beside its pack

> Asked for by the owner on 2026-11-26 (decision 153a). A product that is a pack of several units
> has two weights: the whole pack and one unit. The size is always the whole pack, and the
> shopper also wants to know how many units it holds and what one weighs: a tray of 4 burgers is
> 360 g, shown as "360 g (4 x 90 g)". A bag of candies is sold by weight, but most people want to
> know how many candies it holds: a bag of 35 g holds 50, and a product of 2 bags of 35 g holds
> 100 in total (70 g, 2 bags, 100 pieces). The owner chose one separate piece count next to the
> pack count, the pack count on the catalog tab too, and the size printed with the units. "It
> will be built along the other plans in this development."
>
> This plan is the backend half. Admin plan `0075` puts both counts in the item editor, and
> velista plan `0209` prints them. Both need this plan merged first.
>
> Every anchor below was read on `origin/dev` at `e56cf9b51` on 2026-11-26. Line numbers are of
> that commit.
>
> Prerequisite reading: plan `0162` (the pack count: every rule there still holds), plan `0244`
> sections 1 and 3 (a size or a weight, never both), plan `0261` section 2 (the step, whose
> checks this plan copies), plan `0237` section 3.2 (the `expect` guard of an edit), plan `0245`
> section 3 (what moves the comparable price), and the section "Luna Shopper backend" of
> `CLAUDE.md` (the OpenAPI document and the wire types).

## Brief for the agent

### Objective

Give every catalog item an optional `pieceCount`: how many pieces the whole product holds, in
total across its pack. Store it in a new nullable column, carry it on `ItemView`, let a person
set, change and clear it through the admin create and edit routes and the items batch, guard it
with `expect`, and audit it like every other field. Validate it against the size, the unit and
the pack count. No run writes it.

### Context

- **The pack count today.** `items."packCount"` is a nullable `smallint`, 2 to 1000
  (`apps/luna-shopper-backend/catalog/src/app/entities/item.entity.ts` lines 108 to 116; the
  check `chk_items_pack_count`, migration `1757900000000-ItemPackCount.ts`). The bounds are
  `PACK_COUNT_MIN` and `PACK_COUNT_MAX` (`libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts`
  lines 2651 to 2659). `unitSize` is the size of the whole pack: a tray of 4 burgers of 90 g is
  `unitSize` 360, `GRAM`, `packCount` 4.
- **The view.** `ItemView.packCount` (`catalog.messages.ts` lines 1502 to 1511) is filled by
  `catalog.mappers.ts` line 292. The schema lists the view's fields once, in
  `itemViewProperties` and `itemViewRequired`
  (`libs/luna-shopper/contracts/src/schemas/messages/catalog.schemas.ts` lines 722 to 786). The
  basket's product spreads the same two lists (`basket.schemas.ts` lines 502 to 510), so a field
  added there reaches the basket read too.
- **The reads velista's catalog tab uses already carry `packCount`.** `GET /v1/catalog/items`
  answers `ITEM_PATTERNS.search`, an `ItemPage` of `ItemView`
  (`apps/luna-shopper-backend/gateway/src/app/catalog/catalog.controller.ts` lines 439 to 468),
  and the suggest read answers `ItemView` too. No gateway code lists the fields of a product by
  name. So `pieceCount` reaches every read once it is on `ItemView`. velista drops `packCount`
  from the browse read in its own mapper, which is velista plan `0209`'s work, not this plan's.
- **The writes.** `CreateItemRequest`, `UpdateItemRequest` and `ItemExpectation`
  (`catalog.messages.ts` lines 2420 to 2470, 2520 to 2585 and 2598 to 2609); their schemas
  `createItemInput`, `updateItemFields` and `itemExpectation` (`catalog.schemas.ts` lines 1540
  to 1570, 1576 to 1600 and 1601 to 1615); the gateway DTOs `CreateItemDto`,
  `ItemExpectationDto` and `UpdateItemDto` (`apps/luna-shopper-backend/gateway/src/app/catalog/catalog.dto.ts`
  lines 470, 636 and 698; `packCount` at 527 to 539, 680 to 683 and 755 to 768).
- **The rules of a product's shape** are checked in `item.service.ts` before the database would
  refuse them: `requireBaseUnit` (line 4051), `requireWeightBesideNoSize` (line 4135),
  `requireStepOnLooseProduct` (line 4179), called on an edit by `requireBaseUnitOnEdit` (lines
  4097 to 4120). The step's two checks in migration `1759500000000-ItemQuantityStep.ts` are the
  shape to copy. The expectation comparison is at lines 4014 to 4020 for `packCount`.
- **The comparable price** divides a counted product by `unitSize`, then by `packCount`
  (`libs/luna-shopper/contracts/src/lib/units/comparable-price.ts` lines 74 to 81), and
  `sizeMoved` (`item.service.ts` lines 4430 to 4438) lists what recomputes it. A piece count
  applies only to a product with a weight or a volume, whose comparable price is per kilo or
  per litre, so it moves nothing there.
- **The harvester** fills `packCount` only where it is null (`ITEM_PATTERNS.fillPackCounts`,
  `catalog.messages.ts` lines 2682 to 2710), from what an adapter reads in a structured field
  (plan `0162` section 1). Since this plan it also fills it only where the product holds no
  piece count or the new pack count is below it (see Decisions). No adapter states a piece count apart from the pack count, the wash
  count or the size (section 5).

### Target state

1. `items."pieceCount"` exists: nullable `smallint`, every row null after the migration, with
   the checks of section 2.
2. `ItemView.pieceCount: number | null` on every catalog read, the basket's product included.
3. `CreateItemRequest`, `UpdateItemRequest` (and so the items batch) and `ItemExpectation`
   carry `pieceCount`, through the contracts, the schemas and the gateway DTOs.
4. Catalog refuses a piece count that breaks a rule of section 2 with
   `item_piece_count_not_allowed`, before the database would.
5. The audit row of an edit that changes it names `pieceCount` in `before` and `after`.
6. `openapi.json` and `wire-types.ts` are regenerated by their generators and committed.
7. The specs of section 6 pass.

### Scope

- `libs/luna-shopper/contracts`: `PIECE_COUNT_MIN`, `PIECE_COUNT_MAX`, the field on the three
  messages and `ItemView`, the schemas, and the error code in
  `libs/luna-shopper/platform/src/lib/errors/error-codes.ts`.
- `apps/luna-shopper-backend/catalog`: the entity, one migration (`1759600000000-ItemPieceCount.ts`,
  added to `db/migrations/index.ts`), the mapper, `item.service.ts` (create, update, batch,
  expectation, the new rule) and their specs.
- `apps/luna-shopper-backend/gateway`: the three DTOs, the exception for the new code, and
  `docs/openapi.json` through its generator.
- `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts` through its generator.
- Nothing in the harvester, in the adapters, in velista or in the back office screens.

### Constraints

- The migration adds a column and two checks. It writes no row and backfills nothing.
- A piece count is a person's. No run, no fill and no release task writes it in this plan.
- `pieceCount` never enters the comparable price, `sizeMoved`, a matching key or a merge rule.
- Numbers compared as numbers in the expectation, as `packCount` is.
- `openapi.json` and `wire-types.ts` are written only by
  `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types`. Never edit or format them by hand.
- No production id or name in a spec or fixture.
- Only make changes directly requested.

### Action boundaries

- Stop and report before you add a migration that rewrites rows, change a harvester file or an
  adapter, add a dependency, or change what `packCount` means or accepts.
- Do not build admin plan `0075` or velista plan `0209`.

### Progress evidence

`npx nx test` and `npx nx lint` of `luna-shopper/contracts`, `luna-shopper/platform`,
`luna-shopper-backend-catalog`, `luna-shopper-backend-gateway` and `luna-shopper-admin/models`;
the catalog integration specs of section 6 on an ephemeral Luna slot (the recipe in the memory
entry on Luna backend spec traps); the migration up and down on that slot; `git diff --stat` of
the two generated files.

## 1. What the field means

`pieceCount` is how many pieces the whole product holds, counted across its pack. It sits next
to `packCount`, and the two answer different questions:

| Product | `unitSize` | `defaultUnit` | `packCount` | `pieceCount` | Printed by velista `0209` |
| --- | --- | --- | --- | --- | --- |
| A tray of 4 burgers | 360 | `GRAM` | 4 | null | 360 g (4 x 90 g) |
| A bag of 50 candies | 35 | `GRAM` | null | 50 | 35 g, 50 pieces |
| 2 bags of 35 g, 100 candies | 70 | `GRAM` | 2 | 100 | 70 g (2 x 35 g), 100 pieces |
| 6 cartons of 1 L | 6000 | `MILLILITER` | 6 | null | 6000 ml (6 x 1000 ml) |

- The **pack count** counts units a shopper uses one at a time, whose own weight is worth
  knowing: a burger, a carton, a bag. The weight of one is derived on read, never stored.
- The **piece count** counts small pieces whose number matters more than their weight: candies,
  treats. It is the total of the whole product, never the pieces of one unit.
- **Not a piece count:** a wash count (a wash is not a unit), a serving count ("10 raciones"),
  sheets of a roll, or anything a name says. The owner's rules stand: the size and the brand
  never go in the name, and a count is a field.

## 2. The rules

A piece count is a whole number from `PIECE_COUNT_MIN` = 2 to `PIECE_COUNT_MAX` = 10000, or null.
A count of 1 says nothing and is stored as null, as a pack count of 1 is. The upper bound holds a
large bag of small sweets and stays far from any weight in grams a misplaced value would carry.

A product may hold a piece count only when all of these hold:

1. It has a fixed size: `unitSize` is set. So never beside `approxWeight` (plan `0244` already
   forbids a weight beside a size), and never on a product sold by the kilo, whose price is a
   kilo and whose content is not fixed.
2. Its unit is `GRAM` or `MILLILITER`. A `UNIT` or `PACK` size is already a count, so a piece
   count beside it would say the same thing twice. `KILOGRAM` and `LITER` with a size are
   refused by `requireBaseUnit` already.
3. When `packCount` is set too, the piece count is greater than it. A piece count equal to the
   pack count says each unit is one piece, which the pack count alone already says.

`packCount` keeps every rule of plan `0162` and gains none.

**In catalog:** a new `requirePiecesOnSizedProduct(row, where)` beside
`requireStepOnLooseProduct`, reading the row as it will be saved, called on a create, on each
entry of a batch create, and on an edit that names `pieceCount`, `unitSize`, `approxWeight`,
`defaultUnit` or `packCount`. Like the step, an edit that takes a product with pieces out of the
rules (a cleared size, another unit, a pack count raised to the piece count) is refused unless
the same edit sends `pieceCount: null`. The refusal is `item_piece_count_not_allowed` with
`details` naming `pieceCount`, `packCount`, `unitSize` and `defaultUnit`, and a message that says
which rule failed. It runs after the existing rules, so their codes still answer first.

**In the database:** two checks restate the rules, as the step's do:

```sql
ALTER TABLE "items" ADD COLUMN "pieceCount" smallint NULL;
ALTER TABLE "items" ADD CONSTRAINT "item_piece_count_bounds"
  CHECK ("pieceCount" IS NULL OR "pieceCount" BETWEEN 2 AND 10000);
ALTER TABLE "items" ADD CONSTRAINT "item_piece_count_on_sized"
  CHECK ("pieceCount" IS NULL OR (
    "unitSize" IS NOT NULL AND "approxWeight" IS NULL
    AND "defaultUnit" IN ('GRAM', 'MILLILITER')
    AND ("packCount" IS NULL OR "pieceCount" > "packCount")
  ));
```

Every existing row has a null piece count, so both checks hold and the migration writes nothing.
The bounds are restated as literals, because a migration is frozen on the day it was written,
and `migrations.spec.ts` asserts they equal the contract's constants today. `down` drops both
checks, then the column.

## 3. Where it travels

- **Entity and view.** `Item.pieceCount: number | null`, documented as section 1 says, and
  `ItemView.pieceCount` filled by the mapper beside `packCount`. Add it to
  `itemViewProperties` (with the bounds) and to `itemViewRequired`, as `packCount` is: catalog
  fills it on every view it builds. The basket's product follows through the spread.
- **Create.** `CreateItemRequest.pieceCount?` and `createItemInput`, `CreateItemDto.pieceCount?`
  with `@IsOptional() @IsInt() @Min @Max`. An item created from a source entry gets null: the
  harvester sends nothing.
- **Edit and batch.** `UpdateItemRequest.pieceCount?` (absent leaves it, null clears it), the
  shared `updateItemFields`, `UpdateItemDto.pieceCount?`. The items batch takes it through
  `UpdateItemInput` with no code of its own.
- **Expect.** `ItemExpectation.pieceCount?: number | null`, the schema `itemExpectation`, and
  `ItemExpectationDto.pieceCount?`, compared in `refuseFailedExpectations` exactly as
  `packCount` is (lines 4014 to 4020). So curation CLI plan `0006` can guard it (section 7).
- **Audit.** The audit row of an edit names `pieceCount` in `before` and `after` when it moved.
  Check that the snapshot of `catalog-audit.service.ts` picks the column up by property name;
  if it lists fields, add it there.
- **Merge.** A merge (plan `0239`) treats `pieceCount` exactly as it treats `packCount`.
- **Snapshot on a buy.** Not in this plan. See O2.
- **Error code.** `ITEM_PIECE_COUNT_NOT_ALLOWED: 'item_piece_count_not_allowed'` in
  `error-codes.ts`, an exception in the gateway beside `ItemQuantityStepNotAllowedException`,
  and the code in the OpenAPI problem responses of the routes that already list
  `item_quantity_step_not_allowed`.

## 4. The documents

Regenerate `openapi.json`, then `wire-types.ts`. Each new property's description says what
section 1 says in one sentence, names this plan, and says that no run writes it.

## 5. The harvester does not write it

No run fills `pieceCount`, and no source entry gets a column for it in this plan. The rule, for
any later plan that wants one:

- A count is read only from a **structured field of the chain** whose meaning is pieces inside a
  product with a weight or a volume, proved by the adapter's fixtures, as plan `0162` section 1
  proves each pack rule.
- **Never** from a name, a description or the free text of a printed format. DEZA's printed
  format shows why: "4 ud" beside a 360 g burger tray is a pack of 4, and "100 ud" beside 2 bags
  of 35 g is 100 candies. The same words mean two things, and telling them apart is the
  curator's judgment (the owner's rule of 2026-11-11).
- A run never overwrites a value a person set, as with the pack count.

Today no adapter has such a field: Mercadona's `total_units` is a pack count on a pack, a wash
count on a detergent and a sheet count on a roll (`libs/luna-shopper/mercadona/src/lib/normalize.ts`
lines 255 to 300 and 380 to 395). See O1.

## 6. Specs

- Catalog, unit (`item.service.spec.ts` or a new `item-piece-count.spec.ts`, beside
  `item-quantity-step.spec.ts`): each rule of section 2 accepts and refuses, on a create, a batch
  create and an edit; an edit that clears the size, changes the unit or raises `packCount` to
  the piece count is refused without `pieceCount: null` and saves with it; the existing codes
  still answer first; `expect.pieceCount` matches and mismatches.
- Catalog, integration on an ephemeral slot (`item-piece-count.integration.spec.ts`, beside
  `item-pack-count.integration.spec.ts`): the column, both checks refuse a raw insert that
  breaks them, the view carries the value, an edit writes an audit row with `pieceCount` in
  `before` and `after`, and the comparable price of a product does not move when only its piece
  count does.
- Migrations: up and down on the slot; `migrations.spec.ts` asserts the literals equal the
  constants.
- Contracts: the schemas accept `pieceCount` null and in bounds and refuse 1, 10001 and 2.5.
- Gateway: a DTO case per bound, and `openapi-document.spec.ts` green after regeneration.
- `luna-shopper-admin/models`: `wire-types.spec.ts` green after regeneration.

## 7. The rows that wait on this

The owner's review of 2026-11-26 holds 22 DEZA products that need a count
(`tmp/harvester-round/owner-review/translated.tsv` in the main checkout, outcome `set_pack` or
the four `needs_owner` SMINT rows). The sizes there are already right. Only the counts change:

| Products | Size | `packCount` | `pieceCount` | Printed |
| --- | --- | --- | --- | --- |
| 7 burger trays (pork, iberian pork, chicken, seasoned chicken, beef, two mixed) | 360 g | 4 | null | 360 g (4 x 90 g) |
| Burger Crunchy Chicken King | 240 g | 2 | null | 240 g (2 x 120 g) |
| Burger mini de pollo | 240 g | 8 | null | 240 g (8 x 30 g) |
| Pegamento | 40 g | 2 | null | 40 g (2 x 20 g) |
| 4 SMINT flavours, 2 bags | 70 g | 2 | 100 | 70 g (2 x 35 g), 100 pieces |
| 2 candy bags (strawberry, mint) | 35 g | null | 50 | 35 g, 50 pieces |
| Cheese slices, cheese portions, hot dog sausages, 3 dog treats | 115 g to 275 g | O3 | O3 | O3 |

The owner's note on five burger trays says "4x120g". The arithmetic says 360 / 4 = 90, which is
also the owner's own example of decision 153a. The size stays 360 g and velista derives 90 g.

How the values land is O4. Nothing here is a release task.

## 8. Acceptance criteria

- [ ] `items."pieceCount"` exists with both checks, and the migration wrote no row.
- [ ] `ItemView.pieceCount` is on every catalog read and on the basket's product.
- [ ] Create, edit, batch and `expect` carry it, and each rule of section 2 refuses with
      `item_piece_count_not_allowed` before the database does.
- [ ] An edit that changes it writes an audit row naming it.
- [ ] The comparable price, matching, the harvester and `packCount` are unchanged.
- [ ] `openapi.json` and `wire-types.ts` are current, written by their generators.
- [ ] The specs of section 6 pass, with lint.

## Not in this plan

- The admin item editor (admin plan `0075`) and velista's text (velista plan `0209`).
- A harvester or adapter that reads a piece count (section 5, O1).
- A piece count on a source entry, or in the `observed` of plan `0277`.
- The weight of one unit as a stored field. It is derived on read from `unitSize` and
  `packCount`, so it cannot disagree with them.
- Writing the counts of section 7. That is O4.

## Open decisions for the owner

**O1. May a run ever fill the piece count?**

- **A. No, only a person sets it (recommended).** No adapter has a structured piece field today,
  and the one place a count shows (DEZA's printed format) means a pack on a burger tray and
  pieces on a candy bag. Example: "Burger ... bandeja 360 g", format "4 ud", stays
  `pieceCount` null until a person decides.
- **B. Record the chain's count on the source entry, write nothing to the product.** A new
  `statedCount` column on `source_catalog_entries` for DEZA's "N ud" beside a weight, shown in
  the queue, for the curator to copy. Example: the SMINT entry shows "100 ud" beside "2x35 g" in
  the queue. One more harvester plan and one more admin screen change.
- **C. Fill it like the pack count, where null.** Example: the burger tray gets `pieceCount` 4,
  which is wrong. Not recommended.

**O2. Does a purchase keep the piece count it was bought with?** `ItemSnapshot` (plan `0202`)
copies the name, brand, size, pack count, unit and weight onto a buy.

- **A. No (recommended).** The pieces change no price and no amount, and the Bought history
  prints what the snapshot holds today. Example: a bought SMINT pack reads "70 g" in the
  history.
- **B. Yes, as an optional field.** The snapshot schema, core's `settlement-paid.ts` parser
  and the gateway's copy gain it. Example: the history reads "70 g (2 x 35 g), 100 pieces".
- **C. Add it later, with the Bought tab** the owner deferred on 2026-10-15.

**O3. Which of the six food and pet rows are packs and which are pieces?**

- **A. Packs when one unit is eaten or used on its own, pieces when only the number matters
  (recommended).** Cheese slices 185 g with 7, cheese portions 250 g with 16 and hot dog
  sausages 275 g with 5 are packs: "185 g (7 x ~26 g)", "250 g (16 x ~16 g)",
  "275 g (5 x 55 g)". The three dog treats are pieces: "120 g, 7 pieces", "115 g, 5 pieces",
  "115 g, 7 pieces".
- **B. All six are packs**, as the review proposed with one count field. Example: "120 g
  (7 x ~17 g)" for the dog treats.
- **C. All six are pieces.** Example: "185 g, 7 pieces" for the cheese slices.

**O4. How do the 22 rows get their values?**

- **A. On the local copy, then carried by the replay (recommended).** The owner sets them on the
  local copy through the admin editor of plan `0075` or `PATCH /v1/admin/catalog/items/batch`
  with `expect`, as the 99 earlier fixes were made, and curation CLI plan `0006` carries them to
  staging and production. Its section 1 lists the fields an `expect` guards, and gains
  `pieceCount` when it is built. Example: one batch of 22 edits, each with
  `expect: { unitSize: 360, packCount: null, pieceCount: null }`.
- **B. By hand in the admin editor on each cluster.** 22 rows, twice. Example: open each product
  on production and type 4 in "Units in the pack".
- **C. One request file sent to each cluster's batch route with `expect`**, without the replay.
  Example: the same 22 edits, sent by `curl` to staging and then to production.

## Decisions

2026-11-26: the build took the recommended option of each open decision, pending the owner's
answer. O1 A: no harvest run, fill or release task writes the piece count. O2 A: a purchase
snapshot does not keep it, so `ItemSnapshot` is unchanged. O3 and O4 are about data, not code:
the build sets no value, and the rows of section 7 wait for the owner.

2026-11-26, fix round: `fillPackCounts` writes a pack count only where the product holds no
piece count or the offered pack count is below it. Without that, `item_piece_count_on_sized`
refuses one row of the fill's single `UPDATE`, the whole chunk fails, and the harvest run fails
after its prices were written. A product the piece count keeps out is skipped, not counted in
`written`, and logged by catalog with its id: `FillPackCountsResult` has no room for a skip count
without a contract change. The fill still never writes `pieceCount`.
