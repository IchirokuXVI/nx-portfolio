# 0096 A product is measured in one unit, and a group allows several

Plan `0095` gave every unit price a basis and one comparable figure, so a per kilogram price is
now a number a machine can multiply. This plan says what it is multiplied by, and it starts by
separating two facts an earlier draft had folded into one. **What a shopper counts** is the
line's business: five tomatoes, one tray, three hundred grams of cheese. **What the shop
measures a product in** is the product's business: the tomatoes are weighed, the tray is a
piece, the cheese at the counter is weighed and the sliced pack is a piece. The earlier draft
put one `soldBy` on the item and made it both, which broke the moment a shopper wrote "5" for
a product priced per kilogram. Nobody knows what five tomatoes weigh, and nobody is going to
type it.

So the product gets exactly one unit, the group it belongs to lists every unit its members are
measured in, a line chooses among them (plan `0101`), and the price of a line follows from the
three by one table (section 5). A quantity the table cannot price is shown without an amount,
never with an invented one.

Depends on `0095` for `comparablePrice` and `comparableUnit`, without which a weighed product
has no figure to multiply. Plan `0101` is the line that reads what this plan writes, `0102` is
the table that lets a unit reach another, and velista `0070` is the screen.

## 1. Three units, all base units, and none of them is a size

```ts
/**
 * What a quantity counts (plan 0096, section 1). Base units only: a quantity is
 * stored in grams or millilitres and a client draws 12500 as 12,5 kg.
 */
export enum MeasurementUnit {
  UNIT = 'UNIT',
  GRAM = 'GRAM',
  MILLILITER = 'MILLILITER',
}
```

It is a third enum, and each of the other two rules itself out:

- `UnitOfMeasure` is a **size** vocabulary. `unitSize` `1` with `defaultUnit` `LITER` says what
  one carton holds. A carton is counted in units, so the unit a shopper counts a milk in is not
  the unit its size is stated in, and overloading the size field with the counting rule breaks
  the milk in order to fix the trout. `UnitOfMeasure` keeps `KILOGRAM`, `LITER` and `PACK`
  because sizes and the comparison of `0095` need them.
- `PriceBasis` is what a **price** is per, and a price per gram is 0.00995, which four decimals
  cannot hold. Prices stay per kilogram and per litre. Quantities are stored in the base unit so
  that a line's integer quantity can say 750 g without a fraction, and so that the database
  never holds the same amount in two units.

**There are no kilograms and no litres anywhere a quantity is stored.** Not on a line, not on
a group's allowed list, not in the equivalence table of `0102`. The client formats: below a
thousand it draws grams and millilitres, from a thousand it draws kilograms and litres with one
decimal, and the number on the wire is the same integer either way.

## 2. `measurementUnit` on the item, and exactly one

```ts
export interface ItemView {
  // ...
  /** The unit the shop measures this product in (plan 0096, section 2). */
  measurementUnit: MeasurementUnit;
}
```

A column on `items`, `"measurementUnit" measurement_unit NOT NULL DEFAULT 'UNIT'`, in
migration `MeasurementUnit1757200000000`. **Every existing item is `UNIT`**, with no backfill
from any other column: a storefront product is a pack, and the leaflet rows that are weighed
are exactly the rows nobody can tell apart from a six pack by their columns (`0095`, section
1). The reference seed sets `GRAM` on the items it prices per kilogram, and the curation
decider corrects the rest (section 6).

One unit per product is not a limitation the app imposes on the world. It is what the catalog's
own merge rule already makes true: an item is keyed on brand and format (`0086`, and the
catalog merge rules), so a 400 g tray of trout and loose trout at the counter are two items,
and a sliced pack of ham and ham cut at the deli are two items. What one unit does forbid is
an item that is weighed at one chain and pieced at another under one row, and that item was
already two formats.

Three cases follow, and each is written down so nobody adds a second unit to fix it:

- **A unit item whose size is unknown**, such as a leaflet tile that printed no size. It prices
  a count of units and nothing else, and a grams line on it shows no amount (section 5).
- **A whole fish.** The item is `GRAM`, the shopper writes "1", and no amount is shown, only
  "9,95 €/kg". Nothing here knows what a fish weighs, and backlog `0012` records the ideas that
  were refused for finding out.
- **A per kilogram figure on a unit item**, such as Mercadona's `bulk_price` on a tray. That is
  not a second unit. It is a second figure, `comparablePrice`, and section 5 reads it when the
  line asks in grams and `0102` knows what the tray weighs.

### 2.1 Who sets it

- **An operator**, on the item form in the back office. The picker is the three values and the
  default is `UNIT`. Changing the unit of an item that belongs to a group whose list does not
  allow the new unit is refused with `measurementUnitNotAllowed` (section 3.2).
- **A source, on a product it creates and never on one that exists.** Harvest document version
  2 (`0095`, section 5.1) gains an optional `measured_in` on the product, in the extractor's own
  words as `unit_price.per` is: `unit`, `g`, `ml`. A leaflet tile whose only price is per
  kilogram is usually a tile for a weighed product, and the producer says so. An accepted entry
  that **creates** an item passes it through `item.create`. An entry resolved to an item catalog
  already holds leaves the unit alone and adds a `MEASUREMENT_UNIT_DISAGREES` warning to the
  run when the two differ, so the operator sees it in the queue and a source cannot flip a rule
  the operator set.
- **The reference seed**, which sets `GRAM` on the counter items it prices per kilogram.
- **No storefront adapter.** Mercadona, Carrefour and LIDL sell a weighed product as a piece or
  a tray with a pack price, and `UNIT` is right for all of them. An adapter that later meets a
  chain selling loose by weight states it in the document and nowhere else.

## 3. A group allows several, and names a default

```ts
export interface ProductGroupView {
  // ...
  /** Every unit a member can be measured in, in the order the picker shows them. */
  measurementUnits: MeasurementUnit[];
  /** What a new line for this group counts in. Always one of the list. */
  defaultMeasurementUnit: MeasurementUnit;
}
```

A bag of chicken nuggets is counted in units and nuggets from the deli counter are weighed, and
both belong in one group because the group's job is to say which is cheaper per kilogram. So a
group lists every unit its members use. Two columns on `product_groups`, in the same
migration: `"measurementUnits" measurement_unit[] NOT NULL DEFAULT '{UNIT}'` and
`"defaultMeasurementUnit" measurement_unit NOT NULL DEFAULT 'UNIT'`. Every existing group
allows `UNIT` alone, which is what every existing member is.

**The default is a column, not the first element of the list.** A list an operator reorders
must not change what every new line for the group gets. The default must be in the list, and
the service refuses a write where it is not.

`referenceUnit` stays what it is and is unrelated. It says what members are **compared** in
(per kilogram, for `0095` section 6.1), and a group of milks compares per litre while every
line for it counts cartons.

### 3.1 The default reaches the line through the group, or the item

When a line is added for a group, it counts in the group's default. When a line is added for a
product, it counts in the product's unit. When a line is free text, it counts in `UNIT`. The
line then keeps whatever the shopper changes it to (`0101`). Core knows none of this, because
core knows no catalog: the client reads the default off the view it already holds and states
the unit on the write.

### 3.2 Membership is checked against the list

An item can join a group only if its `measurementUnit` is in the group's list, and the check
runs in every path that assigns one:

| Path                                                   | Refuses with                |
| ------------------------------------------------------ | --------------------------- |
| `item.create` and `item.update` with a `productGroupId` | `measurementUnitNotAllowed` |
| `productGroupAssignment` bulk operations (plan `0100`)  | the same code, per operation |
| `item.update` changing the unit of a grouped item       | the same code               |
| `productGroup.update` removing a unit a member uses     | `measurementUnitInUse`      |

Widening a list is always allowed. Narrowing one is allowed only when no member is measured in
the unit being removed, so a group can never hold a member its own list does not admit.

## 4. The step a quantity moves by

A reel that moves ham one gram at a time is unusable, and a reel that moves it 250 g at a
time cannot say 375. So a quantity in grams or millilitres moves by a **fine** step below a
thousand and a **coarse** step from a thousand, where the label also switches to kilograms and
litres:

```ts
export interface QuantityStep {
  /** The step below `QUANTITY_COARSE_FROM`. Must divide 1000. */
  fine: number;
  /** The step from `QUANTITY_COARSE_FROM` on. Must be a multiple of `fine`. */
  coarse: number;
}

export type QuantitySteps = Partial<Record<MeasurementUnit.GRAM | MeasurementUnit.MILLILITER, QuantityStep>>;

export const QUANTITY_COARSE_FROM = 1000;
export const QUANTITY_STEP_DEFAULTS: Required<QuantitySteps> = {
  GRAM: { fine: 25, coarse: 250 },
  MILLILITER: { fine: 50, coarse: 250 },
};
```

`UNIT` has no step. It moves by one and there is nothing to configure.

**The two constraints are what keep the boundary reachable.** A fine step that divides 1000
lands on 1000 exactly, so the label switch happens on a value the reel can show. A coarse step
that is a multiple of the fine one lands, when stepping down from 1000, on a value the fine
step can reach again. A fine step of 30 climbs 990, 1020 and never shows the switch. A coarse
step of 300 over a fine step of 25 steps down from 1000 to 700 and then climbs by 25 to 1000
through values the coarse step never produces. The service validates both and refuses a step
that breaks either.

A step is overridable by the group and by the item, and the nearest one wins:

| Level    | Column                                        | Meaning                                 |
| -------- | --------------------------------------------- | --------------------------------------- |
| item     | `items."quantitySteps" jsonb NULL`            | this product moves differently          |
| group    | `product_groups."quantitySteps" jsonb NULL`   | every member of this group does         |
| default  | `QUANTITY_STEP_DEFAULTS`                      | 25 g, 50 ml, 250 from a thousand        |

Each level states only the units it changes, so a group that sets grams leaves millilitres at
the default. `ItemView.quantitySteps` and `ProductGroupView.quantitySteps` carry the
**resolved** steps for both units, item over group over default, so a client resolves nothing
and a rule change here reaches every screen at once. The raw override stays visible in the
back office, which is the one place it is edited.

## 5. The price of a line, by one table

A line has a unit and a quantity (`0101`). An offer has a pack price and, since `0095`, a
comparable figure with its unit. The product has a measurement unit. The amount of a line, and
whether it is exact, is a function of those and nothing else, and this table is the normative
statement of it. Velista `0070` implements it and is the only place that runs it, because the
second factor moves under a thumb on a reel and a server number is stale the moment it does.

| Line unit          | Item unit          | Offer figure used                       | Amount                                       | Mark  |
| ------------------ | ------------------ | --------------------------------------- | -------------------------------------------- | ----- |
| `UNIT`             | `UNIT`             | `price`                                 | `price × quantity`                           | exact |
| `GRAM`             | `GRAM`             | `comparablePrice` with unit `KILOGRAM`  | `comparablePrice × quantity / 1000`          | ≈     |
| `MILLILITER`       | `MILLILITER`       | `comparablePrice` with unit `LITER`     | `comparablePrice × quantity / 1000`          | ≈     |
| `UNIT`             | `GRAM` or `MILLILITER` | none                                | none, the row shows the figure per kilogram  |       |
| `GRAM` or `MILLILITER` | `UNIT`         | `price`, through an equivalence (`0102`) | `price × ⌈quantity / grams per unit⌉`       | ≈     |
| any other pairing  |                    | none                                    | none                                         |       |

Three rules the table encodes:

- **A count of packs at a pack price is the only exact amount.** Everything else depends on a
  weight the shopper has not seen yet, and is marked as an estimate wherever it is drawn. The
  arithmetic of a 500 g line is exact, and the scale will say 480 g, so the mark stays.
- **A missing figure is a missing amount.** A `GRAM` line on a `GRAM` item whose only row is a
  pack price shows nothing, because a pack price says nothing about a kilogram. The row still
  shows the figure it has, so a shopper sees "1,99 €/kg" or "3,50 €" and never a blank.
- **The table never converts a price**, which is the verbatim rule of `0080`. It multiplies a
  figure `0095` already materialized by a quantity, and divides by a thousand because the
  quantity is in the base unit and the figure is per the family's reference.

The line that reads "liters of meat" is the last row: no figure, no amount, and the unit chip
in velista `0070` shows the unit as unsupported before the shopper picks it.

### 5.1 `getMany` ranks by the product's own unit

`offersFor` in `item.service.ts`, called with `'price'` for `getMany` since `0066`, orders a
`UNIT` item's rows by `price ASC NULLS LAST` exactly as today, so the six pack argument of
`0066` section 2.1 stands. A `GRAM` or `MILLILITER` item's rows are ordered by
`comparablePrice ASC NULLS LAST` among the rows whose `comparableUnit` is the item's family,
then `price`, then `unitPrice`, so a weighed product's best offer is its cheapest per
kilogram. The item's unit decides, not the line's, because a line's unit is unknown to the
server and because the shop's way of selling a product is the way its price is compared.

`search` and `searchOffers` are `0095`'s and do not change.

## 6. Curation states both

- **The suggestions decider** (`curation-suggestions`) states `measurementUnit` on every
  `CREATE`, beside the `defaultUnit` and `unitSize` it already states, and its prompt gains the
  rule of section 2: a pack or a tray is `UNIT`, a product the tile prices per kilogram and
  sells loose is `GRAM`, a product sold by the litre from a tap is `MILLILITER`, and a doubt is
  a `REVIEW`.
- **The groups decider** (`curation-groups`) gains a validator, `MEASUREMENT_UNIT_NOT_ALLOWED`,
  agreeing with section 3.2, and states `measurementUnits` and `defaultMeasurementUnit` on
  every `CREATE_GROUP`. An `ASSIGN` to an existing group whose list lacks the item's unit is a
  `REVIEW`, never a widening: the decider does not edit groups it did not create.
- **The bulk routes** of plan `0100` carry the new fields on `createGroup` and validate
  `assignItem` by section 3.2, so a decision file lands whole or not at all as before.

## 7. The back office

The item form gains the unit picker and, under an "advanced" fold, the two step fields per
weighed unit. The item detail page shows the unit and the resolved steps. The group form gains
the unit list, the default picker constrained to the list, and the same step fields. The group
list marks a group whose members' comparable units disagree with its reference unit (`0095`,
section 6.1). The OpenAPI document and the wire types regenerate.

## 8. Testing

- The item service spec asserts `measurementUnit` defaults to `UNIT` on create, is validated as
  the enum on update, and that changing it on a grouped item is refused when the group's list
  lacks the new unit.
- The group service spec asserts the default must be in the list, that narrowing is refused
  while a member uses the unit, and that widening is not.
- The assignment spec and the plan `0100` bulk route spec assert `measurementUnitNotAllowed`
  per operation and that a refused operation fails the whole file.
- `quantity-steps.spec.ts` in contracts asserts the resolution order and both constraints, with
  30 and 300 as the refused examples of section 4.
- `item-get-many-pricing.spec.ts` gains a `GRAM` item with a per 100 g row and a per kilogram
  row in two scopes, and asserts the cheaper figure per kilogram wins, a `UNIT` item with the
  same rows still ranks by `price`, and a `GRAM` item with only a pack price answers an offer
  whose `comparablePrice` is null and that still travels.
- The file import runner spec asserts a created item receives the document's `measured_in`,
  and that a resolved item keeps its own and the run carries the warning.
- The reference seed's own check asserts the per kilogram items are `GRAM` and that their
  groups list it.
- The two deciders' `node --test` suites gain the validator cases of section 6.

## 9. Exit criteria

1. `MeasurementUnit` is in `@portfolio/luna-shopper/contracts` with `UNIT`, `GRAM` and
   `MILLILITER` and nothing else, and no column anywhere stores a quantity in kilograms or
   litres.
2. `items.measurementUnit` exists, defaults to `UNIT`, is editable in the back office, is set
   by a leaflet import on the items it creates, and is refused where the item's group does not
   allow it.
3. `product_groups.measurementUnits` and `defaultMeasurementUnit` exist, the default is always
   in the list, and no group holds a member measured in a unit outside its list.
4. `quantitySteps` resolve item over group over default on both views, and a step that breaks
   either constraint of section 4 is refused.
5. `getMany` ranks a weighed product by its cheapest comparable figure and a unit product by
   its cheapest pack price.
6. The table of section 5 is the one velista `0070` implements, and the seed's per kilogram
   items produce an estimated amount for a grams line and none for a units line.
7. The OpenAPI document and the wire types are regenerated and committed.
