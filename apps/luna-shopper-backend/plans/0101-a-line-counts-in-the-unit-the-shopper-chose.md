# 0101 A line counts in the unit the shopper chose

A line's quantity is an integer with no unit (`LineView.quantity`, plan `0047`), and every
screen draws it as "×2". Plan `0096` gave the product one unit and the group a list, and it
left the choice to the line on purpose: the shop decides how it measures a product, the shopper
decides how they count it. Three hundred grams of cheese at a counter that also sells it by the
slice, five tomatoes at a shelf that prices them per kilogram. The line is the only place that
choice can live, because it is the only record the shopper writes.

This plan is that column and everything a unit on a line drags with it: the write that states
it, the delta that has to agree with it, the reset when it changes, the basket line that copies
it and the settlement that counts in it. It changes core, the contracts, the gateway and two
generated documents. It changes no catalog read and nothing in velista, which is `0070`.

Depends on `0096` for `MeasurementUnit`. Nothing here reads a price.

## 1. The column

```ts
export interface LineView {
  // ...
  /**
   * What `quantity` counts (plan 0101, section 1). `UNIT` for every line written
   * before this plan, and for every free text line.
   */
  measurementUnit: MeasurementUnit;
}
```

`list_lines."measurementUnit" measurement_unit NOT NULL DEFAULT 'UNIT'`, in migration
`LineMeasurementUnit1757300000000` in core. The enum type is created here too, because core
and catalog share a vocabulary and not a database. Every existing line is `UNIT`, which is what
every existing quantity has always meant.

`LINE_QUANTITY_MIN` and `LINE_QUANTITY_MAX` do not move. Zero still means stocked, and a
hundred thousand grams is a hundred kilograms of anything.

**A line has one unit, whatever it holds.** A line stands for a set of products (`0048`), and
a group line stands for every member. The unit is the line's, and a member whose own unit
differs is priced through the table of `0096` section 5, which answers an amount when an
equivalence exists (`0102`) and nothing otherwise. The line does not fork by member.

## 2. Writes state the unit

- `AddLineRequest` and every entry of `AddLinesRequest` gain `measurementUnit`, optional on
  the wire and `UNIT` when absent, so a client that predates this plan and the assistant's
  `line.addMany` keep working unchanged. Velista states it from the group's default or the
  product's unit (`0096`, section 3.1).
- `UpdateLineRequest` gains `measurementUnit`, optional. **A unit change must name the quantity
  it starts from**: a request that changes the unit and omits `quantity` is refused with a
  validation error. Core knows no step and no default, and a quantity of 500 read as 500 units
  after the chip moved from grams is worse than a reset. The client sends one fine step of the
  new unit (`0096`, section 4), and core stores what it was sent.
- Every line event on the realtime channel carries the view, so it carries the unit.

## 3. A delta names the unit it was made in

```ts
export interface AddLineQuantityRequest {
  userId: string;
  lineId: string;
  delta: number;
  /** The unit the caller believed the line counts in. */
  measurementUnit: MeasurementUnit;
}
```

A delta is arithmetic on a number the caller has not read (`0040`, section 3), and that is
exactly why it has to say what unit it was thinking in. Two devices on one list: the first
changes a cheese line from units to grams and sets it to 25, the second, still showing "×2",
sends "+1". Applied blind, that is 26 g. Core compares the delta's unit with the line's and
refuses a mismatch with `LINE_UNIT_MISMATCH`, a 409 at the gateway, and the client re-reads
the line it was already going to receive over realtime.

The field is required. The gateway's schema rejects a delta without it, which makes this plan
a floor bump for the client (`0072`, the minimum version the server insists on): a velista
that does not know units cannot move a quantity on a server that does, and a 409 it does not
understand is worse than an update it does.

## 4. The basket copies the unit and never changes it

`generated_list_lines."measurementUnit" measurement_unit NOT NULL DEFAULT 'UNIT'`, in the
same migration. A basket line's text and quantity are copies taken at generation
(`generated-list-line.entity.ts`), and the unit is copied beside them for the same reason: a
trip is a record of what was wanted when it was composed.

**The composition key gains the unit.** A basket line is asked for by every list it reaches
(`0092`), and its origins are summed. Five hundred grams and two units of one product do not
sum, so two lines for the same product set in different units become two basket lines, each
with the origins that share its unit. `GeneratedListLineOriginView.quantity` is in the basket
line's unit and needs no column of its own.

**The equivalence of `0102` is read live, like the price.** A basket is priced against the
profile that composed it (`0078`) and never against prices frozen at composition, and the
equivalence that turns a grams line into a count of bottles is part of pricing. A frozen
equivalence makes the amount disagree with the offer beside it. What is frozen is the unit and the
quantity, which are what the shopper asked for.

## 5. Settling counts in the line's unit

`SettleLineRequest.quantity` and `LineSettlementView.quantity` are in the basket line's unit,
and `settledQuantity` on the line is summed in it. The option a settlement names (`0094`) is
priced by `0096` section 5 for the client, and core stores nothing about the amount. The
outstanding quantity is `quantity - settledQuantity` as before, in the line's unit, and the
line's own quantity in the source list is decremented by it (`0093`), which is in the same
unit because the basket line copied it from there.

A settlement whose option is a product measured differently from the line is allowed, because
the shopper bought what they bought. The amount for it is whatever the table answers, which
is nothing when no equivalence exists, and the sheet says so.

## 6. What the gateway and the assistant do

The gateway validates the enum on every write above and maps `LINE_UNIT_MISMATCH` to a 409.
The assistant's `line.addMany` states nothing and gets `UNIT`, which is right for everything
it hears today. Teaching it "three hundred grams of cheese" is a sentence in its prompt and a
field in its tool schema, and it is not this plan.

The OpenAPI document and the wire types regenerate.

## 7. Testing

- `line.service.spec.ts`: a line is created with the stated unit and `UNIT` when none is
  stated, a unit change without a quantity is refused, and a unit change with one stores both.
- `line-quantity-delta.integration.spec.ts`: a delta in the line's unit applies, and a delta in
  another unit is refused with `LINE_UNIT_MISMATCH` and leaves the quantity untouched.
- The generation spec: two source lines for one product in two units compose two basket lines,
  and two in one unit compose one with two origins.
- The settlement spec: settling 250 of a 750 g line leaves 500 outstanding and decrements the
  source line by 250.
- The gateway's HTTP spec: a delta without a unit is a 400, a mismatch is a 409, and the error
  body names the code.

## 8. Exit criteria

1. `list_lines.measurementUnit` and `generated_list_lines.measurementUnit` exist, default to
   `UNIT`, and travel on every line view and event.
2. A write can state a line's unit, a unit change must state its starting quantity, and a
   delta in the wrong unit is refused with `LINE_UNIT_MISMATCH`.
3. A basket composes one line per (product set, unit), copies the unit, and settles in it.
4. The client floor is raised so that a client that does not send a unit on a delta is told to
   update rather than shown a 409.
5. The OpenAPI document and the wire types are regenerated and committed.
