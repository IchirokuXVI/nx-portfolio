# Release tasks

A release task is a script that runs by itself on a deploy, once per cluster.
Use one for a change to data that a migration cannot own, for example resetting
a database. Both deploy paths run them: `k8s/helm/deploy-release.sh` for
production and the staging job in `.github/workflows/docker-ci.yml`.

## The rules

Every task obeys these two rules. The runner enforces the first. The second is
the task author's job.

1. **A task is reversible.** Before a task runs, the runner dumps every database
   in its `DATABASES` to object storage, through that database's backup
   CronJob. If a dump fails, the deploy stops before the task changes anything.
   The dump keys stay in the ledger. The bucket keeps dumps for 14 days, so that
   is how long a task stays reversible.
2. **A task survives any number of runs.** The ledger runs a task once, but a
   ledger can be lost or edited. So a task must look for its own earlier run in
   the data it changes. If it finds one, it does nothing. Task 0001 writes a comment
   on each database it recreates for this reason.

A task must also do nothing where there is nothing to change, for example a
database that this cluster does not run.

## How a deploy runs them

1. `run-release-tasks.sh --env <env> --phase pre`, before `helm upgrade`. For
   each task that is due, it dumps the task's databases and runs its `pre.sh`.
2. `helm upgrade`, which also runs the migration hooks.
3. `run-release-tasks.sh --env <env> --phase post`, after the rollout. For each
   task that finished its pre phase, it runs its `post.sh` and marks it done.

If a backup CronJob that a task needs does not exist yet, the runner defers the
task to the next deploy and changes nothing. This happens on the first deploy
that turns backups on in a cluster, because the upgrade that creates the
CronJobs runs after the pre phase. A dump that fails still stops the deploy.

If a deploy fails between the two phases, the next deploy runs the post phase.
It does not take the dumps again or run `pre.sh` again. On a first install, the
runner marks every task as skipped, because a new cluster has no data to change.

## Writing a task

Add a directory `tasks/NNNN-kebab-title/`. Take the next free number. Tasks run
in number order and a number is never reused. The directory holds:

- `task.env`, which sets `ENVIRONMENTS` (`staging`, `production` or both) and
  `DATABASES` (the databases the task writes: `auth`, `core`, `catalog`,
  `harvester`).
- `pre.sh`, `post.sh` or both. Use `pre.sh` for work before the migrations, and
  `post.sh` for work that needs the new schema or the new pods.

The runner gives each script `ENVIRONMENT`, `NAMESPACE`, `KUBECONFIG`,
`K8S_DIR` (the rsynced `k8s/` directory) and `TASK_NAME`.

Test a task on a copy of real data before it merges. Do not test it on the
data itself. `k8s/catalog-reset/README.md` records how task 0001 was tested.

## The ledger

The ConfigMap `release-tasks` in the namespace holds the ledger:

- `<task>` holds the state (`pre-done`, `done` or `skipped`) and a UTC time.
- `<task>.dumps` holds `<database>=<dump key>` pairs.

To read it:

```sh
kubectl -n nx-portfolio get configmap release-tasks -o yaml
```

To run a task again, remove its two keys. The second rule makes that safe.

```sh
kubectl -n nx-portfolio patch configmap release-tasks --type json \
  -p '[{"op":"remove","path":"/data/0001-reset-catalog-and-harvester"}]'
```

## Reverting a task

Restore each dump that the ledger names into a scratch database, then promote
it by hand. `k8s/helm/restore-database.sh` does the first half:

```sh
k8s/helm/restore-database.sh luna-shopper-backend-catalog-db luna_catalog/<stamp>.dump
```

The dump holds the database as it was just before the task. A revert therefore
also removes whatever was written to that database after the task ran.

## Staging

Staging needs `luna-shopper-backend-backup-secret` too. It must point at a
bucket of its own, never at production's bucket. The dump keys carry no
environment, so a shared bucket mixes staging dumps into production's
`latest`. The staging CronJobs are suspended: they never run nightly, and only a
release task starts them.
