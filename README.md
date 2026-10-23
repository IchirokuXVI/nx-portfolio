# nx-portfolio

A personal portfolio built as an **Angular module-federation micro-frontend system** inside an [Nx](https://nx.dev) monorepo, plus a **NestJS backend** for velista, shipped with a custom Nx Docker build/push toolchain and deployed to **k3s** clusters via **Helm**.

- **`shell`** — host application. Owns the router and lazy-loads the remotes at runtime.
- **`odontogram`, `damoclesSword`, `landingV2`, `velista`** — remote micro-frontends, each exposing its routes via `./Routes` (module federation). The first three render **only through the shell**: served on their own port they show a blank page. **velista is the exception**, a standalone app that is also exposed as a remote, served from its own origin (`velista.app`) and installable there as a PWA.
- **`apps/luna-shopper-backend/*`** — velista's backend: seven NestJS services (`gateway`, `realtime`, `auth`, `core`, `catalog`, `harvester`, `assistant`) talking over NATS, with four Postgres instances and Redis.
- **`luna-shopper-admin`**: the Luna Shopper back office. A standalone Angular app (port 4206), not a remote, so the shell never loads it. It is served from its own origin (`admin.velista.app`) and talks to the same gateway as velista, on the `/v1/admin` routes.
- **`apps/docker/*`** — non-Angular Nx "app" projects that wrap a Dockerfile (`builder`, `local-http-server`).
- **`tools/docker`** — custom Nx plugin (`@portfolio/docker`) providing the `build`/`push` executors behind every `build:docker` target.
- **`libs/<scope>/*`** — libraries grouped by scope (`shared`, `damoclesSword`, `odontogram`, `landing-v2`, `velista`, `luna-shopper`, `luna-shopper-admin`).
- **`k8s/helm`** — one Helm chart per deploy unit (`portfolio`, `velista`) over the library chart `common`, deployed by CI. Each describes **one** environment; which one comes from the cluster you point it at and the values file you pass beside `values.yaml`.
- **`k8s/bootstrap`** — the once-per-cluster install (Gateway API CRDs, Envoy Gateway, cert-manager, a ClusterIssuer) plus the host and release provisioning scripts. Deliberately outside the chart.

For architecture and coding conventions see [`CLAUDE.md`](./CLAUDE.md).

## Local development

Everything runs through Nx (`npx nx ...`); there are no top-level npm scripts.

```sh
npx nx serve shell           # the host. `devRemotes` is empty, so remotes are
                             # served from their last build, not watched.
npx nx serve damoclesSword   # a remote in watch mode; boots the shell too via
                             # dependsOn (odontogram has no such dependsOn)
npx nx build shell           # production build (default configuration)

npx nx run-many --all --target=test    # test the whole workspace
npx nx run-many --all --target=lint
npx nx affected -t lint test build      # only what changed (mirrors CI)

npx nx graph                 # explore the project/dependency graph
```

Build one app's Docker image locally with the custom executor:

```sh
npx nx run shell:build:docker --configuration=production
```

### Serving from a worktree

Every app has a fixed port, so two checkouts that both `nx serve` collide. Use the
slot scripts rather than a hand rolled `nx serve` or `docker compose up`, and check
what is already running before claiming one:

```sh
tools/dev/ng-slot.sh --list                     # who holds what, and what is live
tools/dev/ng-slot.sh --up --apps shell,velista  # claim the lowest free slot and serve
tools/dev/ng-slot.sh --up --apps luna-shopper-admin  # the back office alone, no shell
tools/dev/ng-slot.sh --down

bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
```

There are no `.ps1` twins: Git Bash is the supported shell on Windows. Slot 0 is
the developer's own, on the ports `project.json` already names. See [`tools/dev/README.md`](./tools/dev/README.md) and
[`CLAUDE.md`](./CLAUDE.md) for the port bands and why a port override in a
`project.json` is the wrong fix.

---

## Deployment / CI/CD

The apps deploy in **units** ([k8s plan 0014](./k8s/plans/0014-a-deploy-unit-is-a-tag-a-chart-and-two-environments.md)):
`portfolio` (the shell and its three remotes) and `velista` (velista, the back
office and the seven Luna services). Each unit has its own pipelines, namespace,
Helm release and GitHub environments ([k8s plan 0016](./k8s/plans/0016-each-unit-deploys-from-its-own-job.md)).

| Workflow | Trigger | Does |
| --- | --- | --- |
| **`pr-title.yml`** | any PR opened, edited, reopened or synchronized | validates the PR title against `tools/release/rules.mjs` (see [`CONTRIBUTING.md`](./CONTRIBUTING.md)). It has no branch filter, so a stacked PR is checked too. |
| **`pr.yml`** | PR into `main` or `dev` | `verify`: lint, unit-test and `manifest-check` the affected projects (against the PR's target branch), and the unit registry check. `verify-infra`: when a Luna Shopper project is affected, brings up a stack and runs the backend integration suites plus the `luna-shopper-backend-e2e` suite. |
| **`staging-portfolio.yml`**, **`staging-velista.yml`** | push to `main`, or manual dispatch | call `stage-unit.yml` for their unit: lint + unit-test affected, build + push the unit's affected images under `staging`, run the unit's e2e gates against them, deploy the unit to staging. |
| **`release-portfolio.yml`**, **`release-velista.yml`** | GitHub Release published | call `release-unit.yml` for their unit: test what changed since the unit's previous release, build + push every image of the unit under the version, deploy the unit to production. |
| **`host-maintenance.yml`** | Monday 03:30 UTC | patches the staging host, waits two days, patches production (k8s plan 0013). |
| **`image-scan.yml`** | Monday 06:00 UTC | scans every deployable image, listed by `tools/deploy/units.mjs images`. |

**Testing model.** Tests run at every stage rather than once. The PR runs unit tests
for quick feedback before merge; the merge to `main` re-runs the unit tests on the
actual merged commit **and** e2e-tests the built staging images; a release re-tests on
the release commit. Because each stage tests the exact code it is about to deploy, no
merge queue is needed.

### Staging pipeline (`stage-unit.yml`)

```
push to main  (or workflow_dispatch, where build_all=true ignores affected)
  │
  setup         base = SHA of the last successful run of this unit's caller workflow;
  │             images = nx show projects --affected --with-target build:docker
  │                      --projects tag:deploy:<unit>; gates = units.mjs gates <unit>
  │             Nothing of the unit affected: the pipeline stops here.
  │
  ├─ lint-test  nx run-many -t lint test over everything affected, inside BUILD_IMAGE
  │
  └─ build      the base image under `staging`, the bundles inside BUILD_IMAGE with the
     │          unit's BUILD_ENV_STAGING, the runtime manifest check for Luna bundles,
     │          then build:docker with DOCKER_IMAGE_TAG=staging and BUILDER_TAG=staging
     │
     └─ gate (one job per gate of GATES whose TRIGGERS are affected)
          portfolio-frontend    shell + remotes behind a proxy, `/velista` reaches velista
          luna-shopper-backend  luna-shopper-backend-e2e against the service images
          velista-luna          velista on its origin and under /velista, + the Luna stack
  │
  deploy        environment <unit>-staging, concurrency deploy-<unit>-staging,
                .github/actions/deploy-unit: rsync k8s/ → ~/deploy/<unit>/k8s/,
                the cutover check, provision-release.sh --check --unit <unit>,
                release tasks, helm upgrade --atomic --timeout 10m,
                kubectl rollout restart + a separate rollout status loop
```

A gate is a directory under `k8s/e2e` with `gate.sh` and `gate.env`; the
[`k8s/README.md`](./k8s/README.md) section "Pipelines and gates" describes both. A red
gate of one unit never blocks the other unit's deploy. There is no build stage inside
an app's Dockerfile: `nx build` runs once in the pinned `BUILD_IMAGE`,
`build:docker` sets `"context": "dist"`, and the finished bundle is copied in.

The deploy job holds the group `deploy-<unit>-<env>` with `cancel-in-progress: false`,
so two runs of one unit queue and the other unit is never touched. Deploys and the
weekly host patch exclude each other through `flock` on `/run/lock/nx-deploy.lock` on
the host, not through a GitHub group.

### How "affected" is computed

Nx doesn't diff against the previous commit — it diffs against the **last successful run of the same caller workflow**, so each unit keeps its own history. That SHA is fetched with the GitHub CLI:

```sh
gh run list --branch "$branch" --workflow "$workflow" --json headSha,conclusion \
  --jq '[.[] | select(.conclusion=="success")][0].headSha'
```

That SHA becomes `--base` for the `nx show projects --affected` queries in the `setup` job. With no earlier successful run, or on a manual dispatch with `build_all`, the queries drop `--affected` and list everything of the unit.

### Images & registry

- Registry: **`ghcr.io/ichirokuxvi`** (env `DOCKER_REGISTRY`). Images are named `nx-portfolio/<app>`. `DOCKER_IMAGE_TAG` overrides the target's `versionTags`, so staging pushes the mutable `staging` tag and a release pushes `<version>,latest`. The base image `local-http-server` is tagged `staging` or `<unit>-v<version>` and never `latest` by a deploy. Production pins the immutable version; rollback is `deploy-release.sh <unit> <older-version>`.
- The workflow logs in with `docker/login-action` using the built-in `GITHUB_TOKEN`, so the executor is told to skip its own login via `DOCKER_SKIP_LOGIN=true`.
- `push` only happens for targets whose `production` configuration sets `pushToRegistry: true` (see each app's `project.json`).
- Nothing compiles on the runner. Lint, unit tests and every `nx build` run inside `BUILD_IMAGE`, a digest pinned `node:24-slim` named at the top of `stage-unit.yml` and `release-unit.yml`.

### GitHub environments

Each unit deploys with the values of its environment, `<unit>-staging` or
`<unit>-production`. Host maintenance uses `host-staging` and `host-production`.
Each holds the secrets `SSH_DEPLOY_HOST`, `SSH_DEPLOY_USER` and `SSH_DEPLOY_KEY` and
the variable `SSH_KNOWN_HOSTS`; `host-production` also holds `SSH_SOAK_CHECK_HOST`.
`k8s/bootstrap/github-environments.sh` writes them
([`k8s/README-new-cluster.md`](./k8s/README-new-cluster.md), section 7). A pipeline
whose environment lacks a value stops before any SSH and names it. `ALLOW_CUTOVER` on
a production environment lets its deploy run the cutover of k8s plan 0016 D5.

`GITHUB_TOKEN` (provided automatically) is used for GHCR login and `gh run list`.

### Adding a new deployable app

1. Give it a `build:docker` target with `development`/`production` configurations and an `imageName` (mirror an existing Angular app's `project.json`), **or** — for a plain Dockerfile wrapper — a `build` target using `@portfolio/docker:build` plus the `type:static-docker` / `type:dynamic-docker` tag.
2. Tag it `deploy:<unit>` and add **one** entry to `k8s/helm/<unit>/values.yaml` under `apps` (`name`, `image`, `hostPrefix`, `path`). No environment field and no second staging entry.
3. Name its e2e project in the `TRIGGERS` of one gate. `node tools/deploy/units.mjs check` fails until both are done.

---
## Kubernetes / Helm

> **Running the whole stack locally** (build every image from scratch on Docker
> Desktop Kubernetes and run e2e against the real containers) is documented in
> [`k8s/README.md`](./k8s/README.md), including the port / mfe-path / hostnames local
> modes and common pitfalls. The rest of this section covers the cluster chart.

### Two environments, two clusters, one chart

Production and staging are **separate k3s clusters on separate VPSs**, not two halves
of one release (k8s plan 0002). Each unit chart (`k8s/helm/portfolio`,
`k8s/helm/velista`, over the library `k8s/helm/common`) describes exactly one
environment; which one is decided by the cluster you point it at and the values file
you pass beside `values.yaml`:

| | Production | Staging |
| --- | --- | --- |
| Values file | `values.production.yaml` | `values.staging.yaml` |
| `baseDomain` | `ichirokuxvi.com`, `velista.app` | `staging.ichirokuxvi.com`, `staging.velista.app` |
| MetalLB pool | `install.sh --ip 152.53.49.229` | `install.sh --ip 152.53.50.209` |
| Image tag | the immutable release version | the mutable `staging` tag |
| Deployed by | `release-<unit>.yml` | `staging-<unit>.yml` |

There is no `env` field, no `-staging` resource name and no `staging.enabled` switch.
Resource names are identical in both clusters, which is what makes them comparable.
The portfolio lives in the namespace **`portfolio`** and velista in
**`luna-shopper`**; the routing data plane and cert-manager live in their own.

### Routing is the Gateway API

The chart declares only core `gateway.networking.k8s.io/v1` objects: one `Gateway`
plus one `HTTPRoute` per entry, with an HTTPS redirect route and the TLS listeners
that follow from the set of hosts. **The data plane is not in the chart.** It is
provisioned by **Envoy Gateway** in its own namespace, with **cert-manager** issuing
the certificates from a `ClusterIssuer`, all installed once per cluster by
[`k8s/bootstrap/install.sh`](./k8s/bootstrap/install.sh) (`install.ps1` on Windows).
The chart names the implementation only through `gateway.className`, so swapping it
means editing the `gateway` block in `values.yaml` and the one namespace in
`metallb.serviceNamespaces`.

The single knowing exception is `templates/gateway/implementation-envoy.yaml.tpl`, a
`BackendTrafficPolicy` carrying the long lived timeout the routed WebSocket services
need.

MetalLB is still what puts the gateway's data plane Service on the node's public IP,
so `values.<env>.yaml` names an `ipAddress` and the chart renders the `IPAddressPool`
and `L2Advertisement`. A local Docker Desktop deploy turns the pool off, since
LoadBalancer services already surface on localhost there.

### Hosts

Each `apps` / `lunaShopperBackend.services` entry carries a `hostPrefix`, composed
under the values file's `baseDomain`. An environment file can override an entry's host
by name in `hostOverrides`, which is what puts velista, the back office and the two
backend services on velista's own domain:

| Entry | Production host | Path |
| --- | --- | --- |
| `shell` | `ichirokuxvi.com` | `/` |
| `odontogram` | `mfe.ichirokuxvi.com` | `/odontogram` |
| `damoclessword` | `mfe.ichirokuxvi.com` | `/damoclesSword` |
| `landingv2` | `mfe.ichirokuxvi.com` | `/landingV2` |
| `velista` | `velista.app` (override) | `/` |
| `luna-shopper-admin` | `admin.velista.app` (override) | `/` |
| `luna-shopper-backend-gateway` | `api.velista.app` (override) | |
| `luna-shopper-backend-realtime` | `rt.velista.app` (override) | |

Staging is the same six names one label down: `staging.ichirokuxvi.com`,
`mfe.staging.`, `staging.velista.app`, `admin.staging.velista.app`,
`api.staging.velista.app`, `rt.staging.velista.app`.

`ichirokuxvi.com/velista` keeps working: the shell mounts the remote at that path and
loads it from the new origin, which is what the workflows' `MFE_REMOTE_URLS` says.
velista **moved**, it was not duplicated. A second entry would run the same image on
two hostnames.

**DNS is a manual prerequisite and it has to happen first.** Every host must resolve
to that cluster's `ipAddress` *before* the deploy, because cert-manager cannot solve an
HTTP-01 challenge for a name that does not resolve, and failed attempts burn Let's
Encrypt rate limit.

### The backend

`lunaShopperBackend` renders the seven services, their stateful dependencies (four
Postgres instances, NATS with JetStream, Redis) and the zero downtime deploy config
(rolling update with a readiness gate, graceful shutdown, PodDisruptionBudgets). Only
`gateway` and `realtime` are public; the rest are ClusterIP and reached over NATS.

The **harvester is deployed in both clusters** (`harvester.enabled: true` and
`harvestEnabled: true`), and both clusters can start a run. Whether a chain is
fetched is a row per chain in the harvester's own database
(`supermarket_sources.enabled`), off by default and turned on by the owner from the
back office. In production only (`schedulerEnabled: true`), a schedule can start a
saved preset by itself at a time of day (backend plan 0206). A schedule needs the row
of its chain left on. See the Luna Shopper section of [`CLAUDE.md`](./CLAUDE.md).

### Provisioning a cluster

Three scripts, in order, the same three for both environments with different arguments:

```sh
k8s/bootstrap/provision-host.sh              # bare VPS  -> machine (accounts, keys, k3s)
k8s/bootstrap/install.sh                     # machine   -> cluster (Gateway API, Envoy
                                             #              Gateway, cert-manager, issuer)
k8s/bootstrap/provision-release.sh --env <e> # cluster   -> namespace + six Secrets
```

[`k8s/README-new-cluster.md`](./k8s/README-new-cluster.md) is the runbook for a fresh
machine, in order, including the DNS and root lockout steps that have to happen at a
particular moment.

### Operating the release manually

Run from the cluster host (or anywhere with `KUBECONFIG` pointed at the k3s config):

```sh
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# Preview rendered manifests without applying
helm dependency build --skip-refresh ./k8s/helm/velista
helm template velista ./k8s/helm/velista -n luna-shopper \
  --values ./k8s/helm/velista/values.yaml --values ./k8s/helm/velista/values.production.yaml

# Assert every Secret/ConfigMap key the render references exists
bash ./k8s/bootstrap/provision-release.sh --check --unit velista --env production

# Deploy a production release of one unit (pins --set imageTag=<version>, then verifies)
./k8s/helm/deploy-release.sh velista 1.1.3

# Roll back: re-run with an older version whose images still exist
./k8s/helm/deploy-release.sh velista 1.1.2

# Inspect
kubectl -n luna-shopper get pods,svc,httproute,gateway
kubectl get gateway -A
```
