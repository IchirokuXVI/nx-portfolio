# nx-portfolio

A personal portfolio built as an **Angular module-federation micro-frontend system** inside an [Nx](https://nx.dev) monorepo, plus a **NestJS backend** for velista, shipped with a custom Nx Docker build/push toolchain and deployed to **k3s** clusters via **Helm**.

- **`shell`** — host application. Owns the router and lazy-loads the remotes at runtime.
- **`odontogram`, `damoclesSword`, `landingV2`, `velista`** — remote micro-frontends, each exposing its routes via `./Routes` (module federation). The first three render **only through the shell**: served on their own port they show a blank page. **velista is the exception**, a standalone app that is also exposed as a remote, served from its own origin (`velista.app`) and installable there as a PWA.
- **`apps/luna-shopper-backend/*`** — velista's backend: seven NestJS services (`gateway`, `realtime`, `auth`, `core`, `catalog`, `harvester`, `assistant`) talking over NATS, with four Postgres instances and Redis.
- **`apps/docker/*`** — non-Angular Nx "app" projects that wrap a Dockerfile (`builder`, `local-http-server`).
- **`tools/docker`** — custom Nx plugin (`@portfolio/docker`) providing the `build`/`push` executors behind every `build:docker` target.
- **`libs/<scope>/*`** — libraries grouped by scope (`shared`, `damoclesSword`, `odontogram`, `landing-v2`, `velista`, `luna-shopper`).
- **`k8s/helm`** — the Helm chart deployed by CI. It describes **one** environment; which one comes from the cluster you point it at and the values file you pass beside `values.yaml`.
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
tools/dev/ng-slot.sh --down

bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
```

Both have `.ps1` twins. Slot 0 is the developer's own, on the ports `project.json`
already names. See [`tools/dev/README.md`](./tools/dev/README.md) and
[`CLAUDE.md`](./CLAUDE.md) for the port bands and why a port override in a
`project.json` is the wrong fix.

---

## Deployment / CI/CD

Three GitHub Actions workflows, one per boundary:

| Workflow | Trigger | Does |
| --- | --- | --- |
| **`pr.yml`** | PR into `main` or `dev` | lint + unit-test the affected projects (against the PR's target branch), plus the backend integration suites. Fast pre-merge feedback. |
| **`docker-ci.yml`** | push to `main` | unit-test affected, build + push affected staging images, e2e them (frontend **and** Luna backend), deploy staging. |
| **`release.yml`** | GitHub Release published | test all apps, build + push all production images, deploy production. |

**Testing model.** Tests run at every stage rather than once. The PR runs unit tests
for quick feedback before merge; the merge to `main` re-runs the unit tests on the
actual merged commit **and** e2e-tests the built staging images; a release re-tests on
the release commit. Because each stage tests the exact code it is about to deploy, no
merge queue is needed (a merge queue would serialize and slow every merge; here two
PRs can merge back-to-back and each resulting push to `main` is tested on its own).

> Requiring the `pr.yml` check on `main` and `dev` is still recommended so obviously
> broken code never merges, but it is no longer a correctness requirement, since the
> merge and release workflows test the code they deploy regardless.

### Staging pipeline (`docker-ci.yml`)

```
push to main
  │
  ├─ Log in to GHCR (ghcr.io) + set up Docker Buildx + expose the gha buildx cache
  ├─ Setup Node 22, install pinned Nx
  ├─ Build the `docker/builder` image (the CI build image)
  ├─ Resolve the "affected" base = SHA of the last successful run of this workflow
  ├─ Build affected static-docker apps            (nx run-many -t build)
  ├─ Test affected apps inside the builder image  (nx run-many -t test)
  ├─ Build the bundles inside the builder image   (nx run-many -t build prune, with
  │                                                MFE_BASE_URL / MFE_REMOTE_URLS /
  │                                                LUNA_* set as env, not build args)
  ├─ Build & push affected images                 (nx run-many -t build:docker,
  │                                                DOCKER_IMAGE_TAG=staging)
  ├─ e2e-frontend: shell + remotes                (k8s/e2e/portfolio-frontend/compose.yml)
  ├─ e2e-luna: the backend stack                  (k8s/e2e/luna-shopper-backend/compose*.yml)
  └─ Deploy to SSH_DEPLOY_HOST_STAGING:
       rsync k8s/ → provision-release.sh --check --env staging
                  → helm upgrade --atomic --timeout 10m (values.yaml + values.staging.yaml)
                  → kubectl rollout restart + a separate rollout status loop
```

Both e2e jobs gate the deploy: it runs only if neither failed. There is no build
stage inside an app's Dockerfile. `nx build` runs once for the whole workspace in
the pinned builder image, `build:docker` sets `"context": "dist"`, and the finished
bundle is copied in. That is why the shell's `MFE_BASE_URL` is an env var on the
build container rather than a Docker build arg.

Both deploy workflows use a `concurrency` group (`staging-deploy` / `production-release`)
with `cancel-in-progress: false`, so runs never overlap: a second staging deploy (two
PRs merged in quick succession) or a second release (two releases published close
together) waits for the first to finish instead of racing the build/push and the
`helm upgrade`. Note GitHub keeps only one run *pending* per group, so if a third run
is queued while one is pending, the older pending run is superseded.

### How "affected" is computed

Nx doesn't diff against the previous commit — it diffs against the **last successful run of this same workflow**. That SHA is fetched with the GitHub CLI:

```sh
gh run list --branch "$branch" --workflow "$workflow" --json headSha,conclusion \
  --jq '[.[] | select(.conclusion=="success")][0].headSha'
```

That SHA becomes `--base` (with `--head=${{ github.sha }}`) for three separate `nx show projects --affected` queries, so unrelated apps are never rebuilt:

| Set                      | Query                             | Used for                                            |
| ------------------------ | --------------------------------- | --------------------------------------------------- |
| `affected_docker_apps`   | apps tagged `type:static-docker`  | plain Dockerfile apps built with `nx build`         |
| `affected_testable_apps` | projects with a `test` target     | tests run inside the builder image                  |
| `affected_apps_tobuild`  | apps with a `build:docker` target | Angular apps built + pushed via the custom executor |

### Images & registry

- Registry: **`ghcr.io/ichirokuxvi`** (env `DOCKER_REGISTRY`). Images are named `nx-portfolio/<app>`. `DOCKER_IMAGE_TAG` overrides the target's `versionTags`, so staging pushes the mutable `staging` tag and a release pushes `<version>,latest`. Production pins the immutable version; rollback is `deploy-release.sh <older-version>`.
- The workflow logs in with `docker/login-action` using the built-in `GITHUB_TOKEN`, so the executor is told to skip its own login via `DOCKER_SKIP_LOGIN=true`.
- `push` only happens for targets whose `production` configuration sets `pushToRegistry: true` (see each app's `project.json`).
- Tests run _inside_ `ghcr.io/<repo-lowercase>/builder:latest` — the builder image is rebuilt first so tests use the current toolchain.

### Deploy step (SSH → Helm)

After the images are pushed and both e2e gates pass, the workflow ships the chart and
upgrades the release on the cluster host over SSH. CI connects as `SSH_DEPLOY_USER`, an
**unprivileged** account: the chart lands in that user's home, not `/root`, and nothing
in the deploy path uses sudo, because k3s writes its kubeconfig world readable.

```sh
rsync -avz --delete ./k8s/ $SSH_DEPLOY_USER@$SSH_DEPLOY_HOST_STAGING:~/k8s/

# 1. Preflight. Renders the chart and asserts every secretKeyRef / configMapKeyRef
#    it references actually exists. A deploy that cannot work is rejected in
#    seconds instead of diagnosed from a crashloop.
bash ~/k8s/bootstrap/provision-release.sh --check --env staging

# 2. Upgrade, and wait. --atomic implies --wait and rolls back on failure, and it
#    covers the pre-upgrade migration Jobs for free.
helm upgrade --install nx-portfolio $HOME/k8s/helm   --namespace nx-portfolio --create-namespace   --values $HOME/k8s/helm/values.yaml   --values $HOME/k8s/helm/values.staging.yaml   --atomic --timeout 10m

# 3. Roll the deployments whose mutable `staging` tag was just overwritten, then
#    observe them in a separate `rollout status` loop.
kubectl -n nx-portfolio rollout restart deploy/<changed>
kubectl -n nx-portfolio rollout status  deploy/<changed>
```

**Deploys wait and are verified** (k8s plan 0003). `helm upgrade` without `--wait`
returns as soon as the API server accepts the manifests, and `kubectl rollout restart`
is asynchronous, so an earlier version of both paths reported success while pods
crashlooped. Production uses `deploy-release.sh <version>` with `--wait` rather than
`--atomic`; the reasoning is in the script.

Staging is disposable by design. If `SSH_DEPLOY_HOST_STAGING`, `SSH_DEPLOY_USER` or
`SSH_DEPLOY_KEY` is unset, the run stays green, publishes the images and says plainly
that it did not deploy.

### Required GitHub secrets

| Secret            | Purpose                                                 |
| ----------------- | ------------------------------------------------------- |
| `SSH_DEPLOY_KEY`  | Private key loaded into `ssh-agent` for the deploy host |
| `SSH_DEPLOY_USER` | Unprivileged SSH user on the cluster host (`deploy`)     |
| `SSH_DEPLOY_HOST` | Production cluster host address                         |
| `SSH_DEPLOY_HOST_STAGING` | Staging cluster host address (`docker-ci.yml`)  |

`GITHUB_TOKEN` (provided automatically) is used for GHCR login and `gh run list`; the workflow needs `packages: write`.

### Adding a new deployable app

1. Give it a `build:docker` target with `development`/`production` configurations and an `imageName` (mirror an existing Angular app's `project.json`), **or** — for a plain Dockerfile wrapper — a `build` target using `@portfolio/docker:build` plus the `type:static-docker` / `type:dynamic-docker` tag so CI picks it up.
2. Add **one** entry to `k8s/helm/values.yaml` under `apps` (`name`, `image`, `hostPrefix`, `path`). No environment field and no second staging entry: the host is `hostPrefix` under the values file's `baseDomain`, unless that environment's `hostOverrides` names the entry.

---
## Kubernetes / Helm

> **Running the whole stack locally** (build every image from scratch on Docker
> Desktop Kubernetes and run e2e against the real containers) is documented in
> [`k8s/README.md`](./k8s/README.md), including the port / mfe-path / hostnames local
> modes and common pitfalls. The rest of this section covers the cluster chart.

### Two environments, two clusters, one chart

Production and staging are **separate k3s clusters on separate VPSs**, not two halves
of one release (k8s plan 0002). The chart in `k8s/helm` describes exactly one
environment; which one is decided by the cluster you point it at and the values file
you pass beside `values.yaml`:

| | Production | Staging |
| --- | --- | --- |
| Values file | `values.production.yaml` | `values.staging.yaml` |
| `baseDomain` | `ichirokuxvi.com` | `staging.ichirokuxvi.com` |
| MetalLB `ipAddress` | `152.53.49.229` | `152.53.50.209` |
| Image tag | the immutable release version | the mutable `staging` tag |
| Deployed by | `release.yml` | `docker-ci.yml` |

There is no `env` field, no `-staging` resource name and no `staging.enabled` switch.
Resource names are identical in both clusters, which is what makes them comparable.
Everything lives in the **`nx-portfolio`** namespace, except the routing data plane
and cert-manager, which live in their own.

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
by name in `hostOverrides`, which is what puts velista and its two backend services on
velista's own domain:

| Entry | Production host | Path |
| --- | --- | --- |
| `shell` | `ichirokuxvi.com` | `/` |
| `odontogram` | `mfe.ichirokuxvi.com` | `/odontogram` |
| `damoclessword` | `mfe.ichirokuxvi.com` | `/damoclesSword` |
| `landingv2` | `mfe.ichirokuxvi.com` | `/landingV2` |
| `velista` | `velista.app` (override) | `/` |
| `luna-shopper-backend-gateway` | `api.velista.app` (override) | |
| `luna-shopper-backend-realtime` | `rt.velista.app` (override) | |

Staging is the same five names one label down: `staging.ichirokuxvi.com`,
`mfe.staging.`, `staging.velista.app`, `api.staging.velista.app`,
`rt.staging.velista.app`.

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

The **harvester is switched off in both clusters on purpose** (`harvester.enabled:
false`), so none of its objects render. It runs locally against the compose stack. See
the Luna Shopper section of [`CLAUDE.md`](./CLAUDE.md).

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
helm template nx-portfolio ./k8s/helm -n nx-portfolio \
  --values ./k8s/helm/values.yaml --values ./k8s/helm/values.production.yaml

# Assert every Secret/ConfigMap key the render references exists
bash ./k8s/bootstrap/provision-release.sh --check --env production

# Deploy a production release (pins --set imageTag=<version>, then verifies)
./k8s/helm/deploy-release.sh 1.1.3

# Roll back: re-run with an older version whose images still exist
./k8s/helm/deploy-release.sh 1.1.2

# Inspect
kubectl -n nx-portfolio get pods,svc,httproute,gateway
kubectl -n nx-portfolio describe gateway nx-portfolio
```
