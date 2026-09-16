# 0118: one walk written to several scopes

> Admin half: `apps/luna-shopper-admin/plans/0029`.
>
> Plan 0108 measured 52 Mercadona warehouses falling into 10 price signatures. Walking all 255 is
> about 43,000 requests, and walking one per group prices only that group's first warehouse. This
> plan lets a run copy what it read at one scope onto other scopes, of any tier: warehouse 1 onto
> warehouses 2 to 19, warehouse 20 onto a chain region, a warehouse onto three single shops. Every
> copy records the scope it was read at.
>
> Prerequisite reading: `0103` (a runner reports and the orchestrator writes), `0108` (several
> warehouses in one walk), `0116` (the four tiers), `0117` (an expired price falls through),
> `harvest-run.service.ts` (`spawn`, `validate`, `walkableScopes`), `run-report.sink.ts`,
> `source-ingest.ts`, `item-price-writer.ts` and `item-price.service.ts`.

## Brief for the agent

### Objective

Add `scopeCopies` to a catalog discovery run: each walked scope names the scopes its prices and
availability are also written to, the copies carry `copiedFromScopeId` in the harvester and in
catalog, and a revert removes them, as sections 2 to 8 describe.

### Context

- `SpawnHarvestRunRequest` (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts:734`)
  carries `priceScopeId?` and `priceScopeIds?`. The gateway DTO is `SpawnHarvestRunDto`
  (`gateway/src/app/harvest/harvest.dto.ts:59`). The whole validated payload is stored in
  `harvest_runs.input` (jsonb).
- `validate` (`harvest-run.service.ts:411`) checks `priceScopeIds` through `walkableScopes`
  (:546): same chain, a non-null `externalKey`, priority inside the adapter's
  `walkablePriorities`.
- `run-executor.service.ts` resolves `input.priceScopeIds` to `{ id, externalKey }` in
  `walkedScopes` (:133), dropping a scope that is gone with a warning.
- `SourceIngest.writeChunk` (`source-ingest.ts:230`) resolves each price's scope with `scopeOf`,
  upserts `source_entry_prices` on `(entryId, priceScopeId)` (`replaceScopePrices`, :539), and for
  entries bound to an item calls `CatalogClient.addPrices(priceScopeId, entries, runId,
  sourceKind)` (`itemPrice.addBatch`) in batches of 200.
- `writeScopeAvailability` (`run-report.sink.ts:410`) runs per key passed to
  `assortmentComplete`, and calls `CatalogClient.setAvailability(scopeId, entries)`
  (`supermarketItem.setAvailability`), which carries no run id.
- `writeItemPrices` (`item-price-writer.ts:54`) confirms a row whose values match the current one
  by moving `lastObservedAt`, and otherwise inserts. `deleteByRun` (`item-price.service.ts:248`)
  deletes rows by `sourceRunId` and resets `lastObservedRunId`.
- `supermarket_items` materializes the chosen price with `priceSourceKind` and `itemPriceId`
  (`applyEffective`, `effective-price.service.ts:236`).

### Target state

Every acceptance criterion in section 11 holds, `openapi.json` and the wire types are regenerated,
and an integration run on a slot shows a Mercadona walk of one warehouse priced at three others.

### Scope

- Work only in: `libs/luna-shopper/contracts` (the spawn request, the batch request, the views and
  their schemas), the gateway harvest DTO and catalog price views, `harvester/src/app/harvest/`
  (spawn validation, executor, sink, ingest, revert), a harvester migration, `catalog/src/app/`
  (the price writer, the price service, the effective price materialization, the entities, a
  migration), their specs, and the generated files.
- Do NOT touch: the runners (a copy is the orchestrator's act, plan 0103), `FILE_IMPORT`, the
  effective price ranking (plan 0117), the admin libraries beyond the wire types.

### Constraints

- A runner learns nothing about copies. The copy happens where a resolved scope id becomes a
  write.
- Both migrations are additive: nullable columns, no backfill.
- Regenerate `openapi.json` and the wire types, never by hand.

### Action boundaries

- Proceed with in-scope edits, specs, migration files and generators.
- Stop and ask before running a migration anywhere but a throwaway slot, and before running a
  real Mercadona walk (use the recorded fixtures or a single warehouse at the configured rate).

### Progress evidence

Report after the contract and validation with specs, after the harvester write path, after the
catalog column and writer, and after the revert and the integration run.

## 1. What is being built

| Piece                                  | Where                                                  |
| -------------------------------------- | ------------------------------------------------------ |
| `scopeCopies` on a spawn               | contracts, gateway DTO, `harvest-run.service.ts`       |
| Copies resolved for a run              | `run-executor.service.ts`                              |
| Prices copied                          | `source-ingest.ts`, `catalog-client.service.ts`        |
| Availability copied                    | `run-report.sink.ts`                                   |
| `copiedFromScopeId`                    | `source_entry_prices`, `item_prices`, `supermarket_items` |
| The run report                         | `run-executor.service.ts`                              |
| Revert                                 | no code, one integration spec (section 8)              |

## 2. The request

```ts
interface ScopeCopy {
  /** A scope the run writes, by id. */
  from: string;
  /** The scopes that receive a copy of what the run wrote at `from`. */
  to: string[];
}

interface SpawnHarvestRunRequest {
  // ...everything it has today
  scopeCopies?: ScopeCopy[];
}
```

The owner's example is one run:

```ts
{
  mode: 'CATALOG_DISCOVERY',
  supermarketId: MERCADONA,
  priceScopeIds: [ANDALUCIA_MAIN, BARCELONA_MAIN],
  scopeCopies: [
    { from: ANDALUCIA_MAIN, to: [WAREHOUSE_2, WAREHOUSE_3 /* ... */, WAREHOUSE_19] },
    { from: BARCELONA_MAIN, to: [WAREHOUSE_21, WAREHOUSE_22 /* ... */] },
  ],
}
```

## 3. Validation

All of it lives in `validate`, so a spawn and a saved preset (plan 0120) refuse the same things.
Every refusal is a `ValidationException` naming the scope id and the rule.

- **Mode.** `scopeCopies` is accepted on `CATALOG_DISCOVERY` only, and not with
  `detailBackfill`, which writes no scope's walk.
- **`from` is a scope the run writes.**
  - For an adapter that takes a scope list (`takesScopeList`), `from` is one of `priceScopeIds`.
  - For an adapter that takes one scope, `from` is `priceScopeId`.
  - For an adapter that declares its own scopes with no walkable band (LIDL), `from` is any scope
    of the chain with an `externalKey`. The run cannot know in advance which regions a week's
    offers name, so a `from` the run never writes is a run warning (section 7), not a refusal.
- **Each `from` appears once.**
- **`to` is not empty, and every target appears once in the whole run.** A scope cannot receive
  two copies, so a target never holds two prices from one run with nothing to choose between them.
- **A target is not walked in the same run.** It is not in `priceScopeIds`, not `priceScopeId`,
  and not a `from`. The walked scope keeps its own prices and a copy never lands on top of a walk.
- **Same chain.** Every `from` and `to` belongs to `supermarketId`.
- **Any tier.** A target is any of `STORE`, `LOCAL_AREA`, `REGION` or `NATIONAL`, and needs no
  `externalKey`. The adapter's `walkablePriorities` band applies to walked scopes only, since a copy
  fetches nothing.

## 4. The executor

The executor reads `input.scopeCopies` and resolves it once, before the sink opens, into a map
from a walked scope id to its target ids.

- A target that no longer exists is dropped with a `COPY_TARGET_GONE` warning naming it, the same
  treatment `walkedScopes` gives a walked scope that is gone. The spawn already refused a missing
  scope, so this is the case of a scope deleted while the run was pending.
- The sink and the ingest receive `copiesOf(scopeId): readonly string[]`, answering an empty list
  for a scope with no copies.

## 5. Prices

Where `SourceIngest.writeChunk` has resolved a price to scope `S`:

1. It writes `S` exactly as today.
2. For each target `T` in `copiesOf(S)`, it writes the same values at `T`:
   - a `source_entry_prices` row `(entryId, T)` with `copiedFromScopeId = S`.
   - for an entry bound to an item, the same entry in an `addPrices` batch for `T`, sent with
     `copiedFromScopeId: S`.

**The batch request gains one optional field.** `AddItemPriceBatchRequest.copiedFromScopeId?:
string` applies to every entry in the batch, which is how the ingest already groups them: one
batch per scope. The catalog handler checks that it names a scope of the same chain, and refuses a
batch whose `copiedFromScopeId` equals its own `priceScopeId`.

### 5.1 The column

| Table                 | Column              | Type        | Notes                                   |
| --------------------- | ------------------- | ----------- | --------------------------------------- |
| `source_entry_prices` | `copiedFromScopeId` | `uuid` null | harvester migration                     |
| `item_prices`         | `copiedFromScopeId` | `uuid` null | catalog migration                       |
| `supermarket_items`   | `priceCopiedFromScopeId` | `uuid` null | catalog migration, materialized     |

**No foreign key on either price table.** The record of where a price was read has to outlive the
scope it names. A deleted warehouse cascades its own prices away, and its copies at a region stay
priced, so a foreign key either blocks the delete or nulls out exactly the fact the owner
called very important. A copy naming a scope that no longer exists shows the raw id.

`supermarket_items.priceCopiedFromScopeId` is written by `applyEffective` beside `priceSourceKind`,
from the chosen row, and takes part in its sameness check. Every view that already carries
`priceSourceKind` next to a price gains `priceCopiedFromScopeId`, and `ItemPriceView` gains
`copiedFromScopeId`.

### 5.2 A copy is its own statement

The writer's confirm path moves `lastObservedAt` when a new value equals the current row. **A row
whose `copiedFromScopeId` differs is not equal**, even when the price matches. Otherwise a price
copied from warehouse 1 last week and walked directly at the target this week reads as the copy,
and the provenance is wrong for as long as the price does not change. The comparison includes
`copiedFromScopeId`, with null equal only to null.

A copy is an ordinary row at its target for every other purpose: it carries the run's
`sourceRunId` and `sourceKind`, it ranks by the target's priority, and it ages by the kind's
`maxAgeDays` (plan 0117). A direct walk of the target in a later run is newer and wins as the
current row.

## 6. Availability

`writeScopeAvailability` runs for each key passed to `assortmentComplete`. For a key that resolves
to `S`, it writes the same entries to each target in `copiesOf(S)`, and an explicit availability
claim whose `scopeKey` resolves to `S` is copied the same way. Availability claims per shop
(`shopCode`) are not copied: they name a shop, not a scope.

**Plan 0119 decides whether a run writes availability at all.** A copy follows that setting, so a
run that writes prices only copies prices only.

Availability writes carry no run id today, so a revert does not undo them, for copies as for
walked scopes. This plan does not change that.

## 7. The run report

`harvest_runs.report` gains:

```ts
copies: {
  from: string;
  to: string[];
  /** Price rows sent to catalog for the targets of this `from`. */
  pricesCopied: number;
  /** Items whose availability was written at the targets. */
  availabilityCopied: number;
}[];
```

and the warnings list gains `COPY_TARGET_GONE` (section 4) and `COPY_SOURCE_NOT_WRITTEN`, recorded
at the end of a run for a `from` that received no price.

`pricesRecorded` and `pricesPublished` keep their meaning for walked scopes and do not include
copies, so the numbers a reader already compares between runs stay comparable.

## 8. Revert

Both halves already delete by run, and copies carry the run:

- `itemPrice.deleteByRun` deletes `item_prices` by `sourceRunId`, which a copy is written with.
- `deleteObservedPricesFrom` (`source-entry.service.ts:450`) deletes `source_entry_prices` by
  `runId` (indexed, `ix_source_entry_prices_run`). The ingest writes the run's id on a copied row
  exactly as on a walked one.

So revert needs no code, only the integration spec in section 10 that proves a copy goes with it.

## 9. Cost

A copy costs no request to the chain. It costs rows: a Mercadona walk records about 4,232 prices
per scope, so each target adds about that many `source_entry_prices` rows and, for bound items, as
many `item_prices` rows on the first run and a confirm afterwards. Ten warehouse targets add about
42,000 rows on a first run. A few hundred single shop targets is the size at which the owner will
want to measure, and the run report's `pricesCopied` is where that shows.

## 10. Tests

- **Validation** (`harvest-run.service.spec.ts`): every rule of section 3 has a refusing case, and
  the owner's two group example is accepted. A NATIONAL target and a STORE target are accepted.
- **Executor**: a target deleted after the spawn is dropped with `COPY_TARGET_GONE`.
- **Ingest** (`source-ingest` spec): a price at `S` with two targets writes three
  `source_entry_prices` rows, two with `copiedFromScopeId = S`, and three `addPrices` calls, two
  with `copiedFromScopeId`.
- **Sink**: `assortmentComplete(S)` writes availability at `S` and each target.
- **Catalog writer**: a same valued row with a different `copiedFromScopeId` inserts, and a same
  valued row with the same one confirms. A batch copying from its own scope is refused.
- **Materialization**: the chosen row's `copiedFromScopeId` reaches
  `supermarket_items.priceCopiedFromScopeId`.
- **Revert** (integration): a run with copies, reverted, leaves no price at any target.
- **Integration on a slot**: a recorded Mercadona walk of one warehouse with three targets prices
  a shop held only by one of the targets.

## 11. Acceptance criteria

- [ ] A spawn accepts `scopeCopies` and refuses every case in section 3 with a message naming the
      scope.
- [ ] A target receives the walked scope's prices and, when the run writes availability, its
      availability.
- [ ] Every copied row records `copiedFromScopeId` in the harvester and in catalog, and the chosen
      price's provenance is materialized.
- [ ] A copy and a direct walk with the same value are different rows.
- [ ] A revert removes the copies.
- [ ] The run report lists each copy with its counts.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## 12. Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-harvester
npx nx test luna-shopper-backend-catalog
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx affected -t lint test
```
