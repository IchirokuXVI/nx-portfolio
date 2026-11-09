# 0261: the curator sets the step of a product

> Written on 2026-11-09 from the owner's decision U4 of that day (section 0). Velista steps
> every weight or volume line by one fixed rule: 25 g or 50 ml below a thousand, 250 from a
> thousand. Saffron needs a much smaller step, and a whole chicken a bigger one: nobody buys
> 1,425 kg of chicken rather than 1,4 kg, and nobody buys 75 g of it. This plan gives a product
> sold by the kilo or the litre a step, written by a curator in the back office and served on
> every product view velista reads for a line. A product with no step keeps today's rule.
>
> Depends on PRs #959 (backend `0246`), #960 (velista `0182`) and #961 (velista `0183`) being
> in `dev`. Independent of `0260`. The back office form is admin plan `0070` and the stepping
> in velista is velista plan `0186`, both written on the same day by other writers.
>
> Prerequisite reading: `0244` sections 3 and 4 (a curator written size field: the columns,
> the checks, the write rule, the contract, the gateway), admin `0068` (the form of that
> field), `0246` sections 1 and 2 (`ProductSizing`, `productKindOf`, `defaultQuantityOf`),
> velista `0182` section 3 (the steps) and velista `0183` target 7 (`lineShownProduct`).
>
> Code anchors, read on `origin/feat/velista-0183-line-unit-chip` on 2026-11-09 (it carries
> #959 to #961):
> `libs/velista/models/src/lib/line-unit.ts:121` to `:200` (`QUANTITY_COARSE_FROM`,
> `QUANTITY_FINE_STEP`, `QUANTITY_COARSE_STEP`, `stepAt`, `stepFrom`, `stepsFrom`);
> `apps/luna-shopper-backend/catalog/src/app/entities/item.entity.ts:73` to `:106`
> (`unitSize`, `approxWeight`, `approxWeightSetBy`, `packCount`, `defaultUnit`);
> `catalog/src/app/catalog/catalog.mappers.ts:288` (the item view mapper);
> `catalog/src/app/catalog/item.service.ts:537`, `:658`, `:4055` to `:4110` (where
> `requireWeightBesideNoSize` runs, and the rule itself);
> `catalog/src/app/db/migrations/1759300000000-ItemApproxWeight.ts` (the shape to copy);
> `libs/luna-shopper/contracts/src/lib/units/line-unit.ts:43` to `:170` (`ProductSizing`,
> `productKindOf`, `defaultQuantityOf`, `packBridgeOf`);
> `libs/luna-shopper/contracts/src/schemas/messages/catalog.schemas.ts:733` (`approxWeight`
> on the item view) and `:1584` (the item expectation);
> `apps/luna-shopper-backend/gateway/src/app/catalog/catalog.dto.ts:448`, `:611`, `:668`, `:789`
> (`CreateItemDto`, `ItemExpectationDto`, `UpdateItemDto`, `UpdateItemBatchEntryDto`);
> velista's readers `libs/velista/data-access/src/lib/mapping/mappers.ts:743`,
> `catalog-browse-mappers.ts:68`, `basket-mappers.ts:616`;
> `libs/velista/models/src/lib/line-products.ts:564` (`lineShownProduct`).

## Brief for the agent

### Objective

Add `items.quantityStep`, a step in grams or millilitres that only a product sold by the kilo
or by the litre can carry, written only by a person through the admin product routes, served
on `ItemView` and so on every product view, and null by default, which keeps velista's
current rule.

### Context

- Velista's rule is fixed and per unit: `QUANTITY_FINE_STEP` 25 g and 50 ml below
  `QUANTITY_COARSE_FROM` (1000), `QUANTITY_COARSE_STEP` 250 from there (`line-unit.ts:121` to
  `:136`). `stepAt` reads only the value and the unit; no product reaches it (`:142`).
- The catalog item carries no step (`item.entity.ts`). The nearest precedent is
  `approxWeight` (plan `0244`): a nullable numeric column, two checks, a write rule run at
  create, create many, update and batch update (`item.service.ts:537`, `:658`, `:4062`), a
  field on `ItemView` (`catalog.mappers.ts:288`, `catalog.schemas.ts:733`), and the admin edit
  of admin `0068`.
- The gateway passes catalog product views through. Velista reads `approxWeight` from them in
  three mappers: the line's products (`mappers.ts:743`), the catalog search and product page
  (`catalog-browse-mappers.ts:68`), and the basket row (`basket-mappers.ts:616`). A field on
  `ItemView` thus reaches all three with no gateway code. Unverified: that no gateway route
  narrows `ItemView` to named fields; section 4 says how the builder checks.
- No server code steps a line. Core stores any integer amount from 0 to
  `LINE_QUANTITY_MAX` (`0246` section 3.1), and the step is velista's alone.
- A run writes `approxWeight` onto a product with no size (`0244` section 3.4,
  `setApproxWeights`), which turns a product sold by the kilo into a kilo piece.

### Target state

1. `items."quantityStep" smallint NULL` with two checks (section 2): the value is one of
   `QUANTITY_STEPS`, and only a product sold by the kilo or the litre carries one.
2. `QUANTITY_STEPS` in `libs/luna-shopper/contracts/src/lib/units/quantity-step.ts`, exported
   through the main barrel and the `line-units` deep entry.
3. The catalog write rule `requireStepOnLooseProduct` refuses a step that breaks either
   check with `item_quantity_step_not_allowed`, before the database would.
4. `ItemView.quantityStep: number | null`, served on every product view; the item
   expectation compares it; the admin create, update and batch update accept it.
5. `setApproxWeights` skips a product that carries a step and counts it (S6).
6. The OpenAPI document and the admin wire types are regenerated and committed.

### Scope

- `apps/luna-shopper-backend/catalog` (entity, migration, mapper, `item.service.ts`),
  `libs/luna-shopper/contracts` (the constant, `ItemView`, the requests, the schemas),
  `libs/luna-shopper/platform/src/lib/errors/` (the code), `apps/luna-shopper-backend/gateway`
  (the admin DTOs, `ApiProblemResponses`, `error-catalog.ts`), and the generated documents.
- Do NOT touch core, the basket, `lineAmountOf`, velista or the back office: velista `0186`
  and admin `0070` consume this plan.

### Constraints

- U4 is the owner's and is settled. S1 to S8 are the writer's; the owner may overrule them
  before the build.
- The column is null on every existing row; the migration writes no row.
- Rule D4 of velista applies on the client: velista maps `quantityStep` from `unknown` and
  keeps its own copy of the rule of section 5.
- No dashes as punctuation in any prose.

### Action boundaries

- Proceed with sections 1 to 4.
- Stop and ask if PRs #959 to #961 are not all in `dev`.
- Stop and ask if plan `0240` (one baseline migration per service) has landed in `dev`: the
  column then goes into the baseline by that plan's rules.
- Stop and ask if admin `0070` or velista `0186` names another field, another list of steps
  or another rule for several products than this plan.
- Regenerate `openapi.json` and `wire-types.ts` with their targets. Never edit them by hand.

### Progress evidence

Each criterion of section 7 with its spec output, the migration up and down on an ephemeral
slot with the checks refusing a step on a pack, and one HTTP walk: an admin update sets 100 on
a product sold by the kilo, the shopper product read and the basket read both answer
`quantityStep: 100`, an update of 30 is a 400 naming the allowed steps, and a run's weight fill
over that product skips it and counts it.

## 0. Decisions

The owner's, 2026-11-09, not to reopen:

- **U4. The curator decides the step of a product.** Small products need a small step, big
  ones a much bigger one. A step per product, set in the back office. A product with no step
  keeps today's default.

The writer's, open to the owner:

- **S1. One step, not a fine and a coarse pair.** The pair exists because one default has to
  serve saffron and chicken alike, so it changes grain at a kilo. A curator who names a
  product's step already knows its scale: chicken moves by 100 g from 100 g to 3 kg, and
  saffron by 1 g. A pair doubles the field, the checks and the form for no product the owner
  named.
- **S2. The allowed steps are a closed list of divisors of 1000:** 1, 5, 10, 25, 50, 100, 200,
  250, 500 and 1000. A divisor of 1000 keeps a new line's start, `defaultQuantityOf` 1000
  (`0246` M4), and every whole kilo on the grid of the step, so a line never has to snap off
  its first value. A list rather than "any divisor" keeps the back office a choice of ten and
  leaves out steps nobody asks for at a counter (2, 4, 8, 20, 40, 125). The maximum is 1000:
  a product bought by the several kilos is still asked for in kilos.
- **S3. Only a product sold by the kilo or the litre carries a step** (`BY_THE_KILO` and
  `BY_THE_LITRE` of `0246` section 1: `KILOGRAM` or `LITER`, no size, no weight). A pack and a
  kilo piece count pieces on their own line, so a step means nothing there. On a line with
  several products that counts grams, velista steps by its rule whatever serves the line
  (`stepAt` reads no product, `line-unit.ts:142`), and whole packs and pieces appear only in
  the cost (`lineAmountOf`'s `pieces`); a step on a pack would thus be a second rule for one
  line.
- **S4. Null means today's rule**, unchanged: 25 g or 50 ml below 1000, 250 from 1000. A step
  that is set applies at every value; there is no change of grain at a kilo.
- **S5. A line with several products takes the smallest step among its members that serve
  the line's unit and carry one, and today's rule when none does.** This departs from the
  brief's first recommendation, "the step of the product the line counts as", for a reason
  the code gives: the product a line counts as is `lineShownProduct`, the first member in the
  order of the cost of the line's amount (velista `0183` target 7, `0246` W3). That order can
  change when the amount changes, so the step would change under the person's finger while
  stepping. The smallest step does not depend on the amount, and it can reach every amount a
  larger step reaches, while a larger step makes some amounts unreachable. A member with no
  step says nothing and is not counted.
- **S6. A run never clears a person's step.** `setApproxWeights` skips a product with a step,
  as it skips a product a person weighed (`skippedSetByAdmin`), and counts it in
  `skippedHasStep`. The run report shows it, and the curator decides whether the product is a
  kilo piece after all.
- **S7. No `quantityStepSetBy`.** Only a person writes the column, so nothing needs the
  protection `approxWeightSetBy` gives a weight against the next run.
- **S8. The curation CLI does not propose steps in this plan.** It is a later backlog plan:
  the step is a judgement about how a product is bought, not a fact a storefront prints.

## 1. The vocabulary

In `libs/luna-shopper/contracts/src/lib/units/quantity-step.ts`, browser reachable like the
rest of `units/`:

```ts
/** The steps a curator may give a product sold by the kilo or the litre (plan 0261 S2). */
export const QUANTITY_STEPS = [1, 5, 10, 25, 50, 100, 200, 250, 500, 1000] as const;
export type QuantityStep = (typeof QUANTITY_STEPS)[number];
export function isQuantityStep(value: unknown): value is QuantityStep;
/** Whether a product of these size fields may carry a step (S3). */
export function carriesQuantityStep(p: ProductSizing): boolean; // BY_THE_KILO or BY_THE_LITRE
```

`carriesQuantityStep` reads `productKindOf` (`line-unit.ts:50`), so the rule and the kinds of
`0246` cannot drift apart. `ProductSizing` itself does not gain the step: it is what
`lineAmountOf` and `lineUnitsOf` read, and neither reads a step.

## 2. Catalog

### 2.1 The column

Migration `<next timestamp>-ItemQuantityStep` in `catalog/src/app/db/migrations`, after the
last one on `dev`:

```sql
ALTER TABLE items ADD COLUMN "quantityStep" smallint NULL;
ALTER TABLE items ADD CONSTRAINT item_quantity_step_allowed CHECK (
  "quantityStep" IS NULL OR "quantityStep" IN (1, 5, 10, 25, 50, 100, 200, 250, 500, 1000)
);
ALTER TABLE items ADD CONSTRAINT item_quantity_step_on_loose CHECK (
  "quantityStep" IS NULL OR (
    "unitSize" IS NULL AND "approxWeight" IS NULL AND "defaultUnit" IN ('KILOGRAM', 'LITER')
  )
);
COMMENT ON COLUMN items."quantityStep" IS 'How far one step moves a line of this product, in grams or millilitres (plan 0261). Null: the default steps.';
```

The SQL list restates `QUANTITY_STEPS`, and a migration spec asserts the two are equal.

### 2.2 The write rule

`requireStepOnLooseProduct(row, where)` beside `requireWeightBesideNoSize`
(`item.service.ts:4079`), called at the same places, and **whenever the request names
`quantityStep`, `unitSize`, `approxWeight` or `defaultUnit`**. The weight rule runs only for a
size or a weight (`:4061`); this one runs for the unit too, because a change of unit alone on a
stepped product breaks `item_quantity_step_on_loose`, and a check that only the database catches
is a 500.

- A step outside the list, or on a row that will not be sold by the kilo or the litre:
  `item_quantity_step_not_allowed` (new, 400). Details: `itemId` or `index`, `quantityStep`,
  `allowed` (the list), `defaultUnit`, `unitSize`, `approxWeight`.
- An edit that makes a stepped product a pack or a piece (a size, a weight, or another unit)
  is refused unless the same edit sends `quantityStep: null`, as `0244` section 3.2 does for a
  size beside a weight.
- The rule reads the row as it will be saved and runs after `requireBaseUnit` and
  `requireWeightBesideNoSize`, so their codes still answer first.

### 2.3 The other writes

- `setApproxWeights` (`0244` section 3.4) gains `AND "quantityStep" IS NULL` and the counter
  `skippedHasStep` (S6). The run report of the harvester gains
  `approxWeightsSkippedHasStep` beside `approxWeightsSkippedSetByAdmin`.
- A product created by a run or a leaflet carries no step.
- A merge (`0239`): the survivor keeps its own step, null included, as it keeps its weight. The
  step is not part of the format check (`item_merge_format_differs`): it says how a product is
  bought, not what it is.
- Each update that changes the step writes its `catalog_audit` row with the before and after,
  as the admin update does for its other fields (unverified that the update audits every
  changed column; the builder confirms against the audit writer).

### 2.4 The contract

- `ItemView` gains `quantityStep: number | null`, mapped at `catalog.mappers.ts:288` and stated
  in `itemViewProperties` (`catalog.schemas.ts:733`) as not required, so a reader built before
  this plan keeps validating, as `approxWeight` was.
- `CreateItemInput`, the update request and the batch entry gain `quantityStep?: number |
  null`; the item expectation (`catalog.schemas.ts:1584`) gains it, so an audited edit can
  expect it.
- `ItemSnapshot` does not gain it: a purchase does not need to know how its amount was stepped.

## 3. Gateway

- `CreateItemDto`, `UpdateItemDto` (and so `UpdateItemBatchEntryDto`) and
  `ItemExpectationDto` gain `quantityStep`, optional and nullable, `@IsIn(QUANTITY_STEPS)`, with
  a description that names S2 and S3. The OpenAPI enum then lists the steps, and the admin wire
  types carry them for admin `0070`.
  A value off the list is thus a `validation_failed` at the gateway, with a field error on
  `quantityStep`, and `item_quantity_step_not_allowed` reaches an admin client only for a step
  on a product that is not sold by the kilo or the litre; the catalog code stays the floor for
  a NATS caller that is not the gateway.
- `item_quantity_step_not_allowed` reaches `api-problem-responses.decorator.ts` beside
  `ITEM_APPROX_WEIGHT_BESIDE_SIZE` and `error-catalog.ts`.
- The shopper routes need no code: they pass `ItemView` through.
- Then:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

## 4. Where velista reads it

Velista `0186` reads `quantityStep` from the three mappers named in the context:
`mappers.ts:743` (a line's products), `catalog-browse-mappers.ts:68` (the catalog search and
the product page), `basket-mappers.ts:616` (the basket row). To confirm that every route serves
it, the builder checks in the regenerated `openapi.json` that every schema naming
`approxWeight` on a shopper product view names `quantityStep` beside it, and lists any that
does not in the PR.

## 5. The rule velista mirrors

Stated here, built in velista `0186`; no server code reads it.

| The line | Its step |
| --- | --- |
| `UNIT` | 1, as today |
| `GRAM` or `MILLILITER`, one product with a step `s` | `s` at every value |
| `GRAM` or `MILLILITER`, several products, some serving the unit with a step | the smallest of those steps (S5) |
| `GRAM` or `MILLILITER`, no product serving the unit with a step | today's rule: 25 or 50 below 1000, 250 from 1000 (S4) |

An amount off the grid of its step (a legacy 975 on a step of 100) snaps onto it in the
direction of the step, as `stepFrom` does today (`line-unit.ts:162`). The server never refuses
an amount off the step: the step is how velista moves an amount, not a rule on the line, and
an amount the assistant or an older build wrote stays valid.

## 6. Specs

- `contracts/src/lib/units/quantity-step.spec.ts`: `isQuantityStep` on each value and on 0,
  30, 1500 and a string; `carriesQuantityStep` on each row of the table of `0246` section 1.
- `catalog/src/app/catalog/item.service.spec.ts`: a step on a product by the kilo and by the
  litre saves; on a pack, a kilo piece, a piece priced as one and a counted product it is the
  400 with its details; a value outside the list is the 400; a change of unit, of size or of
  weight on a stepped product is refused without `quantityStep: null` and saves with it; a
  batch entry names its `index`.
- The `setApproxWeights` spec: a stepped product is skipped and counted, an unstepped one is
  written as before.
- `catalog/src/app/db/migrations/migrations.spec.ts`: the SQL list equals `QUANTITY_STEPS`, and
  the migration runs up and down on an ephemeral slot, where the check refuses a step on a
  sized product.
- The catalog mapper spec: `ItemView.quantityStep` is the column, null by default.
- A gateway HTTP spec: the admin update takes 100 and refuses 30 with the code and `allowed`.
- `wire-types.spec.ts` and `openapi-document.spec.ts` pass on the regenerated files.

## 7. Acceptance criteria

- [ ] `items.quantityStep` exists with both checks, null on every existing row.
- [ ] `QUANTITY_STEPS`, `isQuantityStep` and `carriesQuantityStep` are in contracts with their
      spec.
- [ ] Every catalog write refuses a step that breaks S2 or S3 with
      `item_quantity_step_not_allowed`, before the database does.
- [ ] `ItemView.quantityStep` is served on every shopper product view velista reads for a line.
- [ ] A run's weight fill never clears a step and counts what it skipped.
- [ ] The specs of section 6 pass, and `npx nx affected -t lint test` is green.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and committed.

## 8. Not in this plan

- The back office form and its copy (admin `0070`).
- The stepping in velista, the reel, the stepper and the rule of section 5 (velista `0186`).
- A step proposed by the curation CLI (S8, a later backlog plan).
- A step on a pack or a piece, or a step that varies with the amount (S1, S3).
- A server check of amounts against the step.

## 9. Questions for the owner

1. **S2.** Are the ten steps right? Chicken at 100 g and saffron at 1 g are in; 125 g, 2 kg and
   any step above a kilo are out.
2. **S5.** A line with several products takes the smallest step among them. Is that right, or
   should a favourite member's step win when it has one?
3. **S6.** When a run states a weight for a loose product a curator stepped, the run skips the
   weight. Should it instead turn the product into a kilo piece and drop the step?
