# 0026 (backlog) A run call that hangs ends the run

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Found while plan `0269` was reviewed (PR #998, merged on 2026-11-17). Plan `0269` made a
> write that **fails** stop the walk and end the run `FAILED`. It did not touch a write that
> **never answers**. Its D11 says so in one line: "No timeout bounds the wait". This file holds
> what the code does today with a call that hangs, the options, and the decisions the owner has
> to make before it is built. Every code anchor below was read on `origin/dev` at `b4a26b897`
> on 2026-11-18. Paths are relative to
> `apps/luna-shopper-backend/harvester/src/app/` unless they say otherwise.
>
> Prerequisite reading: plan `0038` section 6.6 (the reaper), plan `0206` sections 6 and 7
> (the counter of failures and the retry of an interrupted slot), plan `0215` section 6 (the
> abort path), plan `0218` (the alerts), plan `0269` (all of it, and D4, D9, D10 and D11 in
> particular), `harvest/catalog-client.service.ts`, `harvest/run-report.sink.ts`,
> `harvest/run-executor.service.ts`, `harvest/harvest-run.store.ts` and
> `harvest/supermarket-source.service.ts`.

## Brief for the agent

### Objective

Give every catalog call and every database write that a harvest run makes a time limit of its
own, and make one outcome of a run mean one status, one alert and at most one strike, also when
the reaper marked the run `STALE` before a hung call answered. A call that runs out of time is
a failed write in the sense of plan `0269`: the walk stops and the run ends `FAILED`.

You write production code and specs. A migration is needed only if the owner picks an option
below that needs one; none of the recommended options does.

### Context

- `CatalogClient.send` (`harvest/catalog-client.service.ts:658` to `:674`) awaits
  `firstValueFrom(this.client.send(...))` with no `timeout` operator. The client is registered
  with servers only (`harvest/harvest.module.ts:87` to `:98`). Nest's NATS client publishes
  with a reply inbox and waits on it with no timer
  (`node_modules/@nestjs/microservices/client/client-nats.js:138` to `:163`, version 11.2.8).
  A reply that never comes is waited for forever.
- The harvester's TypeORM connection sets `type`, `url`, `entities` and `synchronize` only
  (`app.module.ts:42` to `:50`). No `statement_timeout`, `lock_timeout` or query timeout is set
  anywhere in the harvester, its Helm values or its Postgres configuration.
- Other code here already bounds a NATS call: `kilo-pieces.ts:21` and `:79` (30 s), the
  gateway's `NatsClient` (`apps/luna-shopper-backend/gateway/src/app/messaging/nats-client.ts:56`
  to `:60`, per call `timeoutMs`), catalog's item references client
  (`apps/luna-shopper-backend/catalog/src/app/catalog/item-references.client.ts:33`, 5 s).
- The run's own write paths that call catalog: `source-ingest.ts:1158` (`linkItemImages`),
  `:1182` (`unlinkItemImages`) and `:1919` (`addPrices`), and in the sink
  `run-report.sink.ts:794` (`fillPackCounts`), `:851` (`setApproxWeights`) and `:1360` and
  `:1368` (`setAvailability`), and the place writes of `discovered-place.service.ts` (for
  example `:1079` `createLocation`).
- Section 1 below states, with file and line, what a hang does to the run, the reaper, the
  alert and the counter of failures today.

### Target state

1. Every call of `CatalogClient` rejects after a stated time with a named timeout error.
2. Every statement the harvester sends to its database is cancelled by Postgres after a stated
   time, and a statement that waits on a row lock gives up after a shorter stated time.
3. A timeout inside the sink's chain is a failed write: plan `0269` section 1 handles it with
   no new path, and the run ends `FAILED` with the write sentence of plan `0269` D11.
4. A finished run is never finished again. A late outcome of a run that the reaper marked
   `STALE` writes no status, no alert and no strike, and leaves one line in the run's report.
5. The counter of failures is written with one statement that names only its own columns, so
   a run never writes back a source row it read when it started.
6. Specs on real Postgres prove the statement timeout, the lock timeout and the guarded finish.

### Scope

- `harvest/catalog-client.service.ts` and its spec.
- `app.module.ts` (the TypeORM options), and `db/data-source.ts` only if the owner decides the
  migrations run with the same limits (D3).
- `harvest/harvest-run.store.ts` (`finish`), `harvest/run-executor.service.ts` (what a finish
  that changed no row does), `harvest/supermarket-source.service.ts`
  (`recordRunStarted`, `recordRunFinished`).
- `harvest/run-report.sink.ts` only for the heartbeat of D8.
- New specs, listed under Tests.

### Constraints

- A timeout is a failed write. It goes through `RunReportSink.fail` and `onWriteFailed`
  exactly as a rejection does today (`run-report.sink.ts:909` to `:957`). No second stop path.
- A catalog call that timed out may still commit in catalog. The harvester cannot know. The
  run's sentence says the write may have landed, as plan `0269` D9 already says of a failed
  chunk.
- No retry of a timed out write. A retry of `addPrices` can write a price twice, and the price
  rule (plan `0080`) has no idempotency key for a batch.
- Every limit is below `HARVEST_STALE_AFTER` (900 s by default, `config/app-config.ts:100` and
  `:300`), so a live run fails by its limit before the reaper takes it for dead.
- `RunReport` keeps its shape and its methods stay synchronous (plan `0103` D1).
- Nothing here changes what an abort keeps (plan `0215` section 6.1) or the rule of plan
  `0269` D10.

### Action boundaries

- Stop and ask before you set a limit on the refresh path, the probe, an adapter's HTTP
  client, or catalog's own database.
- Stop and ask before you add a retry of any write.
- Stop and ask if a statement that a run or a person makes today takes longer than the limit
  the owner chose on a realistic catalog (a copy of the locked slot 3 catalog volume, or a dump
  of slot 0 into an ephemeral slot). Name the statement and its time.
- Stop and ask before you change what the reaper treats as stale, or its window.

### Progress evidence

The output of `nx test` for the specs below, the output of the integration specs under
`test-integration` on an ephemeral slot, the measured time of the slowest run statement and
the slowest catalog call on the slot 3 catalog copy (the numbers D1 and D2 are chosen from),
and `npx nx build luna-shopper-backend-harvester`.

## 1. What the code does today

Each statement of the finding as it was reported, checked against the code.

**1.1 A catalog call made for a run has no time limit. True.** `CatalogClient.send`
(`harvest/catalog-client.service.ts:672`) is `firstValueFrom` over Nest's `send` with no
`timeout`, and the module passes no timeout option (`harvest/harvest.module.ts:87` to `:98`).
Nest's client waits on its reply inbox with no timer (`client-nats.js:150` to `:157`). If
catalog takes the message and never answers (a pod that restarts mid request, a catalog
statement that waits on a lock), the promise never settles and never rejects.

**1.2 A database write made for a run has no time limit. True.** No `extra`, no `options` and
no `statement_timeout` in the TypeORM options (`app.module.ts:44` to `:49`). The repository
holds the words `statement_timeout` and `lock_timeout` only in the text of plan `0229`. A write
that waits on a row lock held by another transaction (a person's accept in
`source-entry.service.ts`, a batch decision, a product merge) waits as long as that lock is
held. node-postgres sets no query timeout unless one is passed.

**1.3 A write that hangs keeps the run in flight. True, with a detail.** The sink chains every
write (`run-report.sink.ts:919`). `report.product` never waits (`:525` to `:538`), so during a
walk a hung chunk does not stop the runner: it walks to the end, every later chunk is queued in
memory behind the hung one, and the runner's own `report` and `heartbeat` calls keep the
heartbeat moving (for Mercadona `harvest/mercadona-catalog.runner.ts:150`, `:274`, `:339`).
When the runner returns, the executor awaits `sink.drain()` (`run-executor.service.ts:631`),
which awaits the chain (`run-report.sink.ts:627`). From then on nothing moves the heartbeat.
After a runner that threw, `sink.settle()` waits the same way, and the code says so: "No
timeout: this waits as long as the queued writes take" (`run-executor.service.ts:612`). The
abort poll keeps firing every 2 s (`:394` to `:400`) and the run stays in `inFlight` until the
`finally` (`:759` to `:763`).

**1.4 The reaper marks the run `STALE` after its window and sends an alert. True.**
`HarvestRunService.reapStale` (`harvest/harvest-run.service.ts:839` to `:852`) calls
`HarvestRunStore.reapStale` (`harvest/harvest-run.store.ts:606` to `:647`), which marks every
`RUNNING` or `PENDING` run whose heartbeat is older than `HARVEST_STALE_AFTER` and writes a
`RUN_STALE` alert in the same transaction (`:623` to `:631`, `staleAlertOf` at `:659`). The
`STALE` status releases the chain's lock, the partial unique index `uq_harvest_run_active`
(`db/migrations/1756200000000-InitialHarvesterSchema.ts:109`). A new run of the chain can then
start, by a person or by the scheduler's one retry of an interrupted slot
(`harvest/harvest-schedule.store.ts:227` to `:242`), while the old executor still holds its
queued chunks.

**1.5 If the hung write later fails, the executor writes `FAILED` over `STALE`. True.** The
drain rejects, the catch branch picks `FAILED` (`run-executor.service.ts:729` to `:736`) and
calls `finishWith` (`:755`), which calls `HarvestRunStore.finish`. `finish` updates by id only,
`{ id: runId }`, with no condition on the status (`harvest/harvest-run.store.ts:557` and
`:561`). The same is true of a late success: a hung call that answers after the reap lets the
drain finish, and the run is finished `COMPLETED` over `STALE` (`run-executor.service.ts:712`).
The code states the opposite rule in one place: `FINISHED_STATUSES` is "The statuses a run
never leaves" and lists `STALE` (`harvest/harvest-run.service.ts:227` to `:233`).

For a catalog call, "later fails" may never come: Nest's client has no timer (1.1), so a lost
reply is a promise that never settles. The run then stays `STALE` for good, and the executor's
promise, its abort poll and every queued chunk stay in memory until the pod restarts.

**1.6 The late `FAILED` sends a second alert. Not true.** The alert of a run has the key
`run:<runId>` for every kind (`harvest/alerts/harvest-alert.rules.ts:247`), and the insert is
`ON CONFLICT ("dedupeKey") DO NOTHING` (`harvest/alerts/harvest-alert.store.ts:28` to `:32`).
The `RUN_FAILED` draft of the late finish therefore inserts nothing, and the owner gets one
mail, the `RUN_STALE` one. The status of the run then says `FAILED` while its only alert says
`STALE`. One exception: when the reaper could not write the stale alert, it reaps with no
alert (`harvest/harvest-run.store.ts:632` to `:644`), and the late `FAILED` then writes the
run's first and only alert.

**1.7 The late `FAILED` counts a second strike. Not true: it counts the first.** The reaper
never calls `recordRunFinished`, so `STALE` counts no strike (`harvest/harvest-run.store.ts:606`
to `:647`). The late finish calls `recordVerdict` (`run-executor.service.ts:756`), which counts
every status except `ABORTED` (`:927` to `:938`). So a hung run that later fails counts one
strike, and one that later succeeds resets the counter to 0. Three strikes stop a chain's
schedules (`SOURCE_FAILING_AFTER = 3`, `harvest/harvest-run.service.ts:88`, read at `:209`).

**1.8 Found while checking 1.7: the strike is written from a source row read at the start of
the run.** `execute` reads the source once (`run-executor.service.ts:372` to `:374`).
`recordRunFinished` adds 1 to that cached entity and calls `save`
(`harvest/supermarket-source.service.ts:259` to `:270`), as `recordRunStarted` does at the
start (`:249` to `:252`). TypeORM's `save` writes every column that differs from the database,
so a run that finishes hours later writes back the `consecutiveFailures`, `enabled`, `workers`,
`maxRequestsPerSecond`, `config` and `autoImportPlaces` it read when it started
(`entities/supermarket-source.entity.ts:41` to `:90`). A person who turned the chain's row off
during the run sees it on again, and a run of another chain finishing in between does not
matter, but a second run of the same chain (possible after a reap, 1.4) loses its strike or its
reset. This is the defect plan `0269` fixed for source entries, on another table. It is
recorded here because the strike path goes through it; D5 asks whether this plan fixes it.

**1.9 What an abort does while a call hangs.** A person's abort sets `abortRequestedAt` and
aborts the controller (`harvest/harvest-run.service.ts:600` to `:605`). The runner stops, but no
catalog call and no TypeORM query reads the signal, and the drain still awaits the chain. The
abort therefore does not end the run. After the reap, `requestAbort` changes nothing on a run
that is not `PENDING` or `RUNNING` (`harvest/harvest-run.store.ts:512` to `:522`). A `SIGTERM`
aborts the same way (`run-executor.service.ts:991` to `:1001`) and waits until the pod's
`terminationGracePeriodSeconds` (30 s, `k8s/helm/velista/values.yaml:172`) kills it; the run
then stays `RUNNING` until the reaper.

## 2. A time limit per catalog call

**Option A. One limit for every call.** A `timeout` operator in `CatalogClient.send`, one
constant, a named `CatalogTimeoutError` that names the subject and the limit.

**Option B. A limit per kind of call.** The same operator, with a default for reads and single
row writes and a longer budget for the batch writes whose time grows with their size
(`addPrices`, `setAvailability`, `fillPackCounts`, `setApproxWeights`, `linkItemImages`,
`withdrawPrices`, the delisting writes). The budget is a property of the method, not of the
caller.

**Recommended: B**, with the numbers measured first. A batch of 400 prices with its recompute
(plan `0080`) is not a single row update, and one number either cuts a healthy batch or waits
far too long on a lost reply. The builder measures the slowest call of each kind on the slot 3
catalog copy and the owner picks the numbers from that. As a starting point to measure
against: 30 s for a read or a single row write (the number of `kilo-pieces.ts:21`) and 120 s
for a batch write. Both are far below the 900 s stale window.

**What a timeout does.** Inside the sink's chain it rejects the chunk, and plan `0269` section 1
does the rest: the first failure is kept, `onWriteFailed` aborts the run with a
`ReportWriteFailedError`, the walk stops, the drain rejects, the run ends `FAILED`. The kind of
the failure is the kind of the chunk, as today, and the sentence of that kind already says the
chunk may have written part of its rows and prices (plan `0269` D11.3). Outside the chain (the
reads before the walk, `copyTargets`, `walkedScopes`, the scope resolver) a timeout is an error
of the runner and ends the run `FAILED` through the catch branch, as any thrown error does.

**What it does not do.** It does not cancel catalog's work. The call may commit after the
harvester gave up, which is why no write is retried (Constraints).

## 3. A time limit per database write

**Option A. Pool wide limits.** `statement_timeout` and `lock_timeout` on every connection of
the harvester's pool, through the TypeORM `extra` options of the `pg` driver. A statement over
the limit fails with SQLSTATE `57014` (`query_canceled`), a lock wait over the limit with
`55P03` (`lock_not_available`).

**Option B. Limits on the run's writes only.** `SET LOCAL statement_timeout` and
`SET LOCAL lock_timeout` inside each transaction that a run opens, and nothing for the admin
routes.

**Option C. Both.** A generous pool wide `statement_timeout` as a floor for everything, and a
shorter `lock_timeout` for the run's writes.

**Recommended: A**, with a `lock_timeout` well below the `statement_timeout`. The hang this plan
is about is most likely a lock wait behind a person's decision or a product merge, and a pool
wide limit also covers every write a run makes outside a transaction (most of
`source-ingest.ts` writes with plain `update` since plan `0269`). Option B misses those unless
every write is moved into a transaction. As a starting point to measure against:
`statement_timeout` 60 s, `lock_timeout` 10 s. The builder first lists the slowest statements
that a person can start (a revert, a batch decision of a thousand rows, a product merge, the
dashboard) and their times on the slot 3 copy. A statement close to the limit is named to the
owner before the limit is set (Action boundaries).

**What a timeout does.** The same as 2: inside the chain a failed write, outside it an error of
the runner. Postgres rolls back the statement or its transaction, so a timed out database write,
unlike a catalog call, did not land.

## 4. A finished run is never finished again

**Option A. A guarded finish.** `HarvestRunStore.finish` updates only a run that is `PENDING`
or `RUNNING` (`WHERE "id" = $1 AND "status" IN ('PENDING', 'RUNNING')`) and answers whether it
changed a row. In the transaction with an alert, the alert is inserted only when the status
changed. The executor calls `recordVerdict` only when `finish` answered yes. When it answered
no, the executor logs the late outcome and merges one field into the run's report,
`lateOutcome: { status, error, at }`, so the run page can say that a run marked `STALE` later
failed or completed.

**Option B. The late outcome wins.** The late status replaces `STALE`, the late alert is
written under a key of its own, and the strike counts. This is today's behaviour made
deliberate, with a second mail.

**Option C. The reaper never reaps a run that its own process still runs.** The reaper skips a
run that `RunExecutor.isRunning` answers yes for. This holds for one pod only, and a hung call
with no limit would then hold the chain's lock until the pod restarts.

**Recommended: A.** It makes the code obey the rule `FINISHED_STATUSES` already states. One
outcome is then one status (the first one written), one alert (the alert of that status, which
the `run:<runId>` key already ensures by accident and the guard ensures by design) and at most
one strike (the strike of that status). With the limits of 2 and 3 in place, a live run fails
by its limit before the reaper's window, so A only decides the case of a process that the
reaper rightly took for dead.

**What counts as a strike for `STALE`.** Today none (1.7). With A, a reaped run counts none and
its late outcome counts none, so a run that hung counts no strike at all. The alternative is to
count one strike at the reap. Recommended: none, as today. A reap says the process stopped
writing its heartbeat, which a deploy that kills a pod also does, and an abort by a deploy is
not a failure of the chain (plan `0206`). With the limits in place, a hang is no longer a reap:
it is a `FAILED` run, and that counts (plan `0269` D4).

## 5. The lock and the abort while a call hangs

**The lock.** The chain's lock is the run's `RUNNING` row. With limits, the longest a live run
can hold the lock without progress is the longest limit of one call. Two options:

- **A.** The drain and the settle touch the heartbeat after each call that answered
  (`RunContext.heartbeat`, throttled as today), so a drain of many slow but healthy chunks is
  never reaped. Each single limit stays below the stale window.
- **B.** Nothing moves the heartbeat in the drain, as today, and the limits alone keep the run
  inside the window.

**Recommended: A.** A drain of a big walk writes many chunks in a row with no runner around to
move the heartbeat, and their sum, not one call, is what can reach 900 s.

**The abort.** Two options:

- **A.** An abort does not cut a call in flight. The call ends by its answer or its limit, then
  the drain goes on as plan `0215` section 6.1 says, because an abort keeps what was read.
- **B.** `CatalogClient` takes the run's signal and stops waiting on an abort.

**Recommended: A.** B stops the wait but not catalog's work, so it turns an abort into a failed
write of unknown outcome, and the drain that should keep what was read fails instead. With a
limit, an abort waits at most one limit. A `SIGTERM` keeps its grace period as the bound; a call
whose limit is longer than 30 s can outlive the pod, which leaves the run to the reaper as
today. D7 asks whether the grace period should grow to the longest limit.

## 6. What this plan leaves as it is

- **An adapter's HTTP timeouts toward a storefront.** Each adapter library and runner keeps its
  own (for example `harvest/eljamon-catalog.runner.ts:43`). A storefront that never answers is a
  fetch problem, not a write problem.
- **The refresh path of plan `0216`.** It has its own limit, `REFRESH_TIMEOUT_MS`
  (`harvest/price-refresh.service.ts:59`, `:389`), and no run.
- **The probe of plan `0219`.** It has its own deadline (`harvest/probes/source-probe.service.ts:246`)
  and writes only `source_probes`.
- **Catalog's own database.** A catalog statement that hangs is bounded, from the harvester's
  side, by the catalog call's limit. Limits inside catalog are catalog's plan.
- **The reaper's window and its rule of what is stale.**
- **The revert.** A run marked `STALE` can be reverted (`FINISHED_STATUSES`) while a late write
  of its process can still land. With the limits, a live run is no longer reaped, so this needs
  a dead looking process that is alive, and this plan adds no guard for it.
- **An abort followed by a failure of the run's final steps ends `ABORTED`.** The catch branch
  picks `ABORTED` when the signal was aborted and the failure is neither a stop of the guard, a
  runner that threw first, nor a failed write of the sink (`run-executor.service.ts:729` to
  `:736`). So an abort followed by a failure of `recordRefusals`, `context.flush`, the delisting
  count or the report write ends `ABORTED`, while an abort followed by a failed write of the
  sink ends `FAILED` (plan `0269` D10). **The owner accepted this as it is on 2026-11-18.** A
  builder of this plan does not change it. A catalog or database timeout in those final steps
  therefore also ends an aborted run `ABORTED`, and that is the accepted rule, not a defect of
  this plan.

## Tests

**Unit specs.**

- `catalog-client.service.spec.ts`: a fake `ClientProxy` whose observable never emits. Under
  Jest fake timers, each method rejects with `CatalogTimeoutError` at its budget and not before,
  and the error names the subject and the limit. A table spec asserts the budget of every
  method, so a new method cannot be added with none.
- `run-report.sink.spec.ts`: a chunk whose catalog call rejects with `CatalogTimeoutError` is a
  failed write: `onWriteFailed` once, no later work, `drain()` rejects with it. With D8, the
  drain touches the heartbeat between chunks.
- A new executor spec in the shape of `run-executor.guard.spec.ts`: a run whose sink times out
  ends `FAILED` with the write sentence, one alert, one `recordVerdict`. A store whose `finish`
  answers that it changed no row (the run was reaped meanwhile) leads to no alert, no
  `recordVerdict` and one `lateOutcome` in the report.

**Integration specs on real Postgres** (`harvest/run-time-limits.integration.spec.ts`, in the
shape of `harvest/walk-keeps-decisions.integration.spec.ts`, run under `test-integration` with
`LUNA_INTEGRATION=1`). A statement timeout and a lock timeout are Postgres behaviour, and only
Postgres proves them.

1. **The statement timeout.** `SELECT pg_sleep(<limit + 1 s>)` through the harvester's own
   `DataSource` options fails with SQLSTATE `57014` near the limit.
2. **The lock timeout.** A second connection holds a row of `source_catalog_entries` with
   `SELECT ... FOR UPDATE` in an open transaction. The ingest's write of that row fails with
   `55P03` near the lock limit, and through a real `RunReportSink` the run's sink keeps it as its
   first failure.
3. **The guarded finish.** A run row `STALE` with its `RUN_STALE` alert. `finish(FAILED)` with
   an alert answers no, leaves the status `STALE`, and inserts no alert row. A `RUNNING` row
   still finishes and answers yes.
4. **The strike, if D5 is A.** A person turns the chain's row off while a run is in flight.
   The run's `recordRunFinished` leaves `enabled` false and adds 1 to the counter the database
   holds, not to the one the run read.

Each case fails on `origin/dev` and passes on the branch.

## Acceptance criteria

- [ ] Every `CatalogClient` call rejects after its stated budget.
- [ ] Every harvester statement is cancelled after the stated `statement_timeout`, and a lock
      wait after the stated `lock_timeout`.
- [ ] A timeout inside a run ends the run `FAILED` through the path of plan `0269`, and the
      process lives.
- [ ] A run marked `STALE` keeps `STALE`, its one alert and no strike, whatever its process
      does after the reap.
- [ ] No write of the counter of failures writes back a column the run read at its start.
- [ ] The integration specs fail on `origin/dev` and pass on the branch.

## Verification

```sh
npx nx test luna-shopper-backend-harvester -t "CatalogClient"
npx nx test luna-shopper-backend-harvester -t "RunReportSink"
npx nx test luna-shopper-backend-harvester -t "RunExecutor"
npx nx build luna-shopper-backend-harvester

bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services harvester
# HARVESTER_DB_URL is in $TMPDIR/luna-slot-ephemeral/slot<n>/env/apps/luna-shopper-backend/harvester/.env
LUNA_INTEGRATION=1 HARVESTER_DB_URL=<url> \
  npx nx run luna-shopper-backend-harvester:test-integration \
    --testFile=run-time-limits.integration.spec.ts
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --down <n>

npx nx affected -t lint test
```

## Open decisions

All of these wait for the owner. None is answered.

**D1. The catalog call limit: one for all, or one per kind (section 2). Open.** Recommended: per
kind, a default for reads and single row writes and a longer budget for the batch writes, the
numbers chosen from a measurement on the slot 3 catalog copy (starting points 30 s and 120 s).

**D2. The database limits (section 3). Open.** Recommended: a pool wide `statement_timeout` and
a shorter pool wide `lock_timeout` (starting points 60 s and 10 s), after the slowest statement
a person can start is measured and named.

**D3. The migrations. Open.** `db/data-source.ts` is the CLI's own connection. Recommended: no
limit there, because a migration that rewrites a large table is meant to run long and runs with
nobody waiting on it.

**D4. A timeout is a failed write and ends the run `FAILED` (section 2). Open.** Recommended:
yes, through the path of plan `0269` with no new path, and it counts a strike as any `FAILED`
run does (plan `0269` D4).

**D5. The source row written from a read at the start of the run (1.8). Open.** Recommended: fix
it in this plan, because the strike path goes through it: `recordRunStarted` and
`recordRunFinished` each become one `UPDATE` that names only `lastRunAt`, `lastSuccessAt` and
`consecutiveFailures`, with `"consecutiveFailures" + 1` in the statement. The other choice is a
plan of its own.

**D6. A terminal state is never overwritten (section 4). Open.** Recommended: option A, the
guarded finish. One outcome is one status, one alert and at most one strike, and a late outcome
leaves only `lateOutcome` in the report.

**D7. `STALE` counts no strike, and neither does a late outcome after it (section 4). Open.**
Recommended: yes, as today for `STALE`. With the limits, a hang becomes `FAILED` and counts.

**D8. The drain moves the heartbeat (section 5). Open.** Recommended: yes, after each call that
answered, throttled as today.

**D9. An abort does not cut a call in flight (section 5). Open.** Recommended: yes, the call ends
by its answer or its limit, and the drain keeps what was read.

**D10. The pod's grace period and the longest limit (section 5). Open.** Recommended: leave the
grace period at 30 s and let a call that outlives a `SIGTERM` leave its run to the reaper, as
today. The other choice is a grace period at least as long as the longest limit, which slows
every deploy of the velista unit by that much.

**Recorded, not open.** An abort followed by a failure of the run's final steps ends `ABORTED`,
while an abort followed by a failed write ends `FAILED` (plan `0269` D10). The owner accepted
this on 2026-11-18 (section 6). It is not a decision of this plan.
