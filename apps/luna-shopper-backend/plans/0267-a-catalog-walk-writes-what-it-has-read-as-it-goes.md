# 0267: a catalog walk writes what it has read as it goes

> Found during the all chain scheduled harvest of 2026-11-06 on Luna slot 4, and checked
> against `origin/dev` on 2026-11-11. A power cut stopped a scheduled Carrefour walk (run
> `6fd4b58c-0dff-4193-b244-0a97dff3c708`). It had read 10,279 of 18,280 listings and written 0
> rows, because the Carrefour runner reports its products only after the whole crawl. The
> reaper, the stale mail and the one scheduled retry worked, and the retry walked the chain
> again from the start. Plan `0255` makes the stale mail say that the run left no rows. This
> plan makes it leave the rows it read.
>
> Prerequisite reading: plan `0038` section 6.6 (abort, the reaper, no other recovery), backlog
> `0001` section 7.4 (abort, "No recovery is attempted and none is designed"), plan `0080`
> (prices side by side), plan `0206` section 7 (the retry), plan `0220` (whole listings), plan
> `0251` (what a completed run did not read), plan `0255` (the stale mail),
> `apps/luna-shopper-backend/harvester/src/app/harvest/run-report.sink.ts`,
> `harvest/carrefour-catalog.runner.ts` and `catalog/src/app/catalog/item-price-writer.ts`.

## Brief for the agent

### Objective

Make the Carrefour catalog runner report each category's new products to the sink as soon as
that category is paged, so the sink writes them in chunks during the walk. A run that dies then
keeps what it wrote. Everything that needs the whole crawl stays at the end.

### Context

- **This is not a resume.** Plan `0038` section 6.6 and backlog `0001` section 7.4 refuse any
  recovery or checkpoint machinery, and this plan adds none. A retry walks the chain from the
  start, as today. Backlog `0001` section 7.4 also says a rollout "costs at most the current
  batch", which assumes that batches are written during a run. Carrefour does not meet that
  today.
- **The sink already streams.** `RunReportSink.product()` (`run-report.sink.ts`, near lines
  426 to 434) queues a write as soon as `PRODUCT_CHUNK`, 400 (near line 61), observations
  wait. Each chunk goes through `pushProducts` (near line 721) into `SourceIngestSession.push`
  (`source-ingest.ts`, near line 2159). `drain()` (near line 509) writes the rest, then does
  the work that needs the whole run: `session.close()` (price conflicts, size doubts, images,
  pack counts), the whole listings, and the negative half of availability.
- **Carrefour reports at the end.** Every listing waits in the map `products`
  (`carrefour-catalog.runner.ts`, near line 93), filled in `pageCategory` (near lines 241 to
  250) and `pageFrom` (near line 386). `reportProducts` (near line 413) runs only at the
  `INGEST` stage (near lines 160 to 162).
- The other runners, for D1: Mercadona reports during its detail pool
  (`mercadona-catalog.runner.ts`, near lines 221 and 279) and writes as it goes. DIA
  (`dia-catalog.runner.ts`, near lines 115 to 130), El Jamón (`eljamon-catalog.runner.ts`,
  near lines 198 to 245), LIDL (`lidl-catalog.runner.ts`, near lines 126 and 182) and DEZA
  (`deza-catalog.runner.ts`, near lines 142 to 146 and 177) report at the end. The
  `processed` counter of plan `0253` moves during a walk. It writes no row.
- **A graceful stop already writes.** An abort and the executor's shutdown hook
  (`run-executor.service.ts`, `onApplicationShutdown` near line 903) break out of the crawl,
  and the runner still reports what it read. Only a hard death loses the map.
- **Inference, not measured:** a deploy can also lose a long ingest. The pod grace period is
  30 s (`k8s/helm/velista/values.yaml`, near line 172). An ingest of 16,000 products that
  starts after `SIGTERM` can need longer.
- The reaper runs every 60 s (`harvest-run.service.ts`, near line 276) and marks a run `STALE`
  after `HARVEST_STALE_AFTER`, 900 s (`app-config.ts`, near line 100). The one scheduled retry
  is `findInterrupted` and `claimRetry` (`harvest-schedule.store.ts`, near lines 220 to 240)
  and `retryInterrupted` (`harvest-schedule.worker.ts`, near line 299).
- A retry reads the same values again. `sameValues` (`item-price-writer.ts`, near line 285)
  then confirms the held row (`lastObservedAt`, `lastObservedRunId`, near lines 155 to 163)
  and inserts nothing.

### Target state

1. `pageCategory` and `pageFrom` report each product the first time the run sees it, through a
   `seen` set, when the category or page is read. The map `products` stays for the whole
   listing and for `describeRun`.
2. A Carrefour walk that dies after 10,000 listings leaves a row for each distinct product
   it had read, less at most the last chunk of 400 that was not full.
3. Every other result of a walk that completes is the same as today.

### Scope

`carrefour-catalog.runner.ts` and its spec. The sink and the ingest change only if the builder
proves that a chunk is not committed before `close()`. The other four runners only if D1 says
so.

### Constraints

- Every `item_prices` row carries its run id and sits beside the others. Nothing overwrites.
  Never write a price to `supermarket_items` directly (`CLAUDE.md`, plan `0080`).
- `declareListing` and `listingWhole` are decided only at the end, from the full id set. A run
  that dies declares nothing whole and writes no negative availability.
- The run report (`describeRun`) and the `LISTING_UNREAD` warnings of plan `0251`
  (`warnUnread`) are written at the end, as today.
- The first sighting of a product keeps its category path, as today (`pageCategory` comment).
- `observedAt` stays one value per run if the price writer needs it, else it is the time of
  the category. The builder reads the writer and says which in the PR.
- No checkpoint, no resume, no new table, no new status.
- For D1 (b): El Jamón's rule stays. A row whose page was never read must not clear a stored
  photo or category (`eljamon-catalog.runner.ts`, near lines 208 to 224). DEZA still writes no
  price.

### Action boundaries

- Stop and ask before you change any runner but Carrefour, until D1 is answered.
- Stop and ask before you change the sink, the ingest, the revert or the reaper.

### Progress evidence

The spec output, and one walk on an ephemeral slot whose harvester process is killed with
`kill -9` after about half the categories: the run row `STALE`, and the count of
`source_catalog_entries` and `item_prices` rows that carry its run id, quoted in the PR. Then
the retry, and the count of rows it confirmed and of rows it inserted.

## 1. Proof the chunks commit

Before you change the runner, read `SourceIngest.writeChunk` (`source-ingest.ts`, near line
532) and the catalog write it calls, and state in the PR whether a chunk is committed when
`push` returns. If it is not, stop and report, because the whole plan rests on it.

## Tests

- Carrefour runner spec: a fake client with three categories, a product listed in two of them,
  and an assertion that `report.product` is called once per product, after its first category,
  before the `INGEST` stage.
- The same spec with an error thrown in the third category: the products of the first two are
  reported, and `listingWhole` is not called.
- A sink spec: a second run that reports the same values confirms the rows and inserts none
  (`sameValues`).

## Acceptance criteria

- [ ] A Carrefour walk killed half way leaves the rows it read.
- [ ] A walk that completes gives the same counters, report and listing as before.
- [ ] A dead run writes no negative availability and declares no listing whole.
- [ ] A retry confirms the rows of the dead run and inserts no duplicate.

## Verification

```sh
npx nx test luna-shopper-backend-harvester -t "carrefour"
npx nx test luna-shopper-backend-harvester -t "RunReportSink"
npx nx affected -t lint test
```

Then the walk of Progress evidence, against a local server of the committed fixtures or a
closed copy, never the live storefront at full rate.

## Decisions

**D1. Which runners.**

- (a) Carrefour only, in this plan.
- (b) Carrefour, DIA, El Jamón, LIDL and DEZA.

Recommended: (a). Carrefour is the walk that lost its rows. Each other runner has its own end
rules (El Jamón's photo rule, DEZA's sections, DIA's scopes), so each is a review of its own.
On 2026-11-06 the walks took 4 min (DIA), 14 min (DEZA), 30 min (Carrefour) and 66 min (El
Jamón), so El Jamón is the next candidate.

**D2. A stale run with rows.** The revert is offered on `STALE` runs already (`FINISHED_STATUSES`,
`harvest-run.service.ts` near line 228), and it hard deletes the rows a run wrote. Recommended:
treat a stale run like any run with rows, with one note for the owner. A retry that confirmed a
row of the dead run does not own that row, so a revert of the dead run also deletes a price the
retry read again. The plan `0255` line "Rows it left" needs no other word.

**D3. Do nothing.** Rely on the honest mail of plan `0255` and the one retry. The cost is one
whole Carrefour walk again after each hard death (about 18,000 listings and 30 minutes on
2026-11-06), and no rows from the dead run.
