> **PR:** [#316](https://github.com/IchirokuXVI/nx-portfolio/pull/316)

# 0103 A runner reports and the orchestrator writes

A harvest run has two halves. The first half is different for every source: a JSON index, a rendered
page behind a browser, a store service, a file somebody uploaded. The second half is the same for all
of them: rows, the match ladder, the prices, the queue, the counters. Plan `0086` said so in D5 and
built `SourceIngest` for it, and that is why a file import already holds no fetching of its own.

The first half never finished moving. Five of the seven runners still read and write on their own
account: two hold a TypeORM repository, four hold a `CatalogClient`, and one of them creates price
scopes in catalog that no other runner can create. The prices of a run are keyed to a single scope
for the whole run, so the one source that publishes a price per region has to work around the ingest
contract, and its export comes out with no price in it at all.

This plan finishes the move. **A runner fetches and reports. It holds nothing else and it can reach
nothing else.** Everything a report needs doing is done by one orchestrator, for every source, in one
place. Along the way the run stops being single scope, and so does the file it exports.

Depends on `0086` for the ingest, the export and the document schema this plan versions. Depends on
`0080`, because several scopes writing side by side is the same rule as several sources writing side
by side. Reverses one decision of `0089`, section 8, which is called out in D5.

## 1. What is true today

Measured by reading the seven runners on `dev` at `92e098e7`.

| Runner                     | Fetches            | Writes on its own account                         | Reads on its own account           |
| -------------------------- | ------------------ | ------------------------------------------------- | ---------------------------------- |
| `MercadonaCatalogRunner`   | JSON API           | `catalog.setAvailability`                         | `Repository<SourceCatalogEntry>`   |
| `DezaCatalogRunner`        | rendered pages     | `catalog.setLocationAvailability`, shop rows      | `SourceLocationService`            |
| `CarrefourCatalogRunner`   | browser            | nothing                                           | nothing                            |
| `CarrefourDetailRunner`    | browser            | `catalog` calls                                   | `Repository<SourceCatalogEntry>`   |
| `LidlCatalogRunner`        | JSON API and pages | `catalog.createPriceScope`                        | `catalog.listPriceScopes`          |
| `LidlStoreDiscoveryRunner` | store service      | `Repository<DiscoveredPlace>`, `createPriceScope` | `catalog.getSupermarket`           |
| `OsmStoreDiscoveryRunner`  | Overpass           | `Repository<DiscoveredPlace>`                     | `catalog.resolveNearestPostalCode` |
| `FileImportRunner`         | nothing, a file    | nothing                                           | nothing                            |

Two of the eight are already what this plan asks for. The other six are the work.

### 1.1 A LIDL export carries no price, and the data is in the database

`buildHarvestDocument` is handed `run.priceScopeId` and its `priceFor` returns the one
`source_entry_prices` row matching it (`harvest-export.ts`). A LIDL run is **refused** a
`priceScopeId` at the spawn, so that column is null, so `priceFor` returns null for every product,
so every exported product loses its `price`, its `unit_price` and its `validity`.

The rows themselves are correct and present. A LIDL run writes one `source_entry_prices` row per
product per region, each stamped with `runId` and `priceScopeId`. The export drops them because it
can only ask for one scope, and the file it writes has nowhere to put more than one.

**So this is not a fetching defect and no crawl has to be repeated.** The rows a past run wrote are
enough to export correctly once the export and the format can carry them.

### 1.2 The capability tables are duplicated, and they already disagree

Which adapters need a price scope is stated twice.

| Where                                               | Says                                                  |
| --------------------------------------------------- | ----------------------------------------------------- |
| `harvest-run.service.ts`, `PRICE_YIELDING_ADAPTERS` | `mercadona-api` and `carrefour-web` must be given one |
| `runs-page.ts`, `SCOPED_ADAPTER`                    | `mercadona-api`                                       |

The form offers the scope picker only when the adapter is the one it names, and sends an empty scope
otherwise (`runs-page.ts:697`). A `carrefour-web` catalog discovery started from the back office
therefore sends no scope and is refused by the spawn with a message about a field the form never
showed. The table has to live in one place that both read, and this plan moves it to
`libs/luna-shopper/contracts`.

### 1.3 Scope creation exists once, in the wrong layer

`LidlCatalogRunner.resolveScopes` pages every scope of the chain, then creates the ones it did not
find. `LidlStoreDiscoveryRunner` does the same again. No other runner can do it, `SourceIngest`
cannot do it at all, and a file import cannot do it even when the file describes the regions.

## 2. The shape

### 2.1 A runner reports, and that is the whole of its surface

```ts
export interface CatalogRunner {
  run(context: RunContext, report: RunReport, input: CatalogDiscoveryInput, source: SupermarketSource): Promise<void>;
}
```

A runner is constructed with its fetching seam and its configuration. **No repository, no
`CatalogClient`, no `SourceIngest`, no `SourceLocationService`.** `harvest.module.ts` stops providing
them to runners, which is the check that makes the rule real: a runner that wants to write has
nothing to write with, and the compiler says so.

`RunContext` stays what it is, the progress and abort channel. It writes the run's own stage, counters
and warnings, which is the runner describing itself rather than the runner writing product data.
`RunReport` is a second object rather than more methods on the context, because a context that both
reports progress and accepts products invites a runner to reach for the store behind it, and the
point of this plan is that there is nothing to reach for.

### 2.2 What a report can say

```ts
export interface RunReport {
  /** A price scope the source names. Declared before any price refers to it. */
  scope(declaration: ScopeDeclaration): void;

  /** One product as the source described it, with a price per scope it stated. */
  product(observation: SourceObservation): void;

  /** A shop the source named, for a store discovery run or for availability. */
  place(place: ObservedPlace): void;

  /** What the source said about stock, by scope or by the source's shop code. */
  availability(claim: AvailabilityClaim): void;

  /**
   * The run walked the whole assortment of this scope, so a tracked product it
   * did not name is not stocked. Section 6.1.
   */
  assortmentComplete(scopeKey: string | null): void;
}
```

Every method is synchronous and returns nothing. A runner cannot await a write, cannot read a result
back, and cannot learn what the orchestrator decided. That is deliberate: an outcome a runner can
read is an outcome a runner starts branching on, and the branch belongs to the orchestrator.

`ScopeDeclaration` is the source's own grouping, not ours:

```ts
export interface ScopeDeclaration {
  /** The source's own key for the group of shops that pays one price. */
  key: string;
  kind: PriceScopeKind;
  /** What the source calls it, for a scope the orchestrator has to create. */
  name: string | null;
}
```

### 2.3 The orchestrator drains it

`RunExecutorService` already picks the runner and drives it. It gains the other side of the sink:

1. Resolve every declared scope through `PriceScopeResolver`, once per run, cached by key.
2. Push products into an ingest session in chunks.
3. Write places through `DiscoveredPlaceService`.
4. Resolve shop codes through `SourceLocationService` and write availability through `CatalogClient`.
5. Close the session, flush the counters, write the report.

**The ingest becomes a session, because a chunk cannot rebuild the indexes.** `SourceIngest.ingest`
loads the chain's rows, the sibling index and the catalog item index once, then loops over the
observations of that one call. A sink that flushes in chunks has to keep those three across chunks or
it would reload them per chunk and lose the sibling index a chunk earlier created. So:

```ts
const session = this.ingest.open(context, { supermarketId, sourceKind });
await session.push(observations); // as often as the sink flushes
const result = await session.close();
```

`ingest()` stays as a one call wrapper over `open`, `push`, `close`, so the file import and every
existing spec keep working while the rest moves.

## 3. Price scopes are declared, resolved once, and created when missing

### 3.1 A price names the scope it belongs to

`SourceObservation.price` gains one field:

```ts
price: {
  /** The scope key this price is for, from a declaration. Null means the run default. */
  scopeKey: string | null;
  price: number | null;
  currency: string;
  // ...unchanged
} | null;
```

and an observation carries several prices rather than one:

```ts
prices: readonly SourceObservationPrice[];
```

An empty array is a product the source named and priced nowhere, which is 21 of a LIDL week and
every DEZA product. `price` becomes `prices` across the ingest, so the one field that used to force a
call per scope now travels with the product.

### 3.2 The default scope, and who supplies it

Resolution has two rules and no more:

- **A price whose `scopeKey` is null is written to the run's default scope**, which is
  `harvest_runs.priceScopeId`, which is what the operator chose at the spawn.
- **A price whose `scopeKey` is set is written to the scope that key resolves to.** The resolver looks
  the key up among the chain's existing scopes by `externalKey`, and creates the scope from the
  declaration when there is none.

A price with no scope key and no default is a warning naming the product, and no price row. It is not
a failed run: a source that states a region for most of its prices and none for one has told us
something true about that one, and the rest of the run is worth keeping.

**Who has to supply a default is a property of the adapter, not a list of chain names.** Section 4.

### 3.3 One ingest call, and the reversal it makes

`LidlCatalogRunner` groups its products by scope today and makes roughly 54 ingest calls of about 132
products each. Its own comment records that widening the ingest was considered and refused, for the
reason that it changes a contract every caller uses to save 53 batched calls a week.

That reasoning was right for a plan whose job was LIDL. It is wrong for a plan whose job is the
contract, because the same widening is what removes scope handling from the runner entirely. **The
run makes one pass again**, and `replaceScopePrices` and `addPrices` group by resolved scope inside
the ingest, where the grouping belongs.

## 4. An adapter declares what it needs

### 4.1 One table, in contracts

```ts
export interface AdapterCapabilities {
  /** The source states a price, so a run of it has somewhere to write prices. */
  writesPrices: boolean;
  /** The source names the scope of each price, so it needs no default. */
  scopesItsOwn: boolean;
  /** The source publishes its own shop list, so a store discovery takes no radius. */
  listsItsOwnStores: boolean;
  /** The source has a product page, so an EAN backfill has something to read. */
  hasProductPages: boolean;
}

export const ADAPTER_CAPABILITIES: Record<AdapterKey, AdapterCapabilities>;
```

| Adapter         | writesPrices | scopesItsOwn | listsItsOwnStores | hasProductPages |
| --------------- | ------------ | ------------ | ----------------- | --------------- |
| `mercadona-api` | yes          | no           | no                | no              |
| `deza-web`      | no           | no           | no                | no              |
| `carrefour-web` | yes          | no           | no                | yes             |
| `lidl-api`      | yes          | yes          | yes               | yes             |
| `osm-places`    | no           | no           | no                | no              |
| `manual`        | no           | no           | no                | no              |

It lives in `libs/luna-shopper/contracts` beside `ADAPTER_KEYS`, because the gateway validates against
it, the harvester enforces it and the back office draws a form from it. A capability that is stated in
two files is the defect of section 1.2 written again.

### 4.2 The spawn reads it

The three arrays in `harvest-run.service.ts` are deleted. The rules become:

- **A default scope is required when `writesPrices && !scopesItsOwn`.** That is `mercadona-api` and
  `carrefour-web` today, which is what `PRICE_YIELDING_ADAPTERS` says now, and a new price yielding
  adapter is covered the day its row is added.
- **A default scope is accepted but not asked for when `scopesItsOwn`.** This is the change of
  behavior: `lidl-api` used to refuse one outright. It now accepts one as the fallback of 3.2, and
  the form does not offer it, because a LIDL price always names its region and a field that does
  nothing is a lie in a form. Refusing it is no longer necessary: a given scope can no longer be
  silently applied to all 59 regions, because a price carries its own key.
- **A store discovery takes no postal code and no radius when `listsItsOwnStores`.** Unchanged in
  effect, read from the table instead of a name.
- **A backfill is allowed when `hasProductPages`.** Unchanged in effect, and it stops naming
  `carrefour-web` in a string comparison.

### 4.3 The file states which adapter produced it

A file import is an adapter like any other, and the form in front of it has to ask the same question:
does this need a default price scope? So the document says what produced it.

```json
"hints": {
  "chain_id": "...",
  "adapter_key": "lidl-api",
  "price_scope_id": "...",
  "source_kind": "OFFICIAL_API"
}
```

`hints` is the right home. It is defined as what the upload screen reads and nothing depends on a
reader honouring it, and this is read by the upload screen. `adapter_key` is optional and one of
`ADAPTER_KEYS`, so a leaflet extractor that does not know the enum omits it.

**The hint is the claim and the document is the proof.** The form preselects from `adapter_key`, and
the spawn requires a default scope when the document actually contains a price that names no scope.
A file labelled `lidl-api` that carries an unscoped price is not refused for lying: it is asked for a
default, which is the honest answer to what it holds.

## 5. The document, version 2

### 5.1 Scopes at the top, prices per product

```json
{
  "schema_version": 2,
  "sha256": "...",
  "producer": { "name": "luna-harvester run 4b1e...", "version": "2", "produced_at": "..." },
  "hints": { "chain_id": "...", "adapter_key": "lidl-api", "source_kind": "OFFICIAL_API" },
  "scopes": [
    { "key": "58", "kind": "REGION", "name": "Sevilla" },
    { "key": "12", "kind": "REGION", "name": "Madrid" }
  ],
  "products": [
    {
      "external_id": "p11029954",
      "name": "Uva blanca",
      "ean": "20123456",
      "size": { "label": "500 g" },
      "prices": [
        { "scope": "58", "amount": 1.29, "currency": "EUR", "validity": { "from": "...", "until": "..." } },
        { "scope": "12", "amount": 1.39, "currency": "EUR", "validity": { "from": "...", "until": "..." } }
      ]
    }
  ]
}
```

- `scopes` is optional. A document with no scopes writes every price to the default the operator
  chose, which is every leaflet ever uploaded.
- `prices[].scope` is optional and refers to a `scopes[].key`. A `scope` naming no declared key is a
  validation failure at that path, because a price pointing at nothing is a number with no meaning.
- `prices` replaces the single `price` and `unit_price` pair. Each entry holds `amount`, `currency`,
  `unit_price`, `validity` and `observed_at`, so a region can price and date a product differently
  from its neighbour, which is the thing section 4 of `0089` says the model has to be able to store.
- `scopes[].key` is document local and never a uuid. The same rule `hints` already carries: an id
  does not survive a move to another cluster, and the key is matched against `PriceScope.externalKey`
  on the importing side, which is the source's own key and does survive.

### 5.2 Reading version 1

`HARVEST_DOCUMENT_SCHEMA_IDS` gains an entry, and the reader normalizes version 1 into the version 2
shape on the way in: no `scopes`, and a product's `price` plus `unit_price` become a one entry
`prices` array with no `scope`. **Nothing downstream of the reader knows there are two versions**, and
every file ever exported or extracted still imports.

Version 1 stays readable for good. A leaflet extractor writes it, the fixtures are written in it, and
a format that stops reading its own past is a format nobody trusts to export to.

### 5.3 The export writes version 2

`buildHarvestDocument` stops taking one `priceScopeId`. It takes the entries with their price rows
**filtered to this run** (`source_entry_prices.runId = run.id`, which is already indexed), and the
scope views for every scope those rows name. It emits one `scopes` entry per scope and one `prices`
entry per row.

That is the fix to 1.1, and it fixes it for runs that have already happened.

## 6. Nothing a runner needs is a read it makes

Six runners read something today. Each read is either replaced by a declaration in the report or moved
into the input the orchestrator prepares. None of them survives as a read.

### 6.1 Mercadona's negative availability becomes a declaration

Today the runner loads every `ACTIVE` row of the chain to work out which tracked products the walk did
not see, and calls those out of stock. That fact is already in the report: the orchestrator knows what
the run named. So the runner says `report.assortmentComplete(scopeKey)` and the orchestrator does the
diff against the rows it holds anyway.

The abort rule is kept and moves with it. An aborted run declares nothing, so it writes positives
only, because a walk that stopped early has not proved anything absent.

### 6.2 Carrefour's backfill list becomes input

`CarrefourDetailRunner` loads the rows that need an EAN. The orchestrator loads them and passes them:

```ts
export interface CatalogDiscoveryInput {
  // ...
  /** The rows a backfill run reads pages for. Prepared by the orchestrator. */
  backfill?: readonly { externalId: string; url: string }[];
}
```

The runner fetches a page per entry and reports products exactly as a walk does. Nothing about the
write side of a backfill is special any more, which is worth more than the line count it saves.

### 6.3 DEZA's shops become reported observations

The runner reports each shop it saw as a `place` carrying the source's own code and printed name, and
reports availability as `AvailabilityClaim` keyed by that code. The orchestrator resolves codes
through `SourceLocationService`, writes through `catalog.setLocationAvailability`, and collects the
conflicts into the run report. The mapped, unmapped and conflicting counts the run page shows are
unchanged, because they are computed from the same three sets in the same order.

### 6.4 Store discovery reports places, and creates no scope

Both store discovery runners stop holding `Repository<DiscoveredPlace>`. They report places, and the
LIDL one reports the region of each shop as a `ScopeDeclaration`, so the scopes it used to create are
created by the same resolver the catalog run uses.

`catalog.getSupermarket` and `catalog.resolveNearestPostalCode` move to the orchestrator too. The
chain view is passed in the input. The postal code is resolved by the orchestrator from the
coordinates the place carries, which is the only thing the runner knew about it anyway.

## 7. What changes

| File                                                           | Change                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `libs/luna-shopper/contracts/.../harvest.messages.ts`          | `AdapterCapabilities`, `ADAPTER_CAPABILITIES`              |
| `libs/luna-shopper/contracts/.../harvest-document-2.schema.ts` | new, version 2                                             |
| `libs/luna-shopper/contracts/.../harvest-document.ts`          | `scopes`, `prices[]`, `hints.adapter_key`                  |
| `libs/luna-shopper/contracts/.../harvest-document-registry.ts` | one more entry                                             |
| `harvester/.../run-report.ts`                                  | new, the sink and its four record types                    |
| `harvester/.../price-scope-resolver.ts`                        | new, resolve or create by external key, cached per run     |
| `harvester/.../source-ingest.ts`                               | a session, several prices per observation, group by scope  |
| `harvester/.../run-executor.service.ts`                        | builds the report, drains it, prepares runner input        |
| `harvester/.../harvest-run.service.ts`                         | three arrays deleted, capability rules, v2 spawn checks    |
| `harvester/.../harvest-export.ts`                              | v2, several scopes, prices by `runId`                      |
| `harvester/.../file-import.runner.ts`                          | reads `prices[]` and `scopes`                              |
| the six impure runners                                         | dependencies removed, writes become report calls           |
| `harvester/.../harvest.module.ts`                              | runners lose their providers                               |
| `gateway`                                                      | accepts v2, publishes the capability table, `openapi.json` |

No harvester migration. `source_entry_prices` is already keyed on `(entryId, priceScopeId)` and
already carries an indexed `runId`, which is every column this plan needs.

## 8. Order of work

Five steps, each of which leaves the workspace green.

1. **The capability table.** Contracts, the spawn rules, the back office form. Fixes 1.2 on its own
   and touches nothing else.
2. **The ingest session and several prices per observation.** `SourceIngest` widens, `ingest()` stays
   as the wrapper, LIDL drops its per scope grouping and its 54 calls become one.
3. **The scope resolver.** Scope creation moves out of the two LIDL runners into the orchestrator.
4. **The report sink.** The six runners lose their dependencies, one at a time, each with its spec.
5. **Document version 2.** Schema, reader, import, export. Fixes 1.1 and closes the round trip.

Steps 1 and 5 are separable from the rest. Ship them first if the export is the urgent half.

## 9. Testing

- A runner spec constructs the runner with a fake fetch and a recording `RunReport`, and asserts on
  what was reported. It has no `TestingModule`, no repository fake and no `CatalogClient` fake. The
  six specs that exist today get smaller, and that shrinkage is the visible proof of the rule.
- One spec per capability rule at the spawn, asserting the message names the field the form shows.
- A round trip spec: build a v2 document from a two scope run, import it into an empty database,
  assert the same rows and the same prices. That is the test 1.1 did not have.
- A v1 document imports unchanged, asserted against the committed fixtures.
- `lidl-catalog.integration.spec.ts` keeps its assertions and loses its scope creation setup.

## 10. Decisions

**D1. A report is write only and synchronous.** A runner cannot read back what its report produced.
An outcome a runner can read is an outcome a runner branches on, and every such branch is orchestrator
logic that ended up in a runner. The file import is the exception that proves it useful: it turns
outcomes into per product warnings, and it does that from the orchestrator's result, after the run.

**D2. `RunContext` stays and is not the sink.** Progress, stage, warnings and abort are the runner
describing itself, which is reporting. Products, places, scopes and availability are data about the
world, which is the sink. Two objects, because one object with both is one property away from being
a handle on the store again.

**D3. The scope key is the source's own, never a uuid.** It resolves against `PriceScope.externalKey`,
which is what makes a document portable between clusters and what makes a run idempotent across weeks.

**D4. A missing scope is created, and only from a declaration.** The resolver never invents a scope
from a price. A price naming a key nothing declared is a warning and no row, in the run and in the
file, because a scope with no kind and no name is a row an operator cannot act on.

**D5. This reverses `0089` section 8 on both counts.** A `priceScopeId` is no longer refused for a
self scoping adapter, and the ingest is widened to take several scopes in one call. Both refusals were
correct while the ingest could hold one scope: a given scope really would have been applied to all 59
regions. Once the price carries its key, the danger is gone and the workaround costs 53 calls and a
runner that has to know about catalog.

**D6. No new column on `harvest_runs`.** The scopes a run wrote are the distinct
`source_entry_prices.priceScopeId` of its `runId`. `priceScopeId` on the run stays, and stays meaning
one thing: the default the operator chose at the spawn.

**D7. Version 1 is normalized at the reader, not at every caller.** One function turns a v1 document
into the v2 shape, and nothing past it branches on the version.

## 11. What this plan does not do

- It does not change what any source fetches, what is parsed out of it, or any chain library. Those
  libraries already report plain records and are already framework free.
- It does not re-crawl anything. The fix to 1.1 is an export change, and the rows are already right.
- It does not add a chain, an adapter or a run mode.
- It does not touch the price policies of `0080`. Which price a shopper sees is decided on read, and
  a scope is still only where a price was observed.
