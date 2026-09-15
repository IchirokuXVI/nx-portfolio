# What to tell a model agent that reads a leaflet

Two prompts to paste into a Claude Code session (Sonnet 5 reads a page image
well; see `tmp/leaflet/README.md` section 11 for the measurements). The agent
reads the page images itself with its Read tool, so no API key is involved.
Replace every `<...>` before pasting. The agent must never commit the page
images, the readings or the document: they are working material under
`tmp/leaflet`.

The procedures the prompts follow are `README.md` procedures (a) and (b).
Keep the two in step: a change to a procedure is a change here.

## Prompt A: a new leaflet of a chain that has a folder under `chains/`

```text
Read the supermarket leaflet PDF at <PATH TO PDF> (chain slug: <slug>, one of
the folders under apps/luna-shopper-backend/harvester/tools/leaflet/chains/)
into a HarvestDocument JSON that the Luna Shopper harvester can import.

Read apps/luna-shopper-backend/harvester/tools/leaflet/README.md in full
first, then follow its procedure (a) exactly. Do not build a script plus
model hybrid and do not run OCR: read every page image yourself.

1. Census the PDF: page count, and which pages carry a text layer. Use
   tmp/.venv-ocr/Scripts/python.exe with PyMuPDF (fitz). Render every page to
   a PNG at 160 dpi into tmp/leaflet/<slug>-pages/page_NN.png, two digit page
   numbers starting at 01.

2. Layout check. Read chains/<slug>/layout.md, then look at page_01, page_02
   and page_03 with the Read tool. If the pages do not match the description
   (a different price badge, a different decimal separator, a loyalty badge
   the description does not mention, a different tile layout), STOP here and
   report what differs. Do not read further pages.

3. Read every page image yourself, one at a time, with the Read tool,
   following chains/<slug>/prompt.txt exactly. Write one JSON array per page
   to tmp/leaflet/<slug>-import/page_NN.json, an empty array for a page with
   no priced product. The three fields that matter most are leaflet.loyalty,
   leaflet.promotion (its type and singleUnitPrice) and leaflet.basis: a
   wrong price is worse than a missing one. Never divide one printed number
   by another.

4. Write tmp/leaflet/<slug>-import/leaflet.json with the fields the README
   lists: pdf (relative to that file), page_count, fixed_sections (cover,
   index and back cover pages), validity (from, until and raw_text as
   printed, and a bound the leaflet does not print is null), campaign if the
   leaflet names one, extraction (tool: "claude-sonnet-5 via Claude Code,
   chains/<slug>/prompt.txt", date: now as ISO), and notes for anything a
   person should read about this leaflet's dates or layout.

5. Build, drift check, validate, in this order, from the repository root:

   node apps/luna-shopper-backend/harvester/tools/leaflet/build-document.mjs \
     --readings tmp/leaflet/<slug>-import \
     --leaflet tmp/leaflet/<slug>-import/leaflet.json \
     --chain <slug> \
     --out tmp/leaflet/<slug>.harvest-document.json

   node apps/luna-shopper-backend/harvester/tools/leaflet/drift-check.mjs \
     --report tmp/leaflet/<slug>.harvest-document.report.json --chain <slug>

   node --experimental-strip-types \
     apps/luna-shopper-backend/harvester/tools/leaflet/validate.mjs \
     tmp/leaflet/<slug>.harvest-document.json

   If the drift check refuses the reading, do not run --update-baseline and
   do not call the document ready. Report every statistic it named and your
   explanation for each, and stop.

6. Report: pages read, products found, how many have a price, a unit price
   only, or neither and why, every warning the document carries, the
   validity you set, the drift check result, and the output path. Do not
   commit anything and do not upload anything.
```

After the agent reports, upload the document at `harvest/imports/upload`
with the chain, the price scope and the source kind leaflet. Rows with no
price land in the queue with the leaflet's `extra` visible, which is where
you decide them. Once the reading is accepted, run `build-document.mjs`
again with `--update-baseline` so the next leaflet is checked against this
one.

## Prompt B: a chain with no folder under `chains/` yet

Nothing is written for the chain yet, so the agent writes the chain folder
first and reads the leaflet second. The first reading has no baseline to be
checked against, which is why step 6 asks you to spot check three pages.

```text
A new supermarket chain, <CHAIN NAME> (slug <slug>), has its first leaflet PDF
at <PATH TO PDF>. Prepare the chain under
apps/luna-shopper-backend/harvester/tools/leaflet/chains/<slug>/ and then
read the leaflet into a HarvestDocument.

Read apps/luna-shopper-backend/harvester/tools/leaflet/README.md in full
first, then follow its procedure (b) exactly.

1. Census and render the PDF as in procedure (a): page count, text layer per
   page, every page to a PNG at 160 dpi under tmp/leaflet/<slug>-pages/.

2. Look at three pages with the Read tool: the cover, one grocery page and
   one non food page. Write chains/<slug>/layout.md in the style of
   chains/deza/layout.md: the tile layout, the price badge and its footer,
   the decimal separator, loyalty badges or none, the heading banner, typical
   products per page, and anything printed on the tiles that is not a
   promotion of this leaflet.

3. Write chains/<slug>/prompt.txt by copying the closest existing chain's
   prompt and adapting only the rules that differ for this chain: the decimal
   separator, the price badge, whether a loyalty mechanic exists, the
   promotion wording, and the heading banner vocabulary. Keep every other
   rule as it is.

4. Write chains/<slug>/headings.mjs in the shape of chains/deza/headings.mjs:
   every department heading this leaflet prints, folded onto the schema's own
   slugs, the default fixed pages, and the tool name a reading uses.

5. Read the whole leaflet as in procedure (a): every page with the Read tool
   and chains/<slug>/prompt.txt, one JSON array per page under
   tmp/leaflet/<slug>-import/, then leaflet.json, then build-document.mjs
   and validate.mjs. Skip drift-check.mjs: there is no baseline yet. Do not
   run --update-baseline.

6. Report as in procedure (a), and name the three pages you consider hardest
   (promotions, per kilogram prices, loyalty) so a person can spot check them
   against the built document before the baseline is created.
```

When the spot check passes, create the baseline yourself:

```sh
node apps/luna-shopper-backend/harvester/tools/leaflet/build-document.mjs \
  --readings tmp/leaflet/<slug>-import \
  --leaflet tmp/leaflet/<slug>-import/leaflet.json \
  --chain <slug> \
  --out tmp/leaflet/<slug>.harvest-document.json \
  --update-baseline
```

Commit the four files under `chains/<slug>/` (`layout.md`, `prompt.txt`,
`headings.mjs`, `baseline.json`) in a pull request against `dev`. From the
second leaflet on, use Prompt A.
