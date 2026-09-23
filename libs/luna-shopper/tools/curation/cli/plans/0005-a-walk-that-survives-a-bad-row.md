# 0005 A walk that survives a bad row

> Found by `apps/luna-shopper-backend/plans/0150` (report findings 6 and 10, and
> `part1/curation/curation.md` in the report folder). Groups plan `0002` and suggestions plan
> `0006` fix the two deciders. This plan fixes the orchestrator between them. Build this one
> first, because both deciders read the flag it fixes. Dev plan `tools/dev/plans/0004` fixes
> the slot script half of section 4.
>
> In `0150`, the groups walk failed on its first row, "decide failed: --item is required", and
> curated no group. The Mercadona suggestions walk crashed at row 173 of 2,235 on a product
> name over 120 characters, and wrote no report. There was no way to continue it, so the only
> choice was a new run from the start.

## Brief for the agent

### Objective

Make the orchestrator call both deciders with one id flag, turn one failed row into a review
instead of a failed run, always write a report, resume a stopped run, start and stop the
rehearsal slot safely, and print what an operator needs to act on.

### Context

- **The flag.** `cli/src/decider.mjs:343-355` always sends `--entry`. The groups CLI requires
  `--item` (`groups/src/cli.mjs:151`), and the suggestions CLI takes `--entry`
  (`suggestions/src/cli.mjs:162`). `cli/src/decider.test.mjs:163-168` checks `--entry`, and
  `groups/src/cli.test.mjs:17, 113` checks `--item`. Each side passes alone, and nothing checks
  the arguments `makeDecider` builds against each real CLI.
- **One row ends the run.** An error from `next` or `decide` escapes. The walk rethrows it
  (`orchestrator.mjs:467-469`), the outer catch sets `failed` (`:505-506`), and
  `decider.end()` runs only on the success path (`:483`). So no `report.json` is written.
  Plan `0001` step 6 says `end` runs "on success and on failure both".
  `orchestrator.test.mjs:395-430` locks the current behaviour in.
- **No resume.** `start` refuses a folder with `state.json`
  (`suggestions/src/run-dir.mjs:120-123`), and its message says to "continue this one with
  next", which the CLI cannot do. Teardown deletes the rehearsal slot
  (`orchestrator.mjs:522`), so the run's `createdRefs` point at nothing afterwards.
- **Only reviews.** A groups run with only `REVIEW` decisions answers `applied: false` on
  `apply` (`groups/src/commands.mjs:685-693`), and `decider.mjs:382-384` turns that into a
  throw.
- **The slot.** `slots.list()` parses `luna-slot.sh --list` (`slots.mjs:71-90`) and takes the
  lowest free slot of 1 or more (`:98-112`). `slots.up` is outside the `try`
  (`orchestrator.mjs:327`), so a failed `up` skips teardown. A second Ctrl+C exits 130 with the
  slot still up (`cli.mjs:417-424`). Only SIGINT has a handler (`cli.mjs:426`), so SIGTERM or a
  closed terminal leaves the slot up and unrecorded.
- **Progress and output.** With `--limit`, the progress line shows `n/2235`, not `n/limit`
  (`orchestrator.mjs:348, 438`). Groups rows print a uuid because `orchestrator.mjs:45-53`
  reads `subject.name` and the groups packet has `nameEs` and `nameEn`
  (`groups/src/packet.mjs:167-170`). The run prints only `report: <path>`. `end` already
  writes `unregisteredBrands` (`suggestions/src/commands.mjs:897-924, 960`) and nothing
  prints it.
- **Hand steps today.** Type `--` after the Nx target or Nx drops the flags. `--implementation`
  is required even with `--apply` (`cli.mjs:487-493`). A new `--run-dir` every run. `--apply`
  needs a `--main-url` that matches the file header exactly (`commands.mjs:1010-1014`). Split
  by hand under the 1,000 operation cap (`:1017-1021`). There is no `cli/README`.

### Target state

- Both deciders accept `--row <id>`. The suggestions CLI keeps `--entry` and the groups CLI
  keeps `--item` as aliases. The orchestrator sends `--row`. A contract test feeds the
  arguments `makeDecider` builds into each real CLI's `run()`.
- An error on one row becomes a `REVIEW` with the issue `ROW_FAILED` and the error text, and
  the walk goes on. Three failed rows in a row stop the walk, because that is not a row
  problem.
- `end` runs on success, on failure and on a stop, and `report.json` is always written.
- `--resume <run-dir>` continues a run: it brings up a new slot, replays the run's `CREATE`
  decisions into it so refs resolve, and walks from the first row with no decision.
- A run with only reviews ends as success with nothing to apply.
- `slots.up` is inside the `try`. SIGTERM and SIGHUP stop cleanly like the first Ctrl+C. A
  second signal prints the exact `luna-slot.sh --ephemeral --down <n>` command before it exits.
- The progress line counts to the limit and prints the row's name for both deciders.
- The run ends with a summary: counts per decision kind, the unregistered brands (first 20 and
  the file that holds all), the report path, and the exact `--apply` command to paste.
  `--apply` reads `--main-url` from the file header when not given, and splits a file over
  the operation cap into several requests by itself.
- `cli/README.md` states the flow from start to apply, with one example per implementation.

### Scope

Work only in:

- `libs/luna-shopper/tools/curation/cli/` (source, tests, README)
- the id flag alias in `libs/luna-shopper/tools/curation/suggestions/src/cli.mjs` and
  `libs/luna-shopper/tools/curation/groups/src/cli.mjs`, and their tests
- `libs/luna-shopper/tools/curation/suggestions/src/run-dir.mjs` for the refusal message only

Do not touch: decision rules in either decider, the gateway, or `luna-slot.sh` (dev plan
`0004` owns it).

### Constraints

- No new npm dependency. The tools are plain `.mjs`.
- A resumed run never writes to the main catalog. Only `--apply` does.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: changing the decisions file format, or changing what `--apply` sends.

### Progress evidence

- The contract test for both deciders.
- Orchestrator tests: a failing row becomes `ROW_FAILED` and the walk continues, three in a
  row stop it, `end` runs on failure and writes the report, and resume skips decided rows.
- A test for the summary text and the pasted `--apply` command.
- `npx nx test` passes for the cli, suggestions and groups projects (names from
  `nx show projects`).
- A real run of 30 rows with `--engine ollama --model gemma4-32k` against a slot, stopped with
  Ctrl+C at row 10 and resumed, with the summary pasted in the PR. Stop the model with
  `ollama stop gemma4-32k` afterwards.
