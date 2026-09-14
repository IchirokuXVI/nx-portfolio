> **PR:** [#361](https://github.com/IchirokuXVI/nx-portfolio/pull/361)

# 0002 One decider process for the whole walk

Plan 0001 made every subcommand a fresh Node process. That is what makes a
killed run resumable, and it is also about 15% of the walk. This plan keeps the
statelessness and removes the process starts: the decider gains a long lived
mode, and `curation-cli` drives one child for a whole run instead of one child
per step. Nothing about what a decision means changes, nothing about what is
written to disk changes, and the orchestrator is not touched.

## The brief

Build two things and change one.

1. **`serve`, a new entry point of both decider CLIs.** It reads one JSON
   request per line on stdin, calls the same command function the one shot path
   calls, and writes one JSON answer per line on stdout. The loop lives in
   `curation-suggestions/src/serve.mjs`, `cli.mjs` dispatches to it, and
   `curation-groups` gets the twin of both. `commands.mjs` is not edited at all,
   in either library.
2. **A channel in `curation-cli/src/decider.mjs`.** `makeDecider` starts the
   child on its first call, writes a request line per call, matches the answer
   by id, and closes the child at `end` (and from `cli.mjs` on any other way out
   of a run).
3. The injected `spawn` of `makeDecider` becomes an injected `startChild`. It is
   the one shape change, and it stays inside `decider.mjs` and `cli.mjs`.

What must not move: the five per command entry points, the order of the writes
inside a command, the `{ start, next, decide, end, apply }` interface
`makeDecider` answers with, and the staleness and handout semantics of
`commands.mjs`.

## Why this is the safe part of the 15%

Plan 0003 of `curation-cli` measured the decider at about 15% of an eighty row
walk with four requests in flight, and item 6 of it refused the obvious fix.
Prefetching the next batch while the current one is in flight makes the run
wrong in three ways: `next` filters on `state.decidedIds`, which the batch in
flight has not written yet; `next` replaces `handouts` outright, which turns the
staleness check off; and two commands doing read, modify and write on one state
file lose whichever write lands first.

None of those three is about the process. They are about two commands being in
flight at once, and this plan puts no two commands in flight at once. The walk
still asks `next`, waits, decides each row in order, and asks `next` again. What
it stops doing is starting a Node process, loading `commands.mjs`, `rules.mjs`,
`decision.mjs`, `packet.mjs` and the vocabularies, and tearing it all down, a
hundred times per eighty rows. At roughly 200 ms a start that is about 20
seconds of a 205 second walk, which is the right size to be most of the 15%.

So the ordering argument of plan 0002 of `curation-cli` survives untouched: at
the moment row k is recorded, the rehearsal catalog holds the creations of the
rows before it, because the commands still run one after another and each one
still reads and rewrites the state file.

## The protocol

One JSON object per line, in both directions. A request:

```json
{
  "id": 3,
  "command": "decide",
  "args": ["--run-dir", "/runs/x", "--entry", "e1"],
  "input": "{\"decision\":\"LINK\"}"
}
```

`args` is the flag list the one shot command line would carry, without the
command word and without the node path. `input` is the text the one shot path
would have read from stdin, and only `decide` carries it. The answer:

```json
{ "id": 3, "answer": { "accepted": true, "retryable": false, "remaining": 17 } }
```

or, when the command threw:

```json
{ "id": 3, "error": "the decision on stdin is not JSON: Unexpected token o" }
```

**The answer is nested under `answer` rather than spread into the line.** A
spread would put the correlation id in the same namespace as the command's own
fields, and a command that one day answers an `id` of its own would silently
overwrite it. The nesting costs one dereference in the channel and buys a
protocol that cannot collide with the thing it carries.

**The id is the channel's, not the caller's.** It counts up from one inside
`makeDecider`, and a caller never sees it. An answer whose id names no pending
call is ignored, which is the same tolerance `readAnswer` has always had for
noise: the child may write progress to stderr, and a line on stdout that is not
a JSON object carrying a pending id is not an answer.

**Requests are answered in order** because the serve loop chains them on one
promise. That is not a multiplexer and is not meant to become one: the
orchestrator sends one request at a time, the id exists to match an answer to
the call that asked for it, and plan 0003 item 6 is why nothing is allowed to
overlap.

## How a dead child is surfaced

`serve` exits when its stdin closes, and only then. Anything else is a failure,
and the channel treats it as one:

- Every call still waiting is rejected with an error naming the exit code and
  the tail of what the child wrote to stderr.
- Every later call is rejected with the same error, immediately, without writing
  to a pipe nobody is reading.
- The message keeps the shape the one shot path had, `<command> failed: ...`, so
  the orchestrator's existing failure path handles it exactly as it handled a
  non-zero exit.

**A stop is still recognized by asking the signal, never by reading an error.**
Ctrl+C reaches the whole terminal, so the serve child dies of the same keystroke
the run did, and the call in flight rejects. The orchestrator already asks
`signal.aborted` before it decides whether that rejection was a failure or the
stop, and it keeps doing so.

The stderr tail is kept as a rolling buffer of the last few thousand characters
rather than the whole of it, because a long run's diagnostics are unbounded and
what a failure needs is the end.

## What closes the child

`end` closes it: the report is the last thing a run asks for. The close ends the
child's stdin, which ends the serve loop, and kills the child if it has not
exited after a grace period, so a wedged decider cannot keep the orchestrator
alive.

A run that never reaches `end` closes it from `cli.mjs`, in the same `finally`
that releases the interrupt handler. The orchestrator is not edited and does not
know the child exists: it asks `makeDeciderFor` for a decider and never disposes
of one, so disposal belongs to the thing that built it. `close` is idempotent,
so the two paths cannot fight.

`--apply` is one call and then the process ends, and it closes the child the
same way.

## The one behaviour the channel has to reproduce

A refused `apply` answers `{ applied: false, ... }` and exits 2, and the one
shot channel turned any non-zero exit into a throw. So a refused replay throws
today, out of `decider.apply`, carrying the JSON. There are no exit codes inside
a serve session, so `decider.apply` reads `applied === false` and throws the
same error itself. It is written down here because it is an accident of the exit
code that became the contract, and a reader of `apply` would otherwise take the
throw for a bug.

## The legacy path is removed, not kept beside it

`makeDecider` takes `startChild` and no longer takes `spawn`. The one shot
subcommands keep working, because they are `cli.mjs`'s own entry points and
nothing about them changes: a person poking at the decider by hand, and every
test in `curation-suggestions`, calls `run(['next', '--run-dir', ...])` exactly
as before. What is gone is the second way for `curation-cli` to drive them.

Keeping both would mean two code paths that can disagree about what an error
looks like, tested in one and used in the other. `spawnCapture` itself stays: it
is what the engines and `slots.mjs` are driven with, and they are genuinely one
shot.

## Where each piece lives

**`curation-suggestions`** owns `serve.mjs` and the three lines of `cli.mjs`
that dispatch to it. The loop is handed `run` as an argument rather than
importing it, so the two files do not form an import cycle.

**`curation-cli`** owns the channel in `decider.mjs`, the `spawnChild` default
in `cli.mjs`, and the `close` in the run's `finally`. `orchestrator.mjs` is not
edited.

**`curation-groups`** gets `serve.mjs` and the same dispatch line, and it is not
optional. `makeDecider` starts whatever CLI its path names, so once the driver
speaks only the line protocol a decider without the loop answers nothing at all:
`--implementation groups` would hang on its first call.

**Its `serve.mjs` is a copy, not an import.** The two deciders share
`curation-auth` and nothing else, and `run-dir`, `gateway`, `packet`, `rules`,
`decision` and `test-fakes` are each already a pair of files by that design. A
loop that knows only its own `run` is the smallest of those pairs, and making it
the first thing one library imports out of the other would buy a hundred lines
and cost the independence. Each file names the other, so a defect is fixed in
both.

## The one thing `curation-groups` gains beside the loop

Its CLI never set exit code 2 on a refused `apply`, where the suggestions CLI
does. So the one shot driver threw for one decider and reported success for the
other, over the same `applied: false` answer. Reading the verdict in the channel
settles that: a refused replay now throws whichever decider answered it, which
is what the suggestions CLI's own comment says the exit code is for.

## Verification

`node --test`, everything injected, no network, no Docker, no model and no child
process:

- a request line reaches the command it names with the flags it carries, and
  `decide`'s `input` arrives where stdin used to;
- the answers come back in the order the requests were written, and each one
  carries the id of its own request;
- a command that throws answers `{ id, error }` and the loop keeps serving, so
  one bad request does not end a run;
- a stdout line that is not JSON, and an answer carrying an unknown id, are both
  ignored rather than mismatched onto a pending call;
- a child that exits mid run rejects the call in flight and every later call,
  with a message naming the exit code and the stderr tail;
- `end` closes the child and still answers the report; a second close is a no
  op;
- `start`, `next`, `decide` and `end` build the same flag lists they built when
  each one was a command line, which is what keeps the one shot entry points and
  the serve requests the same thing;
- `end` driven through a session and `end` driven through `run` over two run
  directories built the same way answer the same object and write the same
  `report.json`, and leave `state.json` and `decisions.jsonl` untouched. `end`
  is the command an equivalence test can drive for real, because it reads the
  whole run directory, writes a file out of it, and reaches no gateway.

In `curation-groups`, the same loop over its own `run`, plus the two that answer
the regression this closes: a `start` request reaches `start` and answers a
line, and `node cli.mjs serve` dispatches the loop from the command line. Both
send a `start` missing a flag, so both reach the command and neither reaches a
gateway.

And one test that starts a real child, because nothing above would notice that
`serve` was never dispatched or that the framing disagrees: `apply` over an
empty decisions file, through the real `spawnChild` and the real decider CLI.
It reaches no gateway either, so it costs one process and no network.

**And the measurement**, which is the only thing that can say whether the 20
seconds were real: the same eighty row queue, the same four in flight, the same
local model, comparing the wall clock against the 205 seconds of plan 0003.
