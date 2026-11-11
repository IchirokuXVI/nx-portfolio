# 0262: a line holds up to 999 999 of its unit

> Written on 2026-11-11 from the owner's decision of that day (section 1 of the batch
> decisions): "The most is 999 999 base units for the three units (999,999 kg, l or K)". A
> line counts grams, millilitres or pieces since backend `0246`, and the ceiling of 100 000
> was set when a line counted pieces only. 100 000 g is 100 kg, which the stepper of velista
> `0188` reads as "100 kg" and cannot pass, while its short form and its exact form are
> designed for six digits ("999,99", "999,999 kg"). This plan raises `LINE_QUANTITY_MAX` from
> 100 000 to 999 999 everywhere it is stated, proves from the column types that nothing
> overflows, and says what an older client sees.
>
> Amends nothing in an older plan's decisions: `0246` section 3.1 says the bounds "do not
> move", and this plan moves the ceiling only. The floor stays 0.
>
> Needs PRs #959 (backend `0246`), #960 (velista `0182`) and #961 (velista `0183`) in `dev`.
> Independent of backend `0263` and of every velista plan of this batch. The stepper that
> reaches the new ceiling is velista `0188`; it reads the constant and states no number of its
> own.
>
> Prerequisite reading: `0246` sections 2 (the amount table), 3.1 and 3.2; `0040` section 3.3
> (why the delta is bounded by the ceiling); `0047` section 4.2 (a settle records more than the
> line asked); velista `0182` section 3 (the reel and the stepper).
>
> Code anchors, read on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-11:
> `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts:111` to `:112` (the two
> constants); `libs/luna-shopper/contracts/src/schemas/messages/list.schemas.ts:564` to `:565`
> (`addLineRequest`), `:593` to `:594` (`addLinesItem`), `:625` and `:631`
> (`addLineQuantityRequest`: `delta`, `expect`), `:642` to `:643` and `:651`
> (`updateLineRequest`: `quantity`, `from`), `:701` (`settleLineRequest`);
> `libs/luna-shopper/contracts/src/schemas/messages/basket.schemas.ts:528` (`allocationEntry`),
> `:728` (`settleRequest`), `:759` (`revertRequest`), `:772` (`demandRequest`), `:819`
> (`addLineRequest`); `apps/luna-shopper-backend/gateway/src/app/lists/list.dto.ts:187` to
> `:193` (`AddLinesItemDto`, and so `AddLineDto`), `:342` to `:350` (`AddLineQuantityDto`),
> `:366` to `:387` (`UpdateLineDto`), `:487` to `:494` (`SettleLineDto`);
> `gateway/src/app/baskets/basket.dto.ts:84` to `:87` (`BasketAllocationDto`), `:103` to
> `:124` (`SettleBasketRowDto`), `:190` to `:206` (`RevertBasketRowDto`), `:221` to `:235`
> (`SetBasketRowDemandDto`), `:265` to `:269` (`AddBasketLineDto`);
> `gateway/src/app/admin/admin-edit.dto.ts:208` to `:214` (`UpdateAdminLineDto`);
> `apps/luna-shopper-backend/core/src/app/lists/line.service.ts:1882` to `:1884`
> (`capQuantity`), `:1926` to `:1940` (`validateQuantity`), `:2871` (the rename planner's cap),
> `:3204` to `:3217` (`validateDelta`); `core/src/app/lists/line-merge.service.ts:267`;
> `core/src/app/lists/settlement.service.ts:431` to `:442`;
> `core/src/app/baskets/basket-settle.service.ts:343` to `:356`;
> `apps/luna-shopper-backend/assistant/src/app/assistant/tools.ts:183` to `:190`;
> the columns `core/src/app/entities/list-line.entity.ts:73` (`quantity int`),
> `line-settlement.entity.ts:113` (`quantity int`) and `:244` (`pricePaidCents int`),
> `basket-trip-row.entity.ts:96` (`asked int`), `list-line-change.entity.ts:119` to `:123`
> (`quantityBefore`, `quantityAfter`, both `int`); the sums
> `core/src/app/baskets/basket-read.sql.ts:265` to `:268` and `:443`,
> `core/src/app/purchases/purchases.sql.ts:254` to `:284` and `:394`,
> `core/src/app/baskets/basket-trip-rows.sql.ts:67`, `core/src/app/lists/trips/trips.sql.ts:102`
> and `:222`, `core/src/app/lists/trips/basket-asked.sql.ts:71`;
> `libs/luna-shopper/contracts/src/lib/units/line-amount.ts:47` to `:94` (`lineAmountOf`);
> `libs/velista/models/src/lib/limits.ts:118` to `:119`;
> `libs/luna-shopper-admin/feature-people/src/lib/list-lines.ts:21` to `:22` and `:126`;
> `libs/velista/ui/src/lib/list/quantity-stepper.ts:131` to `:136` and
> `libs/velista/ui/src/lib/list/quantity-reel.ts:763` to `:777` (what an older build does);
> the specs `libs/luna-shopper/contracts/src/lib/messages/list.messages.spec.ts:60` and
> `core/src/app/lists/line-quantity-delta.spec.ts:423`.

## Brief for the agent

### Objective

Raise the most a line can hold from 100 000 to 999 999 base units, in the contracts, in
velista's copy and in the back office's copy, so that every schema, DTO and core check that
reads `LINE_QUANTITY_MAX` moves with it; change no column; regenerate the OpenAPI document and
the admin wire types.

### Context

- `LINE_QUANTITY_MAX` is 100000 in the contracts (`list.messages.ts:112`) and in velista's own
  copy (`limits.ts:119`, rule D4 keeps velista off the contracts). The back office repeats it
  as `QUANTITY_MAX` (`list-lines.ts:22`) "so the form refuses first".
- Every server bound reads the contracts constant by name: thirteen schema fields, eleven DTO
  fields, five core checks and the assistant's tool schema (anchors above). None writes the
  number.
- No column or check constraint in core states the ceiling. Every amount column is `int`
  (Postgres `int4`, at most 2 147 483 647). `0262` needs no migration.
- A delta is bounded by the ceiling in both directions (`validateDelta`, `line.service.ts:3210`),
  so the largest single move grows with it, as `0040` section 3.3 intends.
- Velista `0188` replaces the reel with a stepper that steps by 25 g or 25 ml, and a count by 1
  below 1000 and by 10 from 1000, and whose
  plus is off when one more step would pass the ceiling. Older builds still carry the reel.

### Target state

1. `LINE_QUANTITY_MAX` is 999999 in `list.messages.ts` and in velista's `limits.ts`, and
   `QUANTITY_MAX` is 999999 in the back office's `list-lines.ts`. Each doc comment that says
   "100000" says the new number.
2. Every schema, DTO and core check of the Context reads the new value with no other change.
3. Nothing overflows (section 2), and no column, migration or release task is added.
4. `openapi.json` and `wire-types.ts` are regenerated, and their diffs show only the new
   `maximum` and `minimum` values.
5. The specs of section 4 pass.

### Scope

- `libs/luna-shopper/contracts` (the constant, its spec), `libs/velista/models` (`limits.ts`),
  `libs/luna-shopper-admin/feature-people` (`list-lines.ts` and its spec),
  `apps/luna-shopper-backend/core` and `gateway` (specs only, unless a spec shows a written
  number), and the two generated files.
- Do NOT touch the stepper, its display or its steps (velista `0188`), the add rules (backend
  `0260`, velista `0185`), or any migration.

### Constraints

- The decision is the owner's and is settled. N1 to N4 are the writer's; the owner may
  overrule them before the build.
- The three copies of the number change in one PR, with a spec beside each.
- No dashes as punctuation in any prose or comment.

### Action boundaries

- Proceed with sections 1 to 4 once PRs #959 to #961 are in `dev`.
- Stop and ask before raising `MIN_CLIENT_VERSION` in any cluster (section 3 is why it could
  come up).
- Stop and ask before changing any migration, any column type, or any of the `::int` casts of
  section 2.
- Stop and ask if a spec shows a number written beside the constant somewhere this plan does
  not name.
- Regenerate `openapi.json` and `wire-types.ts` with their targets. Never edit them by hand.

### Progress evidence

Each criterion of section 6 with its spec output; the two generation targets run and their
diffs committed; `npx nx affected -t lint test` green; and one HTTP walk on an ephemeral slot:
a loose product line raised with `POST /v1/lines/:id/quantity` by 999 000 g (201, the line at
its old amount plus 999 000, held at 999 999), a delta of 1 000 000 (400 `validation_failed`
on `delta`), a `PATCH` to 999 999 (200) and to 1 000 000 (400 on `quantity`).

## 0. Decisions

The owner's, 2026-11-11, not to reopen:

- **The most is 999 999 base units for the three units**: 999,999 kg, 999,999 l or 999 999
  pieces. Velista reads the count as "999,99 K" in its short form (velista `0188`).

The writer's, open to the owner:

- **N1. One ceiling for the three units, as today.** The owner named one number for all three,
  and `validateQuantity` reads no unit. A ceiling per unit would put the unit into every bound
  of section 1 for no case the owner named.
- **N2. The delta bound follows the ceiling.** `0040` section 3.3 bounds a delta by "the
  largest quantity a line may hold", so one call can still take a full line to 0. A smaller
  delta bound would make a sheet that types 999 999 over 0 fail where the `PATCH` passes.
- **N3. The three `::int` sums of settlement quantities stay `::int`** (section 2.3). They
  overflow only after more than 2 147 settles of the most on one line in one scope, which no
  household does. A cast to `bigint` reaches the mappers as a string in `node-postgres`, which
  is a change of every reader for a case that does not occur.
- **N4. No raise of `MIN_CLIENT_VERSION` in this plan.** An older build reads every amount it
  is given and refuses to send above its own ceiling (section 3). The one harm is the old
  reel's minus on a line above 100 000, and that needs another device to have written such a
  line first. The owner decides whether that is worth a forced update (question 1).

## 1. What reads the ceiling

All of these read `LINE_QUANTITY_MAX` by name and change with the constant. The builder edits
none of them; the list is what the review checks and what the specs cover.

| Where | Field | Bound |
| --- | --- | --- |
| `list.schemas.ts` `addLineRequest`, `addLinesItem` | `quantity` | 0 to max |
| `list.schemas.ts` `addLineQuantityRequest` | `delta`, `expect` | minus max to max, 0 to max |
| `list.schemas.ts` `updateLineRequest` | `quantity`, `from` | 0 to max |
| `list.schemas.ts` `settleLineRequest` | `quantity` | 1 to max |
| `basket.schemas.ts` `allocationEntry`, `demandRequest`, `addLineRequest` | `quantity` | 0 to max |
| `basket.schemas.ts` `settleRequest`, `revertRequest` | `quantity`, `units` | 1 to max |
| `list.dto.ts` `AddLinesItemDto` (and `AddLineDto`), `AddLineQuantityDto`, `UpdateLineDto`, `SettleLineDto` | as the schemas | `@Max`, `@ApiProperty` |
| `basket.dto.ts` `BasketAllocationDto`, `SettleBasketRowDto`, `RevertBasketRowDto`, `SetBasketRowDemandDto`, `AddBasketLineDto` | as the schemas | `@Max`, `@ApiProperty` |
| `admin-edit.dto.ts` `UpdateAdminLineDto` | `quantity` | 0 to max |
| `line.service.ts` `validateQuantity`, `validateDelta`, `capQuantity`, the rename cap at `:2871` | the result of every edit, delta, add and merge | as above |
| `line-merge.service.ts:267` | the sum of two merged lines | held at max |
| `settlement.service.ts:435`, `basket-settle.service.ts:349` | the units of a settle | 1 to max |
| `assistant/.../tools.ts:186` to `:187` | `upsert_lines` item `quantity` | 0 to max |

The three copies that state the number themselves: the contracts constant, velista's
`limits.ts:119`, and the back office's `list-lines.ts:22` (its form's `max` at `:126`).

## 2. Nothing overflows

### 2.1 The columns

| Column | Type | The most it now holds |
| --- | --- | --- |
| `list_lines.quantity` | `int` | 999 999 |
| `line_settlements.quantity` | `int` | 999 999 per row (a settle is bounded by the ceiling) |
| `basket_trip_rows.asked` | `int` | the sum of a trip's origins of one line, which is the line's amount, so 999 999 |
| `list_line_changes.quantityBefore`, `quantityAfter` | `int` | 999 999 |
| `line_settlements.pricePaidCents` | `int` | unchanged: it is the price of ONE piece, kilo or litre (`line-settlement.entity.ts:219` to `:226`), and never meets an amount |

Every one is under 2 147 483 647 by more than three orders of magnitude.

### 2.2 The multiplications

- **In SQL, the spend of a purchase** (`purchases.sql.ts:267` to `:271`) is
  `"pricePaidCents"::numeric * "quantity" / 1000`. The cast to `numeric` comes first, so the
  product never passes through `int4`. Worst case: a price of 2 147 483 647 cents times
  999 999 is about 2.1e15, which `numeric` holds exactly.
- **In TypeScript, the cost of an amount** (`lineAmountOf`, `line-amount.ts:47`) works in
  euros as a double and rounds to cents once. 999 999 g of a product at 1 000 € a kilo is
  999 999 €, 99 999 900 cents. 999 999 packs at 1 000 € each is about 1e11 cents. Both are far
  under `Number.MAX_SAFE_INTEGER` (about 9e15). Velista's `lineAmount`, `listCost` and
  `basketTotal` sum the same figures in integer cents and hold the same bound.
- **A basket row's held amount** is a sum of the lines of one product across a person's lists
  in TypeScript (`basket-settle.service.ts:131` to `:134`), at most a few dozen lines of
  999 999 each. Safe.

### 2.3 The sums with a cast to `int`

`SUM(int)` is `bigint` in Postgres, and three reads cast it back to `int`:
`basket-read.sql.ts:443` (the purchases of one line made elsewhere), the `bought` of a trip row
at `basket-read.sql.ts:265` to `:268`, and `purchases.sql.ts:394` (the folded purchases of one
line, product and price). Each sums the settlements of ONE line in one scope. With 999 999 per
settle, the cast fails above 2 147 settles of the most on that line in that scope. At 100 000
it was 21 474. Both are beyond what a household does, and N3 keeps the casts. The `bigint`
sums of `purchases.sql.ts:254` to `:262` are not cast and need nothing.

## 3. What an older client sees

An older velista, and a back office built before this plan, still cap at 100 000.

- **It reads any amount.** The mapper takes the number as it comes
  (`libs/velista/data-access/src/lib/mapping/mappers.ts:405`, `numOr`), and the line is drawn
  through `formatQuantity` as "250 kg" or "×250000".
- **It never sends above 100 000 on its own.** Its composer, its stepper and its reel stop at
  its own ceiling, and the server accepts everything an older client can send.
- **Its stepper keeps the line where it is.** On a line above 100 000 the plus is off
  (`quantity-stepper.ts:134` to `:136`, `value < max` is false) and one minus sends one step
  down.
- **Its reel moves such a line to 100 000 on one minus.** `_neighbour` clamps the step to its
  `max` (`quantity-reel.ts:763` to `:777`), so a minus from 250 000 g emits a delta of
  minus 150 000, which the new server accepts. This needs another device to have written more
  than 100 000 first. Velista `0188` removes the reel; the owner decides whether builds before
  it are forced to update (N4, question 1).
- **The back office's form refuses** a value above 100 000 until its copy moves, which is why
  the copy moves in this plan.

## 4. Specs

- `contracts/src/lib/messages/list.messages.spec.ts:60`: `LINE_QUANTITY_MAX` is 999999.
- `core/src/app/lists/line-quantity-delta.spec.ts:423`: the message reads "at most 999999";
  add a delta that takes a line to exactly 999 999 and one that would pass it.
- `core/src/app/lists/line-add-merge.spec.ts:1091` to `:1096`: unchanged in shape; it reads
  the constant and now holds a line at 999 999.
- The contracts schema spec (`libs/luna-shopper/contracts/src/schemas/schemas.spec.ts`): a
  `line.addQuantity` request with `delta` 999 999 and minus 999 999 is valid, 1 000 000 is not;
  the same for `line.update` `quantity` and the basket `demandRequest`.
- A gateway HTTP spec (`gateway/src/app/lists/line-unit.http.spec.ts` or a sibling): the four
  calls of the walk in "Progress evidence".
- `libs/velista/ui/src/lib/list/quantity-stepper.spec.ts:153` to `:163` and
  `libs/velista/models/src/lib/add-choice.spec.ts:88` to `:93` read the constant and pass
  unchanged; `libs/velista/ui/src/lib/list/line-composer.spec.ts:297` writes 100000 and is
  changed by velista `0185` (the composer loses its count), not here. If `0185` has not landed,
  this spec reads `LINE_QUANTITY_MAX`.
- `libs/luna-shopper-admin/feature-people`: the line form refuses 1 000 000 and takes 999 999.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass on the regenerated files.

## 5. The documents

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

The diff of `openapi.json` is the `maximum` (and the `minimum` of `delta`) of the fields of
section 1. A diff that reorders the document, or one on Windows that shows every line, is line
endings; regenerate, never format.

## 6. Acceptance criteria

- [ ] `LINE_QUANTITY_MAX` is 999999 in the contracts and in velista, and the back office's
      `QUANTITY_MAX` is 999999.
- [ ] Every bound of section 1 reads the new value; no number 100000 is left beside a line
      quantity in `apps/luna-shopper-backend`, `libs/luna-shopper`, `libs/velista` or
      `libs/luna-shopper-admin` outside migrations and generated files.
- [ ] No migration, column change or release task is added.
- [ ] The specs of section 4 pass, and `npx nx affected -t lint test` is green.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and committed.

## 7. Not in this plan

- How six digits are drawn (the short form, the exact form, "K"): velista `0188`.
- The steps (velista `0188`, `0186`) and the step a curator sets (backend `0261`).
- A ceiling per unit (N1).
- A `bigint` sum (N3).

## 8. Questions for the owner

1. **N4.** An installed Android build from before velista `0188` still has the reel, and one
   minus there moves a line above 100 000 down to 100 000. Raise `MIN_CLIENT_VERSION` to the
   first build with the stepper, or accept it, since such a line needs a newer device to write
   it first?
