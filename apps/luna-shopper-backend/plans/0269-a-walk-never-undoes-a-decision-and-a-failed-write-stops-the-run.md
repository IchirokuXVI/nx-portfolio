# 0269: a walk never undoes a decision, and a failed write stops the run

> Found by the review of PR #973 (plan `0267`, Carrefour and El Jamón), and checked against
> `origin/dev` (`b23a13050`) on 2026-11-11. Both defects are live on `dev` for Mercadona
> today, because the Mercadona runner already hands each product to the sink during its
> detail pool. Plan `0267` makes the other runners do the same, so the window of both defects
> grows from the few seconds of an end of walk ingest to the whole walk: about 19 minutes for
> Mercadona, 30 for Carrefour and 66 for El Jamón.
>
> Both defects were proved on real Postgres in an ephemeral slot, in both directions. An entry
> that a person accepted during a walk went back to `UNRESOLVED` with no product. An entry that
> a person rejected during a walk came back `ACTIVE`, and the walk wrote prices for the product
> that the person had rejected.
>
> The owner decided on 2026-11-11:
>
> - **2b.** A chunk that fails does not kill the process. The run ends `FAILED`, and the walk
>   stops at the first failed chunk, so no page is fetched for nothing.
> - **3c.** Both fixes for the stale entries: (a) the decided columns of a chunk's rows are
>   read again before the chunk is written, one query a chunk, and (b) the walk stops writing
>   back cached entities with `save`. It writes only its own columns with `update`, and where
>   the walk itself decides (a bind by EAN) the write is guarded, so it changes nothing when a
>   person has decided since.
> - **This plan is one PR, and it merges before PR #973.** PR #973 then rebases onto it.
>
> Prerequisite reading: plan `0086` (one source product, the two column groups), plan `0103`
> sections 2.3 and D1 (the sink, and why its methods return nothing), plan `0155` (a shared
> EAN), plan `0185` (the EAN rung asked again), plan `0215` section 6 (the abort path of a
> stopped run), plan `0218` (the alert of a `FAILED` run), plan `0221` section 3.5 (rung 4
> asked again), plan `0267` (streaming runners) and plan `0268` (the paths written at the
> end, on its decisions branch PR #969),
> `apps/luna-shopper-backend/harvester/src/app/harvest/run-report.sink.ts`,
> `harvest/source-ingest.ts`, `harvest/run-executor.service.ts`,
> `harvest/source-entry.service.ts` and `entities/source-catalog-entry.entity.ts`.

## Brief for the agent

### Objective

Fix two defects in the write half of a harvest run, in one PR that merges before PR #973:

1. A chunk write that fails during a walk stops the walk and ends the run `FAILED`. It never
   becomes an unhandled rejection that exits the harvester process.
2. A walk never undoes a decision that a person made on a source entry while the walk ran,
   and never writes a price for a row that a person rejected before its chunk was written.

You write production code and specs. No migration.

### Context

- **Defect 1, the chain.** `RunReportSink` queues every write on one promise chain:
  `this.chain = this.chain.then(work)` (`run-report.sink.ts`, `queue`, near lines 717 to
  719, field near line 312). Only `drain()` (near line 509) awaits it, at near line 520. The
  class comment says "a failure in any of them surfaces at drain" (near lines 53 to 57). That
  holds only when the walk ends within the same tick. A chunk that rejects during a walk
  leaves a rejected promise with no handler until the next `queue` call or the drain, and the
  next product arrives after network I/O. Node 24 (the runtime image,
  `apps/luna-shopper-backend/harvester/src/Dockerfile`, near line 31) treats an unhandled
  rejection as fatal, and the harvester registers no `unhandledRejection` handler. The
  process exits, and every run in it dies, also runs of other chains.
- **What a failed chunk already does right.** `p.then(work)` on a rejected `p` skips `work`,
  so no later chunk is written today either. Only the missing handler is wrong, and the walk
  goes on fetching pages that no chunk will write.
- **How a run stops today.** The executor owns one `AbortController` a run
  (`run-executor.service.ts`, near line 353). Every runner, `runWorkerPool` and every client
  read `context.signal` (Mercadona: near lines 120, 140, 151 and 246 of
  `mercadona-catalog.runner.ts`). The refusal guard of plan `0215` stops a run with
  `controller.abort(new SourceBlockedError(stop))` (near lines 371 to 373), and the executor
  then ends the run `FAILED` because `guard.stop` is set (near lines 611 to 615 and 658 to
  661). A runner that throws after an abort is drained first and its error raised again
  (near lines 456 to 462 and 554 to 559).
- **Defect 2, the cache.** `SourceIngest.open` (`source-ingest.ts`, near line 498) reads every
  row of the chain once (`entries.find`, near lines 504 to 506) and the session holds them for
  the whole run. Three write sites then call `entries.save(row)` on a cached entity:
  `unbindSharedEans` (near line 1079), `see` (near line 1237) and `touch` (near line 1356).
  TypeORM's `save` writes every column that differs from what it thinks the database holds,
  and for a cached entity that is the value read at `open`. A decision made since is
  overwritten with the old one.
- **The decided columns.** The entity states the split as its contract
  (`source-catalog-entry.entity.ts`, near lines 20 to 27): the source's columns, which every
  run rewrites, and "a person's, or the EAN rung's": `itemId`, `candidateEntryId`, `status`,
  `matchedBy`, `confidence`, `decidedAt` (near lines 253 to 290). "A run only reads these."
  The writers outside a run are:
  - `SourceEntryService.accept` and `createItem`, through `bind` (`source-entry.service.ts`,
    near lines 495 and 1133 to 1139) and `bindFields` (`source-entry-write.ts`, near lines 47
    to 59): `ACTIVE`, `MANUAL`, confidence 1, `decidedAt` now.
  - `SourceEntryService.reject` (near lines 692 to 710): `REJECTED`, no item, no candidate,
    `MANUAL`, confidence 1, `decidedAt` now.
  - The batch decisions (`source-entry-batch.service.ts`, near line 286), through
    `bindFields`.
  - The product merge (`item-merge.service.ts`, near lines 111 to 113), which moves `itemId`
    from one product to another in one `UPDATE`. A cached row then writes the merged away
    product back.
- **Stale reads.** The same cache answers the questions the ladder asks: `undecided(row)`
  (near line 1883), `bindWaitingByEan` (near line 1921), `proposeAnyOrder` (near line 1958),
  the bind by a learned EAN in `touch` (near lines 1323 to 1345) and `activeItemOf`, which
  decides whether a row is owed a price. A row rejected after `open` still reads `ACTIVE`, so
  the chunk owes its product a price.
- **One more stale read, at the drain.** `pushProducts` keeps the item of each `ACTIVE`
  outcome in `activeItemByExternalId` (`run-report.sink.ts`, near lines 347 and 749 to 756),
  and the availability of the drain reads it (near lines 972 and 992). A row rejected after
  its chunk still states availability for the product it left.
- **The walk's own decisions.** The ladder writes decided columns in five places, and each is
  a decision of the walk, not of a person: the bind by a learned EAN (`touch`, near lines
  1338 to 1344), `bindWaitingByEan` (near lines 1934 to 1939), `proposeSharedEan` (near lines
  1797 to 1807, called from `touch` and from `unbindSharedEans`), `proposeReworded` and
  `pointAtRejection` (near lines 2017 to 2038, from `proposeAnyOrder`). A new row is written
  by `create` (near line 1482). A new row has no decision of a person yet, so `create` keeps
  its `save`.
- **Plan `0267` asked for this.** Its action boundaries say "Stop and ask before you change
  the sink, the ingest, the revert or the reaper". This plan is the answer for the sink and
  the ingest: the owner decided both changes, here, in their own PR. PR #973 changes no line
  of `run-report.sink.ts` or `source-ingest.ts`. The revert and the reaper are not touched.
- **Plan `0268`** writes the new `categoryPaths` column of each entry in `drain()`, after
  the last chunk (its section 2). That write is a source column, and it follows the rule of
  this plan: an `update` of its own column, never a `save` of a cached entity.

### Target state

1. **A failed chunk is handled.** The sink catches the first failure of its chain, keeps it,
   runs no later queued work, and tells the executor once. The executor aborts the run with a
   reason that names the write failure. Every runner stops through the signal it already
   reads. `drain()` rejects with the first failure and writes nothing more. The run ends
   `FAILED` with a sentence that names the failed write. The process lives.
2. **A chunk reads the decisions again.** `writeChunk` reads the six decided columns of the
   chunk's rows, one query a chunk, before the ladder runs, and puts the values onto the
   cached entities. Every question the ladder asks of those rows reads the database of that
   moment.
3. **A walk writes only its own columns.** `see`, `touch` and `unbindSharedEans` write with
   `update`, and name only the columns the walk owns. A plain write never names a decided
   column.
4. **A decision of the walk is guarded.** Each write of a decided column by the walk carries
   a `WHERE` on the state the walk decided from. When a person decided since, the statement
   changes no row, the walk reads the row again, and the outcome follows what the database
   holds.
5. **The drain reads the decisions again** before it states availability, one query, so a
   row rejected after its chunk states nothing for the product it left.
6. **A permanent integration spec on real Postgres** proves the four cases of the Tests
   section.

### Scope

- `run-report.sink.ts` and `run-report.sink.spec.ts`.
- `run-executor.service.ts` and one new executor spec in the shape of
  `run-executor.guard.spec.ts`.
- `source-ingest.ts` and its specs.
- One new integration spec, `harvest/walk-keeps-decisions.integration.spec.ts`.
- No runner changes. Mercadona stops through `context.signal`, which it reads already.
- Out of scope: the revert, the reaper, the price writer of catalog, the sibling index and the
  EAN index (section 4), every runner of plan `0267`, and plan `0268`.

### Constraints

- **Nothing overwrites, for entries too.** The harvester rule says that the price of each
  source is stored side by side and nothing overwrites (plan `0080`, `CLAUDE.md`). For a
  source entry the same rule reads: a run rewrites the source's columns, and never a column
  that a person decided. This plan makes the code obey the sentence that the entity and
  `SourceIngest` already state (`source-ingest.ts`, near lines 459 to 463).
- No migration, no new column, no new status, no new table.
- No row that a person or a harvest wrote is deleted or rewritten. The rows of the chunks
  written before a failed chunk stay. A run that ends `FAILED` this way can be reverted as
  any finished run, by a person.
- Never write a price to `supermarket_items`. The price write itself does not change.
- `RunReport` keeps its shape. Its methods stay synchronous and return nothing (plan `0103`,
  D1). A runner learns of the failure through `context.signal` and nothing else.
- `create` keeps `save` for a new row. A new row has no decision of a person.
- A guarded `UPDATE` answers its row count. With `query()` an `UPDATE` answers
  `[rows, rowCount]`, and with the query builder `execute()` answers `affected`. Read the one
  that the call you use returns, and prove it on real Postgres.
- PR #973 rebases onto this PR. Do not touch the Carrefour or the El Jamón runner here.

### Action boundaries

- Stop and ask before you change `RunReport`, a runner, the revert, the reaper or the price
  writer.
- Stop and ask before you refresh the sibling index or the EAN index (section 4).
- Stop and ask if a guarded write needs a column that is not one of the six decided columns
  of the entity.
- Stop and report if the integration spec cannot reproduce one of the two defects on
  `origin/dev` before your change. The spec must fail on `dev` and pass on your branch.

### Progress evidence

The spec output of `nx test`, the output of the new integration spec on an ephemeral slot,
run once on `origin/dev` (it fails, and the failures are quoted) and once on the branch (it
passes), and `npx nx build luna-shopper-backend-harvester`.

## 1. A failed chunk stops the run

**The contract.** The sink receives one more dependency, a callback `onWriteFailed(error)`.
The executor passes
`(error) => controller.abort(new ReportWriteFailedError(error))`. `ReportWriteFailedError` is
a new error in `run-report.sink.ts` that carries the first failure as its `cause`.

In the sink:

- `queue` appends `work` so that it runs only while no failure is kept, and ends the chain
  with a handler that keeps the first failure, logs it once and calls `onWriteFailed` once.
  The chain never holds an unhandled rejection.
- A product, a place or a declaration reported after the failure is dropped. The runner is
  stopping anyway, and nothing it says can be written.
- `drain()` awaits the chain, then rejects with the first failure. It does not call
  `session.close()`, writes no whole listing and no availability. This is the drain of today
  after a failed chunk, without the dead process.
- A getter `failure` answers the first failure or null, for the executor and the specs.

In the executor:

- A run whose signal reason is a `ReportWriteFailedError` ends `FAILED`, in both the abort
  path and the catch branch (near lines 611 to 615 and 658 to 661), as a run that the guard
  stopped ends `FAILED`. Without this, the abort would end the run `ABORTED`.
- The error sentence names the write: the chunk failed, the walk stopped, and the rows of the
  chunks before it stay. The builder writes the words in the voice of the existing sentences.
- The alert of plan `0218` follows from the status, as for any `FAILED` run.

**Why the signal, and not a getter that each runner reads.** A getter is a second stop signal
that every runner must read in every loop, and a runner that forgets it fetches the whole walk
for nothing. Every runner, pool and client reads `context.signal` already, and an abort also
cancels the request in flight. The refusal guard of plan `0215` stops a run the same way.

**Why not a call that throws.** `report.product` returns nothing by design (plan `0103`, D1),
so a runner cannot await it. A throw from it inside a worker pool handler lands in the pool's
`onError`, which counts a failed product and goes on with the walk.

**Mercadona, Carrefour and El Jamón.** Mercadona on `dev` honours the stop through
`context.signal` with no change. PR #973 makes Carrefour and El Jamón stream, and both break
out of the walk on an abort (plan `0267`, Context). After this PR merges, PR #973 rebases and
adds one spec a runner: a sink that fails its first chunk stops the walk before the next page.
The wave 2 builders of plan `0267` (DIA, LIDL, DEZA) do the same.

## 2. A chunk reads the decisions again

At the start of `writeChunk` (`source-ingest.ts`, near line 532), before the EAN count and
before the ladder:

1. Read `id`, `externalId` and the six decided columns of the rows of this chain whose
   `externalId` the chunk names. One query, with `"supermarketId" = $1 AND "externalId" =
   ANY($2)`, served by `uq_source_catalog_entry`.
2. Write the values onto the cached entities of `byExternalId`.
3. A cached row that the read no longer finds was deleted since `open`. Drop it from
   `byExternalId`. The ladder then treats the product as it treats any product the chain does
   not hold: a full observation creates a row, a partial one is skipped with
   `DETAIL_SKIPPED_UNKNOWN`.
4. When a value changed, refresh the sibling index for that row as `applySizeDoubt` does
   (`siblings.refresh()`), so rung 4 of this chunk reads the new decision of a row in the
   chunk.

A chunk is at most `PRODUCT_CHUNK` (400) rows, so the query reads at most 400 rows.

## 3. A walk writes only its own columns

**The plain writes.** `see`, `touch` and `unbindSharedEans` stop calling `entries.save(row)`.
Each one writes with `update` by the row's `id`, and names only the columns the walk owns:

- `see`: `soldByWeight`, `approxWeight`, `unitSize`, `sizeUnit`, `imageUrl`, `timesSeen`,
  `lastSeenAt`, `lastRunId`, and the three size doubt columns that `applySizeDoubt` wrote
  before it.
- `touch`: the source group that `applySourceGroup` writes (`source-snapshot.ts`, near line
  128) when `writesSourceGroup` answers yes, and `timesSeen`, `lastSeenAt`, `lastRunId` and
  the size doubt columns always.
- `unbindSharedEans`: no plain write. Its only write is a decision (below).

The builder lists the exact columns from the code, not from this list, and a spec asserts
that no plain write names a decided column. `timesSeen` is written as `"timesSeen" + 1` in the
statement, not as the cached count.

**The guarded writes.** Each decision of the walk is its own `UPDATE` of the six decided
columns, with a `WHERE` on the state the walk decided from:

| Decision | Function | Guard |
| --- | --- | --- |
| Bind by a learned EAN | `touch` | `"decidedAt" IS NULL AND status IN ('UNRESOLVED', 'CANDIDATE')` |
| Bind a waiting row by its EAN | `bindWaitingByEan` | the same |
| Propose a shared EAN on a waiting row | `touch` | the same |
| Send an EAN bound row back to the queue | `unbindSharedEans` | `status = 'ACTIVE' AND "matchedBy" = 'EAN' AND "itemId" = <the item the walk read>` |
| Propose by the words in any order, or point at a rejection | `proposeAnyOrder` | `"decidedAt" IS NULL AND status = 'UNRESOLVED' AND "itemId" IS NULL AND "candidateEntryId" IS NULL` |

When the statement changes no row, a person decided since the refresh of section 2. The walk
then reads the six columns of that row again, writes them onto the cached entity, and the
outcome is built from them: a `REJECTED` row owes no price, and a row that a person accepted
owes the price of the product the person chose.

The functions that mutate the row today (`bindWaitingByEan`, `proposeSharedEan`,
`proposeAnyOrder`) can keep their shape. The builder decides whether they answer the fields
to write or keep mutating a row that the caller then writes. The rule is only that the write
is guarded.

**Why both fixes.** Fix (a) alone leaves the window inside a chunk: a decision that lands
after the refresh and before the save is still overwritten. Fix (b) alone keeps the stale
reads: a row rejected an hour ago still reads `ACTIVE` in the cache and is owed a price.
Together, the decided columns are never written back, and every chunk decides from the
database of that moment.

## 4. What this plan leaves as it is

- **One chunk of a stale price is possible.** A reject that lands after the refresh of a
  chunk and before that chunk's price write can still see one price written for the rejected
  product. The window is the length of one chunk, seconds, not the walk. The price write goes
  to catalog over NATS, and this plan adds no guard there.
- **The sibling index and the EAN index stay as loaded.** Rung 4 for a new row reads the
  decided state of rows in other chunks from the cache. The worst result is a `CANDIDATE`
  proposal that names a stale sibling. A proposal writes no price and waits for a person.
  The owner's decision 3c names the chunk's rows only.
- **The revert** of a run stays as it is. A run that ends `FAILED` this way kept the rows of
  its earlier chunks, and a person can revert it.

## 5. The drain reads the decisions again

Before the availability of the drain (`run-report.sink.ts`, near line 972), the sink reads
the decided columns of the rows in `entryIdByExternalId`, in one query or in chunks of
`PRODUCT_CHUNK` ids, and removes from `activeItemByExternalId` each row that is no longer
`ACTIVE` with that item. A row that a person moved to another product states availability for
the new product. The read goes through a small method of `SourceIngestSession`, because the
sink holds no repository of entries for this.

## Tests

**The integration spec** (`harvest/walk-keeps-decisions.integration.spec.ts`), real Postgres,
in the shape of `shared-source-row.integration.spec.ts`: a real `SourceIngest` and a real
`RunReportSink`, a recorder for catalog, a chain that nothing else in the database uses, and
two chunks. Between the chunks the spec calls the real `SourceEntryService.accept` or
`reject`, or an `UPDATE` with its fields, on a row that the session cached. At least:

1. **Accept during a walk survives.** A row `UNRESOLVED` at `open`, accepted between the
   chunks, then observed in the second chunk: it stays `ACTIVE`, `MANUAL`, with the accepted
   product, and its prices go to that product.
2. **Reject during a walk survives, and no price follows.** A row `ACTIVE` by EAN at `open`,
   rejected between the chunks, then observed in the second chunk: it stays `REJECTED`, and
   the recorder holds no price for it from the second chunk. The drain states no availability
   for its old product.
3. **A bind by EAN does not override a rejection.** A waiting row whose EAN a product holds,
   rejected after `open` and before its chunk: it stays `REJECTED`. A second case where the
   reject lands after the refresh of section 2 (a hook in the spec between the refresh and
   the write) proves the guard of section 3 changed no row.
4. **A failed chunk ends the run and not the process.** A catalog recorder that rejects the
   first chunk: `onWriteFailed` is called once, no `unhandledRejection` event is emitted
   during the test (the spec listens with `process.on`), the second chunk writes no row, and
   `drain()` rejects with the first failure.

Each case fails on `origin/dev` and passes on the branch.

**Unit specs.**

- `run-report.sink.spec.ts`: a failed chunk keeps the first failure, calls the callback once,
  skips later work, and `drain()` rejects with it and calls no `close()`.
- A new executor spec in the shape of `run-executor.guard.spec.ts`: a sink whose callback
  fires stops a fake runner through `context.signal` before its next page, and the run ends
  `FAILED` with the write sentence. A person's abort still ends `ABORTED`.
- `source-ingest` specs: no plain write names a decided column, and a guarded write that
  changes no row leads to an outcome built from the row read again.

## Acceptance criteria

- [ ] A chunk that fails during a walk ends the run `FAILED`, stops the walk, and leaves the
      process alive.
- [ ] An entry accepted or rejected during a walk keeps the person's decision.
- [ ] A rejected entry gets no price after the chunk that read its rejection.
- [ ] No write of a walk names a decided column, except a guarded decision of the walk.
- [ ] No migration, and no row deleted or rewritten.
- [ ] The integration spec fails on `origin/dev` and passes on the branch.

## Verification

```sh
npx nx test luna-shopper-backend-harvester -t "RunReportSink"
npx nx test luna-shopper-backend-harvester -t "SourceIngest"
npx nx test luna-shopper-backend-harvester -t "RunExecutor"
npx nx build luna-shopper-backend-harvester

bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services harvester
# HARVESTER_DB_URL is in $TMPDIR/luna-slot-ephemeral/slot<n>/env/apps/luna-shopper-backend/harvester/.env
LUNA_INTEGRATION=1 HARVESTER_DB_URL=<url> \
  npx nx run luna-shopper-backend-harvester:test-integration \
    --testFile=walk-keeps-decisions.integration.spec.ts
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --down <n>

npx nx affected -t lint test
```

`--testFile` under `nx test` finds no integration spec and exits 0. Run it under
`test-integration`, with `LUNA_INTEGRATION=1`.

## Build order

1. This plan, one PR into `dev`.
2. PR #973 (plan `0267`, Carrefour and El Jamón) rebases onto it and adds the stop spec of
   section 1 for its two runners.
3. The wave 2 builders of plan `0267` (DIA, LIDL, DEZA) and the builder of plan `0268` work in
   the same files after it. Plan `0268` writes its column with `update`, as section 3 says.

## Decisions

**D1 (owner, answered 2026-11-11, 2b):** the process survives, the run ends `FAILED`, and the
walk stops at the first failed chunk.

**D2 (owner, answered 2026-11-11, 3c):** both fixes: the decided columns are read again before
each chunk, and the walk writes only its own columns, with a guard on its own decisions.

**D3 (owner, answered 2026-11-11):** one PR, which merges before PR #973.

The choices below are the planner's and wait for the owner. The PR body lists them.

**D4. A write failure counts as a failure of the chain. Open.** `recordVerdict` counts every
`FAILED` run, and three in a row stop the schedules of a chain (plan `0206`). A database
failure is not the chain's fault. Recommended: count it as today, because a failure of the
drain at the end of a walk counts today, and a change of that rule is its own decision.

**D5. The drain reads the decisions again (section 5). Open.** It goes beyond the literal 3c,
which names the chunks. Recommended: yes, because without it a row rejected during the walk
still states availability for the product it left.

**D6. The window of one chunk stays (section 4). Open.** Recommended: accept it. A guard on
the catalog price write is another service and another plan.

**D7. The proof of the run status is a unit spec of the executor**, and the integration spec
proves the sink and the ingest on real Postgres. Recommended, because the executor needs a
store, a guard, a scheduler and a runner, and the guard spec already builds them with fakes.
