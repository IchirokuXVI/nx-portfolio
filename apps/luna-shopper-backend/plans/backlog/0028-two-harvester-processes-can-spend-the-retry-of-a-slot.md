# 0028 (backlog) Two harvester processes can spend the retry of a slot

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Found on 2026-11-20, when CI failed one time on the PR checks of PR #1043. The failing spec was
> `harvest-schedules.integration.spec.ts`, "two workers on one database", "start one run for one
> slot, scheduled and with no user". It expected `lastSlotAttempts` 1 and got 2. It passed on a
> rerun. A reviewer traced the cause by reading the code. The owner parked the fix here on
> 2026-11-20 (decision 136c of the harvester round), with one condition: an analysis of how
> production runs harvester replicas today comes first.
>
> Every anchor below was read on `origin/dev` at `773c16242` on 2026-11-20. Paths are relative to
> `apps/luna-shopper-backend/harvester/src/app/` unless they say otherwise. Anchors are function
> names, not line numbers.
>
> **This plan has two parts, in this order.** Part 1 is an analysis. It comes before any code,
> and it decides whether a fix is needed at all. Part 2 is the fix, as options with no decision
> made. Nobody builds part 2 before part 1 has its answers.
>
> Prerequisite reading: plan `0206` (sections 5, 7 and 11), plan `0247` (the hold of a slot,
> review round 1 of PR #934), `harvest/harvest-schedule.worker.ts`,
> `harvest/harvest-schedule.store.ts`, `harvest/harvest-schedules.integration.spec.ts`,
> `k8s/helm/velista/values.yaml` (the harvester entry of `lunaShopperBackend.services`) and
> `k8s/helm/velista/templates/luna-shopper-backend/deployment.yaml.tpl`.

## Brief for the agent

### Objective

Find out whether two harvester processes ever run the schedule worker on one database in
production. Then, only if they do or if the owner asks for it, close the gap between the claim of
a slot and its hold, so that a slot started by its first decision always has
`lastSlotAttempts` 1 and keeps its one retry.

### Context

- `HarvestScheduleWorker.tick()` runs `retryInterrupted`, then `retryUndecided`, then
  `fireDue`. The `ticking` flag keeps one tick at a time in one process.
- `HarvestScheduleStore.claimDue` commits `nextRunAt`, `lastSlotAt = slot` and
  `lastSlotAttempts = 0` in a transaction of its own. Only after that commit does `decideHeld`
  call `holdSlot`, which takes a new connection and runs `pg_try_advisory_lock`.
- Between the commit and the lock, the row passes the `UNDECIDED` test of the store: the
  schedule is on, attempts are 0, no outcome is at or after `lastSlotAt`, and no run of the
  schedule was requested at or after `lastSlotAt`.
- A second process in `retryUndecided` can read the row there, take the hold, set attempts to 2
  through `claimUndecided`, and start the run with `retry(..., { firstDecision: true })`. The
  first process then fails `holdSlot`, or takes it after the second let go and finds
  `isUndecided` false. Either way it leaves the slot.
- The result is one run, outcome `STARTED`, the right `lastRunId`, and `lastSlotAttempts` 2.
  `findInterrupted` reads only attempts 1. If a deploy then stops that run, it is not started
  again. Plan `0206` section 7 says that a run a deploy stopped is started again one time.
- With one harvester process this cannot happen, because `fireDue` and `retryUndecided` of one
  process never run at the same time.

### Target state

1. Part 1 is written into this file, in section 1, with each answer and its source.
2. The owner picks one outcome from section 2, or decides that the cheap outcome of section 2.4
   is enough.
3. If a fix is picked: a spec that forces the interleaving fails on `origin/dev` and passes after
   the change. The existing spec passes 100 times in a row.
4. If only the cheap outcome is picked: the existing spec is deterministic, and plan `0206`
   section 11 and the doc comment of `HarvestScheduleWorker` state the limit.

### Scope

- Part 1: read only. The chart files, the harvester source, the GitHub Actions run history, and
  the deployed cluster through the owner.
- Part 2: `harvest/harvest-schedule.store.ts`, `harvest/harvest-schedule.worker.ts`, their specs,
  `harvest/harvest-schedules.integration.spec.ts`, and a migration only if option 2.2 with a new
  column is picked.
- No change to the chart, the Deployment template, or any other service.

### Constraints

- Plan `0206` keeps its contract: one run for one slot, one retry for a run a deploy stopped,
  and a crash between claim and start loses one slot and never fires one two times.
- Plan `0247` keeps its contract: a slot that a live worker is still deciding is never taken by
  the retry of an undecided slot.
- No `replicas` change for the harvester. A run lives in the memory of its pod (plan `0206`
  section 11).
- Do not answer a question of part 1 from memory or from this file. Read the source each time.

### Action boundaries

- Stop and ask before you run any command against a deployed cluster. The owner runs those, or
  you use a documented read path that the owner names.
- Never print `kubectl logs`, a ConfigMap or a database row into a workflow. The Actions logs of
  this repository are public.
- Stop and ask before you add a column or a migration.
- Stop and ask if part 1 finds a second process that this file does not name.

### Progress evidence

Section 1 filled in with an answer and a source for each question. For part 2: the forced
interleaving spec failing on `origin/dev` and passing on the branch, and the output of the
existing spec run 100 times in a row.

## 1. Part 1: the analysis

The answers decide whether part 2 is needed. Each question names where to look. Each answer
names its source and the date it was read.

### 1.1 The questions

| # | Question | Where to look |
| --- | --- | --- |
| Q1 | How many harvester replicas does each cluster run? | The harvester entry of `lunaShopperBackend.services` in `k8s/helm/velista/values.yaml`, any override in `values.production.yaml` and `values.staging.yaml`, and `deployment.yaml.tpl` (`replicas`). |
| Q2 | Which update strategy does the harvester use, and can a rollout run two pods at once for a time? Two pods at once are two processes on one database, also with one replica. | `strategy` in the same entry and in `deployment.yaml.tpl`, `lunaShopperBackend.rollout`, `terminationGracePeriodSeconds`, and the Kubernetes documentation of the `Recreate` strategy. |
| Q3 | Can two pods overlap outside a rollout? Examples: a node drain, an eviction, a pod deleted by hand, a node that stops answering. | The Kubernetes documentation of ReplicaSet replacement and pod termination, and `pdb.yaml.tpl`. |
| Q4 | Does the old pod still tick while it shuts down? | `onApplicationShutdown` and `tick()` in `harvest/harvest-schedule.worker.ts`, and the order of the Nest shutdown hooks. |
| Q5 | Is `HARVEST_SCHEDULER_ENABLED` true anywhere but production? | `values.yaml`, `values.production.yaml`, `values.staging.yaml`, `values.homelab.yaml`, `configmap.yaml.tpl`, `config/app-config.ts`, the harvester `.env.example`, `k8s/e2e/luna-shopper-backend/luna-slot.sh`, and the single host compose files of k8s plan `0020`. |
| Q6 | What does the deployed cluster show? The replicas and strategy of the harvester Deployment, its pods over a deploy, and the value of `HARVEST_SCHEDULER_ENABLED` in its ConfigMap. | Read only, by the owner on the host, or through a read path the owner names. Never in a workflow. |
| Q7 | Does production already hold a slot that the race spent? A row with `lastOutcome` `STARTED`, `lastSlotAttempts` 2, and no interrupted run of that schedule requested at or after `lastSlotAt` before the run in `lastRunId`. | A read only query on the harvester database, by the owner. |
| Q8 | How often does a deploy overlap a schedule slot? | The schedules that exist (the back office schedule view), their times and days, and the start and end times of the `release-velista.yml`, `staging-velista.yml` and `redeploy.yml` runs. |
| Q9 | Does any other process run the harvester app against a cluster database? Examples: a debug pod, a job, a local process through a tunnel. | The chart templates (`migration-job.yaml.tpl`, `backup-cronjob.yaml.tpl`), and the owner. |

### 1.2 What the repository says on 2026-11-20

This is what the committed files say. **The deployed state was not checked.** Q6 to Q9 have no
answer yet.

- **Q1.** The harvester entry in `values.yaml` sets `replicas: 1`. The template reads
  `.replicas | default $ls.replicaCount | default 1`, so the entry wins over the global
  `replicaCount: 2`. Neither `values.production.yaml` nor `values.staging.yaml` redefines the
  `services` list.
- **Q2.** The same entry sets `strategy: Recreate`. The template renders `type: Recreate` for it,
  and the `maxSurge: 1` of `lunaShopperBackend.rollout` applies only to the `RollingUpdate`
  entries. The comment in the template says why: a rolling update briefly runs two pods.
  `terminationGracePeriodSeconds` is 30. Whether `Recreate` waits for the old pod to end before
  it creates the new one, in every case, is for Q2 and Q3 to confirm from the Kubernetes
  documentation.
- **Q3.** `pdb.yaml.tpl` renders no budget for an entry with one replica, so the harvester has
  none.
- **Q5.** `schedulerEnabled: true` is in `values.production.yaml` only. `values.staging.yaml`
  sets it false. `values.yaml` sets it false. `values.homelab.yaml` does not set it, and
  `configmap.yaml.tpl` defaults it to false. `app-config.ts` defaults it to false. The harvester
  `.env.example` and `luna-slot.sh` write false. Plan `0020` of `k8s/plans` states false for
  the single host compose.

### 1.3 How the answers decide

- If Q1 to Q4 and Q9 show that two processes with the scheduler on never share a database, and
  Q7 finds no spent slot, the outcome is section 2.4.
- If any answer shows an overlap, or Q7 finds a spent slot, the owner picks one of sections 2.1
  to 2.3.
- The window is short. It is one connection from the pool and one query, between a commit and a
  lock. Two processes must tick inside it. Q8 says how often they have the chance.

## 2. Part 2: the fix

Options, with their trade offs. No decision is made here. Each option names what it changes in
the contract of plan `0206` and which spec proves it.

All options share one spec: a forced interleaving. A spec double of the store runs a second
worker's whole tick at the moment after `claimDue` commits and before `holdSlot` is called. On
`origin/dev` that spec ends with `lastSlotAttempts` 2. After the fix it ends with 1, and a stop
of that run is started again one time. The existing spec also passes 100 times in a row on a
`luna-slot --ephemeral` database.

### 2.1 Take the hold before the claim is seen

`claimDue` runs on the connection of the hold. In one transaction on that connection it selects
the row with `FOR UPDATE SKIP LOCKED`, takes the session advisory lock of the row with
`pg_try_advisory_lock`, writes the claim, and commits. The worker then decides the slot on the
hold it already has. If the lock is taken by another connection, the transaction rolls back and
the worker tries the next due row.

- What changes in plan `0206`: nothing that a person sees. A claimed row is held from the moment
  any other process can read it. `decideHeld` no longer takes a second hold.
- Trade offs: one connection for the claim and the decision, not two. The connection stays out
  of the pool for the whole decision, as the hold does today. A transaction level lock
  (`pg_try_advisory_xact_lock`) is not enough alone, because it ends at the commit, before the
  decision. It works only if the decision runs inside the same transaction, which keeps a row
  lock and a transaction open while a probe gate waits for minutes.

### 2.2 The undecided test skips a fresh claim

`UNDECIDED` also requires that the claim is older than a few seconds.

- What changes in plan `0206`: an undecided slot is retried a few seconds later than today, which
  no person can see at a 60 second tick.
- Trade offs: `lastSlotAt` is the time of the slot, not of the claim. The claim can come up to a
  tick later, or more for a late slot. A correct test thus needs a new column, for example
  `lastClaimedAt`, and a migration. A test on `lastSlotAt` alone either waits too long or does
  not cover a late claim. Either way the fix is a timing assumption, not a proof. A pause of the
  first process that is longer than the grace (a slow pool, a long garbage collection) opens the
  gap again.

### 2.3 The claim and the hold are one statement

One `UPDATE ... RETURNING` on the connection of the hold, in autocommit, writes the claim and
takes the session lock in the same statement. No reader can see the claim without the lock.

- What changes in plan `0206`: the same as section 2.1.
- Trade offs: Postgres evaluates a function in a `WHERE` clause for each row it reads. A lock
  call there can take locks on rows that the statement does not then update. The statement must
  pick the row first, in a subquery with `FOR UPDATE SKIP LOCKED` and `LIMIT 1`, and take the
  lock on that row only. A spec must prove that no other schedule is left locked.

### 2.4 The cheap outcome: a deterministic spec and a stated limit

If part 1 shows that two processes never overlap a slot in practice, nothing changes in the
worker or the store.

- The existing spec stops ticking both workers with `Promise.all` in the case that checks
  `lastSlotAttempts`, or checks only the run count and the outcome there. A separate case keeps
  the concurrent ticks and asserts one run.
- Plan `0206` section 11 and the doc comment of `HarvestScheduleWorker` state the limit: with
  two processes, a slot can spend its retry at its start. One run still starts.
- What changes in plan `0206`: its section 11 says "the claim of section 5.1 is safe with two".
  That stays true for the run count. The retry of section 7 is then guaranteed for one process
  only.

## 3. Evidence

- The failing CI run was on the checks of PR #1043 on 2026-11-20. The spec passed on a rerun.
- PR #1043 did not cause it. It changes neither `harvest-schedule.worker.ts` nor
  `harvest-schedule.store.ts`. Its change to the run insert in `HarvestRunStore` adds two
  fields, `configFingerprint` and `adapterKey`, and sits nowhere between the claim and the hold.
- The spec ticks two workers on one database with `Promise.all`. Their ticks thus run at the
  same time, and the gap of the Context section is reachable in every run of that spec.

## Acceptance criteria

- [ ] Section 1 has an answer and a source for each of Q1 to Q9, with the date it was read.
- [ ] The owner has picked an outcome from section 2.
- [ ] If a fix is picked: the forced interleaving spec fails on `origin/dev` and passes on the
      branch, and a slot started by its first decision has `lastSlotAttempts` 1.
- [ ] If a fix is picked: a run that a deploy stopped after such a slot is started again one
      time.
- [ ] The existing two worker spec passes 100 times in a row.
- [ ] If section 2.4 is picked: plan `0206` section 11 and the worker doc comment state the
      limit.

## Verification

```sh
npx nx test luna-shopper-backend-harvester --testFile=harvest-schedule.worker.spec.ts
npx nx test luna-shopper-backend-harvester --testFile=harvest-schedule.store.hold.spec.ts
# the integration spec, against an ephemeral luna slot (see CLAUDE.md, dev slots)
npx nx run luna-shopper-backend-harvester:test-integration --testFile=harvest-schedules.integration.spec.ts
npx nx affected -t lint test
```
