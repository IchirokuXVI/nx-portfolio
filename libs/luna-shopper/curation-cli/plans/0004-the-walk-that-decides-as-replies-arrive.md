# 0004 The walk that decides as replies arrive

Plan 0002 made the walk ask several rows at once and plan 0003 made each of
those rows cheaper. This one is about the time the walk spends with the card
idle. Nothing here changes what a decision means, what the model is shown, or
what is written. Every item is a slot that was empty while there was work
waiting for it.

## The brief

Three changes, one pull request, all three inside `curation-cli` and
`model-engines`.

1. **Decide each row as its reply arrives**, rather than waiting for the whole
   round. The engine contract gains a way to hand the caller one promise per
   prompt, settled as that prompt is answered, in input order.
2. **Batch the re-asks at the end of a round.** A row the decider answered
   `retryable` or `stale` is collected with its next prompt and the whole
   collection is asked together, rather than one re-ask at a time in the middle
   of the round.
3. **Widen the round independently of the in flight count.** How many rows a
   round covers and how many requests the engine holds in flight stop being one
   number, because they answer two different questions.

None of them changes the decider, the prompt, the schema or the validators.

## What was measured

Eighty rows on the real Mercadona and SuperCash queues, `gemma4:12b` on a local
Ollama server with four in flight, 2026-09-13. The walk was instrumented for
how many of the four slots were busy:

| Requests in flight | Share of the walk |
| ------------------ | ----------------- |
| four               | 66%               |
| one                | 14%               |
| none               | 15%               |

The 15% with nothing in flight is the decide loop, which runs only once the
whole round is back, plus the decider's own cost between rounds. The 14% with
one request in flight is two things: the tail of a round, where three slots
have finished and the fourth is still writing, and the serial re-asks, which
are asked one at a time in the middle of the loop.

The re-asks are few and they are expensive where they land. After the grammar
change of plan 0003 an eighty row run re-asked 8 times, down from the 31 it
re-asked before it. Eight re-asks over eighty rows is a re-ask in roughly one
round of every two and a half at a width of four, and every one of them today
is a round of one: the walk sends a single request, waits for it alone, and the
other three slots have nothing to do while it answers.

Item 6 of plan 0003 is still refused and is not revisited here. Prefetching the
decider needs a decider that hands out a batch under a batch id, and that is a
plan of its own.

## 1. One promise per prompt

The engine contract gains one member:

    engine.askEach(prompts, { system, schema }) -> Array<Promise<{ text } | { error }>>

The array is in input order and is returned at once. Each promise settles when
its own prompt is answered, which for a pool is the order the server finished
in rather than the order the prompts were sent. A prompt the engine gave up on
settles as `{ error }`, exactly as it does in `askMany`, so one failure still
does not discard the answers beside it. A stop rejects every promise that has
not settled, with the signal's own reason.

`askMany` stays, because a caller holding a list of questions and no use for
the order they come back in should not have to write the loop. It becomes
`Promise.all` over the same pool, so there is one implementation and not two.

**Every promise is given a handler when it is created.** The caller reads them
one at a time and may stop reading half way through, on a Ctrl+C or on a row
whose decide threw, and a rejected promise nobody ever awaited ends the Node
process. So the pool attaches an empty catch to each promise as it builds them,
which marks the rejection handled without changing what an await later sees.

The walk then reads the array rather than the resolved list: it awaits promise
k, decides row k, and only then awaits promise k plus one. Row k is still
recorded before row k plus one, so plan 0002's argument is untouched, and the
card is busy with rows k plus one onwards for the whole of the time row k
spends in the decider.

## 2. The re-asks of a round are asked together

Today a row that comes back `retryable` or `stale` is asked again inside the
decide loop, one request, alone, with the rest of the round waiting behind it.
That is the 14% above.

A round becomes a series of passes instead:

- **Pass one** is the round's prompts, one per row. Each row is decided as its
  reply arrives, in input order. A row that is recorded is written out. A row
  the decider answered `retryable` or `stale` is set aside with the prompt it
  needs next, which is the retry instruction for the first and the refreshed
  packet for the second.
- **Every pass after it** is whatever pass one set aside, asked together
  through the same `askEach` and decided in input order, setting aside whatever
  is still not recorded.
- The round ends when a pass sets nothing aside.

The retry budget is unchanged and is what bounds the passes. A row that broke
the schema is asked once more and its second answer is recorded with
`final: true`, which records a REVIEW rather than asking a third time. A row
answered `stale` is asked again on the refreshed packet with the budget
untouched, which is plan 0002's rule, so a row that goes stale twice enters a
third pass and still has both of the attempts `--final` counts. There is no
pass counter and no new number: a row either spends a retry or the decider
refreshed its packet, and both of those already terminate.

**Deferring a row to the end of its own round is safe, and the reason is the
round's composition rather than the order.** The decider composes a round so
that no two of its rows can be about the same product (plan 0002), so the order
the rows of one round are recorded in cannot change what any of them is shown.
The check that would catch it if that were ever wrong is unchanged and is the
same one that catches a genuine collision today: the decider re-runs its two
lookups before it records, and a row whose candidate set moved comes back
`stale` and is asked again. What a deferred row loses is its place in the
output order, which nothing reads: `decisions.jsonl` is the decider's own file
and `--apply` replays it as the decider wrote it.

`decideRow` is refactored rather than duplicated. The step that reads one
reply, records it, and answers either the decision or the next prompt to send
becomes a function of its own, and `decideRow` is that step in a loop around
one row. The walk is the same step across a whole round, which is why there is
one place where a retry is spent and one place where a stale packet is
re-asked, whichever width the walk is running at.

## 3. The round and the in flight count are two numbers

They have been one number since plan 0002, and they answer two questions:

| Number      | Answers                                                      |
| ----------- | ------------------------------------------------------------ |
| `batchSize` | how many requests the engine holds in flight at once         |
| `roundSize` | how many rows the walk fetches, asks and decides as one unit |

The first belongs to the server: Ollama answers `OLLAMA_NUM_PARALLEL` requests
at a time and more in flight than that measured slower rather than faster, so
raising it past the slot count buys nothing. The second belongs to the walk,
and a wider round is worth having for the same reason a pool beats chunks: a
worker that finishes takes the next prompt immediately, so a round of twelve at
four in flight refills the slots eleven times before it pays a tail, where
three rounds of four pay three tails and three trips to the decider.

So `roundSize` joins the contract beside `batchSize`, the ollama engine reads
`OLLAMA_ROUND` and defaults to three times its width, which is 12 at the
default 4, and the walk's width becomes

    min(engine.roundSize ?? engine.batchSize ?? 1, opened.batches)

`opened.batches` is unchanged and is still the cap: a round never crosses the
decider's queue page, because a batch composed across two pages is a batch
whose collision guarantee nobody proved. At the shipped numbers that ceiling is
20 and the round is 12, so the round is what binds.

The claude engine stays at one. One call is one `claude -p` process, this
adapter still has no measurement saying that several at once answer sooner, and
a round of one is the walk plan 0001 shipped.

`--limit` is untouched and keeps its exact remainder behaviour: it narrows the
round it asks for to the rows it has left rather than fetching a round and
trimming it, because a fetched row carries a handout the decider is holding
open and nothing would ever close it.

**The docs say what each knob is for**, in the JSDoc of `makeOllamaEngine` and
in the CLI usage text, which is where an operator looks. `OLLAMA_BATCH` above 4
buys nothing on a single 4080 class card, because the reward is the server's own
slot count and six and eight in flight both measured slower than four.
`OLLAMA_ROUND` is the lever for round tails and for the decider between rounds,
and it costs nothing on the server.

## Where each piece lives

**`model-engines`** owns the contract: `askEach` on every adapter and the
shared one, `askMany` rewritten over it, `roundSize` on every adapter, and
`OLLAMA_ROUND`. Nothing in any of it knows what curation is.

**`curation-cli`** owns the walk: the step function, the passes, the width, and
the usage text.

**Nothing in `curation-suggestions` changes**, which is the test of whether
this is a speed change or a behaviour one.

## Verification

`node --test`, everything injected, no network, no Docker and no model:

- a round whose later prompt answers first is still decided in input order, and
  row k is recorded before row k plus one is awaited;
- a prompt the engine gave up on settles as its own entry and the rest of the
  round answers;
- a stop rejects the prompts that have not answered, `askMany` rejects with the
  signal's own reason, and nothing after the stop is sent;
- the promises a caller abandons raise no unhandled rejection;
- a round with two re-asks sends them as one call rather than as two;
- a re-ask answered `stale` a second time enters another pass, spends no retry,
  and is recorded there;
- a re-ask that breaks the schema twice is recorded with `final: true`, exactly
  as it is today;
- `roundSize` is what the width is computed from, `batchSize` is the fallback
  for an engine that reports none, and `opened.batches` still caps both;
- `OLLAMA_ROUND` is read, absent gives three times the width, and a value that
  is not a positive whole number is refused while the engine is being built;
- `--limit` narrows the last round to the exact remainder, and a limit past the
  end of the queue is the whole queue;
- a width of one asks one at a time, through `ask`, and calls neither `askMany`
  nor `askEach`.

**And one live run**, which is the only thing that can answer whether the three
of them together move the 66%. The same eighty row queue, the same four in
flight, comparing the wall clock and the share of the walk with four slots busy
against the table above.
