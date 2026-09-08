# 0001 A decider that owns the queue walk

Part of the curation toolchain: `curation-auth` (sessions), this decider,
`curation-groups` (its sibling), `curation-cli` (the orchestrator), and
backend plan 0100 (the bulk routes). It replaces the loop and CLI layer of the
single file tool from backend plan 0098 (PR #287); that tool's validators,
packet builder, decision schema, retry semantics, prompt, fixtures and tests
are the starting material and carry over.

## What this is

A CLI that owns everything deterministic about working the source entry queue,
so the thing driving it (a model through the orchestrator, or a person poking
it by hand) holds no state and no credentials. It is invoked once per step and
keeps its state in a run directory, so a killed run resumes for free.

## The contract

Every subcommand answers one JSON object on stdout and nothing else.

- `start --main-url <u> --rehearsal-url <u> --main-user <name> [--main-password <p>] --run-dir <dir>`
  Verifies both admin logins through `curation-auth` (stop here if either
  fails), counts the queue, writes `state.json`, and answers
  `{ runId, remaining, prompt }` where `prompt` is the rules prompt text this
  library owns (the six naming rules and the decision contract from plan 0098,
  kept in a markdown file beside the source).
- `next --run-dir <dir>`
  Answers `{ entry, candidates, remaining }` for one row, or `{ done: true }`.
  Internally it pages the queue 10 to 20 rows at a time but always answers one.
  **Candidates are computed at `next` time, never at prefetch time**: the merge
  below must see what the previous `decide` created, or the duplicate bug this
  toolchain exists to kill is reborn inside the library.
- `decide --run-dir <dir> --entry <id>` with the model's JSON on stdin
  Validates the decision (the nine validators from plan 0098, unchanged),
  applies the confidence threshold (below 0.9 demotes to REVIEW), performs the
  rehearsal write when the decision is CREATE, appends the full record to
  `decisions.jsonl`, and answers `{ accepted, decision, issues, remaining }`.
- `end --run-dir <dir>`
  Writes the report (counts per decision, every REVIEW with its issues, token
  fields the orchestrator passed through) and answers its path.
- `apply --main-url <u> --main-user <name> [--main-password <p>] --file <decisions.jsonl>`
  The replay: no model, no slot. Reads the file, refuses a file whose header
  names a different main url, refuses more than 1,000 operations, translates
  the records into one bulk request against the plan 0100 harvester route
  (run created items become `ref`/`itemRef` pairs), and reports what the
  server answered, including the per entry price skips.

## The candidate merge

`next` searches the main catalog and the rehearsal catalog every time, through
two `curation-auth` sessions, and merges the results with an origin label:
`catalog` for main rows, `run` for rehearsal rows (the products this run
already created). Both searches are the same admin item search the per row
tool used, plus the exact EAN lookup. The model sees one merged candidate
list and never knows two databases exist; a decision that links to a `run`
candidate is recorded against that candidate's `ref`, not an id, because the
real id does not exist until `apply`.

## The decisions file

`decisions.jsonl` opens with a header line: run id, main url, rehearsal url,
model name (told by the orchestrator at `start`), and timestamps. Every
decided row carries the entry id, the entry's `status` and `lastSeenAt` as
seen at decide time (the `expect` plan 0100 checks), the decision, the
confidence, the issues, and for CREATE the item payload plus its `ref`.
`apply` sends `expect` verbatim, which is what makes a stale file die on the
server with zero writes.

## Decisions

- **The rehearsal write is a plain catalog item create** on the rehearsal
  gateway. No harvester runs in the rehearsal slot and no entry rows exist
  there; the slot exists so the real search can see this run's creations.
- **REVIEW writes nothing anywhere**, exactly as in plan 0098.
- **Zero npm dependencies, ESM `.mjs`, not browser reachable, never in
  `tsconfig.base.json` paths.** Nx project with `lint` and `node --test`
  targets, like `curation-auth`.
- **State is the run directory**: `state.json` (cursor, counts, seen ids) and
  `decisions.jsonl`. A `next` after a crash re-reads both and continues; an
  entry already in the file is never asked again.

## Verification

`node --test` with injected fetch, no network: the start counting and login
gate; `next` computing candidates lazily (a fixture where the twin only exists
because the previous `decide` created it); the merge labeling origins; every
validator on bad and good decisions; the threshold; `decide` writing the
rehearsal create and the JSONL record; resume from a half written run dir;
`apply` building the exact bulk request from a fixture file, refusing a wrong
header and an oversized file. The fixtures from the plan 0098 tool carry over.
