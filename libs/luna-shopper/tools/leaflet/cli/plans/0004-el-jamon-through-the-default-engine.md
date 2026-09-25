# 0004 El Jamón through the default engine

> Found by the real run of plan `0003` in this folder (PR #465, "Real run", pages 5 and 6 of the
> `0150` El Jamón PDF, output in `C:/Users/Ichi/.claude/jobs/d7cc28bb/tmp/eljamon-0003/`). Blocked
> on plans `0002` and `0003`. Build those first.
>
> The default Claude engine refused El Jamón at the layout check, and the check was right: the
> chain file describes a leaflet this one is not. The builder of `0003` skipped the check with a
> script of its own, and the drift check then refused a correct reading on one new label pattern.
> So no El Jamón leaflet goes from PDF to a checked document today without a person working
> around the tool.

## Brief for the agent

### Objective

Make the default run take an El Jamón leaflet from PDF to a validated document that passes the
layout and drift checks: describe the pages as they are printed, rebuild the baseline from an
accepted reading in the current shape, build strictly, and give a folder of page images an honest
digest.

### Context

Paths are under `libs/luna-shopper/tools/leaflet/` unless named otherwise.

- **The layout.** `chains/src/el-jamon/layout.md:11-13` says most tiles carry `ANTES`, and
  `:25-26` says a department heading banner sits at the top of the page. Pages 5, 6 and 13 open
  with a photo strip and the "60 aniversario" logo and print no department name. `ANTES` is on 4
  of 8 tiles on page 5, and the multibuy tiles (`COMPRANDO 12 UNIDADES`, `-50% 2ª Unidad`,
  `2 UNIDADES POR 1€`, `Cada litro le sale a`) carry none
  (`D:/Projects/catalog-report/2026-09-23-slot3/part1/leaflet/pages/page_05.png`, `page_13.png`).
  The file names no promotion badge. The `0003` run printed all three differences (PR #465).
- **The check.** `cli/src/layout-check.mjs:29-49` sends `layout.md` with the first three pages
  of the run, not pages 1 to 3 (`cli/src/run.mjs:407-418`). `:43-44` already says a detail the
  description does not mention is not a difference. `:38-41` gives "a heading banner that is not
  there any more" as an example. A mismatch stops the run (`run.mjs:416-417`), and there is no
  flag that skips the check.
- **The baseline.** `chains/src/el-jamon/baseline.json:14-17` holds the label patterns `KG` and
  `L`. They came from the flat `0150` readings, where the builder falls back to the unit token
  for a missing wording (`cli/src/to-harvest-document.mjs:111`). The current prompt copies the
  wording verbatim, so the `0003` run printed `EL LITRO LE SALE A # €`, and
  `drift-check.mjs:79-99, 124-129` refuses any pattern the baseline lacks. `--update-baseline`
  replaces the whole file with one build's statistics (`build-document.mjs:733-741`). The README
  already says to re-baseline after the first reading in the current shape
  (`cli/src/README.md:321-329`). The report prints the command (`document.mjs:314, 371`).
- **Strict.** `runScripts` calls the builder without `--strict` (`cli/src/document.mjs:286-297`).
  `--strict` refuses to write a document while a key no shape names is present
  (`build-document.mjs:666-680`). Plan `0002` built its evidence with `--strict` (PR #462), and
  neither real run found an unknown key (PR #462, `el-jamon.harvest-document.report.json`,
  `"unknownKeys": []`). `--check-page N` already names unknown keys with their line on any run
  (`check-page.mjs:239`, `cli.mjs:250-257`).
- **The digest.** `build-document.mjs:656-662` hashes whatever `leaflet.json`'s `pdf` names. For
  a folder of page images the run writes `pages.manifest.txt` and names that
  (`run.mjs:535-546`, `document.mjs:463-486`). The document schema says the digest is "of the
  file the products were read out of. The run level dedupe keys on it"
  (`libs/luna-shopper/contracts/src/schemas/harvest-document/harvest-document-1.schema.ts:151-155`).
  The harvester keeps it as `documentSha256`
  (`apps/luna-shopper-backend/harvester/src/app/entities/harvest-run.entity.ts:72-77`) and
  refuses a second upload for the same chain until the first run is reverted
  (`harvest-run.store.ts:147-165`, `harvest-run.service.ts:293-299`). A manifest digest changes
  with the dpi, the renderer and the page list, so a second render of one leaflet passes the
  dedupe. `leaflet.json`'s `notes` reach the document's `warnings`
  (`build-document.mjs:578-584`), which the run page shows (`harvest-document-1.schema.ts:193-196`).
  LIDL has no PDF at all (`document.mjs:465-472`).

### Target state

- `chains/src/el-jamon/layout.md` describes what the pages print. The top of a page is a photo
  strip with the anniversary logo or a department banner, and neither is required. `ANTES`
  appears on some tiles, never on a multibuy tile. It names the promotion badges above and says
  the large `Cada litro le sale a` figure is a comparison figure. The writer looks at pages 1 to
  16 in the `0150` `pages/` folder first and describes only what they show.
- The check code stays as it is. It already tolerates what the description leaves out, so no
  skip flag is added. `layout-check.mjs:41` drops "a heading banner that is not there any more"
  from its examples, because the example names a chain specific rule as if it were general.
- `runScripts` passes `--strict` on every run, the default one and `--finish` alike. A stop
  prints each unknown key with its page, the `--check-page N` command for that page, and the
  `--finish` command. No flag turns strict off.
- `--pdf <directory>` accepts `--source-pdf <file>`. When it is given, `leaflet.json`'s `pdf`
  names that PDF, so the document digest is the PDF's, as it is for a PDF run. `run.json`
  records it, and a resume reads it back. The CLI does not parse `SOURCE.md`, because that file is
  an operator's note with no format.
- Without `--source-pdf`, the manifest digest stays, and `leaflet.json` gets one note: the digest
  is of the page images at this dpi, so the dedupe does not catch a second render of the same
  leaflet. The note reaches the document's warnings.
- `chains/src/el-jamon/baseline.json` is rebuilt from a reading in the current shape of pages 5
  to 16, the pages `0150` read, once a person accepts it (see Action boundaries).
- `cli/src/README.md:321-329` says which reading the new baseline came from.

### Scope

Work only in `libs/luna-shopper/tools/leaflet/cli/` (source, tests, README) and
`libs/luna-shopper/tools/leaflet/chains/src/el-jamon/` (`layout.md`, `baseline.json`).

Do not touch: the builder's price rules, `to-harvest-document.mjs`, the other chains, the
document schema, the harvester, or `libs/shared/model-engines`.

Out of scope, each for a plan of its own:

- The `kg` label fallback (`to-harvest-document.mjs:180`). Printing `€/kg` changes Deza's `KG`
  pattern, and Deza's baseline needs a Deza reading this plan has no budget for. The El Jamón
  baseline built here carries verbatim wording, so it does not depend on that fallback.
- One "no wording" warning per promotion (`build-document.mjs:456-466`). Only a flat reading
  from before plan `0002` produces it. The current prompt requires `rawText`
  (`chains/src/el-jamon/prompt.txt:53`).
- Two partial reads of one PDF share its digest, so the second upload is refused until the
  first is reverted.

### Constraints

- A baseline is never edited by hand. Only `--update-baseline` writes it.
- No drift band changes (`drift-check.mjs:31, 36`).
- No new npm dependency. Only make changes directly requested.

### Action boundaries

Stop and ask before: running `--update-baseline`, changing a drift band, or spending more than
20 page images of model calls in all. To ask about the baseline, show the developer the drift
output, one line per flagged statistic saying why it is the leaflet and not the reading (with the
page it was checked on), and the diff `--update-baseline` will write. Run it only after the
developer accepts.

### Progress evidence

- Tests: `runScripts` passes `--strict`, the strict stop message, `--source-pdf` in
  `leaflet.json` and `run.json` and on a resume, and the manifest note in the document's warnings.
- `npx nx test luna-shopper/leaflet-cli` and `npx nx lint luna-shopper/leaflet-chains` pass.
- The baseline run: the default engine on pages 5 to 16 (15 page images with the layout check),
  the layout check passing, the drift refusal, the accepted explanation, and the new baseline.
- One real run of the default Claude engine on pages 5 and 6 of the `0150` PDF (4 page images),
  from PDF to a validated document, with the layout check and the drift check both passing. Paste
  the printed output in the PR. Both runs together stay within 20 page images.
