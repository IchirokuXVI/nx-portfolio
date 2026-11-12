> **PR:** [#988](https://github.com/IchirokuXVI/nx-portfolio/pull/988)

# 0186: a line steps by what its product says

> Amended on 2026-11-11: the default steps are now 25 g, 25 ml and 1 (a count steps by 10 from
> 1000, velista `0188` S7b), with no larger step from 1000; the 50 ml step and the 250 step
> are gone. Only the sentences that stated the default steps changed.
>
> Amended again on 2026-11-11, a second pass: the reel is gone from this plan. Velista `0188`
> replaces the reel with a stepper with two buttons, and after `0188` and `0190` no reel exists
> in velista. This plan now reads the product's step into the rule of `0188` section 1
> (`stepAt`, `stepFrom` and `canStepUp`) and into every `lib-quantity-stepper` that draws a
> weight or a volume line. Removed: the drag, pixels per step, `QUANTITY_REEL_PX_PER_UNIT`,
> `QUANTITY_REEL_PAGE_STEP`, the page keys, the reel's six step assumptions, the reel specs,
> the boundary on the reel's pixels and the question on the page key. Rewritten: decision D
> (no grid and no snapping, `0188` decision B, in place of a snap onto the product's grid),
> the S7b hundredth rule applied to a product step (decision F, question 2), and every
> example that snapped.
>
> Amended on 2026-11-12, the owner's decisions of that day. A line steps the same on every
> screen, so decision A wins over decisions C and E: the settle sheet and the shopping list
> page's typeahead step a zone line by `lineStepOf` over every product the line holds, not by
> the basket row's own product (decisions C and E, section 3). Backend `0263` is withdrawn: a
> line at 0 is never deleted by a write, it is hidden, so a minus that reaches 0 in one press
> (a line at 300 g on a step of 500, decision D) hides the line and deletes nothing.
>
> Decided on 2026-11-09. Every weight or volume line in velista steps by one fixed rule:
> 25 g or 25 ml at every amount (velista `0188`, which replaced `0182` section 3). The owner
> decided that the curator sets the step of a product (U4): saffron needs a small step, a
> whole chicken a much bigger one, and nobody buys 1,425 kg of chicken nor 75 g of it.
> Backend `0261` gives a product sold by the kilo or the litre a curator set
> `quantityStep` in base units, null for the default, served on every product view a line
> reads. This plan makes every stepper that steps a weight or a volume line read it.
>
> Needs velista `0188` built first: this plan passes a step into the functions and the
> component `0188` writes. Needs backend `0261` in `dev` and on the gateway, which itself
> needs PRs #959 to #961. The basket row and the row entries draw a reel until velista `0190`
> replaces it; their part of this plan waits on `0190` (Action boundaries). The back office
> form that writes the step is admin `0070` (another writer's, not read for this plan).
> Velista `0185` and `0187` are independent of this plan; `0187` makes the product page's
> lists table step, and once this plan is built that step is the product's.
>
> Prerequisite reading: backend `0261` sections 0 (S1 to S5), 4 and 5 (the rule this plan
> mirrors, row for row); velista `0188` sections 0 (S7, S7b, S8, decisions B and M), 1, 3 and
> 5; velista `0183` target 7 (`lineShownProduct`, and why S5 does not use it).
>
> Code anchors, on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-09. They name the
> code before velista `0188`; `0188` rewrites `stepAt` and `stepFrom`, removes the two step
> tables and moves the callers, and its section 1 is the shape this plan builds on.
> `libs/velista/models/src/lib/line-unit.ts:121` (`QUANTITY_COARSE_FROM`), `:142` (`stepAt`),
> `:162` (`stepFrom`), `:206` (`LineUnitProduct`), `:228` (`unitsServedBy`);
> `quantity-stepper.ts:121` (`unit`); `libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.ts:258`
> (`howManyFloor`); `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts:624`
> (`_legacyUnit`, which reads `ItemNames`); `libs/velista/data-access/src/lib/lines/line-store.ts:1820`;
> `libs/velista/data-access/src/lib/catalog/item-names.ts:87` (`nameOf`); the mappers
> `libs/velista/data-access/src/lib/mapping/mappers.ts:721` (`toCatalogItem`, `approxWeight`
> at `:743`), `catalog-browse-mappers.ts:68`, `basket-mappers.ts:600` (`toBasketProduct`,
> `:616`); the models `libs/velista/models/src/lib/domain.ts:533` (`CatalogItem`),
> `catalog-browse.ts:126` (`CatalogProduct`), `basket-view.ts:320` (`BasketProduct`); every
> `[unit]=` binding of a control that `0188` makes a `lib-quantity-stepper`: `line-row.html:275`,
> `due-line-row.ts:60`, `line-page.html:133`, `line-detail-sheet.html:115` and `:417`,
> `lists-table.ts:85` and `:117`, `product-row.ts:573` and `:617`, `visit-added.ts:80`, and the
> settle sheet's steppers that `0190` draws in place of `basket-row.html:365` and
> `row-entries.html:52` and `:116`.
>
> Read "Angular conventions" in `CLAUDE.md` before any code. Nothing new is drawn, so
> `design-taste-frontend` is needed only if a label changes.

## Brief for the agent

### Objective

Map `quantityStep` from every product view, resolve the step of a line by the rule of
backend `0261` section 5, and pass it to every `lib-quantity-stepper` that steps a weight or a
volume line, so that a press moves the amount by the product's step, and by `0188`'s default
wherever the product says nothing.

### Context

- After velista `0188` the step lives in `line-unit.ts`: `QUANTITY_STEP` (25 g, 25 ml, 1),
  `stepAt` (the base step, never less than one hundredth of the name the row shows, S7b),
  `stepFrom` (a plain sum with no grid, decision B) and `canStepUp`. They read only the value
  and the unit; no product reaches them.
- Every step a person makes goes through `lib-quantity-stepper`, which calls `stepFrom` and
  `canStepUp` and emits a `QuantityStep` (`from`, `to`, `repeat`). The callers take the
  stepper's `to`: `suggestion-list.ts` and `CatalogAddStore` no longer call `stepFrom`
  (`0188` section 1), and `LineStore.addQuantity` takes the difference and steps nothing.
  `0188` section 3.1 states that this plan adds a `step` input that the component passes to
  those two functions.
- Both stores already read product records for a line through `ItemNames.nameOf`, for the
  legacy unit rule of PR #960 (`catalog-add-store.ts:624`, `line-store.ts:1820`). Those are
  `CatalogItem`s mapped by `toCatalogItem`.
- Every e2e step that asserts a step today uses a product with no step: Milk by the litre
  in `catalog.spec.ts` step 8 (25 ml at every amount) and the loose bananas of `shop.spec.ts`
  (25 g at every amount). `0188` sets their numbers; this plan keeps them.

### Target state

1. `CatalogItem`, `CatalogProduct`, `BasketProduct` and `LineUnitProduct` carry
   `quantityStep: number | null`, mapped from `unknown` and kept only when it is one of
   backend `0261`'s ten steps.
2. One pure `lineStepOf(line, productOf): number | null` in `line-unit.ts`, the table of
   backend `0261` section 5: null for a `UNIT` line and for a line no product of which
   serves its unit with a step; the step of the one product; the smallest step among the
   members that serve the unit and carry one. A product not read says nothing.
3. `stepAt`, `stepFrom` and `canStepUp` of velista `0188` section 1 take an optional last
   argument `step: number | null`. The base step is `step` when it is a number, else
   `QUANTITY_STEP[unit]`; the S7b hundredth rule then applies to that base, so the step used
   is never less than 10 from 1000 (decision F). No grid and no snapping: plus adds the step
   at the amount as it stands, minus takes away the step plus used to get there (decision D).
4. `QuantityStepper` gains `step = input<number | null>(null)` and passes it to `stepFrom` and
   `canStepUp` and to the step its buttons name (`amount.less`, `amount.more`). Every
   container that draws a stepper for a weight or a volume line binds `[step]` beside `[unit]`.
5. A new line still starts at `defaultQuantity(unit)` (1000), which every allowed step
   divides (backend `0261` S2), so the take back floor of velista `0182` and `visitFloor`
   are unchanged.

### Scope

- Work in `libs/velista/models`, `libs/velista/data-access`, `libs/velista/ui`,
  `libs/velista/feature-lists`, `libs/velista/feature-shopping-lists`,
  `libs/velista/feature-catalog` and `apps/velista-luna-e2e`.
- Do NOT change the words of an amount (`shortAmount`, `exactAmount` and `formatQuantity`),
  the default amount of a new line, the hold, the quiet beat, the server, or the back office.
- Do NOT read the step on a `UNIT` line: a count steps by 1 below 1000 and by 10 from 1000
  (backend `0261` section 5, velista `0188` S7b).

### Constraints

- Rule D4: `quantityStep` is read from `unknown` into velista's own fields. Velista keeps its
  own list of the ten steps beside `QUANTITY_STEP`, stated as backend `0261` S2's; no import
  from `@portfolio/luna-shopper/contracts`.
- The step rule stays in `stepAt`, as `0188` section 1 asks: nothing else in the code knows
  the hundredth rule, and no container computes a step.
- Plus then minus returns on a stepped line as on a default one; a spec proves it for each
  step of section 4.
- No dashes as punctuation in comments.

### Action boundaries

- Proceed with sections 1 to 4 once velista `0188` and backend `0261` are in `dev`.
- **Stop and ask if velista `0188` is not merged.** This plan has no reel to fall back on.
- The basket row and the row entries draw a reel until velista `0190` replaces it. If `0190`
  is not merged, leave those two out, build the rest, and say so in the PR; never give the
  reel a step.
- Stop and ask if a product view the gateway serves for a line lacks `quantityStep` (backend
  `0261` section 4 asks its builder to list any).

### Progress evidence

Each criterion of section 6 with its spec output, `npx nx build velista`, and one walk on a
slot with backend `0261`: a product given a step of 100 in the back office, added from the
typeahead at 1 kg, pressed minus three times on the list row to 700 g and plus once back to
800 g, its line page's stepper and its line sheet stepping by 100 g too, a product given a
step of 5 stepping 5 g below 1 kg and 10 g from it, and the loose bananas with no step still
stepping 25 g.

## 0. Decisions

### The owner's, 2026-11-09, fixed

- **U4. The curator decides the step of a product.** Small products (saffron) need a small
  step, big ones (a whole chicken, tuna, meat) a much bigger one. A step per product, set in
  the back office. A product with no step keeps today's default.

### Velista `0188`'s, which this plan builds on

- **S7. One default step per unit:** 25 g, 25 ml, 1.
- **S7b. A press always changes what the row reads.** The step is never less than one
  hundredth of the name the row shows: a count steps by 1 below 1000 and by 10 from 1000.
- **B. No grid.** `stepFrom` adds or takes away the step with no snapping, so plus then minus
  returns.
- **M. The step follows the short form, also in a sheet.**

### Backend `0261`'s, which this plan mirrors

- **S1. One step, not a pair**, and **S4. null is the default**: a step that is set is the
  base step at every value.
- **S2. Ten steps, each a divisor of 1000**: 1, 5, 10, 25, 50, 100, 200, 250, 500, 1000.
- **S3. Only a product sold by the kilo or the litre carries a step.**
- **S5. A line with several products takes the smallest step among its members that serve
  the line's unit and carry one.** Backend `0261` gives the reason: the product a line counts
  as (`lineShownProduct`) follows the cost of the amount (`0246` W3), so its step could
  change under the person's finger while stepping; the smallest step does not move with the
  amount.

### The writer's, open to the owner

- **A. One resolver in models, read through `ItemNames` by both stores and by every page.**
  `lineStepOf(line, productOf)` takes the same `productOf` the legacy unit rule already
  takes (`legacyLineUnit`, `line-unit.ts:68`), so the list page, the line page, the basket
  and the catalog sheet answer the same step for the same line from the same records. A
  step stored on the line view instead would be a second copy that a product edit leaves
  behind.
- **B. A product record not read yet says nothing**, as S5 says of a member with no step. A
  line whose records are still loading steps by the default and changes to its product's
  step once they arrive. The alternative, a stepper disabled until the records arrive, would
  block a step the person can already make, and the drawn amount is right either way.
- **C. The basket's steppers read their own product.** A basket row is one product (backend
  `0201`), served as `BasketProduct` on the row, so the steppers `0190` draws for it take
  `quantityStep` from that product and need no `ItemNames` read.

  > Note of 2026-11-12: the owner ruled that A wins. A line steps the same on every screen,
  > and a line that holds several products could step by 250 in the settle sheet and by 100
  > on its zone list. Each list's stepper in the settle sheet now steps by `lineStepOf` over
  > the entry's `itemIds` (the basket read already carries them): a product the basket read
  > names comes from `Basket.products`, any other from `ItemNames`, which the basket page
  > fills for the measured lines' products the read did not name. A record not read yet says
  > nothing (decision B). A row whose line holds only its own product steps as before. A list
  > that does not ask yet still steps by the row's product, since the line it gains holds
  > that product.
- **D. No grid and no snapping, also on a product step** (velista `0188` decision B). Plus adds
  the step at the amount as it stands; minus takes away the step that plus uses one base step
  lower, so plus then minus returns. A line at 975 g on a step of 100 goes up to 1075 and down
  to 875; a line at 1000 goes down to 900 and up to 1100. Backend `0261` section 5 still says an
  amount off the grid snaps; this plan follows `0188` and the owner's sentence behind it, and
  the server accepts any amount either way.

  > Note of 2026-11-12. Minus never goes under 0, so a line under one step goes to 0 in one
  > press: a line at 300 g on a step of 500 goes to 0, and its minus draws the red trash of
  > velista `0188` S14 (class `is-clear`, read from `stepFrom(value, unit, -1, step)`), as a
  > line at 100 g on a step of 100 does. A saffron line at 1005 g on a step of 5 goes to 995
  > and draws no trash. Backend `0263` is withdrawn (the owner, 2026-11-12): a line at 0 is
  > never deleted by a write, it is hidden, so that press hides the line and deletes nothing.
- **E. The typeahead card and the catalog rows read the step of the product they show.**
  They hold one product, so the S5 rule reduces to that product's step; they still call
  `lineStepOf`, so a held line with several products is stepped as the list steps it.

  > Note of 2026-11-12: the owner ruled that A wins here too. The shopping list page's
  > typeahead holdings step each held line by `lineStepOf` over the line's own products, as
  > the settle sheet does (decision C's note), with the card's product standing in for a
  > record not read yet. The list page and the catalog rows already did.
- **F. The hundredth rule holds for a product step too** (the writer's reading of S7b, question
  2). The step used is the product's step, but never less than one hundredth of the name the
  row shows. A saffron step of 1 g or 5 g is used below 1000 g and becomes 10 g from 1000 g,
  because "1,00 kg" plus 1 g still reads "1 kg". A step of 10 or more is used unchanged at
  every amount.

## 1. The models and the mappers

- `CatalogItem` (`domain.ts:533`), `CatalogProduct` (`catalog-browse.ts:126`) and
  `BasketProduct` (`basket-view.ts:320`) gain `quantityStep: number | null`.
  `LineUnitProduct` (`line-unit.ts:206`) gains it too, so `lineStepOf` reads the same record
  shape `lineUnits` reads.
- `QUANTITY_STEPS: readonly number[]` in `line-unit.ts`, beside `QUANTITY_STEP`, the ten steps
  of backend `0261` S2, with a comment that names it.
- `toCatalogItem` (`mappers.ts:721`), the catalog browse mapper (`catalog-browse-mappers.ts:68`)
  and `toBasketProduct` (`basket-mappers.ts:600`) read `raw['quantityStep']` as a positive
  integer that is in `QUANTITY_STEPS`, else null. A step on a product the client reads as not
  sold by the kilo or the litre is kept as served and ignored by `lineStepOf`, since S3 is the
  server's rule.
- The in memory catalog, line and basket fakes carry `quantityStep: null` on every product
  and two products with a step (100 g and 5 g) for the specs.

## 2. The rule

```ts
/** The step of a line's product (backend 0261 section 5), or null for the default. */
export function lineStepOf(
  line: { readonly unit: LineUnit; readonly itemIds: readonly string[] },
  productOf: (itemId: string) => LineUnitProduct | null
): number | null;

// Velista 0188 section 1, each with a last optional `step`.
export function stepAt(value: number, unit: LineUnit, step?: number | null): number;
export function stepFrom(value: number, unit: LineUnit, direction: 1 | -1, step?: number | null): number;
export function canStepUp(value: number, unit: LineUnit, max: number, step?: number | null): boolean;
```

- `lineStepOf`: null for `UNIT`. Otherwise the members are the line's products that are read,
  that serve the line's unit (`unitsServedBy`, `line-unit.ts:228`) and that carry a step;
  the answer is the smallest of their steps, or null when there are none.
- The base step is `step` when the unit is `GRAM` or `MILLILITER` and `step` is a number;
  otherwise `QUANTITY_STEP[unit]`. A step passed for a count is ignored.
- `stepAt(value, unit, step)`: below `QUANTITY_COARSE_FROM` (1000) the base step; from it
  `max(base, 10)` (S7b, decision F). With null that is `0188`'s rule unchanged: 25 g and 25 ml
  at every amount, a count 1 below 1000 and 10 from 1000.
- `stepFrom(value, unit, direction, step)`: up, `value + stepAt(value, unit, step)`; down,
  `max(0, value - stepAt(max(0, value - base), unit, step))`, the step plus uses one base step
  lower (`0188` section 1). With a step of 100: 1000 down is 900, 900 up is 1000. With a step
  of 5: 995 up is 1000, 1000 up is 1010, 1010 down is 1000, 1000 down is 995.
- `canStepUp(value, unit, max, step)`: false when `value + stepAt(value, unit, step) > max`,
  and for a count as `0188` states.
- `stepsFrom` is not touched: it serves only the reel until velista `0190` removes it.

## 3. The stepper and its containers

- **`QuantityStepper`** gains `step = input<number | null>(null)` and passes it to every
  `stepFrom` and `canStepUp` it calls: a press, a repeat of the hold, the arrow keys of the
  sheet's field, and both ends. The `{{step}}` of `amount.less` and `amount.more` is the step
  that press would move, so a saffron line above a kilo says "Add 10 g". A typed amount is not
  stepped and is unchanged.
- **The containers** bind `[step]` beside each `[unit]` named in the anchors, with
  `lineStepOf(line, (id) => items.nameOf(id))` from the page's `ItemNames`, or from the
  product the row holds (decisions C and E): the zone list row, the due rows, the line page,
  the list's line sheet (both steppers), `ProductRow`'s two steppers, the lists table, the
  added sheet (`VisitAdded`), the shopping list page's typeahead, and once velista `0190` is
  merged the basket's steppers. Since 2026-11-12 the basket's steppers and the shopping list
  page's typeahead read the line's step too (the notes under decisions C and E).
- **`line-detail-sheet.ts:258`'s `howManyFloor`**, which `0188` makes `QUANTITY_STEP[unit]`,
  becomes `stepAt(0, unit, step)`, one step of the product.
- **`CatalogAddStore`** steps nothing: it takes the stepper's `to` (`0188` section 5.5). Its
  take back test is unchanged: it compares with `visitFloor`, which is 1000. `_correctUnit`
  still writes `defaultQuantity(unit)`.
- **`LineStore`** steps nothing and changes nothing: the change it receives was made by a
  stepper that now reads the step.

## 4. Specs and e2e

- `line-unit.spec.ts`: `lineStepOf` for each row of backend `0261` section 5 (a count; one
  product with 100; two members with 250 and 25, answering 25; a member that serves the unit
  with no step beside one with 100, answering 100; a member not read; no member with a step,
  answering null). `stepAt`, `stepFrom` and `canStepUp` with a step of 1, 5, 100 and 1000:
  1000 down to 900 and back up to 1000 on 100; 975 up to 1075 and down to 875 on 100, with no
  snap; on 1 and 5 the step below 1000 is the product's and from 1000 is 10, naming S7b;
  plus then minus returns for each step from 0, 995, 1000 and 1010; a step passed for a count
  is ignored. The cases of velista `0188` pass unchanged with no step.
- The mapper specs of `mappers.ts`, `catalog-browse-mappers.ts` and `basket-mappers.ts`:
  `quantityStep` from `unknown`, null when absent, null for 30, for a string and for 0.
- `quantity-stepper.spec.ts`: with a step of 100 a press, a repeat and an arrow key move 100;
  with a step of 5 a press at 1000 moves 10; the buttons' names carry the step they move; plus
  is at its end when one step of the product would pass `max`. The existing cases keep `step`
  unset.
- `catalog-add-store.spec.ts`: a step from a stepper of a stepped product is written as its
  `to`, and the take back at 1000 still deletes a line the visit made.
- The container specs that draw a stepper (`line-row`, `due-line-row`, `line-page`,
  `line-detail-sheet`, `product-row`, `lists-table`, `visit-added`, `suggestion-list`, and the
  basket's once `0190` is merged): one case each that the step reaches the stepper.
- `LineStore` specs: unchanged, since the store receives changes.
- `apps/velista-luna-e2e`: `catalog.spec.ts` step 8 and the weighted test of `shop.spec.ts`
  keep `0188`'s numbers (Context), because Milk and the loose bananas carry no step. The
  weighted `describe` gains a second product made the same way (`ensureItem` with
  `KILOGRAM`, `shop.spec.ts:421`), given `quantityStep: 100` through the admin update of
  backend `0261` section 3, with a test that its line starts at 1000, steps down three times
  to 700 (the host's `data-value` 700, `0188` decision L) and up once to 800, and records a buy
  of 200 g. It is a separate product so that the bananas' numbers never depend on a step left
  by an earlier run.

## 5. Not changed

- The words of an amount, and where they move up one name.
- The amount of a first add is not this plan's. Since the amendment of 2026-11-11 a first add
  is one step (backend `0260`, velista `0185`: 25 g, 25 ml or 1 piece), and the owner said
  that the product's step is the step an add uses once it exists; see question 1.
- The hold, the quiet beat and how each feature saves a run (`0188` sections 3.3 and 4).
- Any server rule on amounts: backend `0261` refuses no amount off the step.

## 6. Acceptance criteria

- [ ] `quantityStep` is mapped on `CatalogItem`, `CatalogProduct` and `BasketProduct`, and
      only the ten steps survive the mapper.
- [ ] `lineStepOf` answers each row of backend `0261` section 5, with its spec naming that
      section.
- [ ] Every `lib-quantity-stepper` that draws a weight or a volume line steps by the product's
      step when it has one, and by `0188`'s default when not; a count steps by 1 below 1000
      and by 10 from 1000.
- [ ] No amount snaps: plus then minus returns on every step, with a spec for 975 on a step
      of 100.
- [ ] A step under 10 is used below 1000 and becomes 10 from 1000, with a spec naming S7b.
- [ ] The catalog sheet, the list row, the line page and the line sheet step one stepped line
      by the same step.
- [ ] `catalog.spec.ts` step 8 and the bananas test pass unchanged, and the stepped product
      test of section 4 passes on a slot with backend `0261`.
- [ ] `npx nx affected -t lint test` is green and `npx nx build velista` builds.

## Not in this plan

- **The back office form** that writes the step. Admin `0070`.
- **A first add that follows the product's step.** Question 1.
- **A step for a count or for a pack.** Backend `0261` S3.
- **The product page's lists table stepping an existing line.** Velista `0187`.
- **The reel.** Velista `0188` and `0190` remove it; it never reads a product step.

## Questions for the owner

1. A first add is one default step since 2026-11-11 (25 g or 25 ml; backend `0260`, velista
   `0185`), and you said that the product's step is the step an add uses once it exists.
   Neither this plan nor backend `0261` changes the add. Should a follow up make a first add of
   saffron 1 g and of a whole chicken its own step, on the server (`0260`) and in velista
   (`0185`), once `0261` is built?
2. Your rule that a press always changes what the row reads (S7b) was stated for the default
   step. This plan reads it as holding for a curator's step too: a saffron step of 1 g or 5 g
   is used below 1 kg and becomes 10 g from 1 kg, so "1 kg" plus one press reads "1,01 kg". Is
   that right, or should a curator's step be used unchanged at every amount, even where a
   press does not change what the row reads?
