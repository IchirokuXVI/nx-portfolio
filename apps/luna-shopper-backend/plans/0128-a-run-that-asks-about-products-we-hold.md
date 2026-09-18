# 0128 A run that asks about products we hold

> Third of four plans that bring Open Food Facts and Open Beauty Facts into Luna Shopper. It
> needs `0126` (the library that reads them) and `0127` (where catalog keeps what was read), and
> it is the only plan that fetches anything. `0129` builds on it to keep a copy of the photo.
>
> Every run the harvester has today finds something we did not hold: a chain's assortment, the
> shops of a chain or of a postal code, a chain's leaflet. What a walk or a leaflet finds goes
> through the ladder of plan `0086` into `source_catalog_entries`. Open Food Facts is none of
> that. It has no chain, no price and no assortment of ours, and the question it answers is
> about products catalog **already holds**: what is behind this barcode.
>
> So this is a fourth run mode, `PRODUCT_FACTS`, and not an adapter under `CATALOG_DISCOVERY`.
> It reads the barcodes catalog holds, asks one of their two databases about exactly those, and
> writes the answers into `item_facts`. It never creates an item, never touches a source entry,
> and never finds a barcode by name.
>
> **How it fetches is their own request, not our convenience.** Their documentation asks that
> anything above a few hundred products comes from the nightly export and not from the API. So
> a whole pass reads the export, a refresh reads the daily delta files, and the API is for a
> named handful of products.
>
> Prerequisite reading: `0103` in full (a runner reports and the orchestrator writes), `0038`
> section 8.1 (every run is started by a person), `0083` (what is a row and what is a variable),
> plans `0126` and `0127` in full, and the migration `1756900000000-OneSourceProduct.ts` from
> line 294, which is the enum change this plan repeats.

## Brief for the agent

### Objective

Add `HarvestRunMode.PRODUCT_FACTS`: the spawn rules of section 3, the `ProductFactsRunner` and
its report of section 4, the `FactsReportSink` of section 5, the `product_facts_sources` table
of section 6, the three `CatalogClient` methods, and the three new fields on the gateway's
spawn DTO. Regenerate the OpenAPI document and the wire types.

### Context

- `HarvestRunMode` is `libs/luna-shopper/contracts/src/lib/enums/harvest.enums.ts:26` with three
  values. `harvest_runs.mode` is a Postgres enum, `harvest_run_mode`.
- **`harvester/src/migrate.ts:36` runs every pending migration in one transaction**
  (`transaction: 'all'`). Postgres refuses to use an enum value in the transaction that added
  it, so `ALTER TYPE ... ADD VALUE` followed by an index that names the value fails at deploy
  even when the two are separate migration files. `1756700000000-LeafletImport.ts` added a value
  that way and got away with it only because nothing in that transaction used the value, which
  its header says. This plan needs an index that names the new value, so the precedent is
  `1756900000000-OneSourceProduct.ts` from line 294: rename the type, create it again with every
  value, alter the column with a cast, drop the old type, and recreate
  `uq_harvest_run_active_store_discovery`, which depends on it. A type created in the
  transaction can be used in it.
- One active run is enforced by partial unique indexes and not by a query (the doc comment on
  `create`, `harvest-run.store.ts:91`, explains why): `uq_harvest_run_active` on `supermarketId`
  where it is not null, and `uq_harvest_run_active_store_discovery` on `mode` for runs with no
  chain.
  `harvest_runs.supermarketId` and `sourceId` are already nullable.
- `RunExecutor` (`run-executor.service.ts`) switches on `run.mode` at :379. It builds a
  `RunReportSink` for every mode except `FILE_IMPORT` at :342, and that sink is constructed from
  a supermarket, scopes, places and shops, none of which this mode has.
- `HarvestRunService` (`harvest-run.service.ts`): `spawn` :180, `start` :257 with
  `needsSource` at :264, `validate` :528, `validateFileImport` :948, the revert guard
  `PRICE_WRITING_MODES` near :372. `requireHarvesting` :244 is the `HARVEST_ENABLED` switch.
- `HarvestRunPresetService` refuses a `FILE_IMPORT` preset at :150. Presets belong to a chain.
- `RunContext` (`run-context.ts`) gives a runner `runId`, `acquire`, `setStage`,
  `setTotalPlanned`, `setReport`, `report(counters)`, `heartbeat`, `warn`, `flush`. The reaper
  fails a run whose heartbeat is older than `HARVEST_STALE_AFTER` (900 seconds).
- `harvest.module.ts:84` states the rule this plan keeps: no runner is given a writer. A runner
  is constructed with its fetching seam and its configuration and nothing else.
  `RecordingRunReport` (`run-report.ts:139`) is the test double pattern to copy.
- `CatalogClient` (`catalog-client.service.ts`) is the harvester's only door into catalog: NATS
  only, opaque ids, the service actor from `HARVESTER_ACTOR_ID`.
- The spawn contract is `SpawnHarvestRunRequest` (`harvest.messages.ts:809`), its schema in
  `schemas/messages/harvest.schemas.ts`, and the gateway's `SpawnHarvestRunDto`
  (`gateway/src/app/harvest/harvest.dto.ts:62`). `HarvestRunPresetInputDto` derives from it.
- The back office keys nothing on `HarvestRunMode`, so a fourth value compiles. It shows the
  raw value until its own plan adds a label and a form.
- The harvester's `package.json` is a hand written runtime manifest. This plan adds no
  dependency, so it does not change.
- The latest harvester migration is `1757400000000-RunPresets.ts`. Check again before naming.

### Target state

Every acceptance criterion in section 10 holds, and
`npx nx run-many -t lint test -p luna-shopper-backend-harvester luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models`
plus `luna-shopper-backend-harvester:test-integration` are green, the harvester, gateway and
catalog builds pass, and `openapi.json` and the wire types are regenerated.

### Scope

- Work only in: `libs/luna-shopper/contracts` (the run mode, `HarvestFactsFetch`, three
  `HarvestWarningCode` values, the spawn request and its schema), one new harvester migration
  and `db/migrations/index.ts`, a new entity and `entities/index.ts`, `harvest-run.store.ts`
  (the `DOCUMENT_INDEX` doc comment only, which counts the partial indexes), new files
  `product-facts.runner.ts`, `facts-report.ts`, `facts-report.sink.ts` and
  `product-facts-source.store.ts` under `harvester/src/app/harvest/`, `run-executor.service.ts`,
  `harvest-run.service.ts`, `harvest-run-preset.service.ts`, `catalog-client.service.ts`,
  `harvest.module.ts`, the gateway's `harvest.dto.ts`, their specs, and the generated
  `openapi.json` and `wire-types.ts`.
- Do NOT touch: `RunReport`, `RunReportSink`, `SourceIngest`, `matching.ts`, any existing
  runner, `ADAPTER_KEYS`, `ADAPTER_CAPABILITIES`, `supermarket_sources`, catalog,
  `libs/luna-shopper/open-facts`, the back office, `app-config.ts`, the config map, `_env.tpl`
  or `luna-slot.sh`.

### Constraints

- **No new environment variable.** `HARVEST_ENABLED` and `HARVEST_USER_AGENT` already cover this
  mode. The hosts are constants of the library, and a test passes a fake `fetch`.
- **No adapter key.** `ADAPTER_KEYS` names how a chain is walked. This is not a chain.
- The runner writes nothing and is handed no writer (plan `0103`). Every `FactsReport` method is
  synchronous and returns nothing.
- Never create an item, never write a source entry, never call `item.search`.
- The API path takes at most 100 products a run. The spawn enforces it, not the form.
- `markMissing` is sent only after an export that was read to its end.
- Regenerate `openapi.json` and the wire types with their generators, never by hand.

### Action boundaries

- Proceed with in scope edits, the migration, unit and integration specs, and the generators.
- Do NOT start a run against the live food export while building. It is 13 GB. Prove the mode
  with a fake `fetch` over the fixtures of plan `0126`. One live run against **beauty** on a
  slot, which is 98 MB, is welcome as evidence and is not required.
- Stop and ask if plan `0126` or `0127` is not merged, naming what is missing. Stop and ask if
  the enum rebuild cannot keep both partial indexes.

### Progress evidence

Report after the migration with its integration spec, after the spawn rules with their spec,
after the runner and the sink with theirs, and after the generators. Each report cites test
output.

## 1. What is being built

| Piece                                              | Where                                        |
| -------------------------------------------------- | -------------------------------------------- |
| `HarvestRunMode.PRODUCT_FACTS`, `HarvestFactsFetch` | contracts, one migration                    |
| `uq_harvest_run_active_product_facts`              | the same migration                           |
| `product_facts_sources`                            | entity, the same migration, a store          |
| `factsSource`, `factsFetch`, `itemIds` on a spawn  | contracts, schema, gateway DTO               |
| Spawn rules, preset and revert refusals            | `HarvestRunService`, `HarvestRunPresetService` |
| `ProductFactsRunner`, `FactsReport`                | two new files                                |
| `FactsReportSink`                                  | its own file, for the reason `run-report.sink.ts` gives |
| `listFactsTargets`, `upsertItemFacts`, `markFactsMissing` | `CatalogClient`                       |
| `FACTS_UNREADABLE`, `FACTS_REJECTED`, `FACTS_QUEUE_BEHIND` | `HarvestWarningCode`                 |

## 2. The mode and its lock

The migration rebuilds `harvest_run_mode` with `STORE_DISCOVERY`, `CATALOG_DISCOVERY`,
`FILE_IMPORT` and `PRODUCT_FACTS`, exactly the way `OneSourceProduct` rebuilt it, and recreates
`uq_harvest_run_active_store_discovery`. Then:

```sql
CREATE UNIQUE INDEX "uq_harvest_run_active_product_facts"
  ON "harvest_runs" ("mode")
  WHERE mode = 'PRODUCT_FACTS' AND status IN ('PENDING', 'RUNNING')
```

**One facts run at a time, across both databases.** Their limit is per IP address and both
databases sit behind the same servers, and two 13 GB streams at once help nobody. The store
already turns a violation of any `uq_harvest_run_active*` index into "a run is already in
progress", and `DOCUMENT_INDEX` is still the one name it tells apart.

A `PRODUCT_FACTS` run has `supermarketId`, `sourceId` and `priceScopeId` null.

## 3. Starting one

`SpawnHarvestRunRequest` gains:

| Field         | Type                        | Rule                                                 |
| ------------- | --------------------------- | ---------------------------------------------------- |
| `factsSource` | `ItemFactsSource`           | required for this mode, refused for every other      |
| `factsFetch`  | `HarvestFactsFetch`         | `AUTO` (default), `EXPORT`, `DELTA`, `API`           |
| `itemIds`     | uuid array, 1 to 100        | required for `API`, refused for every other fetch    |

`validate` gains a branch for the mode, beside `validateFileImport`. **It refuses every field of
`SpawnHarvestRunRequest` that is not the credential, `mode` or one of the three above**, each
with a sentence that names the field: `supermarketId`, `priceScopeId`, `priceScopeIds`,
`postalCode`, `country`, `radiusMetres`, `postalCodes`, `brandKeys`, `sourceKind`, `document`,
`validFrom`, `validUntil` and every walk option. The test walks the keys of the request type, so
a field a later plan adds is refused here until somebody decides otherwise. A field that does
nothing is a lie in a form (the rule the `priceScopeId` doc comment states), and an ignored
`document` is 16 MB of it. The
payload stored in `harvest_runs.input` is `{ factsSource, factsFetch, itemIds? }`.

`start` treats the mode like `FILE_IMPORT`: `needsSource` is false, so no `SupermarketSource` is
looked up and no per chain switch applies. `HARVEST_ENABLED` still refuses the spawn.

A preset of this mode is refused, because a preset belongs to a chain. A revert is refused by
the existing guard, because the mode is not in `PRICE_WRITING_MODES`. Facts are not reverted:
the next run overwrites them by revision, and a wrong record is suppressed in catalog.

### 3.1 The four ways to fetch

| `factsFetch` | Reads                                         | For                                      |
| ------------ | --------------------------------------------- | ---------------------------------------- |
| `EXPORT`     | the whole nightly export, filtered as it streams | the first pass, and any pass after a gap |
| `DELTA`      | the daily delta files since the watermark     | a refresh inside the 14 days they keep   |
| `API`        | one search for the named products             | a product added today, one refresh       |
| `AUTO`       | `DELTA` when the watermark is covered, else `EXPORT` | what a person normally presses    |

A `DELTA` asked for by name whose window was missed fails the run with a sentence that says to
run an export. It does not fall back quietly, because the two differ by 13 GB and a person who
named one meant it. `AUTO` is the one that chooses.

## 4. The runner

```ts
export interface ProductFactsInput {
  dataset: OpenFactsDataset;          // FOOD or BEAUTY, mapped from factsSource
  fetch: HarvestFactsFetch;
  wanted: ReadonlySet<string>;        // barcodeKey values
  codes: readonly string[];           // the barcodes as we hold them, for API only
  since: Date | null;                 // the watermark, null when there is none
}

export interface FactsReadSummary {
  fetch: 'EXPORT' | 'DELTA' | 'API';  // never AUTO: what was really read
  lines: number;
  matched: number;
  malformed: number;
  bytes: number;
  exportLastModified: Date | null;    // EXPORT only
  deltaFiles: readonly string[];      // DELTA only
  deltaTo: Date | null;               // DELTA only, the `to` of the last file
}

export interface FactsReport {
  found(product: OpenFactsProduct): void;
  finished(summary: FactsReadSummary): void;
}
```

`ProductFactsRunner.run(context, report, input)` is constructed with `ConfigService` and a
`fetchImpl` seam and nothing else. It:

1. Resolves `AUTO`: `listDeltas`, then `deltasSince(deltas, since)`. Null, or no watermark,
   means `EXPORT`.
2. Says what it chose before it reads, with `context.setStage('reading', 'export')` or the
   names of the delta files, so that a person watching a 13 GB read knows that it is one.
3. Reads with the library: `readExport`, `readDeltas`, or `OpenFactsClient.products` with the
   codes. When the search still answers 503 after its retries, the `API` path reads each code
   with `product()` at the product floor. 100 codes is under seven minutes.
4. Normalizes every document and calls `report.found`. A document that normalizes to null is a
   `FACTS_UNREADABLE` warning and a `failed` count, never a throw.
5. Calls `report.finished(summary)` once, and only when the read reached its end. A read that
   threw, was aborted or was truncated never calls it, and that is the whole of how the sink
   knows that an export was whole.

The reader's `onProgress` returns the promise of `context.heartbeat()` followed by
`context.setStage('reading', '<lines> lines')`, both of which are asynchronous, and the reader
awaits it (plan `0126`, section 3.1). The food export takes longer than the reaper's 900
seconds, and a run that is reading is not a run that died. `context.acquire` is passed to
the client for the `API` path. The abort signal is passed to every reader.

## 5. The executor and the sink

For this mode the executor:

1. Pages `itemFacts.listTargets` to the end. An `API` run sends its `itemIds` with the same
   message, and fails with a sentence that names them when fewer targets come back than it
   named, because a named item with no barcode cannot be asked about.
2. Builds `wanted`: `barcodeKey(ean)` to the item ids that make it. A null key is counted
   `skipped`, and the run's report says how many were restricted numbers. Two items can make one
   key, since `ean` is unique as text and `0123` and `123` are two texts. Both get the facts.
3. Sets `totalPlanned` to the number of keys and reads the watermark from
   `product_facts_sources`.
4. Runs the runner with a `FactsReportSink`, then drains it.
5. After the drain, and only when `finished` was called, writes the watermark (section 6) from
   the summary. Then writes `harvest_runs.report` (section 7).

`FactsReportSink` is the write half, in its own file for the reason `run-report.sink.ts` states.
Work is appended to one serial promise chain and a failure surfaces at `drain`.

- `found(product)`: for every item under the product's key, skip it when the held revision for
  this source equals `product.revision` and the row is not marked missing, and count
  `unchanged`. Otherwise build the entry of plan `0127` section 5.1: the columns from the
  product, `sourceUrl` from `productPageUrl`, and `images` with `url` and `thumbnailUrl` from
  `imageAddress` at sizes `400` and `200`. A crop that lists no `400` is left out, and
  `thumbnailUrl` is null for a crop that lists no `200` (plan `0127`, section 3).
- Entries flush to `CatalogClient.upsertItemFacts` in batches of 50, or sooner when a batch
  passes 4 MB of JSON. The answer adds to `created`, `updated` and `unchanged`. Every
  `rejected` entry becomes a warning that names the item and the reason, and counts `failed`.
- `finished(summary)` keeps the summary for the executor. When `summary.fetch` is `EXPORT`,
  every target that holds facts for this source and was not found goes to `markFactsMissing` in
  chunks of 1,000, and `notFound` is the number of keys never found.
- The three warnings are `FACTS_UNREADABLE` (the runner, a document that normalizes to null),
  `FACTS_REJECTED` (catalog refused an entry) and `FACTS_QUEUE_BEHIND` (below).

**The chain keeps up, and the sink checks that it does.** Matches arrive a few a second at most
and a flush is milliseconds, so the queue stays near one batch although the runner cannot await
it. The sink warns once when more than 500 products are waiting, so the claim is measured on the
first real run and not assumed.

## 6. What the harvester remembers

`product_facts_sources`, one row per `ItemFactsSource`, created on first use:

| Column            | Type             | Notes                                              |
| ----------------- | ---------------- | -------------------------------------------------- |
| `source`          | enum, unique     |                                                    |
| `watermarkAt`     | timestamptz null | everything they changed before this is held        |
| `lastExportRunId` | uuid null        |                                                    |
| `lastRunId`       | uuid null        |                                                    |

After a succeeded `EXPORT`, `watermarkAt` is the export's `Last-Modified` minus 24 hours. The
file takes hours to write, so a product edited while it was written can be in neither the file
nor a later window, and a day of overlap costs a few rows that answer `unchanged`. After a
succeeded `DELTA` it is the `to` of the last file read. `API` runs and failed runs never move
it.

It is a table and not a key in `harvest_runs.report`, because that column's own doc comment
says it is free form and never queried.

## 7. What a run says about itself

Counters: `processed` is products found, `created`, `updated` and `unchanged` are catalog's
answers plus the sink's own skips, `notFound` is keys never found (meaningful after an export
only), `skipped` is restricted barcodes, `failed` is rejected entries and unreadable documents.

`harvest_runs.report`: `{ fetch, exportLastModified, deltaFiles, lines, matched, malformed,
bytes, restrictedBarcodes, watermarkBefore, watermarkAfter }`.

**A delta cannot say that a product was deleted**, so only an export marks a row missing. A
back office that refreshes by delta for months never learns about a deletion, which is one more
reason `AUTO` falls back to an export by itself when the window is missed.

## 8. What this plan does not do

- **No schedule.** Every run is started by a person (plan `0038`, section 8.1). The 14 day delta
  window is why `AUTO` exists, not a reason to add a timer.
- **No item from a record.** A barcode we do not hold is not read, however good their record.
- **No barcode for an item that has none.** Plan `0085` section 10 stands.
- **No per database switch.** Both are one polite reader with the global switch over it. When a
  third database or a reason to turn one off appears, `product_facts_sources` is where the
  column goes, the way plan `0083` put a chain's switch on its row.
- **No back office form.** The spawn accepts the mode. The screen is a plan in
  `apps/luna-shopper-admin/plans/`.
- **No photo bytes.** Plan `0129`.

## 9. Tests

- Harvester integration (`luna-shopper-backend-harvester:test-integration`):
  - the migration up and down with rows of every old mode present, both old partial indexes
    still enforced, and a second `PRODUCT_FACTS` run refused while one is `RUNNING`.
  - the watermark: set by an export, moved by a delta, untouched by an `API` run and by a failed
    run.
- `harvest-run.service.spec.ts`: each refusal of section 3 with its sentence, `itemIds` above
  100, `itemIds` without `API`, `HARVEST_ENABLED` off, a preset of this mode, a revert.
- `product-facts.runner.spec.ts` with a fake `fetch` and a recording report: `AUTO` with no
  watermark, with a covered watermark and with a missed one, a named `DELTA` whose window was
  missed, the 503 fallback of the `API` path, `finished` once after a whole read, a truncated
  export that fails the run and never calls `finished`, abort, and the awaited heartbeat.
- `facts-report.sink.spec.ts`: skip on a held revision, no skip when the row is marked missing,
  two items under one key, the batch of 50 and the 4 MB cut, a rejected entry as a warning, the
  image addresses, a crop with no 400 pixel file left out, `markFactsMissing` after an `EXPORT`
  summary only, the queue warning.
- `catalog-client.service.spec.ts` for the three methods.
- Gateway HTTP spec: the three new fields and their validation.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass after regeneration.

## 10. Acceptance criteria

- [ ] `harvest_run_mode` holds four values after the migration, both earlier partial indexes
      survive it, and it reverts cleanly.
- [ ] A `PRODUCT_FACTS` spawn that sends any field other than `mode`, `factsSource`,
      `factsFetch` and `itemIds` is refused, and one with `HARVEST_ENABLED` off is refused.
- [ ] Two facts runs cannot be active at once, for either database.
- [ ] `AUTO` reads deltas when the watermark is covered and the export when it is not, and a
      named `DELTA` whose window was missed fails with a sentence that says what to run.
- [ ] An `API` run takes at most 100 items and never moves the watermark.
- [ ] A product whose revision is held is not sent to catalog.
- [ ] Rows are marked missing only after an export that was read to its end.
- [ ] The run reaches `SUCCEEDED` over the beauty fixtures with a fake `fetch`, and the
      heartbeat moves while it reads.
- [ ] No runner holds a writer, and `RunReport`, `RunReportSink` and `SourceIngest` are
      unchanged.
- [ ] No environment variable, config map entry or `luna-slot.sh` line was added.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and their specs pass.

## 11. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-harvester luna-shopper-backend-gateway luna-shopper/contracts
npx nx run luna-shopper-backend-harvester:test-integration
npx nx run-many -t build -p luna-shopper-backend-harvester luna-shopper-backend-gateway luna-shopper-backend-catalog
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-admin/models
```
