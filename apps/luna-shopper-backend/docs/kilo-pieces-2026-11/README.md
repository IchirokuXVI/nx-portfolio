# Mercadona pieces sold by approximate weight, read on 2026-11-03

This is the evidence for backend plan `0244`, velista plan `0179` and back office plan `0068`.
Every number here was read on 2026-11-03. Production was read with SELECT only (`luna_catalog`
and the harvester database, each in a read only transaction). Mercadona was read with GET only
on its public product API (`https://tienda.mercadona.es/api/products/<id>/`), one request every
two seconds (the source row allows 4 a second). Nothing was written anywhere.

## 1. The cheese that started it

Mercadona product 50985, "Queso viejo tostado mezcla Hacendado", answers `approx_size: true`,
`unit_size: 1.56`, `size_format: "kg"`, `unit_price: "20.94"` (the piece) and
`bulk_price: "13.42"` (a kilo). Production product `eb09e84e-d11f-4bf3-acf2-aa5eee75fbc7` holds
`unitSize` 1560 and `defaultUnit` GRAM, and every price row holds 13.42 with the label `kg`.
velista thus reads it as 1560 g for 13.42 €. The piece is shown 7.52 € too low, and the price
per kilo it implies is 8.60 € instead of 13.42 €.

### 1.1 Why it still has a size

The catalog audit of the product (`catalog_audit` with `entityId` = the product) has one row,
the creation:

| at (UTC) | action | actor | written |
| --- | --- | --- | --- |
| 2026-10-03 12:57:21 | CREATE | SERVICE | `unitSize` 1560, `defaultUnit` GRAM, `ean` 8480000509857 |

Its sibling, the 395 g piece of the same cheese (`470b5e94-b84f-469d-be43-5937141c440e`, in
store code `2105600509712`), was created in the same statement and then corrected by a person:

| at (UTC) | action | actor | before | after |
| --- | --- | --- | --- | --- |
| 2026-10-03 12:57:21 | CREATE | SERVICE | | `unitSize` 395, GRAM, `ean` 2105600509712 |
| 2026-10-03 18:37:14 | UPDATE | ADMIN | 395 GRAM | null KILOGRAM |
| 2026-10-05 22:51:31 | UPDATE | ADMIN | `ean` 2105600509712 | `ean` null |

The cause has three parts, and each one is needed.

1. **The product is older than plan `0181`.** The October curation created the first catalog
   on local slot 1 on 2026-10-03. Mercadona's `unit_size` of 1.56 kg became 1560 GRAM through
   the base unit rule. Plan `0181` (PR #611) was merged on 2026-10-04.
2. **The October repair of weighed products missed it.** That repair selected products by an
   in store barcode: "Mercadona's public product API was read for the 212 linked rows with an
   in-store barcode" (`apps/luna-shopper-backend/docs/initial-catalog-2026-10.md:393`). The
   395 g piece has `2105600509712`, and a person converted it at 18:37. The 1.56 kg piece has a
   normal GTIN, `8480000509857`, so the selection never saw it. Plan `0186` stage A3 converted
   only sized `KILOGRAM` and `LITER` products, and this one was already GRAM.
3. **No later write changes the size of a bound product.** The harvester talks to catalog
   through `harvester/src/app/harvest/catalog-client.service.ts`. It creates products
   (`ITEM_PATTERNS.create` at line 378, `createMany` at line 389) and fills empty fields
   (`fillPackCounts` at line 401, `teachEans` at line 416). It has no call that changes a size
   or a unit. The size and the unit are decided only at creation (`source-entry-size.ts:54`,
   `createdSize`). Each later run clears the size of the queue row and sets `soldByWeight`
   (`source-ingest.ts:1050` to `1056`), and the price it writes is the price of a kilo
   (`libs/luna-shopper/mercadona/src/lib/normalize.ts:89` to `91`, `readPrice` at line 195).
   The product keeps the size that the curation gave it. The snapshots of the slot 1 repair in
   `.curation-runs/2026-10-audit-repair/` (main checkout, not in git) show 1560 GRAM at every
   step from 2026-10-05 23:49 to the last dump. The production restore of k8s plan `0012`
   carried it unchanged.

Plan `0237` section 3.3 does not catch it. `requireBaseUnit`
(`catalog/src/app/catalog/item.service.ts:3729`) refuses a size on `KILOGRAM`, and this product
is GRAM.

## 2. The 130 products

The count: products with `defaultUnit` GRAM, a `unitSize` other than 1000, and an effective
price whose `price` equals its `unitPrice` with the label `kg`. All 130 are Mercadona products.
Each one has exactly one ACTIVE Mercadona queue row, and every one of those rows says
`soldByWeight: true`. The harvester thus already knows that each is sold by the kilo. Only the
catalog product is stale.

Each row was then read live: first from the default warehouse, then from the three warehouses
that production walks (4661, 3769 and 4694) when the default answered 404.

| Kind | Count |
| --- | ---: |
| A. Approximate weight piece, stored weight equals the live weight | 104 |
| B. Approximate weight piece, the live weight moved | 18 |
| C. 404 in all three warehouses, the queue row last said sold by weight | 8 |
| Fixed pack with the same numbers by chance | 0 |

For the 122 live pieces, the stored price per kilo equals the live `bulk_price` for 120. The
live `unit_price` equals `round(bulk_price × unit_size, 2)` for 121. The one exception is
58154, "Paleta de cebo ibérica 50%". It prints 5 kg at 18.75 €/kg and a piece of 75.00 €, and
the formula gives 93.75 €.

Today the app shows the price of a kilo as the price of the piece. That is too high for every
piece under a kilo (114 products) and too low for every piece over a kilo (8 products, the
cheese among them).

### 2.1 Products next to the 130

- **83 Mercadona products of 1000 GRAM** have a price equal to their price per kilo, and every
  queue row says `soldByWeight: false`. They are real one kilo packs, and they are correct.
- **1 Mercadona product of 1000 GRAM is a piece.** 58488, "Salchichón de bellota ibérico"
  (`ef99e6dd`), has a queue row sold by weight and answers 404 today. The count missed it only
  because its size is 1000. Plan `0244` treats it as one of the pieces.
- **2 Mercadona products are UNIT with the label `kg`.** 72514 and 72515, the Bosque Verde
  dehumidifier set and refill, are `1 ud` at 3.15 € and 2.00 € live. This is a label defect of
  the kind plan `0189` fixed, not a weight defect. Plan `0244` does not touch it.
- **185 Mercadona products are already `KILOGRAM` with no size.** These are the pieces that
  the October repair converted. They are kind 2 too, with no weight stored. velista thus shows
  their price per kilo as if it were the price of the piece.
- **Six products hold two Mercadona pieces each** (the October merge of pairs):

  | Product | Pieces (Mercadona id: weight, €/kg, piece €) | Shown €/kg |
  | --- | --- | ---: |
  | Queso tierno mezcla (`0f8741ab`) | 50917: 0.35 kg, 8.95, 3.13. 50919: 1.22 kg, 8.70, 10.61 | 8.70 |
  | Queso semicurado mezcla (`6153b544`) | 50943: 0.42 kg, 9.70, 4.07. 50946: 1.54 kg, 9.41, 14.49 | 9.41 |
  | Alas partidas de pollo (`714bafec`) | 2785: 0.6 kg, 5.20, 3.12. 4195: 404 | 5.10 |
  | Caña de lomo de cebo ibérico (`60470de7`) | 58166: 0.5 kg, 47.50, 23.75. 58260: 404 | 47.50 |
  | Chorizo cular ibérico extra (`7dd0c020`) | 58160: 0.5 kg, 17.00, 8.50. 58264: 404 | 17.00 |
  | Salchichón cular ibérico extra (`abb0d97b`) | 58159: 0.5 kg, 17.00, 8.50. 58266: 404 | 17.00 |

  Plan `0181` rule 7 writes the lowest price per kilo of the rows. The small cheese pieces are
  thus never shown at their own price.

## 3. Other chains and the leaflet

The same read for every other chain, on `item_prices`:

- **Carrefour** has no ACTIVE queue row and no price in production.
- **LIDL** has 78 ACTIVE rows, none sold by weight, and one `KILOGRAM` product with no price
  label. No LIDL product has a size beside a price per kilo.
- **El Jamón** has 6,326 ACTIVE rows, all with `soldByWeight: false`, because its last run
  (2026-10-03) is older than plan `0181`. 296 of them print `kg`. The 298 El Jamón products
  priced by the kilo are `KILOGRAM` with no size and a price equal to the price per kilo. That
  is kind 1, and it is correct. The site prints no piece weight, so it cannot produce kind 2.
  Three sized El Jamón products have a price equal to their price per kilo ("Tarta tiramisú"
  575 g, "Tarta de yema" 700 g, "Queso edam en lonchas" 100 g), and ten UNIT products carry the
  label `Kilo`. Those are a size reading question of El Jamón, not this defect.
- **DEZA** writes no web price (plan `0085`). Its 113 leaflet price rows are sized products
  with a reference label (`KILO 7'38`) and a price that differs from it, which is a pack. The
  21 DEZA leaflet products sold by the kilo are `KILOGRAM` with no size and still hold a null
  price. Plan `0181` ("The data already written") expected a second import to fix those.
- **The leaflet import** (`libs/luna-shopper/tools/leaflet/cli/src/to-harvest-document.mjs`,
  `decidePrice` at line 125) writes a `kg` tile as sold by weight with no size, and `fieldsOf`
  (`source-ingest.ts:1616`) clears any size of a row sold by weight. It cannot make this
  defect. It cannot state a piece weight either, because the document has no field for one.

The defect is thus Mercadona's alone, and only on products created before plan `0181`.

## 4. What velista and the back office show today

For the cheese (GRAM 1560, 13.42 € = 13.42 €/kg):

- **velista** prints the size "1560 g" (`libs/velista/ui/src/lib/catalog/product-size.ts:26`)
  and the price "13,42 €" (`product-row-view.ts`, `priceText`). It prints no price per kilo,
  because `unitPriceText` hides a unit price that equals the price (`product-row-view.ts:196`).
  A basket adds `price × (bought + left)` (`libs/velista/models/src/lib/basket-total.ts:142`
  to `144`), and a list adds `quantity × price` (`line-products.ts:356`). One cheese thus adds
  13.42 € and not 20.94 €.
- **velista, for a product already `KILOGRAM`** with no size, prints no size and a bare
  "13,42 €", with nothing that says it is the price of a kilo. A basket line of 1 adds the
  price of a kilo.
- **The back office** prints "1560 g"
  (`libs/luna-shopper-admin/feature-catalog/src/lib/products/product-format.ts:96`,
  `formatSize`) and, on the prices tab, "13,42 €" and "13,42 € / kg". The price form proposes
  a unit price of 13.42 / 1.56 = 8.60 for a new price on this product (`price-proposal.ts:44`),
  which is wrong. Neither the product form nor the create form of the queue checks `KILOGRAM`
  with a size before the server refuses it, and no message exists for `item_kilogram_has_size`.

## 5. The list

The full list of the 130, by kind, with the stored and the live values:
[the-130-products.md](the-130-products.md).
