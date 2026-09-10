> **PR:** [#333](https://github.com/IchirokuXVI/nx-portfolio/pull/333)

# 0002 A model on the machine that asked

The third engine, `--engine ollama`, against a local [Ollama](https://ollama.com)
server. Plan 0001 built the seam and named this plan as the thing that proves it
was the right shape, so this plan is two claims at once: an adapter, and the
answer to whether the library that was built for it needs changing to take it.

It does not. Everything below is one new file, `src/ollama.mjs`, and one new row
in `ENGINES`. The contract is unchanged, and no source file in `curation-cli` is
touched: the help text, the `--engine` check, the `--effort` refusal and
`entry.create` all read the registry and take the new row without a word.

**One test in `curation-cli` did have to change, and it is worth saying why**,
because a plan that claims a clean seam and then quietly edits the neighbour is a
plan that cannot be checked. `cli.test.mjs` asserted the refusal sentence
`Unknown engine sdk. It is claude or api.` in full. That sentence is built by
`listNames(ENGINE_NAMES)`, which enumerates the registry, so any third row
changes it and no version of "one new entry" leaves it alone. `registry.test.mjs`
already asserts the same sentence, where it belongs. So the assertion in
`cli.test.mjs` is relaxed to `Unknown engine sdk.` rather than restated, since
what that test is for is the line under it: nothing was spawned. Duplicated
coverage in the wrong project, not a wrong seam, and it is fixed in the direction
that stops a fourth engine hitting it again.

## Why a third engine

The two Claude adapters both cost money for a decision that is mostly clerical.
A real curation run was measured on 2026-09-09: 188 rows, sonnet 5, 9.09M input
tokens, worth $26.60 on a key, of which the packets themselves were 483K. The
work is a lookup table applied to one packet, and it is worth asking whether it
has to be paid for at all.

An Ollama server also removes the two things that make a `claude -p` run awkward
to reason about: there is no envelope, no harness prompt, no hook, no plugin and
no session, so the tokens the model reads are the tokens the caller wrote.

## What was measured

Everything in this plan comes from a live server, Ollama 0.34.0 on Windows,
`gemma4:12b` (11.9B parameters, Q4_K_M, the model's own context length 262,144),
freshly installed with default settings. The numbers are from that machine and
another one will answer differently in speed, but the shapes and the field names
are the server's and are not machine specific.

**The real prompt was run, not a stand in.** `buildSystemPrompt` and
`buildDecisionSchema` from `curation-suggestions`, over the committed
vocabularies (12 categories, 6 units), giving a 9,632 character system prompt and
a 965 character schema, with packets from `buildEntryPacket`.

Eight rows were written by hand, each one a rule the curation prompt states, and
each with the decision a careful curator makes:

| Row                                           | Wanted        | Answered   |
| --------------------------------------------- | ------------- | ---------- |
| a private label of another chain (rule 6)     | CREATE/REVIEW | CREATE     |
| same brand and same format                    | LINK          | LINK       |
| a different format is a different product     | CREATE/REVIEW | CREATE     |
| an EAN match                                  | LINK          | LINK       |
| nothing to link to, and the product is plain  | CREATE        | CREATE     |
| an unreadable promotional name                | REVIEW        | REVIEW     |
| a run created candidate, nameable only by ref | LINK (ref)    | LINK (ref) |
| a near name under a different brand           | CREATE/REVIEW | CREATE     |

Eight of eight, including the one that catches a model reaching for an id that
does not exist yet: the run created candidate was named by `ref-1` and not by an
invented `itemId`. Every reply was schema valid JSON with no fence and no
wrapper.

**That is not an agreement rate and must not be read as one.** Sonnet 5 was
measured at 83% auto decided and haiku 4.5 at 63%, both over real queue rows, and
eight rows chosen by the person writing the plan cannot be compared with that.
What the eight rows establish is narrower and is still worth having: the model
holds the schema, follows the stated rules on the cases they were written for,
and does not invent identifiers. Whether it is good enough to run a queue with is
a measurement this plan schedules and does not claim (see Verification).

Speed and cost, on the same eight rows: **2,483 ms per row** warm, 24,310 prompt
tokens of which **20,300 were read from cache**, 901 output tokens. A cold model
load is a separate 4.8 to 6.9 seconds. At that rate the 188 row run that cost
$26.60 is about eight minutes and costs nothing.

## The request

`POST {host}/api/chat`, one object, `stream: false`, and the reply's
`message.content` is the `{ text }` the contract promises.

```js
{
  model,
  stream: false,
  think: false,              // only when the model declares thinking
  format: schema,            // only when the caller passed one
  keep_alive: '30m',
  options: { num_ctx, temperature: 0 },
  messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
}
```

Six things in that object are decisions, and all six were measured.

**`host` comes from `OLLAMA_HOST`, or `http://localhost:11434`.** That variable
is Ollama's own and its value is written both as a URL and bare as `host:port`,
so the adapter adds the scheme when there is none rather than failing on a value
the operator copied out of Ollama's own documentation. `env` already reaches
`create`, so nothing new is threaded to get it.

**The two halves stay two messages.** `system` is the system message and the
packet is the user message, which is the split the contract already requires. It
pays for itself here as it does on the Messages API, for a different reason:
Ollama caches the prompt prefix by itself, with no request field and no
`cache_control`, and the system prompt is the prefix. Measured over the eight
rows, the first call read nothing from cache and every later one read 2,900
tokens, which is the whole system prompt. Joining the two halves into one string
would put the packet inside the prefix and lose it on every row.

**`think: false`, and only when the model can think.** `gemma4:12b` reasons by
default and puts the reasoning in `message.thinking`, so the answer is not
polluted, but it is billed in time: 67 output tokens to answer "Ok" against 3
with thinking off. A curation decision is a lookup and the deciders do not read a
reasoning field. The condition on the flag matters because Ollama refuses `think`
on a model that does not support it, and the operator's model is their choice.

**The model is asked what it is, once.** `POST {host}/api/show` answers
`capabilities` (measured: `completion`, `vision`, `audio`, `tools`, `thinking`)
and `model_info["<family>.context_length"]` (measured: 262,144). One request
answers both the thinking question and the context question, and it runs **on the
first `ask`, not in `create`**, because `create` is synchronous for the two
adapters that already exist and making it async to suit a third would be exactly
the reaching back into the contract that plan 0001 said must not happen. The
answer is held for the life of the engine.

**`temperature: 0`.** A curation row has one right answer and a rerun of it
gives the same one.

**`keep_alive: '30m'`, and one `num_ctx` for the whole run.** A cold load was
measured at 4.8 to 6.9 seconds against 2.5 seconds for a decision, and a model
left alone unloads itself. Worse, **a changed `num_ctx` reloads the model**:
measured at 1 ms of load for a repeated value and 4,495 ms the moment the value
changed, and 4,463 ms changing it back. A run that varied the window per row
would spend more time loading the model than deciding with it.

## The context window, which truncates in silence

This is the finding the adapter is built around.

A 127,651 character prompt, about 35,000 tokens, was sent to the default server
with a marker word in its first line and a question about that word at the end.
The reply named a different word, with `done_reason: "stop"`, no warning, and
`prompt_eval_count: 2051`. The same prompt with `options: { num_ctx: 65536 }`
evaluated 48,426 tokens and answered correctly.

Ollama's default context window is small, it drops the front of an oversized
prompt, and the reply that comes back is a confident wrong answer that is
indistinguishable from a right one. Applied to curation, that is a decision made
without the rules, since the rules are the front of the prompt.

Two rules follow.

**The adapter always sends `options.num_ctx` and never inherits the server
default.** The value is the smaller of the model's own context length, read from
`/api/show`, and a ceiling, because a 262,144 token window on a 12B model asks
for more memory than the machine has. The ceiling is 16,384 by default, which is
five times the largest real prompt measured here, and `OLLAMA_NUM_CTX` overrides
it for an operator with a longer packet or a smaller machine.

**And the adapter checks, because a setting can still be wrong.** Ollama
publishes no tokenizer endpoint and reports no truncation flag, so there is no
exact check to make. There is a sound one sided one. Text in this workload runs
at about 2.6 to 3.3 characters per token, measured at both ends of the range
(127,651 characters to 48,426 tokens; 10,163 characters to 3,080 tokens), so a
prompt of N characters cannot honestly evaluate to fewer than N/6 tokens. A reply
whose `prompt_eval_count` is below that floor is refused as truncated, **fatally
and with no retry**, because the same request truncates the same way, and the
refusal names `OLLAMA_NUM_CTX`. The floor cannot fire on an honest reply at that
margin, and it caught the measured case by an order of magnitude: 2,051 against a
floor of 21,275.

A guess that is wrong in the safe direction is the point. The cost of a floor set
too low is a truncation that slips through, which is the behaviour there is
today; the cost of one set too high is a refusal on a good reply, which is worse,
so the margin is generous on purpose.

## The schema, and the hint that must not travel

The schema goes in `format`, as the JSON schema itself, and the reply comes back
as a bare JSON object. Measured against the real 965 character decision schema:
union types (`type: ["string", "null"]`) hold, an `enum` that includes `null`
holds, and the object came back unfenced every time.

**`TOOL_SHAPE_HINT` is not sent**, for the same reason the Messages API adapter
does not send it: there is no synthetic `StructuredOutput` tool here, no tool call
to mis-serialize, and no second billed request to prevent. Telling this model to
pass fields as top level arguments of a tool call would be describing a mechanism
it is not using.

`stripFence` still runs over the answer. It costs nothing, it is the library's
own, and a model that fenced its object is still answering.

## Failures, and which of them are worth waiting for

The shared retry loop is the one in `retry.mjs` and the giving up message stays
`The ollama engine gave up: <reason>.` What this adapter contributes is the
classification, and two of the four are fatal on purpose.

| Failure                                     | Answer                                    |
| ------------------------------------------- | ----------------------------------------- |
| HTTP 404, `{"error":"model 'x' not found"}` | fatal, naming `ollama pull <model>`       |
| the connection is refused                   | fatal, naming the host and `ollama serve` |
| HTTP 5xx                                    | retried                                   |
| a truncated prompt (above)                  | fatal, naming `OLLAMA_NUM_CTX`            |
| the reply carried no `message.content`      | retried                                   |

The two fatal ones are the same argument plan 0001 made about a 401: a model that
is not pulled and a server that is not running are the same answer forty seconds
later, and a loop that could not say so would spend the backoff proving it.
Measured shapes: the 404 body is exactly `{"error":"model 'nope:1b' not found"}`,
and a refused connection is `TypeError: fetch failed` with `cause.code` of
`ECONNREFUSED`.

**An abort is recognised by asking the signal and never by reading the error.**
This is a rule the library already has and it matters more here than anywhere
else, because an aborted `fetch` and a refused connection both arrive as a
`TypeError`. A stop that was misread as a connection failure would be reported as
"is Ollama running?" to somebody who pressed Ctrl+C.

## Usage, in the five counters and no sixth

Ollama counts in its own three fields, and the mapping is not a rename, because
the two providers mean different things by the input count.

| Counter                    | From                                                     |
| -------------------------- | -------------------------------------------------------- |
| `inputTokens`              | `prompt_eval_count` **minus** `prompt_eval_cached_count` |
| `cacheReadInputTokens`     | `prompt_eval_cached_count`                               |
| `outputTokens`             | `eval_count`                                             |
| `cacheCreationInputTokens` | 0, always                                                |
| `calls`                    | one per reply, by `addUsage`                             |

The subtraction is the whole of it. **`prompt_eval_count` includes the cached
tokens** and Anthropic's `input_tokens` excludes `cache_read_input_tokens`, so
adding the raw field would count the system prompt twice on every row after the
first. It was checked by arithmetic on a measured reply: 2,993 prompt tokens of
which 2,900 cached, against a 9,632 character system prompt and a 319 character
packet, which is the system prompt cached whole and the packet read fresh.

`cacheCreationInputTokens` is zero rather than absent because Ollama neither
charges for filling its cache nor reports a number for it, and inventing one to
fill the field would be a number nothing measured.

## The registry entry

```js
{
  name: 'ollama',
  defaultModel: 'gemma4:12b',
  defaultEffort: null,
  effortLevels: [],
  gate: null,
  create: ({ fetchImpl, env, model, usage, signal }) => makeOllamaEngine({ ... }),
}
```

This is plan 0001's own test, and each line is one of the four things it said an
Ollama entry must not have to fight.

- **`defaultModel` is not a Claude model.** It is `gemma4:12b`, the model this
  plan was measured on. Unlike the Claude default it names something the operator
  must have pulled, which is why the 404 is fatal and names `ollama pull`.
- **`effortLevels` is empty and `defaultEffort` is null.** Effort is a Claude
  idea. `cli.mjs` already answers `The ollama engine takes no --effort.` from the
  empty list, `usageText` already prints `no effort levels`, and
  `registry.test.mjs` already asserts that an empty list pairs with a null
  default. Three files that would have needed editing need nothing.
- **`gate` is null.** There is no billing to confirm for a model running on the
  operator's own machine, and an entry with no gate is asked nothing.
- **The usage block is mapped, above.**

`engine.effort` reads null and the run reports it as null, which is true: nothing
was asked of a knob this provider does not have.

## What this is not

**It is not vision.** `gemma4:12b` declares `vision` and `audio`, and leaflet
reading is the caller that would want them, but `ask(prompt, { system, schema })`
has no slot for an image and adding one is a change to the contract, which is the
one thing this plan exists to avoid making. An engine that takes images is a
plan 0003, and it is a plan about the contract before it is a plan about Ollama.

**It is not tool use, and it is not streaming.** The contract answers `{ text }`.

**It is not a claim that a local model is the right default.** `DEFAULT_ENGINE`
stays `claude`. This adds a third name to `--engine`, and which one a run is worth
driving with is decided by the measurement below and not by this plan.

## Decisions

- **Zero npm dependencies.** An HTTP call is `fetch`, exactly as
  `messages-api.mjs` does it, and `fetchImpl` stays the injected test seam so the
  whole suite runs with no server. There is no `ollama` npm package here.
- **One new file and one new registry row, and that is the acceptance test.** If
  anything under `curation-cli` has to change, or the contract does, then plan
  0001's seam was wrong and that is the finding worth writing down rather than
  working around.
- **The knobs are two environment variables, `OLLAMA_HOST` and `OLLAMA_NUM_CTX`,
  and no new flags.** `--model` already reaches the entry. A local model has many
  more knobs than these two and the ones chosen are the two that change whether an
  answer is correct rather than how it reads.

## Verification

`node --test`, `fetchImpl` injected, no server:

- the request: the two halves arrive as two messages and are never joined, the
  schema arrives as `format` and nothing arrives as a tool hint, `stream` is
  false, `temperature` is 0, `keep_alive` is sent, and `num_ctx` is the same value
  on every call of one engine;
- the probe: `/api/show` is asked once and not once per call, `think: false`
  travels for a model whose capabilities list thinking and is absent for one whose
  do not, and `num_ctx` is the model's own context length when it is under the
  ceiling and the ceiling when it is over;
- the host: the default, a URL in `OLLAMA_HOST`, and a bare `host:port` in
  `OLLAMA_HOST` all reach the same address;
- usage: the subtraction, checked on a reply where `prompt_eval_cached_count` is
  most of `prompt_eval_count`, a reply that reports no counts at all, and
  `cacheCreationInputTokens` staying zero;
- truncation: a reply under the character floor is refused, fatally, with a
  message naming `OLLAMA_NUM_CTX`, and a reply just over the floor is accepted;
- failures: a 404 and a refused connection are fatal and their messages name the
  fix, a 500 is retried, a reply with no content is retried, and an abort is
  reported as the signal's own reason and not as a connection failure;
- the registry: `ollama` resolves, `--effort` is refused against the empty list,
  the help text lists it, and the entry is asked to confirm nothing;
- every existing suite in `model-engines` and `curation-cli` passes, with the one
  assertion named at the top of this plan relaxed and nothing else edited, which
  is what proves the addition was an addition.

**And one measurement that is not a unit test.** Before this is called done, a
real queue is worked with `--engine ollama` against a rehearsal slot, and the
agreement rate is recorded here beside sonnet 5's 83% and haiku 4.5's 63%. Eight
hand written rows say the model can hold the schema and the rules. They do not
say it can work the queue, and the number that says so is cheap to get once the
engine exists.
