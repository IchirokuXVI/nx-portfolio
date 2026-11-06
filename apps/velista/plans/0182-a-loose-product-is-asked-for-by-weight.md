# 0182: a loose product is asked for by weight

> Decided on 2026-11-05. A line for bananas sold by the kilo says "×1" and means one kilo,
> because the number on a line counts nothing in particular and velista reads it as kilos
> for a loose product (backend `0244` D4). A shopper who wants 750 g cannot say so, the list
> cost multiplies a price per kilo by a count, and a buy of "3" of that line is recorded as
> three of something. Backend `0246` gives the line a unit. This plan makes velista count a
> loose product in grams or millilitres, step it by the owner's steps, draw it as "750 g" or
> "1,5 kg", and total it as an estimate.
>
> Needs backend `0246` on the gateway first, and velista `0179` (PR #920) merged: the kinds,
> `soldAs`, `amountOfOne` and `PriceWords` come from it. Velista `0183` (a line with several
> products chooses its unit) builds on this plan.
>
> Prerequisite reading: backend `0246` sections 0, 1, 2 and 3.2; velista `0179` sections 1
> and 2; velista `0070` sections 2, 4 and 7 (the old design of the same screens; its
> formatting rule and reel rule survive, its chip and equivalences do not); velista `0054`
> (the reel); velista `0209` (`from`, `stale_quantity`). Code:
> `libs/velista/models/src/lib/domain.ts` (`Line`, `LineSettlement`), `sold-as.ts`,
> `limits.ts`, `basket-total.ts`, `line-products.ts` (`listCost`),
> `libs/velista/data-access/src/lib/line-api.ts`, `line-store.ts`, `basket-store.ts`,
> `libs/velista/ui/src/lib/list/quantity-reel.ts`, `quantity-stepper.ts`,
> `libs/velista/feature-shopping-lists/src/lib/basket-labels.ts` (`quantityCaption`),
> `line-detail-sheet.ts`, `settle-sheet.ts`, `basket-row.ts`, `row-entries.ts`,
> `line-composer.ts`, `catalog-add-store.ts`. Load the `nx-portfolio-angular-developer`
> skill before any code, and `design-taste-frontend` for the reel label and the captions.

## Brief for the agent

### Objective

Count a line for a product sold by the kilo or the litre in grams or millilitres, with the
unit on the model, on every write and on every screen that draws or edits a quantity, and
total such a line as an estimate through the amount table of backend `0246` section 2.

### Context

- `Line` (`domain.ts:228`) has `quantity: number` and no unit. `LineSettlement.quantity` is
  "units bought" and `unitPriceCents` "what one unit cost".
- Every quantity control steps by one: `QuantityReel` (`previous`/`next` ±1, the drag's
  `Math.round(travelled / QUANTITY_REEL_PX_PER_UNIT)`, `_stepFor` ±1 and ±`QUANTITY_REEL_PAGE_STEP`,
  the buttons, the pill, `aria-valuenow`) and `QuantityStepper` (`stepped: 1 | -1`). The
  e2e suites assert integer `aria-valuenow` strings.
- `LineApi.addQuantity` posts `{ delta }` and never `expect`; `LineStore.addQuantity`
  applies `line.quantity + delta` optimistically. The composer resets `quantity` to 1 after a
  submit; the catalog add sends 1; the assistant runs on the server.
- Two totals multiply a price by the raw quantity: `basketTotal` (`basket-total.ts:142`,
  integer cents, `amountOfOne` on the `0179` branch) and `listCost` (`line-products.ts:341`,
  floating point then rounded). There is no per line total.
- `quantityCaption` (`basket-labels.ts:266`) draws `×{{count}}` when more than one is left
  and nothing at one. `productSizeText` formats a size with `Intl` and `list.add.size.*`.
- Velista `0179` adds `soldAs`, `soldAsOf`, `amountOfOne`, `PriceWords`, `priceWords`,
  `unitPriceWords`, `approxWeight` on the three product models, `piecePrice` on the offer,
  and renames `catalog.unit.*` to `catalog.per.*`.
- Production holds 3 lines on loose products, all stocked, so nothing a person sees today
  changes meaning on the day; every loose product added after it does.

### Target state

1. `Line.unit: LineUnit` (`'UNIT' | 'GRAM' | 'MILLILITER'`, velista's own union), mapped
   from `unknown` with `UNIT` as the fallback. `LineSettlement.unit` and `estimated` too.
   `BasketRow.unit` and the entry's `unit`.
2. One pure `lineUnitOf(kind)` and one `lineAmount(quantity, unit, product, offer)` in
   `libs/velista/models`, beside `sold-as.ts`, mirroring backend `0246` sections 1 and 2 row
   for row, with a spec that names the backend spec. `amountOfOne` stays as the price of one.
3. Every write states the unit: an add sends `lineUnitOf(soldAs(product))` and
   `defaultQuantity(unit)` (1, or 1000 for a weight or a volume); every absolute update sends
   `unit` with `quantity`; every delta sends `unit`; a settle and a demand send it. A
   `line_unit_mismatch` is recovered like `stale_quantity`: the server's line replaces the
   preview, no error is shown.
4. `formatQuantity(quantity, unit, locale)` in `platform`, through `Intl.NumberFormat` with
   `style: 'unit'`: "×2" for `UNIT`, "750 g" below a thousand, "1 kg" and "1,5 kg" from a
   thousand with at most one decimal, the same for millilitres and litres. The wire never
   carries a kilo.
5. The reel and the stepper step by the unit: 1 for `UNIT`; 25 below a thousand and 250 from
   it for `GRAM`; 50 and 250 for `MILLILITER`. The label under the thumb, the neighbours, the
   page step, the drag, the buttons and the ARIA values all move by that step; the delta on
   the wire stays one signed integer in base units.
6. Every screen that draws a quantity draws it through `formatQuantity`: the list row, the
   line page, the line detail sheet, the basket row ("750 g", "250 g of 750 g"), the row
   entries, the settle sheet, the history. A weight line draws its caption at a quantity of
   one gram too, where a count draws nothing at one.
7. `listCost` and `basketTotal` sum `lineAmount(...)` in integer cents, rounded once, and
   carry `estimated` when any addend is. The list header's "~" becomes the estimate mark only
   when the total is estimated; an exact total drops it.
8. The settle sheet's subtitle reads "1,99 € / kg · 750 g to get" for a weight line and quotes
   the amount "≈ 1,49 €" for the quantity being settled, live under the reel. The "Bought"
   tab draws what was bought per unit and the spend with the estimate mark when the server
   says so.

### Scope

- Work in `libs/velista/models`, `platform`, `data-access`, `ui` and
  `feature-shopping-lists`, and `apps/velista-luna-e2e`.
- Do NOT add a unit chip, a unit picker or any control that changes a line's unit: that is
  velista `0183`. Do NOT touch the catalog tab, the product page's prices or the back office.

### Constraints

- Rule D4: own models, mapped from `unknown`. No import from `@portfolio/luna-shopper/contracts`.
- No dashes as punctuation in any prose or copy. Copy through RokuTranslator keys in `en`
  and `es`; numbers through `Intl`, never inside a key.
- The reel's six step assumptions are each touched and each has a spec line.
- No mock: nothing new is drawn. A number changes its words and a control its step.

### Action boundaries

- Proceed with everything in sections 1 to 4.
- Stop and ask if backend `0246` is not on the gateway of the slot, if its wire shape differs
  from its section 3, or if velista `0179` is not merged.
- Stop and ask before changing the reel's `QUANTITY_REEL_PX_PER_UNIT` meaning for a count.

### Progress evidence

Each criterion of section 5 with its spec output, `npx nx build velista`, and one walk on a
slot with backend `0246`: a loose product added from the typeahead starts at "1 kg", the reel
steps it to 750 g, the list header's cost changes by the price of 250 g, a buy of 250 g
records it, and the "Bought" tab reads "250 g".

## 1. The model and the mapper

```ts
/** What a line's quantity counts (backend 0246). Base units: 750 g is 750. */
export type LineUnit = 'UNIT' | 'GRAM' | 'MILLILITER';
export const LINE_UNITS: readonly LineUnit[] = ['UNIT', 'GRAM', 'MILLILITER'];

export function lineUnitOf(kind: SoldAs): LineUnit; // BY_THE_KILO → 'GRAM', else 'UNIT'
export function defaultQuantity(unit: LineUnit): number; // 1, 1000, 1000
```

`soldAs` gains `BY_THE_LITRE` (`LITER` with no size) to match backend `0246` section 1, and
`lineUnitOf` answers `MILLILITER` for it. `Line`, `LineSettlement`, `BasketRow` and
`BasketRowEntry` gain `unit`; `LineSettlement` gains `estimated`. The mappers read each with
`oneOf(LINE_UNITS, 'UNIT')`. The in memory line and basket fakes carry the fields.

`lineAmount(quantity, unit, product, offer): LineAmount | null` in `models` is the table of
backend `0246` section 2, with the same three null rules, in integer cents. It reads
`piecePrice` off the wire and never derives one. `amountOfOne` (velista `0179`) stays what
it is and is what a row's "price of one" means.

## 2. The writes

- `LineService.addLine` / `addLineResult` and `BasketStore.addLine` take `unit` and send it.
  The composer, the catalog add (`catalog-add-store.ts`), the settle sheet's add and the
  basket page's add derive it with `lineUnitOf(soldAsOf(offer, product))` and start the
  quantity at `defaultQuantity(unit)`. A free text add sends `UNIT`.
- `updateLine` sends `unit` whenever it sends `quantity`. The line detail sheet's save does.
- `addQuantity(lineId, delta, unit)` and `setDemand({ ..., unit })` send the line's unit.
  `LineStore.addQuantity` keeps its optimistic sum (base units add) and treats
  `line_unit_mismatch` exactly as `stale_quantity`.
- The settle (`settle-sheet.ts`, the line detail sheet's buy) sends `unit` and a quantity in
  it; `howMany` floors at one step of the unit, not at 1.

## 3. The screens

- **`formatQuantity`** in `libs/velista/platform/src/lib/quantity.ts`, beside `money.ts`.
  `UNIT` keeps today's "×N" form so no caller decides the shape. The caption rule of
  `quantityCaption`: a `UNIT` line at one draws nothing, as today; a weight or volume line
  draws its amount always, because "1 kg" is the fact and "×1" was the noise.
- **The reel** gains `unit` (default `UNIT`). `stepAt(value, unit)` answers 1, or 25 / 50
  below `QUANTITY_COARSE_FROM` (1000) and 250 from it, and every one of the six places reads
  it: `previous` / `next`, the drag's pixels per step (a swipe across ham travels the same
  distance as across cartons), `_stepFor`, the buttons, the pill (through `formatQuantity`),
  the ARIA values (`aria-valuenow` stays the raw base unit integer, `aria-valuetext` carries
  the words). Stepping down from 1000 lands on 975 or 950, and up from 975 on 1000, by the
  divisibility rule of backend `0096` section 4 that still holds.
- **The stepper** gains `unit` and emits `±stepAt(value, unit)` instead of `±1`; its output
  type becomes a signed integer.
- **Rows and pages**: the list row's reel, the line page's number, the line detail sheet's
  reel and "how many", the basket row's outstanding and `ceiling`, the row entries' asked
  and raised, the settle sheet's reel, and `gotToday` all pass the line's unit and draw
  through `formatQuantity`.
- **Totals**: `listCost` and `basketTotal` sum `lineAmount` and answer
  `{ cents, estimated }`. The list header draws "≈" before an estimated cost and nothing
  before an exact one; the basket total bar does the same. A line with no amount is counted as
  unpriced, as a line with no price is today.
- **The settle sheet** subtitle for a weight line: `priceWords` of one kilo ("1,99 € / kg")
  and "750 g to get"; the amount line "≈ 1,49 €" for the quantity under the reel. For a count
  it is unchanged.
- **The "Bought" tab and the history**: a settlement draws `formatQuantity(quantity, unit)`,
  and the spend from the server carries the estimate mark when `estimated`.

## 4. The e2e suite

`apps/velista-luna-e2e`: `nudge` presses the arrow keys and asserts `aria-valuenow`, which
stays an integer, so the existing specs keep passing for counts. `shop.spec.ts` gains one
loose product scenario against the slot's seed: added at 1000, nudged to 750, bought at 250,
and the "Bought" read says 250 g. The seed of the slot needs one product sold by the kilo
with a price (the walk recipe of backend `0244`).

## 5. Acceptance criteria

1. Mapper specs: `unit` from `unknown` with the fallback on every model that carries it;
   `estimated` on a settlement.
2. `line-amount.spec.ts` mirrors backend `0246` section 2 row for row, including the cents
   rounding case, and `lineUnitOf` for all four kinds.
3. `quantity.spec.ts`: `formatQuantity` for each unit in `en` and `es`, on both sides of a
   thousand, 1000 as "1 kg", 12500 as "12,5 kg", and "×2" for a count.
4. `quantity-reel.spec.ts`: the step changes at a thousand in both directions, the label
   switches with it, each of the six places moves by the step, and a count is unchanged.
5. `basket-labels.spec.ts`: the caption of a weight line at one, wanted, partly settled and
   done; a count at one still draws nothing.
6. `listCost` and `basketTotal` specs: a weight line is an estimate, a count is exact, a mix
   is an estimate, and a kilo piece with no `piecePrice` is unpriced.
7. Data access specs: every write carries the unit; a `line_unit_mismatch` is recovered like
   `stale_quantity`.
8. `npx nx affected -t lint test` is green, `npx nx build velista` builds, and the e2e
   scenario of section 4 passes on a slot.

## Not in this plan

- **Any way to change a line's unit.** Velista `0183`.
- **The cheapest mark between the products of a line and the basket's change sheet under
  W3.** Velista `0183`.
- **A unit on a free text line.** Backend `0246` W1 keeps it a count.
