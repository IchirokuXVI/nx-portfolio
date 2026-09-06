# Reading a supermarket leaflet into a HarvestDocument

A leaflet is a PDF that prints prices and no product ids. Nothing in the
backend reads a PDF. This folder is the producer that turns one into a file
the harvester can import: a `HarvestDocument`, backend plan `0086` section
6.1, which is the one file schema the file import reads whoever produced the
file.

The contract is
`libs/luna-shopper/contracts/src/schemas/harvest-document/harvest-document-1.schema.ts`,
and it is the only authority. Nothing here restates it.

**It belongs to the harvester now, not to catalog.** The harvester's
`FILE_IMPORT` mode is what consumes the finished document, so this is where the
producer that builds one lives.

## What is here

Shared files apply to every chain. A chain's own folder under `chains/` holds
only what that one chain needs.

| File                          | What it is                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `to-harvest-document.mjs`     | A leaflet reading into a `HarvestDocument`. **Owns the three price rules.**                                |
| `build-document.mjs`          | Per page model readings, plus one leaflet's own small `leaflet.json`, into one document.                   |
| `drift-check.mjs`             | Compares a build's statistics with the chain's `baseline.json` and refuses a reading that drifted too far. |
| `validate.mjs`                | Validates a built document against the contract itself, not a copy of it.                                  |
| `chains/<slug>/prompt.txt`    | What a model is asked for one page of that chain's leaflet.                                                |
| `chains/<slug>/headings.mjs`  | That chain's department heading vocabulary, its default fixed pages, and the model it has used so far.     |
| `chains/<slug>/layout.md`     | What one page of that chain's leaflet looks like, for a person (and a model) to check before reading.      |
| `chains/<slug>/baseline.json` | That chain's own statistics from its last accepted reading. `drift-check.mjs`'s reference point.           |

**One leaflet's own values never belong in a chain's script.** A leaflet's own
PDF, its page count, which pages carry no department heading, its printed
validity window, and which tool actually read it: none of that is fixed across
every leaflet a chain prints, so none of it lives in `chains/<slug>/`. It lives
in that leaflet's own `leaflet.json`, beside its page readings under
`tmp/leaflet/<slug>-import/`, and it is not committed: it is working material,
same as the readings themselves.

`leaflet.json` fields:

| Field            | What it holds                                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdf`            | Path to the PDF, resolved beside `leaflet.json`. Used to compute the sha256.                                                                                                                                            |
| `page_count`     | How many pages the PDF has.                                                                                                                                                                                             |
| `fixed_sections` | Page number to `cover`, `index` or `back-cover`. Overrides the chain's own defaults for pages that moved on this leaflet.                                                                                               |
| `validity`       | `from` and `until`, as `to-harvest-document.mjs` states them, plus `raw_text` as printed. Either bound may be `null`; a `null` bound means the document carries no `validity`, and a warning, exactly as it always has. |
| `campaign`       | Optional. A named promotion this leaflet ran under.                                                                                                                                                                     |
| `extraction`     | `tool` and `date`. Overrides the chain's own default tool name and stamps when this particular reading happened.                                                                                                        |
| `notes`          | Optional. Free text warnings a person wants recorded verbatim, each `{ page, message, raw_text }`, for something this leaflet printed that a generic rule cannot phrase on its own.                                     |

The page images, the Python OCR extractor, the model comparison experiments
and the readings themselves are working material and stay in `tmp/leaflet`,
which is git ignored. Its README carries the measurements: which engine reads
a leaflet well, what a model run costs, and why OCR loses a headline price.

## The three price rules live here, not in the harvester

Plan `0081` had the harvester read a tile's promotion, loyalty and basis
blocks to work out which of its numbers was the price. In the new schema
those blocks are `extra`, and **no rule in the backend may read `extra`**. So
the decision belongs to whoever read the leaflet, and `to-harvest-document.mjs`
is where it now lives, for every chain alike.

1. **Loyalty.** A loyalty gated tile states no price at all and is recorded in
   `warnings`. A card price is not the price a non member pays, and the owner
   decided loyalty is stored and not implemented. A `loyalty_discount`
   promotion counts as gated whatever the loyalty block says, which is one
   tightening on plan `0081`: three tiles of the El Jamon reading carry the
   type with `required` unset.
2. **The promotion.** For `second_unit_discount`, `multibuy_unit_price`,
   `multibuy_total` and `buy_n_get_free`, the headline price is the second
   unit's or the bulk unit's. `single_unit_price` is what one unit costs. A
   conditional tile without one states no price and is recorded in
   `warnings`: the only number on it is one a shopper cannot pay for one
   unit. The Radler tile is the case, `price: 0.39` beside
   `single_unit_price: 0.79`.
3. **The basis.** A `kg` or `l` basis prices a weight, not a pack, so it
   states `unit_price` alone and no `price`. **The basis is asked after the
   promotion and about the number the promotion chose**, which is the one
   place this differs from the rule as plan `0081` wrote it. There the two
   were separate branches with the promotion first, so a per kilogram
   multibuy wrote its single unit price as a till price: 13 tiles of the El
   Jamon text layer reading and 2 of its OCR reading.

Roughly two fifths of a leaflet therefore reaches no basket line, because
`bestOffer` ranks on `price`. Backlog `0011` records the consequence and the
design that removes it. It is a known limitation the owner accepted.

## What a leaflet field becomes

There is **no `external_id`**: a leaflet prints no product id, so the import
keys the product on its name and its size label (plan `0086`, D2). There is no
document level bag either, because the import reads nothing there, so what
the leaflet said about itself is named in `producer.name`.

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

**A window needs both bounds or it is not stated.** The Deza leaflet prints
only an end date, under the back to school banner rather than over the whole
leaflet, so its document carries no `validity` and says so in `warnings`. A
half open window is the admin's override to supply at the spawn, and guessing
the other bound would put a made up date on 296 prices.

## Drift detection

The owner will not check every leaflet by hand, so two things stand in for
that check.

**`chains/<slug>/layout.md`** is a short prose description of one page of that
chain's leaflet: the tile layout, the price badge, the decimal separator,
loyalty badges or none, the heading banner, and typical products per page. A
new leaflet's first three page images get checked against it before anything
else is read (procedure (a) below). A leaflet that no longer matches its own
description is a format change, and the person reading it should stop and say
so rather than feed the model pages it was never asked to expect.

**`drift-check.mjs`** is the same idea, run on numbers instead of a person's
eye. `build-document.mjs` computes a reading's statistics into its report:
products per page (mean and max), the share of products with a price, with a
unit price only, with neither, with a promotion, with a null size, with a
brand, the distinct unit price label patterns (a label's own numbers folded to
`#`, so `LITRO 1'18` and `LITRO 3'61` count once), the distinct department
headings, and which of those headings the chain's own `headings.mjs` cannot
resolve. `drift-check.mjs --report <out.report.json> --chain <slug>` compares
those against `chains/<slug>/baseline.json` and prints every one that left its
band, with exit code 1:

- A share that moved more than 15 points from the baseline, either direction.
- A products per page mean or max that halved or more than doubled.
- Any department heading the baseline reading never printed.
- Any heading `headings.mjs` cannot resolve that the baseline did not already
  have.
- Any unit price label pattern the baseline reading never used.

A refused reading is not proof the reading is wrong. It is a signal that the
leaflet, or the way it was read, no longer looks like the one the baseline was
built from, and a person should look before it reaches an upload.
`build-document.mjs --update-baseline` rewrites `chains/<slug>/baseline.json`
from the current report, once a person has accepted the reading it came from.

## Procedure (a): a new leaflet of a known chain

1. Render the new leaflet's pages to images.
2. Read `chains/<slug>/layout.md`, then look at the first three page images.
   If they do not match the description, stop and report before reading any
   further page.
3. Send each page image to a capable model with `chains/<slug>/prompt.txt`,
   and keep one JSON array per page as `page_NN.json` under
   `tmp/leaflet/<slug>-import/`.
4. Write `tmp/leaflet/<slug>-import/leaflet.json`: the PDF path, the page
   count, any fixed section pages that moved, the printed validity window,
   and the tool that read it.
5. Build:

   ```sh
   node apps/luna-shopper-backend/harvester/tools/leaflet/build-document.mjs \
     --readings tmp/leaflet/<slug>-import \
     --leaflet tmp/leaflet/<slug>-import/leaflet.json \
     --chain <slug> \
     --out tmp/leaflet/<slug>.harvest-document.json
   ```

6. Drift check the report:

   ```sh
   node apps/luna-shopper-backend/harvester/tools/leaflet/drift-check.mjs \
     --report tmp/leaflet/<slug>.harvest-document.report.json --chain <slug>
   ```

   A refusal means stop and look. Do not proceed to validate or upload a
   refused reading without understanding why it drifted.

7. Validate:

   ```sh
   node --experimental-strip-types \
     apps/luna-shopper-backend/harvester/tools/leaflet/validate.mjs \
     tmp/leaflet/<slug>.harvest-document.json
   ```

8. Upload the document through the back office at `harvest/imports/upload`,
   with the chain, the price scope and the source kind `OFFICIAL_LEAFLET`.
9. Once the reading is accepted, run `build-document.mjs` again with
   `--update-baseline` so the next leaflet is checked against this one.

**El Jamon does not yet follow this procedure.** It has no per page readings
and no `leaflet.json`: its one committed reading is already a whole document
in the old leaflet shape, from before this split, and `to-harvest-document.mjs`
converts it directly:

```sh
node apps/luna-shopper-backend/harvester/tools/leaflet/to-harvest-document.mjs \
  tmp/leaflet/eljamon.vision.json
```

`chains/el-jamon/baseline.json` still exists, generated from that same
reading, so `drift-check.mjs` has something to compare a future El Jamon
reading against once it does move to per page images and this procedure.

## Procedure (b): a new chain

Write these before any model reads a single page, in this order.

1. **`chains/<slug>/layout.md`.** Look at three pages of the new leaflet and
   describe what one page looks like: the tile layout, the price badge, the
   decimal separator, loyalty badges or none, the heading banner, typical
   products per page.
2. **`chains/<slug>/prompt.txt`.** Copy the closest existing chain's prompt
   and adapt it. The rules that usually change between chains: the decimal
   separator, the price badge's shape, whether there is a loyalty mechanic at
   all, how a promotion is worded, and the heading banner's own vocabulary.
3. **`chains/<slug>/headings.mjs`.** The department heading vocabulary this
   chain prints, folded (accents stripped, upper cased) onto the schema's own
   slugs, plus this chain's default fixed pages and the model name a first
   reading expects to use.
4. Read the whole leaflet through `build-document.mjs`, as in procedure (a).
5. A person spot checks three pages against the built document.
6. Once accepted, run `build-document.mjs --update-baseline` to create
   `chains/<slug>/baseline.json`. There is no baseline before this step, so
   `drift-check.mjs` has nothing to compare the first reading against; from
   the second leaflet on, it guards every reading after this one.

## The committed outputs

**One** document produced here is committed as a fixture under
`apps/luna-shopper-backend/harvester/src/app/harvest/__fixtures__/`, and a
four product excerpt under the contract's own `__fixtures__`. Their line
endings are pinned to LF in `.gitattributes`, so regenerating one is a real
diff rather than a whole file one.

| Fixture                                | Products | Priced | Unit price only | Neither |
| -------------------------------------- | -------- | ------ | --------------- | ------- |
| `eljamon.vision.harvest-document.json` | 48       | 31     | 11              | 6       |

**One, and not four, because a fixture folder holds what a test reads.** The
El Jamon OCR and pdftext conversions and the Deza one were committed beside it
and imported by nothing, at 240 KB to 335 KB each; the three readings they
were converted from were committed too, and their consumer went with the old
leaflet runner. All six are deleted. They were evidence about four readings
rather than input to a test, and evidence belongs beside the experiment in
`tmp/leaflet`, where the full readings still are; regenerating any of them is
the one command above. What the four measured, for the record:

| Reading            | Products | Priced | Unit price only | Neither |
| ------------------ | -------- | ------ | --------------- | ------- |
| El Jamon (vision)  | 48       | 31     | 11              | 6       |
| El Jamon (OCR)     | 218      | 148    | 58              | 12      |
| El Jamon (pdftext) | 219      | 122    | 95              | 2       |
| Deza (vision)      | 296      | 285    | 11              | 0       |

No model output is kept in this folder either, for the same reason. What a
model returned is evidence of what that model returned.
