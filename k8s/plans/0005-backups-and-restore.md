# 0005 Backups, and the restore that proves them

There is no backup of anything in this cluster. No `pg_dump`, no CronJob, no volume snapshot,
nothing in `k8s/` and nothing on the host. Three Postgres instances hold every account, zone,
list and catalog row on a storage class whose entire implementation is a directory on the
node's own disk.

## 1. What is actually at risk

`local-path` is k3s's built in provisioner. A PersistentVolume is a path under
`/var/lib/rancher/k3s/storage/` on the node that claimed it. There is no replication, no
second copy, and the provisioner implements no `VolumeSnapshot` support, so the usual
Kubernetes answer of snapshotting the PVC is not available.

That gives a short and unpleasant list of single events that lose everything:

- The VPS is lost, or its disk fails.
- The provider rebuilds the instance.
- Someone runs `helm uninstall` and Helm removes the PVCs.
- A migration or a manual `psql` session does something irreversible.

None of these is exotic and the last two are the likely ones.

A second thing is unbacked and easy to forget because it is not in a database:
`AUTH_JWT_PRIVATE_KEY` exists only inside a Kubernetes Secret in the same cluster. Losing it
does not lose data, but every issued access and refresh token becomes unverifiable at once,
which logs out every user simultaneously. Recoverable, embarrassing, and avoidable by keeping
the keypair somewhere other than the cluster that uses it.

Worth saying plainly: this is a production concern only. Staging is disposable by design and
gains nothing from backups, so everything below is gated off by default and enabled in the
production values file.

## 2. Approach: logical dumps, not volume copies

Three options, and the choice is not close for this cluster.

**Volume snapshots** are unavailable, per the provisioner above.

**Filesystem copies of the data directory** are unsafe while Postgres is running and produce
a backup whose integrity you cannot check without restoring it into the identical major
version.

**`pg_dump`** is a consistent logical dump taken through a normal connection. It runs against
a live database, it is portable across minor and major versions, it compresses well, and
`pg_restore --list` can inspect one without a server. For three databases whose combined size
is measured in megabytes, the usual objection to logical dumps, that they do not scale, does
not apply and will not for years.

## 3. Design

### 3.1 A CronJob per instance

One CronJob per Postgres instance, rendered from the same `postgres.instances` list that
already drives the StatefulSets, so a fourth database gets a backup by existing rather than by
someone remembering.

```yaml
schedule: "17 2 * * *"        # staggered per instance, see below
concurrencyPolicy: Forbid
startingDeadlineSeconds: 3600
successfulJobsHistoryLimit: 3
failedJobsHistoryLimit: 5
```

The container is the same `postgres:16-alpine` image the instance runs, which is what
guarantees `pg_dump` matches the server version, plus an S3 client. It reads the instance's
`*_DB_URL` from the existing application Secret, so the credentials are not duplicated.

```sh
set -euo pipefail
stamp=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump --format=custom --compress=9 "$DB_URL" > "/tmp/${DB_NAME}-${stamp}.dump"
# Fail loudly on an empty or truncated dump rather than uploading it.
pg_restore --list "/tmp/${DB_NAME}-${stamp}.dump" > /dev/null
aws s3 cp "/tmp/${DB_NAME}-${stamp}.dump" \
  "s3://${BUCKET}/${DB_NAME}/${stamp}.dump" --endpoint-url "$S3_ENDPOINT"
```

`--format=custom` rather than plain SQL, because it compresses, and because
`pg_restore` can then read the table of contents, restore selectively, and validate the file.
That validation line is the important one: the classic failure is not a missing backup, it is
a bucket full of zero byte files that nobody looked at.

`concurrencyPolicy: Forbid` and a stagger across the three instances (`17 2`, `37 2`, `57 2`)
so three dumps never contend for the same single node at once.

### 3.2 Off the machine, or it is not a backup

The destination must not be the node being backed up. Any S3 compatible object store works;
the cluster is already on Hetzner, so Hetzner Object Storage is the path of least resistance,
and Backblaze B2 is the cheap alternative. Credentials go in their own Secret,
`luna-shopper-backend-backup-secret`, created out of band exactly like the others, holding
`S3_ENDPOINT`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

Use a bucket key scoped to that one bucket, and ideally write only. A backup credential that
can delete its own bucket turns a compromised cluster into a compromised backup.

### 3.3 Retention belongs to the bucket

Do not implement retention in the CronJob. Object storage lifecycle rules already express
"expire after N days" declaratively, they run whether or not the cluster is healthy, and they
cannot be broken by a bug in a shell script. Configure a lifecycle rule of 30 days on the
prefix and stop there; if grandfathered monthly copies are wanted later, that is a second
prefix and a second rule, not code.

Enable object versioning on the bucket. It is what turns "the dump uploaded today was
corrupt" from a lost backup into a lost day.

### 3.4 What is not backed up, deliberately

**NATS JetStream.** Its PVC holds in flight events, not the system of record. Every stream is
rebuildable from the databases, and restoring a stale event log risks replaying work that has
already been applied. Losing it costs the events currently in flight, which is the correct
thing to lose in a disaster. Stated here so the omission is a decision.

**The frontend images and the chart.** Both are in the registry and in git.

## 4. The restore drill is the deliverable

A backup that has never been restored is a hypothesis. The plan is not complete when dumps
appear in the bucket; it is complete when one has been put back.

Write `k8s/helm/restore-database.sh` taking an instance name and an object key, which:

1. Downloads the dump.
2. Creates a scratch database alongside the real one, never over it. A restore script whose
   default target is production is a foot gun waiting for a bad night.
3. `pg_restore` into the scratch database.
4. Prints row counts for the principal tables so the operator sees the shape of what came
   back.

Promoting the scratch database to the real one stays manual and deliberate: it requires
stopping the service, renaming, and restarting, and that sequence should be typed by a person
who has decided to do it.

Run the drill once when the plan lands, and record in the script header what the restore
actually took, in wall clock time, so the recovery objective is a measured number rather than
a hope.

### 4.1 Optionally, prove it continuously

The stronger version, worth doing once the drill exists: a weekly CronJob that restores the
most recent dump into a scratch database, asserts a table exists and its row count is above
zero, then drops it. That converts "we have backups" from a belief into a passing job, and it
is the only mechanism here that notices a silently broken backup within a week instead of
within a disaster.

## 5. Secrets belong outside the cluster too

Independently of Postgres, take the JWT keypair and the six Secrets off the machine:

```sh
kubectl -n nx-portfolio get secret luna-shopper-backend-secrets -o yaml
```

into a password manager or an encrypted store, once, at provisioning time. Plan
`k8s/plans/0006` scripts the creation of these Secrets, and that script is the natural place
to also emit the copy the operator files away, since it is the moment the values exist in
plaintext anyway.

Do not commit them, encrypted or otherwise, and do not put them in the backup bucket that the
cluster itself can write to.

## 6. Verification

- A CronJob exists per Postgres instance and the first scheduled run uploads a non empty
  object.
- `pg_restore --list` on a downloaded dump prints a table of contents.
- The restore script rebuilds a scratch database and its row counts match production.
- Deleting a PVC in **staging** and restoring from a dump reproduces the data. Rehearse it
  where it cannot hurt.
- The bucket's lifecycle rule expires an object older than the retention window.
- Backups are absent in staging by default, so `helm template` for staging renders no CronJob.
