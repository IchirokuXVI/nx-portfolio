# Release tasks

A release task is a script that runs by itself on a deploy, once per cluster.
Use one for a change to data that a migration cannot own, for example resetting
a database. Both deploy paths run them: `k8s/helm/deploy-release.sh` for
production and the staging deploy of `.github/actions/deploy-unit`.

## The rules

Every task obeys these three rules. The runner enforces the first and the
third. The second is the task author's job.

1. **A task is reversible.** Before a task runs, the runner dumps every database
   in its `DATABASES` to object storage, through that database's backup
   CronJob. If a dump fails, the deploy stops before the task changes anything.
   The dump keys stay in the ledger. The bucket keeps dumps for 14 days, so that
   is how long a task stays reversible.
2. **A task survives any number of runs.** The ledger runs a task once, but a
   ledger can be lost or edited. So a task must look for its own earlier run in
   the data it changes. If it finds one, it does nothing. Task 0001 writes a comment
   on each database it recreates for this reason.
3. **A task says when and on what.** It states a window per environment, the
   production release it belongs to, and a `check.sh` that refuses data it was
   not written for.

A task must also do nothing where there is nothing to change, for example a
database that this cluster does not run.

The third rule exists because the first two are not enough (k8s plan 0011). A
marker in the data does not survive a restore that swaps the database. A dump
is gone after 14 days. Without a window, a task whose ledger entry is lost runs
at the next deploy. That deploy can be months later, and the databases can hold
anything by then.

The same reasoning gives the rule for migrations. A change that deletes rows a
person or a harvest wrote goes in a release task, not in a migration. The one
exception is a schema change that cannot work without the delete. A migration
cannot expire and takes no dump.

## When a task runs

`task.env` states it:

```sh
# Empty the catalog and harvester databases, then clear core's references.
RUN_UNTIL_STAGING="2026-10-10"
RUN_UNTIL_PRODUCTION="2026-10-17"
PRODUCTION_RELEASE="0.6.0"
DATABASES="catalog harvester core"
```

- **`RUN_UNTIL_STAGING`, `RUN_UNTIL_PRODUCTION`.** A UTC date, `YYYY-MM-DD`,
  inclusive: the task can start until 23:59:59 UTC of that day. The word `never`
  means that the task does not belong to that environment. There are two dates
  because staging runs days before production. One shared date must cover both,
  which makes the window wide for the environment that matters most.
- **A window that is absent or empty is an error, not a default.** The task does
  not run and the deploy fails.
- **`PRODUCTION_RELEASE`.** The version that `deploy-release.sh` receives: the
  part of the unit's tag after its `TAG_PREFIX` (`k8s/units/<unit>/unit.env`),
  so `0.15.0` for the tag `velista-v0.15.0`, never the whole tag. A task with a date in `RUN_UNTIL_PRODUCTION` must state it.
  Production deploys an immutable version, so a version is exact where a date
  is only close. Staging deploys the tag `staging` on every push to `main`, so
  the date is its only gate.
- **A window is at most 14 days after the commit that last changed the
  `task.env`.** That is how long a dump is kept. The static check below enforces
  it.

For a task with no state in the ledger, the runner decides in this order:

1. The window for this environment is `never`. Nothing happens, and the ledger
   gets no entry.
2. The window is absent, empty or not a date. The runner refuses the task and
   exits 1. The ledger gets no entry.
3. The release is a first install. The runner skips the task and writes
   `skipped <time>`.
4. Today (UTC) is after the window. The runner prints a warning, writes
   `expired <time>` and continues with the next task.
5. The environment is production, and the deployed version is not
   `PRODUCTION_RELEASE`. The runner prints "waits for release X" and continues.
   The ledger gets no entry.
6. `check.sh` is absent or fails. The runner refuses the task and exits 1. The
   ledger gets no entry.
7. Otherwise the task is due. The runner takes the dumps and runs `pre.sh`. The
   ledger says `pre-done`, and `done` after the post phase.

- **`expired` is final**, as `done` and `skipped` are. A later deploy never
  revives the task. To run it after all, a person moves the window in a pull
  request and removes the ledger key. Both steps are deliberate.
- **A task that waits for another release is not expired by that.** The date
  closes it.
- **A task in state `pre-done` always finishes**, whatever its window says. A
  task stopped between its two phases leaves a cluster half changed.
- **Number order still holds.** A task that expires does not stop the tasks
  after it. A task that depends on an earlier one says so in its `check.sh`, by
  reading the data.

A window in the past is normal. Every task ends that way, and its directory
stays as the record of what ran.

### A task that started and did not finish

The runner writes the dump keys before it runs `pre.sh`, and the state after
it. So a task with a `<task>.dumps` key and no state is a started task. Its
`pre.sh` failed, or the write of `pre-done` failed. Nobody knows how far it got.

- Inside its window, and in its release, the next deploy tries it again. It
  takes new dumps and runs `check.sh` first. The second rule makes the second
  run of `pre.sh` safe.
- Outside them, the runner refuses the task and the deploy stops. This covers
  a closed window, another production release and a first install. The task is
  not recorded as `expired` or `skipped`, and it does not wait.

The refusal prints the dump keys. A person then reads the cluster and chooses
one of two steps:

- Remove the `<task>.dumps` key. The task then has no trace of a start, and the
  window decides. With a closed window, the next deploy records it as `expired`.
- Finish the task by hand, then set the `<task>` key to `done` and a UTC time.

The runner never runs `pre.sh` again by itself after the window closed. To do
that, move the window in a pull request.

## What a task expects

Every task directory holds a `check.sh`. It receives the same variables as the
other hooks. It only reads. If the data is what the task was written for, it
exits 0. If it is not, it prints the reason and exits 1.

A failed check stops the deploy. It does not skip the task. A task that meets
data it did not expect is a question for a person, and a deploy that continues
hides the question.

The expectation is a number that the author writes down, not a query that
always passes:

```sh
# task.env of 0002
MAX_ITEMS_STAGING="0"
MAX_ITEMS_PRODUCTION="0"
```

`check.sh` of task 0002 counts the rows of `items` and refuses above that
ceiling. A deploy that meets 19,791 curated products stops with "0002 expects
at most 0 products and found 19791".

Rules for a `check.sh`:

- It passes where there is nothing to change (no database pod, no table), as
  the hooks do.
- If the task's own marker is already there, it passes. The hook then does
  nothing.
- It refuses what it cannot read: a ceiling that is not a number, an API that
  does not answer, a query that fails.
- It reads through the same `CATALOG_PSQL` style overrides as the scripts it
  guards, so that a local rehearsal works:

  ```sh
  ENVIRONMENT=staging \
    CATALOG_PSQL='docker exec -i luna-slot1-catalog-db-1 psql -U luna_catalog -d luna_catalog' \
    bash k8s/release-tasks/tasks/0002-remove-catalog-products/check.sh
  ```

## How a deploy runs them

1. `node k8s/release-tasks/check-tasks.mjs`, on the CI runner, before any SSH.
   This is the static check of the next section.
2. `run-release-tasks.sh --env <env> --phase check`, next to
   `provision-release.sh --check`. It walks the tasks with the table above and
   changes nothing: no dump, no hook except `check.sh`, no write to the ledger.
   It prints one line per task:

   ```
   0001-reset-catalog-and-harvester   done 2026-10-01T09:12:44Z
   0002-remove-catalog-products       DUE   until 2026-10-17, release 0.6.0, databases: catalog harvester core
   0003-restore-the-first-catalog     waits for release 0.6.1
   ```

   If a task is refused, it prints every line first and then exits 1. So a
   deploy that cannot work is rejected in seconds, before the images roll. In
   production the list also goes to the summary of the release run.

3. `run-release-tasks.sh --env <env> --phase pre`, before `helm upgrade`. It
   repeats the same decisions. For each task that is due, it dumps the task's
   databases and runs its `pre.sh`.
4. `helm upgrade`, which also runs the migration hooks.
5. `run-release-tasks.sh --env <env> --phase post`, after the rollout. For each
   task that finished its pre phase, it runs its `post.sh` and marks it done.

Production adds `--release <version>` to all three phases, and
`deploy-release.sh` passes its own argument. The runner requires it with
`--env production` and refuses it with `--env staging`.

If a backup CronJob that a task needs does not exist yet, the runner defers the
task to the next deploy and changes nothing. This happens on the first deploy
that turns backups on in a cluster, because the upgrade that creates the
CronJobs runs after the pre phase. A dump that fails still stops the deploy.

If a deploy fails between the two phases, the next deploy runs the post phase.
It does not take the dumps again or run `pre.sh` again. On a first install, the
runner marks every task as skipped, because a new cluster has no data to change.
A first install means that helm answers "release: not found". Any other failure
of `helm status` stops the runner, because `skipped` is final.

A refusal in the check phase or the pre phase stops the deploy. An earlier task
can then sit at `pre-done`, because the tasks before the refused one already
ran. That is safe. The next deploy that passes finishes it.

The post phase does not stop at a refusal. A task with a state the runner does
not know is counted, and the walk continues. So every task at `pre-done` still
runs its `post.sh`. The phase then exits 1.

## The static check

`check-tasks.mjs` reads every `tasks/NNNN-*/task.env` without a cluster. It
fails when:

- a window is absent, empty, or neither a date nor `never`.
- `RUN_UNTIL_PRODUCTION` is a date and `PRODUCTION_RELEASE` is absent, or is
  not a version written without its `v`.
- `PRODUCTION_RELEASE` is written as the whole tag (`velista-v0.15.0`). The
  value is the version after the unit's `TAG_PREFIX` alone (`0.15.0`).
- `UNIT` is absent or names no directory of `k8s/units`, or that unit's
  `unit.env` states no `TAG_PREFIX`, so no release of it has a version to name.
- a window is more than 14 days after the commit that last changed that
  `task.env`. Without a cap, somebody writes 2099.
- `check.sh` is absent, or neither `pre.sh` nor `post.sh` exists.
- `ENVIRONMENTS` is still set. The two windows replaced it.
- two task directories share a number, or a directory is not named
  `NNNN-kebab-title`.
- a line of `task.env` is neither a comment nor `NAME="value"`. The check reads
  the file as text and cannot know what bash does with such a line.

It runs in two places:

- the `verify` job of `.github/workflows/pr.yml`, with its own tests.
- the composite action `.github/actions/deploy-unit`, before any SSH, in both
  `stage-unit.yml` and `release-unit.yml`.

```sh
node k8s/release-tasks/check-tasks.mjs
node --test k8s/release-tasks/check-tasks.test.mjs
```

## Writing a task

Add a directory `tasks/NNNN-kebab-title/`. Take the next free number. Tasks run
in number order and a number is never reused. The directory holds:

- `task.env`, which sets `RUN_UNTIL_STAGING`, `RUN_UNTIL_PRODUCTION`,
  `PRODUCTION_RELEASE` and `DATABASES` (the databases the task writes: `auth`,
  `core`, `catalog`, `harvester`), plus whatever number its `check.sh` compares
  against. Write every line as a comment or as `NAME="value"`, with no blank
  line: a checkout with CRLF line endings turns a blank line into a command.
- `check.sh`, which states what the task expects of the data.
- `pre.sh`, `post.sh` or both. Use `pre.sh` for work before the migrations, and
  `post.sh` for work that needs the new schema or the new pods.

The runner gives each script `ENVIRONMENT`, `NAMESPACE`, `KUBECONFIG`,
`K8S_DIR` (the rsynced `k8s/` directory) and `TASK_NAME`.

Choose the windows last, in the pull request that will ship the task. They
count from the commit, and a task that waits on a branch for three weeks has a
window that closed before it merged.

Test a task on a copy of real data before it merges. Do not test it on the
data itself. `k8s/catalog-reset/README.md` records how task 0001 was tested.

## The ledger

The ConfigMap `release-tasks` in the namespace holds the ledger:

- `<task>` holds the state (`pre-done`, `done`, `skipped` or `expired`) and a
  UTC time.
- `<task>.dumps` holds `<database>=<dump key>` pairs.

To read it:

```sh
kubectl -n luna-shopper get configmap release-tasks -o yaml
```

To run a task again, remove its two keys. The second rule makes that safe, and
the third decides whether it happens. The task runs again only with an open
window, in the release it names, and with a `check.sh` that passes. With a
closed window, the next deploy records the task as `expired` instead.

```sh
kubectl -n luna-shopper patch configmap release-tasks --type json \
  -p '[{"op":"remove","path":"/data/0001-reset-catalog-and-harvester"}]'
```

## Tasks 0001 and 0002

Both tasks ran in staging and in production before windows existed. Their
windows are the day each one ran, and `PRODUCTION_RELEASE` is the release that
ran it, so both are closed:

- `0001-reset-catalog-and-harvester` has the window 2026-09-25 in both
  environments, and the production release `0.11.0`.
- `0002-remove-catalog-products` has the window 2026-10-02 in both
  environments, and the production release `0.12.0`.

The ledger already stops both. A lost or edited ledger no longer starts them,
because the next deploy records each one as `expired`. Both ceilings are 0, so
each `check.sh` also refuses a catalog that holds a product. That is the
only guard that looks at the data, and it holds from the day a curated catalog
is restored (k8s plan 0012).

## Task 0003

`0003-restore-the-first-catalog` puts the first curated catalog in place of the
empty catalog and harvester databases (k8s plan 0012).
`k8s/catalog-import/README.md` describes the procedure and how to revert it.

- **It is armed for staging and for production.** The staging window ends on
  2026-10-09. The production window ends on 2026-10-14, and
  `PRODUCTION_RELEASE` is `0.13.2`. That release runs it in production, and no
  other version does.
- **It states four ceilings**, two per environment: the most products and the
  most `source_catalog_entries` that the restore replaces. `check.sh` refuses
  above either one. It also refuses a cluster with no backup Secret, because
  the restore downloads the two dumps with those credentials.
- **Its `check.sh` refuses a cluster with no catalog or no harvester database
  pod.** The other tasks pass there, because they have nothing to delete. This
  task has something to put there, so such a cluster is a question for a
  person. A first install never reaches `check.sh`: the runner records the task
  as skipped before it asks. `post.sh` exits 1 in the same case, so the runner
  never writes `done` for a restore that did not happen.
- **A refusal inside `post.sh` leaves the task at `pre-done`**, and a task at
  `pre-done` always finishes. Every later deploy then runs `post.sh` again,
  whatever the window and the release say. `k8s/catalog-import/README.md` says
  how a person stops that.
- **It has a `post.sh` and no `pre.sh`.** The restore compares the migrations
  of the dumps with the migrations that this release ran, so it runs after
  `helm upgrade`.
- **The markers of tasks 0001 and 0002 do not travel with the swap.** The
  comment of 0001 sits on the old database, and the comment of 0002 on the old
  `items` table. After the restore, their closed windows and their ceilings of
  0 are what stops them.
- **It does not revert by a dump alone.** The old databases stay beside the new
  ones for a week, and a rename brings them back. The dumps that the runner
  takes are the second way back, for 14 days.

## Task 0004

`0004-remove-chain-sections` removes every row of the four tables that held the
sections of a chain: `supermarket_item_sections`, `location_sections`,
`section_categories` and `supermarket_sections`, in that order (backend plan
`0200`). A section belongs to a shop since that plan. The tables stay, and a
later plan drops them.

- **It ships in the same release as the migration that replaces those rows.**
  The migration copies the selection of each shop into `shop_sections` and
  deletes nothing. This task deletes, because a migration takes no dump and
  cannot expire.
- **It is armed for staging and for production.** Both windows end on
  2026-10-28, and `PRODUCTION_RELEASE` is `0.14.0`. A release published after
  that date needs the dates moved in a commit before it.
- **Its `check.sh` does not ask for `shop_sections`.** The check runs before
  `helm upgrade`, and the table does not exist until the migration of the same
  release has run. A check that asked for it would refuse the deploy that
  creates it. The check counts the rows of the four tables and refuses above
  `MAX_ROWS_<ENVIRONMENT>`.
- **Its `post.sh` is what refuses a cluster where the migration did not run.**
  With rows in the four tables and no `shop_sections`, those rows are still
  what the service reads. `post.sh` then deletes nothing and exits 1. The task
  stays at `pre-done`, and the next deploy runs `post.sh` again.
- **A selection with no copy does not stop it.** The migration copies every
  selection, so a missing copy means that a person or a map walk removed that
  section of the shop afterwards. `post.sh` prints how many there are and
  deletes the old rows anyway. The dump is the way back.
- **It leaves no marker, and it does not need one.** All four deletes are one
  transaction. A second run finds four empty tables and does nothing, and
  nothing writes to those tables after the release. Both scripts also pass
  where the four tables do not exist, which is the state after they are
  dropped.
- **It has a `post.sh` and no `pre.sh`**, because it must run after the
  migration has made the copies.

To rehearse it, name a database that you made for the rehearsal. Do not name a
cluster:

```sh
ENVIRONMENT=staging \
  CATALOG_PSQL='docker exec -i my-catalog-db psql -U luna_catalog -d my_copy' \
  bash k8s/release-tasks/tasks/0004-remove-chain-sections/check.sh
CATALOG_PSQL='docker exec -i my-catalog-db psql -U luna_catalog -d my_copy' \
  bash k8s/release-tasks/tasks/0004-remove-chain-sections/post.sh
```

## Task 0005

`0005-unlink-deleted-accounts` cleans what the accounts deleted before backend
plan `0232` left in core and catalog (section 7 of that plan). Profiles, voice
recordings and app state go. Lines, comments, purchases and shop walks stay,
with a tombstone in place of the user id.

- **It runs a command inside the pods, not SQL.** `post.sh` runs
  `node reconcile-deletions.js` in the core pod and then in the catalog pod.
  The command collects the user ids of the tables of section 2, asks auth
  `auth.existingUserIds` in batches of 500, and runs the deletion that a
  `user.deleted` on the stream runs, for each id that auth does not know. One
  deletion, two ways in.
- **It is armed for staging and for production.** Both windows end on
  2026-11-12, and `PRODUCTION_RELEASE` is `0.16.0`. A release published after
  that date needs the dates moved in a commit before it.
- **It states one ceiling per environment, per service**:
  `MAX_UNKNOWN_IDS_<ENVIRONMENT>`, 2000 in both. Neither cluster was read when
  it was written. `check.sh` counts with `--count` and refuses above it.
  `post.sh` counts again before it changes anything, and passes the ceiling as
  `--max`, so the command refuses too.
- **Its `check.sh` passes where the pods do not have the command yet.** The
  check runs before `helm upgrade`, and this release is the one that adds the
  command and the auth subject. `post.sh` runs after the rollout, and it is the
  one that refuses: above the ceiling, and where a pod has no
  `reconcile-deletions.js`, because the rollout did not happen there.
- **It leaves no marker, and it does not need one.** A deleted id is gone from
  every table, and a tombstone starts with `00000000-`, which the command never
  takes for an account. A second run finds nothing to do.
- **It has a `post.sh` and no `pre.sh`**, because it needs the new pods.

To rehearse it, point the overrides at the built bundles and at databases that
you made for the rehearsal. Each command needs the service's database URL and
`NATS_URL` in its environment, and an auth on that NATS that answers
`auth.existingUserIds`:

```sh
ENVIRONMENT=staging \
  CORE_RECONCILE='node dist/apps/luna-shopper-backend-core/reconcile-deletions.js' \
  CATALOG_RECONCILE='node dist/apps/luna-shopper-backend-catalog/reconcile-deletions.js' \
  bash k8s/release-tasks/tasks/0005-unlink-deleted-accounts/check.sh
```

## Reverting a task

Restore each dump that the ledger names into a scratch database, then promote
it by hand. `k8s/helm/restore-database.sh` does the first half:

```sh
k8s/helm/restore-database.sh luna-shopper-backend-catalog-db luna_catalog/<stamp>.dump
```

A third argument holds the download to a SHA-256. The script then refuses a
file that does not match, before it creates the scratch database.

The dump holds the database as it was just before the task. A revert therefore
also removes whatever was written to that database after the task ran.

## Staging

Staging needs `luna-shopper-backend-backup-secret` too. It must point at a
bucket of its own, never at production's bucket. The dump keys carry no
environment, so a shared bucket mixes staging dumps into production's
`latest`. The staging CronJobs are suspended: they never run nightly, and only a
release task starts them.
