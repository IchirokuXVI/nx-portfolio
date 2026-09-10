# 0102 One unit of a product equals so many of another

A bottle of water is measured in units (`0096`). A shopper who writes "4 l of water" on a line
in millilitres (`0101`) has asked a question the product can answer: one bottle is 1500 ml, so
four litres is three bottles, and three bottles at 3 € is 9 €. Nothing today can answer it,
because the only place a product's size lives is `unitSize` with `defaultUnit`, which say "1.5
LITER" in a vocabulary that is a size for a person and not a factor for a machine.

This plan is that factor, as a table, and the conversion that reads it. **It is built now and
will mostly sit unused for a while.** The backfill of section 2 fills it from every product
that has a size, the pricing table of `0096` section 5 gains the row that reads it, and no
screen depends on it beyond an editor in the back office. It ships so that the day a source
states what a tomato weighs, the only work left is a row.

Depends on `0096` for `MeasurementUnit` and on `0095` for the comparable figure section 4
derives.

## 1. The table

```sql
CREATE TABLE "item_unit_equivalences" (
  "id"       uuid PRIMARY KEY,
  "itemId"   uuid NOT NULL REFERENCES "items" ("id") ON DELETE CASCADE,
  "toUnit"   measurement_unit NOT NULL,
  "factor"   numeric(14, 6) NOT NULL CHECK ("factor" > 0),
  UNIQUE ("itemId", "toUnit")
);
```

A row says **one `measurementUnit` of the item equals `factor` of `toUnit`**. The source unit
is not a column, because it is always the item's own unit (`0096`, section 2), and a row whose
`toUnit` equals it is refused. So an item has at most two rows, one per other base unit, and
the three cases read:

| Item unit    | Row `toUnit` | Means                                  | Example                       |
| ------------ | ------------ | -------------------------------------- | ----------------------------- |
| `UNIT`       | `MILLILITER` | one pack holds this many millilitres   | a bottle, 1500                |
| `UNIT`       | `GRAM`       | one pack weighs this many grams        | a tray, 400                   |
| `GRAM`       | `MILLILITER` | one gram is this many millilitres      | oil at the tap, 1.087         |
| `MILLILITER` | `GRAM`       | one millilitre weighs this many grams  | milk from a churn, 1.03       |

**Density is per item and never assumed.** Water is one gram per millilitre and oil is not, so
a millilitre to gram row is stated by an operator or a source, or it is absent. A `UNIT` item
with both a `GRAM` and a `MILLILITER` row implies its own density, and the conversion of
section 3 uses the two rows and derives nothing more.

Kilograms and litres do not appear, by the rule of `0096` section 1. A 1.5 L bottle is 1500.

```ts
export interface ItemUnitEquivalence {
  toUnit: MeasurementUnit;
  factor: number;
}

export interface ItemView {
  // ...
  /** One `measurementUnit` of this product in each other base unit it can reach (plan 0102). */
  equivalences: ItemUnitEquivalence[];
}
```

## 2. The table fills itself from the size

`unitSize` with `defaultUnit` is the same fact in the size vocabulary, for the products that
have one, and migration `ItemUnitEquivalences1757400000000` backfills one row per product
whose size is in a family with a base unit:

| `defaultUnit` | `unitSize` | Row                      |
| ------------- | ---------- | ------------------------ |
| `LITER`       | n          | `MILLILITER`, n × 1000   |
| `MILLILITER`  | n          | `MILLILITER`, n          |
| `KILOGRAM`    | n          | `GRAM`, n × 1000         |
| `GRAM`        | n          | `GRAM`, n                |
| `UNIT`, `PACK` | n         | nothing: six cans is a count, not a base unit |

Only for items whose `measurementUnit` is `UNIT`, because the size of a pack is what the row
means, and a weighed product's `unitSize` is a display figure with no pack behind it. The
migration reads two columns and writes rows, which is what makes it a migration and not a
script.

**The write path keeps doing it.** `item.create` and `item.update` derive the same row from
the same two fields whenever a size is written and no row for that unit exists, so the table
fills from every source that states a size, which is every storefront adapter and the
suggestions decider. A row an operator wrote by hand is never overwritten by a size: the
operator's number is the more deliberate one.

`unitSize` and `defaultUnit` stay. They are the merge key's format, the size a screen draws
under a name, and the number the decider states. Retiring them into this table is a later
plan, if it is ever worth doing.

## 3. The conversion, and what it rounds

```ts
/**
 * A quantity in `from` as a quantity in `to`, through the item's rows, or null
 * when no row reaches `to`. Into a count it rounds up, because a till sells
 * whole packs; `rounded` says so.
 */
export function convertQuantity(
  quantity: number,
  from: MeasurementUnit,
  to: MeasurementUnit,
  item: { measurementUnit: MeasurementUnit; equivalences: ItemUnitEquivalence[] }
): { quantity: number; rounded: boolean } | null;
```

Framework free, in `libs/luna-shopper/contracts`, so velista's own copy of it (`0070`) has one
normative text to agree with, and the assistant or a back office screen can run it too.

- **Into a count rounds up.** 4000 ml of water in 1500 ml bottles is `⌈4000 / 1500⌉` = 3
  bottles, 4500 ml, and the amount is three times the pack price. It is drawn as "3 × 1,5 L"
  with the estimate mark, because the shopper asked for four litres and will carry four and a
  half. A fractional bottle is never priced.
- **Into a base unit multiplies exactly.** Three bottles is 4500 ml, no rounding, no mark from
  this function. The mark it carries comes from the pricing table, which marks every weight.
- **Between the two base units** goes through the item's unit: a `UNIT` item with both rows
  converts grams to millilitres in two steps, and a weighed item with a density row in one.
- **A pair with no path answers null**, and null is "no amount" in the table of `0096`
  section 5. It is not zero and it is not an error.

The pricing table of `0096` section 5 already carries the row that reads this: a `GRAM` or
`MILLILITER` line on a `UNIT` item is priced as `price × ⌈quantity / factor⌉`, marked as an
estimate.

## 4. A product with no stated comparison can earn one from its size

LIDL publishes no unit price at all, so under `0095` every LIDL row has a null comparable
figure and sorts last in every group. The verbatim rule forbids deriving `unitPrice`, and this
plan does not touch it. What it adds is a derived comparison, in the derived column, flagged:

| Column             | On                                    | Holds                                           |
| ------------------ | ------------------------------------- | ----------------------------------------------- |
| `comparableSource` | `supermarket_items`, `ItemOfferView`  | `SOURCE` when the figure is the source's own, `DERIVED` when computed here |

`applyEffective` writes `DERIVED` **only when** the effective row has a null `unitPrice`, the
item is `UNIT`, and a `GRAM` or `MILLILITER` row exists: `comparablePrice` is
`price × 1000 / factor` per kilogram or per litre, and `comparableUnit` is the family. A row
whose source stated a figure is never overridden, whatever its basis, because the source's own
comparison is the one `0038` section 2.4 chose to trust over the app's arithmetic. A source
that states a figure with no basis stays null, as `0095` decided: this rule needs a null
figure, not a null basis.

The recompute needs the item's rows, so `recomputeEffectivePrices` loads the item's unit and
equivalences per chunk, one query more than today. An equivalence write recomputes every
`supermarket_items` row of its item in the same transaction, as a `soldBy` change did in the
earlier draft of `0096`, so a size stated today prices the shelf today.

`searchOffers` and `getMany` read `comparablePrice` and do not care where it came from. The
offer carries `comparableSource`, so velista `0070` can mark a derived figure where it draws
one.

## 5. The back office

The item detail page gains an equivalence editor: at most two rows, the unit picker limited
to the other two base units, the factor a positive number, and a note beside a row the
backfill wrote. The price list on an item shows `comparableSource` beside the comparable
figure. The OpenAPI document and the wire types regenerate.

## 6. Testing

- `convert-quantity.spec.ts` covers every row of section 3, including the two step path
  through a `UNIT` item, rounding up into a count with `rounded` true, exact multiplication
  into a base unit, and null for a pair with no path.
- The migration integration spec seeds items with each `defaultUnit` and asserts exactly the
  rows of section 2, and none for a weighed item.
- The item service spec asserts a size write derives a row, a hand written row survives a
  later size write, and a row to the item's own unit is refused.
- `effective-price.spec.ts` asserts `DERIVED` is written only under the three conditions of
  section 4, that a stated figure is never overridden, and that an equivalence write recomputes
  every scope of the item.
- `item-prices.integration.spec.ts` gains a LIDL style row, pack price and no unit price, and
  asserts it ranks in its group by the derived figure and answers `DERIVED` on the offer.

## 7. Exit criteria

1. `item_unit_equivalences` exists, holds at most one row per (item, unit), refuses the item's
   own unit and a non positive factor, and is backfilled from every sized `UNIT` item.
2. `convertQuantity` is in contracts, rounds up into a count and says so, and answers null for
   a pair with no path.
3. A LIDL row with a pack price and a size carries a `DERIVED` comparable figure, and no row
   with a stated figure is ever overridden.
4. `unitPrice` is unchanged on every row.
5. The OpenAPI document and the wire types are regenerated and committed.
