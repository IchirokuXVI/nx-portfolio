> **PR:** [#973](https://github.com/IchirokuXVI/nx-portfolio/pull/973)

# 0267: a catalog walk writes what it has read as it goes

> Found during the all chain scheduled harvest of 2026-11-06 on Luna slot 4, and checked
> against `origin/dev` on 2026-11-11. A power cut stopped a scheduled Carrefour walk (run
> `6fd4b58c-0dff-4193-b244-0a97dff3c708`). It had read 10,279 of 18,280 listings and written 0
> rows, because the Carrefour runner reports its products only after the whole crawl. The
> reaper, the stale mail and the one scheduled retry worked, and the retry walked the chain
> again from the start. Plan `0255` makes the stale mail say that the run left no rows. This
> plan makes it leave the rows it read.
>
> The owner answered the decisions of this plan on 2026-11-11. The plan is built, and for every
> chain whose runner reports at the end: Carrefour, El Jamón, DIA, LIDL and DEZA. In the owner's
> words: a walk does not usually write 10,000 products at once, except the very first walk.
> To write every X products for every chain means that nothing is written all at once at the
> end, and that also removes the problem of a pod that restarts. X is `PRODUCT_CHUNK`.
>
> Prerequisite reading: plan `0038` section 6.6 (abort, the reaper, no other recovery), backlog
> `0001` section 7.4 (abort, "No recovery is attempted and none is designed"), plan `0080`
> (prices side by side), plan `0206` section 7 (the retry), plan `0220` (whole listings), plan
> `0251` (what a completed run did not read), plan `0253` (the El Jamón detail stage), plan
> `0255` (the stale mail), plans `0257` and `0258` (the DEZA split queries),
> `apps/luna-shopper-backend/harvester/src/app/harvest/run-report.sink.ts`, the five runners
> `harvest/carrefour-catalog.runner.ts`, `harvest/eljamon-catalog.runner.ts`,
> `harvest/dia-catalog.runner.ts`, `harvest/lidl-catalog.runner.ts` and
> `harvest/deza-catalog.runner.ts`, and `catalog/src/app/catalog/item-price-writer.ts`.

## Brief for the agent

### Objective

Make every catalog runner that reports at the end hand each product to the sink as soon as it
has read it, so the sink writes the products in chunks of `PRODUCT_CHUNK` during the walk. No
runner holds a whole walk in memory until the end to report it. A run that dies then keeps what
it wrote. Everything that needs the whole walk stays at the end. The runners are built in this
order: Carrefour and El Jamón, then DIA, LIDL and DEZA.

### Context

- **This is not a resume.** Plan `0038` section 6.6 and backlog `0001` section 7.4 refuse any
  recovery or checkpoint machinery, and this plan adds none. A retry walks the chain from the
  start, as today. Backlog `0001` section 7.4 also says a rollout "costs at most the current
  batch", which assumes that batches are written during a run. Five runners do not meet that
  today.
- **The sink already streams.** `RunReportSink.product()` (`run-report.sink.ts`, near lines
  426 to 434) queues a write as soon as `PRODUCT_CHUNK`, 400 (near line 61), observations
  wait. Each chunk goes through `pushProducts` (near line 721) into `SourceIngestSession.push`
  (`source-ingest.ts`, near line 2159). `drain()` (near line 509) writes the rest, then does
  the work that needs the whole run: `session.close()` (price conflicts, size doubts, images,
  pack counts), the whole listings, and the negative half of availability.
  `availability()` (near line 445) only collects claims. It writes nothing before `drain()`.
- **Who reports at the end, on `origin/dev`.** Mercadona reports during its detail pool
  (`mercadona-catalog.runner.ts`, near lines 221 and 279) and writes as it goes. It is not in
  this plan. The other five report at the end. Each section below names where.
- **The order is by walk length.** On 2026-11-06 the walks took 4 min (DIA), 14 min (DEZA),
  30 min (Carrefour) and 66 min (El Jamón). The two longest walks lose the most and come first.
- **A graceful stop already writes.** An abort and the executor's shutdown hook
  (`run-executor.service.ts`, `onApplicationShutdown` near line 903) break out of the walk,
  and the runner still reports what it read. Only a hard death loses the map.
- **A deploy can also lose a long ingest. This is an inference, not measured.** The pod grace
  period is 30 s (`k8s/helm/velista/values.yaml`, near line 172). An ingest of 16,000 products
  that starts after `SIGTERM` can need longer. With streaming, the end of a walk writes at most
  one chunk and `close()`.
- The reaper runs every 60 s (`harvest-run.service.ts`, near line 276) and marks a run `STALE`
  after `HARVEST_STALE_AFTER`, 900 s (`app-config.ts`, near line 100). The one scheduled retry
  is `findInterrupted` and `claimRetry` (`harvest-schedule.store.ts`, near lines 220 to 240)
  and `retryInterrupted` (`harvest-schedule.worker.ts`, near line 299).
- A retry reads the same values again. `sameValues` (`item-price-writer.ts`, near line 285)
  then confirms the held row (`lastObservedAt`, `lastObservedRunId`, near lines 155 to 163)
  and inserts nothing.
- The `processed` counter of plan `0253` moves during a walk. It writes no row.

### Target state

1. Each of the five runners calls `report.product` for a product at the first point where its
   observation is the one the runner reports today. Sections 2 to 6 name that point for each
   runner. The sink then writes a chunk each time `PRODUCT_CHUNK` products wait.
2. No runner keeps a product only to report it at the end. A runner can still keep the ids or
   the rows that its end of walk work needs (a whole listing, a report, availability).
3. A walk that dies leaves a row for each product that the runner had reported, less at most
   the last chunk that was not full.
4. Every result of a walk that completes is the same as today: the counters, the report, the
   whole listings, the availability and the warnings.

### Scope

The five runners and their specs. The sink and the ingest change only if the builder proves
that a chunk is not committed before `close()` (section 1), or that a second observation of one
product in one run is not safe (section 4). Mercadona is out of scope.

### Constraints

- Every `item_prices` row carries its run id and sits beside the others. Nothing overwrites.
  Never write a price to `supermarket_items` directly (`CLAUDE.md`, plan `0080`).
- A whole listing (`declareListing`, `declareListings`, `listingWhole`) is decided only at the
  end, from the full id set. A run that dies declares nothing whole and writes no negative
  availability.
- Each run report (`describeRun`, `toReport`) and each warning of plan `0251` and plan `0253`
  is written at the end, as today.
- The first sighting of a product keeps its category path, as today.
- `observedAt` stays one value per run if the price writer needs it, else it is the time of
  the read. The builder reads the writer and says which in the PR.
- The chunk size is `PRODUCT_CHUNK`, 400. If the builder wants another number, that is a
  decision for the owner. Bring it with the measurement of section 1.
- No checkpoint, no resume, no new table, no new status.
- The end of walk rules of each runner stay, as sections 2 to 6 state them.

### Action boundaries

- Build the runners in the order of sections 2 to 6. Do not start a runner before the PR of
  the one before it is open.
- Stop and ask before you change the sink, the ingest, the revert or the reaper.
- Stop and ask before you change `PRODUCT_CHUNK`.
- If a runner cannot report a product before the end without a change to what it reports,
  stop and report that runner. Build the others.

### Progress evidence

For each runner PR: the spec output, and one walk on an ephemeral slot whose harvester process
is killed with `kill -9` after about half the walk: the run row `STALE`, and the count of
`source_catalog_entries` and `item_prices` rows that carry its run id, quoted in the PR. Then
the retry, and the count of rows it confirmed and of rows it inserted. The first PR also
carries the measurement of section 1.

## 1. Proof the chunks commit, and the end of walk timing

Do these two steps first, in the first PR:

1. Read `SourceIngest.writeChunk` (`source-ingest.ts`, near line 532) and the catalog write it
   calls. State in the PR whether a chunk is committed when `push` returns. If it is not, stop
   and report, because the whole plan rests on it.
2. Measure the end of walk ingest of today against the 30 s grace period of the pod. Time it
   from the `INGEST` stage to `drain()` returning, for one Carrefour walk and one El Jamón walk
   on an ephemeral slot. Measure it again after the change. Quote both times in the PR. This is
   evidence for the PR, not a gate.

## 2. Carrefour

**Today.** Every listing waits in the map `products` (`carrefour-catalog.runner.ts`, near
line 93). `pageCategory` (near lines 245 to 250) and `pageFrom` (near lines 383 to 387) add a
product at its first sighting. `reportProducts` (near lines 411 to 440) calls `report.product`
for every product, only at the `INGEST` stage (near lines 160 and 161).

**Where it moves.** `pageCategory` and `pageFrom` call `report.product` at the first sighting,
where they add the product to the map today. The observation is built as `reportProducts`
builds it. The `INGEST` stage then reports nothing new.

**End of walk rules to keep.**

- `declareListing` (near lines 165 and 529) reads the full id set at the end, under its five
  conditions. Keep the ids for it. The map can keep only what `declareListing` and
  `describeRun` read.
- `warnUnread` (near lines 163 and 481) and `describeRun` (near line 176) run at the end, as
  today.
- The end pass `askAgain` (near line 150) reports what it reads through `pageFrom`, so it
  streams too.

## 3. El Jamón

**Today.** The listing stage fills `walk.rows` (`listCategory`, near line 352, `record` near
line 776, first sighting kept). The detail stage reads a page for each fresh product
(`readDetails`, near lines 263 to 344). `report.product` is called only in the `INGEST` loop
(near lines 198 to 239), at near lines 228 and 235.

**Where it moves.**

- A known product (`known.has(code)`, near line 221) is reported from the listing as soon as
  its category is listed, with the observation of near line 228.
- A fresh product is reported when its page answers, in the `handle` of the detail pool (near
  line 298), with `observationOf(listed, detail, observedAt)`.
- A fresh product whose page failed is reported in `onError` (near line 308), with the
  observation it gets today, with its top level category.
- What is left at the end is reported at the end, by today's rule: a row whose page the walk
  did not read because of an abort or the stop of plan `0253` (`pagesNotRead`, near line 210).

**End of walk rules to keep.**

- **A row whose page was never read must not clear a stored photo or category** (near lines
  213 to 233). A row the chain may already hold (`holdsRow`) is reported from the listing alone,
  never with an observation that states no photo and the top level category. Streaming must
  not report such a row with a full observation before its page is read.
- A hard death reports no unread row at all. That is safe, because a row that is not reported
  clears nothing.
- `declareListing` (near lines 241 and 460), `warnShortCategories` and `warnDetailUnread` (near
  lines 242 and 243) and the report run at the end, as today.
- The price disagreements of the listing and the page (near lines 188 to 195) keep the listing
  price. The listing is read before any page, so a streamed observation carries the same price.

## 4. DIA

**Today.** The walk adds each product to `walk.products` at its first leaf (near lines 507 to
515) and keeps the row of each scope in `scope.listed`. `report.product` and
`report.availability` are called only in the `INGEST` loop (near lines 115 to 134), at near
lines 129 and 131.

**Where it moves.** When a scope finishes (`summary.finished = true`, near line 225), the
runner reports what that scope read. The builder decides the exact unit and says it in the PR.

**This runner is the hardest of the five.** One DIA observation is built from the whole walk:
`observationOf` (near line 678) carries one regular price for each walked scope that listed the
product, and the national row when the anonymous store's scope was walked (`nationalOf`, near
lines 114 and 627). Its name, brand and `extra` come from the national store's row when that
store listed the product, and otherwise from the first walked scope that did. Before the last
scope, the runner does not know these. To stream thus means one of two things:

- (a) A product is reported once per scope, with that scope's prices. The ingest must then take
  a second observation of the same product in one run, and the identity fields can differ
  between the two. Section 1 does not prove that this is safe. The builder proves it or stops.
- (b) A product is reported once, after the last scope. That is the end of the walk, as today.

Report what the code allows in the PR. If neither (a) nor a variant of it is safe, stop and
report DIA. Its walk took 4 minutes on 2026-11-06, so the loss of a dead DIA walk is small.

**End of walk rules to keep.**

- `noteLeaves` (near lines 184 and 436) reads the menu before any scope, and the leaves feed the
  report. It stays where it is.
- `declareListings` (near lines 135 and 812) decides a whole listing for each scope at the end.
  A scope that did not finish states positives only.
- `availabilityOf` (near line 778) states claims for each walked scope. Availability stays
  at the end.
- The national row follows `nationalOf`. A product never gets a national row from a scope that
  is not the national store.

## 5. LIDL

**Today.** The detail loop adds each product to the array `products` when its page answers
(`lidl-catalog.runner.ts`, near lines 87 to 117). At the `INGEST` stage (near line 126),
`declareRegions` (near lines 127 and 203) declares every offer region once, and then
`reportProducts` (near lines 128 and 182 to 189) calls `report.product` for each product.

**Where it moves.** The detail loop reports a product as soon as its page answers. Before it
does, it declares each region of that product that the run has not declared yet.

**End of walk rules to keep.**

- **A price belongs to an offer region, and the region is declared before any price refers to
  it** (plan `0103`, D4). The run declares its regions and creates none. A region is declared
  once, at the granularity the source publishes, and never merged with others.
- The name of a region is the name of its first sighting, as `declareRegions` keeps it today.
- A product with no price is still reported.
- `describeRun` (near line 132) reads the products at the end. Keep what it reads.

## 6. DEZA

**Today.** `Crawl.products` (`deza-catalog.runner.ts`, near line 595) holds each product from
its first sighting (near lines 828 to 839). A later sighting only adds shop codes (near lines
818 to 823). `reportProducts` (near lines 146 and 177 to 204) calls `report.product` for every
product at the `SNAPSHOT` stage, after the whole enumeration. `reportAvailability` (near lines
159 and 207) states the claims after that.

**Where it moves.** When a section ends (`enumerateSection`, near line 239, returns after its
split queries), the runner reports the products that this section saw first. The observation of
a DEZA product does not change after its first sighting: its category path is fixed then (near
line 837), and its shops travel in availability, not in the product.

**End of walk rules to keep.**

- **DEZA knows its product set only after the split queries of plans `0257` and `0258`.** A
  section is the unit, not a query: the runner reports the products of a section after the
  section ends, and never claims that a section is complete.
- **It writes no price, ever.** Each observation carries `prices: []`, as today.
- **Availability stays at the end.** The popup names the shops that carry a product, so a shop
  it did not name does not stock it. That negative claim needs the whole crawl, and
  `reportAvailability` keeps it at the end.
- The `LISTING_UNREAD` warnings for unfinished sections (near lines 134 to 138) and
  `crawl.toReport()` run at the end, as today.

## 7. The build, one runner per PR

The plan is one plan, built in several PRs. One PR for each runner is the rule, in the order of
sections 2 to 6, and the builder proposes the split in the first PR. Recommended: the first PR
carries section 1 and Carrefour, and the second El Jamón, because each runner's end of walk
rules are a review of their own. Carrefour and El Jamón in one first PR is the alternative,
because both walks are the long ones. Each later PR names this plan and its section.

## Tests

For each runner, in its own spec:

- A fake client with a few categories, scopes or sections, and a product listed in two of
  them: `report.product` is called once for each product, after its first sighting, before the
  end of the walk.
- The same spec with an error or an abort part way: the products read before it are reported,
  and no whole listing is declared.
- El Jamón: a held row whose page was not read is never reported with a full observation, and
  a hard stop before the end reports it not at all.
- LIDL: each region is declared before the first product that names it.
- DEZA: no observation carries a price, and availability is reported only at the end.
- DIA: what section 4 allows, with the spec that proves it.

For the sink: a second run that reports the same values confirms the rows and inserts none
(`sameValues`).

## Acceptance criteria

- [ ] For each runner built, a walk killed half way leaves the rows it had reported.
- [ ] A walk that completes gives the same counters, report, listings and availability as
      before.
- [ ] A dead run writes no negative availability and declares no listing whole.
- [ ] A retry confirms the rows of the dead run and inserts no duplicate.
- [ ] The end of walk timing of section 1, before and after, is in the first PR.
- [ ] El Jamón never clears a stored photo or category for a row whose page it did not read.
- [ ] DEZA writes no price.

## Verification

```sh
npx nx test luna-shopper-backend-harvester -t "carrefour"
npx nx test luna-shopper-backend-harvester -t "eljamon"
npx nx test luna-shopper-backend-harvester -t "dia"
npx nx test luna-shopper-backend-harvester -t "lidl"
npx nx test luna-shopper-backend-harvester -t "deza"
npx nx test luna-shopper-backend-harvester -t "RunReportSink"
npx nx affected -t lint test
```

Then the walk of Progress evidence, against a local server of the committed fixtures or a
closed copy, never the live storefront at full rate.

## Decisions

**D1 (owner, answered 2026-11-11):** every chain that reports at the end, not only Carrefour:
Carrefour, El Jamón, DIA, LIDL and DEZA. The build starts with Carrefour and El Jamón, because
their walks are the longest (about 30 and 66 minutes), then the other three.

**D2 (owner, answered 2026-11-11):** a stale run with rows is treated like any run with rows.
The revert is offered on `STALE` runs already (`FINISHED_STATUSES`, `harvest-run.service.ts`
near line 228), and it hard deletes the rows a run wrote. The caveat stays: a retry that
confirmed a row of the dead run does not own that row, so a revert of the dead run also deletes
a price the retry read again. The plan `0255` line "Rows it left" needs no other word.

**D3 (owner, answered 2026-11-11):** the plan is built. "Do nothing" is not an option. A walk
does not usually write 10,000 products at once, except the very first walk. To write every
`PRODUCT_CHUNK` products for every chain means that nothing is written all at once at the end,
and that also removes the problem of a pod that restarts. X is `PRODUCT_CHUNK`, 400 today. A
different number is a decision to bring to the owner.
