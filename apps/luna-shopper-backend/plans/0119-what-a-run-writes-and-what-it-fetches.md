> **PR:** [#386](https://github.com/IchirokuXVI/nx-portfolio/pull/386)

# 0119: what a run writes and what it fetches

> Admin half: `apps/luna-shopper-admin/plans/0029`.
>
> A Mercadona catalog discovery is 151 listing requests per warehouse and then about 4,232 product
> detail requests, every run, for every product, whether the harvester has seen it before or not.
> The detail exists for the EAN and the brand, and neither changes from one week to the next. This
> plan fetches details only for products the harvester does not know yet, with an option to fetch
> them all, and lets a run choose whether it writes prices, availability or both.
>
> Prerequisite reading: `0086` (why `REFRESH` was deleted), `0103` (a runner reports and the
> orchestrator writes), `0108` (several warehouses in one walk), `0118` (copies follow what a run
> writes), `mercadona-catalog.runner.ts`, `source-ingest.ts`, `source-snapshot.ts` and
> `run-report.sink.ts`.

## Brief for the agent

### Objective

Add `writes` and `details` to a catalog discovery run, make the Mercadona walk skip the detail of
a known product unless `details` is `ALL`, and make the ingest keep a known product's stored
identity when its detail was not fetched, as sections 2 to 8 describe.

### Context

- `HarvestRunMode` is `STORE_DISCOVERY`, `CATALOG_DISCOVERY`, `FILE_IMPORT`. `REFRESH` was deleted
  by plan 0086 because it fetched the same details again for the same numbers.
- `MercadonaCatalogRunner.run` (`mercadona-catalog.runner.ts:70`): phase 1 walks the tree per
  warehouse and builds the union of listed products. Phase 2 fetches the detail of **every**
  product in the union (:174). Phase 3 reports the per warehouse absences.
- `MercadonaListProduct` (`libs/luna-shopper/mercadona/src/lib/types.ts:66`) carries
  `displayName`, `unitSize`, `sizeFormat`, `price`, `unitPrice`, `unitPriceLabel`, `shareUrl`,
  `categoryPath`. It has **no `ean` and no `brand`**.
- `report.product` today takes `name`, `brand`, `ean`, `unitSize`, `categoryPath`, `url` from the
  detail, and `sizeFormat` and the prices from the listing.
- `SourceIngest.open` loads every `source_catalog_entries` row of the chain (`source-ingest.ts:202`),
  keyed by `externalId`. `touch` calls `applySourceGroup` (`source-snapshot.ts:69`), which assigns
  `brand`, `ean`, `unitSize`, `sizeFormat`, `categoryPath`, `url` and `extra` **verbatim**, so a
  null blanks a stored value.
- A runner holds no repository and no catalog client (plan 0103). `CatalogDiscoveryInput`
  (`catalog-runner.ts:40`) is the data a runner receives, and `detailBackfill` already travels on it.
- `AdapterCapabilities` (`harvest.messages.ts:213`) is generated into the admin as
  `HarvestAdapterCapabilityTable`.
- Scope availability is written by `writeScopeAvailability` (`run-report.sink.ts:410`), shop
  availability by `writeShopAvailability` (:332), prices by `SourceIngest.writeChunk` through
  `replaceScopePrices` and `addPrices`.

### Target state

Every acceptance criterion in section 10 holds, `openapi.json` and the wire types are regenerated,
and a recorded Mercadona walk with every product known makes no detail request.

### Scope

- Work only in: `libs/luna-shopper/contracts` (two enums, the spawn request, the capability table),
  the gateway harvest DTO, `harvester/src/app/harvest/` (spawn validation, executor, catalog runner
  input, `mercadona-catalog.runner.ts`, `source-ingest.ts`, `source-snapshot.ts`,
  `run-report.sink.ts`), their specs, and the generated files.
- Do NOT touch: `libs/luna-shopper/mercadona` (the client already has both calls), the other
  runners beyond passing the new input through, `detailBackfill`, catalog.

### Constraints

- No new run mode. Both settings are options of `CATALOG_DISCOVERY`.
- A runner still holds no repository: what it knows arrives on its input.
- Regenerate `openapi.json` and the wire types, never by hand.

### Action boundaries

- Proceed with in-scope edits, specs and generators.
- Stop and ask before running a real Mercadona walk (use the recorded fixtures), and if skipping a
  detail turns out to lose a field the listing does not carry beyond `ean` and `brand`.

### Progress evidence

Report after the contract and validation with specs, after the ingest's partial observation with
specs, after the runner change with a fixture run showing the request counts, and after `writes`
in the sink.

## 1. What is being built

| Piece                                   | Where                                             |
| --------------------------------------- | ------------------------------------------------- |
| `writes` and `details` on a spawn       | contracts, gateway DTO, `harvest-run.service.ts`  |
| `skipsKnownDetails` capability          | `ADAPTER_CAPABILITIES`                            |
| The known products on the runner input  | `run-executor.service.ts`, `catalog-runner.ts`    |
| Detail only for new products            | `mercadona-catalog.runner.ts`                     |
| A partial observation                   | `source-ingest.ts`, `source-snapshot.ts`          |
| Writing prices, availability or both    | `source-ingest.ts`, `run-report.sink.ts`          |
| The report                              | `mercadona-catalog.runner.ts`                     |

## 2. The request

```ts
enum HarvestRunWrites {
  PRICES_AND_AVAILABILITY = 'PRICES_AND_AVAILABILITY',
  PRICES = 'PRICES',
  AVAILABILITY = 'AVAILABILITY',
}

enum HarvestDetailFetch {
  /** Fetch the detail of a product the harvester does not know yet. */
  NEW = 'NEW',
  /** Fetch every product's detail, as every run does today. */
  ALL = 'ALL',
}

interface SpawnHarvestRunRequest {
  // ...everything it has today, and `scopeCopies` from plan 0118
  writes?: HarvestRunWrites; // default PRICES_AND_AVAILABILITY
  details?: HarvestDetailFetch; // default NEW
}
```

**The defaults are stored.** `validate` writes the resolved values into `harvest_runs.input`, so a
run's input says what it did even after a default changes.

## 3. Validation

- Both fields are accepted on `CATALOG_DISCOVERY` only.
- `details` is refused with `ValidationException` when stated explicitly for an adapter whose
  capability `skipsKnownDetails` is false. The default is not an explicit statement, so an
  unstated `details` on such an adapter is simply `ALL`, which is what it does anyway.
- `writes: PRICES` is refused for an adapter whose `writesPrices` is false (DEZA prints no price).
- `writes` with `detailBackfill` is refused: a backfill fetches product pages and is not a walk.

`AdapterCapabilities` gains `skipsKnownDetails: boolean`: true for `mercadona-api`, false for every
other adapter today. LIDL reads a product whole in one request and Carrefour already has its own
backfill, so neither has a detail phase to skip.

## 4. What a product is known by

**A product is known when its `source_catalog_entries` row exists for the chain and its `ean` is
not null.**

- The EAN is the one field only the detail gives that the harvester matches on. A row with no EAN
  gets its detail fetched again, which is how a detail that failed last week is retried this week.
- A product that genuinely has no EAN is fetched every run. The report counts them (section 8), so
  if that number is large it is visible.

The executor loads the known ids once, before the run starts, and passes them on the input:

```ts
interface CatalogDiscoveryInput {
  // ...everything it has today
  details: HarvestDetailFetch;
  /** External ids whose stored row carries an EAN. Empty when `details` is ALL. */
  knownExternalIds: ReadonlySet<string>;
}
```

A Mercadona chain holds about 4,300 rows, so the set is small. It is data on the input, not a
lookup the runner performs, so plan 0103's rule that a runner holds no repository stands.

## 5. The Mercadona walk

Phase 1 and phase 3 are unchanged. Phase 2 splits the union:

- **Unknown, or `details: ALL`:** fetch the detail and report the product exactly as today.
- **Known and `details: NEW`:** fetch nothing, and report a partial observation built from the
  listing of the first warehouse that listed it:

```ts
report.product({
  externalId,
  detailFetched: false,
  observedAt,
  prices: pricesOf(externalId, currency, scopes, assortments),
  // identity fields are omitted, see section 6
});
```

**Cost.** A walk of ten warehouses where every product is known is 1,510 requests instead of about
5,700. The first walk of a chain knows nothing and fetches everything, so it costs what it costs
today.

**What `details: NEW` stops noticing.** A product whose brand or EAN the chain corrects is not
re-read until a run with `details: ALL`. The owner accepted that. A monthly preset with `ALL`
(plan 0120) is the intended remedy.

## 6. A partial observation

`SourceObservation` gains `detailFetched?: boolean`, absent meaning true. When it is false:

- The identity fields (`name`, `brand`, `ean`, `unitSize`, `sizeFormat`, `categoryPath`, `url`,
  `extra`) are **not read**, and `applySourceGroup` is not called. The stored row keeps what the
  last full read wrote.
- The seen fields move as they do today: `timesSeen`, `lastSeenAt`, `lastRunId`.
- The prices are written as they are today, subject to `writes`.
- `sourceGroupChanged` is false, so the row counts as `unchanged` unless a price moved it.
- **A partial observation for an id with no row is skipped** with a `DETAIL_SKIPPED_UNKNOWN`
  warning. It can only happen if a row is deleted between the executor loading the set and the
  ingest reaching the product, and creating a row without a name or EAN is worse than waiting a
  week.

This is also the fix for a trap the plan found: today a null in an observation blanks a stored EAN.
The partial observation never carries a null for a field it did not read, so the trap stays out of
reach. The verbatim assignment for a full observation is unchanged.

## 7. Writes

The setting is enforced where the writes happen, so every adapter and every copy (plan 0118) obeys
it without a runner knowing:

| `writes`                  | `source_entry_prices` and `addPrices` | scope and shop availability |
| ------------------------- | ------------------------------------- | --------------------------- |
| `PRICES_AND_AVAILABILITY` | written                               | written                     |
| `PRICES`                  | written                               | skipped                     |
| `AVAILABILITY`            | skipped                               | written                     |

Products are ingested in every case: rows are created, seen fields move and the review queue fills
as it does today. A run that writes availability only still walks the listing, which is where the
availability comes from, so it costs the same requests as a price run. **For Mercadona the saving
is `details: NEW`, not `writes`.**

Revert is unchanged. A run that wrote no price deletes none.

## 8. The report

`harvest_runs.report` for a Mercadona walk gains:

- `productsDetailed`: kept, now the number of detail requests made.
- `productsDetailSkipped`: known products reported from the listing.
- `productsWithoutEan`: fetched because their row has no EAN.
- `writes` and `details`: the resolved settings.

## 9. Tests

- **Validation**: each refusal in section 3, and the defaults written into `input`.
- **Executor**: `knownExternalIds` holds only ids whose row has an EAN, and is empty for `ALL`.
- **Runner** (`mercadona-catalog.runner.spec.ts`, fixtures): with every id known and `NEW`, zero
  detail calls and every product reported with `detailFetched: false`. With one unknown id, one
  detail call. With `ALL`, every detail fetched.
- **Ingest**: a partial observation keeps the stored `ean`, `brand` and `name`, moves `lastSeenAt`,
  writes its prices, and counts as unchanged. A partial observation with no row is skipped with
  the warning.
- **Sink**: `PRICES` writes no availability, `AVAILABILITY` writes no price and no
  `source_entry_prices` row, and copies (plan 0118) follow both.

## 10. Acceptance criteria

- [ ] A spawn accepts `writes` and `details`, stores the resolved values, and refuses the cases in
      section 3.
- [ ] A Mercadona walk with `details: NEW` fetches the detail of unknown products only.
- [ ] A skipped detail never blanks a stored field.
- [ ] `writes` controls prices and availability for walked scopes and copies alike.
- [ ] The report states detail requests made, skipped, and fetched for a missing EAN.
- [ ] No run mode is added.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## 11. Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-harvester
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx affected -t lint test
```
