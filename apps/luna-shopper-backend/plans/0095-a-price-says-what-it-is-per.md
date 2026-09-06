# 0095 A price says what it is per

A product sold by weight has no pack price. The till charges per kilogram, the leaflet prints
per kilogram, and the receipt agrees per kilogram. `SupermarketItem.price` means what the till
charges for one pack (plan `0038`, section 2.4), so such a product is stored with `price` null,
the per kilogram figure on `unitPrice`, and the source's own words beside it on
`unitPriceLabel`. The basket then quotes nothing for it, because everything that ranks or draws
a price reads `price`.

This is the first of three plans that close that gap. It was backlog `0011`, which measured the
gap, named the real defect and refused four shortcuts. Those findings are restated here where
they decide something, and the backlog file is retired with this plan. The split is by what
each plan adds and by what has to exist before the next one can:

| Plan            | Adds                                                                            |
| --------------- | ------------------------------------------------------------------------------- |
| `0095`, this    | A basis on every price row, stated by the source, and a ranking that honours it |
| `0096`          | A product that says how it is sold, and the till line computed from it          |
| velista `0070`  | The three readers that draw the till line, and the unit on the row              |

Depends on `0080`, because the row this plan widens is `item_prices` and the answer it changes
is materialized by that plan's recompute. Depends on `0086` for the harvest document and the
harvester's own price row, both of which gain the same field.

## 1. How big the gap is

Backlog `0011` measured the El Jamon leaflet in `tmp/leaflet`, valid 27 August to 23 September
2026: 93 of 219 offers are priced per kilogram, 42%. The harvest document produced from the same
leaflet, `tmp/leaflet/eljamon.pdftext.harvest-document.json`, gives the shape the import
actually sees:

| Products | With a `unit_price` block | Per kilogram | Per litre | Per wash | With a `unit_price` and no `price` |
| -------- | ------------------------- | ------------ | --------- | -------- | ---------------------------------- |
| 219      | 151                       | 93           | 55        | 3        | 95                                 |

The last column is the one that matters. 95 products write a unit price and nothing else, and
not all of them are weighed: two are six packs of beer whose tile printed a second unit offer
and no plain price. So "the till price is null" is not a signal that a product is sold by
weight. Plan `0096` is where that signal comes from, and it is a fact about the product, not
about which column happens to be empty.

Plan `0067` met the same shape at the fish counter. Nine of 109 matched receipt lines were
weighed products, and they agreed with the catalog on `unitPrice` and not on `price`. The
reference seed writes them exactly as a leaflet import does
(`catalog/src/app/db/reference/seed-reference-catalog.ts`): `price` null, `unitPrice` set,
`unitPriceLabel` `kg`.

## 2. The defect is that the unit price has no unit

`unitPriceLabel` is text, on purpose. Plan `0038` section 2.4 measured Mercadona's
`reference_format` and found a per litre figure labelled `100 ml`, a per kilogram figure
labelled `100 g`, `lv` for washing machine loads and `dz` for a dozen. The label is a price tag
for a person. That decision was right for that source, and it leaves the figure without a basis
a machine can read, which has two consequences today:

- **Nothing can multiply it.** A till line for two kilograms of ham is `unitPrice` times two
  only if the figure is per kilogram. If it is per 100 g, the line is wrong by a factor of ten.
- **`searchOffers` compares figures of different basis.** The lateral in
  `catalog/src/app/catalog/item.service.ts` orders a group's members by `unitPrice ASC` and
  nothing checks that the members agree on what the number is per. A ham at 9.95 per kilogram
  and a milk at 0.89 per litre compare as 9.95 against 0.89. Inside one group the bases usually
  agree, which is why the ranking looks sane, and nothing enforces it.

The leaflet extractor already knows the basis. Every `unit_price` in the harvest document
carries `extra.printed_unit_price.per`, an enum of `l`, `kg`, `unit`, `wash`, `m`, `100ml`,
`100g`, and by the rule of plan `0086` section 6.1 the `extra` bag is stored, shown and read by
nothing. Mercadona and Carrefour know it too, in their own ways (section 5). The fact exists at
every source and is thrown away at the door.

## 3. `PriceBasis`, a second enum and not a reuse of the first

```ts
/** What a unit price is per (plan 0095, section 3). Never parsed from the label. */
export enum PriceBasis {
  UNIT = 'UNIT',
  KILOGRAM = 'KILOGRAM',
  HUNDRED_GRAMS = 'HUNDRED_GRAMS',
  LITER = 'LITER',
  HUNDRED_MILLILITERS = 'HUNDRED_MILLILITERS',
  WASH = 'WASH',
  METER = 'METER',
}
```

It is not `UnitOfMeasure`, for three reasons that each rule out the reuse on its own:

1. `UnitOfMeasure` says what a product's size is counted in: `1` with `LITER` is a one litre
   carton. `PriceBasis` says what a printed figure is per. A washing machine load is a basis
   and is not a size, and `PACK` is a size and is not a basis.
2. `m` is deliberately not a `UnitOfMeasure`: plan `0038` refused to add a value to a wire enum
   every service shares for two rolls of cling film. A per metre figure is an ordinary basis
   with nothing to convert to, and `METER` here costs no other service anything.
3. **`HUNDRED_GRAMS` and `HUNDRED_MILLILITERS` exist because of the verbatim rule.** A leaflet
   prints "el 100 g le sale a 1,29 €". Storing 12.90 per kilogram is a recomputation of the
   source's figure, which `0038` section 2.4 forbids and `0080` restates. The basis is recorded
   as printed and the conversion happens on read, where it is arithmetic on a stored fact and
   not a rewrite of one.

The field is `unitPriceBasis: PriceBasis | null`, beside `unitPriceLabel` and never instead of
it. Null means the source did not say, and **null is never filled in from the label**. Backlog
`0011` section 4 rejected that parser with the evidence of section 2: a parser that reads
`100 ml` as per 100 ml multiplies a per litre price by ten.

### 3.1 The conversion, stated once

```ts
/** Multiply a figure per `basis` to get a figure per `unit`, or null when the pair has no answer. */
export function priceBasisFactor(basis: PriceBasis, unit: UnitOfMeasure): number | null;
```

The table is small and closed:

| Basis                 | `KILOGRAM` | `GRAM` | `LITER` | `MILLILITER` | `UNIT` | `PACK` |
| --------------------- | ---------- | ------ | ------- | ------------ | ------ | ------ |
| `KILOGRAM`            | 1          | 0.001  |         |              |        |        |
| `HUNDRED_GRAMS`       | 10         | 0.01   |         |              |        |        |
| `LITER`               |            |        | 1       | 0.001        |        |        |
| `HUNDRED_MILLILITERS` |            |        | 10      | 0.01         |        |        |
| `UNIT`                |            |        |         |              | 1      |        |
| `WASH`, `METER`       |            |        |         |              |        |        |

An empty cell is null. `UNIT` to `PACK` is null on purpose: a per piece figure says nothing
about a pack until somebody counts the pieces, and this table invents no count. `WASH` and
`METER` convert to nothing because no `UnitOfMeasure` names them. A detergent group whose
members are priced per wash ranks them as unconvertible (section 6), which is the honest
answer and was not the answer before.

It lives in `libs/luna-shopper/contracts` beside the enum, framework free, with a spec over
every pair. The same table exists once more as a SQL function (section 6), and a catalog
integration spec asserts the two agree on every pair, so the table cannot drift between the
ranking and a client.

## 4. Where the field goes

One column, `"unitPriceBasis" price_basis NULL`, on three tables, and one field on every view
and write that already carries `unitPriceLabel`:

| Owner     | Table or type                                                 | Written by                                      |
| --------- | ------------------------------------------------------------- | ----------------------------------------------- |
| catalog   | `item_prices`                                                 | `item-price-writer.ts`, every source            |
| catalog   | `supermarket_items`                                           | `applyEffective` in `effective-price.service.ts` |
| harvester | `source_entry_prices`                                         | `source-ingest.ts`                              |
| contracts | `ItemPriceView`, `SupermarketItemView`, `ItemOfferView`       | the mappers                                     |
| contracts | `ItemPriceValues`, harvester's `CatalogEntryPrice`            | the callers                                     |
| contracts | `HarvestDocumentUnitPrice.per`, schema version 2 (section 5.1) | the producer                                    |

Two migrations, `PriceBasis1757100000000` in catalog and its twin in the harvester, add the
enum type and the column and **backfill nothing**. Every existing row keeps a null basis until
its source states one, which for a storefront is the next crawl (section 4.1) and for a leaflet
is the next import. A backfill from `unitPriceLabel` is the parser section 3 refused. A backfill
from `items.unitSize` is the Mercadona derivation of section 5.2 and belongs to the source that
knows when it holds, not to a migration that sees a row and a size.

### 4.1 A confirming observation fills a missing basis in

`item-price-writer.ts` judges a repeat by comparing `price`, `unitPrice` and `unitPriceLabel`
with the held row. `unitPriceBasis` joins that comparison with one asymmetry: **a held row with
a null basis and an observation that states one are the same price, and the write fills the
basis in.** The figure did not change, the row got more precise, and inserting a second
interval for a fact the first one already carried puts a price change in the history where
none happened. A held basis that disagrees with the observation is a different price and inserts
a row as any change does. A source that changes its mind about what its figure is per has
changed the figure.

The materialized row follows: `applyEffective` copies the basis beside the label and adds it to
the `same` comparison, and the sweep needs nothing new because the basis never moves with the
clock. The `ADMIN` row's override snapshot (`ItemPriceOverride`) does not gain it: the protection
test of `0080` section 4.2 compares figures, and a basis that changed alone is a row that
changed alone, which the figure comparison already sees.

## 5. Every source states its own basis

The rule is the one `0080` set for the figure itself: the source says, the harvester carries,
catalog stores. No layer derives a basis another layer did not state, and the four sources below
state it in four different ways.

### 5.1 The harvest document, schema version 2

`HarvestDocumentUnitPrice` gains `per`, optional, one of the extractor's own words: `unit`, `kg`,
`100g`, `l`, `100ml`, `wash`, `m`. The vocabulary is the extractor's rather than the enum's
because the document is written by producers who never see the enum (plan `0086`, section 6.1),
and a producer that prints what the leaflet printed is a producer that does not translate. The
import maps the word to the enum and nothing else does. The `leaflet.schema.json` in
`tmp/leaflet` already has this exact list under `unit_price.per`, so the producers that exist
today change one key: the value moves from `extra.printed_unit_price.per` to `unit_price.per`.

It is version 2 because the registry (`harvest-document-registry.ts`) is built for exactly this:
a new file, a new `$id`, one more entry, and version 1 stays readable and writes a null basis.
The two checked in fixture documents in `contracts/src/schemas/harvest-document/__fixtures__`
gain a version 2 sibling each. `harvest.export` writes version 2 and fills `per` from the row's
basis where it has one.

The importer (`file-import.runner.ts`, `priceOf`) passes the basis into `SourceObservation.price`
and the ingest writes it to `source_entry_prices`. An accepted entry carries it to catalog on
`CatalogEntryPrice`, through `source-entry.service.ts`, the same path the label takes today.

### 5.2 Mercadona derives it, for the products where the derivation is proven

Plan `0038` section 2.4 measured `bulk_price` against `unit_price / unit_size`: equal on 3,760 of
4,232 products, equal to `unit_price / total_units` on 326 more, and inconsistent with the
product's own stated size on 110. For the 3,760 the chain's own arithmetic says what the figure
is per: one `size_format`, which `units.ts` already maps (`kg`, `l`, `ud`). So
`@portfolio/luna-shopper/mercadona` gains a pure `unitPriceBasisOf(price)` that answers
`KILOGRAM`, `LITER` or `UNIT` **only when `bulk_price` equals `unit_price / unit_size` to the
cent**, and null for every other product, including the 326 whose basis is per piece of a pack
and the 110 that agree with nothing. `bulk_price` itself is still stored verbatim. This reads it
and never writes it. `reference_format` is not consulted. Fixture tests name a product from each
of the three populations.

### 5.3 Carrefour reads it off the card

The card states `measure_unit` and the figure in two fields, and `price.ts` builds the label
`€/kg` from the unit because the storefront shows one. The unit is the basis stated outright:
`kg`, `l` and `ud` over the whole fixture set, in the same three families `listing.ts` already
checks the size against. `unitPriceBasisOf(measureUnit)` maps those three and answers null for
anything else, and the runner passes it through beside the label.

### 5.4 The reference seed and a typed price

The seed passes `KILOGRAM` where it writes `kg` and `UNIT` where it writes `ud`, so the fish
counter of `0067` is the first data to carry a basis. The admin's price form (`prices.ts` in
`luna-shopper-admin/feature-catalog`) gains a `unitPriceBasis` picker beside the label field.
The label stays a text field that is typed and never derived, exactly as its docblock says, and
the picker is the one place the operator states the basis in words the machine reads. The price
detail page and the history show it. `ItemPriceValues` on the gateway validates it as the enum,
the OpenAPI document and the wire types regenerate, and no other admin screen changes.

DEZA writes no price and states nothing.

## 6. `searchOffers` never compares two unit prices of different basis

A product group declares the unit its members are compared in: `referenceUnit`, a
`UnitOfMeasure`, which backlog `0001` section 3.3 designed for exactly this comparison and
which nothing used until now because no row converted to it. Now one does. The
lateral that picks a group's cheapest member orders by

```sql
si."unitPrice" * price_basis_factor(si."unitPriceBasis", g."referenceUnit") ASC NULLS LAST
```

where `price_basis_factor(price_basis, unit_of_measure) RETURNS numeric` is an `IMMUTABLE` SQL
function the catalog migration creates, with section 3.1's table as its body and null for every
empty cell. A member whose basis is null or does not convert to the group's unit sorts last,
after every member that does, and is never compared with one. A group in which no member
converts answers its cheapest member by `price`, as it does today, and the offer view says why:
`ItemOfferView.unitPriceBasis` travels, so a client can see that the figure it was handed is per
wash.

The item search (`rankedItems`) keeps unit price as its last ranking key, after relevance and
the exact match, and normalizes it the same way to the family of the item's own `defaultUnit`
(`KILOGRAM` for a product sized in grams or kilograms, `LITER` for millilitres or litres, `UNIT`
otherwise). Two hits of different families still meet on that key, and that is accepted and
written down: it is a tie break of last resort between products nobody declared comparable,
and the read that makes a comparison mean something is the group read above.

## 7. What this plan does not do

- **It does not change what `getMany` ranks by.** The basket read still picks the cheapest
  `price`, for the six pack reason `0066` section 2.1 gave. Plan `0096` changes that, and only
  once the product itself says which rule applies to it.
- **It writes no till line.** A per kilogram figure with a basis is a fact that can be
  multiplied. What to multiply it by is `0096`.
- **It draws nothing.** Velista `0070` reads `unitPriceBasis` off the offer. Until then the
  three readers are unchanged and a weighed product is exactly as blank as it is today.
- **It parses no label and backfills no row.** Section 3 and section 4.

## 8. Testing

- `priceBasisFactor` has a spec over every pair in the table, including every null cell, and
  the catalog integration suite asserts `price_basis_factor` agrees with it on every pair.
- `item-price-writer.spec.ts` gains the three cases of 4.1: a null basis filled in by a
  confirming observation with no new row, a differing basis inserting a row, and an observation
  with no basis leaving a held one alone.
- `effective-price.spec.ts` asserts the basis reaches `supermarket_items` and that a basis
  change alone marks the row as moved.
- `item-prices.integration.spec.ts` gains a group with a per kilogram member, a per 100 g member
  and a per wash member, and asserts the per 100 g member wins when it is cheaper per kilogram
  and the per wash member is last whatever its figure.
- The harvest document spec validates a version 2 document with every `per` value, refuses an
  unknown one at the schema, and reads a version 1 document to a null basis.
- The Mercadona and Carrefour libraries test their `unitPriceBasisOf` against checked in
  fixtures, with no network, as their constraint requires.
- `npx nx run luna-shopper-backend-gateway:openapi` and `luna-shopper-admin/models:wire-types`
  are run and committed.

## 9. Exit criteria

1. `PriceBasis` is in `@portfolio/luna-shopper/contracts`, and `unitPriceBasis` travels on every
   view and write that carries `unitPriceLabel`, with the label still stored verbatim beside it.
2. A leaflet import of a version 2 document writes the printed basis to `source_entry_prices`,
   and accepting the entry writes it to `item_prices` and onto the materialized row.
3. A Mercadona crawl writes a basis for exactly the products where `bulk_price` equals
   `unit_price / unit_size`, and null for the rest.
4. A Carrefour crawl writes the card's `measure_unit` as the basis.
5. `searchOffers` orders a group's members by unit price converted to `referenceUnit`, and a
   member that cannot convert sorts after every member that can.
6. No row's basis is ever set from `unitPriceLabel`, by migration or by code.
7. The OpenAPI document and the wire types are regenerated and committed.
