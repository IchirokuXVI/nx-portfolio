# 0186: a line steps by what its product says

> Decided on 2026-11-09. Every weight or volume line in velista steps by one fixed rule:
> 25 g or 50 ml below a kilo or a litre, 250 from there (velista `0182` section 3). The owner
> decided that the curator sets the step of a product (U4): saffron needs a small step, a
> whole chicken a much bigger one, and nobody buys 1,425 kg of chicken nor 75 g of it.
> Backend `0261` gives a product sold by the kilo or the litre a curator set
> `quantityStep` in base units, null for the default, served on every product view a line
> reads. This plan makes every place that steps a weight or a volume line read it.
>
> Amends velista `0182` section 3 (the steps) and target 5. Needs backend `0261` in `dev` and
> on the gateway, which itself needs PRs #959 to #961. The back office form that writes the
> step is admin `0070` (another writer's, not read for this plan). Velista `0185` and `0187`
> are independent of this plan; `0187` makes the product page's lists table step, and once
> this plan is built that step is the product's.
>
> Prerequisite reading: backend `0261` sections 0 (S1 to S5), 4 and 5 (the rule this plan
> mirrors, row for row); velista `0182` section 3; velista `0054` (the reel); velista `0183`
> target 7 (`lineShownProduct`, and why S5 does not use it).
>
> Code anchors, on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-09:
> `libs/velista/models/src/lib/line-unit.ts:121` (`QUANTITY_COARSE_FROM`), `:124`
> (`QUANTITY_FINE_STEP`), `:131` (`QUANTITY_COARSE_STEP`), `:142` (`stepAt`), `:162`
> (`stepFrom`), `:179` (`stepsFrom`), `:206` (`LineUnitProduct`), `:228` (`unitsServedBy`);
> `libs/velista/models/src/lib/limits.ts:163` (`QUANTITY_REEL_PX_PER_UNIT = 40`) and `:177`
> (`QUANTITY_REEL_PAGE_STEP = 5`); `libs/velista/ui/src/lib/list/quantity-reel.ts:172` (the
> `unit` input), `:567` (the drag's `Math.round(travelled / QUANTITY_REEL_PX_PER_UNIT)`),
> `:771` and `:776` (`stepsFrom`, `stepFrom`); `quantity-stepper.ts:121` (`unit`) and `:157`;
> `libs/velista/ui/src/lib/list/suggestion-list.ts:379`;
> `libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.ts:258`
> (`howManyFloor`); `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts:524`
> (`_step`) and `:624` (`_legacyUnit`, which reads `ItemNames`);
> `libs/velista/data-access/src/lib/lines/line-store.ts:880` (`addQuantity`, which takes a
> delta computed by the control) and `:1820`; `libs/velista/data-access/src/lib/catalog/item-names.ts:87`
> (`nameOf`); the mappers `libs/velista/data-access/src/lib/mapping/mappers.ts:721`
> (`toCatalogItem`, `approxWeight` at `:743`), `catalog-browse-mappers.ts:68`,
> `basket-mappers.ts:600` (`toBasketProduct`, `:616`); the models
> `libs/velista/models/src/lib/domain.ts:533` (`CatalogItem`), `catalog-browse.ts:126`
> (`CatalogProduct`), `basket-view.ts:320` (`BasketProduct`); every `[unit]=` binding of a reel
> or a stepper: `line-row.html:275`, `due-line-row.ts:60`, `line-page.html:133`,
> `line-detail-sheet.html:115` and `:417`, `basket-row.html:365`, `row-entries.html:52` and
> `:116`, `lists-table.ts:85` and `:117`, `product-row.ts:573` and `:617`.
>
> Read "Angular conventions" in `CLAUDE.md` before any code. Nothing new is drawn, so
> `design-taste-frontend` is needed only if a label changes.

## Brief for the agent

### Objective

Map `quantityStep` from every product view, resolve the step of a line by the rule of
backend `0261` section 5, and pass it to every reel, stepper and store that steps a weight
or a volume line, with today's rule wherever the product says nothing.

### Context

- The step lives in four functions of `line-unit.ts` and two tables of constants. `stepAt`
  reads only the value and the unit; no product reaches it.
- The controls compute the step and the stores receive a delta or an absolute value. The
  reel and the stepper call `stepFrom` and `stepsFrom`; `suggestion-list.ts:379` (the
  typeahead card's held line) and `CatalogAddStore._step` call `stepFrom` themselves;
  `LineStore.addQuantity` takes the delta the control made and steps nothing.
- Both stores already read product records for a line through `ItemNames.nameOf`, for the
  legacy unit rule of PR #960 (`catalog-add-store.ts:624`, `line-store.ts:1820`). Those are
  `CatalogItem`s mapped by `toCatalogItem`.
- Every e2e step that asserts a step today uses a product with no step: Milk by the litre
  in `catalog.spec.ts` step 8 (`:281` to `:304`, 250 ml from a litre) and the loose bananas
  of `shop.spec.ts` (`:445` to `:475`, ten steps of 25 g from 1000 to 750). Both keep their
  numbers.

### Target state

1. `CatalogItem`, `CatalogProduct`, `BasketProduct` and `LineUnitProduct` carry
   `quantityStep: number | null`, mapped from `unknown` and kept only when it is one of
   backend `0261`'s ten steps.
2. One pure `lineStepOf(line, productOf): number | null` in `line-unit.ts`, the table of
   backend `0261` section 5: null for a `UNIT` line and for a line no product of which
   serves its unit with a step; the step of the one product; the smallest step among the
   members that serve the unit and carry one. A product not read says nothing.
3. `stepAt`, `stepFrom` and `stepsFrom` take an optional `step: number | null`. With a step,
   one step is that step at every value and the grid is its multiples; with null, today's
   rule, unchanged.
4. The reel, the stepper, the typeahead card, the lists table, the line page, the line
   detail sheet, the basket row, the row entries, the due line row and the list row each take
   a `step` input beside `unit` and pass it to every place they read a step.
5. The reel keeps 40 px per step whatever the step is: a drag across a chicken line travels
   as far per step as across a saffron line. `QUANTITY_REEL_PX_PER_UNIT` and
   `QUANTITY_REEL_PAGE_STEP` keep their meaning, in steps.
6. A new line still starts at `defaultQuantity(unit)` (1000), which every allowed step
   divides (backend `0261` S2), so the take back floor of velista `0182` and `visitFloor`
   are unchanged.

### Scope

- Work in `libs/velista/models`, `libs/velista/data-access`, `libs/velista/ui`,
  `libs/velista/feature-lists`, `libs/velista/feature-shopping-lists`,
  `libs/velista/feature-catalog` and `apps/velista-luna-e2e`.
- Do NOT change the words of an amount (`formatQuantity` still switches to kilos at 1000,
  `libs/velista/platform/src/lib/quantity.ts:47`), the default amount of a new line, the
  server, or the back office.
- Do NOT read the step on a `UNIT` line: a count steps by one (backend `0261` section 5).

### Constraints

- Rule D4: `quantityStep` is read from `unknown` into velista's own fields. Velista keeps its
  own list of the ten steps beside `QUANTITY_FINE_STEP`, stated as backend `0261` S2's; no
  import from `@portfolio/luna-shopper/contracts`.
- The reel's six step assumptions of velista `0182` section 3 each read the step, and each has
  a spec line with a product step.
- No dashes as punctuation in comments.

### Action boundaries

- Proceed with sections 1 to 4 once backend `0261` is in `dev`.
- **Stop and ask before changing what one step of the reel is in pixels.** The meaning of
  `QUANTITY_REEL_PX_PER_UNIT` does not change in this plan (40 px per step, for a count, for
  today's rule and for a product step alike), and any change to it is the owner's.
- Stop and ask if a product view the gateway serves for a line lacks `quantityStep` (backend
  `0261` section 4 asks its builder to list any).

### Progress evidence

Each criterion of section 6 with its spec output, `npx nx build velista`, and one walk on a
slot with backend `0261`: a product given a step of 100 in the back office, added from the
typeahead at 1 kg, stepped down three times on the list row to 700 g, its line page's reel and
its basket row stepping by 100 g too, and the loose bananas with no step still stepping 25 g
below a kilo.

## 0. Decisions

### The owner's, 2026-11-09, fixed

- **U4. The curator decides the step of a product.** Small products (saffron) need a small
  step, big ones (a whole chicken, tuna, meat) a much bigger one. A step per product, set in
  the back office. A product with no step keeps today's default.

### Backend `0261`'s, which this plan mirrors

- **S1. One step, not a pair**, and **S4. null is today's rule**: a step that is set applies
  at every value, with no change of grain at a kilo.
- **S2. Ten steps, each a divisor of 1000**: 1, 5, 10, 25, 50, 100, 200, 250, 500, 1000.
- **S3. Only a product sold by the kilo or the litre carries a step.**
- **S5. A line with several products takes the smallest step among its members that serve
  the line's unit and carry one.** Backend `0261` gives the reason: the product a line counts
  as (`lineShownProduct`) follows the cost of the amount (`0246` W3), so its step could
  change under the person's finger while stepping; the smallest step does not move with the
  amount and reaches every amount a larger one reaches.

### The writer's, open to the owner

- **A. One resolver in models, read through `ItemNames` by both stores and by every page.**
  `lineStepOf(line, productOf)` takes the same `productOf` the legacy unit rule already
  takes (`legacyLineUnit`, `line-unit.ts:68`), so the list page, the line page, the basket
  and the catalog sheet answer the same step for the same line from the same records. A
  step stored on the line view instead would be a second copy that a product edit leaves
  behind.
- **B. A product record not read yet says nothing**, as S5 says of a member with no step. A
  line whose records are still loading steps by today's rule and changes to its product's
  step once they arrive. The alternative, a control disabled until the records arrive, would
  block a step the person can already make, and the drawn amount is right either way.
- **C. The basket row reads its own product.** A basket row is one product (backend `0201`),
  served as `BasketProduct` on the row, so it takes `quantityStep` from that product and needs
  no `ItemNames` read.
- **D. Off grid amounts snap in the direction of the step**, by the existing `stepFrom` rule
  (`line-unit.ts:151` to `:161`), now over the product's grid. A line at 975 g on a step of
  100 goes up to 1000 and down to 900. Backend `0261` section 5 states the same, and the
  server accepts any amount.
- **E. The typeahead card and the catalog rows read the step of the product they show.**
  They hold one product, so the S5 rule reduces to that product's step; they still call
  `lineStepOf`, so a held line with several products is stepped as the list steps it.

## 1. The models and the mappers

- `CatalogItem` (`domain.ts:533`), `CatalogProduct` (`catalog-browse.ts:126`) and
  `BasketProduct` (`basket-view.ts:320`) gain `quantityStep: number | null`.
  `LineUnitProduct` (`line-unit.ts:206`) gains it too, so `lineStepOf` reads the same record
  shape `lineUnits` reads.
- `QUANTITY_STEPS: readonly number[]` in `line-unit.ts`, the ten steps of backend `0261` S2,
  with a comment that names it.
- `toCatalogItem` (`mappers.ts:721`), the catalog browse mapper (`catalog-browse-mappers.ts:68`)
  and `toBasketProduct` (`basket-mappers.ts:600`) read `raw['quantityStep']` as a positive
  integer that is in `QUANTITY_STEPS`, else null. A step on a product the client reads as not
  sold by the kilo or the litre is kept as served and ignored by `lineStepOf`, since S3 is the
  server's rule.
- The in memory catalog, line and basket fakes carry `quantityStep: null` on every product
  and one product with a step (100 g) for the specs.

## 2. The rule

```ts
/** The step of a line's product (backend 0261 section 5), or null for today's rule. */
export function lineStepOf(
  line: { readonly unit: LineUnit; readonly itemIds: readonly string[] },
  productOf: (itemId: string) => LineUnitProduct | null
): number | null;

export function stepAt(value: number, unit: LineUnit, step?: number | null): number;
export function stepFrom(value: number, unit: LineUnit, direction: 1 | -1, step?: number | null): number;
export function stepsFrom(value: number, unit: LineUnit, steps: number, min: number, max: number, step?: number | null): number;
```

- `lineStepOf`: null for `UNIT`. Otherwise the members are the line's products that are read,
  that serve the line's unit (`unitsServedBy`, `line-unit.ts:228`) and that carry a step;
  the answer is the smallest of their steps, or null when there are none.
- `stepAt(value, unit, step)`: 1 for a count; `step` when it is a number; today's fine or
  coarse step otherwise.
- `stepFrom` keeps its two branches. Going down it reads the step "just below `value`"
  (`stepAt(value - 1, ...)`), which with a product step is the same step, so a step of 100
  from 1000 lands on 900 and up from 900 on 1000.
- `stepsFrom` passes the step to each `stepFrom`.

## 3. The controls and the stores

- **`QuantityReel`** gains `step = input<number | null>(null)` and passes it to the six
  places of velista `0182` section 3: previous and next, the drag, the keys, the page step,
  the buttons and the ARIA values. The drag still moves one step per
  `QUANTITY_REEL_PX_PER_UNIT` (40 px) travelled (`quantity-reel.ts:567`), and a page key
  still moves `QUANTITY_REEL_PAGE_STEP` (5) steps, so a page key on a 1 g line moves 5 g and on
  a 100 g line 500 g. `aria-valuenow` stays the integer in base units.
- **`QuantityStepper`** gains the same input and emits `±` the step at its value.
- **The containers** bind `[step]` beside each `[unit]` named in the anchors, with
  `lineStepOf(line, (id) => items.nameOf(id))` from the page's `ItemNames`, or from the
  product the row holds (decisions C and E). `line-detail-sheet.ts:258`'s `howManyFloor`
  becomes `stepFrom(0, unit, 1, step)`, one step of the product.
- **`suggestion-list.ts:379`** passes the held line's step to `stepFrom`.
- **`CatalogAddStore._step`** (`catalog-add-store.ts:524`) resolves the line's step with
  `lineStepOf` over `this._items` and passes it to `stepFrom`. The take back test beside it
  (`:534` to `:541`) is unchanged: it compares with `visitFloor`, which is 1000 and on every
  grid. `_correctUnit` still writes `defaultQuantity(unit)`.
- **`LineStore`** steps nothing and changes nothing: the delta it receives was made by a
  control that now reads the step.

## 4. Specs and e2e

- `line-unit.spec.ts`: `lineStepOf` for each row of backend `0261` section 5 (a count; one
  product with 100; two members with 250 and 25, answering 25; a member that serves the unit
  with no step beside one with 100, answering 100; a member not read; no member with a step,
  answering null); `stepAt`, `stepFrom` and `stepsFrom` with a step of 1, 100 and 1000,
  including 1000 down to 900 and 975 snapping to 1000 and 900; the existing cases unchanged
  with no step.
- The mapper specs of `mappers.ts`, `catalog-browse-mappers.ts` and `basket-mappers.ts`:
  `quantityStep` from `unknown`, null when absent, null for 30, for a string and for 0.
- `quantity-reel.spec.ts`: each of the six places moves by a product step of 100, the drag
  moves one step per 40 px with a step of 1 and of 1000 alike, and the page key moves five
  steps. The existing cases keep `step` unset.
- `quantity-stepper.spec.ts`: the emitted change is the step.
- `catalog-add-store.spec.ts`: a plus and a minus on a held line of a stepped product move by
  its step, and the take back at 1000 still deletes a line the visit made.
- The container specs that bind a reel or a stepper (`line-row`, `due-line-row`, `line-page`,
  `line-detail-sheet`, `basket-row`, `row-entries`, `lists-table`, `product-row`,
  `suggestion-list`): one case each that the step reaches the control.
- `LineStore` specs: unchanged, since the store receives deltas.
- `apps/velista-luna-e2e`: `catalog.spec.ts` step 8 and the weighted test of `shop.spec.ts`
  keep their numbers (Context), because Milk and the loose bananas carry no step. The
  weighted `describe` gains a second product made the same way (`ensureItem` with
  `KILOGRAM`, `shop.spec.ts:421`), given `quantityStep: 100` through the admin update of
  backend `0261` section 3, with a test that its line starts at 1000, steps down three
  times to 700 (`aria-valuetext` "700 g"), and records a buy of 300 g. It is a separate
  product so that the bananas' numbers never depend on a step left by an earlier run.

## 5. Not changed

- The words of an amount, and where they switch to kilos.
- The default amount of a new line, 1000 for a weight or a volume, whatever the step. A
  saffron line therefore starts at a kilo; see question 1.
- Any server rule on amounts: backend `0261` refuses no amount off the step.

## 6. Acceptance criteria

- [ ] `quantityStep` is mapped on `CatalogItem`, `CatalogProduct` and `BasketProduct`, and
      only the ten steps survive the mapper.
- [ ] `lineStepOf` answers each row of backend `0261` section 5, with its spec naming that
      section.
- [ ] Every reel and stepper that draws a weight or a volume line steps by the product's step
      when it has one, and by today's rule when not; a count steps by one.
- [ ] The reel still moves one step per 40 px and five steps per page key, with a spec for a
      step of 1 and of 1000.
- [ ] The catalog sheet, the list row, the line page and the basket row step one stepped line
      by the same step.
- [ ] `catalog.spec.ts` step 8 and the bananas test pass unchanged, and the stepped product
      test of section 4 passes on a slot with backend `0261`.
- [ ] `npx nx affected -t lint test` is green and `npx nx build velista` builds.

## Not in this plan

- **The back office form** that writes the step. Admin `0070`.
- **A default amount that follows the step.** Question 1.
- **A step for a count or for a pack.** Backend `0261` S3.
- **The product page's lists table stepping an existing line.** Velista `0187`.

## Questions for the owner

1. A new line starts at a kilo or a litre (U3, `defaultQuantity`) whatever the product's
   step. Should a product with a small step (saffron at 1 g) start at something smaller, or
   is a kilo of saffron, stepped down, acceptable until a curator can set a start too?
2. A page key on the reel moves five steps: 5 g on saffron and 500 g on a step of 100. Is five
   steps the right page for both ends, or should the page move a fixed amount instead?
