> **PR:** [#708](https://github.com/IchirokuXVI/nx-portfolio/pull/708)

# 0206: a preset runs on a schedule

> Admin half: not written. The screens need a mock first, and the owner has not seen one.
>
> Every chain run today is started by a person. This plan lets a saved preset (plan `0120`) start
> by itself at a time of day, on chosen days of the week, in a named timezone. The schedule is a row
> in the harvester database, and a timer in the harvester polls for the rows that are due. Nothing
> about a schedule lives in the memory of the process, so a restart loses no schedule. A run that a
> deploy stops is started again one time. Each run and each preset states about how long it takes,
> measured from the runs before it.
>
> Prerequisite reading: `0120` (presets, and the sentence "a schedule names a preset"), `0038`
> sections 4.1 and 8.1 (why no scheduler was built, and the politeness argument that this plan
> changes), `0083` (the per chain switch), backlog `0001` sections 7.6 to 7.8 (the first design,
> which section 13 of this plan replaces in part), `harvest-run.service.ts`,
> `run-executor.service.ts`, `postal-code-discovery.store.ts` (the claim this plan copies) and
> `postal-code-discovery.worker.ts` (the timer this plan copies).

## Review of 2026-10-11: settle these before you build

A review of pull request #695 checked this plan against the code on `dev`. The
statements about that code hold. The defects are in the rules of sections 5 and 7. Where
this section and a later section disagree, this section is right. A point marked
**owner** needs his decision first: ask, and do not choose.

1. **Section 5.1 says two things about which missed slot is judged.** Step 2 keeps the
   old `nextRunAt` as the slot, which is the oldest slot that was missed. The next
   paragraph says that several missed slots become one decision about the newest of
   them. Take a schedule for each day at 03:00 and a pod that is down from Monday 02:00
   to Wednesday 04:00. Step 2 judges Monday 03:00, which is 49 hours late, and writes
   `SKIPPED_LATE`. The rule of 5.2 says that Wednesday 03:00, one hour late, runs. The
   slot is the last slot at or before now. That needs a function that answers the
   previous slot.
2. **The retry of section 7 fires for a slot that was skipped.** Only a run that starts
   writes `lastRunId` and sets `lastSlotAttempts` to 1. A skip or a refusal moves
   `lastSlotAt` and leaves both. Slot A starts a run, a deploy stops it, and the window
   of the retry passes. Slot B is then `SKIPPED_BUSY`. `lastSlotAt` is B, `lastRunId` is
   the stopped run, and the attempts are 1. All three conditions of the retry hold, and
   the next tick starts a run for slot B. A slot that does not start must set
   `lastSlotAttempts` to 0, or the retry must compare the slot of the run with
   `lastSlotAt`.
3. **The retry is not claimed.** The constraint says that a second harvester process must
   not fire the same slot. Section 5.1 claims in a transaction. Section 7 reads
   `lastSlotAttempts = 1`, starts the run, then writes 2, and two processes can both pass
   that read. Claim the retry with a conditional
   `UPDATE ... WHERE "lastSlotAttempts" = 1 RETURNING` before the start. A crash then
   costs the retry and never makes two.
4. **A retry that cannot start repeats on each tick.** The cases of 5.3 apply to the
   retry, and the attempts stay 1 when no run starts. A retry that meets `SKIPPED_BUSY`,
   `REFUSED` or `SKIPPED_FAILING` is thus tried each 60 seconds until it is too late: up
   to 12 hours for a schedule for each day. **Owner:** does a retry that is refused
   spend the attempt.
5. **`run-services.sh` does not start the harvester**, by its own comment, so it has no
   place for the variable. Remove it from the scope and from the table of section 10.
   `compose.apps.yml` leaves the harvester out for the same reason. The other places are
   right: `app-config.ts`, `.env.example`, the ConfigMap, `_env.tpl`, the three values
   files and `luna-slot.sh`.
6. **`SKIPPED_BUSY` is wider than "the chain has a run in flight".**
   `uq_harvest_run_active_store_discovery` allows one `STORE_DISCOVERY` run in the whole
   database, for any chain, and the runs of the postal code queue count. A scheduled
   store discovery is thus skipped each time the queue drains. Cover that case in the
   note and in the tests.
7. **Text that binds agents becomes false, and no file that holds it is in the scope.**
   `CLAUDE.md` says that neither cluster fetches a storefront and that three switches
   control the harvester. `values.production.yaml` and the README of the chart say to
   leave the row of each chain off. Add those files to the scope, or name the follow up.
8. **Owner: can production fetch Mercadona at all.** The context reports Mercadona runs
   of 10 to 20 minutes on production. An earlier note of the owner's sessions says that
   Mercadona answers 403 from the VPS. Confirm which is true today before a schedule
   names that chain.

**Smaller points.**

- An abort has raised `consecutiveFailures` until now. A source can thus start at 3 or
  more and be `SKIPPED_FAILING` from its first slot. Reset the counter in the migration,
  or state that the first manual run clears it.
- Section 5.3 tests "failing" before "source off". `blockedBy` in section 6 lists
  `SOURCE_DISABLED` before `SOURCE_FAILING`. Use one order.
- The claim uses the `now()` of the database, `nextSlot` uses the clock of the app, and
  the tests pass a clock in. Give the claim the instant as a parameter.
- `acknowledgedAutomaticFetch` is a consent. The pipe of the gateway has read the string
  `"false"` as true on a boolean body before. Give the DTO a strict boolean check and a
  spec for it.
- The executor has two branches that finish a run, and the catch branch writes the
  message of the error. State that the sentence of a shutdown wins in both.
- `HarvestRunView.estimate` is computed on read. On a list page that is one more query
  for each row unless the read batches it.

## Brief for the agent

### Objective

Add a `harvest_schedules` table to the harvester, the routes that create, read, update and delete
a schedule, a timer that starts a run from each schedule that is due, and a run time estimate on
runs, presets and schedules, as sections 1 to 12 describe.

### Context

- `HarvestRunService.spawnFromPreset` (`harvest-run.service.ts:209`) requires an admin credential,
  validates the preset again with `validateRequest`, and calls the private `start` (:257). `start`
  writes `trigger: HarvestRunTrigger.MANUAL` as a literal (:274) and takes a `userId`.
- `HarvestRunTrigger.SCHEDULED` exists in `harvest.enums.ts` and in the Postgres type
  `harvest_run_trigger` since plan `0038`. Nothing writes it. `SYSTEM` is written by the postal
  code worker with `requestedByUserId: null`.
- One active run per chain is the partial unique index `uq_harvest_run_active`. A second run
  answers `ActiveRunExistsError` from the store.
- `start` refuses a source whose `supermarket_sources.enabled` is false (:265).
- `PostalCodeDiscoveryStore.claimNext` (`postal-code-discovery.store.ts:87`) claims one row with
  `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`. Read its comment on the
  shape that an `UPDATE` answers through the TypeORM Postgres driver.
- The harvester has three plain `setInterval` timers and no scheduler dependency.
  `@nestjs/schedule` is not in `package.json`.
- `RunExecutor.onApplicationShutdown` (`run-executor.service.ts:595`) aborts every run in flight on
  SIGTERM. The run flushes and ends `ABORTED`. A person's abort sets `abortRequestedAt`. A shutdown
  does not.
- `RunExecutor.execute` calls `sources.recordRunFinished(source, false)` for every run that does
  not end `COMPLETED` (:546 and :560). An aborted run thus adds one to
  `supermarket_sources.consecutiveFailures` today. Nothing reads that column.
- The harvester runs as one pod with `strategy: Recreate` (`k8s/helm/values.yaml:665`).
  `k8s/helm/deploy-release.sh` sets one `imageTag` for every service, so each production release
  restarts the harvester.
- The latest harvester migration is `1759300000000-SourceEntryImageUrl.ts`. Migrations are listed
  in `harvester/src/app/db/migrations/index.ts` and checked by `migrations.spec.ts`.
- Durations read on production on 2026-10-11, all from `COMPLETED` runs: `lidl-api` 1 minute,
  `mercadona-api` 10 to 20 minutes, `deza-web` 23 minutes, `eljamon-web` 157 minutes.

### Target state

Every acceptance criterion in section 15 holds, the specs of section 14 pass, and `openapi.json`
and the wire types are regenerated.

### Scope

- Work only in:
  - `apps/luna-shopper-backend/harvester/src/app/` (a new entity, a migration, a schedule store, a
    schedule service, a scheduler worker, a slot function, an estimate function,
    `harvest-run.service.ts`, `harvest-run.store.ts`, `run-executor.service.ts`,
    `harvest-run-preset.service.ts`, the run entity, the mappers, the controller, the module,
    `config/app-config.ts`, `.env.example`).
  - `apps/luna-shopper-backend/gateway/src/app/harvest/` (a controller and DTOs).
  - `libs/luna-shopper/contracts` (patterns, requests, views, schemas).
  - The files that state `HARVEST_ENABLED` for a deployment, for the one new variable of section
    10: `k8s/helm/templates/luna-shopper-backend/configmap.yaml.tpl`, `_env.tpl`,
    `k8s/helm/values.yaml`, `values.production.yaml`, `values.staging.yaml`,
    `k8s/e2e/luna-shopper-backend/luna-slot.sh` and `run-services.sh`.
  - Their specs, and the generated files.
- Do NOT touch: the runners, the sink, catalog, the postal code worker, the stale run reaper, the
  replica count or the strategy of the harvester, the deploy scripts, and
  `apps/luna-shopper-admin`.

### Constraints

- Add no dependency. The timer is a `setInterval` with `unref`, like the two beside it.
- A scheduled start and a start from a preset by a person go through the **same** `validateRequest`
  and the **same** `start`. Give `start` the trigger and a nullable user id as arguments. Do not
  write a second path that creates a run.
- The claim of a due schedule is one transaction that locks the row with
  `FOR UPDATE SKIP LOCKED`. A second harvester process must not be able to fire the same slot.
- The slot function is pure, takes the clock as an argument, and uses `Intl.DateTimeFormat` with
  the `timeZone` option. It does not read `process.env.TZ`.
- No existing spawn refusal changes its code or its message.
- The migration is additive.
- Regenerate `openapi.json` and the wire types, never by hand.
- No dash as punctuation in a comment or a message. Reword the sentence.

### Action boundaries

- Proceed with in scope edits, specs, the migration file and the generators.
- Stop and ask before you run the migration anywhere but a throwaway slot.
- Stop and ask before you change `harvester.replicas`, the strategy, or a deploy script.
- Stop and ask if section 7 cannot be built without a new column on `harvest_runs` beyond
  `scheduleId`.
- Do not turn a `supermarket_sources` row on in a cluster, and do not create a schedule in a
  cluster. The owner does both from the back office.

### Progress evidence

Report after each of these, with the spec output:

1. The slot function and its specs.
2. The entity, the migration, the store and the claim, with an integration spec on real Postgres.
3. The routes and the estimate.
4. The worker, the late rule and the retry after an interrupted run.

## 1. What is being built

| Piece                                       | Where                                                  |
| ------------------------------------------- | ------------------------------------------------------ |
| `harvest_schedules`                         | a harvester entity and migration                       |
| `nextSlot` and `isTooLate`                  | `harvest/schedule-slot.ts`, pure                       |
| Create, list, read, update, delete, switch  | a schedule service, NATS patterns, gateway routes      |
| The worker that fires due schedules         | `harvest/harvest-schedule.worker.ts`                   |
| `start` takes a trigger and a nullable user | `harvest-run.service.ts`                               |
| `scheduleId` and `interrupted` on a run     | `harvest_runs`, `HarvestRunView`, the runs list filter |
| The run time estimate                       | `harvest/run-estimate.ts`, three views                 |
| An abort is not a source failure            | `run-executor.service.ts`                              |
| `HARVEST_SCHEDULER_ENABLED`                 | the configuration, section 10                          |

## 2. The table

`harvest_schedules`, extending the harvester's `BaseEntity`:

| Column             | Type           | Notes                                                        |
| ------------------ | -------------- | ------------------------------------------------------------ |
| `presetId`         | `uuid`         | not null, indexed, no foreign key (section 2.1)              |
| `supermarketId`    | `uuid`         | not null, indexed, copied from the preset when it is created |
| `timeOfDay`        | `varchar(5)`   | `HH:mm`, 24 hour, checked by a constraint                    |
| `daysOfWeek`       | `smallint[]`   | ISO numbers, 1 is Monday and 7 is Sunday, at least one       |
| `timezone`         | `varchar(64)`  | an IANA name, default `Europe/Madrid`                        |
| `enabled`          | `boolean`      | not null, default true                                       |
| `nextRunAt`        | `timestamptz`  | null while the schedule is off, indexed                      |
| `lastSlotAt`       | `timestamptz`  | the slot the last fire was for                               |
| `lastSlotAttempts` | `smallint`     | not null, default 0, the runs started for `lastSlotAt`       |
| `lastRunId`        | `uuid`         | the last run this schedule started, no foreign key           |
| `lastOutcome`      | enum, nullable | section 5.3                                                  |
| `lastOutcomeAt`    | `timestamptz`  |                                                              |
| `lastOutcomeNote`  | `text`         | the refusal or the id of the run that was in the way         |
| `createdByUserId`  | `uuid`         | not null                                                     |
| `updatedByUserId`  | `uuid`         | not null                                                     |

A preset can have more than one schedule. A walk on Tuesday at 03:00 and on Friday at 22:00 is two
rows, because one row holds one time of day.

The schedule is on its own table and not on `supermarket_sources`. Plan `0038` refused schedule
columns there, and a chain can want two schedules with different presets, for example a weekly
catalog walk and a monthly store list.

### 2.1 A preset with a schedule cannot be deleted

`harvestPreset.delete` answers `ConflictException` and names the schedules while a row of
`harvest_schedules` holds its id. A schedule without a preset can start nothing, and a silent
delete of both removes a crawl that somebody set up on purpose. The check is in
`harvest-run-preset.service.ts`. There is no foreign key, for the reason `harvest_runs.presetId`
has none: the harvester's tables do not cascade.

## 3. When a schedule is due

`schedule-slot.ts` exports two pure functions.

```ts
/** The first slot strictly after `after`. */
function nextSlot(rule: SlotRule, after: Date): Date;

/** Whether a slot that was due at `slot` is too old to run at `now`. */
function isTooLate(rule: SlotRule, slot: Date, now: Date): boolean;

interface SlotRule {
  timeOfDay: string;
  daysOfWeek: readonly number[];
  timezone: string;
}
```

`nextSlot` walks forward one local day at a time in the timezone of the rule, at most eight days,
and answers the instant at which the wall clock of that timezone reads `timeOfDay` on a day in
`daysOfWeek`.

Two cases come from daylight saving time, and both have a stated answer:

- **A time that does not exist** (02:30 on the night the clock goes forward) answers the first
  instant after the gap. The schedule fires one time that day, not zero times.
- **A time that occurs two times** (02:30 on the night the clock goes back) answers the first of
  the two. The schedule fires one time that day, not two.

`isTooLate` is the rule for a missed slot, section 5.2.

## 4. The routes

NATS patterns in a new `HARVEST_SCHEDULE_PATTERNS`:

| Pattern                      | Request                                                                  | Answer                         |
| ---------------------------- | ------------------------------------------------------------------------ | ------------------------------ |
| `harvestSchedule.list`       | `supermarketId?`, `presetId?`, `cursor?`, `limit?`                       | a page of `HarvestScheduleView` |
| `harvestSchedule.get`        | `scheduleId`                                                             | `HarvestScheduleView`          |
| `harvestSchedule.create`     | `presetId`, `timeOfDay`, `daysOfWeek`, `timezone?`, `acknowledgedAutomaticFetch` | `HarvestScheduleView`  |
| `harvestSchedule.update`     | `scheduleId`, `timeOfDay?`, `daysOfWeek?`, `timezone?`                   | `HarvestScheduleView`          |
| `harvestSchedule.setEnabled` | `scheduleId`, `enabled`, `acknowledgedAutomaticFetch?`                   | `HarvestScheduleView`          |
| `harvestSchedule.delete`     | `scheduleId`                                                             | nothing                        |

Each request extends `AdminCredential`. The preset of a schedule never changes. To point at
another preset, delete the schedule and create one.

Gateway, in a new `AdminHarvestSchedulesController`:

| Route                                          | Pattern                      |
| ---------------------------------------------- | ---------------------------- |
| `GET /v1/admin/harvest/schedules`              | `harvestSchedule.list`       |
| `POST /v1/admin/harvest/schedules`             | `harvestSchedule.create`     |
| `GET /v1/admin/harvest/schedules/:id`          | `harvestSchedule.get`        |
| `PUT /v1/admin/harvest/schedules/:id`          | `harvestSchedule.update`     |
| `PUT /v1/admin/harvest/schedules/:id/enabled`  | `harvestSchedule.setEnabled` |
| `DELETE /v1/admin/harvest/schedules/:id`       | `harvestSchedule.delete`     |

The list is paged with the house cursor and ordered by `nextRunAt`, with the rows that are off
last.

### 4.1 The person says that they know

**`acknowledgedAutomaticFetch` must be `true` to create a schedule and to switch one on.** Without
it the request is a `ValidationException` that names the field.

Plan `0038` section 8.1 defended the fetching with the sentence "every request happens because a
person asked". A schedule ends that for the chain it names. The owner decided on 2026-10-11 that
a scheduled storefront crawl is acceptable, and that the person who sets one up is warned. The
field is how the backend knows that the warning was shown: a client that never drew it cannot send
`true` by accident. The copy of the warning belongs to the admin plan.

### 4.2 What a write does to `nextRunAt`

- **Create** and **switch on**: `nextRunAt = nextSlot(rule, now)`.
- **Update** of the time, the days or the timezone, while on: the same.
- **Switch off**: `nextRunAt = null`. `lastSlotAt` and the outcome stay, as the history.

A create or an update also validates the rule: `timeOfDay` matches `HH:mm`, `daysOfWeek` is one to
seven different numbers from 1 to 7, and `timezone` is a name that `Intl.DateTimeFormat` accepts.

### 4.3 The view

```ts
interface HarvestScheduleView {
  id: string;
  presetId: string;
  presetName: string;
  supermarketId: string;
  timeOfDay: string;
  daysOfWeek: number[];
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  /** Why no run can start at `nextRunAt` as things are now, or null. Section 6. */
  blockedBy: HarvestScheduleBlock | null;
  lastSlotAt: string | null;
  lastOutcome: HarvestScheduleOutcome | null;
  lastOutcomeAt: string | null;
  lastOutcomeNote: string | null;
  lastRun: { id: string; status: HarvestRunStatus; requestedAt: string } | null;
  estimate: RunEstimate;
  createdAt: string;
  updatedAt: string;
}
```

## 5. The worker

`HarvestScheduleWorker`, with the lifecycle hooks of `PostalCodeDiscoveryWorker`: a timer in
`onModuleInit`, cleared in `onModuleDestroy`, and a `stopping` flag set in
`onApplicationShutdown`. The timer fires every 60 seconds. One tick runs at a time in a process.

A tick does nothing unless `HARVEST_ENABLED` and `HARVEST_SCHEDULER_ENABLED` are both true. It
then does two things in order: the retry of section 7, then the due schedules.

### 5.1 The claim

For each due schedule, one transaction:

1. Select one row where `enabled` and `nextRunAt <= now()`, ordered by `nextRunAt`, with
   `FOR UPDATE SKIP LOCKED`.
2. Keep the old `nextRunAt` as the slot. Write `nextRunAt = nextSlot(rule, now)`.
3. Commit.

The worker decides what to do with the slot after the commit. The slot is thus spent before any
run starts, and a crash between the two loses one slot and never fires one two times.

`nextSlot` is taken from `now` and not from the slot. Several slots missed in a row thus become
one decision about the newest of them, and never a queue of catch up runs.

### 5.2 A slot that is late

**A late slot still runs if less than half of the gap to the slot after it has passed.**

`isTooLate(rule, slot, now)` answers true when `now - slot` is more than half of
`nextSlot(rule, slot) - slot`. A weekly schedule catches up for three and a half days. A daily one
catches up for twelve hours. There is no setting for it.

A slot is late after the pod was down at the time, after the switch was off, and after the tick
before it was busy. All three get the same rule.

### 5.3 What happens to a slot

| Case                                                           | `lastOutcome`     | A run starts |
| -------------------------------------------------------------- | ----------------- | ------------ |
| `isTooLate` is true                                            | `SKIPPED_LATE`    | no           |
| The source has three or more consecutive failures (section 6)  | `SKIPPED_FAILING` | no           |
| `validateRequest` refuses, or the source row is off            | `REFUSED`         | no           |
| The chain has a run in flight                                  | `SKIPPED_BUSY`    | no           |
| Otherwise                                                      | `STARTED`         | yes          |

Each case writes `lastSlotAt`, `lastOutcome`, `lastOutcomeAt` and `lastOutcomeNote`. A started run
also writes `lastRunId` and sets `lastSlotAttempts` to 1.

**A slot that cannot start is skipped and not queued.** The next slot is the retry. A queue of
waiting runs holds the lock of a chain for a run that nobody is watching, and a daily walk that
waits six hours for a slow one is two walks close together for no gain.

The worker never throws out of a tick. An error is logged and written as `REFUSED` with its
message, as the drain of the postal code queue does.

### 5.4 The start

`HarvestRunService.startScheduled(schedule)` loads the preset and the source, calls
`validateRequest`, and calls `start` with:

- `trigger: HarvestRunTrigger.SCHEDULED`,
- `requestedByUserId: null`, because no person asked for this run,
- `presetId` of the schedule, and the new `scheduleId`.

It takes no credential. It is not a NATS handler and nothing outside the harvester can call it.

`spawn` and `spawnFromPreset` pass `MANUAL` and the user id, as today.

## 6. A source that keeps failing

A due schedule is skipped with `SKIPPED_FAILING` while
`supermarket_sources.consecutiveFailures` is 3 or more. The schedule stays on.

`recordRunFinished` already resets the counter to 0 after a run that ends `COMPLETED`. So the
way out is a run by a person: they read what is wrong, start the preset by hand, and the first run
that completes lets the schedule fire again. There is no pause state to clear and no second
switch.

**An abort is not a failure of the source.** `RunExecutor.execute` calls
`recordRunFinished(source, false)` for an `ABORTED` run today, in both of its branches. Change
both: a run that ends `ABORTED` does not call `recordRunFinished` at all. A person who stops a run
and a deploy that stops one say nothing about the chain. Without this change, three releases in
a week stop every schedule.

`HarvestScheduleView.blockedBy` states what stands in the way of the next slot, so the back office
can show it before the slot arrives and not only after:

| Value               | When                                             |
| ------------------- | ------------------------------------------------ |
| `HARVEST_DISABLED`  | `HARVEST_ENABLED` is false                       |
| `SCHEDULER_DISABLED`| `HARVEST_SCHEDULER_ENABLED` is false             |
| `SOURCE_DISABLED`   | the `supermarket_sources` row of the chain is off |
| `SOURCE_FAILING`    | the counter is 3 or more                         |

The first that applies, in that order. It is computed on read and not stored.

**The row of the chain must stay on for a schedule to run.** All four rows were off on production
on 2026-10-11, switched on for a run and off after it. That habit and a schedule do not work
together, and `SOURCE_DISABLED` is how the back office says so.

## 7. A run that a deploy stopped

A release restarts the harvester, and a run in flight ends `ABORTED` within the 30 seconds the pod
has. The owner decided that this is not a failure. This plan also starts the run again, one time.

**How a stopped run is told from an aborted one.** A run is interrupted when its status is
`ABORTED` and its `abortRequestedAt` is null, or when its status is `STALE`. A person's abort
always sets `abortRequestedAt`. No new column is needed. `HarvestRunView` gains
`interrupted: boolean` with that meaning, and the executor writes
`'Stopped because the harvester shut down.'` as the `error` of a run it aborts in
`onApplicationShutdown`, so the run page says why.

**The retry**, at the start of each tick, for each schedule that is on:

1. Its `lastRunId` names a run that is interrupted.
2. Its `lastSlotAttempts` is 1.
3. `isTooLate(rule, lastSlotAt, now)` is false.

When all three hold, the worker starts the preset again as section 5.4 describes, writes the new
`lastRunId`, and sets `lastSlotAttempts` to 2. The cases of section 5.3 apply to this start too,
except that `lastSlotAt` does not move.

`lastSlotAttempts` is what makes it one retry. A second interrupted run for the same slot has the
value 2 and is left alone. The next slot starts fresh.

The retry is a whole new run. Nothing resumes. A Mercadona walk that is started again costs twenty
minutes. An El Jamón walk costs two and a half hours, and section 13 says what would shorten that.

A `STALE` run is the case where 30 seconds were not enough or the pod was killed. The reaper
marks it 15 minutes after its last heartbeat, and the retry follows on the next tick.

## 8. About how long a run takes

`run-estimate.ts` answers:

```ts
interface RunEstimate {
  seconds: number;
  /** Where the number came from. */
  basis: 'PRESET' | 'SOURCE' | 'DEFAULT';
  /** How many finished runs it was taken from, 0 for DEFAULT. */
  samples: number;
}
```

The duration of a run is `finishedAt - startedAt`. Only runs that ended `COMPLETED` and were not
reverted count. The estimate is the median of the newest five, from the first of these that has at
least one run:

1. `PRESET`: runs with the same `presetId`.
2. `SOURCE`: runs with the same `sourceId` and the same `mode`.
3. `DEFAULT`: a constant per `adapterKey`, below.

| `adapterKey`    | Default seconds |
| --------------- | --------------- |
| `lidl-api`      | 60              |
| `mercadona-api` | 1200            |
| `deza-web`      | 1500            |
| `eljamon-web`   | 9600            |
| any other       | 1800            |

The defaults are the durations read on production on 2026-10-11. They go out of date, and the
owner accepted that: one completed run replaces a default.

The median of five, and not the mean of all, because a run gets faster when the workers of a
source are raised. The Mercadona walk went from 20 minutes to 10 between two runs.

Three views carry it:

- `HarvestRunPresetView.estimate`, from the preset.
- `HarvestScheduleView.estimate`, from its preset.
- `HarvestRunView.estimate`, computed when the run is read and **never from the run itself**. A
  run of a preset uses the preset's history, and a run with no preset starts at `SOURCE`.

The view of a run does not state a time remaining. `startedAt` and `estimate.seconds` are both
there, and the client subtracts.

## 9. A run remembers its schedule

`harvest_runs` gains `scheduleId uuid null`, indexed, with no foreign key. Deleting a schedule
leaves its runs as they were.

`HarvestRunView` gains `scheduleId`, `interrupted` and `estimate`. The runs list accepts
`scheduleId` and `trigger` as filters.

## 10. The switch

`HARVEST_SCHEDULER_ENABLED`, a boolean, default **false**. It is separate from `HARVEST_ENABLED`
for the reason that one is separate from the Helm `enabled`: a pod that can run a walk a person
asked for and a pod that starts walks by itself are two decisions.

| Where                        | Value                                                  |
| ---------------------------- | ------------------------------------------------------ |
| `values.yaml`                | `lunaShopperBackend.harvester.schedulerEnabled: false` |
| `values.production.yaml`     | `true`                                                 |
| `values.staging.yaml`        | `false`                                                |
| `luna-slot.sh`               | `false`, in the `.env` it writes for the harvester     |
| `run-services.sh`            | `false`                                                |
| `harvester/.env.example`     | `false`, with one line that says what it does          |

**Staging does not fire schedules.** Two clusters that both fetch the same chain on a timer double
what the chain sees and add nothing. A person can still start a run on staging.

The value does not depend on the slot, so it does not go in `DERIVED_KEYS` of `luna-slot.sh`.

With the switch on and no schedule rows, the worker does nothing. Turning it on in production is
thus safe before the back office has a screen.

The interval of the timer is a constant in the worker, 60 seconds. It is not a variable.

## 11. What stays one process

The harvester stays one pod. The claim of section 5.1 is safe with two, and that is deliberate,
because the owner may put the harvester on more than one server later. It is not a reason to
change `replicas` now: a run still lives in the memory of the pod that started it.

## 12. Errors

| Case                                                        | Exception             |
| ----------------------------------------------------------- | --------------------- |
| an unknown schedule id                                      | `NotFoundException`   |
| an unknown preset id on create                              | `NotFoundException`   |
| a bad `timeOfDay`, `daysOfWeek` or `timezone`               | `ValidationException` |
| `acknowledgedAutomaticFetch` absent or false, on create and on switch on | `ValidationException` |
| deleting a preset that a schedule names                     | `ConflictException`   |

A schedule can be created while the source row is off, while the switch is off, and while the
preset would be refused. Each of those is a state that changes, and `blockedBy` and
`lastOutcome` report it. Refusing the create would make the order of setup matter for no reason.

## 13. What this plan does not do

- **No back office screen.** The admin plan is separate and needs a mock first.
- **No notice to anybody.** A skipped or refused slot is on the schedule's row for a person who
  looks. No mail and no push path exists for the back office.
- **No cap on runs at the same time.** Two chains scheduled for the same minute run together. The
  production node used 4% of its CPU on 2026-10-11. Backlog `0001` section 7.7 describes
  `HARVEST_MAX_CONCURRENT_RUNS`, and it stays there.
- **No schedule for a run without a chain.** A preset belongs to a chain, so an OpenStreetMap
  store discovery cannot be scheduled. The postal code queue covers it.
- **No schedule for a `FILE_IMPORT`.** A preset refuses that mode.
- **No resumed run.** A retry starts from the beginning.
- **No warning in the release script.** `deploy-release.sh` could print a run in flight and its
  estimate before a release. That is a k8s plan.
- **No dynamic cron registry.** Backlog `0001` section 7.6 proposed `@nestjs/schedule` with jobs
  registered from rows. This plan polls a column, because a timer that lives in memory misses a
  slot that falls inside a restart, and fires in every process when there are two.
- **No `jitterMinutes` and no `discoveryIntervalDays`.** A person sets the time of each schedule,
  and the `REFRESH` mode that the interval belonged to was deleted in plan `0086`.

## 14. Tests

- **`schedule-slot.spec.ts`**: the next slot on the same day, on a later day, across a week, with
  one day and with seven. The spring gap and the autumn repeat in `Europe/Madrid`. A timezone
  other than the machine's. `isTooLate` just under and just over half the gap, for a daily and a
  weekly rule.
- **Schedule service**: create computes `nextRunAt`, refuses without the acknowledgement, refuses
  a bad rule. Update recomputes. Switch off clears `nextRunAt`. A preset with a schedule cannot be
  deleted.
- **Worker**, with a clock passed in and no real timer:
  - a due schedule starts a run with `trigger: SCHEDULED`, `requestedByUserId: null`, the preset's
    input, `presetId` and `scheduleId`,
  - each row of the table in section 5.3,
  - three missed slots start one run,
  - both switches off start nothing,
  - an interrupted run is started again one time and not a second time,
  - a run that a person aborted is not started again,
  - an error inside a tick does not stop the next tick.
- **Executor**: a run that ends `ABORTED` leaves `consecutiveFailures` as it was. A run aborted by
  the shutdown hook has the shutdown sentence as its `error`.
- **Estimate**: each basis, the median of an even and an odd count, a reverted run left out.
- **Integration, on real Postgres**: two workers on one database claim the same due row and one
  run starts. The migration creates the table, the checks, the indexes and
  `harvest_runs.scheduleId`.
- **Gateway**: each route reaches its pattern, and `openapi-document.spec.ts` passes after
  regeneration.

## 15. Acceptance criteria

- [ ] A schedule names one preset, a time of day, days of the week and a timezone.
- [ ] A schedule is created or switched on only with `acknowledgedAutomaticFetch: true`.
- [ ] A due schedule starts a run through `validateRequest` and `start`, with trigger
      `SCHEDULED` and no user.
- [ ] Two harvester processes on one database start one run for one slot.
- [ ] A slot runs late when less than half the gap to the next slot has passed, and is skipped
      with `SKIPPED_LATE` otherwise.
- [ ] Several missed slots start at most one run.
- [ ] A chain with a run in flight skips the slot with `SKIPPED_BUSY`.
- [ ] A source with three consecutive failures skips with `SKIPPED_FAILING` until a run completes.
- [ ] A run that ends `ABORTED` does not change `consecutiveFailures`.
- [ ] A scheduled run stopped by a shutdown is started again one time.
- [ ] `HarvestRunView`, `HarvestRunPresetView` and `HarvestScheduleView` carry an estimate with
      its basis and its sample count.
- [ ] With `HARVEST_SCHEDULER_ENABLED` false, no schedule starts a run.
- [ ] No existing spawn refusal changes.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## 16. Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-harvester
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx build luna-shopper-backend-harvester
npx nx affected -t lint test
```

`nx test` does not type check. The build line is the one that does.

## 17. Decisions

Decided by the owner on 2026-10-11:

- A scheduled storefront crawl is acceptable, with a warning to the person who sets it up.
- Each run states about how long it takes, from earlier runs and a default to start from.
- Schedules run on production.
- The cadence is set by a person in the back office.
- A run stopped by a deploy is not a failure.
- The plan is for the infrastructure as it is: one node and one harvester pod.

Chosen in this plan, and open to the owner's correction:

- The half gap rule for a late slot (section 5.2).
- A deploy stops the run and the scheduler starts it again one time (section 7).
- A slot that cannot start is skipped and not queued (section 5.3).
- Three consecutive failures stop a schedule until a run completes (section 6).
- No abort counts as a failure of the source, also one by a person (section 6).
- Staging keeps the scheduler off (section 10).

Decided by the owner on 2026-10-13, on the review:

- A retry that is refused spends the attempt (review point 4). Any retry, started or not, sets
  `lastSlotAttempts` to 2.
- The six choices above stand as written.
- Production can fetch Mercadona (review point 8).

## 18. As built

Where the build chose something this plan did not state, or departs from it:

- **Review point 2: the claim writes `lastSlotAttempts = 0`.** The claim spends the slot and sets
  `lastSlotAt` to it and the attempts to 0. Only a run that starts raises them to 1. The retry
  query also requires `harvest_runs.scheduleId` to name the schedule.
- **Review point 1:** `schedule-slot.ts` exports `previousSlot`, and the claim judges the last
  slot at or before now.
- **One order for section 5.3 and `blockedBy`:** the source row off or missing, then the source
  failing, then the preset refused, then a run in the way. `REFUSED` thus comes before
  `SKIPPED_FAILING` for a row that is off and failing.
- **`consecutiveFailures` is not reset by the migration.** The view says `SOURCE_FAILING` before
  the slot, and the first run a person starts that completes clears it. All four production rows
  read 0 on 2026-10-14.
- **A schedule that is off still answers `blockedBy`,** so a person sees the block before
  switching it on.
- **The worker's writes leave `updatedAt` alone.** That column and `updatedByUserId` say when a
  person last changed the schedule.
- **`HarvestRunView.estimate` is absent on the dashboard's runs.** `dashboard.service.ts` is
  outside the scope and maps runs without it. Every run route carries it.
- **`scheduleId`, `interrupted` and both `estimate` fields are not required in the schemas,**
  as `presetId` is not, so the back office's typed fixtures stay valid.
- **`timeOfDay` is a five character string in the message schema, not a pattern.** No message
  schema here states a pattern, and the bridge spec samples every schema. The gateway DTO and the
  harvester check `HH:mm`.
- **`harvestSchedule.delete` answers `{ id }`** with 200, as every delete of the harvester does,
  and not nothing.
- **The executor tells a shutdown from a person's abort** by the runs its hook aborted that were
  not already aborted. Only those get the shutdown sentence.
- **The clock is an injection token, `HARVEST_CLOCK`,** so the service and the worker read one
  that a spec replaces.
- **Review point 7, the documentation:** the harvester section of `CLAUDE.md`, the comments of
  `values.production.yaml`, and the chart section of the root `README.md` (the chart has no
  README of its own). `k8s/catalog-seed/README.md` still says every row is off and is left for a
  follow up.
