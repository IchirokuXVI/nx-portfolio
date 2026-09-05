> **PR:** [#223](https://github.com/IchirokuXVI/nx-portfolio/pull/223)

# 0082 A reverted run leaves nothing behind

A run wrote prices, and they were wrong. A leaflet was uploaded for the wrong chain, a document
carried an extractor's misreads, a refresh ran against a warehouse that answered nonsense. The
owner's decision, in his words:

> If a harvester run is reverted, the prices must actually disappear, I don't want them at all. A
> run that was reverted must not introduce anything. If it was reverted it's for a reason, maybe
> it got wrong results.

So a revert is a **hard delete** of the rows the run wrote, followed by a recompute of every key it
touched. Not a retraction flag, which both reviewers proposed and the owner overruled. This plan
builds it for every run mode that writes prices, and it is written to his decision.

Depends on `0080` for `sourceRunId` and `lastObservedRunId` on every `item_prices` row, and on
`0081` for `revertedAt` on `harvest_runs`, the alias table and the stored document.

## 1. Two decisions that look like one

The owner also decided, earlier, that **old prices are never lost**: superseded values become a
per item, per scope history. A reader who holds both sentences side by side sees a contradiction.
There is none, and the plan says why in one place so nobody has to reconstruct it.

**Superseding a price keeps history.** A source that changes its mind writes a new row and leaves
the old one exactly as it was (`0080` section 2.1). The old row is a true statement about the past:
on that day, that source said that number. Deleting it falsifies the record.

**Reverting a run erases a mistake.** The rows a reverted run wrote are not old prices. They are
that run's claims, and the owner says the claims were wrong. A wrong claim kept in the history is
not a record of the past. It is a record of an error. A chart or a comparison drawn from it later
is drawn from a number the chain never charged. Keeping it falsifies the record in the other
direction.

Both rules protect the same thing: that every row in `item_prices` is a number a source really
stated. One does it by never editing a row. The other does it by removing rows that were never
true. They are different acts on different rows, and nothing in either weakens the other.

## 2. What a revert deletes

For a run `R` with `revertedAt` null, in one catalog transaction:

1. **Every `item_prices` row with `sourceRunId = R`.** These are the rows the run inserted. They
   include rows written later by an alias accept on that run's behalf (`0081` section 3), which
   carry the run's id for exactly this reason.
2. **Every `item_price_details` row** of those prices, by cascade.
3. **Every confirmation the run made is withdrawn.** A row with `lastObservedRunId = R` and
   `sourceRunId <> R` was not written by the run, only confirmed by it: the run saw the same
   number and moved `lastObservedAt` forward. The previous `lastObservedAt` was overwritten and is
   gone, so it cannot be restored. The row's `lastObservedAt` is set back to its `observedAt`, and
   `lastObservedRunId` to its `sourceRunId`. That errs toward stale: the row ages as if the run
   never happened. Where the only thing keeping it fresh was a run the owner distrusts, stale is
   the honest state. Without this step a bad run leaves its fingerprints on every price it agreed
   with, and "must not introduce anything" includes the freshness it introduced.
4. **A recompute of every (item, scope) key** that any deleted or reset row belonged to, plus the
   fan out of `0080` section 6 for a `NATIONAL` scope. The materialized row falls back to the next
   eligible source, or to the stale tier, or to no price.
5. **Audit rows** for every delete and every reset, as a `SERVICE` actor with the run id in
   `before`, so plan `0075`'s trail answers "why did this price vanish on Tuesday".

`ADMIN` rows carry no run id and are never touched. Rows written by other runs are never touched.
A `USER_RECEIPT` row from the seed carries no run id and is never touched.

**Availability is not restored.** A `REFRESH` run that met a 404 wrote `available: false` through
`supermarketItem.setAvailability`, and that write carries no run id and has no history (`0080`
section 2). A reverted refresh leaves availability as it found it. The reason is that a 404 from a
chain's own detail endpoint is the chain's answer about its own stock, and the next refresh states
it again either way. It is stated here as a limit rather than hidden, and if a reverted run's
availability claims ever matter, availability gets a history first.

## 3. What happens to the aliases

An import creates `source_aliases` rows as `CANDIDATE` or `UNRESOLVED`. By the time of a revert,
an admin accepted or rejected some of them.

**Decision: an alias a person decided on survives the run that created it. An alias nobody decided
on goes with the run.**

- `ACTIVE` and `REJECTED` aliases with `firstRunId = R` stay. Both are the owner's decisions, made
  in the queue after the run. An `ACTIVE` one is a mapping other leaflets already resolve through.
  Deleting it makes the next leaflet ask again for a product the owner already named.
  A `REJECTED` one is the owner saying "not a product I track", and a run does not get to reopen
  that (`0081` section 3, rung 2). The run's mistake was in its prices, not in the strings it
  read, and the string the chain printed is still the string the chain printed. What is deleted
  is the price the accept wrote (section 2, step 1), so an accepted alias survives with no price
  behind it until the next import.
- `CANDIDATE` and `UNRESOLVED` aliases with `firstRunId = R` are deleted. Nobody decided on
  them. They sit in the queue only because this run put them there, and a run that must not
  introduce anything must not introduce work for a person either. The next import of a corrected
  document recreates them if the strings are still there.
- Aliases with `firstRunId <> R` that the run merely saw again keep their `timesSeen` and
  `lastSeenAt`. Those are observations of a string on a page, and the string was on the page.

## 4. The digest is free again

`0081` section 7's dedupe index excludes runs with `revertedAt` set. Setting `revertedAt` is what
lets a corrected upload of the same document through. Two cases follow:

- The operator fixes the extractor's output. The digest changes and there was never a conflict.
- The operator uploaded the right file against the wrong chain or scope. The digest is the same,
  the run is reverted, and the same file is imported again with the right choices. That is the
  case the exclusion exists for.

A run reverted twice is answered 409 with `revertedAt`: there is nothing left to revert, and the
second request is a mistake worth telling the caller about.

## 5. The operation

`harvest.revert { runId }`, platform admin gated, on the harvester. Allowed on a run whose status
is `COMPLETED`, `FAILED`, `ABORTED` or `STALE` and whose mode writes prices: `LEAFLET_IMPORT`,
`REFRESH`, `CATALOG_DISCOVERY`. A `STORE_DISCOVERY` run writes no price and is refused. A
`PENDING` or `RUNNING` run is refused: abort it first, then revert what it flushed.

In order:

1. Load the run, check status, mode and `revertedAt`.
2. Send `itemPrice.deleteByRun { sourceRunId }` to catalog. Catalog runs section 2 in one
   transaction and answers `{ deleted, reset, recomputed }`.
3. Delete the undecided aliases of section 3 in the harvester.
4. Set `revertedAt`, `revertedByUserId`, `revertedPriceCount` on the run and answer the run view.

**Two databases, and the order matters.** Catalog goes first. Say the harvester step fails after
catalog succeeded. The run is not yet marked reverted and the prices are already gone. A second
call finds nothing to delete in catalog, because `deleteByRun` on a run with no rows answers
zeros, and completes the harvester half. The operation is idempotent up to the mark. A retry is
always the right response to a failure. The run list never shows a run as reverted whose prices
still exist.

The gateway route is `POST /v1/admin/harvest/runs/:id/revert`, beside `abort` at
`harvest.controller.ts` line 135, answering the run view. `HarvestRunView` gains `revertedAt`,
`revertedByUserId` and `revertedPriceCount`.

## 6. The admin control

On the run page (`run-page.ts`), a **Revert** button beside **Abort**, shown for a finished run of
a price writing mode that is not yet reverted. It confirms with the numbers: "Delete the 214 prices
this run wrote and 9 rows waiting in the queue. Accepted and rejected names are kept." After the
call, the page shows the reverted state and the counts the operation answered.

On the runs list (`runs-page.ts`), a reverted run keeps its status chip, because the status says
how the run ended and that did not change. It gains a second chip, `reverted`, with `revertedAt`
in the row and the operator's id on hover. The list filter gains `reverted: true | false`.

The price history screen (`0080` section 10) shows nothing for a reverted run, because there is
nothing left to show. The audit trail (`0075`) is where a deleted row's last values live, and
the run page links to the audit filtered by that run id.

## 7. Testing

- **Delete by run**: only rows with that `sourceRunId` go, `ADMIN` rows and other runs' rows
  stay, details cascade, every affected key is recomputed, a `NATIONAL` delete fans out.
- **Confirmations withdrawn**: a row confirmed by the run has `lastObservedAt` reset to
  `observedAt` and its eligibility recomputed. A row confirmed by another run since is untouched.
- **Aliases**: `ACTIVE` and `REJECTED` survive, `CANDIDATE` and `UNRESOLVED` from that run go,
  aliases from other runs are untouched, and a price written by an accept on the reverted run is
  gone.
- **Digest**: the same document is accepted after the revert and refused before it.
- **Idempotence**: a failure after the catalog step leaves a retry that completes, and a second
  revert of a reverted run is 409.
- **Refusals**: a running run, a store discovery run, and a run that does not exist.
- **Admin**: the button appears only for a finished, unreverted, price writing run. The
  confirmation names the counts. The list shows the chip.
- Integration against a slot: import the El Jamon output, accept one queued alias, revert, and
  assert zero `OFFICIAL_LEAFLET` rows for the chain, the accepted alias still `ACTIVE`, and the
  same document importable again.

## 8. Exit criteria

- Reverting a run deletes every price row it wrote, including those an accept wrote on its behalf,
  withdraws every confirmation it made, recomputes every affected key, and audits each change.
- Superseded prices are never deleted by any path, and the plan states why the two rules agree.
- An alias the owner accepted or rejected survives a revert of the run that created it. An alias
  nobody decided on goes with the run.
- The same document is importable again after the revert.
- The operation is safe to retry after a partial failure and refuses a second revert, a running
  run and a run that writes no prices.
- The run page reverts with a confirmation that names the counts, and the runs list shows a
  reverted run as reverted without changing its status.
- `openapi.json` and `wire-types.ts` are regenerated and committed, and
  `npx nx affected -t lint test` is green.
