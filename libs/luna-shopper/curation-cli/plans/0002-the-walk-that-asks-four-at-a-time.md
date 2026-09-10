# 0002 The walk that asks four at a time

`model-engines` plan 0003 gave an engine the ability to hold several requests in
flight. Nothing calls it: the walk asks one row, waits, and asks the next. This
plan is what lets the walk use it without creating the duplicates that ordering
exists to prevent.

## What the ordering actually guarantees

`collectCandidates` runs at `next` time and does two lookups against the
rehearsal catalog, which holds what this run has created so far:

```js
rehearsal.searchItems(normalizeName(entry.name)); // full text, top 8 by rank
rehearsal.findByEan(entry.ean); // exact
```

So the invariant is **not** "no duplicate is ever created". It is narrower and
it is worth stating exactly, because everything below is built on it:

> A row sees any earlier creation that those two lookups return.

A twin those two lookups miss is created twice by the sequential walk as well.
That is the bar this plan has to clear, and it is far lower than "prove the
catalog holds no duplicates".

Two consequences. The blind spot of a batch is only the rows **earlier in that
same batch**, because everything before the batch was applied before the batch's
candidates were fetched. And the check is therefore N wide, with N around four,
rather than a sweep over every product the run has marked `CREATE`.

## What was measured

The artifact is `D:/Projects/catalog-seed/catalog-seed-20260902.sql`, the real
Mercadona assortment: 4,196 items, 3,830 distinct normalized names, **in
creation order**, so it is a record of a real run's `CREATE` decisions rather
than a sample of a catalog.

A collision is counted when a row's query would retrieve a row earlier in its
own batch. The predicate is Postgres's own stemming, read out of the `search_es`
tsvector the dump carries, and a retrieval is every lexeme of the query name
appearing in the other document, which is what `to_tsquery` does with an AND.

| Width | Fixed windows | Composed batches | Speedup, fixed | Speedup, composed |
| ----- | ------------- | ---------------- | -------------- | ----------------- |
| 2     | 9.2%          | **2.0%**         | 2.06x          | **2.21x**         |
| 4     | 9.8%          | **2.6%**         | 2.05x          | **2.19x**         |
| 6     | 10.0%         | 2.6%             | 2.05x          | 2.19x             |
| 8     | 10.7%         | 2.9%             | 2.03x          | 2.19x             |

**Composition is where the win is, and it is free.** A batch that never admits
two rows with the same normalized name drops the re-ask rate by about three
quarters, and the average batch stays exactly 4.00 rows wide at width 4, because
same name rows are rare enough that deferring one costs nothing. The speedup
against one at a time is the 2.25x plan 0003 measured, divided by one plus the
re-ask rate.

**The 2.6% is an upper estimate, deliberately.** Three things push the real
number down and one pushes it up, and none of them changes the decision:

- the literal recheck (`catalog_norm(text) ~ '\m' || catalog_norm(word)`) and
  the top 8 limit both narrow what the search returns, and neither is modeled;
- `normalizeName` strips accents while the index keeps them, so some real
  queries answer zero rows (`lejia` 0 against `lejía` 2), which is a defect of
  its own and makes the real search retrieve **less** than modeled;
- every row here is a creation, while a real queue is part `LINK`, so real
  batches hold fewer creations and collide less often;
- the trigram branch can add a row the full text branch missed, which is the one
  effect in the other direction.

It is measured on one chain. Another may cluster differently, and the run report
names the rate it actually saw, so the next run is evidence rather than this
table.

## The design

Four steps, and only the third is new work for the model.

1. **Compose.** `next --count <n>` answers up to `n` undecided rows whose
   normalized names are pairwise distinct, with the candidates of each as of
   now. A row that would collide is left for the next batch, which is where the
   sequential walk would have shown it the earlier creation anyway.
2. **Ask.** One `engine.askMany(bodies, { system, schema })`. This is the whole
   of the saving, and it is the only step that is not already sequential.
3. **Apply in input order.** Each decision is recorded through `decide`, exactly
   as today. Before recording, the decider re-runs the two lookups. By then the
   rehearsal catalog holds the creations of the rows earlier in this batch.
4. **Re-ask what changed.** When a lookup surfaces a candidate the model was not
   shown, `decide` writes nothing and answers `{ stale: true, packet }` with the
   refreshed packet. That row alone is asked again, with the candidate it should
   have had, and recorded.

**Why the result is identical to the sequential walk, and not merely close.** At
step 3 row _k_ queries a rehearsal catalog holding the creations of rows 1 to
_k_-1, which is the state the sequential walk would have shown it. The candidate
set is therefore the same set, byte for byte. If it matches what the model
already saw, the answer it gave is the answer sequential would have produced. If
it does not, the row is asked again on the sequential input. Either way the
decision recorded is the decision the sequential walk records. No new class of
duplicate exists, and none of the old ones is fixed either.

## Where each piece lives

**`curation-suggestions`** owns composition and staleness, because it owns the
queue, the candidates and the run state, and because the orchestrator is not
allowed to know what a candidate is.

- `next` gains `--count`, answering `{ rows, remaining }`. One row without the
  flag stays exactly what it is today.
- Composition is a set of normalized names per batch. Nothing cleverer: the
  measurement says the identical name case is three quarters of the problem, and
  a token overlap rule would be guessing at a search whose own notes record that
  the Spanish stemmer conflates `salado` into `sal`. Overlap is a fine heuristic
  for composing a batch and is not fit to be a correctness check.
- `next` records the candidate set it handed out, per row, in the run directory.
  `decide` re-collects and compares. The comparison is over candidate identity,
  the `itemId` or the `ref`, and not over the packet's bytes.

**`curation-cli`** owns the loop.

- `runCuration` fetches a batch, calls `askMany`, and applies in order.
- `decideRow` keeps its one retry for a reply that cannot be used. **A stale
  packet does not spend it.** A stale packet is not the model answering badly, it
  is the model having been asked the wrong question, and a row that then breaks
  the schema must still get the retry that `--final` counts.
- Batch width is `engine.batchSize`, so an engine that holds one request in
  flight walks exactly as it does today and no flag is added to say so.

**`curation-groups` is not changed.** It has the same shape and probably the same
opportunity, but the table above is 4,196 supermarket items and says nothing
about how often two product groups in one batch collide. It gets this when
somebody measures it.

## What a stop does

Unchanged in meaning. `askMany` rejects with the signal's own reason, the rows
already recorded stay recorded, and nothing in flight is applied. The report
still covers the rows decided so far. A batch is not a transaction and was never
going to be one: each row is recorded on its own, which is what makes a stopped
run resumable at all.

## Decisions

- **Verification is at `decide` time, not before the batch.** A check that ran
  first would have to predict what the model creates. Running it where the
  creations already exist makes it a lookup rather than a prediction.
- **A collision costs a re-ask and never a wrong answer.** This is worth stating
  because it sets how careful composition has to be: composition is an
  optimization and may be as rough as it likes, while the `decide` time lookup is
  the correctness check and must stay the real search.
- **No sweep, at any point.** Not over the catalog, and not over the run's own
  creations. The only comparison is a row against the rows before it in its own
  batch, which is at most `batchSize - 1` items.
- **The run report gains the re-ask rate**, because the 2.6% above is a
  prediction from one chain's dump and the run is the thing that knows.

## Verification

`node --test`, everything injected, no network and no Docker, as the rest of the
toolchain:

- composition: a batch never holds two rows with the same normalized name, a
  deferred row is the first row of a later batch rather than dropped, `--count`
  larger than the queue answers what there is, and `next` with no flag answers
  one row in the shape it answers today;
- the loop: a batch of four with no collisions asks the model four times and
  records four decisions in input order; a batch whose third row goes stale
  records three, asks once more, and records the fourth;
- a stale packet does not consume the schema retry: a row that goes stale and
  then breaks the schema is still asked twice about the schema before `--final`;
- staleness is by candidate identity: a packet that differs only in field order
  is not stale, and one that gained a `ref` from an earlier row in the batch is;
- a stop part way through a batch records what was recorded and applies nothing
  in flight, and the report says so;
- an engine with `batchSize` 1 walks exactly as the current walk does, asserted
  against the existing orchestrator tests unchanged;
- the collision measurement is a checked in script over the dump, so the table
  above can be re-run rather than believed.

**And one live run.** The queue worked end to end against a rehearsal slot with
`--engine ollama`, `OLLAMA_BATCH=4` and a server started with
`OLLAMA_NUM_PARALLEL=4`, recording the wall time, the re-ask rate and the
decisions, and compared against the same queue walked one row at a time. The
prediction is 2.19x and about one row in forty asked twice. The run is what says
whether the prediction was right.
