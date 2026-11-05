# 0246: a line counts in the unit its product is sold in

> Decided on 2026-11-05. A list line holds an integer `quantity` with no unit, at four layers
> at once: the column, the JSON schemas, the gateway DTOs and core's own checks. For a product
> sold by the kilo the number is read as kilos (plan `0244` D4), and for everything else as
> pieces or packs. A shopper cannot ask for 750 g of anything, two lines of one name are summed
> whatever they count, and what was spent multiplies a price per kilo by a count. This plan
> gives the line a unit, states in one table what a line's amount is for each kind of product,
> and lets the shopper choose the unit only where a line can be served by products of more
> than one kind.
>
> It replaces backend `0096`, `0101` and `0102` and closes backlog `0012`. The owner's
> decisions of 2026-11-05 (section 0, W1 to W4) supersede the "any unit is selectable on a
> line" and "equivalence table" decisions of 2026-09-17 that status report `0172` section 2
> records. The decisions of 2026-09-17 that stand are named in section 0 too.
>
> The client half is velista `0182` (a loose product is asked for by weight) and velista `0183`
> (a line with several products chooses its unit). Nothing in velista can be built before this
> plan is on a gateway.
>
> Prerequisite reading: `0244` (the four kinds of product and `piecePrice`), `0245` (the
> comparable price; what it is for and what it is not for), velista `0179` section 1
> (`soldAs`, `amountOfOne`), `0172` section 3.4 (where a quantity lives in core), `0130` to
> `0144` (the basket is a view of the lines), `0209` (`from` and `stale_quantity`), `0228` (the
> server decides a duplicate), `0143` (`pricePaidCents`), `0142` (what was spent and bought).
> Code: `core/src/app/entities/list-line.entity.ts`, `lists/line.service.ts` (`add`,
> `raiseForAdd`, `validateQuantity`, `validateDelta`), `lists/line-merge.service.ts`,
> `baskets/line-dedup.ts` (`rowKeyOf`), `entities/line-settlement.entity.ts`,
> `purchases/purchases.sql.ts`, `libs/luna-shopper/basket-rules/src/lib/basket-rules.ts`
> (`cheapestOf`, `lineProductOf`), `gateway/src/app/baskets/basket-picks.ts`,
> `gateway/src/app/baskets/settle-price.service.ts`, `assistant/src/app/assistant/tools.ts`.

## Brief for the agent

### Objective

Give every list line a unit, `UNIT`, `GRAM` or `MILLILITER`, derived from the kind of its
product and chosen by the shopper only on a line with products of more than one kind. Make
every place that adds, sums, compares or records a quantity respect that unit. State the
amount of a line and the price of one of a product as two pure functions that the client
mirrors.

### Context

- `list_lines.quantity` is `int`, default 1 (`list-line.entity.ts:69`). Zero means stocked.
  `LINE_QUANTITY_MIN` is 0 and `LINE_QUANTITY_MAX` is 100000. Every schema says `integer`,
  every DTO says `@IsInt`, `validateQuantity` says `Number.isInteger`, and the assistant rounds.
- The products of a line are rows of `list_line_items` (`source` USER or GROUP), at most one
  `productGroupId`, and the merge keys are computed from the name and the set
  (`line-content.ts`, `lineIdentities`). No column holds a unit anywhere in core.
- Merges sum blindly: `raiseForAdd` (`line.service.ts:1731`), `addMany` (`:1174`), the rename
  merge (`line-merge.service.ts:252`) and the list rename planner (`line.service.ts:2629`)
  all do `min(a + b, MAX)`.
- `line_settlements.quantity` is `int`, "units bought", and `pricePaidCents` is the price of
  one unit, so `purchases.sql.ts:251` sums `pricePaidCents × quantity`. The settle path reads
  `offer.price` (`settle-price.service.ts:336`, `:375`, `:403`). On the branch of plan `0244`
  (PR #914) it records `piecePrice` for a kilo piece.
- The basket picks a line's product with `cheapestOf` (`basket-rules.ts:269`), which compares
  `unitPrice` first and `price` second, with no look at the basis. `basket-picks.ts:67` feeds
  it `price` and `unitPrice` only.
- A basket row is keyed `item:<id>` or `text:<name>` (`line-dedup.ts:67`). `basket_trip_rows.asked`
  and `list_line_changes.quantityBefore` / `quantityAfter` are integers in no unit.
- Production on 2026-11-05: 249 live lines, 118 free text, 127 with one product, 4 with
  several, none bound to a catalog group. 3 lines hold a loose product, all at quantity 0, in
  2 lists. 3 `BOUGHT` settlements of loose products exist, none priced, 7 "units" together.
  842 live items are sold by the kilo. So the model is wrong on a handful of rows today and
  the fix is cheap; the point of the plan is every line that comes after it.
- Plan `0240` (one baseline migration per service) is written and not built.

### Target state

1. `LineUnit` is `UNIT`, `GRAM` or `MILLILITER`, in contracts, with `lineUnitOf(kind)` and
   `lineUnitsOf(products)` beside it (section 1). A quantity is stored in the base unit, an
   integer: 750 g is 750, 1.5 kg is 1500. Kilos and litres never reach the wire or a column.
2. `list_lines.unit`, not null, default `UNIT`, on every `LineView` and every line event.
   A write states the unit; a delta names the unit it was made in and a mismatch is refused.
3. The amount of a line and the price of one of a product are two pure functions in
   contracts (section 2), each with a spec that is the normative table. Velista mirrors both
   row for row.
4. Merges happen only between lines of one unit. Two lines of one name in two units are a
   duplicate decision for the shopper, not a sum.
5. A settlement records its unit, an estimate flag and a price paid per one of that unit.
   What was spent and bought is summed per unit and never adds grams to pieces.
6. The basket's product pick considers only members that can serve the line's unit and
   orders them by the cost of the line's amount, or by the price of one when the line has no
   amount (owner W3).
7. The assistant can hear "300 g of cheese" and says so to the gateway.
8. The OpenAPI document and the wire types are regenerated and committed.

### Scope

- Work in `libs/luna-shopper/contracts`, `libs/luna-shopper/basket-rules`,
  `apps/luna-shopper-backend/core`, `gateway` and `assistant`, and the generated documents.
- Do NOT touch the catalog service, the harvester, velista or the back office beyond
  section 6. Do NOT change what `price`, `piecePrice`, `unitPrice` or `comparablePrice` mean.

### Constraints

- W1 to W4 of section 0 are the owner's and are settled. M1 to M8 are the writer's; the
  owner may overrule them before the build.
- Plan `0244` must be in `dev` before this plan is built: `piecePrice`, `approxWeight` and the
  kinds of section 1 come from it. Plan `0245` is independent in code.
- Rule D4 of velista does not apply here, but the two pure functions are framework free and
  take plain values, so a client can mirror them without importing Nest or TypeORM types.
- No dashes as punctuation in any prose.

### Action boundaries

- Proceed with everything in sections 1 to 7.
- Stop and ask if plan `0240` has landed in `dev`: the columns then go into the baseline by
  that plan's rules, not into a new migration.
- Stop and ask if plan `0244` is not in `dev`, or if `SettlePriceService` on `dev` does not
  record `piecePrice` for a kilo piece.
- Stop and ask before raising `MIN_CLIENT_VERSION` in any cluster: section 4.5 says what to
  set, the owner sets it at the deploy.

### Progress evidence

Each criterion of section 8 with its spec output, the migration run on a copy of the
production core dump, and one walk on a slot: a loose product line raised to 750 g from
velista `0182`, its settle recorded with `unit = 'GRAM'`, and the "Bought" read of that list
showing the spend as `price per kilo × 0.75`.

## 0. Decisions

The owner's, 2026-11-05, not to reopen:

- **W1. A shopper chooses a unit only on a line that several products can serve.** A line
  with one product has that product's unit and no chip. A free text line counts pieces.
  "Several products" means the product set of the line (`list_line_items`), whether it came
  from a catalog group or was picked by hand. Velista cannot create a line bound to a catalog
  group today (velista `0115` took groups out of the typeahead), so the second reading is the
  one that reaches a screen.
- **W2. A single product cannot be changed from pieces to weight or volume by the shopper.**
  Its kind decides. A piece of about 500 g at 20 € the kilo costs 10 €, and a line for it
  counts 1, 2, 3 pieces at 10 € each. Its weight is not the shopper's to set.
- **W3. The cost of the line's amount decides between the products of a line, and the
  price of one is what each product shows.** The price of one: a product with no weight of
  its own is one kilo or one litre and shows its price per kilo; a product with a weight is
  one piece at the price of that piece; a pack is the pack. The cost of the amount is the
  table of section 2: on a count line it is the count times the price of one, so the order
  is the order of the price of one; on a weight or volume line a loose product costs its
  price per kilo times the amount, and a piece or a pack costs as many whole pieces or packs
  as the amount needs. A line with no amount (quantity 0) orders by the price of one. So
  for a 1 kg line, one kilo of loose bananas at 1,99 € comes before two 700 g bunches at
  2,78 €, and for a 500 g line the loose bananas at 1,00 € still come before one bunch at
  1,39 €. The owner first stated the price of one alone and, shown the scenarios, chose the
  cost of the amount on 2026-11-05. The cheapest kilo is plan `0245`, which stays what the
  catalog orders by.
- **W4. One unit per product and no conversion table.** The weight of a piece
  (`approxWeight`, plan `0244`) and the size of a pack (`unitSize` in its base unit, plan
  `0183`) are the only two bridges between pieces and weight, and no product needs a third.
  Plan `0102` is closed.

From 2026-09-17 and still standing: base units only, grams and millilitres, never kilos or
litres in a column or on the wire; steps of 25 g and 50 ml below a thousand and 250 from a
thousand; every amount that is not a count of pieces at a piece price carries the estimate
mark.

The writer's, open to the owner:

- **M1. `LineUnit` is its own enum of three values.** `UnitOfMeasure` is a size vocabulary
  (it has `PACK`, `KILOGRAM` and `LITER`), and `ComparableBasis` (`0245`) is what a price is
  per. What a line counts in is a third thing.
- **M2. The column is `NOT NULL DEFAULT 'UNIT'`** and the migration writes `UNIT` on every
  row. No release task: the 3 loose lines in production are at quantity 0 and take their
  unit on their next edit (section 3.2), and the 3 settlements are unpriced. Section 7 names
  them.
- **M3. The unit of a one product line is derived, not chosen, and the gateway checks it.**
  `lineUnitOf(kind)` is the one rule. Core stores what it is told; the gateway refuses a unit
  that none of the line's products offers (`line_unit_not_offered`), because the gateway is
  the one place that holds the line and the catalog together.
- **M4. A new weight line starts at 1000.** That is W3's "default value of 1 kg" applied to
  the amount a shopper first sees. A new volume line starts at 1000 ml. A count starts at 1.
- **M5. A merge across units is a duplicate decision.** On add, the existing line is answered
  as the duplicate of plan `0228` and nothing is summed. On rename, the merge is refused with
  `line_unit_differs` and the client keeps the two lines. Converting between units needs a
  product, and a merge has none to prefer.
- **M6. A basket row is one unit.** `rowKeyOf` gains the unit, so two lines of one product
  in two units (possible only when both lines hold several products) are two rows.
- **M7. `pricePaidCents` is the price of one of the settlement's unit.** For `UNIT` it is one
  piece or pack, as plan `0143` defined and `0244` refined (the `piecePrice` of a kilo piece).
  For `GRAM` and `MILLILITER` it is the price of one kilo or one litre, and the spend is
  `cents × quantity / 1000`. A settlement that is not a count at a piece price is
  `estimated`.
- **M8. A delta without a unit is refused and the client floor is raised.** An old client
  that holds a weight line would add one gram where it meant one kilo. The guard exists
  (`MinClientVersionGuard`); the owner sets the version at the deploy.

## 1. The vocabulary

In `libs/luna-shopper/contracts/src/lib/units/line-unit.ts`:

```ts
/** What a line's `quantity` counts (plan 0246). Base units only. */
export const LINE_UNITS = ['UNIT', 'GRAM', 'MILLILITER'] as const;
export type LineUnit = (typeof LINE_UNITS)[number];

/** How a product is sold, from its size fields (plan 0244 section 1, plus volume). */
export type ProductKind =
  | 'PACK' // a fixed pack, a counted product, or a piece priced as one
  | 'BY_THE_KILO' // KILOGRAM, no size, no weight: `price` is a kilo
  | 'BY_THE_LITRE' // LITER, no size: `price` is a litre
  | 'KILO_PIECE'; // KILOGRAM, no size, a weight: `price` is a kilo, `piecePrice` one piece

export function productKindOf(p: {
  defaultUnit: UnitOfMeasure;
  unitSize: number | null;
  approxWeight: number | null;
}): ProductKind;

/** The unit a line for this one product counts in. */
export function lineUnitOf(kind: ProductKind): LineUnit;

/** The units a line can count in, in picker order, for the products it holds. */
export function lineUnitsOf(kinds: readonly ProductKind[]): LineUnit[];

/** The amount a new line starts at in a unit (M4). */
export function defaultQuantityOf(unit: LineUnit): number; // 1, 1000, 1000
```

| Kind | `defaultUnit` | `unitSize` | `approxWeight` | Line unit | Can also serve |
| --- | --- | --- | --- | --- | --- |
| `PACK`, sized in grams | base unit `GRAM` | set | null | `UNIT` | `GRAM`, through `unitSize` |
| `PACK`, sized in millilitres | base unit `MILLILITER` | set | null | `UNIT` | `MILLILITER`, through `unitSize` |
| `PACK`, counted (`UNIT`, `PACK`) | | set or null | null | `UNIT` | nothing else |
| `PACK`, a piece priced as one | `UNIT` | null | set | `UNIT` | `GRAM`, through `approxWeight` |
| `BY_THE_KILO` | `KILOGRAM` | null | null | `GRAM` | nothing else |
| `BY_THE_LITRE` | `LITER` | null | null | `MILLILITER` | nothing else |
| `KILO_PIECE` | `KILOGRAM` | null | set | `UNIT` | `GRAM`, through `approxWeight` |

`productKindOf` is the server's twin of velista `0179`'s `soldAs`, with `BY_THE_LITRE` added
for symmetry. Nothing in production is sold by the litre today; the row costs one branch and
spares a later plan. `lineUnitsOf` answers the union of the "line unit" column and the "can
also serve" column over the products, in the order `UNIT`, `GRAM`, `MILLILITER`, and `UNIT`
alone for an empty set. The size is read in its base unit with `toBaseUnit` (`source-size.ts`),
as plan `0245` does, so a legacy `LITER` size is millilitres.

## 2. The amount of a line and the price of one

Both in `libs/luna-shopper/contracts/src/lib/units/line-amount.ts`, framework free, taking
plain values. Their specs are the normative tables. Velista `0182` and `0183` mirror both
functions row for row (velista's own copies, by its rule D4), and the two specs name each
other.

```ts
export interface LineAmount {
  /** Integer cents, rounded half up once at the end. */
  cents: number;
  /** False only for a count of pieces or packs at a piece or pack price. */
  estimated: boolean;
  /** Set when a weight or volume was served by whole pieces or packs: "2 × ~700 g". */
  pieces: number | null;
}

export function lineAmountOf(
  quantity: number,
  unit: LineUnit,
  product: { kind: ProductKind; unitSize: number | null; approxWeight: number | null },
  offer: { price: number | null; piecePrice: number | null }
): LineAmount | null;

/** W3: what one of this product costs. What a member shows, and the order of a line at 0. */
export function priceOfOne(
  product: { kind: ProductKind },
  offer: { price: number | null; piecePrice: number | null }
): number | null;
```

`priceOfOne` is `piecePrice` for a `KILO_PIECE` and `price` for every other kind, or null.
For a product sold by the kilo that is the price of one kilo, which is W3's "default value of
1". It is velista `0179`'s `amountOfOne` stated once on the server side, and `0183` reads the
wire's figures rather than deriving its own.

| Line unit | Kind | Amount | `estimated` | `pieces` |
| --- | --- | --- | --- | --- |
| `UNIT` | `PACK` | `price × q` | false | null |
| `UNIT` | `KILO_PIECE` | `piecePrice × q` | true | null |
| `UNIT` | `BY_THE_KILO`, `BY_THE_LITRE` | none | | |
| `GRAM` | `BY_THE_KILO` | `price × q / 1000` | true | null |
| `GRAM` | `KILO_PIECE`, weight `w` | `piecePrice × ⌈q / w⌉` | true | `⌈q / w⌉` |
| `GRAM` | `PACK`, a piece priced as one, weight `w` | `price × ⌈q / w⌉` | true | `⌈q / w⌉` |
| `GRAM` | `PACK`, base size `s` in grams | `price × ⌈q / s⌉` | false | `⌈q / s⌉` |
| `MILLILITER` | `BY_THE_LITRE` | `price × q / 1000` | true | null |
| `MILLILITER` | `PACK`, base size `s` in millilitres | `price × ⌈q / s⌉` | false | `⌈q / s⌉` |
| any other pairing | | none | | |

Three rules the table encodes:

- **A count at a piece or pack price is the only exact amount.** A weight the scale has not
  weighed yet is an estimate, and so is a kilo piece, whose weight is the chain's "about".
- **A missing figure is a missing amount**, never zero. A `KILO_PIECE` whose offer has a
  price and no `piecePrice` answers null (velista `0179` says the same: velista never derives
  a piece price).
- **A weight served by pieces rounds up to whole pieces.** 1000 g of a 700 g piece is two
  pieces, and `pieces` carries the 2 so the client can say "2 × ~700 g". The cost of the
  amount is what a screen draws beside a member and what orders the members (W3). `priceOfOne`
  is what a member shows as its price, and the order when the line has no amount.

## 3. Core

### 3.1 The column and the view

`list_lines."unit" line_unit NOT NULL DEFAULT 'UNIT'`, enum type `line_unit` created in the
same migration (section 7). `LineView` gains `unit: LineUnit` with a doc comment that names
W1 and W2, `toLineView` maps it, and `LineService.emit` carries it on `line.added` and
`line.updated` because both send the whole view.

`LINE_QUANTITY_MIN` and `LINE_QUANTITY_MAX` do not move: 0 is stocked in any unit, and
100000 g is 100 kg of anything.

### 3.2 Writes state the unit

- `AddLineRequest`, `AddLinesItem` and `UpdateLineRequest` gain `unit?: LineUnit`. Absent on
  add means `UNIT`. On update, **a unit change must name the quantity it starts from**: a
  request with `unit` and no `quantity` is refused with a validation error, as plan `0101`
  section 2 argued (500 read as 500 pieces after a chip moved from grams is worse than a
  reset). The client sends `defaultQuantityOf(unit)`.
- An update that names `itemIds` or `adoptItemIds` and leaves the line with products that no
  longer offer its unit must name a new `unit` and `quantity` in the same request. The gateway
  checks it (section 4.2); core stores what it is given.
- A one product line whose stored unit is not the unit of its product (the 3 rows the
  migration leaves) is corrected by the first `update` that states the unit. Velista `0182`
  states it on every absolute write, so the correction needs no path of its own.
- `AddLineQuantityRequest` gains `unit: LineUnit`, required. Core compares it with the line's
  and refuses a mismatch with `line_unit_mismatch`, a 409 at the gateway. The client re-reads
  the line it was already going to receive over realtime, as it does for `stale_quantity`
  today. `validateDelta` and `validateQuantity` keep `Number.isInteger`: the base unit makes
  every amount an integer.

### 3.3 Merges happen within one unit

- `findAddTarget` and `raiseForAdd`: a target line whose unit differs from the incoming unit
  is not raised. The add answers it as the duplicate decision of plan `0228` (the line exists,
  here it is), and the client opens it. A free text add carries `UNIT`, so it never lands on
  a weight line by name alone.
- `addMany`: duplicates inside the batch fold only when their units agree; the second unit
  starts its own creation.
- `LineMergeService.merge` and the list rename planner: a survivor and an absorbed line of
  different units refuse with `line_unit_differs`, a 409, and the rename does not happen.
  The copy of velista says the two lines count in different units.
- The quantity sums stay `min(a + b, MAX)` for lines of one unit.

### 3.4 Change rows, trip rows, basket rows

- `list_line_changes` gains `unitBefore` and `unitAfter` (`line_unit NULL`), written beside
  `quantityBefore` and `quantityAfter`. A unit change is an edit with both set and different.
- `basket_trip_rows` gains `unit line_unit NOT NULL DEFAULT 'UNIT'`, copied from the line
  when the row is written. `asked` is in it. A unit change on a line that a trip row names
  rewrites the row's `unit` and `asked` in the same transaction, so a trip never reads a
  count against a weight.
- `rowKeyOf(content, productId, unit)` appends the unit: `item:<id>:GRAM`. `groupEntries`
  thus never groups two units into one row, and `BasketRowView` gains `unit`. The
  `rowNumbersOf` sums stay integers.
- `BasketDemandRequest` (`setDemand`) gains `unit`, checked like the delta's.

### 3.5 Settlements and what was spent

- `line_settlements` gains `unit line_unit NOT NULL DEFAULT 'UNIT'` and
  `estimated boolean NOT NULL DEFAULT false`. `quantity` is in `unit`. The settle request
  (`SettleLineRequest`, the basket settle) takes `unit` and refuses a mismatch with the line
  like a delta does; the outstanding arithmetic `quantity − settled` stays in the line's unit.
- `pricePaidCents` is M7: the price of one of the unit. The gateway's `SettlePriceService`
  records for a `GRAM` settlement the price per kilo in cents (the offer's `price` of a
  product sold by the kilo), for a `UNIT` settlement what plan `0244` made it record, and sets
  `estimated` to `lineAmountOf(...).estimated` for the product settled.
- `purchases.sql.ts`: what was spent becomes
  `SUM(CASE unit WHEN 'UNIT' THEN cents × quantity ELSE cents × quantity / 1000 END)`, rounded
  once; what was bought is summed **per unit**, and the entry view carries
  `bought: { UNIT: n, GRAM: g, MILLILITER: ml }` with zeros omitted, plus `estimated: BOOL_OR`.
  The same change in `trips.sql.ts`, `basket-asked.sql.ts`, `basket-trip-rows.sql.ts` and
  `basket-read.sql.ts` wherever a `SUM(quantity)` crosses lines: each sum is grouped by unit or
  stated to be within one line.
- `ItemSnapshot` already carries `approxWeight` (`0244`); nothing more is frozen.

### 3.6 Realtime

Every line event carries the view, so it carries the unit. `BasketLinesChangedEvent` carries
line ids and entry patches; the patch gains `unit` beside `asked` where it names a quantity.

## 4. Gateway

### 4.1 DTOs

`unit` on `AddLinesItemDto`, `AddLineDto`, `UpdateLineDto` (optional, `@IsIn(LINE_UNITS)`),
`AddLineQuantityDto` (required), `SettleLineDto` (required), and the basket's demand and
settle DTOs. The JSON schemas in `list.schemas.ts` and `basket.schemas.ts` gain the same
fields. Every quantity stays `integer`.

### 4.2 The unit a line is allowed

On add, on an update that names `unit`, `itemIds` or `adoptItemIds`, and on the batch add, the
gateway reads the line's products from the catalog (it reads them for the basket already,
`basket-catalog.service.ts`) and checks `unit ∈ lineUnitsOf(kinds)`. A unit outside the set
is refused with `line_unit_not_offered`, a 422 with the offered units in `details`. A free
text line offers `UNIT` alone. A product the catalog no longer names offers nothing and does
not widen the set.

### 4.3 The basket's pick

`basket-picks.ts` passes each candidate's `kind`, `unitSize`, `approxWeight`, `price` and
`piecePrice`, and the line's `unit` and `quantity`. `cheapestOf` in `basket-rules` becomes:
the candidates are the products for which `lineAmountOf(max(quantity, 1), unit, product, offer)`
is not null (the product can serve the line's unit at all), ordered by
`lineAmountOf(quantity, ...).cents` ascending when the line has an amount and by
`priceOfOne` when `quantity` is 0, null last, a tie keeping the input order. `unitPrice`
leaves the rule and the comment names W3. The comparable price of plan `0245` is not read
here: it answers which kilo is cheapest, and W3 asks what this line costs with each product.
A line's pick can thus change when its amount changes, which is right: 500 g of bananas is
cheapest loose, and a whole melon is cheapest as the piece.

### 4.4 The price paid

Section 3.5. `SettlePriceService.choose` and its three lookups take the line's unit and the
product's kind, and `snapshotOf` is unchanged.

### 4.5 The client floor

`AddLineQuantityDto.unit` is required (M8). Before the deploy that carries this plan the
owner sets `MIN_CLIENT_VERSION` in `velista-staging` and `velista-production` to the velista
version that carries `0182`. A client below it gets `client_too_old` (426) and the update
prompt it already knows. The plan does not set the variable.

### 4.6 The documents

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

## 5. The assistant

The item schema of `upsert_lines` gains `unit` (`UNIT`, `GRAM`, `MILLILITER`, optional) with
the description "What the number counts. GRAM for a weight, MILLILITER for a volume, both as
the number of grams or millilitres: 300 g is 300, half a kilo is 500, a litre and a half is
1500. Omit for pieces or packs." `settle_lines` gains the same. The gateway client sends it on
add, update and delta. A delta on a line of another unit comes back as
`line_unit_mismatch`, and the tool reports it as "that line counts in grams; say the amount
in grams or change the line" rather than retrying. The prompt gains one sentence beside the
quantity rule: a weight or a volume is sent in grams or millilitres with its unit, never as a
count of kilos.

## 6. The back office

Wherever the back office prints or edits a line quantity (the admin line routes behind
`admin-edit.dto.ts`, and any list that draws `quantity`), the unit rides beside it, drawn as
"750 g" through the same formatting rule velista `0182` uses. The wire types regenerate
(section 4.6), and the builder lists the places touched in the PR. Nothing else in the back
office changes: a product's kind is already edited by admin `0068`.

## 7. The migration

`1756004100000-LineUnit` in core, next in the `17560…` sequence after
`1756004000000-AssistantAllowance`:

```sql
CREATE TYPE "line_unit" AS ENUM ('UNIT', 'GRAM', 'MILLILITER');
ALTER TABLE "list_lines" ADD COLUMN "unit" "line_unit" NOT NULL DEFAULT 'UNIT';
ALTER TABLE "line_settlements" ADD COLUMN "unit" "line_unit" NOT NULL DEFAULT 'UNIT';
ALTER TABLE "line_settlements" ADD COLUMN "estimated" boolean NOT NULL DEFAULT false;
ALTER TABLE "basket_trip_rows" ADD COLUMN "unit" "line_unit" NOT NULL DEFAULT 'UNIT';
ALTER TABLE "list_line_changes" ADD COLUMN "unitBefore" "line_unit" NULL;
ALTER TABLE "list_line_changes" ADD COLUMN "unitAfter" "line_unit" NULL;
COMMENT ON COLUMN "list_lines"."unit" IS 'What quantity counts (plan 0246). Base units: grams and millilitres, never kilos or litres.';
COMMENT ON COLUMN "line_settlements"."pricePaidCents" IS 'The price of one of "unit": one piece or pack, or one kilo or litre (plan 0246 M7). Never the row total.';
```

**What it leaves, by M2.** The 3 production lines that hold a loose product carry `UNIT`
at quantity 0 until their next edit states `GRAM`. The 3 unpriced settlements of loose
products (7 together) stay `UNIT`: no money is wrong, and the "Bought" read shows them as
7 pieces. If the owner wants them as 7000 g, it is one `UPDATE` on the day, outside this
plan.

## 8. Acceptance criteria

1. `line-unit.spec.ts`: `productKindOf`, `lineUnitOf` and `lineUnitsOf` on each row of the
   table in section 1, including a legacy `LITER` size, an empty set and a set of all kinds.
2. `line-amount.spec.ts`: every row of the table in section 2, the null rows, the rounding up
   to whole pieces, cents rounded once (a price of 0.00995 per gram times 500 prints 4,98 and
   not 4,97), and `priceOfOne` for all four kinds.
3. `line.service.spec.ts`: a line is created in the stated unit and `UNIT` without one; a
   unit change without a quantity is refused; a delta in another unit is refused with
   `line_unit_mismatch` and changes nothing; an add that lands on a line of another unit is
   answered as a duplicate and sums nothing; `addMany` folds only equal units.
4. `line-merge.service.spec.ts`: a rename onto a line of another unit refuses with
   `line_unit_differs`, and the list rename planner reports it instead of summing.
5. The basket specs: two lines of one product in two units are two rows with two keys; a
   trip row follows a unit change; `cheapestOf` drops a loose product from a `UNIT` line,
   drops a counted pack from a `GRAM` line, on a 1000 g line orders a loose product at 1,99
   per kilo before a 700 g kilo piece at 1,39 (two pieces), on a 500 g line still orders the
   loose product first (1,00 against 1,39), on a 1800 g line orders a 1,8 kg piece priced as
   one at 2,50 before loose at 1,49 per kilo (2,68), at quantity 0 orders by the price of
   one, and no longer reads `unitPrice`.
6. The settlement specs: a `GRAM` settle of 750 on a product at 9.95 per kilo records
   `pricePaidCents = 995`, `unit = 'GRAM'`, `estimated = true`, and what was spent reads 746;
   a `UNIT` settle of a kilo piece records its `piecePrice` as before; what was bought is
   reported per unit.
7. The gateway HTTP spec: a delta without `unit` is a 400, a mismatch a 409, a unit the
   line's products do not offer a 422 naming the offered units, and the assistant's client
   sends the unit on all three writes.
8. `openapi.json` and `wire-types.ts` are regenerated and `npx nx affected -t lint test` is
   green.

## 9. Known and not changed

- **A free text line counts pieces** (W1). "Ham 300 g" with no product is a line named
  "ham 300 g" at quantity 1, as today. Letting a label line carry a unit is a product
  decision the owner has not taken.
- **Velista cannot create a line bound to a catalog group** (velista `0115`). The chip of
  velista `0183` appears on a line whose product set the shopper widened on the line page, or
  that a server flow created. Bringing groups back to the typeahead is not this series.
- **No category suggests a unit** (`0172` question 7). The product's kind decides, and a
  line with several products starts in the unit of the product it counts as.
- **Weights printed inside a name** (El Jamón, DEZA) and the leaflet CLI's `approx_weight`
  stay as plan `0244` section 8 left them. A product the catalog does not know the weight of
  cannot serve a `GRAM` line and says so.
- **Receipts** (backlog `0008`) would make an estimate exact. Not here.
- **`product_groups.referenceUnit`** stays unread by any ordering, as `0172` found. Retiring
  it is a one line migration for a later catalog plan.
