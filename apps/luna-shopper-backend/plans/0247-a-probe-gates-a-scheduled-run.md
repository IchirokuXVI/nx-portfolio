> **PR:** [#934](https://github.com/IchirokuXVI/nx-portfolio/pull/934)

# 0247: a probe gates a scheduled run

> Plan `0219` gives each chain a probe: two to six requests through the real client and parsers,
> with a verdict in `source_probes`. Plan `0206` starts a preset on a schedule. Today the two do
> not meet: a slot starts its walk whatever the newest probe says, and a walk against a storefront
> that changed shape stores little and may mark products wrong. The owner decided on 2026-11-06
> that a scheduled run must not start unless a probe of its chain passed: a `PASSED` probe is valid
> for 15 minutes, a slot inside that window needs no new probe, and a slot outside it runs a probe
> first and is skipped when that probe is not `PASSED`. The same decision gave plan `0218`'s
> alerts their probe cases: `SHAPE_CHANGED` and `BLOCKED` alert on a change, `UNREACHABLE` alerts
> after its two retries, and a skipped slot alerts one time until the reason changes. This plan
> builds the gate, the slot outcome, the computed block of the schedule view and the three alert
> rules. Nothing about a manual run changes.
>
> Prerequisite reading: `0206` (the slot, the late rule, the deploy retry, `claimDue`), `0219`
> as built (the probe, the verdict, the due rule, `attempt`, `lastProbe`), `0218` as built (the
> outbox, `slotAlertFor`, the transactional write, the message), `0083` (the per chain row) and
> the files `harvest/harvest-schedule.worker.ts`, `harvest/harvest-schedule.store.ts`,
> `harvest/harvest-run.service.ts` (`startScheduled` and the schedule block),
> `harvest/probes/source-probe.service.ts`, `harvest/probes/source-probe.store.ts`,
> `harvest/probes/source-probe.due.ts`, `harvest/alerts/harvest-alert.rules.ts` and
> `harvest/alerts/harvest-alert.message.ts`.

## Brief for the agent

### Objective

Make every `SCHEDULED` start of a run that fetches a chain's storefront pass through a probe gate:
reuse a `PASSED` probe younger than 15 minutes, else run one now, and skip the slot with the new
outcome `SKIPPED_PROBE_FAILED` when the probe is not `PASSED`. Add the computed block
`PROBE_NOT_PASSED` to the schedule view, and add the probe and gate cases to the alert rules of
plan `0218`, each written in the transaction of the outcome it reports. Sections 1 to 9 state the
rules.

### Context

- `HarvestScheduleWorker.decide` (`harvest-schedule.worker.ts`) claims a slot, answers
  `SKIPPED_LATE` through `isTooLate`, else calls `start`, which wraps `HarvestRunService.startScheduled`
  and turns a thrown error into `REFUSED`. `retryInterrupted` starts again, one time, a scheduled
  run that a shutdown or the reaper ended, through the same `start`. Both write through
  `HarvestScheduleStore.recordOutcome`, which plan `0218` gave an optional alert draft.
- `startScheduled` (`harvest-run.service.ts`) answers `SKIPPED_FAILING` at three consecutive
  failures and `SKIPPED_BUSY` for a run in the way, and refuses a row that is off.
- `HarvestScheduleOutcome` (`libs/luna-shopper/contracts/src/lib/enums/harvest.enums.ts`) is
  `STARTED`, `SKIPPED_LATE`, `SKIPPED_FAILING`, `REFUSED`, `SKIPPED_BUSY`. `HarvestScheduleBlock`
  is computed on read and never stored, and the first in its order is answered.
- A `STORE_DISCOVERY` run reads the chain only when `adapterCapabilities(adapterKey).listsItsOwnStores`
  is true (`harvest-run.service.ts`, around line 848); otherwise it is a radius over OpenStreetMap.
  `CATALOG_DISCOVERY` always reads the chain. `FILE_IMPORT` reads nothing.
- Plan `0219` as built: `source_probes` holds `id`, `sourceId`, `supermarketId`, `adapterKey`,
  `trigger`, `status`, `previousStatus`, `changed`, `attempt`, `startedAt`, `finishedAt`,
  `requests`, `steps`, `error`, `requestedByUserId`. `SourceProbeService` inserts a `RUNNING` row
  and runs the probe through the dispatcher, keeps the probes in flight in a map, and writes the
  verdict through `SourceProbeStore`. `probeDueAttempt` (`probes/source-probe.due.ts`) is the
  pure due rule: the chain's `probeIntervalHours` from `supermarket_sources.config` (24 by
  default, 0 means never by itself), and after an `UNREACHABLE` probe a retry after
  `PROBE_RETRY_MS` (30 minutes) as attempt 2 and 3, attempt 3 final. The worker claims one probe
  per tick with `FOR UPDATE SKIP LOCKED` on the source row and `uq_source_probe_running` as the
  backstop. The six chains with a probe are the `SOURCE_ADAPTER_KEYS` minus `manual`;
  `osm-places` has none. A probe writes nothing but `source_probes`.
- Plan `0218` as built: `harvest_alerts` is the outbox, `runAlertFor` and `slotAlertFor` are
  pure, a draft is `{ kind, dedupeKey, supermarketId, runId, scheduleId, payload }`, the insert is
  `ON CONFLICT DO NOTHING`, and the worker sends one mail or a digest. `slotAlertFor` alerts a
  `REFUSED` slot unless the previous outcome of the schedule was `REFUSED` with the same note.
  The kinds are `RUN_FAILED`, `RUN_BLOCKED`, `RUN_STALE`, `POSTAL_CODE_FAILED`, `SLOT_REFUSED`
  and `TEST`.
- Envoy's route timeout does not matter here: the gate runs inside the worker's tick, which has
  no HTTP caller. A Carrefour probe takes up to about 15 seconds, a Mercadona probe 5 to 10.
- **This plan lands after plans `0218` and `0219`.** It changes their files. Plans `0222` and
  `0223` turn `listsItsOwnStores` on for DEZA and Carrefour; from then on a scheduled store
  discovery of those chains is gated too, by a probe that has no shop step (plan `0219`, section
  3.2). That is acceptable: the probe still proves the client reaches and parses the storefront.
- The newest harvester migration on `dev` at the time of writing is plan `0221`'s
  `1760200000000-NameWordsSizeMatch.ts`. Plans `0216`, `0222` and `0223` may add one each, so
  take the next free timestamp on `dev` at build time. At build time the newest was
  `PriceRefreshes1760300000000`, and this plan's migration is `1760400000000-ProbeGate.ts`, class
  `ProbeGate1760400000000`.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, and `openapi.json` and the
admin wire types are regenerated for the two new enum values.

### Scope

- Work only in:
  - `apps/luna-shopper-backend/harvester/src/app/harvest/`: `harvest-schedule.worker.ts`, a new
    `schedule-probe-gate.ts` beside it (the pure decision), `harvest-run.service.ts` (the schedule
    block only), `probes/source-probe.service.ts` (one new method), `probes/source-probe.store.ts`
    (the optional alert draft on the finishing write and one read), `alerts/harvest-alert.rules.ts`,
    `alerts/harvest-alert.message.ts`, a migration if section 3 needs one, and their specs.
  - `libs/luna-shopper/contracts`: the two enum values, the alert kinds, their schemas.
  - The harvester paragraph of `CLAUDE.md` that plan `0219` added: two sentences.
  - The generated files, through their generators.
- Do NOT touch: the probe functions of the six libraries, the probe worker's claim, the probe
  verdict, `consecutiveFailures`, the late rule, the busy rule, the three failure rule, the run
  executor, the postal code worker, the alert worker and mailer, the Helm chart, the values files,
  `luna-slot.sh`, `apps/luna-shopper-admin`.

### Constraints

- The gate applies to `SCHEDULED` starts only: the slot and the deploy retry. A `MANUAL` start and
  a `SYSTEM` start are not gated. A person who starts a preset decides for themself.
- The gate is a pure function over the schedule, the source, the newest finished probe and the
  clock. It decides one of three things: start now, probe first, skip. The worker does the
  reading and the probing around it.
- A gate probe is an ordinary probe row with `trigger: SCHEDULED`. It obeys every rule of plan
  `0219`: one `RUNNING` probe per source, the 5 minute deadline, the verdict, `attempt` from
  `probeDueAttempt` with the interval ignored, and it moves the chain's next daily probe.
- The gate never starts a probe while a run of the chain is in flight. `startScheduled` answers
  `SKIPPED_BUSY` for that case before the gate runs, so the order is: late, failing, busy, then
  the gate, then the start.
- An alert is written in the transaction of the outcome it reports, as plan `0218` requires: the
  probe's finishing write, or the slot's `recordOutcome`.
- Add no switch. `PROBE_VALID_MS` is a constant of 15 minutes, the owner's number. No setting per
  chain.
- The migration, if any, is additive.
- No dash as punctuation in a comment, a log line, a mail or a note. Reword the sentence.

### Action boundaries

- Proceed with in scope edits, specs, the migration file and the generators.
- Stop and ask before you run any probe against a live storefront. A gate on a slot is proven on
  an ephemeral slot against a closed local port and against the committed fixtures.
- Stop and ask if plans `0218` or `0219` are not on `dev` when you start.
- Stop and ask if the gate cannot be placed after the busy rule without changing a public method
  of `HarvestRunService` beyond an added optional argument.
- Stop and ask before you change the comparison rule of `slotAlertFor` for any outcome but the
  new one.

### Progress evidence

Report after each of these, with the spec output:

1. The pure gate and its spec.
2. The worker's gate path, the new outcome, the migration if any, with an integration spec on
   real Postgres.
3. The schedule block and the alert rules, with their specs.
4. The CLAUDE.md sentences and the regenerated files.

## 1. What is being built

| Piece                                               | Where                                             |
| --------------------------------------------------- | ------------------------------------------------- |
| The decision: start, probe first, or skip           | `harvest/schedule-probe-gate.ts`, pure            |
| The gate in the slot and in the deploy retry        | `harvest-schedule.worker.ts`                      |
| A probe run for a slot                              | `probes/source-probe.service.ts`, `runForSchedule` |
| `HarvestScheduleOutcome.SKIPPED_PROBE_FAILED`       | contracts, and the Postgres type if one exists    |
| `HarvestScheduleBlock.PROBE_NOT_PASSED`             | contracts and `harvest-run.service.ts`            |
| `PROBE_FAILED` and `SLOT_PROBE_FAILED` alerts       | `alerts/harvest-alert.rules.ts`, `.message.ts`    |
| The alert draft on the probe's finishing write      | `probes/source-probe.store.ts`                    |

## 2. What a slot does now

After the claim, in this order. Each step that answers ends the slot.

1. **Late.** `isTooLate` answers `SKIPPED_LATE`, as today.
2. **Failing and busy.** `startScheduled` answers `SKIPPED_FAILING` or `SKIPPED_BUSY`, or refuses
   a row that is off or a preset that no longer validates, as today. The gate runs **after** these
   checks and **before** the run is inserted, so a chain that is busy or failing never gets a gate
   probe. The builder splits `startScheduled` into its checks and its insert with an optional
   callback or a two step call, with no change to what callers that pass nothing get.
3. **Does this run fetch the chain?** `CATALOG_DISCOVERY` does. `STORE_DISCOVERY` does when the
   adapter lists its own stores. A `FILE_IMPORT` preset and a store discovery over OpenStreetMap
   do not, and the gate answers start.
4. **Is there a valid probe?** The newest finished probe of the source that is not `ABORTED`,
   with `status: PASSED` and `startedAt` at or after `now` minus `PROBE_VALID_MS`, answers start.
   Any trigger counts: a person's probe, the daily probe, a gate probe of another schedule of the
   chain.
5. **Is a probe running?** A `RUNNING` probe of the source, by any trigger and in any process,
   is waited for: the worker reads its row every 5 seconds until it finishes or until 11 minutes
   passed since its `startedAt`. The wait outlasts the reaper's 10 minutes by one tick of the
   probe worker, so a row that a killed pod left `RUNNING` is reaped inside the wait, and
   `PROBE_WAIT_MS` is derived from `PROBE_REAP_AFTER_MS` so the two cannot drift. A probe
   that finished `PASSED` answers start. A probe that is still `RUNNING` after that is left to the
   reaper and the slot is skipped with the note `a probe of the chain did not finish`.
6. **Probe first.** `SourceProbeService.runForSchedule(source, scheduleId)` inserts a `RUNNING`
   row with `trigger: SCHEDULED`, `attempt` from `probeDueAttempt` with the interval ignored,
   runs the probe and awaits it. Its verdict is the verdict of plan `0219`.
7. **The verdict.** `PASSED` answers start, and the run starts in the same tick. Anything else
   answers `SKIPPED_PROBE_FAILED` with the note `probe <id> <status>: <error>`, where `<error>`
   is the probe's one sentence.

The same gate runs in `retryInterrupted` before the retry starts. A retry that the gate skips
writes the same outcome and is spent, as a retry that meets a busy chain is spent today.

**A deploy during the gate decides nothing** (review round 1 of PR #934). A gate probe that ends
`ABORTED`, a wait that the shutdown ends, or a probe the stopping service refuses to start writes
no outcome and no alert, because an abort is not a failure of the chain. The worker logs one line.
The slot stays claimed and undecided: `lastSlotAttempts` is 0 and `lastOutcomeAt` is older than
`lastSlotAt`, with no run of the schedule requested since the slot. The retry after the restart
claims such a slot by setting the attempts to 2 and runs it one time through the same gate, so a
`PASSED` probe inside 15 minutes is reused, and a second interruption spends it.

**A skipped slot is final for that slot.** The next slot tries again, and the daily probe and
its retries keep looking in between. Owner question 1 asks whether a slot should instead keep
trying inside its late window.

**Every status but `PASSED` skips**, `ERROR` included. The owner's words were that a run must not
execute when the probe does not pass, because the data might be wrong. A broken browser in our
image breaks the walk too. Owner question 2 confirms it.

## 3. The outcome and the block

`HarvestScheduleOutcome.SKIPPED_PROBE_FAILED` is added as the last value, documented as "the
probe that the slot ran, or waited for, was not PASSED; the note names the probe and its status".
The builder reads `1759400000000-HarvestSchedules.ts`: if `lastOutcome` is a Postgres enum type
(it is: the Postgres enum `harvest_schedule_outcome`, so the migration exists; `harvest_alerts.kind`
is the Postgres enum `harvest_alert_kind`, so the same migration adds the two alert kinds of
section 4),
a migration adds the value with `ADD VALUE IF NOT EXISTS` and a `down` that moves such rows to
`REFUSED` and rebuilds the type, as `1757600000000-SharedEan.ts` does; if it is a `varchar`, no
migration is needed and the plan says so in its PR.

`HarvestScheduleBlock.PROBE_NOT_PASSED` is added as the **last** value of the computed block, so
that every existing block keeps its precedence. It is answered when the newest finished probe of
the chain that is not `ABORTED` exists and is not `PASSED`. It is a forecast and not a verdict: the
slot will run a fresh probe and may pass. It tells a person who reads the schedule view that the
next slot is likely to skip, and why. It uses the `lastProbe` read that plan `0219` already makes
for the source list.

## 4. The alerts

Three rules join `harvest-alert.rules.ts`. All three are pure, as the two of plan `0218` are.

### 4.1 A probe that finished

`probeAlertFor(input: { probe: Pick<SourceProbe, 'id' | 'sourceId' | 'supermarketId' | 'adapterKey'
| 'trigger' | 'status' | 'previousStatus' | 'changed' | 'attempt' | 'startedAt' | 'finishedAt'
| 'error' | 'steps'>; at: Date }): HarvestAlertDraft | null` answers kind `PROBE_FAILED`, dedupe key
`probe:<probeId>`, when one of these holds:

| The finished probe                                   | Alert         |
| ---------------------------------------------------- | ------------- |
| `SHAPE_CHANGED` with `changed: true`                 | `PROBE_FAILED` |
| `BLOCKED` with `changed: true`                       | `PROBE_FAILED` |
| `UNREACHABLE` with `attempt: 3`                      | `PROBE_FAILED` |

Nothing else alerts. In particular: `UNREACHABLE` at attempt 1 and 2 (the retries are the
answer), `ERROR` (our fault, and the slot alert of section 4.2 covers the consequence),
`ABORTED`, `PASSED`, and a red probe that stays red (`changed` is false the second time). A
recovery to `PASSED` sends nothing; owner question 3.

The draft is written in the transaction of the probe's finishing write.
`SourceProbeStore.finish(probeId, verdict, alert?)` gains the optional draft, as
`HarvestRunStore.finish` did in plan `0218`. The service computes the draft after the verdict and
before the write.

### 4.2 A slot the gate skipped

`slotAlertFor` gains the outcome `SKIPPED_PROBE_FAILED`, kind `SLOT_PROBE_FAILED`, dedupe key
`slot:<scheduleId>:<slot ISO>` and `:retry` for a retry. It alerts **unless the previous outcome of
the same schedule was `SKIPPED_PROBE_FAILED` with the same probe status**. The note holds a probe
id that changes every day, so the comparison reads the status word out of the note, not the whole
note. A chain that stays red thus sends one slot mail and then nothing, and a chain whose probe
goes from `SHAPE_CHANGED` to `BLOCKED` sends a second.

### 4.3 One event, few mails

A gate probe that fails on a chain whose probe was green yesterday makes two rows in one tick: the
probe's and the slot's. Both are written, because they report two facts: the storefront changed,
and the walk did not run. The alert worker's digest of plan `0218` folds them into one mail when
more than three rows are due, and two single mails otherwise. The owner asked for the alert and
not for silence; two mails one minute apart on the first morning of a redesign are acceptable, and
the next days send nothing.

### 4.4 The message

Subjects, in the form of plan `0218`:

- `[production] Mercadona: the storefront changed shape` (`SHAPE_CHANGED`)
- `[production] DIA: the chain refused the probe` (`BLOCKED`)
- `[production] LIDL: the chain was unreachable for three probes in a row` (`UNREACHABLE` at
  attempt 3)
- `[production] DEZA: a scheduled run was skipped, its probe did not pass` (`SLOT_PROBE_FAILED`)

A probe body: one sentence that says what to do (for `SHAPE_CHANGED`: run the library's
`capture-fixtures` target and read the diff; for `BLOCKED`: wait, the daily probe says when the
chain answers again; for `UNREACHABLE`: the chain was unreachable for three probes in a row,
and the last of them started at the time the payload names. A gate probe joins the series with no
30 minute wait, so the three can be minutes apart, and the mail claims no hour), the
chain, the trigger, the attempt, each step's name and whether it was ok, the first problem, the
request count and the probe id. No link, because no back office screen shows a probe yet (plan
`0219`, section 13). A slot body: the slot time, the schedule and the preset, the probe's status
and sentence, and that the next slot tries again.

## 5. Limits

- A gate adds at most one probe per slot, 2 to 6 requests, before a walk of thousands. A chain
  with a daily schedule and a daily probe is probed two times a day at most.
- The gate waits inside the tick. A tick that waits 15 seconds for Carrefour delays the next
  schedule by 15 seconds. The worker claims slots one at a time already, so nothing else changes.
- Two schedules of one chain at one minute: the first runs the gate probe, the second finds it
  `PASSED` inside its 15 minutes and starts at once, or answers `SKIPPED_BUSY` because the first
  run is in flight. No second probe.
- The gate reads `lastProbe` and the `RUNNING` row through `SourceProbeStore`. It never reads
  `harvest_schedules` for a probe and never writes `supermarket_sources`.

## 6. What this plan does not do

- **No gate on a manual run.** The person sees `lastProbe` on the source (plan `0219`) and the
  block on the schedule (section 3), and decides.
- **No gate on the postal code queue.** Its runs read OpenStreetMap, which has no probe.
- **No change to the daily probe, its interval or its retry.** The gate probe is one more probe
  in the same series.
- **No back office change.** The schedule view already renders the outcome and the block as
  words; a chip for the new ones is the admin follow up of plan `0219`, section 13, extended by
  the slot outcome.
- **No recovery mail, no quiet hours, no per chain opt out.**
- **No probe of the price of a known product** and no fixture refresh. A `SHAPE_CHANGED` mail
  names the `capture-fixtures` target for a person to run.

## 7. The documentation

Add two sentences to the probe paragraph that plan `0219` put in the harvester part of
`CLAUDE.md`, after the three switches: a scheduled run of a chain starts only after a probe of
the chain passed inside the last 15 minutes, else the slot runs one and is skipped when it is not
`PASSED`; a manual run is never gated.

## Tests

- **`schedule-probe-gate.spec.ts`**: a `FILE_IMPORT` preset and an OpenStreetMap store discovery
  answer start with no probe; a catalog discovery with a `PASSED` probe 14 minutes old answers
  start and one 16 minutes old answers probe first; a `PASSED` probe that is `ABORTED` or the
  newest `ABORTED` over an older `PASSED` is read past; a `RUNNING` probe answers wait; a
  `SHAPE_CHANGED`, `BLOCKED`, `UNREACHABLE` and `ERROR` verdict each answer skip with the status
  in the note; a store discovery of a chain that lists its own stores is gated.
- **Schedule worker**, with a fake probe service and a clock: a slot with a valid probe starts a
  run and runs no probe; a slot with no probe runs one and starts after `PASSED`; a slot whose
  probe is `BLOCKED` records `SKIPPED_PROBE_FAILED` and starts nothing; the gate runs after the
  busy and failing rules (a busy chain gets no probe); a `RUNNING` probe is waited for and its
  verdict used; a wait past 11 minutes skips with the note; the deploy retry is gated; the skip
  passes a draft to `recordOutcome`.
- **`harvest-alert.rules.spec.ts`**: each row of section 4.1 alerts with key `probe:<id>`;
  `UNREACHABLE` at attempt 1 and 2, `ERROR`, `ABORTED`, `PASSED` and a `SHAPE_CHANGED` with
  `changed: false` do not; `SKIPPED_PROBE_FAILED` after `STARTED` alerts; after
  `SKIPPED_PROBE_FAILED` with the same status word it does not; with another status word it does;
  a retry alerts with the `:retry` key.
- **`harvest-alert.message.spec.ts`**: the four subjects of section 4.4, the step lines, the
  first problem, no dash as punctuation in any fixed sentence.
- **Probe service**: `runForSchedule` writes `trigger: SCHEDULED`, the attempt of the series, and
  passes the draft to `finish` when section 4.1 says so.
- **Schedule block**: `PROBE_NOT_PASSED` is answered for a red newest probe, not for a green one,
  not for none, and after every existing block.
- **Integration, on real Postgres**: a slot and a gate probe on one database write the probe row,
  the outcome and the alert rows in their transactions; a failing alert insert rolls back the
  outcome; the migration, if any, adds the value and `down` removes it.
- **Gateway**: `openapi-document.spec.ts` and `wire-types.spec.ts` pass after regeneration.

## Acceptance criteria

- [ ] A `SCHEDULED` catalog discovery, or a store discovery of a chain that lists its own stores,
      starts only after a probe of the chain finished `PASSED` inside the last 15 minutes.
- [ ] A slot with no such probe runs one first, with `trigger: SCHEDULED`, and starts the run in
      the same tick when it passes.
- [ ] A slot whose probe is not `PASSED` ends `SKIPPED_PROBE_FAILED`, starts nothing and names
      the probe and its status in the note.
- [ ] The gate runs after the late, failing and busy rules, so a busy or failing chain gets no
      gate probe.
- [ ] A `FILE_IMPORT` preset and a store discovery over OpenStreetMap are not gated.
- [ ] A `MANUAL` start and a `SYSTEM` start are not gated.
- [ ] The deploy retry is gated.
- [ ] `HarvestScheduleBlock.PROBE_NOT_PASSED` is answered last, for a red newest probe only.
- [ ] A `SHAPE_CHANGED` or `BLOCKED` probe with `changed: true`, and an `UNREACHABLE` probe at
      attempt 3, write one `PROBE_FAILED` alert in the transaction of the probe's verdict.
- [ ] A skipped slot writes one `SLOT_PROBE_FAILED` alert, and not again while the status word
      stays the same.
- [ ] No probe function, probe verdict, probe claim, counter or run status changed.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-harvester
npx nx run luna-shopper-backend-harvester:test-integration
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx build luna-shopper-backend-harvester
npx nx affected -t lint test
```

`nx test` does not type check. The build line does. The integration target needs a Postgres from
an ephemeral luna slot.

The slot check, on an ephemeral slot with `HARVEST_ENABLED=true` and `HARVEST_SCHEDULER_ENABLED=true`
in the harvester's environment, a DEZA row turned on whose `config` base URL is a closed local
port, and a schedule of a DEZA catalog preset due in the next minute:

1. The tick runs a probe (`trigger: SCHEDULED`, `UNREACHABLE`, attempt 1), records
   `SKIPPED_PROBE_FAILED` with the probe id in the note, starts no run, and writes one
   `SLOT_PROBE_FAILED` alert row and no `PROBE_FAILED` row.
2. Point the base URL at a local server that serves the committed DEZA fixtures, start a manual
   probe, see it `PASSED`, move the schedule to the next minute: the tick starts the run with no
   new probe.
3. `--ephemeral --down <n>`.

## Decisions

Chosen in this plan, and open to the owner's correction:

- The gate is in the schedule worker, after the late, failing and busy rules and before the
  insert of the run (section 2).
- A valid probe is any `PASSED` probe of the chain that started inside the last 15 minutes,
  whatever its trigger (section 2).
- A `RUNNING` probe is waited for, up to 11 minutes, one probe worker tick past the reaper (section 2).
- A skipped slot is final for that slot (section 2).
- Every status but `PASSED` skips, `ERROR` included (section 2).
- The new outcome and the new block are the last values of their enums (section 3).
- Two alert rows on the first red morning, the probe's and the slot's, and nothing on the days
  after (section 4.3).
- The slot alert compares the status word, not the note (section 4.2).
- No recovery mail (section 4.1).

**Owner** (answered 2026-11-06):

1. **A skipped slot.** Final for the slot (this plan), or retried on each later tick inside the
   late window of plan `0206` (half the gap to the next slot) when a probe passes meanwhile?
   Answer: Final for the slot, as the plan says. The next slot tries again, the daily probe and
   its retries keep looking in between.
2. **`ERROR`.** A browser failure or another fault of ours also skips the slot here. Keep that,
   or let the walk try?
   Answer: Keep the skip. A run must not execute when the probe does not pass, `ERROR` included.
3. **A recovery mail.** When a chain goes back to `PASSED` after a `PROBE_FAILED` alert, send one
   mail that says so?
   Answer: No recovery mail now. The daily probe and the schedule view show it; a mail can be
   added later without a schema change.
4. **The 15 minutes.** Counted from the probe's start (this plan), or from its finish? The
   difference is at most the probe's own duration.
   Answer: From the probe's start.
5. **A manual start on a red chain.** Not gated here. Should the back office warn before a person
   starts a preset whose chain's newest probe is red? That is an admin follow up and needs a mock.
   Answer (the owner's words): "It needs a warning, but a run can be started anyway. As part of
   your work, add a new plan to implement that warning on the admin." The plan is
   `apps/luna-shopper-admin/plans/0069-a-start-warns-when-the-newest-probe-is-red.md`, written in
   this PR and not built by it.

On items 1 to 4 the owner wrote: "Everything else is fine as you wrote".
