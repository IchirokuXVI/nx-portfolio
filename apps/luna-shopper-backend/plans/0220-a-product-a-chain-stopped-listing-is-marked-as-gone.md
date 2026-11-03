> **PR:** [#888](https://github.com/IchirokuXVI/nx-portfolio/pull/888)

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
Section 15 adds what the owner decided on 2026-11-01: an **out of stock** state at the scope that
the first miss and the stock indicators write, a stock signal per adapter in `AdapterCapabilities`,
Carrefour as a whole walk behind a config switch, a price of a person or a leaflet that keeps a
product sold, and the basket that prefers a product in stock. Build section 15 as part of this plan.

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
    `supermarket-item.service.ts`, the mappers of `SupermarketItemView` and `ItemOfferView`, and
    the read of the scopes of an item (section 15.2).
  - `apps/luna-shopper-backend/gateway/src/app/harvest/` (the list query DTO and the entry view DTO)
    and any gateway DTO that mirrors `SupermarketItemView` or `ItemOfferView`.
  - `apps/luna-shopper-backend/gateway/src/app/baskets/basket-catalog.service.ts`, for the pick of
    section 15.5 only.
  - `harvest/carrefour-catalog.runner.ts`, for the declaration of section 15.4 only.
  - `libs/luna-shopper/contracts` (the fields of sections 12 and 15 and their schemas, and the two
    capabilities of section 15.3).
  - Their specs, and the generated files.
- Do NOT touch: the DEZA and LIDL runners, the ingest ladder, the price writer and the effective
  price recompute, `deriveScopeFlags`, core, `apps/velista`, `apps/luna-shopper-admin`, the schedule
  worker, and any adapter library other than Mercadona. The wire types of the admin regenerate; its
  screens do not change.

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
5. Section 15: the `outOfStockAt` column and field, the first miss and the DIA stock count writing
   it, the two capabilities, the Carrefour declaration behind its switch, the kept sold rule, and the
   basket pick, each with its spec.

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
| `carrefour-web` | behind a switch   | the default scope (null)  | section 15.4: `delistCountsCrawl` true, no truncated category, no unreadable category, no block, no `seedPath` |
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
section 3 makes it safe: the runner names the warehouse with `listingNotWhole(warehouse,
'category-404', missingCategories, listedIds)`, and a listing that is not whole states positives
only (section 8). A tree that answers 404 is named as the category `categories`, because a walk of
it lists nothing at all.

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
empty, the run is not aborted, and every category that printed a count read at least that many rows
(`rowsRead >= printedCount`). A category that printed no count counts as short. A walk that misses
any of the three declares nothing whole, and `notWhole` names the reason: `failed-page`, or
`short-category` with each short category and both its numbers. To count too few is the safe error.
The external id is the chain's product code (`listed.row.code`), so a renamed product keeps its key.

The runner doc says that El Jamón writes no availability. That stays true of the runner. The counter
writes a negative only after the threshold, and the doc gains one sentence that says so.

Each category prints a count (`printedCount`) and the walk counts the rows it read (`rowsRead`). A
product filed in two categories is read twice, so a category may read more than it printed, never
fewer. The check against the committed fixtures (the action boundary) found the case that needs the
count: the client ends a category quietly on an empty page or on a page that repeats a code it
read, with no failed page. The client spec walks `category-page-1.html`, which prints 1039 articles,
and ends at 40 rows with no failed page. So "no failed page" alone does not prove a whole listing,
and the owner chose the printed count as the second test on 2026-11-01.

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
   `source_entry_prices` row at S of the run's own source kind with `copiedFromScopeId IS NULL`, and
   has no presence row at S. That is a product a walk once listed at S, before this plan existed.
   `ON CONFLICT DO NOTHING`. Only a price the scope read itself counts: a run's copies (plan 0118)
   write `source_entry_prices` rows at their targets too, and a copy target never listed the
   product (the action boundary, answered by the owner on 2026-11-01).
3. **Listed.** Insert a row for each resolved entry that has none at S. For each resolved entry
   whose row has `missedWalks > 0` or `goneAt` set, set `missedWalks` 0, `firstMissedAt` null,
   `goneAt` null, `lastCountedRunId` to the run and `pendingCatalog` true. A row that was only
   missed is told too, because its first miss told catalog it was out of stock (section 15.1). The
   rows that had `goneAt` set are the products that came back.
4. **Missed.** For each row at S whose entry is not resolved and whose `lastCountedRunId` is not
   this run, add one to `missedWalks`, set `firstMissedAt` to `coalesce(firstMissedAt, now)` and
   `lastCountedRunId` to the run. A row that goes from 0 to 1 also gets `pendingCatalog` true
   (section 15.1).
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
| `supermarket_items` at S and its copies | `available: false` and `delistedAt` set, unless section 15.6 keeps it sold |
| `supermarket_items` at S, on the first miss | `outOfStockAt` set, `available` untouched (section 15.1)              |
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

**`available` is optional when `delisted` or `outOfStock` is given.** The schema requires `itemId`
and at least one of `available`, `delisted` and `outOfStock`. An entry with no `available` keeps
the flag of a row that exists, and creates no row where the scope has none: it says nothing about
whether the scope sells the product. `onlyIfMissing` creates only from an entry that carries
`available`. This is what keeps a first miss from turning on a product that a 404 turned off
(section 15.1).

After the transaction of section 4.2, the counter sends, per scope S, every pair with
`pendingCatalog` true whose entry is `ACTIVE`:

- gone: `{ itemId, available: false, delisted: true }`,
- first miss: `{ itemId, outOfStock: true }` (section 15.1),
- listed again: `{ itemId, delisted: false }`. A pair that step 3 brought back from gone in this
  run also carries `available: true`, unless a claim of the same run named the item at S. The sink
  has already stated the walk's positive and its claims by then, and this must not override them.
  A pair sent again by a later run, after a failed batch, carries `delisted: false` alone.

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
0, `goneAt` goes to null, and catalog gets `{ available: true, delisted: false }`, or
`{ delisted: false }` when a claim of the same run named the item at S (section 6.1). The entry's
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
        "newlyOutOfStock": 5,
        "newlyGone": 3,
        "cameBack": 1
      }
    ],
    "thresholdIgnored": [],
    "notWhole": [{ "key": "4804", "reason": "category-404", "detail": ["112"] }],
    "entriesDelisted": 2,
    "entriesBack": 1,
    "catalogSent": 4,
    "catalogFailed": 0,
    "catalogKeptSold": 0,
    "error": null
  }
}
```

`newlyOutOfStock` counts the pairs whose first miss this was. `thresholdIgnored` names each
override of section 5 that was out of range, with its value. The reasons of `notWhole` are those
of a runner (`category-404`, `failed-page`, `unfinished`, `short-category`, and Carrefour's five of
section 15.4) and two of the sink: `adapter-cannot-prove` for a declaration from a chain whose
adapter cannot prove a delisting (section 15.3), and `scope-unresolved` for a key that resolves to
no scope. A runner names a scope that is not whole with `RunReport.listingNotWhole(key, reason,
detail, listed)`, and hands over what it did read: that scope then gets the positives of what it
listed and the explicit claims, and no negative, because a listing with a hole in it proves nothing
absent. A Mercadona warehouse whose walk met a category that answered 404 is such a scope, and the
listing wins over its `assortmentComplete`.

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
| `SetSupermarketItemAvailabilityRequest.entries[]`    | `delisted?: boolean`, and `available` optional when `delisted` or `outOfStock` is given (section 6.1) |
| `SupermarketItemView`                                | `delistedAt: string \| null` and `outOfStockAt: string \| null`, not required in the schema |
| `ItemOfferView`, the scopes of an item               | `outOfStockAt: string \| null`, not required (section 15.2) |
| `SetSupermarketItemAvailabilityRequest.entries[]`    | `outOfStock?: boolean` (section 15.1)       |
| `SetSupermarketItemAvailabilityResult`               | `keptSold: number` (section 15.6)           |
| `AdapterCapabilities`                                | `stockIndicator` and `provesDelisting` (section 15.3) |

The gateway query DTO of the source entry list gains `delisted` with a strict boolean parse. The
gateway pipe has read the string `"false"` as true on a boolean before (plan 0206 review). A spec
covers `"false"`. The fields are not required in the schemas, so the back office's typed fixtures
stay valid, as plan 0206 did with its new fields. Regenerate `openapi.json` and the wire types.

No velista code changes. `ItemOfferView.outOfStockAt` reaches velista through the gateway and is
drawn by the follow up of section 13, after its mock. The basket pick of section 15.5 is a gateway
rule and changes no view.

## 13. The follow ups that need a mock

These need a mock before a plan, by the repository rule. This plan designs no screen.

- **Admin: gone products in the source queue and on a product.** The queue filter on `delisted`,
  the date a row went, the scopes it went at, and a product whose offer says `delistedAt`. It needs
  a per scope read of `source_entry_scope_presence`, which that plan adds.
- **Velista: a product out of stock at a chain.** The owner decided on 2026-11-01 that a product
  gone at a chain shows exactly what a product the chain never sold shows, and that copy exists
  ("not sold here", "not at {{supermarket}}"). The follow up is thus only the out of stock mark,
  from `ItemOfferView.outOfStockAt`, on a line, a basket row, a search result and the product
  sheet. Do not reuse the "no longer in the catalog" copy: that is for a product deleted or merged
  across the whole catalog, and a product gone at one chain is still in the catalog.
- **Admin: the stock signal of a chain.** `adapterCapabilities(adapterKey)` answers it, so the chain
  row can say "cannot tell stock, review by hand" with no new route. A mock first.

## 14. What this plan does not do

- It does not hide an out of stock product, and it does not keep a shopper from buying one
  (section 15.1).
- It does not build an inactive chain, which the owner left for a later plan: a chain switched off
  that stops walks and hides its offers from every shopper endpoint without a delete. The walk half
  exists (`supermarket_sources.enabled`, plan 0083). The read half is a rule on the chain, not on
  the product, and belongs to its own plan.

- It counts nothing for Carrefour, DEZA, LIDL or a file import.
- It deletes no row, price or claim, and withdraws no price.
- It changes no price policy and no effective price rule.
- It does not undo counts when a run is reverted. The next counted walk corrects the pairs it lists.
  A revert of a run that made a product gone leaves it gone until a counted walk lists it.
- It does not count shops. `source_entry_availability` keeps per shop claims as plan 0182 built.
- It does not change `status` and does not reject or unbind a gone row.
- It adds no alert. Plan 0218 decides what the owner hears.
- It adds no screen.

## 15. Out of stock, the stock signal and the basket (owner, 2026-11-01)

The owner's model, reviewed against the code on 2026-11-01. A chain tells stock in one of three
ways, and a product passes through three states at a scope:

| State                 | `available` | `outOfStockAt` | `delistedAt` | Seen by a shopper                                |
| --------------------- | ----------- | -------------- | ------------ | ------------------------------------------------ |
| sold, in stock        | true        | null           | null         | listed, priced, bought                           |
| sold, out of stock    | true        | set            | null         | listed, priced, bought, marked (follow up)       |
| not sold (gone)       | false       | kept           | set          | hidden at that chain, kept on the shopper's rows |

**Out of stock hides nothing and stops no purchase.** A chain changes its page at any hour and a
walk runs once a day at most, so a product a walk missed may be back on the shelf before anyone
looks. Search, the best offer and every price read keep treating the row by `available` alone. The
only read that prefers stock is the basket pick of section 15.5.

### 15.1 The column, the write and who sends it

`supermarket_items.outOfStockAt timestamptz null`, beside `delistedAt`, in the same catalog
migration. `SetSupermarketItemAvailabilityRequest.entries[]` gains `outOfStock?: boolean`:

- `outOfStock: true` sets `outOfStockAt` to now when it is null and keeps it when set.
- `outOfStock: false` sets it to null.
- Absent leaves it as it is, which is every caller today. `onlyIfMissing` ignores it, as it ignores
  `delisted`. An entry that changes neither `available`, `delistedAt` nor `outOfStockAt` counts for
  nothing.

Two things send `outOfStock`:

1. **An indicator on the page.** DIA lists a row with `unitsInStock`. The runner's `availabilityOf`
   writes `available: false` for a listed row with no stock today (`dia-catalog.runner.ts:756`),
   which hides the product at DIA as if DIA did not sell it. It becomes `{ available: true,
   outOfStock: true }`, and a listed row with stock becomes `{ available: true, outOfStock: false }`.
   The claim path of the sink carries the new flag beside `available`. Mercadona's 404 stays a
   negative, because "not stocked in this warehouse" is the warehouse's catalog and not its shelf,
   and DEZA's per shop claims stay in `supermarket_location_items` (plan 0084) and are not touched.
2. **The first miss.** In step 4 of section 4.2, a row whose `missedWalks` goes from 0 to 1 gets
   `pendingCatalog` true, and the counter sends `{ outOfStock: true }` for its item at S and its
   copies, subject to section 6.2. The chain delisted the product or ran out of it, and a walk
   cannot tell which, so the product is out of stock until the threshold says gone. The entry
   carries no `available` (section 6.1). A product a 404 turned off at S stays off, and the seed's
   first count after the deploy turns on no product that the old diff had already set not sold.
   Step 3 (listed again) sends `{ delisted: false }`, and `available: true` only for a pair that
   was gone and that no claim of the run named at S (section 6.1). Step 5 (gone) sends
   `{ available: false, delisted: true }` and leaves `outOfStockAt` as it is.

**The sink clears the mark, and a claim beats it.** The sink drains before the counter runs. For a
scope declared whole, its positive for a named row is `{ available: true, outOfStock: false }`: the
listing says the product is on the shelf. A claim for that item at S overrides it, so DIA's
`unitsInStock` 0 keeps `outOfStock: true` and Mercadona's 404 keeps `available: false`. The sink
hands the counter the items its claims named per scope, and the counter's listed again statement
turns none of them on.

This changes one decision below. The scope negative of section 3 for a row the listing did not
name is the first miss of a delisting chain, for Mercadona too: `writeScopeAvailability` writes
`outOfStock: true` for it and no longer `available: false`. Mercadona's 404 is an indicator and
keeps writing `available: false` through the claims. The DIA third claim ("not listed here and
listed by another scope") is removed from `availabilityOf`, because the listing diff of section 3
now states it.

**Who writes the diff, per row (owner, 2026-11-01).** Read literally, the paragraph above would
send `outOfStock: true` for every tracked row the listing did not name. That creates sold offers at
scopes that never sold the product, because catalog creates a row it is missing, and it sets gone
products back to sold on every walk. So for a scope a runner declared whole, `writeScopeAvailability`
states, per tracked `ACTIVE` row:

- **Named by the listing:** the positive, as today, with `outOfStock: false`, and the explicit
  claims (DIA's stock, and Mercadona's 404), which override it. A named row whose detail failed
  gets no statement, and no other row of its product writes a negative for it.
- **Not named, with no presence row at S and no price row at S that the scope read itself**
  (`copiedFromScopeId IS NULL`, the seed's own condition): `available: false`, as today. This scope
  never sold the product, and the row says so. It is the cross warehouse negative of plan 0108: plan
  0187 reads a `false` row as the answer "not sold here", and no row as no answer, so without it a
  product sold at warehouse A only would show for a shopper of warehouse B as "no price here"
  instead of being left out.
- **Not named, with a presence row at S or such a price row:** the sink writes nothing. The
  counter's step 4 is the only writer for it: `outOfStock: true` at the first miss, and
  `available: false, delisted: true` at the threshold.

The sink thus reads `source_entry_scope_presence` and `source_entry_prices` at drain; both are
harvester tables. A product the counter tracks at S through any of its rows gets no negative from
another row of it either. The Mercadona runner's phase 3 claims ("not listed in this warehouse") are
removed, because this diff states the same thing with the presence rule applied. Mercadona's 404 is
stated as a claim `available: false` at the warehouse the detail was asked of and no other, and the
sink resolves the item of a claim about a product the run did not report through the tracked row.

**DIA's scope claims reach catalog for the first time.** Before this plan the sink wrote scope
claims only for a scope with `assortmentComplete`, which DIA never declared, so DIA's per store
stock claims were stored nowhere. A DIA store declared whole or not whole now carries them.

The miss count still moves only on a whole walk of a `COMPLETED` run (section 4.4). A product a
walk never listed has no presence row and gets no state. `delistAfterWalks` is at least 1, so at
least one whole walk that did not list the product stands between sold and gone.

### 15.2 The reads

`outOfStockAt` is carried, never filtered on:

- `SupermarketItemView.outOfStockAt`, from the column.
- `ItemOfferView.outOfStockAt`, from the row the offer was read from, for `bestOffer`, `offers`
  and the search result quote.
- The scopes of an item carry it too, where they carry `available`.

Search, `bestOffer`, the cheapest of a line, the effective price and the stale rule read nothing new.

### 15.3 The stock signal of an adapter

`AdapterCapabilities` (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts`) gains two
fields, with the "I know nothing" rule of `adapterCapabilities` answering `null` and `false`:

| `adapterKey`    | `stockIndicator` | `provesDelisting` | Why                                                              |
| --------------- | ---------------- | ----------------- | ---------------------------------------------------------------- |
| `mercadona-api` | `per-scope`      | true              | a 404 per warehouse; the listing of a warehouse is whole         |
| `dia-api`       | `per-scope`      | true              | `unitsInStock` on each listed row; the store listing is whole    |
| `eljamon-web`   | `null`           | true              | the page states no stock; the national list is whole             |
| `deza-web`      | `per-shop`       | false             | the popup names the shops; the 300 row cap                       |
| `carrefour-web` | `null`           | false             | `units_in_stock` is in the type and nothing reads it; the ceiling. The chain's `delistCountsCrawl` (section 15.4) overrides the constant in the harvester's resolution, not in the table |
| `lidl-api`      | `null`           | false             | an offer window, prices end by `validUntil`                      |
| `osm`, `manual` | `null`           | false             |                                                                  |

`stockIndicator: 'per-shop' | 'per-scope' | null`. A chain with `null` and `false` cannot tell that
a product it once listed is still sold, and that is what the admin follow up of section 13 shows
on the chain row as "may hold products it no longer sells, review by hand". The harvester reads the
same table to decide which runners may declare `listingWhole`, so the table and the runners cannot
disagree: a declaration from a runner whose adapter says `provesDelisting: false` and whose chain
has no switch on is refused at the sink with a report line.

### 15.4 Carrefour behind a switch

`supermarket_sources.config.delistCountsCrawl` (boolean, default false, read beside the threshold
of section 5). When true, the Carrefour catalog runner calls `report.listingWhole(null, ids)` after
the crawl when all of these hold: `truncatedCategories` is empty, `unreadableCategories` is empty,
`blockedAfter` is null, the run was not aborted, and `config.seedPath` is unset. Otherwise it
declares nothing and the report's `notWhole` names the reason (`truncated`, `unreadable`,
`blocked`, `seed-path`, `switch-off`). The runner doc sentence "It states no completeness" is
reworded to say under which conditions it does.

Why a switch. The frontier is the shallowest category under the 1008 row ceiling. A crawl that
meets the five conditions read every category it chose in full, and the remaining doubt is a
product filed in no frontier category, which nobody has measured. The owner's condition for
turning the switch on is a comparison of two consecutive clean crawls: the products one lists and
the other does not. That is an operator's step with the report, not code of this plan.

### 15.5 The basket prefers a product in stock

In `BasketCatalogService.pricesFor` (gateway), the pick of a line with several products and no
favourite becomes, in this order:

1. the favourite, when the line has one and it is priced at the read's scopes, as today,
2. else the cheapest priced product whose offer row has `outOfStockAt` null,
3. else the cheapest priced product, out of stock included.

A product with no price is not a candidate, as today. A line whose only product is out of stock
keeps it. `compose` reuses the same products. A spec covers a line with a cheaper out of stock
product and a dearer one in stock, which picks the dearer one, and a line where every product is
out of stock, which picks the cheapest.

### 15.6 A price of a person or a leaflet keeps a product sold

Catalog decides, because catalog holds the prices (plan 0080). In `setAvailability`, an entry with
`available: false` and `delisted: true` for a row that holds an eligible, not stale `ADMIN` or
`LEAFLET` price at that scope writes `delistedAt` and leaves `available` true. The result counts it
in `keptSold` only when the row exists and was sold, so the price is what kept it from turning
off. The run report carries the number as `delisting.catalogKeptSold`. The back
office follow up shows a row with `delistedAt` set and `available` true as the conflict it is, and a
person decides. The counter does not override a person or a current leaflet. A walk price cannot be
current on a gone product: the walk that wrote it listed the product, and 14 days is twice the 7 day
age of a walk price.

### 15.7 Gone is per chain, and nothing else

A chain's walks change only that chain's rows: its `source_catalog_entries`, its presence rows and
the `supermarket_items` rows of its scopes and their copies. No row of another chain and no column
of the product changes when a product goes gone at one chain. A chain with no counted walk keeps
saying sold. The integration spec of the Tests section holds two chains over one product, walks
one, and asserts the other chain's rows byte for byte.

## Tests

- **Section 15**: `outOfStock` true sets `outOfStockAt` once, false clears it, absent leaves it,
  `onlyIfMissing` ignores it. A DIA row with no stock writes `{ available: true, outOfStock: true }`
  and is not hidden. The first miss writes `outOfStock: true` and not `available: false`, for
  Mercadona too; the 404 claim still writes `available: false`. A Carrefour run declares whole only
  under the five conditions and with the switch on, and names the reason otherwise.
  `adapterCapabilities` answers the table of 15.3 and `null`/`false` for an unknown key. The basket
  pick: favourite, then in stock, then cheapest. `keptSold` for an `ADMIN` price and for a current
  leaflet price, and not for a stale one. Two chains, one product, one walked: the other is
  unchanged.
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
- [ ] An out of stock product stays `available: true`, is listed and priced, and carries
      `outOfStockAt` on `SupermarketItemView` and `ItemOfferView`.
- [ ] The first whole walk that misses a product the scope once listed writes `outOfStock: true`
      and never `available: false`, for every counting chain. Mercadona's 404 still writes
      `available: false`, and a product the scope never listed is still written `available: false`.
- [ ] A DIA row listed with no stock is out of stock and not hidden.
- [ ] `adapterCapabilities` carries `stockIndicator` and `provesDelisting` as section 15.3 says.
- [ ] A Carrefour crawl counts as whole only with `delistCountsCrawl` true and the five conditions.
- [ ] A basket line with no favourite picks the cheapest product in stock before a cheaper one out
      of stock.
- [ ] A row with a current `ADMIN` or `LEAFLET` price stays `available: true` at the threshold, gets
      `delistedAt`, and is counted in `keptSold` and `delisting.catalogKeptSold`.
- [ ] A product's rows at another chain are unchanged by a chain's walks.
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
- **The counter writes `available: false` at the threshold, and the first miss writes
  `outOfStockAt`, for every counting chain** (section 15.1). Mercadona's 404 keeps its negative
  from plan 0103, because it is an indicator and not a miss. Before 2026-11-01 this read "Mercadona
  keeps its first miss negative"; the owner's model of section 15 replaced it.
- **No backfill in the migration.** Each scope seeds itself from the prices it holds the first time
  a walk counts it (section 4.2).
- **A revert does not undo counts** (section 14).
- **A gone row keeps its `status`.** The queue filters on `delistedAt` rather than closing the row.

**Owner** (answered 2026-11-01):

1. **The threshold.** 3 whole walks and 14 days, as defaults in `supermarket_sources.config`,
   overridable per chain. Nothing in the back office writes `config` today, so an override is a SQL
   edit until a route exists. DIA is the chain most likely to need more.
2. **Carrefour.** Counts as a whole walk under the five conditions of section 15.4, behind
   `delistCountsCrawl`, off until two consecutive clean crawls were compared for churn.
3. **What a shopper sees.** Three states (section 15): sold, out of stock, not sold. Out of stock
   hides nothing and is still bought; the basket prefers a product in stock. Gone is hidden at that
   chain and kept on the shopper's lines and basket rows with the "not sold here" copy that exists.
4. **A product with a current `ADMIN` or `LEAFLET` price** stays sold at the threshold, gets
   `delistedAt`, and is flagged for a person (section 15.6).
5. **Rows that wait in the queue** stay in the default view. The list can filter on `delisted`.
6. **Gone is per chain only** (section 15.7). The inactive chain is a later plan (section 14).
