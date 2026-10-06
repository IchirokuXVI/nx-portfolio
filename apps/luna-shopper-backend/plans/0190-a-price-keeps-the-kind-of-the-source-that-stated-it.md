# 0190: a price keeps the kind of the source that stated it

> Found by the repair of the first catalog on local slot 1 (plan `0186`, stage B,
> 2026-10-06). The evidence is in `.curation-runs/2026-10-audit-repair/` of the main
> checkout: `stage-b-summary.md` section 6 point 3, `stage-b/finish-kind-changed.read.json`
> and `stage-b/rows-diff.after-mercadona.after-deza.2df761c8.json`.
>
> Prerequisite reading: plan `0085` section 6 and plan `0086` (D2, D3, D8, sections 7
> and 8), plan `0081`, plan `0182`,
> `harvester/src/app/entities/source-catalog-entry.entity.ts`,
> `harvester/src/app/entities/source-entry-price.entity.ts`,
> `harvester/src/app/harvest/matching.ts` (`entryKey`, `entryNameKey`),
> `source-ingest.ts` (`open`, `writeChunk`, `touch`, `fieldsOf`, `replaceScopePrices`),
> `source-snapshot.ts` (`applySourceGroup`, `sourceGroupChanged`) and
> `source-entry-write.ts` (`SourceEntryPriceWriter.write`).

A Deza leaflet and the Deza website print some products with the same name and the same
format. The harvester keeps one row for both, on purpose. The row has one `sourceKind`
column, and each run writes its own kind into it. Eight rows have changed kind twice in
three days, and their name, brand and size changed with it.

## Brief for the agent

### Objective

Keep one row and one decision for a product that two sources of one chain print the same
way, and stop the kind of a price, and the text of the row, from depending on which run
came last.

### Context

Every statement below was read in the file it names.

- **The key has no kind in it, by design.** The unique index `uq_source_catalog_entry` is
  `(supermarketId, externalId)`. For a source with no product id, `externalId` is
  `entryKey(name, sizeFormat)`: a SHA-1 of the normalized name, a pipe, and the normalized
  format. `deza-catalog.runner.ts` and `file-import.runner.ts` both call it. The entity
  says that a listing and a leaflet "land on the same row, which is the meeting plan 0085
  section 6 chose the key shape for". The brand is not in the key.
- **A session loads the rows of the chain, of every kind.** `SourceIngest.open` reads
  `where: { supermarketId }` and `SourceIngestSession` indexes them by `externalId`.
- **The last run writes the whole source group.** `writeChunk` builds
  `fieldsOf(observation, input.sourceKind)` and `touch` calls `applySourceGroup`, which
  assigns `sourceKind`, `name`, `brand`, `brandKey`, `ean`, `unitSize`, `sizeUnit`,
  `soldByWeight`, `sizeFormat`, `categoryPath`, `url` and `extra`. `sourceGroupChanged`
  compares `sourceKind` too, so each such row counts as `updated` on every run of the
  other kind.
- **So the stage B report has the direction half right.** The eight rows were first seen
  on 2026-10-03 at 01:42 UTC, by the first website run. The leaflet import of the same day
  at 16:12 UTC (run `794056b6`) made them `OFFICIAL_LEAFLET` and wrote the leaflet's
  name, brand and size. The website run of 2026-10-06 (run `960a32c5`) put them back. The
  inference of the report is confirmed: one row, one key, and the last writer wins. The
  first overwrite was the leaflet's.

What follows from one kind on a shared row:

- **An accept writes the price with the kind of the row.** `SourceEntryPriceWriter.write`
  passes `entry.sourceKind` to `catalog.addPrices`. The price row itself
  (`source_entry_prices`) has no kind. It keeps the run that observed it. Two of the eight
  rows are `UNRESOLVED` and hold a leaflet price. Accepting one today writes that leaflet
  price to catalog as `OFFICIAL_WEB`, stamped with the leaflet run. Plan `0080` decides
  the shown price by kind, so the kind is not a detail.
- **One price row per row and scope.** `uq_source_entry_prices_scope` is
  `(entryId, priceScopeId)` and `replaceScopePrices` upserts on it. A website price and a
  leaflet price for one scope would overwrite each other. Deza's website prints no price,
  so this has not happened. It will for the first chain that has both and no product id.
- **The text of the row moves.** `Leche COVAP Entera` by `Covap` became
  `Leche COVAP entera` by `COVAP`. Two rows lost their size (30 and 120) and gained a
  brand that is a word of the name (`BOO CREW HALLOWEEN`, `ESQUELETO`). A create from the
  row takes its defaults from whichever run was last. `soldByWeight` is in the group too:
  a leaflet offer by the kilo sets it, and the next website run clears it while the per
  kilo price stays on the row.
- **The queue filter and the export move with it.** `SourceEntryService.list` filters on
  `e."sourceKind"`, so the leaflet queue fell from 196 rows to 188. `export` reads the
  rows whose `lastRunId` is the run, so an export of the leaflet run no longer holds the
  eight offers.
- **A revert is safe in this direction and is why the two run columns exist.**
  `deleteUndecidedFrom` removes a queued row only when `firstRunId` and `lastRunId` are
  both the reverted run. A row that the website also saw survives.
  `deleteObservedPricesFrom` removes the price rows of the run, which is right.
- **Availability is not harmed.** `source_entry_availability` is keyed on the row and
  the shop of the source, and only a walk states a claim. `send` in
  `source-entry-availability.ts` groups by `e."sourceKind"`, which for a walked row is
  the kind of the walk once this plan lands.
- **There is no alias table.** Plan `0086` folded `source_aliases` of plan `0081` into
  this table. The row is the alias, so nothing else collides. CLAUDE.md still names the
  old table.

### Target state

1. **A price row says which kind stated it.** `source_entry_prices.sourceKind`, the enum
   `price_source_kind`, not null. The unique key becomes
   `(entryId, priceScopeId, sourceKind)`. `replaceScopePrices` writes the kind of its
   session and conflicts on the new key.
2. **An accept writes each price under its own kind.** `SourceEntryPriceWriter.write`
   passes the kind of the price row, not of the entry. `otherPieces` compares pieces of
   the same kind as the price being written.
3. **A walk owns the text of a row. A leaflet adds to it.** The kinds `OFFICIAL_API` and
   `OFFICIAL_WEB` are a walk. In `writeChunk`:
   - An observation of the kind the row holds does what it does today.
   - A leaflet observation of a row that a walk owns moves `timesSeen`, `lastSeenAt` and
     `lastRunId`, writes its prices, and leaves the source group alone. It asks the EAN
     rung as `see` does. The row counts as `unchanged`.
   - A walk observation of a row that only a leaflet has described takes the row over:
     it writes the source group and its own kind. That happens once for a row.
   State the rule once, beside `applySourceGroup`, and call it from `touch`.
4. **The decision group does not change.** One row still means one decision, for both
   sources. Nothing here touches `itemId`, `status`, `matchedBy` or `decidedAt`.
5. **The entry view carries the kind of each price.** The contract schema of a source
   entry price gains `sourceKind`, with `openapi.json` and `wire-types.ts` regenerated.
   The back office shows it where it lists the prices of a row. No other screen changes.
6. **One migration.** It adds the column, fills it, and swaps the unique key. The kind of
   an existing price row comes from the run in `runId`: the `sourceKind` of the input of
   a `FILE_IMPORT` run, and the kind of the adapter for a walk
   (`run-executor.service.ts`, `sourceKindOf`). A price row with no run, or with a run
   the table no longer holds, takes the kind of its entry. The migration states both
   counts in its log.

### Scope

- In: the harvester (the price entity and its migration, `source-ingest.ts`,
  `source-snapshot.ts`, `source-entry-write.ts`, `harvest.mappers.ts`, their specs),
  `libs/luna-shopper/contracts` (the price of a source entry), the two generated files,
  and the one place in `libs/luna-shopper-admin/feature-harvest` that lists the prices of
  a row.
- Out: `entryKey` and `externalId`, the unique index of the entries, the matching ladder,
  catalog, the leaflet tool, the Deza adapter, velista.

### Constraints

- `externalId`, `sizeFormat` and the stored name of a row a walk owns must not change
  through a leaflet import. They are the key and the review text.
- A leaflet observation still reads no pack count and writes none (plan `0162`).
- No automated match binds a printed name to a product (CLAUDE.md). This plan binds
  nothing.
- Never write a price to `supermarket_items` directly.
- No release task. Both clusters hold no source rows. The migration must still be correct
  on a database that holds them, because slot 1 is restored into the clusters later
  (k8s plan `0012`).

### Action boundaries

- Proceed with code, the migration, specs and an ephemeral slot.
- Do not revert run `794056b6` and do not import a leaflet on slot 1. That is the owner's
  step, in section 3.
- Stop and ask if a harvest run's input does not hold the kind of a file import for some
  run, so that target 6 cannot tell a leaflet price from a website price.

### Progress evidence

- An integration spec on real Postgres: a website run creates a row, a leaflet import
  with the same name and format follows, and the row keeps `OFFICIAL_WEB`, its name, its
  brand and its size. It holds one price row of kind `OFFICIAL_LEAFLET`, and the import
  counts it `unchanged`.
- The other order: a leaflet import creates the row, a website run takes it over once,
  and a second leaflet import changes nothing in the source group.
- A spec on `SourceEntryPriceWriter`: accepting a website row that holds a leaflet price
  sends `OFFICIAL_LEAFLET` to `catalog.addPrices`.
- A spec with a website price and a leaflet price for one scope on one row: both price
  rows exist after both runs.
- A migration spec with a leaflet price on a website row, a website price, and a price
  with no run.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

## 1. Not in this plan

- Two leaflets of one chain for two regions on one row. Plan `0086` D3 already keeps one
  price per scope for them.
- Mercadona. Its walk keys a row on the product id and its leaflet on the hash, so the
  two never share a row. Rung 4 proposes the match.
- A leaflet size that a walk does not print. The two toys lose their leaflet size under
  target 3. A person types it on the create.

## 2. Decisions, decided by the owner, 2026-10-06

Both are closed. The builder builds them and asks about neither.

**A. One row or two.**

- 2A, decided by the owner, 2026-10-06: one shared row, as plans `0085` and `0086`
  decided, with the kind on the price (this plan). A person decides once, and both
  sources resolve through the row.
- 2B, rejected: `sourceKind` in the unique index of the entries, so each source keeps a
  row. Every product that both print is decided twice, and the existing shared rows
  cannot be split, because the leaflet text of each is gone.

**B. Who owns the text of a shared row.**

- 2C, decided by the owner, 2026-10-06: the website walk (target 3). A leaflet only adds
  prices. A walk reads fields, and a leaflet is read by a model from a picture.
- 2D, rejected: whoever created the row. Simpler to state, and a row that a leaflet named
  first never takes the website's link, category path or pack count.

## 3. The data already written

Only local slot 1 holds the eight rows. Nothing is repaired by hand.

- **The eight rows are right as they are once this plan lands.** They say `OFFICIAL_WEB`
  and hold the website's text, which is what target 3 gives a row that a walk owns. A
  new Deza website run changes nothing on them.
- **Their eight leaflet price rows take the kind `OFFICIAL_LEAFLET` in the migration**,
  from run `794056b6`.
- **The six bound rows** keep their product. The leaflet price that each wrote to catalog
  was written while the row said `OFFICIAL_LEAFLET`. **Not confirmed:** read
  `item_prices` for the six products on slot 1 and check that the row of run `794056b6`
  has that kind, before the dumps are restored anywhere.
- **The two unresolved rows** (`2a819e98` and `b1235864`) wait in the website queue.
  When a person accepts or creates from one, its leaflet price is written as a leaflet
  price.
- **Land this plan before the revert of run `794056b6` and the second import** that
  stage B left for the owner. Without it, the second import turns the eight rows into
  leaflet rows again and rewrites their text. With it, the import writes prices and
  moves the seen fields only.
