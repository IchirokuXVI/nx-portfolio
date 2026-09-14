# 0005 The server's own clock

The Ollama adapter throws away six numbers the server already measured. This
plan keeps them: every reply carries a `timings` block, `engine.usage`
accumulates the sums, `report.json` carries them because it already carries
`usage` whole, and a run ends with one line on stderr saying how fast the model
decoded, how much of the time went on reading the prompt, and how much on
loading the model.

It exists because wall clock on this machine cannot settle an argument. Two
identical 80 row walks, same code, same queue, measured 157 s and 207 s on
2026-09-13, which is about 30% apart. A change worth 20% is invisible against
that, so every speed claim in `curation-cli` plan 0003 rests on numbers that a
rerun could have produced by itself. Decode tokens per second, prompt eval share
and load time are per call properties of the server rather than of the afternoon
it ran in, so they hold still while the wall clock wanders, and they also answer
a question nothing here can answer today: whether the server's own prefix cache
is serving the unchanging system prompt across the parallel slots, or whether
every call is paying to read it again.

Built on plan 0002, which wrote the adapter, and plan 0003, which gave it a
pool. It touches neither the pool nor `askMany`.

## 1. What the server already answers

A non streaming `POST /api/chat` reply carries these beside the message, and the
adapter reads two of them and discards four:

| Field                  | Unit        | Read today |
| ---------------------- | ----------- | ---------- |
| `total_duration`       | nanoseconds | no         |
| `load_duration`        | nanoseconds | no         |
| `prompt_eval_count`    | tokens      | yes        |
| `prompt_eval_duration` | nanoseconds | no         |
| `eval_count`           | tokens      | yes        |
| `eval_duration`        | nanoseconds | no         |

The two token counts are already mapped into the five usage counters, and that
mapping is not touched: `prompt_eval_count` still has the cached tokens taken
off it before it becomes `input_tokens`, for the reason `ollama.mjs` states
where it does it. The timings are a second reading of the same reply and they
report the raw counts, because a throughput computed from a count with the
cached tokens removed would be a rate against tokens the server never decoded.

## 2. The reply carries `timings`

`ask` answers `{ text, timings }`. The block is milliseconds and tokens, because
nobody reasons in nanoseconds and every consumer would divide by a million
first:

```js
{
  totalMs,        // total_duration
  loadMs,         // load_duration
  promptTokens,   // prompt_eval_count, raw
  promptEvalMs,   // prompt_eval_duration
  evalTokens,     // eval_count
  evalMs,         // eval_duration
}
```

Three rules:

- **Rounded to the nearest millisecond.** A curation call is measured in
  seconds, so sub millisecond precision is noise, and the sums are what the
  report reads. A resident model rounds `loadMs` to 0, which is the true answer
  to what loading cost that call: the adapter sends `keep_alive` precisely so
  that it costs nothing after the first one.
- **Absent when the server reported none.** `timings` is `null` rather than six
  zeros when `total_duration` is missing, because zeros are a measurement and
  this is the absence of one. That is the same rule the adapter already applies
  to `cache_creation_input_tokens`, where it writes 0 because Ollama really does
  not charge for filling its cache, and refuses to invent the number it does not
  report.
- **It does not travel through `askMany`.** A batch entry is `{ text }` or
  `{ error }` and stays that, because widening it means widening `askEntry` in
  `retry.mjs`, which is shared with two adapters that have nothing to put in it.
  Nothing is lost: `usage` is accumulated inside `ask`, so a batched run's
  numbers are complete whichever surface asked for them.

## 3. `usage` accumulates the sums

`addUsage(total, usage, timings = null)` takes a third argument. The two callers
that have no timings pass nothing and are unchanged.

The sums live in their own block on the total, created when the first timed call
arrives and absent otherwise:

```js
usage.timings = {
  calls, // timed calls, which is not usage.calls
  totalMs,
  loadMs,
  promptTokens,
  promptEvalMs,
  evalTokens,
  evalMs,
};
```

**This is not a sixth counter.** Plan 0001 says an adapter maps its provider's
words into the five counters and does not invent a sixth, and that rule is about
tokens, which the report's arithmetic reads by name and which every provider
counts. Time is not a token count, no provider outside this one reports it, and
folding milliseconds into a field named for tokens is exactly the mixing the
rule forbids. So it is a separate block, it is optional, and nothing that reads
the five counters has to know it can be there.

**`calls` is counted here and not read off `usage.calls`.** A run can mix an
engine that reports timings with calls that did not, and a rate divided by the
wrong denominator is worse than no rate.

**No derived numbers are stored.** Tokens per second and the prompt share are
divisions, and a division stored beside its operands is a number that can
disagree with them. The formulas are the two below, and whoever wants them does
the arithmetic:

```
decode tokens per second = evalTokens / (evalMs / 1000)
prompt eval share        = promptEvalMs / totalMs
```

## 4. The report carries them for free

`end` in `curation-suggestions/src/commands.mjs` serialises `usage` whole into
`report.json`, so the block appears there with no change to that file. That is
worth saying out loud because it is the reason this shape was chosen over a
separate argument threaded down from the CLI: the path from the adapter to the
report already exists and carries whatever `usage` holds.

## 5. One line on stderr

A run ends with the report path on stderr and nothing about what the model did.
This adds one line, before it, and only when the run has timings to report:

```
ollama: 31.4 decode tok/s, prompt eval 18% of 157.2 s, load 6.9 s over 80 calls
```

It is one line for a reason. The numbers are there to be compared between two
runs, and two runs are compared by reading the same line twice, which is easy
while it is one line and stops being easy the moment it is a table.

The formatter is a pure function of the usage and the engine's name, so the
arithmetic is testable without a run, and it answers nothing at all when there
are no timings, which is every claude run and every engine that is not this one.
It is written in the same block that takes the interrupt handler off, so a run
that was stopped or that failed still reports what the rows it did reach cost.

## 6. What the line answers

- **Decode tokens per second** is the one number that survives the machine being
  busy, and the one to quote when a prompt change claims to be faster. A prompt
  that cuts output tokens shows up as fewer tokens at the same rate. A change
  that starved the GPU shows up as the same tokens at a lower rate. Wall clock
  cannot tell those apart.
- **The prompt eval share** says how much of the run went on reading rather than
  writing. `curation-cli` plan 0003 measured output tokens at three quarters of
  a row's model time from the outside, and this is that split measured by the
  thing doing the work.
- **Load time** should be a few seconds once, at the start of a run, and never
  again. A load time that grows with the run means the model is being unloaded
  between rows and `keep_alive` is not holding it, which today is invisible and
  reads as the server being slow for reasons of its own.
- **And the prefix cache across slots.** Ollama caches the prompt prefix by
  itself, and the system prompt is the prefix, which is why the two halves of a
  call are kept as two messages. Whether that cache survives four requests in
  flight across four server slots has never been checked. A run whose
  `promptTokens` sum is roughly the system prompt times the call count is a run
  where it does not, and the answer changes what a batched walk costs.

## 7. What is tested

Everything under `node --test`, with no server, as the rest of the library is.

- A fake `/api/chat` answering the six fields gives the expected `timings`, in
  milliseconds, with the raw prompt token count rather than the one the usage
  counters take the cached tokens off.
- The same reply accumulates into `usage.timings`, and two of them sum.
- A reply with no duration fields answers `timings: null` and leaves
  `usage.timings` absent, while still counting as a call in the five counters.
- `addUsage` with no third argument leaves the total exactly as it is today,
  which is the assertion that keeps the claude and Messages API engines valid.
- `addUsage` with timings on a total that has none creates the block. On a total
  that has one, it adds.
- The stderr line is asserted on its formatter: the rate, the percentage, the
  load in seconds, the call count, and `null` for a usage with no timings.

## 8. What this plan does not do

- **No timings from the other two adapters.** Anthropic reports no server side
  durations, so there is nothing to map. A wall clock measured by the client
  would be a different measurement wearing the same field names, which is worse
  than an empty field.
- **No per call history and no percentiles.** Sums and a count, which is what a
  rate needs. A run that wants the distribution wants a different artifact, and
  `report.json` is not it.
- **No change to the pool, to `askMany` or to the serialized server notice.**
  Those read the client's own clock to answer a question about the server's
  configuration, and they answer it well. This plan reads the server's clock to
  answer a question about the model, and the two do not meet.
