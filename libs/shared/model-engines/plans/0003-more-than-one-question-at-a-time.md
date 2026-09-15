# 0003 More than one question at a time

A second method on the contract, `askMany`, and one adapter that answers it with
more than one request in flight. Batching is configurable, it is off wherever the
adapter cannot do it, and the `ollama` entry has it on by default.

This plan is mostly measurement, because the measurement is what makes the design
small. A local server does not behave the way "send them all at once" assumes.

## What a local server actually does with concurrent requests

Measured on the same machine plan 0002 was measured on: Ollama 0.34.0,
`gemma4:12b`, an RTX 4080 SUPER with 16 GB, using the real curation system prompt
and real packets.

**A default server runs one request at a time.** Six rows took 13,507 ms one by
one and 13,958 ms fired together, which is 0.97x. The per request latencies
staircase in exact 2.3 second steps, which is queueing seen from the client.
`OLLAMA_NUM_PARALLEL` decides this and it defaults to 1, so a client that fires
six requests has six requests waiting on one worker.

**With slots, concurrency pays, and the optimum is the slot count.** The same
eight rows against a server started with `OLLAMA_NUM_PARALLEL=4`:

| Requests in flight | Wall     | Per row  | Against one by one |
| ------------------ | -------- | -------- | ------------------ |
| 1                  | 18,950ms | 2,369 ms | 1.00x              |
| 2                  | 11,321ms | 1,415 ms | 1.67x              |
| 4                  | 8,418ms  | 1,052 ms | **2.25x**          |
| 6                  | 8,740ms  | 1,093 ms | 2.17x              |
| 8                  | 9,112ms  | 1,139 ms | 2.08x              |

Two things follow from that table and both shape the code.

**More in flight than the server has slots is worse than matching it.** Width 6
and width 8 are both slower than width 4. There is no reward for sending the
whole queue and there is a small penalty, so the client holds a fixed number in
flight and refills as each one finishes. It never builds one big `Promise.all`.

**The number of slots cannot be discovered.** `/api/ps` reports `context_length`
as the per request window (16,384 on a four slot server asked for 16,384), not
the total, so there is nothing to read it from. It is a knob, and the plan below
picks its default from this table rather than from a guess.

**Slots cost memory, and this is the number to plan a machine around.** One slot
at `num_ctx` 16,384 loaded at 8.0 GB of VRAM and four slots at 10.4 GB, so about
0.8 GB per extra slot. The model itself is 7.5 GB of that. Sending a large batch
costs nothing, because what is allocated is the slots and not the queue.

**A cold slot pays the system prompt again, once.** Each slot keeps its own KV
cache, so the first request to reach a slot re-reads the whole standing half. In
a six row run against four cold slots, 8,702 of 17,400 cached tokens were lost.
Over eight rows on warm slots, 23,212 of 24,080 prompt tokens were still served
from cache. So the cost is one system prompt per slot per run, not per request,
and it is why the gain is 2.25x rather than the 4x the slot count suggests.

## What this does not make faster, and why that is deliberate

**The curation walk cannot use this.** `orchestrator.mjs` runs `decider.next()`
and then `decideRow()` strictly one row at a time, and it must: `next` collects a
row's candidates from both catalogs at the moment it is asked, so that it sees
whatever the previous row's `decide` created in the rehearsal catalog. That
ordering is the whole reason the rehearsal slot exists. Two rows for the same
product decided concurrently would each see a catalog without the other's
creation and would each create it, which is the duplicate bug the toolchain was
built to kill.

So nothing in this plan touches the walk, and `curation-cli` keeps calling `ask`
one row at a time. The capability is for callers whose questions are genuinely
independent of each other, which is what leaflet reading is: pages of a document
that create nothing and can be read in any order. Plan 0001 named it as the third
caller and this is the part of it that can be built before it arrives.

A batching engine whose only real caller is sequential would be worth arguing
about. What settles it is that the seam is two small methods and the measurement
above has to be written down somewhere regardless, because the next person to
reach for `Promise.all` against a local model will otherwise pay for it twice.

## The contract

`ask` is unchanged. Two things are added beside it.

```js
engine.ask(prompt, { system, schema }) -> { text }              // unchanged
engine.askMany(prompts, { system, schema }) -> Array<{ text } | { error }>
engine.batchSize                                                // 1 means one at a time
```

- **`askMany` answers in input order**, one entry per prompt, and an entry is
  either `{ text }` or `{ error }`. It is not `ask` repeated: `ask` throws when it
  gives up, and a batch that threw would discard every answer beside the one that
  failed. On a batch of two hundred that is the wrong trade, so a failure is
  reported in its own slot and the rest of the answers survive.
- **`batchSize` is how many requests the engine holds in flight**, and `1` is the
  honest answer for an adapter that has no reason to do more. Every caller can
  read it, and no caller has to ask which adapter it is holding, which is the rule
  the whole library is arranged around.
- **A stop still stops everything.** The signal aborts whatever is in flight, no
  further prompt is started, and `askMany` rejects with the signal's own reason
  rather than answering an array of errors. A stopped run is not a run that
  failed two hundred times.

**Batching turns off where it is not supported, and that is the library's job and
not each adapter's.** `askManyInOrder` is the shared default, one at a time,
written once beside `withRetries` and given to every adapter. `claude` and `api`
take it unchanged and report `batchSize: 1`. An adapter opts in to more by
overriding `askMany` and saying so in `batchSize`. Adding a fourth engine that
never thought about batching still gets a working `askMany`.

`askMany` receives a list of prompts and nothing else. It does not learn a row
count, a queue length or anything else about the run, because a list of questions
is what it would have been asked one at a time anyway. Plan 0001's rule about what
an adapter never holds is unchanged by this.

## The Ollama half

`makeOllamaEngine` gains a worker pool and nothing else. Every request it sends is
the request plan 0002 specified, unchanged, including the one `num_ctx` for the
whole run and the truncation floor on each reply.

- **`OLLAMA_BATCH` sets the width, and the default is 4.** From the table: 4 is
  the best width measured on a four slot server, and on a default one slot server
  it measured 0.97x, which is inside the noise. So the default costs an operator
  who has not tuned their server nothing, and rewards one who has without asking
  them to configure a second thing. `OLLAMA_BATCH=1` turns batching off and is the
  supported way to get plan 0002's behaviour back exactly.
- **The pool holds `batchSize` in flight and refills**, because the table says
  width above the slot count is a small loss and building one `Promise.all` over
  the whole queue is that mistake at any size.
- **A value above 8 is accepted and gets one line on stderr**, once, saying the
  measured optimum is the server's `OLLAMA_NUM_PARALLEL` and that more in flight
  than that measured slower. The operator's machine is theirs to experiment on and
  the value is not clamped, but a number chosen in hope should meet the number
  that was measured. Above 256 it is refused, because Ollama's own queue is 512
  deep by default and a batch that overruns it answers 503 to work that was
  already accepted.
- **`OLLAMA_NUM_PARALLEL` is not read and cannot be.** It belongs to the server,
  which may be on another machine, and there is nothing in the API that reports
  it. The two knobs stay independent and the documentation says how they relate.

## Decisions

- **`askMany` is on the contract rather than a helper the callers write.** The
  alternative is exporting the pool and letting each caller run it, which puts the
  width, the ordering and the abort rule in as many places as there are callers,
  and makes `batchSize` advice instead of behaviour.
- **A failed prompt is an entry, a stopped run is an exception.** They are
  different things: one is an answer about one prompt and the other is an answer
  about the run.
- **No flag is added to `curation-cli`.** The walk cannot batch, so a `--batch`
  flag there would be a knob that changes nothing, which is worse than no knob.
  The width is an environment variable for the same reason `OLLAMA_HOST` and
  `OLLAMA_NUM_CTX` are: it belongs to the machine the model runs on.

## Verification

`node --test`, `fetchImpl` injected, no server:

- the shared default: `askManyInOrder` sends one request at a time, answers in
  input order, and reports a failure in its own entry while the others answer;
- `claude` and `api` report `batchSize: 1` and answer `askMany` through the shared
  default, with no change to what one call sends;
- the pool: with `batchSize` 4 and ten prompts, no more than four requests are ever
  in flight at once, all ten answer, and the answers are in input order rather
  than completion order;
- a slow prompt in the middle does not hold back the ones behind it, which is what
  a pool does that a chunked `Promise.all` does not;
- one prompt failing after its retries answers `{ error }` in its own slot while
  every other entry answers `{ text }`;
- an abort part way through rejects with the signal's own reason, and no prompt is
  started after it;
- `OLLAMA_BATCH` is read: absent gives 4, `1` gives one at a time, a value over 8
  warns once on stderr and still runs, a value over 256 is refused, and a value
  that is not a positive integer is refused;
- every request the pool sends is still plan 0002's request, so the truncation
  floor, the schema, `think`, `keep_alive` and the single `num_ctx` are all
  asserted through a batched call as well as a single one;
- every existing suite in `model-engines` and `curation-cli` passes, and
  `curation-cli` is not edited at all, because the walk is not changing.

**And one live check.** A batch of eight against the operator's own server with
`OLLAMA_BATCH=4`, answering eight correct decisions, to confirm that the pool
sends what the single path sends. The throughput number it produces depends on
that server's `OLLAMA_NUM_PARALLEL` and the table above says what to expect at
each setting.
