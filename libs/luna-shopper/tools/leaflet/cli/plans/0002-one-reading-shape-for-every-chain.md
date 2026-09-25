> **PR:** [#462](https://github.com/IchirokuXVI/nx-portfolio/pull/462)

# 0002 One reading shape for every chain

> Found by `apps/luna-shopper-backend/plans/0150` (report finding 1, and
> `part1/leaflet/leaflet.md` and `convert-readings.mjs` in the report folder). Plan `0003` in
> this folder fixes the operator's steps around a read. This plan fixes what the builder does
> with a reading. Build this one first.
>
> In `0150`, the El Jamón reading reached the builder, and the builder kept only each product's
> name and headline price, silently. The built document carried 19 loyalty card prices and 18 second
> unit prices as till prices. The drift check refused the document, and
> that is the only reason it was not uploaded. The operator wrote a converter by hand to get past
> it.

## Brief for the agent

### Objective

Give every chain prompt one reading shape, make the builder read every field of it and warn on
any field it does not know, forward promotion prices, carry an offer's own end date, and prove
with a test per chain that a prompt's own example survives the build.

### Context

Paths are under `libs/luna-shopper/tools/leaflet/`.

- **Two shapes.** `chains/src/el-jamon/prompt.txt:8-30` asks for flat snake_case: `format`,
  `basis`, `was_price`, `unit_price`, `unit_price_per`, `loyalty`,
  `promotion.single_unit_price`, with no `categoryPath` and no `rawText`. The deza, dia and lidl
  prompts ask for camelCase with a nested `leaflet` block (`deza/prompt.txt:10-48`,
  `dia:10-50`, `lidl:10-49`).
- **The builder** (`cli/src/build-document.mjs:304-401`) reads only the nested camelCase
  shape, and nothing warns when a field is missing.
- **Promotions lose their price, for every chain.** `build-document.mjs:388-393` copies only
  `{ type, raw_text }` into `offer.promotion`, while `to-harvest-document.mjs:147` reads
  `offer.promotion.single_unit_price.amount`. So every conditional tile ends with no price.
  `chains/src/lidl/layout.md:99-108` already documents this.
- **Promotions are dropped.** `build-document.mjs:390-400` drops a promotion with no `rawText`,
  and the el-jamon and deza prompts never ask for it.
- **Both shapes are read in one place already.** `readRow` in `cli/src/sanity.mjs:37-66`, with
  the comment at `:17-22`.
- **No test.** There is no `build-document.test.mjs`. `document.test.mjs:157` and
  `run.test.mjs:224` check only the order the scripts run in. The chains project has no test
  target (`chains/project.json`).
- **Stale baseline.** `chains/src/el-jamon/baseline.json` came from the old whole document path
  (`chains/src/el-jamon/headings.mjs:1-11`, README lines 296 to 308).
- **The end date.** The document schema already has a per product `validity` with required
  `from` and `until` (`libs/luna-shopper/contracts/src/schemas/harvest-document/harvest-document-1.schema.ts:53-62, 121`),
  and the harvester uses it over the document's window
  (`apps/luna-shopper-backend/harvester/src/app/harvest/file-import.runner.ts:216-221`). No
  prompt asks for it and the builder never writes it. A half open window throws
  (`import-window.ts:127-134`).
- **The unit label.** The schema says the label is "Text, never a unit"
  (`harvest-document-1.schema.ts`, and the v2 schema at line 94), and `to-harvest-document.mjs:101-103`
  repeats it. The el-jamon prompt asks only for the `unit_price_per` enum, so the `0150`
  converter invented "el litro le sale a" from its own table. `readPer`
  (`build-document.mjs:53-61, 101-111`) cannot parse `l` or `kg`, only words like LITRO or
  KILO.

### Target state

- Every chain prompt asks for the nested camelCase shape the other three already use, with
  `rawText` on every promotion and the printed unit wording verbatim as `unitPriceLabel`.
- The builder normalizes each row through `readRow` before it reads anything, so an old
  reading in either shape still builds.
- The builder forwards `singleUnitPrice`, `totalPrice` and `requiredQuantity` as the snake_case
  fields `to-harvest-document.mjs` reads.
- The builder prints one warning per unknown key per page, and fails with `--strict`.
- A prompt field `validUntil` with the verbatim `validityText`. When a tile prints only "hasta
  el …", the builder sets `validity = { from: leaflet.from, until: tile.validUntil }` and
  records the assumption in the product's `extra`. A tile with neither date gets no validity.
- `readPer` parses `l`, `kg`, `g`, `ml` and `ud`, and takes `unit_price_per` when present.
- `build-document.test.mjs` takes the JSON example from each chain's `prompt.txt`, builds it,
  and asserts that loyalty, promotion price, basis, size and unit label survive.
- The El Jamón baseline is regenerated from the builder, with `--update-baseline`.
- `headings.mjs`'s "nothing calls this file" comment and README lines 296 to 308 say what is
  true now.

### Scope

Work only in `libs/luna-shopper/tools/leaflet/cli/` and `libs/luna-shopper/tools/leaflet/chains/`
(prompts, baselines, README, source, tests, and a test target in `chains/project.json` if one
is needed).

Do not touch: the document schema, the harvester, or the engines library
(`libs/shared/model-engines`).

### Constraints

- **No price leaves the builder that the tile did not print as a till price.** A loyalty card
  price and a second unit price stay in their own fields.
- No new npm dependency.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: changing the document schema, or deleting a baseline instead of
regenerating it.

### Progress evidence

- `build-document.test.mjs` passes for all four chains.
- The `0150` El Jamón readings in `D:/Projects/catalog-report/2026-09-23-slot3/part1/leaflet/read/`
  build with no converter, and the drift check passes. Paste the counts of loyalty prices,
  promotion prices and validities in the PR.
- `npx nx test` passes for the leaflet cli and chains projects.
