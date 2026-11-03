# 0019: The namespace and the databases take the name

> The owner renamed the product on 2026-11-02: Luna Shopper is gone and the whole thing is
> Velista (docs `0003`). This plan carries the name into the layer a rename of code cannot
> reach, the objects a cluster persists: the namespace `luna-shopper`, the Secrets, the
> StatefulSets and their volume claims, the PriorityClass, the four Postgres databases and
> their roles, and the connection strings that name them. It writes one idempotent cutover
> script, `k8s/bootstrap/rename-release.sh`, modeled on `split-release.sh` (k8s `0016` D5),
> that the deploy preflight runs on staging by itself and on production when the owner
> allows it. The script also makes each database adopt the baseline migration of backend
> `0240`, because the first images built after `0240` carry no old migration chain and would
> otherwise try to create tables that exist.
>
> This reverses one owner decision on purpose. k8s `0014` D3 named the namespace
> `luna-shopper` so that "nothing is renamed a second time". The owner decided on
> 2026-11-03 that the namespace and the databases take the new name too (decision 5 of the
> series), so the cost of one more stateful move is accepted here, once.
>
> Names. docs `0003` renames the projects to `velista-server-<service>`, `velista-client`
> and `velista-admin`, the directories to `apps/velista-server`, `apps/velista-client` and
> `apps/velista-admin`, the alias to `@velista/*`, and the images after the projects. This
> plan uses those names for what it creates and today's paths when it points at code that
> exists. The plan directories of the apps move with docs `0003`
> (`apps/luna-shopper-backend/plans` to `apps/velista-server/plans`, `apps/velista/plans` to
> `apps/velista-client/plans`); this file lives in `k8s/plans`, which does not move. Where
> this plan names a file that docs `0003` renames before this plan is built, it gives the
> new name and today's in parentheses: the slot script `server-slot.sh` (today
> `luna-slot.sh`), the gate directories `k8s/e2e/velista-server` and `k8s/e2e/velista-stack`
> (today `k8s/e2e/luna-shopper-backend` and `k8s/e2e/velista-luna`), the e2e projects
> `velista-server-e2e` and `velista-stack-e2e` (today `luna-shopper-backend-e2e` and
> `velista-luna-e2e`).
>
> Prerequisite reading: k8s `0014` D3, `0015` D6, D10 and D12, `0016` D5 with its "As built"
> notes, `0005`, `0011`; `k8s/bootstrap/split-release.sh`, `k8s/bootstrap/provision-release.sh`,
> `k8s/helm/deploy-release.sh`, `k8s/helm/restore-database.sh`,
> `k8s/helm/velista/templates/luna-shopper-backend/{postgres,migration-job,backup-cronjob,transcriber,priorityclass}.yaml.tpl`,
> `k8s/helm/velista/values.yaml`, `k8s/units/velista/unit.env`,
> `.github/actions/deploy-unit/action.yml`, `.github/workflows/redeploy.yml`,
> `k8s/README-new-cluster.md` section "Existing clusters: the cutover", backend `0240`.
>
> **Build order.** Third step of the series. It needs docs `0003` (the names) and backend
> `0240` (the baseline it adopts) merged first. Nothing else in the series waits on it except
> docs `0005`, which moves the repository only after both clusters run under the new names.
> The rollup from `dev` to `main` that carries `0240` must carry this plan too, because a
> staging deploy of `0240`'s images against a database that has not adopted the baseline
> fails in the migration hook (section "Decisions", D6). Staging cuts over through the first
> `staging-velista` run after that rollup. Production cuts over at the first velista release
> after it, or by the owner's hand, as with `split-release.sh`. The series order, as every
> plan of the series states it: docs `0003` first, alone, after the pull request gate; then
> in parallel docs `0004`, backend `0240` to `0243`, velista `0178`, k8s `0020` and `0021`
> (backend `0242` after velista `0178` for the admin mechanism, k8s `0020` after backend
> `0241` for the generated files); k8s `0019` after docs `0003` and backend `0240`, in the
> same rollup to `main` as `0240`; docs `0005` last, with docs `0006` read from the start.

## Brief for the agent

### Objective

Move the velista unit from namespace `luna-shopper` to namespace `velista` on staging and
production, with every persisted identifier under its new name, in one short planned
backend interruption per cluster and with no byte of data copied. Rename each Postgres
database and role in place, adopt backend `0240`'s baseline in each `migrations` table, and
give a fresh cluster the new names from `provision-release.sh`. Make the script idempotent,
runnable from the deploy preflight, a no op on a renamed cluster and on a fresh one.

Use `antislop` with `antislop-code` for every comment you write.

### Context

Every statement below was read in the checkout on 2026-11-03.

- **What carries the old name.** `k8s/units/velista/unit.env`: `NAMESPACE=luna-shopper`,
  `RELEASE_NAME=velista`, and `SECRETS` with the seven names `luna-shopper-backend-secrets`,
  `luna-shopper-backend-{auth,core,catalog,harvester}-db-secret`,
  `luna-shopper-backend-backup-secret`, `luna-shopper-backend-operator`.
  `provision-release.sh:122-138` holds the same seven, and `:872-875` derives the four URLs
  `postgres://luna_<x>:<pw>@luna-shopper-backend-<x>-db:5432/luna_<x>`.
  `values.yaml` names every Deployment, Service, StatefulSet and instance:
  `lunaShopperBackend.services[].name` (`luna-shopper-backend-gateway` and six more),
  `postgres.instances[]` (`name`, `database`, `user`, `secret`), `instanceOverrides`
  keyed by instance name, `config.natsUrl` and `config.redisUrl`, `priorityClass.name:
  luna-stateful`, `legal.secret`, `backups.secret`, and the `apps` entries `velista` and
  `luna-shopper-admin`. The templates hard code more: `luna-shopper-backend-config`
  (`configmap.yaml.tpl:17`, `deployment.yaml.tpl:4`), `luna-shopper-backend-secrets`
  (`deployment.yaml.tpl:5`, `migration-job.yaml.tpl:4`, `backup-cronjob.yaml.tpl:5`),
  `luna-shopper-backend-nats` and its config (`nats.yaml.tpl`), `luna-shopper-backend-redis`
  (`redis.yaml.tpl`), `luna-shopper-backend-transcriber` (`transcriber.yaml.tpl:5`), the
  gateway URL and transcriber URL defaults (`configmap.yaml.tpl:217,234`), the label
  `app.kubernetes.io/part-of: luna-shopper-backend`, and the operator Secret fallback in
  `_env.tpl:366`.
- **Volumes.** Each Postgres StatefulSet and NATS have a `volumeClaimTemplates` entry
  `data`, so their claims are `data-<statefulset>-0`. The transcriber has a standalone claim
  `luna-shopper-backend-transcriber-models` with `helm.sh/resource-policy: keep`
  (production only). Storage is `local-path`: a volume is a directory on the node.
- **Postgres.** `postgres:16-alpine` (`values.yaml`, `postgres.image`). `POSTGRES_USER` is
  the database name, so `luna_auth` is the bootstrap superuser of its instance and no
  `postgres` role exists. Nothing in the repository sets `password_encryption` or
  `POSTGRES_HOST_AUTH_METHOD`, so the defaults of Postgres 16 and of the image apply:
  `scram-sha-256`, and trust on the local socket. A SCRAM verifier does not depend on the
  role name, so `ALTER ROLE ... RENAME` keeps it; Postgres clears only an MD5 password on
  rename. Postgres refuses to rename the role of the current session and a database that
  has connections.
- **Migrations.** TypeORM keeps one row per applied migration in table `migrations`
  (`id` serial, `timestamp` bigint, `name` varchar). The heads of the old chains today are
  `OAuthNonces1773400000000` (auth), `AssistantAllowance1756004000000` (core),
  `SectionsOfAShop1759000000000` (catalog) and `HarvestSchedules1759400000000` (harvester),
  the last entries of `apps/luna-shopper-backend/<service>/src/app/db/migrations/index.ts`.
  The chains hold 12 migrations (auth), 38 (core), 31 (catalog) and 23 (harvester), 104 in
  all, counted in each `index.ts` and equal to the migration files beside it (backend
  `0240`). Backend `0240` deletes those chains and adds one baseline per service. The chart runs
  `node migrate.js` as a hook Job (`migration-job.yaml.tpl`): `post-install` on a first
  install, `pre-upgrade` after.
- **Backups.** `backup-cronjob.yaml.tpl` uploads `s3://<bucket>/<DB_NAME>/<stamp>.dump`,
  where `DB_NAME` is the database name. The bucket's lifecycle rule deletes objects after
  14 days (`values.yaml`, comment above `backups:` and `retentionDays: 14`).
  `restore-database.sh` resolves `latest` under `<DB_NAME>/` (`:187-197`) and restores
  with `--no-owner --no-privileges` (`:242`).
- **The portfolio route.** `k8s/helm/portfolio/values.yaml` `externalRoutes` renders
  HTTPRoute `velista-portfolio` with backend Service `velista` in namespace `luna-shopper`.
  The velista chart's `referenceGrants` (`values.yaml`) allows it from namespace
  `portfolio`. `provision-release.sh --check` fails when either namespace literal differs
  from the other unit's `unit.env` (`check_unit_render`).
- **The preflight.** `.github/actions/deploy-unit/action.yml:134-175` runs
  `split-release.sh --status` and the cutover before `provision-release.sh --check`; on
  production only when the input `allow_cutover` (the variable `ALLOW_CUTOVER` of
  `<unit>-production`) is `true`. `deploy-release.sh` refuses a cluster whose
  `split-release.sh --status` is `pending`, and skips its uninstall path when the namespace
  holds ConfigMap `deploy-cutover` or a StatefulSet. `redeploy.yml:130-151` refuses a version
  older than the oldest release whose tree holds `.github/actions/deploy-unit/action.yml`.
- **Release tasks.** The ledger is ConfigMap `release-tasks` in the unit's namespace.
  `run-release-tasks.sh:209` derives CronJob names from `luna-shopper-backend-`. Task `0005`
  has a window until 2026-11-12 and its scripts default `NAMESPACE` to `luna-shopper`.

### Target state

1. `k8s/units/velista/unit.env` says `NAMESPACE=velista`, `RELEASE_NAME=velista`, and the
   seven new Secret names (D1). `units.mjs check` passes.
2. `helm template` of the velista chart with each environment's values renders no
   identifier that contains `luna` (checked by a grep in the progress evidence), and every
   object name in D1's table.
3. `provision-release.sh --unit velista --env <env>` on an empty cluster writes the seven
   new Secrets into namespace `velista` with URLs of the form
   `postgres://velista_<x>:<pw>@velista-server-<x>-db:5432/velista_<x>`, and `--check`
   asserts them.
4. `k8s/bootstrap/rename-release.sh` exists with `--env`, `--unit`, `--tag`, `--plan` and
   `--status`, the steps of D4, and the marker ConfigMap `deploy-rename`. `--status`
   answers `none`, `pending` or `cleanup`.
5. `k8s/bootstrap/rename-release/chains.env` names, per service, the old chain and the
   baseline row; `node --test k8s/bootstrap/rename-release/chains.test.mjs` asserts the
   baseline names equal the entries of each service's `migrations/index.ts` after `0240`,
   and runs in `pr.yml`.
6. The deploy action runs `rename-release.sh --status` and the cutover for the velista unit
   as it runs `split-release.sh`, gated on production by the variable `ALLOW_RENAME` of
   `velista-production`. `deploy-release.sh` refuses `pending`. `redeploy.yml` refuses a
   velista version older than the oldest release whose tree holds `rename-release.sh`.
7. On staging, then production: `helm list -A` shows `velista` in namespace `velista`;
   `kubectl get ns` shows no `luna-shopper` after the cleanup step; each database is
   `velista_<x>` owned by role `velista_<x>`; each `migrations` table holds exactly one row,
   the baseline; the four public hosts answer; the PersistentVolumes are the same objects
   as before the cutover (same names), bound in `velista`.
8. `restore-database.sh` takes the new instance names, and `latest` finds the newest dump
   under the new prefix or, when there is none, under the old one (D3).
9. `server-slot.sh` (today `luna-slot.sh`), `stack.sh`, `compose.yml`, `compose.apps.yml` and the `.env.example`
   files use the new database names for every new slot, and a slot whose volume still
   holds the old names is renamed in place by the same SQL (D9).
10. `k8s/README-new-cluster.md` has a section "Existing clusters: the rename" and names
    the new namespace and Secrets everywhere; `k8s/helm/luna-shopper-backend-secrets.md`
    becomes `k8s/helm/velista-server-secrets.md`; `CLAUDE.md` follows (section "CLAUDE.md").

### Scope

In: `k8s/units/velista/unit.env`; `k8s/helm/velista/**` (values, templates, a new
`values.local.yaml` for the rehearsal); `k8s/helm/portfolio/values.yaml` (the
`externalRoutes` entry, per the owner's choice in D7); `k8s/bootstrap/rename-release.sh`
and `k8s/bootstrap/rename-release/` (new); `k8s/bootstrap/provision-release.sh`;
`k8s/helm/deploy-release.sh`, `deploy-homelab.sh`, `restore-database.sh`;
`k8s/release-tasks/run-release-tasks.sh`; `.github/actions/deploy-unit/action.yml`,
`.github/workflows/release-unit.yml`, `stage-unit.yml` (the input), `redeploy.yml`,
`pr.yml` (the chains test); `k8s/e2e/velista-server/{compose.yml,compose.apps.yml,server-slot.sh,stack.sh,run-services.sh,gate.env}`,
`k8s/e2e/velista-stack/*` where they name a database or a Service;
`apps/luna-shopper-backend/*/.env*.example` (the URLs only);
`k8s/README-new-cluster.md`, `k8s/README.md`, `k8s/README-homelab.md`,
`k8s/helm/luna-shopper-backend-secrets.md`, `CLAUDE.md`; `k8s/catalog-import/` only as
owner decision 5 says.

Out: image names and project names (docs `0003`); the migration files and `migrate.js`
(backend `0240`); expired release tasks `0001` to `0004`, whose files stay as history;
`split-release.sh`, which stays as it is and answers `none` on every cluster; the
portfolio's own namespace; the Compose deploy path (k8s `0020`); the chart's generic
options (k8s `0021`).

### Constraints

- The script changes places and names, not versions. It installs the new release at the
  tag the pipeline deploys (`--tag`), never at the live tag (D5).
- No byte is copied. Volumes are rebound, as in `split-release.sh` step 5.
- The Secrets are copied, never regenerated: a new `HARVESTER_ACTOR_ID` orphans every
  catalog row the harvester wrote and new JWT keys sign every user out. Only the four
  `*_DB_URL` values change, and each is rebuilt from the copied password.
- Nothing uninstalls a release and no Helm call of the cutover uses `--atomic`.
- Each step is safe to run again and records itself in ConfigMap `deploy-rename` of both
  namespaces.
- The script refuses to start when any velista release task has an open window or is
  `pre-done`, when a database is not at the head of its old chain, or when the images of
  `--tag` cannot be pulled.
- Every helm and kubectl call runs under the host lock (`host-lock.sh`), as
  `split-release.sh` does.
- No comment or message names the owner's domains as a rule of the script; hosts come from
  `unit.env`.

### Action boundaries

- Stop and ask before you run the script against any cluster other than Docker Desktop
  (`--env local`). Staging runs through the staging pipeline after the owner merges.
  Production runs only through a release with `ALLOW_RENAME=true` or by the owner's hand.
- Stop and ask before you delete any PersistentVolume, any Secret outside the cutover's
  own namespaces, any object in the backup bucket, or any registry image.
- Stop and ask if the rehearsal shows a role whose password is MD5 (D2): the script then
  sets the password again, and that is a change to a credential.
- Stop and ask before you change backend `0240`'s baseline names or timestamps. Copy them.
- Adding a dependency to the host (a tool the script needs beyond `kubectl`, `helm`,
  `awk`, `sed`) needs the owner's yes. `jq` is not on the hosts.

### Progress evidence

- `node tools/deploy/units.mjs check` and `node --test k8s/bootstrap/rename-release/chains.test.mjs` pass.
- `helm template velista k8s/helm/velista -n velista -f k8s/helm/velista/values.yaml -f k8s/helm/velista/values.production.yaml | grep -i luna` prints nothing; the same for staging and homelab.
- `bash k8s/bootstrap/provision-release.sh --check --unit velista --env staging --render-only` passes.
- The rehearsal on Docker Desktop (D8): the old chart installed from the base commit into
  `luna-shopper`, seeded, then `rename-release.sh --env local --plan` and `--env local`
  run to the end; the builder pastes into the PR the step timings, the backend outage the
  script prints, `psql -c '\l'` and `SELECT * FROM migrations` per instance,
  `SELECT left(rolpassword, 14) FROM pg_authid WHERE rolname LIKE 'velista_%'` before and
  after, and `kubectl get pv` before and after with the same volume names.
- A second run of `rename-release.sh --env local` prints that nothing is left to do.
- On staging after the merge: the `staging-velista` summary shows the rename steps;
  `helm list -A`; `kubectl get ns`; `bash k8s/bootstrap/check-endpoints.sh` with the four
  staging hosts; the `velista-server-e2e` and `velista-stack-e2e` gates of the next
  run pass; a sign in with an account created before the cutover works (the sessions and
  the data survived).
- `bash k8s/e2e/velista-server/server-slot.sh --up` on a fresh slot, and on a slot kept
  from before the change, both reach a migrated stack.

## Decisions taken in this plan

### D1. The new identifiers

| Kind | Today | After |
| --- | --- | --- |
| Namespace | `luna-shopper` | `velista` |
| Release | `velista` | `velista` (unchanged) |
| Gateway, Issuer | `velista`, `letsencrypt` in `luna-shopper` | the same names in `velista` |
| App entries (Deployment, Service, HTTPRoute) | `velista`, `luna-shopper-admin` | `velista-client`, `velista-admin` |
| Backend Deployments, Services, HTTPRoutes, PDBs | `luna-shopper-backend-<svc>` | `velista-server-<svc>` |
| Postgres StatefulSets and Services | `luna-shopper-backend-<x>-db` | `velista-server-<x>-db` |
| Their claims | `data-luna-shopper-backend-<x>-db-0` | `data-velista-server-<x>-db-0` |
| NATS, Redis, transcriber | `luna-shopper-backend-{nats,redis,transcriber}` | `velista-server-{nats,redis,transcriber}` |
| ConfigMaps | `luna-shopper-backend-config`, `luna-shopper-backend-nats-config` | `velista-server-config`, `velista-server-nats-config` |
| Secrets | `luna-shopper-backend-secrets`, `-<x>-db-secret`, `-backup-secret`, `-operator` | `velista-server-secrets`, `velista-server-<x>-db-secret`, `velista-server-backup-secret`, `velista-server-operator` |
| PriorityClass | `luna-stateful` | `velista-stateful` |
| Label `app.kubernetes.io/part-of` | `luna-shopper-backend` | `velista-server` |
| Databases and roles | `luna_<x>` | `velista_<x>` |
| `*_DB_URL` | `postgres://luna_<x>:<pw>@luna-shopper-backend-<x>-db:5432/luna_<x>` | `postgres://velista_<x>:<pw>@velista-server-<x>-db:5432/velista_<x>` |
| Backup keys | `<bucket>/luna_<x>/<stamp>.dump` | `<bucket>/velista_<x>/<stamp>.dump` |
| Ledger | ConfigMap `release-tasks` | the same name in `velista` |
| Cutover marker | none | ConfigMap `deploy-rename` |

`<x>` is `auth`, `core`, `catalog`, `harvester`. The release keeps its name, so `helm
history velista` keeps meaning the velista unit; only its namespace moves.

The division with docs `0003` (its D5) is: under `k8s/helm/velista`, docs `0003` changes the
`image` fields, the values key `lunaShopperBackend`, the template directory and `define`
names and the harvester user agent token, and no Kubernetes object name; k8s `0019`
renames every object. So every object of D1's table still carries its old name when this
plan starts. docs `0003` D5 also changed the staging restart list in `stage-unit.yml` and
`deploy-unit` to every Deployment of the release whose container image is one of the
images the run built, read from `helm get manifest`. That rule names no Deployment, so the
renames of this plan need no edit to it, and the builder confirms it restarts the new
`velista-server-<svc>` Deployments on the first staging run after the cutover.

The templates stop spelling names. One helper, `velista.serverName` in
`k8s/helm/velista/templates/_helpers.tpl`, returns `velista-server-<suffix>`, and every
template that hard codes `luna-shopper-backend-` calls it. Values keep their entry names
(`velista-server-gateway` in `services[].name`) because the hostOverrides and
instanceOverrides key on them. A prefix value was considered and rejected: the names are a
contract of the cutover and of the DB URLs in the Secret, and a value that changes them
breaks every connection string with no render error.

The bucket prefix changes with the database name because the CronJob builds the key from
`DB_NAME`, and a key that names a database that no longer exists misleads the person who
restores. Old dumps stay where they are and the lifecycle rule deletes them 14 days after
they were written. Nothing copies or renames objects in the bucket: the bucket credential
is write only by design (`values.yaml`, `backups` comment), and a rename is a copy plus a
delete.

### D2. The data stays, the names change in place

The volumes move as in `split-release.sh` step 5: reclaim policy `Retain`, delete the old
StatefulSets and claims, clear each volume's `claimRef`, create the new claim with
`volumeName` set. The claim name changes (`data-velista-server-auth-db-0`); a claim may
bind any volume by name, so this costs nothing more than the move of k8s `0016` did. The
transcriber claim moves the same way and gets the Helm adoption annotations
(`meta.helm.sh/release-name=velista`, `meta.helm.sh/release-namespace=velista`, label
`app.kubernetes.io/managed-by=Helm`), because the chart renders it as a standalone object
and Helm refuses to install over an object it does not own.

Inside each Postgres, while the old StatefulSet still runs and no service is connected:

```sql
-- as luna_<x> over the local socket (trust), in database postgres
CREATE ROLE velista_cutover SUPERUSER LOGIN;
-- as velista_cutover, in database postgres
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = 'luna_<x>' AND pid <> pg_backend_pid();
ALTER DATABASE luna_<x> RENAME TO velista_<x>;
ALTER ROLE luna_<x> RENAME TO velista_<x>;
ALTER ROLE velista_<x> PASSWORD '<POSTGRES_PASSWORD from the copied Secret>';
-- as velista_<x>
DROP ROLE velista_cutover;
```

The temporary role exists because the bootstrap superuser is the only role and Postgres
refuses to rename the session's own role. The local socket is trusted in the official
image, so no password is involved in these sessions. The script sets the password again
every time, from the copied Secret: on `scram-sha-256` it is a no op that costs a
millisecond, and on an instance that was ever initialised with `md5` it is the step that
keeps the services connecting. The rehearsal records which case the clusters are in.

Each statement is guarded by a query, so a rerun skips what is done: the database
`velista_<x>` exists, the role `velista_<x>` exists, the role `velista_cutover` is gone.
The readiness probe of the old pod (`pg_isready -U luna_<x> -d luna_<x>`) keeps passing,
because `pg_isready` reports whether the server answers and does not authenticate.

The alternative, dump and restore into new databases on new volumes, was rejected. It
doubles the disk on a node sized for one copy, its duration grows with the catalog (the
step that takes 78 seconds today would take as long as a full restore), and it needs the
new StatefulSets running beside the old ones. Its one advantage, that the old database
stays untouched, is covered by the dump of step 2 and by the reverse SQL the script prints.

### D3. The restore finds old dumps for their 14 days

`restore-database.sh` takes `velista-server-<x>-db` and resolves `latest` under
`velista_<x>/`. When that prefix is empty, it looks under `luna_<x>/` and prints that it
did. An explicit key works for either prefix, and `--no-owner --no-privileges` makes the
role name in an old dump irrelevant. The fallback is three lines with a comment that it
becomes dead 14 days after the production cutover; the docs `0005` import may drop it.

### D4. The steps

`k8s/bootstrap/rename-release.sh --env <staging|production|homelab|local> --unit <unit>
--tag <tag> [--plan]`, and `--unit <unit> --status`. It runs on the host as the deploy
account. `--status` answers `none` for a unit other than velista, for a cluster with no
namespace `luna-shopper` (a fresh cluster, or one after step 9), and otherwise `pending`
before step 8 and `cleanup` after. It reads the new names from `unit.env` and the old ones
from constants at its top, because the old ones exist nowhere else after the merge.

1. **Check and prepare.** Refuse unless: the old release `velista` in `luna-shopper` is
   `deployed`; `run-release-tasks.sh --phase check` shows no open task; every existing
   database's `migrations` table holds exactly the old chain of `chains.env` (D6); every
   image of the new chart at `--tag` can be pulled (a pod per image in `velista` with
   command `true`, which also pre pulls them, so the outage does not wait on downloads).
   Create namespace `velista`. Copy, with the cert-manager annotations stripped, the TLS
   Secrets the rendered Gateway names. Copy the seven Secrets under their new names:
   verbatim, except the four `*_DB_URL` keys of `velista-server-secrets`, each rebuilt from
   the `POSTGRES_PASSWORD` of its instance Secret after asserting that the old URL holds
   that same password. A copy that exists with other values stops the script, as
   `copy_secret` does today. Copy the ledger `release-tasks`. No interruption.
2. **Dump.** One Job per database from the old backup CronJobs, as `split-release.sh`
   `dump_databases` does; record the keys (under `luna_<x>/`) in the marker. `--env local`
   skips it. No interruption.
3. **Stop the backend.** Set the volumes to `Retain`. Annotate nothing yet. Suspend the old
   backup CronJobs. Delete the old backend Deployments and the transcriber Deployment in
   `luna-shopper` and wait until their pods are gone (`wait_pods_gone` of
   `split-release.sh`, which ignores finished Job pods). The backend interruption starts;
   record `backendDownAt` once. The old client and admin pods keep serving static files.
4. **Rename and adopt.** For each running old Postgres pod, the SQL of D2, then the
   adoption of D6 inside `velista_<x>`, through `kubectl exec ... psql`. Record each
   instance in the marker as it finishes.
5. **Move the volumes.** Delete the old Postgres and NATS StatefulSets and wait for their
   pods. Delete the old claims. Rebind each volume to its new claim name in `velista` with
   `volumeName` set; annotate the transcriber claim for adoption. Delete the Helm storage
   Secrets of the old release (`owner=helm,name=velista` in `luna-shopper`), so that no
   person can `helm rollback` the old release onto claims that no longer exist. Annotate
   nothing on `luna-stateful`: the new chart renders `velista-stateful` and the two coexist.
6. **Install.** `helm upgrade --install velista <chart> -n velista` with the environment's
   values, `--set imageTag=<tag> --set gateway.enabled=false`, `--wait --timeout 20m`, no
   `--atomic`. The StatefulSets adopt the claims by name; the `post-install` migration Jobs
   find the baseline row and apply nothing.
7. **Swap the Gateways**, new first, as `split-release.sh` step 6 as built: `helm upgrade`
   with `gateway.enabled=true` (its HTTPS listeners wait as Conflicted), then delete
   Gateway `velista` and every HTTPRoute in `luna-shopper`. Print the backend outage from
   `backendDownAt`. Wait until Gateway `velista` in `velista` is `Programmed`. When the owner
   keeps the portfolio mount (D7, option A), patch the live HTTPRoute `velista-portfolio` in
   `portfolio` to backend `velista-client` in namespace `velista`.
8. **Verify.** `kubectl rollout status` for every Deployment of the new release; one
   `SELECT name FROM migrations` per database, which must print the baseline alone; the
   Certificates of `velista` listed. The deploy action then runs `check-endpoints.sh` from
   the runner with the unit's `HOSTS_<ENV>`.
9. **Clean up**, by a later deploy, when the swap is an hour old, every Certificate in
   `velista` is Ready under its Issuer, and (option A only) the portfolio release's own
   manifest names namespace `velista` in its route, so that a portfolio deploy can no longer
   point the route back: delete namespace `luna-shopper` and PriorityClass `luna-stateful`.
   The volumes stay, bound in `velista`.

`--plan` prints, for each step, the objects it would copy, delete, rebind or rename, the
SQL it would run per instance with the current row count of each `migrations` table, the
tag and the images it would pull, and exits.

What a failure leaves:

- **Steps 1 and 2**: nothing that serves has changed. A rerun continues.
- **Step 3**: the backend is down, the old StatefulSets run, the data is untouched. The
  script prints the way back: `helm rollback velista <current revision> -n luna-shopper`,
  which recreates the deleted Deployments from the stored manifest.
- **Step 4**: some instances are renamed. The script prints, per renamed instance, the
  reverse SQL (the same statements with the names swapped, and the migrations rows from
  the marker reinserted) and the rollback command, or a rerun to go forward.
- **Step 5**: the data is on retained volumes and in the dump; the script prints, per
  volume, the `kubectl patch pv` that binds it to a claim in `velista` or back in
  `luna-shopper`, as `print_rebind` does today.
- **Steps 6 and 7**: the new release exists and may be failed; nothing uninstalls it. The
  diagnosis prints both Gateways, `helm list -A` and the Envoy Service, as today.
- **Step 9** waits and exits 0; a later deploy finishes it.

The interruption: the backend from step 3 to the old Gateway's delete in step 7. The edge
stays up for the client and admin hosts throughout, because their old pods serve until the
swap and their new ones serve after. The k8s `0016` rehearsal measured 78 to 79 seconds for
the equivalent of steps 3 to 6 with images already on the node; the rename adds a few
seconds per instance. Expect two to four minutes of 503 from `api.` and `rt.`.

### D5. The install uses the tag being deployed

`split-release.sh` installed at the live tag because it moved code that already ran. Here
the live images cannot run under the new chart: their names are the old image names, and
their `migrate.js` carries the old chain, which would see one baseline row and try to apply
every old migration. So the action passes `--tag`: `staging` on staging, the release
version on production. The pipeline's own `helm upgrade` then follows as on any run and
changes nothing.

### D6. The baseline adoption and its invariant

In each renamed database, in one transaction:

1. If the table holds exactly one row and it is the baseline of `chains.env`, do nothing.
2. Otherwise the table must hold exactly the names of the old chain listed in
   `chains.env`, no more and no fewer (which implies the head is applied). If not, refuse
   and print the difference. A database behind the chain is missing schema the baseline
   assumes, and one ahead of it holds a migration nobody wrote down; neither can adopt.
3. `DELETE FROM migrations`, then `INSERT INTO migrations ("timestamp", name) VALUES
   (<baseline timestamp>, '<baseline name>')`. The old rows are written to the marker
   first, so the reverse SQL of step 4 can put them back.

The check runs in step 1 too, read only, so a database behind the chain stops the cutover
before anything moves.

`k8s/bootstrap/rename-release/chains.env` holds, per service, `OLD_CHAIN_<SVC>` (the names
in order, generated by the builder from the last commit of `dev` before `0240` merged: 12
for auth, 38 for core, 31 for catalog, 23 for harvester on 2026-11-03, more if a branch
adds a migration before the baseline is generated) and `BASELINE_NAME_<SVC>` and
`BASELINE_TIMESTAMP_<SVC>`, copied from backend `0240` target state 1 and its "The adoption
contract": `AuthBaseline1780000000000`, `CoreBaseline1780000000000`,
`CatalogBaseline1780000000000`, `HarvesterBaseline1780000000000`, each with timestamp
`1780000000000`. The data lives under `k8s/` because the host receives `k8s/` only.
`chains.test.mjs` reads each `migrations/index.ts` and fails when its single entry is not
the baseline of the file.

What this plan relies on from backend `0240`, which owns the names, the timestamp and the
guard:

- **The timestamp is a sort key only.** Backend `0240` found that TypeORM 1.1.x
  (`MigrationExecutor`) chooses pending migrations by name: a migration whose name is not
  in the `migrations` table is pending, whatever its timestamp. `1780000000000` is above
  every old head (the highest is auth's `1773400000000`), so the baseline sorts first on an
  empty database, but the number does not hide the baseline from an old image or an old
  image's chain from an adopted database. The protection that remains is twofold: the
  redeploy floor of D10, which refuses every velista version from before the rename, and
  the guard below.
- **The guard lives in the baseline, inside `migrate.js`** (backend `0240` target state 4
  and D4). Each baseline's `up` first reads the `migrations` table and the tables of schema
  `public`, and throws when the ledger holds any row or `public` holds any table other than
  `migrations`, naming the database, the rows it found and the remedy (the adoption of this
  plan, `rename-release.sh`, or `stack.sh` on a slot). That turns a merge out of order into
  a readable red deploy rather than a half applied baseline. (A rejected alternative:
  `migrate.js` adopts by itself. It would hide the invariant check inside every boot of a
  Job and run it on a cluster the owner has not chosen to move.)
- **The same rollup.** Backend `0240` asks, as this plan does, that the rollup from `dev`
  to `main` that carries `0240` carry this plan too, so that staging never meets the guard.

### D7. The portfolio side: recommend a redirect

Three options, for the owner (owner decision 1):

- **A. Keep the mount.** The portfolio chart's entry gets `service: velista-client` and
  `namespace: velista`, and the velista chart keeps its ReferenceGrant, in the same PR.
  The two pipelines run in parallel on the push to `main`, so for minutes the route may
  point at a namespace that does not exist yet (portfolio first) or at the old one (velista
  first). The script's step 7 patches the live route, and step 9 waits for the portfolio
  release's manifest to agree, so the window is at most the gap between the two pipelines
  and the cleanup can never strand the route.
- **B. Replace the mount with a redirect.** The portfolio chart renders, in place of
  `externalRoutes`, one HTTPRoute on the portfolio host that answers `/velista/...` with a
  301 to the velista host (`RequestRedirect` with `hostname` and `ReplacePrefixMatch: /`).
  No backend in another namespace, no ReferenceGrant, no `--check` coupling. It ships in
  its own portfolio PR before this plan, and the cutover then has no portfolio step. Old
  links keep working. k8s `0015` D6 foresaw this change for when velista leaves the
  portfolio's server.
- **C. Drop the mount.** `/velista` becomes the portfolio's not found page.

**Recommendation: B.** The share links already use the velista host, velista `0165` made
the mount optional, the service worker registers only on velista's own origin, and docs
`0005` puts the two units in two repositories, where a route from one repository's chart
into the other's namespace is a coupling nobody would design. B also removes a step from
the most delicate script of the series. velista `0178` turns velista's nginx handling of
the mount into the variable `VELISTA_MOUNT_PATH` (`velistaClient.mountPath`), empty by
default: under B or C the owner's values leave it empty, under A they set `/velista`.

### D8. The rehearsal

On Docker Desktop, as k8s `0016` did. The builder adds `k8s/helm/velista/values.local.yaml`
(hosts under `velista.localhost`, ClusterIssuer `selfsigned` with `create: false`,
`redirectHttp: false`, `IfNotPresent`, backups off, `referenceGrants: []`, harvester and
transcriber off unless the machine has room). The old chart installs from a `git worktree`
at the base commit into `luna-shopper`, against Secrets from
`provision-release.sh --unit velista --env staging` run on the `docker-desktop` context from
that worktree. A short seed (one account through the gateway, a list, a catalog row) gives
the move something to keep. Then the new images are built locally under the new names and
`rename-release.sh --env local --tag dev` runs. `--env local` refuses any context but
`docker-desktop` and skips the dump, as `split-release.sh` does. The rehearsal is repeated
once from a fresh old install, to measure the outage twice.

### D9. Slots are disposable, and the kept ones are renamed in place

`server-slot.sh` derives `AUTH_DB_URL` and its siblings (`DERIVED_KEYS`), so every slot that
runs after the merge writes `velista_<x>` URLs; `compose.yml` creates `velista_<x>` on an
empty volume and checks health with `pg_isready -U velista_<x>`. A slot is disposable:
`--down` and `--up` give a fresh one. But the developer's slot 0 and slots kept with
`--keep-data` hold data worth keeping, so `server-slot.sh --up` and `stack.sh up` look at each
running database first: when they find `luna_<x>`, they run the D2 SQL and the D6 adoption
through `docker compose exec`, from one shared file,
`k8s/bootstrap/rename-release/rename-database.sh`, that the cluster script also uses (it
takes the exec prefix as an argument). A slot behind the old chain head is refused with
the two ways forward: migrate it at the last commit before `0240`, or `--down` and `--up`.
The test profile databases (`luna_<x>_test`) are recreated by every suite run and simply
take the new names. This is the answer to backend `0240`'s owner decision on locked slots:
between the merge of `0240` and the merge of this plan the guard refuses a kept slot, and
the first `server-slot.sh --up` after this plan adopts it in place, so no separate
`stack.sh adopt-baseline` verb is needed.

### D10. Production waits for the owner, staging does not

The action input is `allow_rename`, fed from `vars.ALLOW_RENAME` of `velista-production`,
which the owner sets inside a quiet hour and deletes after. Set it only on the environment:
`vars.ALLOW_RENAME` would resolve a repository variable too. A production deploy to a
cluster whose status is `pending` and with the variable unset stops before any change, with
one summary line naming the two ways forward, as for `ALLOW_CUTOVER`. `deploy-release.sh`
refuses `pending` with the same text. `redeploy.yml` never renames, and its floor for
velista moves to the oldest release whose tree holds `k8s/bootstrap/rename-release.sh`,
because an older version's images and migrations do not run under the new names. Below
that floor the way back is a restore, not a redeploy. The homelab release is renamed by
hand with `--env homelab` if it is ever started again.

### D11. The JetStream streams, the consumer and the queue groups keep their names

docs `0003` D4 found three wire names that carry the old name and left the decision here:
the JetStream streams `LUNA_EVENTS` and `LUNA_ACCOUNT_DELETIONS`
(`libs/luna-shopper/contracts/src/lib/events/identity.events.ts`), the durable consumer
`luna-realtime` (`apps/luna-shopper-backend/realtime/src/app/realtime/constants.ts`), and
the NATS queue groups `luna-shopper-backend-<service>` in each service's `main.ts`. This
plan keeps all of them, and so does the cutover: the NATS volume moves with the others in
step 5, so the streams and the consumer's position survive the move.

- A stream is its name. A renamed stream is a new, empty stream, and an account deletion
  published to `LUNA_ACCOUNT_DELETIONS` and not yet consumed by core and catalog would never
  reach them. A renamed durable consumer starts over from its delivery policy.
- A queue group is how NATS spreads one request over the pods of one service. During a
  rolling update the old pod listens in the old group and the new pod in the new one, so
  each receives every request and every write runs twice.
- The names are invisible to users, operators and client authors (no socket event, NATS
  subject or document carries them).

A later plan may rename them with a drain: stop the publishers, wait until each consumer
has no pending message, create the new streams and consumer, and roll every service at
once with the new queue group. That is its own planned interruption and is not worth one
now. Rejected: renaming them inside this cutover, which would add a drain to the most
delicate script of the series for names nobody reads.

## Owner decisions

1. **D7, the portfolio mount.** Recommendation: B, a redirect shipped in a portfolio PR
   before this plan merges. A keeps the mount at the cost of the patch step and the
   ordered cleanup; C loses old links.
2. **The production hour.** The backend is out for two to four minutes. Recommendation: a
   weekday early morning, Europe/Madrid, with no harvest schedule due within the hour
   (production runs schedules, backend 0206).
3. **Release task `0005`.** Its window closes on 2026-11-12. If the cutover is meant to run
   earlier, the task must be `done` or `expired` on both clusters first, because the
   script refuses an open window. Recommendation: let the window close.
4. **Who runs the production cutover.** The first velista release after the merge with
   `ALLOW_RENAME=true` (recommended, it is the path staging proved), or the owner by hand
   with `--plan` first.
5. **`k8s/catalog-import/restore-first-catalog.sh`** (k8s `0012`). It compares the
   `migrations` rows of a dump with the live database and with `first-catalog.manifest`.
   After the adoption of D6 every database holds one baseline row, so the script refuses
   every dump taken before the cutover (backend `0240`, "The adoption contract", hands
   this decision to this plan). Its only release task, `0003`, closed its window on
   2026-10-14. **Decided by the owner on 2026-11-03:** retire it in this plan (delete
   `restore-first-catalog.sh`, `first-catalog.manifest` and `expected-losses.txt`, keep
   `k8s/catalog-import/README.md` with one line that names k8s `0012` and this plan), so
   docs `0005` does not copy a tool that can no longer succeed. Rejected: keeping it with a
   first comment that says it refuses every dump taken before the rename.

## Owner steps outside the code

Before the merge: decide D7 and, for B, merge the portfolio redirect PR and let it reach
both clusters.

After the merge, staging: nothing. Read the summary of the first `staging-velista` run,
then sign in on `staging.velista.app` with an existing account.

Production, inside the chosen hour:

```sh
gh variable set ALLOW_RENAME --env velista-production --body true
# publish the release velista-vX.Y.Z, or re-run its deploy job
gh variable delete ALLOW_RENAME --env velista-production
```

or, by hand on the box as the admin user, from a clone at the release commit:

```sh
bash ~/nx-portfolio/k8s/bootstrap/rename-release.sh --env production --unit velista --tag X.Y.Z --plan
bash ~/nx-portfolio/k8s/bootstrap/host-lock.sh \
  bash ~/nx-portfolio/k8s/bootstrap/rename-release.sh --env production --unit velista --tag X.Y.Z
```

After it: sign in with an existing account, open a list, check the admin.

The next day: confirm a nightly dump landed under `velista_<x>/` for each database
(`aws s3 ls s3://<bucket>/velista_auth/` from a throwaway pod with the backup Secret). Old
dumps under `luna_<x>/` expire by the lifecycle rule within 14 days; nothing to delete by
hand. After a later deploy has run step 9 on both clusters, confirm `kubectl get ns` shows
no `luna-shopper` and `kubectl get priorityclass` shows no `luna-stateful`.

## CLAUDE.md

Replace `luna-shopper` with `velista` wherever it names the namespace, and the old Secret
names with the new ones. Add, under the cutover bullet of "Docker & CI/CD":

> - **The rename of the persisted layer happens through `k8s/bootstrap/rename-release.sh`**
>   (k8s plan 0019). It moves the velista unit from namespace `luna-shopper` to `velista`,
>   renames the databases and roles to `velista_*`, and adopts backend plan 0240's
>   baseline in each `migrations` table. It is idempotent, runs in the preflight of the
>   velista unit, and on production only when the variable `ALLOW_RENAME` of
>   `velista-production` is `true`. On a cluster with no namespace `luna-shopper` it does
>   nothing.
