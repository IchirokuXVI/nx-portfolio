# 0217: a run counts each kind of write once

> The counters on `harvest_runs` are the live numbers of a run. Four of them count more than one
> thing today. `updated` counts the source rows that a run changed and also each price that
> catalog inserted. A Carrefour EAN backfill counts each EAN two times in `processed` and in
> `updated`, and it counts a page with no EAN as `notFound`. Three runners count `processed` in
> their own unit and the ingest adds products to it, so the count runs past `totalPlanned`. This
> plan makes each counter count one kind of thing, writes the definitions where the next reader
> finds them, and corrects the old runs where the stored report makes the correction exact. No
> field is added or renamed, so the contract, `openapi.json` and the admin wire types keep their
> shape.
>
> Prerequisite reading: `0038` sections 4.2 and 6.6 (the counters and the 10 second flush), `0081`
> section 7 (`skipped`), `0086` (one ingest for every run), `0103` (a runner reports, the
> orchestrator writes), `0090` section 12.1 (the Carrefour EAN backfill), `run-context.ts`,
> `source-ingest.ts`, `run-report.sink.ts`, `run-executor.service.ts`, admin plan `0044` section 2
> (the "Wrote" column).

## Brief for the agent

### Objective

Make each counter of `harvest_runs` count one kind of thing in every run mode and adapter, as
sections 2 to 4 state, and correct the stored counters of old runs as section 5 states.

### Context

All paths are under `apps/luna-shopper-backend/harvester/src/app/` unless stated.

- The counters are seven integer columns, `processed`, `created`, `updated`, `unchanged`,
  `notFound`, `skipped` and `failed` (`entities/harvest-run.entity.ts:96` to `:127`). They were
  created by `db/migrations/1756200000000-InitialHarvesterSchema.ts:83` to `:88`, and `skipped` by
  `1756700000000-LeafletImport.ts:49`.
- Every counter moves through `RunContext.report` (`harvest/run-context.ts:63`), which adds in
  memory and flushes at most each 10 seconds through `HarvestRunStore.addCounters`
  (`harvest/harvest-run.store.ts:467`, column list at `:89`).
- The ingest reports one `processed` for each observation and one of `created`, `updated` or
  `unchanged` (`harvest/source-ingest.ts:529` to `:540`). A partial observation for an unknown row
  reports `processed` alone (`:490`).
- `SourceIngest.writePrices` reports `{ updated: result.inserted }` for each batch that is not a
  copy (`harvest/source-ingest.ts:1349` to `:1353`). That is the defect the owner found on slot 1
  on 2026-10-16. The in memory `SourceIngestCounters.updated` does not include prices (`:535`), so
  only the column is wrong.
- The price numbers already exist in `harvest_runs.report`: `pricesRecorded`, `pricesPublished`,
  `pricesConfirmed` and `pricesConflicted` (`harvest/run-executor.service.ts:679` to `:693`,
  written at `:528` and `:539`). `pricesPublished` is the sum of the same `result.inserted` that
  `writePrices` adds to `updated` (`harvest/source-ingest.ts:679` to `:681`). The comment at
  `run-executor.service.ts:674` to `:677` already names the defect.
- A store discovery reports `processed` for each place, `created` for each place created and
  `unchanged` for each place refreshed (`harvest/run-report.sink.ts:519` to `:523`).
- `CarrefourDetailRunner` reports `{ processed: 1, updated: 1 }` for each EAN it reports
  (`harvest/carrefour-detail.runner.ts:132`) and the ingest counts the same product again. It
  reports `{ processed: 1, notFound: 1 }` for a page with no EAN (`:103`), and its report already
  names that number as `noEanOnTheirPage` (`:159`).
- `processed` in a unit that is not the product: Carrefour catalog, one for each listing of a
  category (`harvest/carrefour-catalog.runner.ts:194`), against `totalPlanned` in listings (`:72`).
  DIA catalog, one for each whole leaf (`harvest/dia-catalog.runner.ts:338`), against leaves times
  postal codes (`:171`). DIA store discovery, one for each shop detail read
  (`harvest/dia-store-discovery.runner.ts:111`), against candidates (`:82`). In all three the
  ingest or the sink then adds its own `processed`.
- The view maps the columns one to one (`harvest/harvest.mappers.ts:104` to `:110`). The contract
  is `HarvestRunView` (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts:610` to
  `:622`) and its schema (`libs/luna-shopper/contracts/src/schemas/messages/harvest.schemas.ts:267`).
  The schema carries no description, so a JSDoc change does not change `openapi.json`.
  `dashboard.service.ts` reads the counters only through `toHarvestRunView` (`:178`, `:190`).
- The admin app uses the wire type as its view model (`libs/luna-shopper-admin/models/src/lib/harvest/harvest-run.ts:12`).
  It draws `created`, `updated`, `unchanged`, `notFound`, `skipped` and `failed`
  (`libs/luna-shopper-admin/ui/src/lib/harvest/run-progress.ts:178` to `:192`), the prices from
  the report (`harvest-run.ts:94`), and a "Wrote" column as `created + updated`
  (`libs/luna-shopper-admin/feature-harvest/src/lib/runs-page.ts:766`).
- Specs that pin the defect: `harvest/source-ingest.spec.ts:800` ("counts new prices as updated")
  and `:1182` to `:1184`.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, and `openapi.json` and the
wire types show no diff after regeneration.

### Scope

- Work only in:
  - `harvest/run-context.ts`, `harvest/source-ingest.ts`, `harvest/run-report.sink.ts`,
    `harvest/carrefour-detail.runner.ts`, `harvest/carrefour-catalog.runner.ts`,
    `harvest/dia-catalog.runner.ts`, `harvest/dia-store-discovery.runner.ts`,
    `harvest/run-executor.service.ts` (the comment at `:674` only), `entities/harvest-run.entity.ts`
    (comments only), `harvest/harvest-run.store.ts` (comments only), one new migration and
    `db/migrations/index.ts`, and their specs.
  - `libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts` (JSDoc on the counters only).
  - Comment only: `libs/luna-shopper-admin/ui/src/lib/harvest/run-progress.ts:172` to `:176` and
    `libs/luna-shopper-admin/models/src/lib/harvest/harvest-run.ts:78` to `:82`, which state the
    defect as current behavior.
- Do NOT touch: the contract schema, any gateway file, the admin templates, labels and mappings,
  the run verdict (`run-executor.service.ts:620`), `failed`, `skipped`, the other runners, and
  catalog.

### Constraints

- Add, rename or remove no counter column and no view field.
- Take the next free harvester migration timestamp on `dev` at build time. Plans `0215` to
  `0221` each add one, so do not assume that `1759500000000` is free.
- Build on plan `0215` if it is on `dev`. It changes the same runners (`carrefour-detail`,
  `carrefour-catalog`, `dia-catalog`, `dia-store-discovery`) and `run-context.ts`. Keep its
  guard and its abort paths, and add `advance` and `countProgressItself` beside them.
- The migration changes only rows whose report makes the correction exact (section 5). It never
  guesses.
- No dash as punctuation in a comment or a message. Reword the sentence.

### Action boundaries

- Proceed with in scope edits, specs, the migration file and the generators.
- Stop and ask before you run the migration anywhere but a throwaway or ephemeral slot.
- Stop and ask if a spec outside the Scope fails because it pins one of the old numbers.
- Stop and ask if a fix needs a new view field.

### Progress evidence

Report after each of these, with the spec output:

1. `writePrices` no longer moves `updated`, and the ingest specs are rewritten.
2. `processed` counts one unit in every runner, with the runner specs.
3. The migration and its integration spec on real Postgres.

## 1. What each counter counts today

| Counter | Ingest (each catalog discovery adapter, file import) | Store discovery | Runner additions |
|---|---|---|---|
| `processed` | one per observation (`source-ingest.ts:490`, `:533` to `:539`) | one per place (`run-report.sink.ts:520`) | Carrefour catalog listings (`carrefour-catalog.runner.ts:194`), DIA leaves (`dia-catalog.runner.ts:338`), DIA shop details (`dia-store-discovery.runner.ts:111`), Carrefour detail EANs (`carrefour-detail.runner.ts:132`) and pages with no EAN (`:103`), Mercadona 404s (`mercadona-catalog.runner.ts:252`) |
| `created` | new source rows (`source-ingest.ts:533`) | places created (`run-report.sink.ts:521`) | none |
| `updated` | source rows changed (`:536`) **plus** `item_prices` rows inserted (`:1352`) | none | Carrefour detail EANs (`carrefour-detail.runner.ts:132`) |
| `unchanged` | source rows left alone (`:539`) | places refreshed (`run-report.sink.ts:522`) | none |
| `notFound` | none | none | Mercadona 404 (`mercadona-catalog.runner.ts:252`), Carrefour page with no EAN (`carrefour-detail.runner.ts:103`) |
| `skipped` | none | none | file import: products not `ACTIVE` (`file-import.runner.ts:270` to `:282`), DIA: leaves of a postal code whose session failed (`dia-catalog.runner.ts:201`) |
| `failed` | none | none | each runner, in its own unit (product, category, page, shop detail) |

DEZA writes no price, so its `updated` is clean today. Mercadona, LIDL, El Jamón, DIA, Carrefour
and each file import add every price that catalog inserted.

## 2. The four defects

1. **`updated` holds prices.** A Mercadona walk that changes 30 rows and publishes 4,000 new prices
   shows `updated: 4030`. The admin "Wrote" column adds `created` to it.
2. **The Carrefour backfill counts each EAN two times.** The runner reports `processed` and
   `updated` for the EAN, then the ingest reports `processed` and `updated` or `unchanged` for the
   same product.
3. **`notFound` means two things.** For Mercadona it is a 404, which the admin labels "Not
   stocked" (`libs/luna-shopper-admin/ui/assets/i18n/en.json:1158`). For the Carrefour backfill it
   is a page with no EAN, which is not about stock at all.
4. **`processed` mixes two units in three runners.** Carrefour catalog, DIA catalog and DIA store
   discovery count their own unit, then the ingest or the sink adds products or places. The count
   passes `totalPlanned`, and the progress bar passes 100 percent.

## 3. What each counter counts after this plan

| Counter | Meaning, in every mode |
|---|---|
| `processed` | Units of planned work done, in the unit of `totalPlanned`. The unit is the product, except Carrefour catalog (listings), DIA catalog (leaves) and DIA store discovery (shop details). For other store discoveries it is the place. |
| `created` | Source rows created (catalog discovery, file import) or places created (store discovery). |
| `updated` | Source rows whose source group changed, or places changed. Never a price. |
| `unchanged` | Source rows seen and left as they were, or places refreshed. |
| `notFound` | A source answered that it does not stock the product here. Mercadona 404 only. |
| `skipped` | Unchanged by this plan (see section 7). |
| `failed` | Unchanged by this plan (see section 7). |

Prices are counted only in the report: `pricesRecorded`, `pricesPublished`, `pricesConfirmed` and
`pricesConflicted`. The admin already draws them from there.

Write this table as JSDoc on the counters of `HarvestRunView` and as comments on the entity
columns and `RunCounters` (`harvest-run.store.ts:50`).

## 4. The changes

1. **`writePrices` stops reporting.** Delete the `context.report({ updated: result.inserted })`
   call (`source-ingest.ts:1349` to `:1353`) and rewrite the doc comment at `:1311` to `:1326`. The
   return value and `counters.pricesWritten` stay as they are.
2. **One progress unit for each run.** Add to `RunContext`:
   - `countProgressItself(): void`, which a runner calls once, before its first report, when its
     unit is not the product or the place.
   - `advance(count: number): Promise<void>`, which adds `count` to `processed` unless the runner
     called `countProgressItself`, and then flushes on the same throttle as `report`.

   The ingest (`source-ingest.ts:490`, `:533`, `:536`, `:539`) and the sink
   (`run-report.sink.ts:519` to `:523`) take `processed` out of their `report` calls and call
   `advance` instead. Carrefour catalog, DIA catalog and DIA store discovery call
   `countProgressItself` at the start of `run`. Runners keep `report({ processed })` for their own
   unit.
3. **The Carrefour backfill counts through the ingest.** Delete the runner's
   `context.report({ processed: 1, updated: 1 })` (`carrefour-detail.runner.ts:132`). Change `:103`
   to `context.report({ processed: 1 })`. The page with no EAN stays in the report as
   `noEanOnTheirPage`.
4. **Comments that state the defect as current behavior** are reworded: `run-executor.service.ts:674`
   to `:677`, `run-progress.ts:172` to `:176`, `harvest-run.ts:78` to `:82`. Each says that
   `updated` once held prices and no longer does, and names this plan.

## 5. Old runs

A migration corrects the rows where the stored report gives the exact amount, and leaves every
other row alone.

1. A run whose `report` holds a numeric `pricesPublished`:
   `updated = GREATEST(0, updated - (report->>'pricesPublished')::int)`. The amount is exact,
   because `pricesPublished` and the extra `updated` are the same sum of `result.inserted` over the
   batches that are not copies. Every run that holds the key was written after `writePrices` began
   to report (`49885b74c`, 2026-09-05, before `a0e5aa29a`, 2026-09-09, which added the key).
2. A run whose `report` holds both `eansWritten` and `productsWritten` is a Carrefour backfill
   after plan 0103 (`422cfa9dc`, 2026-09-09), when the double count began:
   `updated = GREATEST(0, updated - eansWritten)`, `processed = GREATEST(0, processed - eansWritten)`,
   `notFound = 0`. A backfill run before plan 0103 has no `productsWritten` and was counted once.
3. Every other row keeps its numbers. That covers a run that failed by an exception before its
   report was written, a run before 2026-09-09, and the `processed` of Carrefour catalog, DIA
   catalog and DIA store discovery runs, whose extra count the report does not state per unit.

`down` adds back what `up` subtracted, from the same report keys, and sets `notFound` back from
`noEanOnTheirPage`. The view does not mark a corrected row. The admin draws the price numbers from
the report, and those were never wrong.

## 6. The contract, the gateway and the admin app

- No field changes, so `openapi.json` and `wire-types.ts` regenerate with no diff. Run both
  generators to prove it.
- The admin needs no code change and no mock. Its labels "Updated" and "Not stocked" become true.
  The "Wrote" column (`runs-page.ts:766`) then shows source rows created and changed, without
  prices. For a Mercadona walk that number drops from thousands to tens. Whether "Wrote" adds
  `pricesPublished` is an owner question (Decisions).

## 7. What this plan does not do

- It does not split `skipped`, which counts products not `ACTIVE` in a file import and leaves not
  walked in a DIA run. Both are "planned work that wrote nothing by a rule", and the owner decides
  whether DIA leaves move to `failed` (Decisions).
- It does not change `failed` or the verdict. Carrefour catalog counts a failed category against
  `totalPlanned` in listings, so its ratio cannot cross the threshold. That belongs with plan 0215
  (a run stops when a chain keeps refusing it) and plan 0218 (alerts).
- It adds no live price counter. Prices are in the report when the run finishes.
- It does not change the admin screens, and it designs no screen.

## Tests

- **`source-ingest.spec.ts`**: replace the test at `:800` with "a new price moves no counter":
  `reported` contains no `updated` from a price batch, `counters.pricesWritten` is 2 and
  `unchanged` is 1. At `:1182`, no report without `processed` remains. Every other `updated`
  expectation in the file stays green as it is.
- **`run-context.spec.ts`**: `advance` adds to `processed`. After `countProgressItself`, `advance`
  adds nothing and `report({ processed })` still adds. Both flush on the 10 second throttle.
- **`run-report.sink.spec.ts`**: a store discovery chunk of three places moves `processed` by 3
  through `advance`, and `created` and `unchanged` as before.
- **`carrefour-detail.runner.spec.ts`**: with the sink and the ingest, two rows with an EAN and one
  without give `processed: 3`, no `notFound`, and `updated` only for a row whose EAN changed.
- **`carrefour-catalog.runner.spec.ts`, `dia-catalog.runner.spec.ts`,
  `dia-store-discovery.runner.spec.ts`**: `processed` at the end equals the runner's unit count and
  is not above `totalPlanned`.
- **`harvest-run-counters.migration.integration.spec.ts`**, on real Postgres: a walk row with
  `updated: 50` and `pricesPublished: 40` reads 10. A backfill row with `eansWritten: 5` and
  `productsWritten: 5` loses 5 from `updated` and `processed` and reads `notFound: 0`. A row with
  no key, and a backfill row with no `productsWritten`, keep their numbers. `down` restores all of
  them.

## Acceptance criteria

- [ ] No price batch moves `updated` or any other counter column.
- [ ] A Carrefour backfill counts each row once in `processed`, and never in `notFound`.
- [ ] `notFound` is reported only by a Mercadona 404.
- [ ] In every runner, `processed` counts one unit, and a run that finishes whole ends with
      `processed` not above `totalPlanned`.
- [ ] The migration corrects exactly the rows of section 5 and leaves every other row as it was.
- [ ] `HarvestRunView` documents what each counter counts.
- [ ] `openapi.json` and `wire-types.ts` show no diff after regeneration.

## Verification

```sh
npx nx test luna-shopper-backend-harvester
npx nx run luna-shopper-backend-harvester:test-integration
npx nx test luna-shopper/contracts
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx build luna-shopper-backend-harvester
npx nx affected -t lint test
```

`nx test` does not type check. The build line does. Run the integration suite on an ephemeral
Luna slot. The two generators must leave `git status` clean.

## Decisions

Chosen in this plan, and open to the owner's correction:

- Keep the column names and add no field. A rename touches the contract, the gateway document,
  the wire types and the admin for no gain over a definition that holds.
- Prices are counted only in the report, which already carries four exact numbers.
- `processed` counts the unit of `totalPlanned`, chosen by the runner, so the bar means one thing.
- The migration corrects only what the report makes exact, and marks nothing.
- `notFound` keeps its admin label "Not stocked", and the Carrefour backfill stops using it.

**Owner**: ask, do not choose.

- Should the admin "Wrote" column add `pricesPublished` to `created + updated`? Today it silently
  includes prices through the defect. After this plan it shows rows only. A change is a mapping in
  `runs-page.ts` and a label, and needs no mock.
- Should DIA leaves that a failed session left unwalked count as `failed` rather than `skipped`?
  That moves the verdict of a DIA run.
- Is it acceptable that old Carrefour catalog, DIA catalog and DIA store discovery runs keep a
  `processed` above `totalPlanned`?
