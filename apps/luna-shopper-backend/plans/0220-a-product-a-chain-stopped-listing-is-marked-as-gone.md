# 0220: a product a chain stopped listing is marked as gone

> Asked for by the owner on 2026-10-22: mark the products a chain stopped listing. Today such a
> product just stops being seen. Its row keeps an old `lastSeenAt`, catalog keeps its offer, and for
> DIA and El Jamón catalog keeps saying that the chain sells it, with the last price it had.
>
> This plan counts, for each product and each price scope, the whole walks in a row that did not
> list the product. A walk counts only when its runner says that it read the whole listing of that
> scope and the run ends `COMPLETED`. After N such walks, and at least D days after the first miss,
> the product is **gone** at that scope. Catalog then says that the scope does not carry it and
> records when it went. A product that every counted scope lost is gone for the chain, and the
> harvester row says so. The first walk that lists the product again brings it back.
>
> Three adapters can prove absence today: `mercadona-api` per warehouse, `dia-api` per fulfilment
> store and `eljamon-web` for its one national list. `lidl-api`, `deza-web` and `carrefour-web`
> cannot, and this plan counts nothing for them.
>
> Prerequisite reading: plan `0103` (the run report, `assortmentComplete`), plan `0108` (several
> warehouses in one run), plan `0118` (copies), plan `0080` (prices decided on read), plan `0182`
> (a chain that lists a product sells it), plan `0174` (DIA), plan `0169` (El Jamón), plan `0090`
> (Carrefour), plan `0085` (DEZA), plan `0089` (LIDL), plan `0201` (a basket row is a product),
> sibling plan `0221` (a reworded DEZA name), `harvest/run-report.ts`, `harvest/run-report.sink.ts`,
> `harvest/run-executor.service.ts`, `harvest/source-entry-availability.ts`, the three runners
> named above, and `catalog/src/app/catalog/supermarket-item.service.ts`.

## Brief for the agent

### Objective

Add a per scope miss counter to the harvester, fed only by walks that read a whole listing and end
`COMPLETED`. Mark a product gone at a scope after N misses and D days, send that to catalog as a
negative availability with a `delistedAt` instant, mark the harvester row gone when every counted
scope lost it, and undo all of it when a walk lists the product again, as sections 1 to 13 describe.

### Context

Read on `dev` on 2026-10-22. Paths are under `apps/luna-shopper-backend/harvester/src/app/` unless
stated.

- `source_catalog_entries` has one row per product of a chain (`entities/source-catalog-entry.entity.ts:39`).
  Its seen fields are `timesSeen` (:203), `firstSeenAt` (:206), `lastSeenAt` (:211), `firstRunId`
  (:222) and `lastRunId` (:226). They are chain wide, not per scope. The ingest moves all three on
  every observation (`harvest/source-ingest.ts:1057` in `see`, :1136 in `touch`, :1190 in `create`).
  A leaflet that observes a row a walk owns moves them too (`harvest/source-snapshot.ts:176`,
  `writesSourceGroup`). So `lastSeenAt` cannot prove that a walk listed the product.
- `source_entry_availability` keeps per shop claims (plan 0182, `entities/source-entry-availability.entity.ts:29`).
  Its doc says "Nothing deletes a row because a run did not see the product" (:27).
- `source_entry_prices` keeps the latest price per entry, scope and kind
  (`entities/source-entry-price.entity.ts:32`). `priceScopeId` is the scope the price was read at.
- `RunReport.assortmentComplete(scopeKey)` (`harvest/run-report.ts:134`) says that a run walked the
  whole assortment of a scope. Only the Mercadona runner calls it
  (`harvest/mercadona-catalog.runner.ts:331`), for each warehouse, when the run was not aborted
  (:328).
- `RunReportSink.writeScopeAvailability` (`harvest/run-report.sink.ts:652`) then writes, for each
  complete scope, `true` for every `ACTIVE` row the run **observed**, and `false` for every `ACTIVE`
  row of the chain and source kind it did **not observe** (:688 to :700). Observed means reported
  through `report.product` (:331).
- **A defect follows from that.** A Mercadona product whose detail request fails is not reported
  (`mercadona-catalog.runner.ts:300`, `onError`). The default detail setting is `ALL` (:181), so a
  run fetches the detail of every product. A row whose detail failed is thus written
  `available: false` in every warehouse of the run, although the listing named it. The incident of
  2026-09-25 failed 1764 of 4249 details. `sink.drain()` runs before the verdict
  (`harvest/run-executor.service.ts:510` before :548), so a run that ends `FAILED` writes those
  negatives too.
- A Mercadona level 2 category that answers 404 yields no products and no error
  (`libs/luna-shopper/mercadona/src/lib/mercadona.client.ts:283`, `getJson` answers null on 404 at
  :391). Any other failure of the tree walk throws and fails the run.
- DIA: "It never claims the assortment is complete" (`harvest/dia-catalog.runner.ts:66`). It still
  marks a scope finished after every leaf was asked for (:211), and `availabilityOf` states a
  negative for a scope only when `scope.finished && scope.failedPages === 0 && !signal.aborted`
  (:759). A listed row with `unitsInStock` 0 is listed and unavailable (:756). A product that no
  walked scope listed gets no claim at all.
- El Jamón: "It writes no availability, positive or negative" (`harvest/eljamon-catalog.runner.ts:39`).
  The listing walks every top level category page by page (:75). A failed page is named in
  `walk.failedPages` (:218). A product page that fails still reports the product (:117).
- Carrefour: "It states no completeness" (`harvest/carrefour-catalog.runner.ts:208`). A category
  over the 1008 row ceiling with no children cannot be paged (`libs/luna-shopper/carrefour/src/lib/types.ts:223`),
  and the report names it in `truncatedCategories` (:283). A block ends the crawl and fails the run
  (:295).
- DEZA: "It states no completeness either" (`harvest/deza-catalog.runner.ts:146`). The report names
  each section the 300 row cap and the query budget left unfinished (`incompleteSections`, :427).
- LIDL: the site publishes the offers of this week and next, not a catalog, and "nothing here
  deletes a product for being absent from one week" (`harvest/lidl-catalog.runner.ts:28`).
- A Carrefour detail backfill dispatches through the same mode (`harvest/catalog-discovery.runner.ts:88`).
  A run that writes `PRICES` only states no stock (`harvest/run-report.sink.ts:404`).
- Catalog: `supermarket_items.available` is "whether the scope carries this product at all"
  (`catalog/src/app/entities/supermarket-item.entity.ts:101`). Search filters on it
  (`catalog/src/app/catalog/item.service.ts:191`, :243), and so do the best offer and the scopes of
  an item (the comment at :228). `SupermarketItemService.setAvailability`
  (`catalog/src/app/catalog/supermarket-item.service.ts:106`) writes it for many products. The flag
  of a scope that has shop rows is derived from them (`supermarket-location-item.service.ts:347`).
- Plan 0080 policies: `OFFICIAL_API` and `OFFICIAL_WEB` prices age out after 7 days, the others
  never (`catalog/src/app/db/migrations/1756700000000-ItemPrices.ts:106`). A key with no eligible
  price shows the newest row with `stale: true` (`supermarket-item.entity.ts:118`).
- A bind writes the stored claims and the offer with no price through
  `SourceEntryAvailabilityWriter.writeForEntries` (`harvest/source-entry-availability.ts:232`),
  called from `source-entry.service.ts:1273` and `source-entry-batch.service.ts:352`.
- One run per chain is active at a time (`uq_harvest_run_active`, plan 0206 context).
- **This plan lands after plans `0215` and `0217`.** Plan `0215` changes the Mercadona, DIA and
  El Jamón runners and `mercadona.client.ts` (a run guard, and runners that keep what they read on
  an abort), and makes the executor drain the sink on an aborted run too. Plan `0217` moves
  `processed` in the sink and the ingest onto `RunContext.advance`. Build on both as they are on
  `dev`. A stopped run ends `FAILED`, so section 4.4 counts nothing for it.
- The latest harvester migration is `1759400000000-HarvestSchedules.ts`. The latest catalog
  migration is `1759000000000-SectionsOfAShop.ts`. Both directories list their migrations in
  `index.ts`.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, and `openapi.json` and the
admin wire types are regenerated.

### Scope

- Work only in:
  - `apps/luna-shopper-backend/harvester/src/app/`: a new entity and a migration, a new
    `harvest/delisting.ts` (the pure rule), a new `harvest/delisting.service.ts` (the counter),
    `harvest/run-report.ts`, `harvest/run-report.sink.ts`, `harvest/run-executor.service.ts`,
    `harvest/mercadona-catalog.runner.ts`, `harvest/dia-catalog.runner.ts`,
    `harvest/eljamon-catalog.runner.ts`, `harvest/source-entry-availability.ts`,
    `entities/source-catalog-entry.entity.ts`, the source entry list read and its mapper, the
    module, and the catalog client.
  - `libs/luna-shopper/mercadona/src/lib/mercadona.client.ts`, for section 2.1 only.
  - `apps/luna-shopper-backend/catalog/src/app/`: the `supermarket_items` entity, a migration,
    `supermarket-item.service.ts`, the mapper of `SupermarketItemView`.
  - `apps/luna-shopper-backend/gateway/src/app/harvest/` (the list query DTO and the entry view DTO)
    and any gateway DTO that mirrors `SupermarketItemView`.
  - `libs/luna-shopper/contracts` (the fields of section 12 and their schemas).
  - Their specs, and the generated files.
- Do NOT touch: the DEZA, LIDL and Carrefour runners, the ingest ladder, the price writer and the
  effective price recompute, `deriveScopeFlags`, core, `apps/velista`, `apps/luna-shopper-admin`,
  the schedule worker, and any adapter library other than Mercadona.

### Constraints

- A miss is counted only from a listing that a runner declared whole with `listingWhole`, in a run
  whose verdict is `COMPLETED`. Nothing else moves the counter.
- A miss is "not in the listing of this scope". It is never "not reported" or "not observed".
- The counter never deletes a row of any table. A gone product keeps every price, every claim and
  every row.
- A runner reports, and the counter writes (plan 0103). No runner reads or writes the new table.
- Catalog stays the only writer of its tables. The harvester sends gone and back through
  `supermarketItem.setAvailability`.
- The migrations are additive.
- Regenerate `openapi.json` and the wire types, never by hand.
- No dash as punctuation in a comment or a message. Reword the sentence.

### Action boundaries

- Proceed with in scope edits, specs, the migrations, the generators and an ephemeral slot for the
  integration specs.
- Stop and ask if the committed El Jamón fixtures show a walk with no failed page whose rows read for
  a category differ from the count the category printed (section 2.3).
- Stop and ask if a run's copies (plan 0118) write `source_entry_prices` rows at the copy targets.
  Section 4.2 seeds from those rows and assumes they hold read scopes only.
- Stop and ask before you change what `writeScopeAvailability` writes beyond section 3.
- Do not run the migration anywhere but a throwaway slot. Do not start a run in a cluster.

### Progress evidence

Report after each of these, with the spec output:

1. `listingWhole` on the report, the three runners, and the 404 category signal of Mercadona.
2. The listing set fix of section 3, with a spec that a failed detail writes no negative.
3. The pure rule, the entity, the migration and the counter, with an integration spec on real
   Postgres.
4. The catalog column, the `delisted` field, and the end to end spec: three whole walks without a
   product make it gone in catalog, and a fourth that lists it brings it back.

## 1. What is being built

| Piece                                              | Where                                            |
| -------------------------------------------------- | ------------------------------------------------ |
| `RunReport.listingWhole(scopeKey, listed)`         | `run-report.ts`, the sink, `RecordingRunReport`  |
| The three runners declare a whole listing          | Mercadona, DIA, El Jamón runners                 |
| A Mercadona category that answered 404 is named    | `mercadona.client.ts`                            |
| The scope negative reads the listing, not reports  | `run-report.sink.ts`, `writeScopeAvailability`   |
| `source_entry_scope_presence`                      | a harvester entity and migration                 |
| `source_catalog_entries.delistedAt`                | the same migration                               |
| `isGone` and the threshold read                    | `harvest/delisting.ts`, pure                     |
| The counter, after the verdict                     | `harvest/delisting.service.ts`, the executor     |
| `supermarket_items.delistedAt` and `delisted`      | a catalog migration, `setAvailability`           |
| The `delisting` section of the run report          | `harvest_runs.report`                            |
| `delistedAt` on two views and a list filter        | contracts, gateway                               |

## 2. Which walks can prove absence

A walk proves that a scope does not list a product only when it read the whole listing of that
scope. Each adapter was checked against its runner on 2026-10-22.

| Adapter         | Can prove absence | Unit of a whole listing   | Condition for "whole"                                                |
| --------------- | ----------------- | ------------------------- | -------------------------------------------------------------------- |
| `mercadona-api` | yes               | one warehouse scope       | not aborted, and no level 2 category of that warehouse answered 404 |
| `dia-api`       | yes               | one fulfilment store      | `finished`, no failed page, not aborted                              |
| `eljamon-web`   | yes               | the national scope (null) | no failed page, not aborted                                          |
| `carrefour-web` | no                | none                      | the frontier states no completeness, and a capped category hides rows |
| `deza-web`      | no                | none                      | the 300 row cap and the 25 query budget                              |
| `lidl-api`      | no                | none                      | the listing is a window of offers, not an assortment                 |
| file import     | no                | none                      | a leaflet is a selection                                             |

### 2.1 Mercadona

The tree walk either reads every level 2 category of a warehouse or throws and fails the run. The
one gap is a 404 on a category: `listCategoryProducts` answers an empty list, and the walk looks
whole with that category's products missing. Give the client a way to name such categories, for
example a `missingCategories` list on the client that `walkCatalog` fills. The library stays
framework free and its fixtures stay as they are. A warehouse whose walk met one is not whole for
this plan. It still calls `assortmentComplete` as today, because that is plan 0103's statement and
section 3 makes it safe.

The runner calls `report.listingWhole(warehouse, listedIds)` beside `assortmentComplete`, with the
keys of `assortments.get(warehouse)`. A product the listing named counts as listed, whatever its
detail request answered.

### 2.2 DIA

DIA hides some products from its listing. The sitemap names about 7,600 and a walk lists about
5,700 (`dia-catalog.runner.ts:66`). A product can thus leave the listing while it is out of stock
and come back. That is why the threshold counts several walks and several days. A listed row with
no stock is listed: it is unavailable, and it is not gone.

The runner calls `report.listingWhole(scope.key, scope.listed.keys())` for each scope that meets
the condition `availabilityOf` already uses. A skipped scope (no postal code, a refused session) was
never opened and declares nothing. The national copy of the anonymous store's prices
(`scopeKey: null`) is not a walk of the national scope, so DIA never declares `null`.

### 2.3 El Jamón

One price list serves every shop (plan 0169), so the walk has one scope, the default scope the spawn
gives the run, which is the chain's `NATIONAL` scope. The runner calls
`report.listingWhole(null, walk.rows.keys())` after the listing phase when `walk.failedPages` is
empty and the run is not aborted. The external id is the chain's product code (`listed.row.code`),
so a renamed product keeps its key.

The runner doc says that El Jamón writes no availability. That stays true of the runner. The counter
writes a negative only after the threshold, and the doc gains one sentence that says so.

Each category prints a count (`printedCount`) and the walk counts the rows it read (`rowsRead`). A
product filed in two categories is read twice, so the two numbers need not agree. Check the
committed fixtures first, as the action boundaries say.

### 2.4 Why the three others count nothing

- **Carrefour.** The frontier is the shallowest node under the 1008 row ceiling on each branch. A
  capped category with no children cannot be paged, and a product filed only outside the frontier
  is unseen for a reason that says nothing about stock. A crawl with no truncated category, no
  unreadable category and no block may be whole in fact, but the runner states that it is not a
  proof. See the owner question in the Decisions section.
- **DEZA.** Each query answers at most 300 rows, and the budget of 25 queries can end before a
  section is finished. A product whose name was reworded also comes back under a new key (section
  10). DEZA counts nothing.
- **LIDL.** A product leaves the window every week by design. Its prices end through their own
  `validUntil` (plan 0089).
- **A file import** prints a selection of products, never an assortment.

## 3. What a miss is, and the defect it fixes

A miss at scope S is: the run declared S whole, and the listing of S did not name the product. A
product that the listing named and that the run failed to read further was not missed.

`writeScopeAvailability` breaks that rule today (Context). Fix it with the same input. When the run
declared S whole through `listingWhole`, the scope negative goes to every tracked `ACTIVE` row that
the listing of S did not name, instead of every row the run did not observe. A row that the listing
named and that the run did not observe gets no statement from the diff. Its positive is still
written by the claims and the reports as today. When a runner calls `assortmentComplete` with no
`listingWhole` for that scope, the old rule stays. After this plan no runner does.

This changes no Mercadona negative that a whole listing supports. It removes the negatives that a
failed detail made.

## 4. The counter

### 4.1 The table

`source_entry_scope_presence`, one row per entry and scope that a counted walk has tracked:

| Column             | Type          | Meaning                                                               |
| ------------------ | ------------- | --------------------------------------------------------------------- |
| `id`               | uuid          | `BaseEntity`                                                          |
| `entryId`          | uuid          | the `source_catalog_entries` row, cascade on delete                   |
| `priceScopeId`     | uuid          | opaque, catalog owns the scope                                        |
| `missedWalks`      | smallint      | whole walks in a row that did not list the product, 0 when listed     |
| `firstMissedAt`    | timestamptz   | the first miss of the current run of misses, null when listed         |
| `goneAt`           | timestamptz   | when the rule of section 5 first held, null otherwise                 |
| `lastCountedRunId` | uuid          | the last run that counted this pair, so a retry counts once           |
| `pendingCatalog`   | boolean       | a transition that catalog has not acknowledged, default false         |

Unique on (`entryId`, `priceScopeId`). An index on `priceScopeId`. A partial index on `entryId`
where `goneAt IS NOT NULL`.

A row exists only for a pair that a counted walk saw listed, or that section 4.2 seeds. A product
that a warehouse never listed has no row at that warehouse and is never missed there. A product sold
in one warehouse only is thus never gone because a walk of another warehouse did not list it.

### 4.2 One counted scope, step by step

The counter runs once per run, for each scope S the run declared whole, with L the listed external
ids. All steps for one scope run in one transaction, as set based SQL over `unnest` arrays, never
one statement per product.

1. **Resolve.** The entries of the chain whose `externalId` is in L. A listed id with no row (a new
   product whose detail answered 404) is skipped.
2. **Seed.** Insert a row, `missedWalks` 0, for each entry of the chain that holds a
   `source_entry_prices` row at S of the run's own source kind and has no presence row at S. That is
   a product a walk once listed at S, before this plan existed. `ON CONFLICT DO NOTHING`.
3. **Listed.** Insert a row for each resolved entry that has none at S. For each resolved entry
   whose row has `missedWalks > 0` or `goneAt` set, set `missedWalks` 0, `firstMissedAt` null and
   `lastCountedRunId` to the run. A row that had `goneAt` set also gets `goneAt` null and
   `pendingCatalog` true. Those are the products that came back.
4. **Missed.** For each row at S whose entry is not resolved and whose `lastCountedRunId` is not
   this run, add one to `missedWalks`, set `firstMissedAt` to `coalesce(firstMissedAt, now)` and
   `lastCountedRunId` to the run.
5. **Gone.** For each row at S with `goneAt` null for which `isGone` holds (section 5), set `goneAt`
   to now and `pendingCatalog` true.

The rows that step 3 leaves at 0 are not written. Only misses and transitions write, so a walk of
fifty DIA stores with no change writes nothing but the seed.

### 4.3 The row of the chain

After the scopes, recompute `source_catalog_entries.delistedAt` for every entry that step 3 or step
5 changed:

- Set it to now when every presence row of the entry has `goneAt` set, and it was null.
- Set it to null when any presence row of the entry has `goneAt` null.

A presence row at a scope that no walk counts any more stays as it is, so it keeps the entry from
being gone for the chain. That is the safe error: the product is gone at each scope that was walked,
and catalog says so there.

`delistedAt` is neither the source group nor the decision group of the row
(`source-catalog-entry.entity.ts:20`). It is the counter's, and nothing else writes it. It does not
change `status`. A gone row that waits in the queue stays `UNRESOLVED` or `CANDIDATE`, and the list
read can filter it (section 12).

### 4.4 When the counter runs

In `RunExecutor.execute`, after the verdict (`run-executor.service.ts:548`) and before
`store.finish`, when all of these hold:

- the status is `COMPLETED`,
- the mode is `CATALOG_DISCOVERY` and the run is not a detail backfill,
- `writes` is not `PRICES`,
- the sink holds at least one whole listing.

The sink resolves each declared key to a scope id at drain, as `writeScopeAvailability` does: a
null key is the run's `defaultPriceScopeId`, any other key goes through the scope resolver. A key
that resolves to nothing is named in the report and not counted.

An error in the counter or in the catalog call is logged and written to the report as
`delisting.error`. It does not change the status of the run. The `lastCountedRunId` guard makes a
second count of the same run a no op for the misses.

## 5. The threshold

`isGone(missedWalks, firstMissedAt, now, threshold)` in `harvest/delisting.ts`, pure, with the clock
as an argument:

```
missedWalks >= threshold.walks && firstMissedAt <= now - threshold.days
```

The threshold is read from the chain's `supermarket_sources.config`, beside the other per chain
adapter settings (`postalCode`, `seedPath`, `scopePostalCodes`), under two keys:

| Key                | Default | Accepted         |
| ------------------ | ------- | ---------------- |
| `delistAfterWalks` | 3       | integer 1 to 52  |
| `delistAfterDays`  | 14      | integer 0 to 365 |

A value outside the range is ignored, the default applies, and the run report says so. No
environment variable is added (plan 0083).

Why both. The walks absorb a product that leaves the DIA listing for a week while it is out of
stock. The days stop a daily schedule (plan 0206) from making a product gone in three days. With a
weekly walk the two agree: the third miss comes 14 days after the first.

## 6. What gone changes

| Where                                   | Change                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `source_entry_scope_presence`           | `goneAt` set                                                             |
| `source_catalog_entries.delistedAt`     | set when every counted scope lost the product                            |
| `supermarket_items` at S and its copies | `available: false` and `delistedAt` set                                  |
| Search, best offer, scopes of an item   | the product leaves them at S, through the existing `available` filters   |
| The basket                              | section 9                                                                |
| Prices (`item_prices`, `source_entry_prices`) | nothing is deleted or withdrawn                                    |
| Shop claims (`source_entry_availability`)     | nothing changes                                                    |
| The admin queue                         | the row carries `delistedAt` and the list can filter on it              |

### 6.1 The catalog write

Add an optional `delisted` to each entry of `SetSupermarketItemAvailabilityRequest.entries`, and a
nullable `delistedAt` column to `supermarket_items`:

- `delisted: true` sets `delistedAt` to now when it is null, and keeps it when it is set.
- `delisted: false` sets it to null.
- Absent leaves it as it is, which is every caller today.

A row whose `available` and `delistedAt` already say what the entry says is left alone and counts
for nothing, as today. `onlyIfMissing` keeps its meaning and ignores `delisted`. `deriveScopeFlags`
and the effective price recompute do not touch `delistedAt`.

After the transaction of section 4.2, the counter sends, per scope S, every pair with
`pendingCatalog` true whose entry is `ACTIVE`:

- gone: `{ itemId, available: false, delisted: true }`,
- back: `{ itemId, available: true, delisted: false }`,

at S and at each scope `copiesOf(S)` names (plan 0118), in batches of the sink's
`AVAILABILITY_BATCH`. A batch that catalog accepted clears `pendingCatalog` on its pairs. A batch
that failed leaves them, and the next counted run of the chain sends them again. A pair whose entry
is not `ACTIVE` clears `pendingCatalog` with no call, because catalog holds no product for it.

### 6.2 Two rows on one product

Several rows of one chain can be bound to one product. A product is gone at S only when every
`ACTIVE` row of the chain bound to it that has a presence row at S has `goneAt` set. A row still
listed keeps the product sold, which is the rule `writeScopeAvailability` already follows ("A
product two rows resolve to is stocked if either row saw it"). Such an item is left out of the gone
batch and its pairs clear `pendingCatalog`.

### 6.3 Prices and plan 0080

A gone product keeps every price it had. Prices are decided on read, so nothing about prices is
written here:

- An `OFFICIAL_API` or `OFFICIAL_WEB` price is no longer eligible 7 days after the last walk that
  observed it. The row then shows it with `stale: true`. By the time a product is gone under the
  default threshold, its walk price has been stale for a week.
- `available: false` already keeps the row out of every offer and every sort, so the stale number is
  not shown as an offer.
- An `ADMIN` price never ages. A person who typed a price for a gone product sees `delistedAt` on
  the row and decides. The counter does not override a person.

A gone product's price thus stops being effective through rules that exist. This plan adds no price
rule.

### 6.4 A bind of a gone row

A person can accept a row that is already gone at some scopes, for example an `UNRESOLVED` row the
queue still holds. The bind sends the row's prices and its offer with no price
(`writeForEntries`). After them, the same method sends `{ available: false, delisted: true }` for
each scope where the row's presence row has `goneAt` set, subject to section 6.2. One code path
serves the single accept, the create and the bulk route.

## 7. How a product comes back

The first counted walk that lists the product at S runs step 3 of section 4.2. The pair goes back to
0, `goneAt` goes to null, and catalog gets `{ available: true, delisted: false }`. The entry's
`delistedAt` clears with the first scope that comes back.

A walk that is not counted (an aborted run, a `FAILED` run, a LIDL run, a leaflet) moves
`lastSeenAt` as today and brings nothing back. For Mercadona the scope positive of
`writeScopeAvailability` also writes `available: true` on any run, counted or not. `delistedAt` then
stays set beside `available: true` until a counted walk lists the product. Read `delistedAt` as "a
walk proved this gone and none has proved it back", never as "not sold".

A product that a person brings back by hand (`available` set in the back office) keeps `delistedAt`
until a counted walk lists it. The back office follow up decides how to show that.

## 8. The run report

`harvest_runs.report` gains a `delisting` object. The report is a free JSON object
(`HarvestRunView.report`), so no schema changes:

```json
{
  "delisting": {
    "counted": true,
    "notCountedBecause": null,
    "threshold": { "walks": 3, "days": 14, "fromDefaults": true },
    "scopes": [
      {
        "scopeId": "…",
        "key": "4661",
        "listed": 4102,
        "seeded": 0,
        "missed": 12,
        "newlyGone": 3,
        "cameBack": 1
      }
    ],
    "notWhole": [{ "key": "4804", "reason": "category-404", "detail": ["112"] }],
    "entriesDelisted": 2,
    "entriesBack": 1,
    "catalogSent": 4,
    "catalogFailed": 0,
    "error": null
  }
}
```

`notCountedBecause` is one of `run-not-completed`, `prices-only`, `detail-backfill`,
`no-whole-listing`, or null. A run of an adapter that never declares a whole listing says
`no-whole-listing`. `notWhole` names each scope a runner walked and did not declare whole, with its
reason, so an operator sees why a warehouse did not count.

## 9. Basket rows (plan 0201)

A basket row is a product, and core never sees a price. The gateway picks the cheapest product of a
line from `item.getMany` at the read's scopes (`gateway/src/app/baskets/basket-catalog.service.ts:505`),
and the scopes of an item already leave out a row that is not available. So:

- A line with several products and no favourite counts as its cheapest product that is still sold.
  A gone product drops out of the choice with no change to core or the gateway.
- A line whose only product, or whose favourite, is gone keeps that product as its row. The row has
  no price at the chain where it is gone. Row identity does not change, so no merge or split of
  basket rows follows.
- Telling the shopper that the product is gone, and offering a replacement, is the velista follow up
  of section 13.

## 10. DEZA renames and plan 0221

DEZA keys a row on a name it synthesizes (`entryKey`), so a reworded name arrives as a new
`UNRESOLVED` key while the old `ACTIVE` row stops being seen. Under a counter, every such rename
would make the old row gone and take a product off DEZA while the new key waits for a person. This
plan counts nothing for `deza-web` (section 2.4), so no DEZA row is ever gone here.

Plan 0221 proposes the reworded name as the same product. It must not read `delistedAt` or
`source_entry_scope_presence` to find the old row, because neither is ever set for DEZA. It reads
`lastRunId` and `lastSeenAt`, as today.

If a later plan makes any key that is a name countable, plan 0221 or its equal must land first.

## 11. Migrations

**Harvester**, `<next free timestamp>-SourceEntryScopePresence.ts`. Plans 0215 to 0219 and 0221
each add a harvester migration too, so `1759500000000` is likely taken. Read
`db/migrations/index.ts` on `dev` at build time and take the next free one:

- Create `source_entry_scope_presence` with the columns, the unique constraint and the indexes of
  section 4.1, with a foreign key to `source_catalog_entries` on delete cascade.
- Add `source_catalog_entries.delistedAt timestamptz NULL` and a partial index
  `ix_source_catalog_entries_delisted` where it is not null.
- No backfill. Step 2 of section 4.2 seeds each scope the first time a walk counts it, from the
  prices that scope already holds.

**Catalog**, `1759100000000-SupermarketItemDelistedAt.ts` (the same note on the timestamp):

- Add `supermarket_items.delistedAt timestamptz NULL`. No index: every read that needs it already
  reads the row.

Both are additive and both have a `down`.

## 12. Contracts

| Contract                                             | Change                                     |
| ---------------------------------------------------- | ------------------------------------------ |
| `SourceCatalogEntryView` (and `ItemSourceEntryView`) | `delistedAt: string \| null`, not required in the schema |
| `ListSourceEntriesRequest`                           | `delisted?: boolean`: true lists gone rows only, false leaves them out, absent lists both |
| `SetSupermarketItemAvailabilityRequest.entries[]`    | `delisted?: boolean`                       |
| `SupermarketItemView`                                | `delistedAt: string \| null`, not required in the schema |

The gateway query DTO of the source entry list gains `delisted` with a strict boolean parse. The
gateway pipe has read the string `"false"` as true on a boolean before (plan 0206 review). A spec
covers `"false"`. The fields are not required in the schemas, so the back office's typed fixtures
stay valid, as plan 0206 did with its new fields. Regenerate `openapi.json` and the wire types.

No velista view changes. The shopper views that would carry the flag belong to the velista follow up.

## 13. The follow ups that need a mock

These need a mock before a plan, by the repository rule. This plan designs no screen.

- **Admin: gone products in the source queue and on a product.** The queue filter on `delisted`,
  the date a row went, the scopes it went at, and a product whose offer says `delistedAt`. It needs
  a per scope read of `source_entry_scope_presence`, which that plan adds.
- **Velista: a product the chain no longer sells.** What a shopper sees on a line, a basket row or a
  product sheet whose product is gone at a chain, and whether a similar product is offered. It needs
  `delistedAt` on a shopper facing item view, which that plan adds.

## 14. What this plan does not do

- It counts nothing for Carrefour, DEZA, LIDL or a file import.
- It deletes no row, price or claim, and withdraws no price.
- It changes no price policy and no effective price rule.
- It does not undo counts when a run is reverted. The next counted walk corrects the pairs it lists.
  A revert of a run that made a product gone leaves it gone until a counted walk lists it.
- It does not count shops. `source_entry_availability` keeps per shop claims as plan 0182 built.
- It does not change `status` and does not reject or unbind a gone row.
- It adds no alert. Plan 0218 decides what the owner hears.
- It adds no screen.

## Tests

- **Pure rule**: `isGone` at the edges of both conditions, with a clock passed in. The threshold
  read: defaults, a valid override, and a value out of range that falls back and is reported.
- **Mercadona runner**: `listingWhole` per warehouse with the listed keys. A warehouse with a
  category that answered 404 declares nothing and is named. An aborted run declares nothing. A
  product whose detail failed is still in the listed set.
- **Mercadona client**: a 404 category is named in `missingCategories` and yields no product.
- **DIA runner**: a scope with a failed page, an unfinished scope and a skipped scope declare
  nothing. A listed row with no stock is in the listed set. No declaration for `null`.
- **El Jamón runner**: one declaration for `null` when no page failed, none otherwise, none when
  aborted.
- **Sink**: with `listingWhole`, a tracked `ACTIVE` row that the listing named and whose detail
  failed gets no negative. A row the listing did not name gets one.
- **Executor**: the counter runs for `COMPLETED` only, and not for `FAILED`, `ABORTED`, a `PRICES`
  run or a detail backfill. An error in the counter leaves the run `COMPLETED` and fills
  `delisting.error`.
- **Integration, on real Postgres** (the counter):
  - the seed creates rows from `source_entry_prices` of the run's kind at S only,
  - three counted misses over 14 days make a pair gone, and a fourth run makes no second transition,
  - three misses in three days do not, under the default days,
  - a counted run that lists the product resets the pair and marks it pending,
  - the same run counted twice adds one miss,
  - a product never listed at S has no row at S and is never missed there,
  - `delistedAt` on the entry sets when every pair is gone and clears when one comes back,
  - two `ACTIVE` rows on one item: the item is sent gone only when both pairs are gone,
  - a failed catalog batch keeps `pendingCatalog`, and the next counted run sends it.
- **Catalog**: `delisted: true` sets `delistedAt` once and keeps the first instant, `false` clears it,
  absent leaves it. `onlyIfMissing` ignores it. An unchanged entry writes no audit row.
- **Gateway**: the list query parses `delisted` strictly, `"false"` included.
  `openapi-document.spec.ts` and `wire-types.spec.ts` pass after regeneration.

## Acceptance criteria

- [ ] Only `mercadona-api`, `dia-api` and `eljamon-web` declare a whole listing, under the conditions
      of section 2.
- [ ] A Mercadona warehouse with a category that answered 404 is not counted and is named in the
      report.
- [ ] A Mercadona product whose detail failed is not written `available: false` by the scope diff.
- [ ] A miss is counted only for a pair that a walk once listed, in a run that ends `COMPLETED`.
- [ ] A pair is gone after `delistAfterWalks` misses in a row and `delistAfterDays` days since the
      first of them, 3 and 14 by default.
- [ ] A gone pair of an `ACTIVE` row makes catalog write `available: false` and `delistedAt` at the
      scope and its copies, unless another `ACTIVE` row on the same product is still listed there.
- [ ] A counted walk that lists the product clears the pair, the entry's `delistedAt` and catalog's
      `delistedAt`, and writes `available: true`.
- [ ] `source_catalog_entries.delistedAt` is set only when every pair of the entry is gone.
- [ ] No row, price or claim is deleted by this plan.
- [ ] A bind of a gone row sends the gone statement after the prices.
- [ ] The run report carries the `delisting` object of section 8.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## Verification

```sh
npx nx test luna-shopper/mercadona
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-harvester
npx nx test luna-shopper-backend-catalog
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx build luna-shopper-backend-harvester
npx nx build luna-shopper-backend-catalog
npx nx affected -t lint test
```

`nx test` does not type check. The build lines do.

The integration specs need real Postgres. Run them on an ephemeral slot, which writes nothing under
the worktree:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n>
# run the harvester and catalog integration specs against slot <n>
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --down <n>
```

## Decisions

Chosen in this plan, and open to the owner's correction:

- **Gone is per scope first, and per chain only when every counted scope lost the product**
  (sections 4.1 and 4.3). A product sold in one warehouse is never gone because another warehouse
  does not list it.
- **A miss is "not in the listing", and the same rule fixes the existing scope negative** (section
  3). The fix is in this plan because both read the same new input. It can be split into its own
  pull request.
- **Only a `COMPLETED` run counts** (section 4.4). A `FAILED` run by the failure ratio may still have
  a whole listing. Counting it saves a week at most and risks a storefront in a bad state.
- **A Mercadona category that answers 404 makes the warehouse not whole** (section 2.1).
- **The threshold lives in `supermarket_sources.config`** with defaults 3 walks and 14 days (section
  5), and not in two new columns or an environment variable.
- **Catalog carries `delistedAt` now** (section 6.1), although only the follow ups read it. It is
  one nullable column and one optional field, and it lets the velista mock work from real data.
- **The counter writes `available: false` at the threshold, not at the first miss, for DIA and El
  Jamón** (sections 2.2 and 2.3). Mercadona keeps its first miss negative from plan 0103.
- **No backfill in the migration.** Each scope seeds itself from the prices it holds the first time
  a walk counts it (section 4.2).
- **A revert does not undo counts** (section 14).
- **A gone row keeps its `status`.** The queue filters on `delistedAt` rather than closing the row.

**Owner**: ask, do not choose.

1. **The threshold.** Are 3 whole walks and 14 days right for every chain, or does a chain need its
   own? DIA hides products that are out of stock from its listing, so it may need more.
2. **Carrefour.** Should a Carrefour crawl with no truncated category, no unreadable category, no
   block and no `seedPath` override count as whole? The runner states today that the frontier proves
   nothing, and this plan follows it.
3. **What a shopper sees for a gone product.** Is it hidden at that chain, which is what
   `available: false` does today, or shown with a "no longer sold" mark? The answer shapes the
   velista follow up and not this plan.
4. **A gone product with an `ADMIN` price.** Should the back office warn the person, or should the
   counter leave such a product sold until a person decides?
5. **Rows that wait in the queue.** Should a gone `UNRESOLVED` or `CANDIDATE` row drop out of the
   default queue view, so nobody spends time deciding a product the chain no longer sells?
