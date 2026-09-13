> **PR:** [#356](https://github.com/IchirokuXVI/nx-portfolio/pull/356)

# 0003 The walk against a model on this machine

Plan 0002 made the walk ask several rows at once. This one is what a day of
running it against a local model said about the rest of the cost. Nothing here
changes what a decision means. Every item is either time the run spends without
buying anything, or a defect of one model that the tool can refuse for itself.

## What was measured

Two runs, both against the real Mercadona and SuperCash queues, with
`gemma4:12b` on a local Ollama server (RTX 4080 SUPER, 16 GB) and
`claude-sonnet-5` beside it for comparison.

**Forty rows, four in flight.**

- Batching is the whole of the speed, and several products in one prompt is not.
  Four single product requests in flight took 116 seconds. Four products per
  prompt took 148 to 185 seconds. Sonnet took 352 seconds.
- The batch only pays when the server runs `OLLAMA_NUM_PARALLEL` at or above
  `OLLAMA_BATCH`. The server used for the first weeks of measurement ran
  `OLLAMA_NUM_PARALLEL=1`, so batching gained 6% instead of 2.2x, and nothing in
  the tool said so.
- Output tokens are three quarters of a row's model time. `reasoning` and the
  `issues[].detail` strings are about a third of the output tokens.
- The decider is about 15% of the walk at four in flight.
- Precision errors are systematic rather than random. A range word of a private
  label is written as the brand (`+Proteínas` where sonnet writes `Hacendado`)
  on 3 rows of 40. Range words are dropped from names (`Ensaladilla` for
  `Ensaladilla Delicias del mar`). About once per 40 rows a digit appears inside
  a word: `fres1a`, `may1onesa`, `Beb1ida`.
- Confidence is a stuck 0.95.

**Eighty rows, eight in flight, one product per request.** Of 111 requests, 28
were re-asks that the decider had refused with `MODEL_OUTPUT_INVALID: a CREATE
needs an "item" object` or `a LINK needs an "itemId" or an "itemRef"`. Six rows
still ended as REVIEW carrying that code after the one retry. That is a quarter
of the model time and six rows lost to the shape of the answer rather than to a
judgment.

## The eight changes

### 1. The server side is documented, and a serialized server is named

`OLLAMA_BATCH` is a client knob. Ollama answers `OLLAMA_NUM_PARALLEL` requests
at a time and queues the rest, so a batch of four against a server with one slot
is four requests run end to end. Nothing in Ollama's API reports the running
value, and the two knobs belong to two machines.

So the adapter measures the first round, which is the one round every request of
starts at the same moment, and writes one line to stderr when the round came
back as a staircase. `looksSerialized` asks two things and needs both: the
slowest request took at least `N - 0.5` times the fastest, and the finish times
are spread in steps rather than bunched. A ratio alone is met by one genuinely
long row among short ones. A spread alone is met by a parallel server whose rows
differ in length. The line names `OLLAMA_NUM_PARALLEL`, says how to set it on
Windows, and names `%LOCALAPPDATA%\Ollama\server.log`, where the running value
is printed at start. It is written at most once per engine.

The same is stated in the JSDoc of `makeOllamaEngine`, where the four knobs are
documented, and in the CLI usage text, which is where an operator looks.

### 2. The answer is shorter

`reasoning` is capped at 160 characters and one issue's `detail` at 120, in the
schema and again in the prompt. The worked examples in `prompt.md` are rewritten
to the length they ask for, because the examples are what a model imitates.

Nothing reads either field as prose. They reach `decisions.jsonl`, and for a
REVIEW the report an operator scans. Neither reaches the admin queue, the
gateway or `buildOperations`, which was checked before the cap was chosen.

The cap is stated twice because a schema `maxLength` is enforced by some
providers and treated as advice by others. Neither is load bearing: a long
answer is a valid answer and is recorded as one.

### 3. The line name and the shade code stay in the name

The brand leaves the name, by rule 2. A line or range name and a shade or
variant code stay in it, by rule 4. They are what tells two products of one
brand and one format apart, and rule 1 merges anything they do not separate.

This is a correctness defect and not a matter of style, which the cosmetics
queue is what made plain. On 80 SuperCash rows gemma keeps the brand and drops
both the line and the shade: `Sombra dúo SHOW BY PASTEL Monochrome n30` becomes
`Sombra dúo`, `Polvos compactos GUERLAIN Terracotta Original n03` becomes
`Polvos compactos`, `Corrector GUERLAIN Terracotta n4N` becomes `Corrector`.
Sonnet keeps `Sombra dúo Monochrome n30`, `Polvos compactos Terracotta Original
n03` and `Corrector Terracotta n4N`. Under rule 1 every shade of a line would
then be one product.

The rule is a few lines of `prompt.md` with one grocery example and two
cosmetics ones, because it reads differently on each queue: on groceries the
dropped word is a range of the house label (`+Proteínas`, `Delicias del mar`),
on cosmetics it is a line plus a code (`Terracotta`, `n4N`).

### 4. A digit inside a word is refused, and the row is asked again

`NAME_GLITCH`, raised by `validateDecision` when `nameEs` or `nameEn` carries a
digit inside a word: two letters before it and at least one after.

**The shape is what tells a glitch from a shade code, and the shade code has to
survive.** `n4N` is letter, digit, letter, so the obvious pattern would refuse
every cosmetics row on the queue and refuse exactly the thing item 3 is fighting
to keep. A code is a short prefix and then digits (`n4N`, `n30`, `spf25`, `H2O`,
`B12`), so one letter before the digit never accuses anything. A glitch lands in
the middle of a word that was already several letters long. `H2O`, `CO2` and
`O2` are on an allowlist as well, as the second lock rather than the first.

It is the one validator whose issue is retryable. Every other one reports a
judgment the model stands by, and asking again gets the same answer, so the row
goes to a person. A glitch is the generation going wrong for one token, and the
same row asked again comes back spelled correctly. So `decide` answers
`retryable: true` and writes nothing, exactly as it does for a reply that will
not parse, and `--final` records a second glitch as a REVIEW carrying the code.
`RETRYABLE_ISSUE_CODES` is the list, and it has one member.

### 5. Generation is capped

`options.num_predict` is 1024 by default and `OLLAMA_NUM_PREDICT` moves it.
Ollama generates without a limit by default, which is not a safe setting for a
pool: one reply that loops holds a server slot for as long as the model keeps
writing, and on a four slot server that is a quarter of the machine. A curation
decision is a few hundred tokens, so the ceiling is only ever reached by a reply
that has already gone wrong, and a truncated reply is not one JSON object, so it
is asked again and then recorded as a REVIEW.

### 6. The decider is not prefetched, and this is why

The idea was to fetch the next batch while the current batch's model requests
are in flight, so the decider's `next` does not sit between rounds. It is
refused. It does not make a row stale, which the toolchain already handles. It
makes the run wrong, in three ways at once:

- **`next` filters on `state.decidedIds`, which the current batch has not
  written yet.** So the prefetch hands out the rows that are in flight a second
  time. The second `decide` for one of them throws "already in the decisions
  file" and the run dies.
- **`next` replaces `handouts` outright**, so the prefetch erases the candidate
  sets the current batch was handed. `decide` reads `handouts[entryId]`, finds
  nothing, and skips the staleness check altogether. That check is plan 0002's
  correctness argument, and it would be silently off.
- **`next` and `decide` are separate child processes** doing read, modify and
  write on one state file. Overlapping them loses whichever write lands first.

Every one of these is in `curation-suggestions`, and none is a small fix: the
first two are the decider's statelessness between invocations, which is what
makes a killed run resumable. Overlapping the decider is worth about 15% of the
walk and it needs a plan of its own, against a decider that hands out a batch
and records the handout under a batch id rather than under one map per run.

### 7. `--limit <n>`

Stop handing rows to the model after `n` of them, finish what is in flight, and
end the run normally. It is not a stop: the report is written, the slot comes
down, the exit code is 0, and the decisions file is a file `--apply` takes.

It narrows the batch it asks for rather than trimming one it already fetched,
because a fetched row carries a handout the decider is holding open and nothing
would ever close it.

A short run over the front of a real queue is how the toolchain is measured and
how a prompt change is judged. Until now every harness that wanted one capped
the rows itself, outside the CLI.

### 8. The shape of a decision is enforced at the grammar level

This is the largest lever measured, and it is item 9 of the change set rather
than a rewrite of the others.

`buildDecisionSchema` used to declare every field optional and nullable: `item`
was `["object", "null"]`, `itemId` was `["string", "null"]`, and neither was in
`required`. So `{"decision":"CREATE","item":null}` was a legal token stream,
and the model produced it 28 times in 111 requests.

The root keeps every field it has today, so an engine that reads no `anyOf` is
exactly as well off as it was. Beside it the root now carries an `anyOf` of the
four shapes a decision can take, discriminated on `decision` as a `const`:

| Shape  | Requires                                                                               |
| ------ | -------------------------------------------------------------------------------------- |
| CREATE | `item`, an object, with the three fields `checkDecisionShape` refuses a CREATE without |
| LINK   | `itemId`, a string                                                                     |
| LINK   | `itemRef`, a string                                                                    |
| REVIEW | neither                                                                                |

A LINK names exactly one target, so the two ways of naming one are two
alternatives rather than two optional fields.

`anyOf` and not `oneOf`, because Anthropic's structured outputs take `anyOf` and
llama.cpp, which is what Ollama converts a schema with, reads the two as the
same alternation. `anyOf` and not `if`/`then`, which says this more directly and
which llama.cpp does not support. llama.cpp checks for `anyOf` before it checks
for `properties`, which is what makes the root safe to leave as it is: the
grammar is built from the alternatives and the root's loose types are ignored.

`checkDecisionShape` is unchanged and is now strictly looser than the schema, so
no answer it accepts has become unanswerable.

## Where each piece lives

**`model-engines`** owns items 1 and 5, and nothing in either knows what
curation is. `looksSerialized` and `serializedNotice` are exported and pure, and
the clock `askMany` times the first round on is injected.

**`curation-suggestions`** owns items 2, 3, 4 and 8, because it owns the prompt,
the schema and the validators, and those three have to keep agreeing.

**`curation-cli`** owns item 7, and would have owned item 6.

## Verification

`node --test`, everything injected, no network, no Docker and no model:

- the staircase: a first round with durations `d, 2d, 3d, 4d` from one start is
  named once per engine, a round that finished together is not named at all, one
  long row among short ones is not named, and a batch of one is never named;
- `num_predict` is on every request body, `OLLAMA_NUM_PREDICT` moves it, and a
  value that cannot be read is the ceiling rather than an unlimited request;
- `carriesGlitch` fires on `May1onesa` and not on `Omega 3`, `B12`, `H2O`,
  `n4N`, `n30` or `spf25`;
- the prompt names one grocery example and two cosmetics ones of a line name
  and a shade code kept in the name;
- a glitched name answers `retryable: true`, writes nothing to the rehearsal
  catalog and records nothing, and `--final` records a REVIEW carrying
  `NAME_GLITCH`;
- the schema uses only the keywords llama.cpp's converter understands, which is
  asserted as a set so that a later edit reaching for `if`/`then` is caught
  here rather than by a run that quietly stops constraining anything;
- every decision `checkDecisionShape` accepts validates against the built
  schema, and a CREATE with `item: null`, a CREATE missing one of the three
  required item fields, and a LINK naming no target all fail it;
- `--limit` asks one batch of four and ends, narrows the last batch to the rows
  it has left rather than fetching four and trimming, treats a limit past the
  end of the queue as the whole queue, and changes nothing when it is absent;
- `--limit` with no value, with a fraction or with a word is refused before a
  slot is taken.

**And one live run**, which is the only thing that can answer whether the
schema change bought what the count predicts. The same eighty row queue, the
same eight in flight, comparing the re-ask count and the REVIEW count against
the 28 and the 6 above.
