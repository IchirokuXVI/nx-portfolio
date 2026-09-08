> **PR:** [#295](https://github.com/IchirokuXVI/nx-portfolio/pull/295)

# 0001 The orchestrator the user runs

Part of the curation toolchain: `curation-auth` (sessions),
`curation-suggestions` and `curation-groups` (the deciders), and backend plan
0100 (the bulk routes). This is the one entry point a person invokes; nothing
else in the toolchain is meant to be run by hand.

## What this is

The glue between three parties that must never mix: the deciders own state,
credentials and writes; the model owns judgment; this CLI owns the run. It
picks the implementation, provisions the rehearsal slot, drives the
next/model/decide loop, and tears everything down. The model receives API
addresses' worth of nothing: it only ever sees the packet the decider answered
and returns the minimal decision JSON.

## The run, in order

1. **Pick the implementation.** Asked interactively when the terminal is a
   TTY, or given as `--implementation <suggestions|groups>`. The choice names
   which decider CLI is driven; everything below is identical for both.
2. **Take a fresh slot, every run.** The rehearsal always uses a new slot.
   The CLI asks the platform's `luna-slot` twin (`.sh` through bash, `.ps1`
   through PowerShell) for the state of slots 1 to 9; a slot is taken when a
   worktree claims it or its ports answer, which is what `--list` already
   reports. No free slot stops the run with an error naming the taken slots.
   Slot 0 is never taken: it is the developer's own and usually the main API.
3. **Bring up only what the rehearsal needs**:
   `luna-slot --up <n> --services gateway,auth,catalog`. **The list grew by
   `auth`, and this is the recorded answer**: `admin-auth.controller.ts` sends
   `ADMIN_AUTH_PATTERNS.login` over NATS, and the only handler of that pattern
   is `apps/luna-shopper-backend/auth/src/app/admin/admin.controller.ts`, so a
   rehearsal without the auth service cannot pass step 4. Wait for the slot
   gateway to answer `/health/ready` before step 4, because `--up` waits for
   the port to open, which happens before Nest has finished wiring the broker.

   `--services` used to narrow `--restart` only, and `--up` started all seven
   whatever it was told. Both twins now honour it on `--up` as well, and both
   refuse an unknown service name before anything is written or started. The
   compose stack is still always the whole of it: the databases are cheap
   beside seven Node processes, and a service started later would otherwise
   find its own missing.
4. **Verify both admins before the first model call**, through the decider's
   `start`: main gateway with `--main-user` (default `dev-admin`, empty
   password, overridable), rehearsal gateway with the `dev-admin` that
   `luna-slot` seeds. Either failing stops the run before any token is spent.
5. **The loop.** `next`, build the model input (the decider's `prompt` from
   `start` plus the row packet), one model call, parse the minimal JSON
   answer, `decide`, repeat until `done`. Progress goes to stderr as
   `52/349 - <row name>`; stdout carries one JSON line per decided row and
   nothing else. Model usage per call is accumulated and handed to `end`.
6. **Teardown, always.** `end`, then `luna-slot --down <n>`, on success and on
   failure both. On failure the CLI first dumps the slot's catalog database
   (`pg_dump` through the slot's container, into the run directory) so the
   rehearsal state survives the teardown; there is no `--keep-slot`.

`--apply` skips all of it: no slot, no model, just the decider's `apply`
against the main gateway with the decisions file.

## The engines

- **`--engine claude`, the default.** Each model call spawns the locally
  installed Claude Code CLI: `claude -p --output-format json --model
  claude-sonnet-5`, prompt on stdin, 120 second timeout. The child environment
  is a copy of `process.env` with **`ANTHROPIC_API_KEY` deleted**, so the call
  bills the operator's logged in Claude session even when a key is exported
  globally; when a key was present, one stderr notice says it is being
  ignored. The reply text sits in the envelope's result field; the shape is
  verified empirically with one tiny live call during implementation, not
  assumed. Retries and the invalid JSON retry-once semantics follow the plan
  0098 tool.
- **`--engine api`.** The raw Messages API path from the plan 0098 tool,
  unchanged, behind a gate: when `ANTHROPIC_API_KEY` is set, the CLI prints
  that the run bills the API with that key and requires the operator to type
  exactly `API_KEY` to continue; anything else, or no TTY, aborts. API billing
  never happens unnoticed; that is the requirement, verbatim.
- The Agent SDK is not an engine and will not become one: it cannot use a
  subscription by policy, and it would break the zero dependency rule.

## Decisions

- **The model is stateless and blind.** No urls, no tokens, no slot numbers,
  no remaining counts reach it; the packet and the rules prompt are its whole
  world. Everything it answers goes through the decider's validators before it
  can touch anything.
- **Slot machinery lives here and only here.** The deciders take urls and do
  not know what a slot is; `luna-slot` stays the single authority on claims
  and ports, and this CLI never probes a port itself.
- **Zero npm dependencies, ESM `.mjs`, never browser reachable**, an Nx
  project with `lint` and `node --test` targets, like its siblings.

## Verification

`node --test` with the decider CLI, `luna-slot`, the model spawn and the
prompt all injectable: the free slot choice and the all-taken error; the
service list; readiness waiting; the dual login gate ending a run before any
model call; the loop wiring next to decide with the model between; the key
stripped from the claude engine's child env; the `API_KEY` gate accepting the
exact word and refusing everything else and refusing without a TTY; dump then
teardown on a mid run failure; teardown on success. A live smoke run against
slot 0 is manual and documented at the top of the file.
