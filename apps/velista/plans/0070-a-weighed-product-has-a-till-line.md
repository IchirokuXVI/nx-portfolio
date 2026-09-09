# 0070: a weighed product has a till line

> A basket with a butcher's tray in it shows a name and nothing after it. The row for the
> milk beside it says "· 0,89 €", the settle sheet quotes the milk and marks it cheapest, and
> the trout that costs more than everything else on the list is priced at nothing. The
> catalog knows the trout is 9,95 € a kilo. It has known since the leaflet was imported. No
> screen in this app can say so, because every one of them reads a pack price the trout will
> never have.
>
> Prerequisite reading: `0062` (the price on every product, and the three places it is drawn),
> `0063` section 6.4 (why the unit price is on the model and not on the row), `0054` (the reel),
> and backend `0095`, `0096`, `0101` and `0102`, which put on the wire the facts this plan
> draws: what a figure is per, what a product is measured in, what a line counts in, and what
> one unit of a product equals in another.

Backend `0096` section 5 settles the arithmetic in one table, and this plan is that table
drawn: the amount of a line is a figure from the offer times the line's quantity, exact for a
count of packs at a pack price and an estimate for everything else. This plan is the readers
`0062` built taught to read it, the reel taught to step by the unit, and one new control, the
chip that lets a shopper count cheese in grams. It changes no route and no store of its own.

| What changes                                               | Where                                    |
| ---------------------------------------------------------- | ---------------------------------------- |
| The model: two enums, fields on the offer, item, group, line | `models`, `data-access`                 |
| Two formatters and the amount function                     | `platform`                               |
| The row: the price suffix and a quantity with a unit       | `basket-line-row`, `basket-labels`       |
| The settle sheet: the amount, and when to mark cheapest    | `settle-sheet`                           |
| The suggestion: a figure when there is no pack price       | `suggestion-list`                        |
| The reel: a step per unit, and a label that switches       | `quantity-reel`                          |
| The unit chip, and the reset it causes                     | `line-units-sheet`, the line edit sheet  |
| The delta: it names the unit                               | `data-access`                            |

## 1. The model

Two enums join `enums.ts`, velista's own copies by rule D4 and never the backend's export:
`MEASUREMENT_UNITS` (`UNIT`, `GRAM`, `MILLILITER`, fallback `UNIT`) and `PRICE_BASES` (the
seven values of backend `0095`, fallback null). The fields:

| Type             | Gains                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| `ProductOffer`   | `comparablePrice: number \| null`, `comparableUnit: PriceBasis \| null`, `comparableSource: 'SOURCE' \| 'DERIVED' \| null` |
| `CatalogItem`    | `measurementUnit`, `quantitySteps` (resolved, both weighed units), `equivalences`     |
| `BasketProduct`  | the same three, and its `unit` becomes the enum through `oneOf` as `CatalogItem.unit` already is |
| `ProductGroup`   | `measurementUnits`, `defaultMeasurementUnit`, `quantitySteps`                          |
| `Line`, basket line | `measurementUnit`                                                                   |

`BasketProduct` is in `basket-view.ts`, not `domain.ts`, and its mapper (`basket-mappers.ts`,
`toBasketProduct`) reads `unit` through `nullableStr` today. It moves to `oneOf` with the
fallback, so the basket side applies D4 as the catalog side does. `basket-memory.ts` carries
every new field through the fake the specs use.

Nothing on the model computes. **The amount is a function of the line's unit and quantity,
the product, and the offer**, and the quantity is whichever number the screen is showing: the
outstanding amount on the row, the live reel value on a sheet, the quantity being settled on
the settle sheet. Backend `0096` section 5 leaves the multiplication to the client for that
reason: the second factor moves under a thumb, and a server number is stale the moment it does.

## 2. Two formatters and one function, in `platform`

`formatMoney` lives in `libs/velista/platform/src/lib/money.ts`, and the three new things
live beside it.

**`formatQuantity(quantity, unit, locale)`.** The wire carries base units only (backend
`0096`, section 1), and this is the one place kilograms and litres exist in velista:

| Unit          | Below 1000 | From 1000                       | Examples                   |
| ------------- | ---------- | ------------------------------- | -------------------------- |
| `UNIT`        | "×N"       | "×N"                            | ×2                         |
| `GRAM`        | "N g"      | "N kg", at most one decimal     | 750 g, 1 kg, 12,5 kg       |
| `MILLILITER`  | "N ml"     | "N l", at most one decimal      | 500 ml, 1,5 l              |

Through `Intl.NumberFormat` with `style: 'unit'` in the reader's locale, never through a
translation key with a number in it. "×N" is where today's rule lives too, so no component
decides which form it is drawing. The suggestion list's `sizeOf`, which formats a product's
size through `list.add.size.*` keys today, is folded into this formatter for the units it
covers, and the units sheet's total, which goes through `basket.units.buying` with a count
argument, reads it instead.

**`moneyCents`.** Every multiplication in this plan is done in integer cents and rounded once,
half up as a till rounds, and `formatMoney` is called on the result. 0,00995 × 500 in floating
point is 4,97499… and prints 4,97 when the till says 4,98. `priceToCents` in the Carrefour
library is the same idea at the other end of the pipe.

**`lineAmount(line, product, offer)`.** The table of backend `0096` section 5 and the
conversion of `0102` section 3, as one pure function:

```ts
interface LineAmount {
  cents: number;
  /** `exact` for a count of packs at a pack price. Everything else is an estimate. */
  mark: 'exact' | 'estimate';
  /** Set when the quantity was rounded up to whole packs: "3 × 1,5 l". */
  packs: number | null;
}
function lineAmount(
  quantity: number,
  unit: MeasurementUnit,
  product: Pick<CatalogItem, 'measurementUnit' | 'equivalences'>,
  offer: ProductOffer
): LineAmount | null;
```

Null is "no amount", and every reader draws null as the figure the offer has and nothing
more. Velista holds no factor table and never reads `unitPriceBasis` to do arithmetic. It
reads `comparablePrice` and `comparableUnit`, which the server already converted. Its spec
mirrors the backend table row for row, which is how the two stay one rule.

## 3. Everything that is not exact says so

**Every amount whose `mark` is `estimate` is drawn with "≈" in front of it**, on the row, on
the settle sheet, in the suggestion, under the reel. A count of packs at a pack price is the
only amount drawn bare. A figure the server derived from a size (`comparableSource`
`DERIVED`) is drawn with the same mark where the figure itself is shown, because a per
kilogram price the app computed from a bottle is not the shop's own number. One token in the
copy, `basket.amount.estimate`, holds the mark, so it can become a word if a glyph proves
unclear.

## 4. The row

`productName` in `basket-line-row.ts` draws `name · price` when the offer has a `price`, and
the name alone otherwise (`0062`, section 4). The rule becomes: **the suffix is the figure
the product is measured by.**

- Product measured in `UNIT`, with a `price`: `name · 0,89 €`, exactly as today.
- Product measured in `GRAM` or `MILLILITER`, with a comparable figure: `name · 9,95 €/kg`.
  The unit after the slash is the family of `comparableUnit`, and it is there because a bare
  "9,95 €" on a trout reads as the price of a trout.
- Anything else: the name alone.

The quantity caption (`quantityCaption` in `basket-labels.ts`) reads the line's unit through
`formatQuantity`. "×2" stays for a pack. A weighed line says "750 g", and the partly settled
form says "250 g of 750 g" with the same formatter on both numbers. **A weighed line draws its
caption at a quantity of one**, where a pack draws nothing today: "×1" is noise and "1 kg" is
the fact. The row does **not** draw the line amount. The caption line has room for one number
(`0063`, section 6.4), that number is the price of one, and the amount is the settle sheet's,
where the shopper is deciding to pay it.

## 5. The settle sheet

`options` in `settle-sheet.ts` builds `price` from `offer.price` and `amount` beside it for the
cheapest mark, and the template draws no amount at all today. Both read `lineAmount` now:

- `price` is the suffix string of section 4 for the option's product. `unitPrice` on the row,
  the secondary line that shows the source's own figure with its label, stays as it is, because
  it is still the only place the printed comparison figure is shown and `0095` kept the label
  verbatim for exactly that.
- **The amount is new on the template**: "750 g · ≈ 7,46 €", or "3 × 1,5 l · 9,00 €" when the
  conversion rounded to packs, for the quantity being settled, live while the reel moves.
- **The cheapest mark compares amounts only among options with the same `mark`**, and only
  when at least two have one. An exact tray beside an estimated kilogram are two numbers of
  different meaning, and marking the smaller one cheapest is the comparison backend `0095`
  section 6.1 forbids the server to make. When the priced options do not agree, no mark is
  drawn, which is the rule the pane already applies to a single priced option.
- `noPrice` is unchanged: an option with no amount in a pane where another has one says it is
  unknown rather than free.

## 6. The suggestion list

`noteOf` in `ui/src/lib/list/suggestion-list.ts` returns the brand alone when the offer has no
`price`. The rule becomes the row's: the note quotes the suffix of section 4, so a weighed
product from a leaflet reads "El Jamón · 9,95 €/kg" instead of a brand and nothing.
`bestPriceOf` on a group row is unchanged: the server picks the group's most economical member
in the group's own reference unit (`0095`, section 6.1), and the row already says "best price"
because that number is a floor and not a total.

## 7. The reel steps by the unit

`QuantityReel` gains a `unit` input and a `steps` input, the resolved `quantitySteps` of the
product or group the line was added for, and computes its own step from the value under the
thumb: the fine step below `QUANTITY_COARSE_FROM` (1000) and the coarse step from it. With the
defaults, ham climbs 25, 50, … 975, 1000 and then 1250, 1500, and comes back down 1000, 750,
725. The label under the thumb goes through `formatQuantity`, so it reads "975 g", then "1 kg",
then "1,25 kg", and the number on the wire never changes shape. `UNIT` steps by one, as today.

A step is not one input. The reel assumes a step of one in at least six places, and each is
touched: the previous and next values it renders, the keyboard steps and the page step, the
pixels per unit of a drag, the value a tap snaps to, the plus and minus buttons of PR #303,
and the two bound checks. The delta it emits is still one signed integer per adjustment
(`0054`), in base units, and the drag's pixels per unit are per step, so a swipe across ham
travels the same distance as a swipe across cartons.

Two lines of one product in two units are two lines (`0101`, section 4), so a reel never
changes unit under a thumb.

## 8. The unit chip

Beside the reel, on every sheet that edits a line's quantity (the units sheet and the line
edit sheet), and not on the row. Three states per unit, and every unit is selectable:

| State  | When                                                                       | Result of choosing it            |
| ------ | -------------------------------------------------------------------------- | -------------------------------- |
| green  | a product of the line is measured in it, or the group's list allows it     | an amount, exact or estimated    |
| plain  | reachable only through an equivalence of some product of the line          | an estimate, rounded to packs    |
| grey   | neither                                                                    | no amount, the row shows a figure |

"Litres of meat" is grey, and choosing it is allowed, because refusing it needs a rule about
what meat is. The chip says it will price nothing before the shopper picks it, and the
row says so after.

**Changing the unit resets the quantity to one fine step of the new unit**: 1, 25 g or 50 ml
with the defaults, from the resolved steps. Converting 500 g into "500 units" is worse than a
reset, and the shopper is already holding the reel. The write is one `update` naming both
`measurementUnit` and `quantity`, which backend `0101` section 2 requires together.

**The default is chosen for the shopper.** A line added for a group starts in the group's
`defaultMeasurementUnit`; a line added for a product starts in the product's
`measurementUnit`, and a free text line starts in `UNIT`. `LineService.add` and
`BasketStore.addLine` in data-access read the default off the view they already hold and state
it on the write.

## 9. The delta names the unit

`LineService.addQuantity` in data-access sends the line's unit with every delta (`0101`,
section 3).
A `LINE_UNIT_MISMATCH` (409) is not an error the shopper sees: the line the server holds is
already on its way over realtime, and the client applies the refreshed view and drops the
pending preview, which is what it does for any other refused delta today. The optimistic
reel value is rolled back to the server's.

This plan raises the client floor (`0072`): a velista that sends no unit on a delta is told to
update.

## 10. What this plan does not do

- **No basket total.** There is none today, and adding a sum of amounts, part exact and part
  estimated, is a screen of its own with a place and a scope rule to decide. This plan makes
  each line's amount true and marked, which is what a total will need first.
- **No fractional quantities.** Half a kilogram is five hundred grams. The integer stays.
- **No conversion of prices in the client.** `comparablePrice` arrives converted. The one
  conversion velista performs is of a quantity, through `0102`'s rows, and it is the same
  function the backend states.
- **No change to the group row, the place, the stale flag, or who is allowed to see an origin.**

## 11. Tests

- `quantity.spec.ts` in platform: `formatQuantity` for each unit in both locales, on both
  sides of a thousand, including 1000 as "1 kg" and 12500 as "12,5 kg".
- `line-amount.spec.ts`: one case per row of the backend table, including the rounded pack
  case, the null cases, and that cents arithmetic prints 4,98 where floating point prints 4,97.
- `basket-labels.spec.ts`: `quantityCaption` for a weighed line at one, wanted, partly settled
  and done.
- `basket-line-row.spec.ts`: the three suffix cases of section 4, asserting on the computed
  string and not on rendered text, because the interpolated caption goes through the testing
  translator.
- `settle-sheet.spec.ts`: the cheapest mark on two exact options, on two estimated options, on
  one of each with no mark, and the amount string for a weighed option and for a rounded one.
- `suggestion-list.spec.ts`: a weighed item with a comparable figure and no price quotes it,
  and a packed item without a price still quotes the brand alone.
- `quantity-reel.spec.ts`: the step changes at 1000 in both directions, the label switches
  with it, and every one of the six places moves by the step.
- The chip's spec: the three states, the reset on change, and the single update it sends.
- The mappers' specs: every new field falls back by D4, `BasketProduct.unit` now falls back
  to `UNIT` on an unknown string, and a delta carries the unit.

## 12. Exit criteria

1. A basket line for a product measured in grams shows its price per kilogram on the row and
   its quantity in grams or kilograms, and a packed product's row is pixel for pixel what it
   was.
2. The settle sheet quotes a weighed option's amount with the estimate mark, quotes a rounded
   conversion as a count of packs, and marks nothing cheapest when the priced options differ
   in kind.
3. A weighed product with no pack price appears in the suggestion list with its price per
   kilogram instead of a bare brand.
4. The reel steps by the resolved fine step below a thousand and the coarse step from it, the
   label switches to kilograms and litres at a thousand, and the wire never carries either.
5. A shopper can change a line's unit from a chip that says in advance which units will price,
   the change resets the quantity to one step, and a delta in a stale unit is refused and
   recovered without a visible error.
6. Every amount that is not a count of packs at a pack price carries the estimate mark.
7. Every number is formatted with `Intl` in the reader's locale, and no component reads
   `unitPriceBasis` to compute anything.
8. The 93 per kilogram offers of the El Jamon leaflet, imported under backend `0095` and
   `0096`, are quoted on the row and on the settle sheet.
