# 0003 A sizeless CREATE from a local model is a review

## The brief

Add one validator to `curation-suggestions`, and one boolean to the engine
registry that feeds it.

A CREATE whose `item.unitSize` is null is a product the model decided has no
printed size. When the model that decided it runs on the operator's own machine,
that decision goes to a person instead of into the catalog: the decision is
recorded as a REVIEW carrying a new issue code, `SIZELESS_CREATE`, whose detail
names the product. When the model is a Claude model the decision stands, exactly
as it does today.

The locality of the engine is a fact the registry already could state and does
not. It travels `ENGINES[].local` to `curation-cli`'s `cli.mjs`, through
`runCuration` and `decider.start` as `local`, onto the decider CLI as a bare
`--local` flag, into `state.json` as `local`, and out of `loadRun` into
`decide`, which hands it to `validateDecision` as `local`. Nothing between those
two ends interprets it.

Everything is unit tested with `node --test` through `npx nx test`. No model is
called, no slot is taken, no Docker runs.

## What was measured

Eighty SuperCash cosmetics rows, 2026-09-13, `gemma4:12b` on a local Ollama
server against `claude-sonnet-5` beside it.

`gemma4:12b` answers `confidence: 0.95` on 70 of the 80 rows, so
`CONFIDENCE_THRESHOLD` decides nothing at all. It is not a calibrated number
that happens to sit above the line: it is one number the model writes whatever
the row is. Every demotion the walk gets from a local model therefore comes from
a validator, and the threshold is dead weight on that engine.

The gap to sonnet is mostly one class of row. Twenty seven of the eighty rows
carry no printed size anywhere: not in the entry name, not in `unitSize`, not in
`sizeFormat`. Sonnet sends all twenty seven to review as `FORMAT_UNKNOWN`, which
is a code the model writes in its own `issues` list. `gemma4:12b` creates all
twenty seven, with `unitSize: null` and `defaultUnit: UNIT`.

**The model is following the rule.** Since PR #358 `prompt.md` says it outright:
a product with no printed size is sold by the piece, so `defaultUnit` is `UNIT`
and `unitSize` is null. There is a real product behind that answer, and on a
cosmetics queue there are a great many of them. What the smaller model does not
do is the second half of what sonnet does, which is to notice that a product it
cannot size is a product rule 1 cannot be tested on, and to say so.

So the rule that is missing is not a rule about sizes. It is a rule about how
much of a decision a local model is trusted to make on its own, and that belongs
in the decider, where every other thing the tool refuses for itself already
lives.

## The rule

A `CREATE` whose `item.unitSize` is null, decided by a local engine, gains

    SIZELESS_CREATE: <nameEs> is created with no size, so rule 1 cannot be
    tested against it. A local model is not trusted to settle that.

and is therefore recorded as a REVIEW, by the demotion `decide` already applies
to any decision `validateDecision` returns issues for.

Four things it is not:

- **Not a check on the entry.** The entry having no size is the normal case
  behind this answer and is not itself suspicious. What is checked is the
  decision to create a product out of it.
- **Not retryable.** `SIZELESS_CREATE` stays out of `RETRYABLE_ISSUE_CODES`.
  Asking the same row again gets the same answer, because the model is applying
  a rule the prompt gave it. `NAME_GLITCH` is retryable because a digit inside a
  word is one token of generation going wrong; this is a judgment the model
  stands by, which is the line plan 0003 of `curation-cli` drew and this rule
  sits on the other side of it.
- **Not a LINK rule.** A LINK onto a sizeless catalog product is a decision made
  against a real product the packet named, and `FORMAT_MISMATCH` already covers
  the case where the two sizes disagree.
- **Not a second opinion.** Sending the flagged rows to a paid model is a
  different plan and is out of scope here. This one produces rows an operator
  looks at.

## How the decider knows

The registry is the authority about engines. An entry already carries what a
provider is, so it carries this too:

```js
{ name: 'ollama', local: true,  ... }
{ name: 'claude', local: false, ... }
{ name: 'api',    local: false, ... }
```

`local` is a property of the entry and not of the built engine, because the
question is asked before a run starts and never during one. The contract
assertion in `registry.test.mjs` that walks every entry gains one line, so a
fourth provider added without answering the question fails there.

From there it is a value passed along a path that already exists:

| Where                                   | As                                                            |
| --------------------------------------- | ------------------------------------------------------------- |
| `curation-cli/src/cli.mjs`              | `local: entry.local === true`                                 |
| `curation-cli/src/orchestrator.mjs`     | `runCuration({ local })`, then `decider.start({ local })`     |
| `curation-cli/src/decider.mjs`          | `--local`, appended only when it is true                      |
| `curation-suggestions/src/cli.mjs`      | `local: flags.local === true`                                 |
| `curation-suggestions/src/commands.mjs` | `start({ local })`, written to `state.json`                   |
| `curation-suggestions/src/commands.mjs` | `decide` reads `state.local`, passes it to `validateDecision` |

Two details of that path are deliberate.

**`--local` is a bare flag and is absent when false.** A run against a Claude
model builds the same argument list it builds today, so nothing that asserts on
that list has to learn about a flag that says nothing.

**It is recorded at `start` and never re-read from the engine.** The decider is
invoked once per step and keeps nothing in memory between invocations, so a fact
about the run belongs in the run directory beside `model`. A resumed run then
applies the rule the run was started under, which is the only answer that makes
the decisions file mean one thing from top to bottom. A run restarted against a
different engine is a different run directory, because `createRun` refuses to
overwrite one.

## What does not change

**`prompt.md` gains nothing.** Its list of what the tool refuses is headed
"Every one of these is avoidable", and this one is not: the model cannot avoid
it, and the only way it could try is by inventing a size for a product that has
none, which is the failure the list is there to prevent. The prompt already
states the sizeless rule three sections above, and it would then state the
opposite. Every word of that file is billed on every row of a run, and this one
would buy worse answers.

**`end` gains nothing.** The report carries no count of issues by code. It
carries every REVIEW with its `issues` array verbatim, so `SIZELESS_CREATE`
appears there the moment the validator raises it, with no special casing and no
edit. If a count by code is ever added it will pick this code up the same way.

**`CONFIDENCE_THRESHOLD` is left alone.** It decides nothing on a local model,
which is the measurement above, but it is not wrong and it is what a Claude
model is still judged by.

## Verification

`node --test` through `npx nx test`, everything injected, no network and no
model:

- a sizeless CREATE from a local engine carries `SIZELESS_CREATE` and the detail
  names the product;
- the same decision from a non local engine carries no issue at all;
- a CREATE stating a size carries none either way, including `unitSize: 0`,
  which is a number and not a missing size;
- a LINK is untouched either way, sizeless target or not;
- `SIZELESS_CREATE` is not retryable, asserted through `retryableIssues`;
- `decide` on a run started with `local` records a REVIEW carrying the code and
  writes nothing to the rehearsal catalog, and the same reply on a run started
  without it records the CREATE;
- `start` writes `local` into `state.json`, and a run started without it reads
  as false rather than as undefined;
- every registry entry answers the locality question with a boolean, and
  `ollama` is the one that answers true;
- the decider CLI passes `--local` through to `start`, and `makeDecider` appends
  the flag only when the orchestrator asked for it.
