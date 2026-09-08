# 0096 A product says how it is sold

Plan `0095` gave every unit price a basis, so a per kilogram figure is now a number a machine
can multiply. This plan says what to multiply it by, and it says it on the product: a trout is
sold by the kilogram, a carton of milk by the pack, and the shop decided that, not the shopper
and not the columns that happen to be null on a price row.

With that one fact the two open questions of backlog `0011` section 3 close at once. **What a
line's quantity means**: a count in the product's own unit, so "two" of a trout is two
kilograms and "two" of a carton is two cartons, and `LineView.quantity` changes neither its type
nor its bounds. **What `getMany` ranks by**: the price of one of those, which is the till price
for a product sold by the pack and the converted unit price for everything else, and never a
rule chosen by looking at which column is empty.

Depends on `0095` for `unitPriceBasis` and `priceBasisFactor`, without which nothing here can
convert a figure. Velista `0070` is the screen that reads what this plan writes.

## 1. The line's quantity has no unit, and the item can give it one

`LineView.quantity` (`contracts/src/lib/messages/list.messages.ts`) is an integer between
`LINE_QUANTITY_MIN` and `LINE_QUANTITY_MAX`, a count of things, and the delta writes of plan
`0057` compute the resulting count inside core. Every screen draws it as "×2". For a product
sold by the pack that is right and complete. For a weighed product the number is meaningless
until something says what one of it is, and backlog `0011` weighed the two places that fact
can live:

- **On the line.** Every line carries a unit, every write states one, the reel offers one, and
  two lines for the same trout in two lists can disagree about whether they are counting
  kilograms or fish.
- **On the item.** The product says how the shop sells it, every line inherits that, and no
  write anywhere changes shape.

The item is right, and cheaper, and the reason is not the cost: **the shop decides how a product
is sold**, and a shopper who wants trout by the piece from a counter that sells it by weight is
not a case the app can serve by letting the line say "piece".

## 2. `soldBy`

```ts
export interface ItemView {
  // ...
  /**
   * What one of this product is at the till, and therefore what a line's
   * quantity counts (plan 0096, section 2). `UNIT` for anything sold by the
   * pack or the piece, which is every product until somebody says otherwise.
   */
  soldBy: UnitOfMeasure;
}
```

A column on `items`, `"soldBy" unit_of_measure NOT NULL DEFAULT 'UNIT'`, in migration
`ItemSoldBy1757200000000`. It is a `UnitOfMeasure` and not a `PriceBasis`, because it names what
a quantity counts, which is a size, and `HUNDRED_GRAMS` is a way of printing a price and not a
way of buying ham. `UNIT` and `PACK` mean the same thing here, a count of the thing on the
shelf, and both price by `price`. `GRAM` and `MILLILITER` are allowed and are what make a
quantity of five hundred grams expressible with an integer: `LINE_QUANTITY_MAX` is 100,000,
which is a hundred kilograms of anything, and no bound moves.

It is not `defaultUnit`, which backlog `0011` proposed reusing. `defaultUnit` with `unitSize`
says what one pack contains, `1` with `LITER`, and a 1 L carton is sold by the pack. The two
facts coincide on a weighed product and on nothing else, and overloading the size field with
the sale rule breaks the milk in order to fix the trout.

### 2.1 Who sets it

- **An operator**, on the item form in the back office. The picker is the `UnitOfMeasure` enum
  and the default is `UNIT`.
- **A source, on a product it creates and never on one that exists.** Harvest document version
  2 (`0095`, section 5.1) gains an optional `sold_by` on the product, in the extractor's own
  words as `unit_price.per` is: `unit`, `kg`, `g`, `l`, `ml`. A leaflet tile whose advertised
  price has `basis` `kg` is a tile for a product sold by weight, and the producer says so. An
  accepted entry that **creates** an item passes it through `item.create`. An entry resolved to
  an item catalog already holds leaves `soldBy` alone and adds a warning to the run when the two
  disagree, so the operator sees it in the queue and the source cannot flip a rule the operator
  set.
- **The reference seed**, which sets `KILOGRAM` on the items it prices per kilogram, so the
  fish counter of `0067` is priced in a basket the day this lands.
- **No storefront adapter.** Mercadona, Carrefour and LIDL sell a weighed product as a piece or
  a tray with a pack price, and `UNIT` is right for all of them. An adapter that later meets a
  chain selling loose by weight states it in the document and nowhere else.

An existing item is `UNIT`, so every basket prices exactly as it does today until an operator
or a leaflet says otherwise.

## 3. The price of one of those

The offer gains the number a line multiplies:

```ts
export interface ItemOfferView {
  // ...
  /**
   * What one `soldBy` of the product costs at this scope (plan 0096, section 3):
   * `price` for a product sold by the pack, the unit price converted to `soldBy`
   * for anything else, and null when the row cannot say.
   */
  lineUnitPrice: number | null;
}
```

It is computed in catalog and **materialized** on `supermarket_items` as `lineUnitPrice`,
beside the columns `0080` already materializes, by the same `applyEffective` and for the same
reason: search and the basket read sort by it, and a sort key has to be a column. The rule is
one expression:

```
soldBy in (UNIT, PACK)  ->  price
otherwise               ->  unitPrice * priceBasisFactor(unitPriceBasis, soldBy)
```

with `priceBasisFactor` the table of `0095` section 3.1, null when the basis is null or the pair
has no answer. A product sold by the kilogram whose only price row is per 100 g gets its figure
times ten. A product sold by the kilogram whose only row is a pack price gets null, because a
pack price says nothing about a kilogram, and null is what a client is told rather than a
number the app invented (backlog `0011`, section 4).

**The verbatim rule holds.** `unitPrice` is still the source's own figure and is never
recomputed. `lineUnitPrice` is a derived column with a stated derivation, like `stale` and
`nextBoundaryAt`, and it is recomputed whenever its inputs move:

- inside the write that changed the effective row, as every other materialized column is,
  and
- when an item's `soldBy` changes, which recomputes every `supermarket_items` row of that item
  in the same transaction, so a product switched to weight is priced by weight in the same
  request.

`SupermarketItemView` gains it too, because it is the view of the materialized row and the row
carries it. `ItemPriceView` does not: it is one source's statement, and a derived number does
not belong on it.

## 4. `getMany` ranks by the item's rule

`offersFor` in `item.service.ts`, called with `'price'` for `getMany` since `0066`, orders by
`lineUnitPrice ASC NULLS LAST`, then `price`, then `unitPrice`, for the rows of the caller's
scopes. The first key is the product's own rule and the two behind it are for determinism among
rows the first key cannot separate, as they are today. For a `UNIT` product the order is exactly
`0066`'s, so the six pack argument stands: a product sold by the pack is ranked by what the
till charges for a pack, and this plan makes no recommendation per litre on it.

For a `KILOGRAM` product the order is the converted unit price, and a row of a basis that
cannot convert sorts after every row that can. Two rows for one item with different bases are
not compared. The one that converts wins and the other is what `0095` section 6 already calls
unconvertible. A row whose basis is null sorts with them, and the run report of the next crawl
is where a basis is expected to appear.

`search` and `searchOffers` are `0095`'s and do not change: the group read compares in the
group's `referenceUnit`, which is the right unit for "which milk is cheaper" and is not the
unit a line counts.

## 5. What the gateway and core do

Nothing new, and that is worth writing down. `productsOf` in
`generated-list-sharing.controller.ts` already asks `item.getMany` for the run's scopes and
hands the offers to the client. The offer now carries `lineUnitPrice` and `unitPriceBasis`, and
the item carries `soldBy`. Core stores an integer quantity, computes deltas on it and knows
nothing about units, which was true before and stays true, because the unit is the item's and
the item is catalog's. The assistant reads no price and is untouched.

The till line itself, `lineUnitPrice` times the outstanding quantity, is computed where it is
drawn, and not returned by the server. Velista `0070` says why: it is one multiplication whose
second factor changes under a thumb on a reel, and a server number is stale the moment the reel
moves.

## 6. The back office

The item form gains the `soldBy` picker. The item detail page shows it. The price list on an
item shows `lineUnitPrice` as a read only column beside `price` and `unitPrice`, so an operator
who set a product to weight can see what the basket will quote for it and, when the column is
blank, that no row of that product has a basis yet. The OpenAPI document and the wire types
regenerate.

## 7. Testing

- `item-get-many-pricing.spec.ts` gains a `KILOGRAM` item with a per 100 g row and a per
  kilogram row in two scopes, and asserts the cheaper converted figure wins, a `UNIT` item with
  the same rows still ranks by `price`, and a `KILOGRAM` item with only a pack price answers a
  null `lineUnitPrice` and an offer that still travels.
- `effective-price.spec.ts` asserts `lineUnitPrice` is written from the effective row and from
  the item's `soldBy`, and that a `soldBy` change recomputes every scope of the item.
- The item service spec asserts `soldBy` defaults to `UNIT` on create and is validated as the
  enum on update.
- The file import runner spec asserts a created item receives the document's `sold_by`, and
  that a resolved item keeps its own and the run carries the warning.
- The reference seed's own check asserts the per kilogram items are `KILOGRAM` and carry a
  `lineUnitPrice` after the seed runs.

## 8. Exit criteria

1. `items.soldBy` exists, defaults to `UNIT`, is editable in the back office and is set by a
   leaflet import on the items it creates.
2. `ItemOfferView.lineUnitPrice` is `price` for a `UNIT` or `PACK` product and the unit price
   converted to `soldBy` for any other, materialized and recomputed with the row and with the
   item.
3. `getMany` ranks every product by `lineUnitPrice` first, and a row whose basis cannot convert
   never beats one whose basis can.
4. Every product the reference seed prices per kilogram has a `lineUnitPrice` in a basket read.
5. The 93 per kilogram offers of the El Jamon leaflet carry a `lineUnitPrice` after a version 2
   import that states `sold_by` for them, and a basket that holds one is quoted a till line by
   velista `0070`.
6. No `supermarket_items` column is written except through the `0080` recompute, and
   `unitPrice` is unchanged on every row.
7. The OpenAPI document and the wire types are regenerated and committed.
