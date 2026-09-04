# 0011 (backlog) A price per kilogram has no place at the till line

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

A product sold by weight has no pack price. `SupermarketItem.price` means what the till charges
for one pack (plan `0038` section 2.4). So a price printed per kilogram or per litre is stored on
`unitPrice`, with the source's label beside it, and `price` stays null. The basket then quotes
nothing for that product, because `bestOffer` ranks and displays `price`.

The owner accepted that as a known limitation of the leaflet import. He asked for the design that
removes it to be written down here rather than built. This plan is that design. It commits to no
build order.

## 1. How big the gap is

Measured on the El Jamon leaflet in `tmp/leaflet`, valid 27 August to 23 September 2026:

| Output | Offers | Per kilogram | Per litre | Per unit or pack |
| --- | --- | --- | --- | --- |
| `eljamon.pdftext.json` | 219 | 93 | 0 | 126 |
| `eljamon.vision.json` (four sampled pages) | 48 | 11 | 0 | 37 |

**93 of 219 offers, 42%, are priced per kilogram.** The butcher, the fish counter, the deli and
the greengrocer are the pages a leaflet leads with, and all of them sell by weight.

Plan `0067` met the same shape at the fish counter. Of the 109 receipt lines it matched to
harvested products, 100 agreed to the cent on `price`. The nine that did not were weighed
products, where the receipt figure is per kilogram and the catalog's `price` is for one fish. They
agreed against `unitPrice`. The seed writes them exactly as the leaflet import will
(`catalog/src/app/db/reference/seed-reference-catalog.ts`, lines 352 to 360): `price` null,
`unitPrice` set, `unitPriceLabel: 'kg'`.

## 2. Why `bestOffer` cannot rank it

`offersFor` in `catalog/src/app/catalog/item.service.ts`, lines 561 to 590, picks one row per item
across the caller's scopes. For `getMany`, which is the basket read, it orders by `price ASC NULLS LAST`
and then `unitPrice` (plan `0066` section 2.1). A weighed product with prices in two scopes keeps
the row that has a `price`. A weighed product priced only per kilogram keeps a row whose `price`
is null. The offer travels, `bestOffer.price` is null, and every velista reader draws nothing:

- `feature-shopping-lists/.../basket-line-row.ts`, lines 492 to 494, reads `offer.price` and
  `offer.currency` for the caption.
- `feature-shopping-lists/.../settle-sheet.ts`, lines 395 to 414, reads `offer.price` for the
  amount and shows `unitPrice` only as a secondary line.
- `ui/src/lib/list/suggestion-list.ts`, lines 227 to 231 and 263 to 271, reads `offer.price`.

`searchOffers`, lines 365 to 374 and 425, ranks group members by `unitPrice` first. That looks
like the answer, and it is not, for the reason in section 3.

## 3. The real defect is that the unit price has no unit

`unitPriceLabel` is text, on purpose. Plan `0038` section 2.4 measured Mercadona's
`reference_format`. It found a per litre number labelled `100 ml` and a per kilogram number
labelled `100 g`. It found `lv` for washing machine loads and `dz` for a dozen. The label is a
price tag for a person and cannot be parsed into a unit. That decision was right for that source
and it leaves the number without a basis a machine can read.

So `searchOffers` orders `unitPrice ASC` across rows whose bases differ. A ham at 9.95 per
kilogram and a milk at 0.89 per litre compare as 9.95 against 0.89. Inside one product group the
bases usually agree. That is why the ranking looks sane, and nothing enforces it.

Three facts have to exist before a weighed product can be priced in a basket, and none of them
does:

1. **A basis on the price row.** Not instead of the label, beside it. `priceBasis`, an enum:
   `PACK`, `KILOGRAM`, `LITER`, `UNIT`, `WASH`, `METER`. Set only by a source that states it. A
   leaflet states it: `pricing.basis` is an enum in `tmp/leaflet/leaflet.schema.json`, lines 404
   to 413, and `unit_price.per` at lines 440 to 449 is one too. A receipt states it per line. For
   Mercadona the basis is derivable from `size_format` and `unit_size` on 3,760 of 4,232
   products, the ones where `bulk_price` equals `unit_price / unit_size`. The plan that builds
   this sets it for exactly those and leaves the other 472 null. `bulk_price` itself is still
   stored verbatim and never recomputed.
2. **A unit on the quantity a person asks for.** `LineView.quantity` (`contracts/src/lib/messages/list.messages.ts`,
   line 240) is a count of things. "Two" of a weighed product means two kilograms, two packs or
   two fish, and the line cannot say which. Either the line carries a unit, or the item declares
   one. The item's `defaultUnit` (`items.defaultUnit`, `UnitOfMeasure` in `catalog.enums.ts`
   lines 8 to 15) states that its quantity is in kilograms, and the line inherits it. The second
   is cheaper and is probably right: the shop decides how a product is sold, not the shopper.
3. **A ranking rule the item chooses.** `offersFor` ranks by `price` for a product sold by pack
   and by `unitPrice` for a product sold by weight. The item's `defaultUnit` makes that choice,
   never the columns that happen to be null. Two rows of different basis for one item are a data
   error and are reported, not compared.

With those three, the till line is `unitPrice` times the quantity in the item's unit. The row
caption reads "9.95 EUR/kg". The settle sheet's amount is the same arithmetic. The group ranking
of backlog `0001` section 3.3 and backlog `0004` section 2 is by unit price normalized to the
group's `referenceUnit`. It becomes possible for the first time, because a basis can be converted
and a label cannot.

## 4. What is rejected

- **Writing the per kilogram number into `price`.** Plan `0067` refused it at the fish counter:
  it claims a pack price nobody paid. A basket of two fish at "7.95" is wrong by the weight of a
  fish.
- **Deriving a pack price from a typical weight.** There is no typical weight of a trout. A
  number the app invented is worse than a blank, because a person acts on it.
- **Parsing `unitPriceLabel`.** Section 3 is the evidence. The label lies about its basis on
  hundreds of Mercadona products. A parser that reads `100 ml` as per 100 ml multiplies a per
  litre price by ten.
- **Ranking `getMany` by `unitPrice` now, as a half step.** Plan `0066` section 2.1 rejected it
  with the six pack argument: cheaper per litre and dearer at the till is a recommendation, and
  the basket must not make one without a basis to justify it.

## 5. Why it is parked

The leaflet import and the price model ship with the limitation stated plainly. A weighed product
carries a unit price and no till price. The row shows the unit price with its label. The basket
total leaves it out. That is honest, and it matches what the fish counter does since plan `0067`.

The fix crosses five boundaries. It needs a contract enum. It needs a catalog column and a
ranking rule. It needs a core line unit or an item default. It needs three velista readers
changed, and two source libraries that state a basis. It is a plan of its own. Schedule it once a basket with a butcher's tray in it is a screen
somebody is looking at, not before.

## 6. Exit criteria, for whoever picks it up

- A price row states its basis as an enum wherever the source states one, and the verbatim label
  is still stored beside it.
- A weighed product in a basket shows a till line, computed from its unit price and the quantity
  in the item's unit. The row says which unit that is.
- `getMany` ranks a product by `price` or by `unitPrice` according to the item, never according
  to which column is null.
- The 93 per kilogram offers of the El Jamon leaflet are priced in a basket after import.
- `searchOffers` never compares two unit prices of different basis.
