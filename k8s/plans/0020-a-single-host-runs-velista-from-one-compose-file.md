# 0020: A single host runs Velista from one Compose file

> Velista is software anyone can deploy (decision 3 of the series), and the owner chose two
> documented paths (decision 4): Kubernetes for volume and scale, Docker Compose for one
> host. This plan writes the Compose path. It grows from the overlay the staging gate
> already boots, `k8s/e2e/luna-shopper-backend/compose.apps.yml`, into a deploy file with
> the databases, the broker, the cache, every service, a one shot migration per database,
> Caddy in front with automatic certificates, a bootstrap script that writes the secrets,
> and a backup profile. The gate then runs that same file through a thin overlay, so there
> is one definition of a running Velista outside Kubernetes and the gate proves it on every
> staging deploy. It also writes `docs/deploy/README.md`, the page that tells a deployer
> which path to take, and `docs/deploy/compose.md`.
>
> Compose is the simpler path and the less scalable one: one replica per service, no rolling
> deploy, no per service scaling, one machine as the failure domain. The documentation says
> so in its first table.
>
> Names. docs `0003` renames the projects to `velista-server-<service>`, `velista-client`
> and `velista-admin`, the directories to `apps/velista-server`, `apps/velista-client` and
> `apps/velista-admin`, the alias to `@velista/*`, and the images after the projects. This
> plan uses those names for what it creates and today's paths when it points at code. The
> plan directories of the apps move with docs `0003` (`apps/luna-shopper-backend/plans` to
> `apps/velista-server/plans`, `apps/velista/plans` to `apps/velista-client/plans`); this
> file lives in `k8s/plans`, which does not move. The gate directories that this plan
> edits are named as docs `0003` leaves them: `k8s/e2e/velista-server` (today
> `k8s/e2e/luna-shopper-backend`) and `k8s/e2e/velista-stack` (today
> `k8s/e2e/velista-luna`), with the e2e projects `velista-server-e2e` and
> `velista-stack-e2e` (today `luna-shopper-backend-e2e` and `velista-luna-e2e`) and the
> slot script `server-slot.sh` (today `luna-slot.sh`).
>
> Prerequisite reading: `k8s/e2e/luna-shopper-backend/{compose.yml,compose.apps.yml,stack.sh,gate.sh,gate.env,luna-slot.sh}`,
> `k8s/e2e/velista-luna/gate.sh`, `k8s/helm/velista/values.yaml` (the services, the
> Postgres resources and arguments, `slowPaths`, `websocketTimeout`, the `legal` block),
> `k8s/helm/velista/templates/luna-shopper-backend/{backup-cronjob.yaml.tpl,migration-job.yaml.tpl,_env.tpl}`,
> `k8s/bootstrap/provision-release.sh` (the generators and the derived URLs),
> `k8s/helm/deploy-release.sh` (why production has no `--atomic`), `docker/prod/compose.yml`,
> backend `0027` section 2.1, `0071` section 6, `0231`, `0241`, velista `0178`, k8s `0019`,
> `0021`.
>
> **Build order.** Second step of the series, after docs `0003`, in parallel with docs
> `0004`, backend `0240` to `0243`, velista `0178` and k8s `0021`. It reads two of them:
> backend `0241` generates the environment blocks and `.env.example` this plan consumes,
> and velista `0178` makes the client image deployable on any domain. Build `0241` first
> when possible. When this plan starts before `0241` lands, build everything else and
> write the environment file by hand from `compose.apps.yml` and `_env.tpl`, then let
> `0241` switch it to generated output (Target state 3). Without `0178` the `client`
> profile works only with images built for the deployer's own URLs, and the documentation
> says so. The admin profile likewise waits on backend `0242`, which gives the admin image
> the same runtime mechanism after velista `0178`. It uses the database names of k8s `0019`
> (`velista_<x>`) from its first commit, because a fresh Compose install has no old data to
> keep. The series order, as every plan of the series states it: docs `0003` first, alone,
> after the pull request gate; then in parallel docs `0004`, backend `0240` to `0243`,
> velista `0178`, k8s `0020` and `0021` (backend `0242` after velista `0178` for the admin
> mechanism, k8s `0020` after backend `0241` for the generated files); k8s `0019` after docs
> `0003` and backend `0240`, in the same rollup to `main` as `0240`; docs `0005` last, with
> docs `0006` read from the start.

## Brief for the agent

### Objective

Make `docker compose up -d` in one directory run a complete Velista on one host, behind
Caddy, from published images at a release tag, with migrations run by the images
themselves, secrets generated once by a script, and backups on demand. Make the staging
gate boot the same file. Document both deploy paths with a decision table and the Compose
path in full.

Use `antislop` with `antislop-code` for every comment you write, and `simple-english` for
`docs/deploy/*.md`.

### Context

Every statement below was read in the checkout on 2026-11-03.

- **The overlay that exists.** `compose.apps.yml` runs six service images (no harvester)
  on top of the development infrastructure of `compose.yml` (four Postgres, NATS, Redis,
  Mailpit, observability and test profiles, slot ports). It states each environment by
  hand, mounts throwaway keys from `apps/luna-shopper-backend/secrets` as `*_FILE`
  variables, publishes every service port for the Playwright suite, and sets e2e values
  (`THROTTLE_MULTIPLIER`, fictional Google credentials, Mailpit SMTP, `IMPERSONATION_ENABLED`).
  Its header says migrations are not baked into the images; that is stale since backend
  `0027` section 2.1: each stateful service image holds `migrate.js`, and the chart runs it
  (`migration-job.yaml.tpl`). The auth image also holds `admin-cli.js` (backend `0071`
  section 6, `apps/luna-shopper-backend/auth/webpack.config.js:42-51`).
- **The gate.** `gate.sh` runs `luna-slot.sh 0` for the keys, pulls, and calls
  `stack.sh e2e-images`, which runs `up_or_clean` (infrastructure plus migrations from the
  checkout), then `compose -f compose.yml -f compose.apps.yml up -d --wait`, then the
  suite. `stack.sh e2e-up` serves `velista-luna-e2e` the same stack.
- **Images.** Pushed to `ghcr.io/ichirokuxvi` (`DOCKER_REGISTRY` in `stage-unit.yml:37`,
  `release-unit.yml`), tag `staging` from staging runs and `<version>` plus `latest` from
  releases. The homelab values need a pull Secret because the packages are not public
  (`k8s/helm/velista/values.homelab.yaml`). The client and admin bundles bake their URLs
  at build time (`apps/velista/webpack.prod.config.ts`, `apps/luna-shopper-admin/webpack.prod.config.ts:15,46`).
- **Limits the proxy must allow.** `HARVESTER_FILE_IMPORT_MAX_BYTES` 10485760,
  `ASSISTANT_AUDIO_MAX_BYTES` and `VOICE_COMMENT_MAX_BYTES` 2097152 (`compose.apps.yml`,
  the chart's defaults). Timeouts: the chart raises Envoy's 15 second default to 120 s on
  `/v1/assistant` and `/v1/admin/harvest/entries/decisions` (`values.yaml`
  `services[].slowPaths`, `httproute.yaml.tpl`) and holds WebSockets for 3600 s
  (`gateway.websocketTimeout`, `implementation-envoy.yaml.tpl`).
- **Resources in the chart.** Node services request 50m and 128Mi, limit 512Mi, two
  replicas. Postgres 256Mi with `shared_buffers=64MB`, `work_mem=4MB`; catalog 1Gi with
  `256MB`, `8MB`, `jit=off`. NATS and Redis 128Mi each (Redis `maxmemory 96mb`). The
  transcriber 2 CPU and 2560Mi. `CLAUDE.md` measures a Node service at about 230 MB.
- **Secrets.** `provision-release.sh` generates URL safe database passwords
  (`generate_db_password`), the harvester actor uuid (`generate_actor_id`), two RSA
  keypairs, and derives each `*_DB_URL` from the same variable as the instance password
  (`:872-875`). The operator's eight `LEGAL_*` values (`OPERATOR_KEYS`, `:139`) are empty
  until set, and the gateway then answers `published: false` (backend `0231`); it refuses
  to boot with `TERMS_ACCEPTANCE_REQUIRED=true` and an empty controller or contact
  (`gateway/src/app/config/legal-config.ts:90`).
- **Backups.** The CronJob's dump script is inline in `backup-cronjob.yaml.tpl`:
  `pg_dump --format=custom`, `pg_restore --list` as the integrity check, upload with the
  aws CLI, and the line `uploaded s3://...` that release tasks read.
- **The previous Compose stack.** `docker/prod/compose.yml` serves the portfolio with
  nginx-proxy and a certbot container. It is the portfolio's, stays in `nx-portfolio`, and
  is not touched. Caddy is the Velista path's proxy (decision 4).
- **Market.** The harvest adapters are Spanish chains (`libs/luna-shopper/{mercadona,carrefour,dia,lidl,deza,eljamon}`).
  Postal codes come from GeoNames per country, `GEONAMES_COUNTRY` default `ES`
  (`libs/luna-shopper/postal-codes/tools/refresh-dataset.ts:13,33`). The nearby radius is
  per country: `PROFILE_NEARBY_RADIUS_BY_COUNTRY` and `PROFILE_NEARBY_RADIUS_METRES`
  (`apps/luna-shopper-backend/core/src/app/config/app-config.ts:220-224`).

### Target state

1. `deploy/compose/` exists at the workspace root with `compose.yml`,
   `compose.environment.yml`, `Caddyfile`, `caddy/`, `.env.example`, `bootstrap.sh` and a
   short `README.md` that points at `docs/deploy/compose.md`. Docs `0005` moves it to the
   root of the Velista repository unchanged.
2. On a clean Linux host with Docker: `git clone` at a release tag, `bash
   deploy/compose/bootstrap.sh`, edit `.env` (domain, ACME email, `LEGAL_*`), `docker
   compose up -d` brings every default service to healthy, the migration services exit 0,
   and `https://api.<domain>/health/ready` answers 200 through Caddy.
3. `compose.environment.yml` and `.env.example` are generated by backend `0241`'s target
   from `env-manifest.json`, and a spec fails when either is stale.
4. The gate boots `deploy/compose/compose.yml` with `compose.environment.yml` and a gate
   overlay; `compose.apps.yml` is deleted; `velista-server-e2e` and
   `velista-stack-e2e` pass against it; the gate then checks the API and the realtime
   upgrade through Caddy with `tls internal`.
5. `docker compose run --rm auth node admin-cli.js create <username>` creates the first
   operator.
6. `docker compose --profile backup run --rm backup` writes one verified dump per database
   to `./backups` or to the S3 bucket the `.env` names, with the same script the chart's
   CronJob runs.
7. `docs/deploy/README.md` opens with the decision table; `docs/deploy/compose.md` covers
   configuration (`LEGAL_*` first), what Compose does not give, the market note, upgrade,
   rollback, backups, restore, resources.
8. `pr.yml` validates the Compose files and the Caddyfile when `deploy/compose/**`
   changes.

### Scope

In: `deploy/compose/**` (new); `k8s/e2e/velista-server/compose.gate.yml` (new),
`stack.sh`, `gate.sh`, `gate.env`, deletion of `compose.apps.yml`;
`k8s/e2e/velista-stack/gate.sh` (the file set it starts); `k8s/helm/velista/files/pg-dump.sh`
(new) and `backup-cronjob.yaml.tpl` (reads it); `k8s/bootstrap/lib/secrets.sh` (new,
the generators moved out of `provision-release.sh`) and `provision-release.sh` (sources
it); `docs/deploy/README.md`, `docs/deploy/compose.md` (new); `.github/workflows/pr.yml`
(the validation job); `CLAUDE.md` (one bullet).

Out: the development stack `compose.yml` and the slot scripts, which stay the tooling for
`nx serve` (they keep their own infrastructure on slot ports); `docker/prod`; the
manifest generator itself (backend `0241`); runtime configuration of the client image
(velista `0178`) and of the admin image (backend `0242` target state 4, see owner decision
5); a high
availability Compose (several hosts, Swarm); observability; the chart (k8s `0021`).

### Constraints

- One definition. The gate and the deploy path read the same `compose.yml` and
  `compose.environment.yml`; everything the gate needs differently sits in its overlay.
- Images only. No service is built from source by the deploy file. The tag is required
  and is a release version; `staging` and `latest` are never defaults.
- Migrations run from the image (`node migrate.js`) before the service that owns the
  database starts, and a failed migration stops that service from starting.
- Every value that has to agree with another is derived from one variable: each
  `*_DB_URL` from its instance's password variable, `SERVICE_ACTOR_IDS` from
  `HARVESTER_ACTOR_ID`.
- The defaults are safe for a stranger: harvester present with `HARVEST_ENABLED=false`
  and `HARVEST_SCHEDULER_ENABLED=false`, `TERMS_ACCEPTANCE_REQUIRED=false`,
  `IMPERSONATION_ENABLED=false`, assistant and Google and SMTP unconfigured (each answers
  501), `ADMIN_DEV_AUTOLOGIN=false`.
- Postgres runs with the chart's memory arguments and the containers carry the chart's
  limits, so one host behaves like one node of the cluster.
- No file under `deploy/compose/` names the owner's domains, registry account or e-mail as
  a value. The registry prefix default is the one place an organisation appears, and it is
  the owner decision of docs `0005`.

### Action boundaries

- Stop and ask before you make any registry package public or change a GitHub setting.
- Stop and ask before you add a dependency to the hosts or to CI beyond Docker and the
  official `caddy` and `postgres` images.
- Stop and ask before you change what the chart's backup CronJob uploads (key layout, the
  `uploaded` line): release tasks read it.
- Do not run the stack against a real domain. Use `tls internal` and a `.test` domain.

### Progress evidence

- `docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.environment.yml config -q` passes;
  `docker run --rm -v "$PWD/deploy/compose:/etc/caddy" caddy:<pinned> caddy validate --config /etc/caddy/Caddyfile` passes.
- A local boot with `VELISTA_TLS=internal`, `VELISTA_DOMAIN=velista.test`, `/etc/hosts`
  entries for the four hosts: `docker compose ps` shows every default service healthy and
  the four `migrate-*` services `exited (0)`; `curl -k https://api.velista.test/health/ready`
  answers 200; a WebSocket upgrade to `wss://rt.velista.test/socket.io/?EIO=4&transport=websocket`
  answers 101; an upload of 10 MB to the harvest import route is not refused by Caddy (the
  gateway's own answer comes back).
- `docker compose run --rm auth node admin-cli.js create e2e-operator` succeeds and the
  operator signs in to the gateway's admin login.
- `docker compose --profile backup run --rm backup` prints `dump ok` four times and leaves
  four files that `pg_restore --list` reads.
- A second `docker compose up -d` after `VELISTA_IMAGE_TAG` changes recreates the services,
  runs the migration services again, and they apply only the new migrations.
- `bash k8s/e2e/velista-server/gate.sh` passes locally with `E2E_IMAGE_TAG` set to a
  pushed tag, and its log shows the Caddy check.
- The generator spec of backend `0241` fails after a hand edit of `compose.environment.yml`.

## Decisions taken in this plan

### D1. Where it lives and what it holds

`deploy/compose/` at the workspace root today, at the root of the Velista repository after
docs `0005`. A deployer clones the repository at a release tag and works in that
directory, so relative paths to shared scripts (`../../k8s/bootstrap/lib/secrets.sh`,
`../../k8s/helm/velista/files/pg-dump.sh`) resolve.

- `compose.yml`, hand written: the services, their images, `depends_on`, health checks,
  volumes, limits, profiles. No environment values beyond topology.
- `compose.environment.yml`, generated by backend `0241` from `env-manifest.json`: one
  `environment` map per service. A key with a default becomes `KEY: ${KEY:-<default>}`; a
  required key becomes `KEY: ${KEY:?<description>}`; a topology key (a URL to another
  container) is fixed by a small map in the generator's input (`NATS_URL:
  nats://nats:4222`, `AUTH_DB_URL: postgres://velista_auth:${AUTH_DB_PASSWORD}@auth-db:5432/velista_auth`).
- `.env.example`, generated from the same manifest: the operator facing keys, grouped
  (required, the eight `LEGAL_*`, optional integrations, tuning with the defaults
  commented). `bootstrap.sh` copies it to `.env` and fills the generated values. `.env`
  sets `COMPOSE_FILE=compose.yml:compose.environment.yml`, so the plain `docker compose`
  commands read both files.
- `Caddyfile` and `caddy/` (D4), `bootstrap.sh` (D5), `README.md`.

A single generated `compose.yml` was rejected: a person reads and edits the structure,
and a generated file that a person edits is overwritten. Environment in `env_file:`
files per service was rejected: values differ per deployment, so those files would be
the deployer's, and the manifest could not keep them current.

### D2. The services

| Service | Image | Profile | Notes |
| --- | --- | --- | --- |
| `auth-db`, `core-db`, `catalog-db`, `harvester-db` | `postgres:16-alpine` | default | database and role `velista_<x>`, password from `<X>_DB_PASSWORD`, the chart's `-c` arguments and limits, a named volume each |
| `nats` | `nats:2.10-alpine` | default | `-js -sd /data`, the `max_payload` of the chart, a named volume |
| `redis` | `redis:7-alpine` | default | `maxmemory 96mb`, `volatile-lru`, no volume |
| `migrate-auth`, `migrate-core`, `migrate-catalog`, `migrate-harvester` | the service image | default | `command: node migrate.js`, its own `*_DB_URL` only, `depends_on` its database healthy, `restart: "no"` |
| `gateway`, `realtime`, `auth`, `core`, `catalog`, `harvester`, `assistant` | `${VELISTA_IMAGE_PREFIX}/velista-server-<svc>:${VELISTA_IMAGE_TAG}` | default | `depends_on` NATS and Redis healthy, and the owner of a database on its `migrate-<x>` with `condition: service_completed_successfully`; health check on `/health/ready` as `compose.apps.yml` does; `restart: unless-stopped`; `mem_limit: 512m` |
| `transcriber` | `velista-server-transcriber` | `voice` | 2 CPUs, 2560m, a models volume; the assistant's `TRANSCRIBER_URL` is `http://transcriber:3007` when the profile is on and empty otherwise (a variable the deployer sets with the profile) |
| `client` | `velista-client` | `client` | serves the app on the root host |
| `admin` | `velista-admin` | `admin` | serves the back office on `admin.` |
| `caddy` | `caddy:<pinned>` | default | ports 80 and 443 (and 443/udp), volumes for its data and config |
| `backup` | `postgres:16-alpine` | `backup` | one shot, D7 |

`VELISTA_IMAGE_TAG` is required (`${VELISTA_IMAGE_TAG:?...}`); `bootstrap.sh` sets it to
the version of the checked out tag (`git describe --tags --match 'velista-v*'`, prefix
removed). `VELISTA_IMAGE_PREFIX` defaults to the registry the release pipeline pushes to
(`ghcr.io/ichirokuxvi/nx-portfolio` until docs `0005` decides the new one).

The harvester is in the default set with both switches false, because catalog's
`SERVICE_ACTOR_IDS` and the admin's harvest pages expect it, and an idle harvester costs
one Node process. Whether a chain can be fetched is still its `supermarket_sources` row,
off by default (backend `0083`).

**Mailpit is not in the deploy file.** A deployment that sends mail needs a real SMTP
relay, and one that does not leaves `SMTP_HOST` empty, so registration answers 501 as the
chart does. Mailpit belongs to the gate overlay, which needs it. A `dev` profile was
rejected: a deploy file that can start a mail catcher invites a production that silently
catches its own confirmation mails.

No observability profile. The services run with `OTEL_ENABLED=false`, and a deployer who
wants traces points `OTEL_EXPORTER_OTLP_ENDPOINT` at their own collector.

### D3. The gate consumes the same file through an overlay

`k8s/e2e/velista-server/compose.gate.yml` replaces `compose.apps.yml`. The gate
runs `docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.environment.yml
-f k8s/e2e/velista-server/compose.gate.yml`. The overlay:

- publishes the service ports and the four database ports on the slot variables the
  suite already reads (`VELISTA_GATEWAY_PORT` and the rest, the names docs `0003` gives
  today's `LUNA_GATEWAY_PORT` and its siblings);
- adds `profiles: [proxy]` to `caddy`, so a plain `up` does not start it;
- adds Mailpit and points auth at it;
- sets the e2e values `compose.apps.yml` sets today (throttle multiplier, fictional Google
  credentials, `IMPERSONATION_ENABLED=true`, `ADMIN_DEV_AUTOLOGIN=false`, the e2e CORS
  list, the e2e base URLs, `TERMS_ACCEPTANCE_REQUIRED` and the two `LEGAL_*` values from
  the environment as the velista gate passes them);
- mounts the throwaway keys of `apps/luna-shopper-backend/secrets` as the Compose
  secrets the deploy file declares, and fixed database passwords.

`stack.sh e2e-up` and `e2e-images` start that file set with `up -d --wait`, which runs the
migration services, so the gate no longer migrates from the checkout and proves the
image's `migrate.js` instead. The development verbs (`up`, `test-integration`, `e2e`) keep
`compose.yml` of the slot tooling and the checkout migrations, because a developer works
on unbuilt code.

After the suite passes, the gate starts `caddy` with `VELISTA_TLS=internal` and
`VELISTA_DOMAIN=velista.test`, then checks with `curl --resolve ... -k` that
`https://api.velista.test/health/ready` answers 200 and that `rt.` answers a WebSocket
upgrade with 101. That proves the Caddyfile on every staging deploy for a few seconds.
Running the whole suite through Caddy was rejected: it doubles the gate's time and the
suite's address handling, for routing that two requests already prove.

### D4. Caddy

```caddyfile
{
	import tls-{$VELISTA_TLS:acme}.caddy
}
import sites-enabled/*.caddy
```

`caddy/tls-acme.caddy` sets `email {$ACME_EMAIL}`; `caddy/tls-internal.caddy` sets
`local_certs` for a LAN install. The site files, one per host, all under `{$VELISTA_DOMAIN}`
with the chart's prefixes so the CORS list, `APP_BASE_URL` and the mail links read the same
as in a cluster:

- `client.caddy`: `{$VELISTA_DOMAIN}`, `reverse_proxy client:80`.
- `admin.caddy`: `admin.{$VELISTA_DOMAIN}`, `reverse_proxy admin:80`.
- `api.caddy`: `api.{$VELISTA_DOMAIN}`, `request_body { max_size 11MB }` (the 10 MiB
  harvest import plus multipart overhead; the gateway refuses above its own caps); one
  `reverse_proxy` for the two slow paths with `transport http { response_header_timeout
  120s }`, and one for the rest with `15s`, the same numbers the cluster serves.
- `rt.caddy`: `rt.{$VELISTA_DOMAIN}`, `reverse_proxy realtime:3001 { stream_timeout 1h }`,
  the chart's `websocketTimeout`. Caddy passes the WebSocket upgrade with no extra
  directive.

`bootstrap.sh` fills `caddy/sites-enabled/` from `caddy/sites/` by the profiles in
`COMPOSE_PROFILES`: `api` and `rt` always, `client` and `admin` when their profile is on.
A backend only install then requests no certificate for a host it does not serve. `caddy
validate` in `pr.yml` and the gate's check prove the result.

### D5. Secrets on one host

`bash deploy/compose/bootstrap.sh` runs once and is safe to run again (it keeps every value
that exists, as `provision-release.sh` does):

- copies `.env.example` to `.env` when absent;
- fills `AUTH_DB_PASSWORD`, `CORE_DB_PASSWORD`, `CATALOG_DB_PASSWORD`,
  `HARVESTER_DB_PASSWORD` and `HARVESTER_ACTOR_ID` when empty, with the generators of
  `k8s/bootstrap/lib/secrets.sh`, which this plan moves out of `provision-release.sh` and
  which both scripts source;
- writes the two keypairs to `deploy/compose/secrets/{jwt,admin-jwt}.{key,pub}` (mode 600,
  ignored by git), which `compose.yml` declares as Compose `secrets` and passes as the
  `*_FILE` variables the services already read;
- sets `VELISTA_IMAGE_TAG` and `COMPOSE_FILE`, fills `caddy/sites-enabled/`;
- prints the eight `LEGAL_*` keys still empty, and the one line that creates the first
  operator.

The `LEGAL_*` keys go first in `.env.example` and in the documentation: `LEGAL_APP_NAME`,
`LEGAL_CONTROLLER_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_HOSTING_PROVIDER`,
`LEGAL_EMAIL_PROVIDER`, `LEGAL_BACKUP_PROVIDER`, `LEGAL_TERMS_REVISION`,
`LEGAL_PRIVACY_REVISION`. Until they are set, the privacy policy and the Terms say
"unpublished" and `TERMS_ACCEPTANCE_REQUIRED` must stay false.

The first operator: `docker compose run --rm auth node admin-cli.js create <username>`.

Plain environment values for the keys were rejected: a PEM in `.env` needs multi line
quoting that differs between Compose versions, and the services already read files.

### D6. Upgrade and rollback

Upgrade: `git fetch --tags && git checkout velista-vX.Y.Z` (the Compose and Caddy files may
change between releases), `bash bootstrap.sh` (it sets the new tag and adds new keys to
`.env` with their defaults), `docker compose pull && docker compose up -d`. The migration
services run before the services that own a database, which is the order the chart's
`pre-upgrade` hook gives. Unlike the cluster, the old container stops before the new one is
healthy, so an upgrade is seconds of downtime per service.

Rollback: check out the previous tag, set `VELISTA_IMAGE_TAG` to it, `docker compose up
-d`. There is no down migration. Migrations are expand and contract, so the previous code
runs against the newer schema; that is the same argument `deploy-release.sh` records for
`helm rollback`, which rolls pods back and leaves the schema where the newer release put
it. A release whose notes say it contracted a column cannot be rolled back past; restore
the dump taken before the upgrade instead (the documentation says to take one, D7).

### D7. Backups

The dump script moves out of the CronJob into `k8s/helm/velista/files/pg-dump.sh`; the
template reads it with `.Files.Get`, so the rendered CronJob is byte for byte what it is
today. The script gains one branch: when `S3_BUCKET` is empty it writes to `BACKUP_DIR`
and deletes files there older than `BACKUP_RETENTION_DAYS` (default 14, the cluster
bucket's rule). The `backup` service mounts the script and `./backups`, takes the four
`*_DB_URL` values, and loops over them. A deployer schedules it with the host's cron or a
systemd timer; the documentation gives the line. A long running container with its own
cron daemon was rejected: one more process to watch, and a missed run hides inside it.

Restore: `restore-database.sh` already runs against a local container
(`RESTORE_POD_EXEC=docker exec -i <container>` and the five `RESTORE_*` values); the
documentation shows that use, which restores into a scratch database beside the real one.

### D8. Verification

The gate proves the services, the images, the migrations and the environment on every
staging deploy (D3), and the Caddyfile with two requests. `pr.yml` gains a job, filtered on
`deploy/compose/**`, `k8s/helm/velista/files/**` and the gate overlay, that runs `docker
compose config -q` over both file sets and `caddy validate`. A full boot in `pr.yml` was
rejected: the gate already boots it on the images about to deploy, and a PR has no images
of its own.

### D9. Resources for the README

One host running the default set: seven Node services at about 230 MB each (1.6 GB), four
Postgres within their limits (three at 256 MB, catalog at 1 GB), NATS and Redis at 128 MB
each, Caddy and the two static servers under 100 MB together. About 3.7 GB at the limits:
**4 GB of RAM is the minimum, 8 GB is comfortable**, two vCPUs. The `voice` profile adds
2 CPUs and 2.5 GB, and a first start downloads about 2 GB of models. Disk: the databases
are small (megabytes to a few hundred for a large catalog), plus the images (about 2 GB).

### D10. The documentation

`docs/deploy/README.md` opens with:

| You have | Take | Why |
| --- | --- | --- |
| One machine, a small group of users, no on call | Compose (`compose.md`) | one directory, one command, automatic certificates, the least to operate |
| Several nodes, many users, deploys with no downtime, per service scaling | Kubernetes (`kubernetes.md`) | rolling deploys, two replicas per service, disruption budgets, the path the project's own production runs |

then a paragraph on what both share (the same images, the same environment from one
manifest, the same migrations from the image) and a link to each page. k8s `0021` writes
`kubernetes.md` and adds nothing to this table; whichever of the two plans lands first
creates `README.md` with both rows.

`docs/deploy/compose.md`, in this order: prerequisites (a Linux host, Docker with Compose
2.24 or later, four DNS records or a LAN with `tls internal`, the registry reachable);
install (the commands of D5); required configuration with the `LEGAL_*` keys first, then
domain, ACME email, tag; optional integrations (SMTP, Google, Anthropic, the transcriber);
the market note (the chains are Spanish; postal codes load from GeoNames for `ES` by
default and another country is a dataset refresh; the nearby radius is per country through
`PROFILE_NEARBY_RADIUS_BY_COUNTRY`); what Compose does not give (one replica, seconds of
downtime per upgrade, no disruption budget, the host is the single failure domain, no
release tasks and none of the project's own pipelines); upgrade and rollback (D6); backups
and restore (D7); resources (D9).

## Owner decisions

1. **The directory name.** Recommendation: `deploy/compose/`, which leaves room for
   `deploy/kubernetes/` should the chart ever move out of `k8s/`.
2. **The profiles.** Recommendation: `client`, `admin`, `voice`, `backup`; the backend is
   the default set. A deployer who runs a third party client turns `client` off.
3. **Mailpit.** Recommendation: not in the deploy file; only in the gate overlay.
4. **The backup target.** Recommendation: a local directory by default, S3 when the four
   `S3_*` values are set, the same Secret keys as the cluster.
5. **The admin image.** The admin bundle bakes its gateway URL like the client
   (`VELISTA_GATEWAY_URL` after docs `0003`, today `LUNA_GATEWAY_URL`). velista `0178`
   covers the client only, and backend `0242` target state 4 gives the admin the same
   runtime mechanism after `0178` merges. This plan decides nothing here: the `admin`
   service sets the admin's runtime variable the way `0242` names it, and until `0242`
   lands the `admin` profile needs a self built image, which the documentation says.
6. **The gate consumes the same file.** Recommendation: yes, as D3 designs. The
   alternative keeps `compose.apps.yml` and lets the two drift.
7. **Public images.** Compose needs pullable images. Recommendation: make the
   `velista-server-*`, `velista-client` and `velista-admin` packages public when docs
   `0005` publishes the repository; until then this path works only for the owner.

## Owner steps outside the code

- Make the image packages public on the registry (owner decision 7), at the moment docs
  `0005` names.
- Nothing else: the plan runs no host of the owner's.

## CLAUDE.md

Add to "Docker & CI/CD":

> - **One host runs Velista from `deploy/compose/`** (k8s plan 0020): published images at a
>   release tag, a one shot `migrate-<x>` service per database, Caddy in front. The staging
>   gate boots the same file through `k8s/e2e/velista-server/compose.gate.yml`, so a
>   change to the deploy file is tested on the next staging run. Its environment blocks and
>   `.env.example` are generated from the env manifest; never edit them by hand.
