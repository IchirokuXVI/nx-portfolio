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
> and backend `0095` and `0096`, which put on the wire the two facts this plan draws: what a
> unit price is per, and what one of a product is.

Backend `0096` settles the arithmetic: the offer carries `lineUnitPrice`, the price of one of
whatever the product is sold by, and the item carries `soldBy`, which is what a line's
quantity counts. This plan is the three readers `0062` built, taught to read those two fields,
and the one place the quantity is typed, taught to say what it is counting. It changes no
route, no store and no wire shape of its own.

| What changes                                            | Where                     |
| ------------------------------------------------------- | ------------------------- |
| The model: two fields on the offer, one on the product  | `models`, `data-access`   |
| The row: the price suffix, and a quantity with a unit   | `basket-line-row`         |
| The settle sheet: the amount, and when to mark cheapest | `settle-sheet`            |
| The suggestion: a unit price when there is no pack one  | `suggestion-list`         |
| The reel and the units sheet: a step and a unit         | `quantity-reel`, `line-units-sheet` |

## 1. The model

`ProductOffer` (`models/src/lib/domain.ts`) gains `lineUnitPrice: number | null` and
`unitPriceBasis: PriceBasis | null`. `CatalogItem` and `BasketProduct` gain
`soldBy: UnitOfMeasure`, mapped from `unknown` with `UNIT` as the fallback, by the rule D4
already applies to `unit`: an unknown string is the default and never a crash, and the enum is
velista's own copy, not the backend's export. `basket-memory.ts` carries the two new offer
fields through the fake the specs use.

Nothing on the model computes. **The till line is `lineUnitPrice` times a quantity, and the
quantity is whichever number the screen is showing**: the outstanding amount on the row, the
live reel value on the units sheet, one on the settle sheet. That is why backend `0096` section
5 leaves the multiplication to the client: the second factor moves under a thumb, and a number
the server computed is stale the moment it does.

One formatter joins `formatMoney`: `formatQuantity(quantity, unit, locale)`, which returns
"2 kg", "500 g", "3 l" or "×2" through `Intl.NumberFormat` with `style: 'unit'`, in the
reader's locale, and never through `DatePipe` or a translation key with a number in it.
`UNIT` and `PACK` keep today's "×N" and `formatQuantity` is where that rule lives too, so no
component decides which form it is drawing.

## 2. The row

`productName` in `basket-line-row.ts` draws `name · price` when the offer has a `price`, and
the name alone otherwise (`0062`, section 4). The rule becomes: **the suffix is the price of one
of what this product is sold by.**

- `soldBy` is `UNIT` or `PACK`: `name · 0,89 €`, exactly as today. `lineUnitPrice` equals
  `price` for these and nothing is drawn differently.
- Anything else, with a `lineUnitPrice`: `name · 9,95 €/kg`. The suffix is `lineUnitPrice`
  formatted as money and the sale unit after a slash, because the number is the price of one
  kilogram and a bare "9,95 €" on a trout reads as the price of a trout, which is the mistake
  backlog `0011` section 4 refused to make in the other direction.
- Anything else, with no `lineUnitPrice`: the name alone. The offer has a figure the server
  failed to convert or no figure at all, and a row that cannot say what one kilogram costs says
  nothing rather than the source's raw number with a label the app does not understand.

The quantity caption (`quantityCaption` in `basket-labels.ts`) reads `soldBy` through
`formatQuantity`. "×2" stays for a pack. A weighed product says "2 kg", and the partly settled
form says "1 kg of 2 kg" with the same formatter on both numbers. The row does **not** draw the
line total. The caption line has room for one number (`0063`, section 6.4), that number is the
price of one, and the total is the settle sheet's, where the shopper is deciding to pay it.

## 3. The settle sheet

The product pane lists a line's options with a price and a place each (`0062`, section 5, and the
pane keeps that shape under `0069`, which changes what the rows do and not what they say).
`options` in `settle-sheet.ts` builds `price` from `offer.price` and `amount` beside it for the
cheapest mark. Both read `lineUnitPrice` now:

- `price` is the string of section 2, `9,95 €/kg` for a weighed option and `0,89 €` for a
  packed one. `unitPrice` on the row, the secondary line that shows the source's own figure with
  its label, stays as it is, because it is still the only place the printed comparison figure is
  shown and `0095` kept the label verbatim for exactly that.
- **The cheapest mark compares `lineUnitPrice` only among options that share a `soldBy`.** A
  line whose options are a tray of trout sold by the piece and loose trout sold by the kilogram
  has two numbers of different meaning, and marking the smaller one cheapest is the comparison
  backend `0095` section 6 forbids the server to make. When the priced options do not all share
  a unit, no mark is drawn, which is the same rule the pane already applies to a single priced
  option: a mark that says nothing looks like a recommendation.
- `noPrice` is unchanged: an option with no `lineUnitPrice` in a pane where another has one
  says it is unknown rather than free.

The amount on a settlement row is `lineUnitPrice` times the quantity being settled, in the
unit the quantity is in, and the sheet's own copy says so once: "2 kg · 19,90 €". A quantity
the reel is still moving multiplies live.

## 4. The suggestion list

`noteOf` in `ui/src/lib/list/suggestion-list.ts` returns the brand alone when the offer has no
`price`, and the brand with the pack price otherwise. A weighed product from a leaflet has no
`price` and is, today, a brand and nothing. The rule becomes the row's: the note quotes
`lineUnitPrice` with the sale unit after it when `soldBy` is not a pack, and stays exactly as it
is for everything else. `0063` section 6.4 stands: the unit price is still not drawn, because
the number drawn is the price of one of the thing the row adds, which is what an item's note
means, and for a weighed product that price happens to be per kilogram.

`bestPriceOf` on a group row is unchanged. The server picks a group's most economical member in
the group's own reference unit (`0095`, section 6), and the row already says "best price" for
exactly the reason that the number is a floor and not a total.

## 5. The reel and the units sheet

`QuantityReel` gains a `step` input, default `1`. The line row and the units sheet pass `100`
for a product sold in `GRAM` or `MILLILITER` and `1` for everything else, so a thumb on ham
moves in hundred gram steps and never has to cross five hundred single grams. The delta on the
wire is still an integer and still one signed number per adjustment (`0054`). The reel's own
label names the unit through `formatQuantity`, so the number under the thumb reads "300 g" and
not "300".

The units sheet's total (`line-units-sheet.ts`), which is what the basket will buy, reads the
same formatter, and the contribution rows under it count in the same unit. Nothing about
origins or contributions changes shape: they are integers in the product's unit, as they were
integers in packs.

## 6. What this plan does not do

- **No basket total.** There is none today, and adding a sum of till lines is a screen of its
  own with a place and a scope rule to decide. This plan makes each line's number true, which
  is what a total will need first.
- **No fractional quantities.** Half a kilogram is five hundred grams, and a product an operator
  wants counted that finely is sold by the gram. The integer stays.
- **No conversion in the client.** `lineUnitPrice` arrives converted. Velista holds no factor
  table and never reads `unitPriceBasis` to do arithmetic. It reads it to say what the source's
  own figure is per, and only where that figure is drawn.
- **No change to the group row, the place, the stale flag, or who is allowed to see an origin.**

## 7. Tests

- `basket-labels.spec.ts`: `formatQuantity` for each `UnitOfMeasure` in both locales, and
  `quantityCaption` for a weighed line wanted, partly settled and done.
- `basket-line-row.spec.ts`: the three suffix cases of section 2, asserting on the computed
  string and not on rendered text, because the interpolated caption goes through the testing
  translator.
- `settle-sheet.spec.ts`: the cheapest mark on two packed options, on two weighed options, and
  on one of each with no mark, and the amount for a weighed option at a quantity of two.
- `suggestion-list.spec.ts`: a weighed item with a `lineUnitPrice` and no `price` quotes it, and
  a packed item without a price still quotes the brand alone.
- `quantity-reel.spec.ts`: a step of 100 moves by 100 and emits one delta.
- The mappers' specs: `soldBy` falls back to `UNIT` on an unknown string and the two offer
  fields map to null when absent.

## 8. Exit criteria

1. A basket line for a product sold by the kilogram shows its price per kilogram on the row and
   its quantity in kilograms, and a packed product's row is pixel for pixel what it was.
2. The settle sheet quotes a weighed option's amount as its per unit price times the quantity,
   and marks nothing cheapest when the priced options are sold in different units.
3. A weighed product with no pack price appears in the suggestion list with its price per
   kilogram instead of a bare brand.
4. The reel steps by a hundred for a product sold by the gram or the millilitre and by one for
   everything else, and the number under the thumb names its unit.
5. Every number is formatted with `Intl` in the reader's locale, and no component reads
   `unitPriceBasis` to compute anything.
6. The 93 per kilogram offers of the El Jamon leaflet, imported under backend `0095` and `0096`,
   are quoted on the row and on the settle sheet.
