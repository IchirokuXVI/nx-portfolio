> **PR:** [#654](https://github.com/IchirokuXVI/nx-portfolio/pull/654)

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

## 4. What was built, and the choices the builder made

Every target state is built. This section records the places where the plan was silent or
where the build differs from its text, and what only the owner can settle.

### The column can be null, and the migration guesses nothing

Target 1 says `not null`, and target 6 gives a price with no readable run the kind of its
entry. The build differs on both, on the instruction the builder was given with the plan:
the migration runs on the one curated catalog, and a price whose kind cannot be known
stays without a kind.

- `source_entry_prices.sourceKind` is nullable. Every run writes it. Null exists only on
  a row from before this plan.
- The kind of the entry is never copied to a price. That kind is the one a later run may
  have rewritten, which is the defect this plan exists for.
- The unique key is `UNIQUE NULLS NOT DISTINCT ("entryId", "priceScopeId", "sourceKind")`,
  named `uq_source_entry_prices_scope_kind`. Two nulls count as equal, so a row and a
  scope hold one price of no kind at most, as before. Every database of the service is
  Postgres 16.

A price with no kind is shown in the queue as "Source unknown, not written". An accept
does not send it to catalog. The settle of plan `0191` asks its run once more, and keeps
every price at its scope when the run does not say.

### The migration, exactly

`SourceEntryPriceKind1759200000000` in the harvester. Catalog has no migration.

1. It adds the nullable column.
2. A price of a `FILE_IMPORT` run takes the `sourceKind` of the input of that run, when it
   is `OFFICIAL_API`, `OFFICIAL_WEB` or `OFFICIAL_LEAFLET`.
3. A price of any other run takes the kind of the adapter of the chain of that run:
   `OFFICIAL_API` for `mercadona-api`, `lidl-api` and `dia-api`, and `OFFICIAL_WEB` for
   `deza-web`, `carrefour-web` and `eljamon-web`. Those are the six adapters that walk a
   storefront. Both lists are frozen in the migration file, and no adapter falls to a
   default.
4. A price stays without a kind in five cases: it names no run, its run is not in
   `harvest_runs`, the run is a file import whose input names no official kind, the run is
   a walk of a chain with no row in `supermarket_sources`, or the run is a walk of a chain
   whose adapter is `osm-places`, `manual` or a key the migration does not know.
5. It prints the count of rows stamped with each kind, and the count left without a kind
   for each of those five cases.
6. It drops `uq_source_entry_prices_scope` and adds the new key.

It updates one column of `source_entry_prices` and no other table. It changes no price,
no run id, no instant and no row of `source_catalog_entries`, and it deletes nothing. The
down restores the old key and drops the column. The down refuses, and deletes nothing,
while a row holds two prices for one scope.

**On a copy of the dump of slot 1** (`after-0189/after-run/harvester.dump`, restored into
a scratch database of an ephemeral slot):

- 25,470 price rows before and after, with the same fingerprint over every old column.
- 25,861 source rows, with the same fingerprint.
- Stamped: 18,383 `OFFICIAL_API`, 6,891 `OFFICIAL_WEB`, 196 `OFFICIAL_LEAFLET`.
- Left without a kind: 0. The dump holds no price without a run and no price of a run
  that is gone, and its one file import names its kind.
- The 196 prices of run `794056b6` are all `OFFICIAL_LEAFLET`: 188 on rows that say
  `OFFICIAL_LEAFLET`, and 8 on the eight rows that say `OFFICIAL_WEB`.
- The eight rows keep their kind, their name, their status and their product.

**The kind of each run, in both databases.** After the migration on the copy, every
distinct pair of run and kind in `source_entry_prices` was put beside the pairs of
`sourceRunId` and `sourceKind` in `item_prices` of the catalog dump of the same snapshot.
Six runs hold prices, each under one kind, and the two databases agree on all six: four
walks as `OFFICIAL_API`, one as `OFFICIAL_WEB`, and the leaflet import as
`OFFICIAL_LEAFLET`. No run differs.

The fallback `sourceKindsOfRuns` draws the same line as the migration since the review:
it answers for the six adapters and for no other.

### The read that section 3 left open

Confirmed on a copy of `catalog.dump` of the same snapshot. Each of the six bound
products holds one `item_prices` row of run `794056b6`, and all six are
`OFFICIAL_LEAFLET`. Run `794056b6` wrote 108 price rows to catalog, all of them
`OFFICIAL_LEAFLET`. No leaflet price of that run is in catalog under another kind.

### A walk owns the text: what counts as a walk

`writesSourceGroup` in `source-snapshot.ts` is the rule, and `touch` calls it.

- A walk is a run of kind `OFFICIAL_API` or `OFFICIAL_WEB`.
- A walk of one kind that observes a row of the other walk kind writes it, as before.
  Which of two walks owns a row is not a question this plan asks.
- An observation that is not a walk leaves a row that a walk owns alone. That is a
  leaflet today, and it will be a receipt when backlog `0008` is built.
- A row that a walk has taken over keeps its `firstRunId`. A revert of the leaflet run
  that created it thus still does not delete it, because its `lastRunId` moved.

One point the plan did not name. A full observation is counted in the EAN index of the
chain before the ladder runs, because it writes its EAN to its row, null included. A
leaflet tile prints no barcode. For a row that a walk owns, that null is not written to
the row any more, so it is not counted either. Without that, a tile took the barcode of
a walked row out of the count, and a second row that shares the barcode could bind by
it.

### A leaflet offer that is sold another way than its row

Found by the review of the pull request. A leaflet does not write `soldByWeight` on a
row that a walk owns. A leaflet offer by the kilo on a row that the walk describes as a
fixed pack would thus be stored, and sent to catalog for a bound row, as the price of
that pack. The reverse is the same error.

So when an observation does not write the source group of its row, and it says
`soldByWeight` differently from the row, **no price of that observation is written**.
The row is still seen. The run counts the observation (`pricesSoldAnotherWay` in the
counters of the ingest) and warns with the code `PRICE_SOLD_ANOTHER_WAY`, which names the
row and the offer. An earlier leaflet price of the row stays as it is.

**A choice the owner can reverse.** The other answers are to store the price and send
none, or to let the leaflet set the flag of the row. To reverse it, remove
`sellsAnotherWay` from `writeChunk` in `source-ingest.ts`. The builder chose no price,
because such a tile often names another product than the row: a loose cheese beside a
packed one.

### A row whose only open price has no kind

Also from the review. An accept sends no price of no kind, and the two checks that
decide the offer with no price (`writePricelessOffers` for a bind,
`writePricelessOffersForRun` for the end of a run) counted that price as a price. The
product then had neither a price nor an offer at the chain. Both checks now count only a
price that says its kind (`sendablePrices` in `source-entry-write.ts`). The accept answer
names the price in `pricesWithheld`, with `kindUnknown: true` and no other row, and the
bulk route names it in `priceSkips`.

### A revert of the walk that took a row over

A walk that takes over a row that a leaflet created writes its own text and kind on it.
A revert of that walk does not put the leaflet's text back: the row was first seen by the
leaflet run, so the revert keeps it, and it deletes only the prices of the walk. The row
then says `OFFICIAL_WEB`, holds the walk's text, and holds leaflet prices alone. No later
leaflet import rewrites it, because a leaflet leaves a row that a walk owns alone. The
next walk of the chain writes the text again. Until then the row describes the product
as a run that was reverted did. Nothing repairs this by itself, and the owner decides
whether a revert must give such a row back to the leaflet.

### An accept, and the comparison with other rows

- The writer reads the kind from each price row. A row that holds a website price and a
  leaflet price for one scope sends both, each with its own run.
- The other bound rows of the chain are read whatever the kind of the row is, and
  compared by the kind of each price. A leaflet price on a website row is thus compared
  with the leaflet price of a row that only a leaflet described. Before, two rows of two
  kinds were never compared.
- `scopeSharedWith` on the entries of a product follows the same rule: two rows share a
  scope when both hold an open price of one kind there.

### How the settle of plan 0191 reads the kind

`SourceEntrySettler` takes the kind from the price row. It asks `sourceKindsOfRuns` only
for the prices that have none, and it asks nothing when every price has a kind. A price
that neither answers has no kind, and plan `0191` then keeps everything at its scope, as
before. No spec of plan `0191` was weakened. The fixtures of its integration specs now
stamp each price with the kind of its run, as a run does, and each keeps one case with a
price of no kind.

One guard of plan `0191` stays in use. Catalog keeps a price that was accepted under the
wrong kind before this plan (`pricesKeptAsWritten`). The six bound rows of slot 1 need
none of it: their catalog rows have the right kind.

### The back office

The queue card lists the prices of a row. Each line now names what stated it, with the
existing `catalog.priceSourceKind` texts, and a line is tracked by scope and kind. One
new text, `harvest.entries.prices.noKind`.

### What proves it

- `harvester/src/app/harvest/shared-source-row.integration.spec.ts`, on real Postgres:
  both orders of a website run and a leaflet import, the two price rows of one scope, the
  counters, and an accept that sends `OFFICIAL_LEAFLET`.
- `harvester/src/app/db/source-entry-price-kind.migration.integration.spec.ts`, on a
  probe database: eighteen cases of run and row, one for each adapter key among them, the
  log line, the key, and the down.
- `settle-across-services.integration.spec.ts`: a row with two kinds at one scope, a
  move that carries a leaflet price as a leaflet price, and the fallback to the run.
- `source-ingest.spec.ts`, `source-entry-write.spec.ts` and `source-entry-settle.spec.ts`
  for the same rules without a database.

### For the owner to decide

- **The leaflet queue.** `SourceEntryService.list` still filters on the kind of the row.
  A row that a walk owns is in the website queue also when a leaflet prices it. The plan
  says so for the two unresolved rows, and the build changes nothing here. A filter "has
  a leaflet price" would be a new plan.
- **The export of a leaflet run.** It still reads the rows whose `lastRunId` is the run.
  It holds the eight offers again after the second import, until the next website run
  observes them. The text it exports for a shared row is the website's.
- **A price with no kind.** None exists on slot 1. If one ever does, it stays beside the
  new prices of its scope for good, is never sent, and makes the settle state nothing at
  that scope. The other choice is to let the first run that prices the scope replace it.
- **The hint of an export.** `dominantKind` in `harvest-export.ts` now reads the kind of
  the prices of the run, and the kind of the row only for a row with no price. The export
  of a leaflet run thus proposes `OFFICIAL_LEAFLET` also when its rows are walk owned.
- **The size of the two toys.** As section 1 says, the leaflet size of a row that a walk
  owns is not stored. The two toys have none today, and the second import does not
  bring it back.
