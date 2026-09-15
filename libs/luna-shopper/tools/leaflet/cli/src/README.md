# Reading a supermarket leaflet into a HarvestDocument

A leaflet is a PDF that prints prices and no product ids. Nothing in the
backend reads a PDF. This folder is the producer that turns one into a file
the harvester can import: a `HarvestDocument`, backend plan `0086` section
6.1, which is the one file schema the file import reads whoever produced the
file.

The contract is
`libs/luna-shopper/contracts/src/schemas/harvest-document/harvest-document-1.schema.ts`,
and it is the only authority. Nothing here restates it.

**It is an operator's tool, and no deployed process loads it.** The harvester's
`FILE_IMPORT` mode consumes the finished document, so it used to live inside
that app. It is two projects now, and the line between them is what is the same
for every chain against what one chain prints:

| Project                       | Directory                                | What it holds                                                                    |
| ----------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| `luna-shopper/leaflet-cli`    | `libs/luna-shopper/tools/leaflet/cli`    | The command and the four shared scripts                                          |
| `luna-shopper/leaflet-chains` | `libs/luna-shopper/tools/leaflet/chains` | One folder per chain: `layout.md`, `prompt.txt`, `headings.mjs`, `baseline.json` |

`leaflet-cli` names `leaflet-chains` in its `implicitDependencies`, so an edit
to `dia/prompt.txt` marks the command affected and runs its tests.

## What is here

| File                          | What it is                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `cli.mjs`                     | The command. `nx run luna-shopper/leaflet-cli:read`. Procedure (a) below.                                  |
| `to-harvest-document.mjs`     | A leaflet reading into a `HarvestDocument`. **Owns the three price rules.**                                |
| `build-document.mjs`          | Per page model readings, plus one leaflet's own small `leaflet.json`, into one document.                   |
| `drift-check.mjs`             | Compares a build's statistics with the chain's `baseline.json` and refuses a reading that drifted too far. |
| `validate.mjs`                | Validates a built document against the contract itself, not a copy of it.                                  |
| `AGENT-PROMPT.md`             | The prompt to paste to a model agent that writes a new chain's folder.                                     |
| `chains/<slug>/prompt.txt`    | What a model is asked for one page of that chain's leaflet.                                                |
| `chains/<slug>/headings.mjs`  | That chain's heading vocabulary, its fixed pages, its render dpi, and the model it has used so far.        |
| `chains/<slug>/layout.md`     | What one page of that chain's leaflet looks like, for a person (and a model) to check before reading.      |
| `chains/<slug>/baseline.json` | That chain's own statistics from its last accepted reading. `drift-check.mjs`'s reference point.           |

The command's own parts sit beside `cli.mjs`: `chains.mjs` resolves a slug,
`census.mjs` and `render.mjs` are steps 1 and 2, `layout-check.mjs` is step 3,
`read-pages.mjs` is step 4, `sanity.mjs` is step 5, `document.mjs` is steps 6 to
8, `manual.mjs` is `--engine manual`, and `run.mjs` is the eight in order.

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

One command:

```sh
npx nx run luna-shopper/leaflet-cli:read -- --pdf tmp/dia_leaflet.pdf --chain dia
```

Keep the `--`. Nx reads what comes before it as its own flags, so an option
typed without it is dropped in silence. `--help` prints every flag.

It does eight things, in order, and each one can refuse.

1. **Census.** Page count, page size and which pages carry a text layer. It is
   printed first, because the two chains read so far are not the same kind of
   document: El Jamon is 40 pages with text on 28 of them, Deza is 62 pages of
   flat images.
2. **Render.** Every page to a PNG under `<out>/pages/`, at the dpi
   `chains/<slug>/headings.mjs` names, which `--dpi` overrides. It shells out to
   `pdftoppm`, then `magick`, then a Python with PyMuPDF, and prints the install
   line for each when it finds none. `--pdf <directory>` of `page_NN.png` skips
   this step, which is how LIDL is read.
3. **Layout check.** `chains/<slug>/layout.md` against the first three pages. A
   mismatch stops the run and names what differs.
4. **Read.** One call per page, in order, writing `<out>/import/page_NN.json` as
   it goes. A page that answers nothing parseable is asked once more and then
   recorded as an empty array with a named warning.
5. **Sanity pass.** Six checks against what a printed page can support, naming
   the page, the product and the rule for every row that fails. It runs for
   every engine, because every model has a systematic defect and only the defect
   differs. It never edits a row and it never drops one.
6. **Leaflet metadata.** `<out>/import/leaflet.json`, with the validity window
   asked of the cover. Every field it filled is printed for you to confirm: a
   wrong date silently mis-scopes every price.
7. **Build, drift check, validate.** The three scripts below, unchanged, as
   child processes. A drift refusal stops the run before validate.
   `--update-baseline` is never passed.
8. **Report.** What was read, every row to look at, and the document's path.

Then two things are yours, and stay yours:

- **Upload the document** through the back office at `harvest/imports/upload`,
  with the chain, the price scope and the source kind `OFFICIAL_LEAFLET`. The
  command prints the call and never makes it. A tool that posted its own output
  would remove the only review this pipeline has.
- **Once the reading is accepted**, run `build-document.mjs` with
  `--update-baseline` so the next leaflet is checked against this one.

### Which engine reads it

`--engine ollama` is the default, and it is not good enough to accept unseen.
It is free, a leaflet reading is cheap to redo, and the drift check already
catches a bad one, so a first pass over a 40 page leaflet is worth having. What
it costs is measured in the plan's section 7: it found every tile and invented
nothing, and it got 63% of headline prices, 55% of ANTES prices and 31% of unit
prices right, against 95%, 100% and 100% for Sonnet 5. On every price drop tile
it invented a single unit price the page does not print.

So the run prints that **before** it starts as well as after, because a warning
is worth nothing to somebody who has already waited eleven minutes. The first
line of it is written into `leaflet.json`'s `extraction.tool`, which is the
field that reaches the document's `producer.name`, so a person reading the file
next week sees what read it.

**For a reading that matters, use `--engine manual`.** The most accurate reader
measured here is Sonnet 5, and manual mode reaches it by not being clever: it
renders the pages, writes `<out>/PROMPT.md`, and stops.

```sh
# 1. Render, and write the prompt to paste.
npx nx run luna-shopper/leaflet-cli:read -- --pdf tmp/dia.pdf --chain dia --engine manual

# 2. Paste <out>/PROMPT.md into Claude Code, or any model you like. It writes
#    <out>/import/page_NN.json, one JSON array per page.

# 3. Pick the run back up.
npx nx run luna-shopper/leaflet-cli:read -- --out <out> --resume --engine manual
```

A Claude Code session already reads a PNG with its Read tool and the tokens are
already paid for. `PROMPT.md` carries `chains/<slug>/prompt.txt` byte for byte,
so it cannot drift from the chain's own rules, and it is generated every run and
never committed. The pick up refuses a reading it cannot trust rather than
repairing one: a `page_NN.json` that is not a JSON array is named by page and
stops the run, and so is a page with no file at all unless `--pages` excluded
it.

### The three scripts the command calls

Run them by hand for a reading that was produced some other way.

```sh
node libs/luna-shopper/tools/leaflet/cli/src/build-document.mjs \
  --readings tmp/leaflet/<slug>-import \
  --leaflet tmp/leaflet/<slug>-import/leaflet.json \
  --chain <slug> \
  --out tmp/leaflet/<slug>.harvest-document.json

node libs/luna-shopper/tools/leaflet/cli/src/drift-check.mjs \
  --report tmp/leaflet/<slug>.harvest-document.report.json --chain <slug>

node --experimental-strip-types \
  libs/luna-shopper/tools/leaflet/cli/src/validate.mjs \
  tmp/leaflet/<slug>.harvest-document.json
```

A drift refusal means stop and look. Do not validate or upload a refused
reading without understanding why it drifted.

**El Jamon does not yet follow this procedure.** It has no per page readings
and no `leaflet.json`: its one committed reading is already a whole document
in the old leaflet shape, from before this split, and `to-harvest-document.mjs`
converts it directly:

```sh
node libs/luna-shopper/tools/leaflet/cli/src/to-harvest-document.mjs \
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
