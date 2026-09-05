# Reading a supermarket leaflet into a HarvestDocument

A leaflet is a PDF that prints prices and no product ids. Nothing in the backend
reads a PDF. This folder is the producer that turns one into a file the harvester
can import: a `HarvestDocument`, backend plan `0086` section 6.1, which is the one
file schema the file import reads whoever produced the file.

The contract is
`libs/luna-shopper/contracts/src/schemas/harvest-document/harvest-document-1.schema.ts`,
and it is the only authority. Nothing here restates it.

## What is here

| File                      | What it is                                                                       |
| ------------------------- | -------------------------------------------------------------------------------- |
| `to-harvest-document.mjs` | A leaflet reading into a `HarvestDocument`. **Owns the three price rules.**      |
| `build-deza-document.mjs` | Per page model readings into one document, through the converter above.          |
| `validate.mjs`            | Validates a built document against the contract itself, not a copy of it.        |
| `prompt.txt`              | What a model is asked for one page of the El Jamon leaflet.                      |
| `prompt-deza.txt`         | The same for Deza, whose tiles print an apostrophe decimal and no loyalty badge. |

The page images, the Python OCR extractor, the model comparison experiments and
the readings themselves are working material and stay in `tmp/leaflet`, which is
git ignored. Its README carries the measurements: which engine reads a leaflet
well, what a model run costs, and why OCR loses a headline price.

## How a future extraction produces the schema

1. **Census the PDF first.** How many pages, how many carry a text layer, and how
   the tiles are laid out. `tmp/leaflet/ocr_extract.py --engine pdftext` answers
   the first two. A leaflet is rarely one kind of document: 28 of El Jamon's 40
   pages had a text layer and 12 were flat images.
2. **Send each page image to a capable model** with `prompt.txt`, or
   `prompt-deza.txt` for a chain whose tiles differ, and keep one JSON array per
   page as `page_NN.json`. Do not build a script plus model hybrid: a script over
   the text layer got half the prices wrong, and the text layer costs more tokens
   than the page image.
3. **Assemble.** `build-deza-document.mjs` is the worked example: it folds the
   per page readings into one document, maps the printed department headings onto
   its own vocabulary, and calls the converter. A new chain gets its own build
   script beside it, or a `--sections` argument on this one.
4. **Validate.** `node --experimental-strip-types validate.mjs <out.json>`. The
   flag is what lets Node import the contract's own `.ts` file, so a change to
   the contract fails this check instead of drifting past it.
5. **Upload** the document through the back office at `harvest/imports/upload`,
   with the chain, the price scope and the source kind `OFFICIAL_LEAFLET`.

```sh
# One leaflet reading in the old plan 0081 shape into the new schema
node apps/luna-shopper-backend/catalog/tools/leaflet/to-harvest-document.mjs \
  tmp/leaflet/eljamon.vision.json

# Per page readings into one document
node apps/luna-shopper-backend/catalog/tools/leaflet/build-deza-document.mjs \
  --in tmp/leaflet/deza-import --pdf tmp/Folleto-Deza-Septiembre-26.pdf \
  --out tmp/leaflet/deza.harvest-document.json

node --experimental-strip-types \
  apps/luna-shopper-backend/catalog/tools/leaflet/validate.mjs \
  tmp/leaflet/deza.harvest-document.json
```

## The three price rules live here, not in the harvester

Plan `0081` had the harvester read a tile's promotion, loyalty and basis blocks
to work out which of its numbers was the price. In the new schema those blocks
are `extra`, and **no rule in the backend may read `extra`**. So the decision
belongs to whoever read the leaflet, and `to-harvest-document.mjs` is where it
now lives.

1. **Loyalty.** A loyalty gated tile states no price at all and is recorded in
   `warnings`. A card price is not the price a non member pays, and the owner
   decided loyalty is stored and not implemented. A `loyalty_discount` promotion
   counts as gated whatever the loyalty block says, which is one tightening on
   plan `0081`: three tiles of the El Jamon reading carry the type with
   `required` unset.
2. **The promotion.** For `second_unit_discount`, `multibuy_unit_price`,
   `multibuy_total` and `buy_n_get_free`, the headline price is the second unit's
   or the bulk unit's. `single_unit_price` is what one unit costs. A conditional
   tile without one states no price and is recorded in `warnings`: the only
   number on it is one a shopper cannot pay for one unit. The Radler tile is the
   case, `price: 0.39` beside `single_unit_price: 0.79`.
3. **The basis.** A `kg` or `l` basis prices a weight, not a pack, so it states
   `unit_price` alone and no `price`. **The basis is asked after the promotion
   and about the number the promotion chose**, which is the one place this
   differs from the rule as plan `0081` wrote it. There the two were separate
   branches with the promotion first, so a per kilogram multibuy wrote its single
   unit price as a till price: 13 tiles of the El Jamon text layer reading and 2
   of its OCR reading.

Roughly two fifths of a leaflet therefore reaches no basket line, because
`bestOffer` ranks on `price`. Backlog `0011` records the consequence and the
design that removes it. It is a known limitation the owner accepted.

## What a leaflet field becomes

There is **no `external_id`**: a leaflet prints no product id, so the import keys
the product on its name and its size label (plan `0086`, D2). There is no
document level bag either, because the import reads nothing there, so what the
leaflet said about itself is named in `producer.name`.

| Leaflet reading                                   | Harvest document                                      |
| ------------------------------------------------- | ----------------------------------------------------- |
| `source.sha256`                                   | `sha256`                                              |
| `source.file`, `page_count`, `extraction`         | named in `producer.name`                              |
| `retailer.name`, `campaign`                       | named in `producer.name`                              |
| `retailer.chain_id`                               | dropped: a slug is not an id any deployment holds     |
| `retailer.currency`                               | the currency of every price                           |
| `validity.starts_on` and `ends_on`                | `validity.from` and `until`, or absent with a warning |
| `offers[].product.name`, `brand`                  | `products[].name`, `brand`                            |
| `offers[].product.format.raw`, `quantity`, `unit` | `products[].size.label`, `quantity`, `unit`           |
| `offers[].pricing`                                | `price` and `unit_price`, by the three rules          |
| `pages[].section_raw` or `section`                | `category_path`, unless it names a cover or an index  |
| everything else                                   | `products[].extra`, verbatim                          |

**A window needs both bounds or it is not stated.** The Deza leaflet prints only
an end date, under the back to school banner rather than over the whole leaflet,
so its document carries no `validity` and says so in `warnings`. A half open
window is the admin's override to supply at the spawn, and guessing the other
bound would put a made up date on 296 prices.

## The committed outputs

**One** document produced here is committed as a fixture under
`apps/luna-shopper-backend/harvester/src/app/harvest/__fixtures__/`, and a four
product excerpt under the contract's own `__fixtures__`. Their line endings are
pinned to LF in `.gitattributes`, so regenerating one is a real diff rather than
a whole file one.

| Fixture                                | Products | Priced | Unit price only | Neither |
| -------------------------------------- | -------- | ------ | --------------- | ------- |
| `eljamon.vision.harvest-document.json` | 48       | 31     | 11              | 6       |

**One, and not four, because a fixture folder holds what a test reads.** The
El Jamon OCR and pdftext conversions and the Deza one were committed beside it
and imported by nothing, at 240 KB to 335 KB each; the three readings they were
converted from were committed too, and their consumer went with the old leaflet
runner. All six are deleted. They were evidence about four readings rather than
input to a test, and evidence belongs beside the experiment in `tmp/leaflet`,
where the full readings still are; regenerating any of them is the one command
above. What the four measured, for the record:

| Reading            | Products | Priced | Unit price only | Neither |
| ------------------ | -------- | ------ | --------------- | ------- |
| El Jamon (vision)  | 48       | 31     | 11              | 6       |
| El Jamon (OCR)     | 218      | 148    | 58              | 12      |
| El Jamon (pdftext) | 219      | 122    | 95              | 2       |
| Deza (vision)      | 296      | 285    | 11              | 0       |

No model output is kept in this folder either, for the same reason. What a model
returned is evidence of what that model returned.
