# 0021: The chart deploys on any cluster

> The velista chart (`k8s/helm/velista`) was written for one operator: its defaults name the
> owner's Gateway class, storage class and PriorityClass, its images name the owner's
> registry path, and its install path is the owner's scripts (`provision-release.sh`,
> `deploy-release.sh`, the unit pipelines). Velista is now software anyone can deploy
> (decision 3 of the series), and Kubernetes is one of its two documented paths (decision
> 4). This plan turns each assumption about the owner's cluster into a value with a neutral
> default, documents every Secret the chart reads, publishes the chart as an OCI artifact
> on each velista release, and writes `docs/deploy/kubernetes.md`. The owner's two
> clusters keep deploying exactly what they deploy today, because their values files take
> over what the defaults used to say, and a render diff proves it.
>
> The chart stays Gateway API. An Ingress variant is out of scope: two routing models in
> one chart double every route template and its tests, and every maintained ingress
> controller now ships a Gateway API implementation.
>
> Names. docs `0003` renames the projects to `velista-server-<service>`, `velista-client`
> and `velista-admin`, the directories to `apps/velista-server`, `apps/velista-client` and
> `apps/velista-admin`, the alias to `@velista/*`, and the images after the projects. This
> plan uses those names for what it creates and today's paths when it points at code. The
> plan directories of the apps move with docs `0003` (`apps/luna-shopper-backend/plans` to
> `apps/velista-server/plans`, `apps/velista/plans` to `apps/velista-client/plans`); this
> file lives in `k8s/plans`, which does not move. docs `0003` also renames the chart's
> values key `lunaShopperBackend` to `velistaServer` and the harvester user agent token
> `LunaShopper/0.1` to `Velista/0.1`; this plan names both as they are after that rename.
>
> Prerequisite reading: k8s `0001`, `0006`, `0015` (D3, D4, D5, D7, D13), `0016` D1,
> `0017`, backlog `0003` D5; `k8s/helm/velista/values.yaml`, every template under
> `k8s/helm/velista/templates`, `k8s/helm/common/templates/{_gateway,_helpers,_app}.tpl`,
> `k8s/helm/portfolio/values.local.yaml` (an existing ClusterIssuer), `k8s/bootstrap/install.sh`,
> `k8s/bootstrap/provision-release.sh`, `k8s/helm/deploy-release.sh`,
> `k8s/helm/luna-shopper-backend-secrets.md`, `.github/workflows/release-unit.yml`,
> backend `0241` and `0242`, k8s `0019` and `0020`.
>
> **Build order.** Second step of the series, after docs `0003`, in parallel with docs
> `0004`, backend `0240` to `0243`, velista `0178` and k8s `0020`. k8s `0020` also edits the
> chart (it moves the backup script into `files/pg-dump.sh`); the second of the two to merge
> rebases on the first. k8s `0019` follows docs `0003` and backend `0240`, may merge before
> or after this plan, and renames the objects this plan leaves named as they are; nothing
> here depends on the new namespace. backend `0242` owns
> the application defaults that name the owner (the harvester user agent); this plan only
> empties the chart's copy of that default. The series order, as every plan of the series
> states it: docs `0003` first, alone, after the pull request gate; then in parallel docs
> `0004`, backend `0240` to `0243`, velista `0178`, k8s `0020` and `0021` (backend `0242`
> after velista `0178` for the admin mechanism, k8s `0020` after backend `0241` for the
> generated files); k8s `0019` after docs `0003` and backend `0240`, in the same rollup to
> `main` as `0240`; docs `0005` last, with docs `0006` read from the start.

## Brief for the agent

### Objective

Make `helm install velista oci://<registry>/charts/velista --version X.Y.Z -n velista -f
my-values.yaml` work on a cluster that has Gateway API, a Gateway implementation,
cert-manager and a storage class, with values a stranger can write from the documentation.
Keep the owner's staging and production renders unchanged. Publish the chart on every
velista release.

Use `antislop` with `antislop-code` for every comment you write, and `simple-english` for
`docs/deploy/kubernetes.md`.

### Context

Every statement below was read in the checkout on 2026-11-03.

- **Assumptions in the defaults.** `values.yaml`: `gateway.className: eg`;
  `gateway.tls.issuer` is a namespaced `Issuer` named `letsencrypt` the chart creates
  (`create: true`), with `acme.email` required; `postgres.storageClassName` and
  `nats.storageClassName: local-path`; `transcriber.storageClassName: local-path` and the
  template's fallback `default "local-path"` (`transcriber.yaml.tpl:40`);
  `priorityClass.enabled: true`, name `luna-stateful` (cluster scoped,
  `priorityclass.yaml.tpl`); every `image` under `ghcr.io/ichirokuxvi/nx-portfolio/`;
  `imageTag: latest`; `harvester.userAgent` names the owner's site and e-mail;
  `referenceGrants` names namespace `portfolio`; `velistaServer.enabled: false` (today
  `lunaShopperBackend.enabled`).
- **Already neutral.** No MetalLB object is rendered (only a comment in `values.yaml`
  names it; k8s `0015` D5 moved the pool to `install.sh`). `gateway.tls.issuer.kind:
  ClusterIssuer` with `create: false` already works: `k8s/helm/portfolio/values.local.yaml`
  uses `selfsigned` and `values.homelab.yaml` uses `letsencrypt-dns01`. `imagePullSecrets`
  exists (`charts.imagePullSecrets`). The Envoy specific `BackendTrafficPolicy` renders
  only when `className` is `eg` (`implementation-envoy.yaml.tpl:30`). `minClientVersion`,
  `termsAcceptanceRequired`, `harvester.enabled`, `harvestEnabled`, `schedulerEnabled`,
  `backups.enabled` and `transcriber.enabled` default to empty or false.
- **Secrets.** The chart creates none. It reads seven, which `provision-release.sh`
  writes (`:122-138`, `:877-940`): the app Secret (`AUTH_DB_URL`, `CORE_DB_URL`,
  `CATALOG_DB_URL`, `HARVESTER_DB_URL`, `HARVESTER_ACTOR_ID`, `AUTH_JWT_PRIVATE_KEY`,
  `AUTH_JWT_PUBLIC_KEY`, `ADMIN_JWT_PRIVATE_KEY`, `ADMIN_JWT_PUBLIC_KEY`,
  `GOOGLE_CLIENT_SECRET`, `SMTP_PASS`, `ANTHROPIC_API_KEY`), four instance Secrets
  (`POSTGRES_PASSWORD`), the operator Secret (the eight `LEGAL_*`, unless set as values,
  `_env.tpl:343-366`), and the backup Secret (`S3_ENDPOINT`, `S3_BUCKET`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) when backups are on.
- **Per environment URLs.** `config.corsOrigins`, `appBaseUrl`, `googleCallbackUrl`,
  `mailVerifyBaseUrl`, `mailResetBaseUrl` are set by each environment file and render
  empty or broken without one (`configmap.yaml.tpl:25,87,90,95`).
- **Install semantics.** Migrations run as a hook Job, `post-install` on a first install
  and `pre-upgrade` after (`migration-job.yaml.tpl`). `deploy-release.sh` deploys production
  with `--wait` and no `--atomic`, and records why: an automatic rollback would roll back
  pods that ran beside migrations, which do not roll back.
- **Release pipeline.** `release-unit.yml` builds and pushes the unit's images at
  `<version>` and `latest`, its build job has `packages: write` (`:160-162`), and the
  deploy job runs `deploy-unit`. Nothing packages or pushes a chart today. `velista/Chart.yaml`
  is `version: 0.1.0` with a `file://../common` dependency.
- **Tests.** `pr.yml` runs no Helm command. `provision-release.sh --check --render-only`
  renders the chart with an environment's values in the deploy preflight.

### Target state

1. `values.yaml` defaults name no owner object: `gateway.className` is empty and required
   when the Gateway renders; the Envoy policy renders on `gateway.envoyPolicies: true`;
   every `storageClassName` is empty and omitted from the claim when empty;
   `priorityClass.enabled` is false; `referenceGrants` is empty; `harvester.userAgent` is
   empty; images come from `imagePrefix` plus the project name and `imageTag` defaults to
   the chart's `appVersion`; the backend is on by default.
2. With `baseDomain` set, the five per environment URLs derive from it when empty.
3. `secrets.create: true` with `secrets.values` renders the Secrets from values, with a
   comment and a `NOTES.txt` line that say it is for a test cluster.
4. `k8s/helm/velista/values.example.yaml` installs on a generic cluster with only a
   domain, an ACME e-mail and the Secrets; `helm lint` and `helm template` with it pass
   with no Secret present.
5. `helm template` with `values.yaml` plus `values.staging.yaml`, and plus
   `values.production.yaml`, renders the same objects as before this plan (the render
   diff of section "Progress evidence" is empty, except the documented annotations).
6. `release-unit.yml` packages the velista chart at the release version and pushes it to
   the OCI path of owner decision 1, after the deploy succeeds; `helm show chart` on that
   reference prints `version` and `appVersion` equal to the release version.
7. `docs/deploy/kubernetes.md` exists and `docs/deploy/README.md` links it.
8. `pr.yml` runs `helm lint` and the renders of item 4 and 5 on changes under `k8s/helm/`.

### Scope

In: `k8s/helm/velista/{values.yaml,values.staging.yaml,values.production.yaml,values.homelab.yaml,values.example.yaml,Chart.yaml}`,
`k8s/helm/velista/templates/**` (the options, a `secrets.yaml.tpl`, `NOTES.txt`),
`k8s/helm/common/templates/_gateway.tpl` (the required class),
`k8s/units/unit-env.sh` and `k8s/units/velista/unit.env` (`CHART_OCI`),
`tools/deploy/units.mjs` (knows the field), `.github/workflows/release-unit.yml`,
`.github/workflows/pr.yml`, `k8s/helm/luna-shopper-backend-secrets.md` (the key table),
`docs/deploy/kubernetes.md` (new), `docs/deploy/README.md` (new if k8s `0020` has not
landed), `k8s/README.md`, `CLAUDE.md`.

Out: the object names and the namespace (k8s `0019`); the portfolio chart, which stays the
owner's site; the owner's scripts and pipelines, which keep working and stay in the
repository as one way to operate the chart; an Ingress variant; a Kustomize base; a
public Helm repository over HTTP (OCI only); application defaults in the services
(backend `0242`); the Compose path (k8s `0020`).

### Constraints

- The owner's renders do not change. Every default this plan neutralises is set again in
  the owner's values files, in the same PR.
- `helm template` equals `helm install` for a given set of values: no option depends on
  `lookup` or on the cluster's API versions.
- The chart generates no secret. `secrets.create` renders only values it was given.
- One release per namespace. Object names stay fixed (they are part of the DB URLs and of
  k8s `0019`'s cutover), and the documentation says so.
- The published chart version equals the velista release version, and its `appVersion`
  pins the images.

### Action boundaries

- Stop and ask before you create or change visibility of a registry package, or grant a
  workflow a new permission beyond `packages: write` on the job that pushes.
- Stop and ask before you add a CI dependency (`kubeconform`, `kind`, `ct`); `helm` is
  already on the runners.
- Do not deploy to the owner's clusters. The first velista release after the merge is the
  proof, through the existing pipeline.
- Stop and ask if the render diff of the owner's values shows any change you did not plan.

### Progress evidence

- The render diff: on the base commit and on the branch, for `staging`, `production` and
  `homelab`, `helm template velista k8s/helm/velista -n luna-shopper -f values.yaml -f values.<env>.yaml --set imageTag=1.0.0 > <env>.yaml`,
  then `diff` the two. The builder pastes the result into the PR; only the documented
  differences may appear.
- `helm lint k8s/helm/velista -f k8s/helm/velista/values.example.yaml` passes.
- `helm template velista k8s/helm/velista -n velista -f values.yaml -f values.example.yaml` renders, and `grep -c ichirokuxvi\|velista.app\|local-path\|luna-stateful` over it prints 0 except the image prefix.
- `helm template ... --set secrets.create=true -f <test secrets file>` renders seven Secrets.
- `bash k8s/bootstrap/provision-release.sh --check --unit velista --env staging --render-only` passes.
- A manual install on a kind cluster with Envoy Gateway and cert-manager (`selfsigned`
  ClusterIssuer), following `docs/deploy/kubernetes.md` word for word: every Deployment
  `rollout status` succeeds, the migration Jobs complete, `curl -k --resolve` reaches
  `api.<domain>/health/ready`. The builder records the commands and the times in the PR.
- After the first velista release: `helm show chart oci://<path>/velista --version X.Y.Z`.

## Decisions taken in this plan

### D1. Each owner assumption becomes a value

| Today's default | Generic default | The owner's values set |
| --- | --- | --- |
| `gateway.className: eg` | empty, `required` when `gateway.enabled` | `eg` |
| Envoy policy when `className` is `eg` | `gateway.envoyPolicies: false` | `true` |
| `storageClassName: local-path` (Postgres, NATS, transcriber) | empty, the field omitted, so the cluster's default class applies | `local-path` |
| `priorityClass.enabled: true` | `false` | `true` |
| `referenceGrants: [portfolio]` | `[]` | per k8s `0019` D7 |
| `harvester.userAgent: 'Velista/0.1 (...)'` | empty, required when `harvestEnabled` | the owner's string |
| `image: ghcr.io/ichirokuxvi/nx-portfolio/<name>` | `imagePrefix` + `/` + project name | `imagePrefix` of the owner's registry |
| `imageTag: latest` | empty, meaning `.Chart.AppVersion` | the pipelines keep passing `--set imageTag` |
| `velistaServer.enabled: false` | `true` | `true` (no change) |

The Envoy policy moves to an explicit value rather than a detection of the CRD, because
`.Capabilities` differs between `helm template` (which `provision-release.sh --check`
uses) and an install, and a render that drops an object the install keeps is a check that
proves nothing. On another implementation the WebSocket idle timeout falls back to that
implementation's default, as `implementation-envoy.yaml.tpl` already warns; the
documentation names the timeout to set there.

The Issuer keeps its default (`kind: Issuer`, `create: true`, required e-mail), because the
chart's own ACME account is the least surprising answer for a stranger with a public
domain. `kind: ClusterIssuer` with `create: false` and a name is the option for a cluster
with an issuer of its own, as the portfolio's local values and the homelab values do. The
example file shows both.

The backend becomes on by default. It was off so that turning it on waited for the
Secrets; a published chart whose default installs a client with no server surprises
everyone, and the documentation puts the Secrets before the install.

### D2. URLs derive from the domain

When empty, `config.corsOrigins` becomes `https://<baseDomain>,https://admin.<baseDomain>`,
`appBaseUrl` `https://<baseDomain>/{locale}`, `googleCallbackUrl`
`https://api.<baseDomain>/v1/auth/google/callback`, `mailVerifyBaseUrl`
`https://<baseDomain>/auth/verify`, `mailResetBaseUrl` `https://<baseDomain>/auth/reset-password`,
each through the hosts of `charts.host`, so a `hostOverrides` entry moves them too. The
owner's files keep their explicit values (production adds the portfolio origin to CORS).
The prefixes are the same in the Compose path (k8s `0020` D4), so both documentation pages
give the same examples.

### D3. Secrets are documented, and created from values only on request

The chart reads the seven Secrets by fixed name. `k8s/helm/luna-shopper-backend-secrets.md`
(renamed by k8s `0019`) gets one table per Secret: key, required or optional, what reads it,
how to generate it. `docs/deploy/kubernetes.md` shows the `kubectl create secret generic`
commands that produce them, with `openssl` lines for the passwords and the two RSA
keypairs, the rule that each `*_DB_URL` holds the same password as its instance Secret,
and the rule that `HARVESTER_ACTOR_ID` and the keypairs are never regenerated on an
existing install. `provision-release.sh` is named as the owner's generator that does all
of this and runs on any cluster.

`secrets.create: true` renders the seven Secrets from `secrets.values` (the same keys),
with `helm.sh/resource-policy: keep` and a `NOTES.txt` warning: values files are often
committed, and a Secret in a values file is a Secret in a repository. It exists for a test
cluster and the documentation says so. Generation inside the chart (sprig's
`genPrivateKey` and `randAlphaNum`, kept across upgrades with `lookup`) was rejected:
`lookup` returns nothing under `helm template`, `--dry-run` and GitOps tools, so a render
there regenerates the JWT keys and signs every user out, and a new `HARVESTER_ACTOR_ID`
orphans the harvester's catalog rows.

The operator Secret stays optional in effect: every `LEGAL_*` set as a value renders as a
literal, as today. The backup Secret is read only when `backups.enabled`.

### D4. Publishing

On each velista release, after the deploy job succeeds, a `publish-chart` job in
`release-unit.yml` runs `helm dependency build`, `helm package k8s/helm/velista --version
X.Y.Z --app-version X.Y.Z`, and `helm push velista-X.Y.Z.tgz oci://<path>`, with
`packages: write` on that job only. It runs for a unit whose `unit.env` sets `CHART_OCI`
(velista only; the portfolio is the owner's site). After the deploy, so that a published
version is one the owner's production accepted; a red deploy publishes nothing, and a
redeploy publishes nothing.

The `common` library chart is vendored, not published: `helm package` puts
`charts/common-0.1.0.tgz` inside the velista package, so an install needs one reference.
Publishing `common` separately would add a second artifact to version and nobody else
consumes it.

`Chart.yaml` in git keeps `version: 0.1.0`; the package command sets the real numbers. The
chart's version stream is velista's release stream, which never goes down (`CLAUDE.md`),
so `helm upgrade` ordering matches the app.

### D5. `docs/deploy/kubernetes.md`

In this order:

1. **Prerequisites.** Kubernetes with the Gateway API standard CRDs (v1.x, with
   `ReferenceGrant` and HTTPRoute `timeouts`); a Gateway implementation with a
   GatewayClass; cert-manager with Gateway API support enabled
   (`config.gatewayAPI.enabled=true`, as `install.sh` sets it); a default storage class
   with ReadWriteOnce volumes; a way for the Gateway's Service to get an address (a cloud
   load balancer, MetalLB, or the cluster's own); DNS for the four hosts; pullable images.
2. **One way to get there.** `k8s/bootstrap/install.sh` installs exactly that on a k3s
   host: the CRDs, Envoy Gateway in merged mode, cert-manager, MetalLB with one address.
   It is the owner's path and works on any fresh Linux host; it is not required.
3. **Secrets** (D3), before the install.
4. **Values a deployer sets**: `baseDomain`, `gateway.className`, the issuer (e-mail, or
   an existing ClusterIssuer), the `LEGAL_*` values (first among the optional ones, with
   the rule that `termsAcceptanceRequired` stays false until they are set), SMTP, Google,
   the assistant, `minClientVersion`, the harvester switches and why all three default off.
   `values.example.yaml` is the starting file.
5. **Install**: `helm install velista oci://<path>/velista --version X.Y.Z -n velista
   --create-namespace -f my-values.yaml --wait --timeout 20m`, the first operator with
   `kubectl -n velista exec deploy/velista-server-auth -- node admin-cli.js create <username>`. The page uses
   the namespace and object names of k8s `0019`; if this plan merges first, it writes them as
   they will be and notes the two that differ until `0019` lands (`luna-shopper`,
   `luna-shopper-backend-auth`).
6. **Upgrade**: `helm upgrade` at the next version with `--wait`; the migration hook runs
   before new pods take traffic; migrations are expand and contract.
7. **Rollback**: `helm rollback velista <revision> -n velista`. The schema stays at the newer
   release; old pods run against it because migrations are backward compatible. Why the
   project's own production deploys without `--atomic`, in two sentences from
   `deploy-release.sh`. A release that contracted a column cannot be rolled back past;
   restore instead.
8. **Backups**: on with an S3 bucket and its Secret; the lifecycle rule is the retention.
9. **What this does not give**: the project's own pipelines, gates, release tasks, host
   maintenance and provisioning scripts are in the repository and are the project
   owner's; they run against this chart but assume the owner's environments. One release
   per namespace.
10. **Tested implementations**: the list of owner decision 4, and the one value to set on
    another implementation (the WebSocket idle timeout).

### D6. Verification

`pr.yml` gains a job filtered on `k8s/helm/**`: `helm lint` with the example values,
`helm template` with the example values and with each owner environment, and the render
with `secrets.create`. Seconds, no cluster. A kind or k3d job that installs the chart in
CI was rejected as a standing cost: it takes minutes of Envoy Gateway and cert-manager
start up on every chart change, and the owner's staging cluster installs the real thing
on every push to `main`. A manual install on kind, following the page, is the release
check the builder runs once and the documentation describes, so a stranger's path has been
walked at least once per change to it.

## Owner decisions

1. **The OCI path.** Recommendation: `oci://ghcr.io/ichirokuxvi/charts`, beside the images,
   until docs `0005` names the organisation of the Velista repository; the path then moves
   with the images.
2. **The `common` chart.** Recommendation: vendored inside the package (D4), not published.
3. **A kind install in CI.** Recommendation: no; the render test in `pr.yml` and the
   documented manual install as the release check (D6).
4. **The tested Gateway implementations.** Recommendation: list Envoy Gateway (the
   version `install.sh` pins) as tested, and name others as untested until someone
   reports an install.
5. **The backend on by default** (D1). Recommendation: yes.
6. **The package's visibility.** A public chart needs a public package, and pulls of the
   images it names need public images (k8s `0020` owner decision 7). Recommendation: make
   both public when docs `0005` publishes the repository.

## Owner steps outside the code

- After the first release that publishes the chart, set the package `charts/velista` to
  public on the registry, together with the image packages (owner decision 6).
- Nothing changes on the clusters: the owner's values files carry the old defaults.

## CLAUDE.md

Replace the sentence "Thus a chart names the implementation only through
`gateway.className`" with:

> Thus a chart names the implementation only through `gateway.className` (required) and
> `gateway.envoyPolicies`, and the owner's values files set both (k8s plan 0021). The
> velista chart is published to an OCI registry on each velista release and its defaults
> name nothing of the owner's clusters; a default that the owner's deployment needs goes in
> `values.staging.yaml` and `values.production.yaml`, never back into `values.yaml`.
