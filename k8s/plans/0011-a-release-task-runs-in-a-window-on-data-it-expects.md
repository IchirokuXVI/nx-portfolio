> **PR:** [#621](https://github.com/IchirokuXVI/nx-portfolio/pull/621)

# 0011 A release task runs in a window, on data it expects

> Asked for by the owner on 2026-10-03, before the first curated catalog moves to staging
> and production (plan `0012`). The fear: a task that deletes data runs by mistake, months
> after anybody thought about it.
>
> Prerequisite reading: `k8s/release-tasks/README.md`, `k8s/release-tasks/run-release-tasks.sh`,
> both task directories under `k8s/release-tasks/tasks/`, `k8s/catalog-reset/README.md`,
> `k8s/helm/deploy-release.sh` (lines 131 to 177) and the staging deploy step of
> `.github/workflows/docker-ci.yml` (lines 846 to 964).

A release task runs once per cluster, at the first deploy that carries it. Nothing says
when that deploy has to happen. Task `0001` drops two databases and task `0002` deletes
every product. Both name `staging production`, and each one fires in any cluster whose
ledger does not show it finished, however late that deploy comes and whatever the
databases hold by then.

## Brief for the agent

### Objective

Make every release task state, per environment, the last day it can start, and for
production the one release it belongs to. Make every task state what it expects to find in
the data, and refuse when it finds something else. Make both deploy paths fail before
they change anything when a task leaves one of those unstated.

### Context

What protects a cluster today, read from the code on 2026-10-03:

| Guard | Where | What it does not cover |
| --- | --- | --- |
| The ledger, ConfigMap `release-tasks` | `run-release-tasks.sh` | A ledger that is lost or edited runs the task again |
| A marker in the data | `0001/pre.sh` (a comment on the database), `remove-catalog-products.sh` (a comment on `items`) | A database that was replaced, for example by a restore that swaps databases, has no comment |
| A dump of each named database | `run-release-tasks.sh`, `dump()` | The bucket keeps a dump for 14 days |
| First install marks every task `skipped` | `run-release-tasks.sh`, `FRESH` | Nothing else |

No guard reads a date, a version, or the content of the database.

Why a date alone is not enough: a date cannot tell an empty catalog from a curated one.
Plan `0012` fills the catalog that tasks `0001` and `0002` empty. A reset that runs one
day after that restore is inside any reasonable window and still destroys the work. The
window closes the long tail. The expectation on the data closes the short one. This plan
builds both.

Why migrations are out of scope: a migration that does not run breaks every migration
after it, so a migration cannot expire. `DiaCategoryTree1758500000000` deletes categories
inside a migration, and that stays as it is. Section 6 states the rule for new work.

### Target state

1. `task.env` states a window per environment and a production release (section 1).
2. Every task has a `check.sh` that only reads, and the runner calls it before the dumps
   (section 2).
3. The runner has a `--phase check` that changes nothing, and both deploy paths run it
   first (section 3).
4. A static check of every `task.env` runs on each pull request and in both deploy
   workflows (section 4).
5. Tasks `0001` and `0002` carry the new fields and a `check.sh` (section 5).
6. `k8s/release-tasks/README.md` describes all of it.

### Scope

- Work only in: `k8s/release-tasks/`, `k8s/helm/deploy-release.sh`,
  `.github/workflows/docker-ci.yml`, `.github/workflows/release.yml`,
  `.github/workflows/pr.yml`, `k8s/catalog-reset/README.md`, `CLAUDE.md` (one paragraph in
  "Docker & CI/CD").
- Do NOT touch: any migration, the chart under `k8s/helm/templates/`, the two scripts in
  `k8s/catalog-reset/` (they stay callable by hand), `k8s/bootstrap/`.

### Constraints

- Bash for the runner and the hooks, as today. Node with `node --test` for the static
  check, as `apps/luna-shopper-backend/tools/ci/assert-runtime-manifest.test.mjs` does. No
  new dependency.
- A task that is already `pre-done` in a ledger always finishes, whatever its window says.
  A task stopped between its two phases leaves a cluster half changed.
- Every new refusal fails closed. An unreadable field, an unknown value and a missing
  `check.sh` all mean that the task does not run.
- Only make the changes this plan names. Do not add a notification channel, a dashboard or
  a new ledger store.

### Action boundaries

- Proceed with edits, the static check and rehearsals against a local stack
  (`CATALOG_PSQL` and `HARVESTER_PSQL` overrides, as `remove-catalog-products.sh`
  documents).
- **Stop and ask before you choose any date, any release version or any row ceiling for
  tasks `0001` and `0002`.** Those are the owner's values. Ask for the output of the
  ledger command in section 5 for both clusters first.
- Never run a task, the runner or `kubectl` against staging or production.

### Progress evidence

Report each acceptance criterion in section 7 with the command you ran and its output. A
claim with no output is not done.

## 1. What a task states

`task.env` after this plan:

```sh
# Empty the catalog and harvester databases, then clear core's references.
RUN_UNTIL_STAGING="2026-10-10"
RUN_UNTIL_PRODUCTION="2026-10-17"
PRODUCTION_RELEASE="0.6.0"
DATABASES="catalog harvester core"
```

- **`RUN_UNTIL_STAGING`, `RUN_UNTIL_PRODUCTION`.** A UTC date, `YYYY-MM-DD`, inclusive: the
  task can start until 23:59:59 UTC of that day. The word `never` means that the task does
  not belong to that environment. `ENVIRONMENTS` is removed, because these two fields say
  the same thing and more.
- **An absent or empty window is an error, not a default.** The owner's rule was "a null
  date is not executed, and the deploy fails without a date". Both hold, as two layers. The
  check phase fails the deploy (section 3). The runner also refuses the task if something
  calls it without the check.
- **`PRODUCTION_RELEASE`.** The version that `deploy-release.sh` receives, without the `v`.
  Required when `RUN_UNTIL_PRODUCTION` is a date. Production deploys an immutable version,
  so a version is exact where a date is only close. Staging deploys the tag `staging` on
  every push to `main`, so the date is its only gate.
- **Two environments, two dates.** Staging runs days before production. One shared date
  must cover both, which makes the window wide for the environment that matters most.

### What the runner decides for a task with no ledger state

| Condition, in this order | Result | Ledger |
| --- | --- | --- |
| The window for this environment is `never` | nothing | none |
| The window is absent, empty or not a date | refuse, exit 1 | none |
| Today (UTC) is after the window | print a warning, continue with the next task | `expired <time>` |
| Production, and the deployed version is not `PRODUCTION_RELEASE` | print "waits for release X", continue | none |
| `check.sh` fails | refuse, exit 1 | none |
| Otherwise | due: dumps, `pre.sh`, as today | `pre-done`, then `done` |

- **`expired` is final**, as `done` and `skipped` are. A later deploy never revives the
  task. To run it after all, a person edits the window in a pull request and removes the
  ledger key. Both steps are deliberate.
- **A task that waits for another release is not expired by that.** The date closes it.
- **Number order still holds.** A task that expires does not stop the tasks after it. A
  task that depends on an earlier one says so in its `check.sh`, by reading the data.
- The runner takes a new `--release <version>` argument. It is required with
  `--env production` and refused with `--env staging`.

## 2. What a task expects

Every task directory holds a `check.sh`. It receives the same variables as the other
hooks. It only reads. It exits 0 when the data is what the task was written for, and
prints the reason and exits 1 when it is not.

A failed check stops the deploy. It does not skip the task. A task that meets data it did
not expect is a question for a person, and a deploy that continues hides the question.

The expectation is a number the author writes down, not a query that always passes:

```sh
# task.env of 0002
MAX_ITEMS_STAGING="0"
MAX_ITEMS_PRODUCTION="0"
```

`check.sh` of task `0002` counts `items` and refuses above that ceiling. The same deploy
that meets 19,791 curated products stops with "0002 expects at most 0 products and
found 19791".

Rules for a `check.sh`:

- It passes where there is nothing to change (no database pod, no table), as the hooks do
  today.
- It passes when the task's own marker is already there. The hook then does nothing, as
  today.
- It reads through the same `CATALOG_PSQL` style overrides as the scripts it guards, so
  that a local rehearsal works.

## 3. The check phase

`run-release-tasks.sh --env <env> --phase check [--release <version>]` walks the tasks
with the table of section 1 and changes nothing: no dump, no hook except `check.sh`, no
ledger write. It prints one line per task:

```
0001-reset-catalog-and-harvester   done 2026-10-01T09:12:44Z
0002-remove-catalog-products       DUE   until 2026-10-17, release 0.6.0, databases: catalog harvester core
0003-restore-the-first-catalog     waits for release 0.6.1
```

It exits 1 on the first refusal, after it prints every line.

Where it runs:

- **Production:** `release.yml`, in the same SSH step as
  `provision-release.sh --check --env production`, before `deploy-release.sh`. The output
  also goes to `$GITHUB_STEP_SUMMARY`, so the release page shows which tasks this release
  runs.
- **Staging:** `docker-ci.yml`, next to `provision-release.sh --check --env staging`.
- `deploy-release.sh` passes `--release "$VERSION"` to the `pre` and `post` phases.

The `pre` phase repeats the same decisions. The check phase exists so that a deploy that
cannot work is rejected in seconds, before the images roll.

## 4. The static check

`k8s/release-tasks/check-tasks.mjs`, with `check-tasks.test.mjs` beside it, reads every
`tasks/NNNN-*/task.env` without a cluster. It fails when:

- a window is absent, empty, or neither a date nor `never`.
- `RUN_UNTIL_PRODUCTION` is a date and `PRODUCTION_RELEASE` is absent.
- a window is more than 14 days after the commit that last changed that `task.env`
  (`git log -1 --format=%cI -- <file>`). 14 days is the retention of the dumps, which is
  how long a task stays reversible. Without a cap, somebody writes 2099.
- `check.sh` is absent, or neither `pre.sh` nor `post.sh` exists.
- `ENVIRONMENTS` is still set.
- two task directories share a number.

It runs in three places: the `verify` job of `pr.yml` (with its own tests, as the
runtime manifest check does), and the first step of the deploy job in each of
`docker-ci.yml` and `release.yml`, before any SSH.

A window in the past is not a failure. Every task ends that way, and the file stays as
the record of what ran.

## 5. Tasks 0001 and 0002

**Both tasks already ran in staging and in production** (the owner, 2026-10-03). So this
plan closes them. It does not arm them.

- Each window is the day the task ran in that cluster, which is a date in the past, and
  `PRODUCTION_RELEASE` is the release that ran it. Both ledgers and production's
  `helm get values --revision` were read on 2026-10-03:

  | Task | Staging, `done` at | Production, `done` at | Production release |
  | --- | --- | --- | --- |
  | `0001-reset-catalog-and-harvester` | 2026-09-25T20:14:22Z | 2026-09-25T15:41:48Z | `0.11.0` (revision 15) |
  | `0002-remove-catalog-products` | 2026-10-02T13:00:25Z | 2026-10-02T13:31:00Z | `0.12.0` (revision 17) |

  So `0001` gets `2026-09-25` twice and `0.11.0`, and `0002` gets `2026-10-02` twice and
  `0.12.0`. Read the ledgers again before you write them
  (`kubectl -n nx-portfolio get configmap release-tasks -o yaml`), and stop if a state is
  not `done`.
- The ledger already stops both tasks. The window now stops them when the ledger is lost
  or edited, which is the case the owner fears: a catalog that holds the curated products
  and a runner that believes task `0002` never ran.
- Both ceilings are `0`. `check.sh` of each task refuses when `luna_catalog.items` holds a
  row. It is the third guard, and the only one that looks at the data. Both clusters hold
  0 products today, so the check passes now and refuses from the day plan `0012` restores
  the catalog.
- The markers are in place today: both databases of both clusters carry the comment of
  `0001`, and both `items` tables carry the comment of `0002`. Plan `0012` swaps the
  databases, and the comments stay on the old ones.
- The static check treats these two files as it treats any task: a window in the past is
  valid, and the 14 day cap is measured from a commit that is later than the window, so it
  passes.

Ask the owner for the two ledgers if you cannot read them, propose the values, and wait
for a yes.

## 6. The rule for new work

Add to `k8s/release-tasks/README.md`, as a third rule beside "reversible" and "survives
any number of runs":

> **A task says when and on what.** It states a window per environment, the production
> release it belongs to, and a `check.sh` that refuses data it was not written for.

And one sentence for migrations: a change that deletes rows a person or a harvest wrote
goes in a release task, not in a migration, unless the schema change cannot work without
it. A migration cannot expire and takes no dump.

## 7. Acceptance criteria

- [ ] `node --test k8s/release-tasks/check-tasks.test.mjs` passes, and covers every
      failure of section 4 with one fixture each.
- [ ] `node k8s/release-tasks/check-tasks.mjs` passes on the repository.
- [ ] A local rehearsal of the runner (a kind or Docker Desktop cluster, or the functions
      under test with a stub `kubectl`) shows each row of the table in section 1: `never`,
      absent, expired, wrong release, failed check, due.
- [ ] A task in `pre-done` with an expired window still runs its `post.sh`.
- [ ] `--phase check` writes nothing: the ledger is byte identical before and after.
- [ ] `check.sh` of `0002`, run against a local catalog with products through
      `CATALOG_PSQL`, exits 1 and names both numbers.
- [ ] `shellcheck` is clean on every changed script, if it is installed. Say so if it is
      not.
- [ ] The three workflows parse (`actionlint`, or a dry read of the YAML with `node`).

## 8. What this plan leaves out

- **An approval by a second person.** A GitHub environment with a required reviewer is
  the usual guard for a production deploy. The owner works alone, so the version pin and
  the printed list give the same protection at a lower cost. Add the environment when a
  second person deploys.
- **A longer life for the dumps.** 14 days stays.
- **The reference seed.** It is off in both clusters. It is not a release task, it runs on
  every deploy when on, and it writes `imageUrl` and `sku` as null on seeded products.
  Plan `0012` states why it must stay off once a curated catalog is in place.
