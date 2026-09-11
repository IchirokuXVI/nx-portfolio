> **PR:** [#332](https://github.com/IchirokuXVI/nx-portfolio/pull/332)

# 0001 One way to ask a model

Part of the curation toolchain: `curation-auth` (sessions),
`curation-suggestions` and `curation-groups` (the deciders), `curation-cli`
(the orchestrator a person runs), and backend plan 0100 (the bulk routes).
This library is the model half of that toolchain, taken out of `curation-cli`
and given a seam a second provider can arrive through.

## What this is

The one place that knows how to ask a model a question. Everything else in the
toolchain holds an engine and calls one method on it, and nothing else in the
workspace builds a model call by hand.

Today that code is `libs/luna-shopper/curation-cli/src/engine.mjs`, 524 lines
of which none is about curation: the `claude -p` spawn, the Messages API
request, the usage arithmetic, the backoff, the abort handling, and eight
paragraphs of measured billing behaviour. It sits in the orchestrator only
because the orchestrator was the first thing that needed it.

Two facts make that the wrong home now. The first is that a local Ollama is
next, and a third caller (leaflet reading is the obvious one) has to reach it
without importing the curation CLI. The second is that `cli.mjs` decides which
engine to build with `if (engineName !== 'claude' && engineName !== 'api')`, so
every new provider edits an argument parser, a help string, a default model
constant and an effort validator that are all in the wrong file.

## The contract

One method, and the whole library is arranged so that a caller cannot tell
which adapter it is holding.

```js
engine.ask(prompt, { system, schema }) -> { text }
```

- `prompt` is the user half and `system` is the standing half. The two are
  never joined by the caller: an adapter that can cache the standing half
  separately (the Messages API can) must be free to do it, and the reason the
  split exists at all is that the rules used to be paid for twice.
- `schema` is a JSON schema the reply must fit, or null. How that is enforced
  is the adapter's business: a flag, a request field, a synthetic tool. What
  the caller is promised is only that a schema was applied.
- The answer is `{ text }`. Parsing it is the caller's business, because the
  shape belongs to whoever wrote the prompt.
- `engine.name`, `engine.model` and `engine.effort` are readable, because the
  run reports what answered it.

Beside `ask`, the library owns four things every adapter needs and no adapter
writes twice:

- **Usage.** `emptyUsage()` and `addUsage(total, usage)`, in the five counters
  the reports already carry. The reader takes the Messages API's snake case,
  which the Claude Code envelope repeats. An adapter whose provider counts in
  its own words maps into these five and does not invent a sixth.
- **Retries.** One backoff loop, `[2s, 8s, 30s]`, shared. An attempt answers
  `{ ok: true, value }`, or `{ ok: false, error }` to be retried, or
  `{ ok: false, error, fatal: true }` to stop at once. That third case is not
  decoration: the Messages API adapter retries a 429 and a 5xx and refuses to
  retry a 401, and a shared loop that could not express the difference would
  spend thirty seconds proving a key is still wrong. The giving up message
  stays `The <name> engine gave up: <reason>.`
- **The stop signal.** Every adapter takes an `AbortSignal`, makes no further
  attempt once it is aborted, and fails with the signal's own reason rather
  than a message of its own. This is what makes one Ctrl+C in the orchestrator
  reach the call in flight, and the rule that a stop is recognised by asking
  the signal and never by reading an error string is what keeps it working.
- **`stripFence`.** A model that fenced its object is still answering.

**What an adapter never holds**: a gateway URL, a token, a slot number, a
row count, or anything else about the run. The model sees the prompt and the
system half. That rule is the reason the toolchain can rehearse against a
throwaway database, and it moves here unchanged.

## The registry

`--engine <name>` reads one table, and an entry is the whole of what a provider
is:

```js
{ name, defaultModel, effortLevels, gate, create }
```

- `defaultModel` per entry, because `claude-sonnet-5` is not a sensible default
  for a local Ollama and a single `DEFAULT_MODEL` constant would make it one.
- `effortLevels` per entry, because effort is a Claude idea. The CLI validates
  `--effort` against the entry it resolved rather than against a global list,
  and an entry that takes no effort says so with an empty list.
- `gate` is the confirmation an entry needs before it runs, or null. The
  Messages API entry names the `API_KEY` gate; the other two name nothing. The
  point is that `cli.mjs` stops asking `if (engineName === 'api')` and starts
  asking the entry.
- `create` builds the engine from the injected `spawn`, `fetch`, `env`, usage
  total and signal, so the whole library still runs under `node --test` with no
  network and no `claude` installed.

`ENGINE_NAMES` drives the argument check and the help text, so adding an
adapter cannot leave either stale.

## The two Claude adapters

Both move with their behaviour and their comments intact. Nothing here is
rewritten, redesigned or improved on the way across: every paragraph in that
file is a measurement someone paid for, and a plan that quietly drops one is
how the bill comes back.

**`claude` is the Claude Code CLI**, one spawn per call, and it is the default
because it bills the operator's logged in session. What travels with it:

- `MINIMAL_ARGS` and a scratch working directory with no `CLAUDE.md`. Both
  halves, because neither substitutes for the other: 45,805 input tokens for a
  one word reply becomes 24,034 with the flags alone, 23,244 with the scratch
  directory alone, and 2,546 with both.
- `--safe-mode`, which drops hooks, plugins and output styles while leaving
  session authentication alone. It is about the operator's own machine: a
  `SessionStart` hook that injects text was measured at 1,980 input tokens on
  every call.
- `TOOL_SHAPE_HINT`, sent **only when a schema is**. `--json-schema` is a
  synthetic `StructuredOutput` tool, a call whose arguments miss the schema
  costs a second billed request carrying the whole prompt again, and four
  sentences of instruction took that from five retries in six calls to none.
  It belongs to this adapter and not to a decider's `prompt.md`, because the
  Messages API adapter has no such tool and would be lying to the model.
- `claudeChildEnv`: `ANTHROPIC_API_KEY` deleted so a globally exported key
  cannot silently bill, one stderr notice when there was a key to ignore, and
  `DISABLE_PROMPT_CACHING` set because the CLI puts its cache breakpoint after
  the packet, so a run of different packets writes about 3,478 tokens a call at
  $4 per MTok and reads zero.
- `readClaudeEnvelope`, the 120 second timeout, and the kill on abort.
- **`--bare` stays out.** It looks like the one flag for all of the above and
  it also refuses OAuth and demands an API key, which is the billing this
  adapter exists to avoid.

**`api` is the raw Messages API**, behind the gate that is the reason it is not
the default: when `ANTHROPIC_API_KEY` is set the operator is told the run bills
that key and must type exactly `API_KEY`. Anything else, or no terminal to ask,
ends the run before a request is made. It is the adapter that caches properly,
because `cache_control` goes on the system block with the packet outside it.

## What `curation-cli` keeps

`engine.mjs` and `engine.test.mjs` are deleted, not left as re-exports. A file
that forwards is a second place to look and it will drift.

`cli.mjs` and `orchestrator.mjs` import from
`../../model-engines/src/index.mjs`. **A relative path, not a TS alias**: the
alias list is for browser reachable libraries, these are not, and Nx reads a
relative import across projects as a dependency all the same, exactly as the
deciders already import `curation-auth`. No `implicitDependencies` entry is
needed for it.

`curation-cli`'s own plan 0001 is not rewritten. It names the pull request that
built it and it records what was measured at the time; this plan is where the
engines went.

## Ollama comes next, in plan 0002

Not built here. It is named because the contract above is shaped by it, and
because a seam justified by a provider that never arrives is a seam that was
not needed. Four things it must not have to fight, which is the whole test of
whether this plan was right:

- a default model that is a Claude model,
- an effort level it does not have,
- a billing confirmation for a model running on the operator's own machine,
- a usage block in somebody else's field names.

If plan 0002 can be one new file and one new registry entry, this library is
correct. If it has to reach back into the contract, it is not.

## Decisions

- **Zero npm dependencies, ESM `.mjs`, never browser reachable**, an Nx project
  with `lint` and `node --test` targets, like every other library in this
  toolchain. An HTTP call is `fetch` and a process is `node:child_process`.
- **The name is `libs/luna-shopper/model-engines`**, and it does not carry the
  `curation-` prefix its four siblings do, because the first caller is not the
  only intended one.
- **The flag values stay `claude` and `api`.** They are in a shipped help text
  and in a manual smoke procedure, and renaming them buys nothing that the
  registry does not already give.
- **Behaviour parity is the acceptance test.** Every case in today's
  `engine.test.mjs` moves and still passes, against the same assertions. A
  refactor that changes what a call sends is a different plan.

## Verification

`node --test`, everything injected, no network and no `claude` binary:

- the contract: the retry loop retries, gives up with the last reason, stops at
  a fatal attempt without waiting, and makes no further attempt once the signal
  is aborted, failing with the signal's own reason;
- the usage counters, including a reply that carried no usage at all;
- the Claude CLI adapter: the rules arrive as `--system-prompt` and never as
  `--append-system-prompt`, the packet is the whole of stdin, the hint travels
  with a schema and with nothing else, the key is deleted from the child
  environment and announced once, caching is disabled, the envelope is read and
  its three failure shapes are refused;
- the Messages API adapter: the cached system block, the schema through
  `output_config`, no mention of a tool it does not have, a 429 and a 5xx
  retried, a 401 not retried, the signal handed to the request;
- the gate: the exact word accepted, six near misses refused, no terminal
  refused without asking, a missing key refused;
- the registry: every name resolves, an unknown name is refused by a message
  that lists the names there are, each entry's default model and effort levels
  are the ones the CLI then applies, and an entry with no gate is not asked to
  confirm anything;
- `curation-cli`'s own suites still pass unchanged, which is what proves the
  move was a move.

The live smoke run stays what it is: manual, documented at the top of
`curation-cli/src/cli.mjs`, and run once against a real `claude` before this is
called done.
