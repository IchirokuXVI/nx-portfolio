# Kubernetes / Helm

Each deploy unit has its own Helm chart: [`helm/portfolio`](./helm/portfolio)
deploys the `shell` host and the `odontogram`, `damoclesSword` and `landingV2`
remotes, and [`helm/velista`](./helm/velista) deploys the standalone `velista` app,
the `luna-shopper-admin` back office and the Luna Shopper backend behind velista.
Both depend on the library chart [`helm/common`](./helm/common). Each unit deploys
from its own pipeline into its own release (plan 0016, "Pipelines and gates" below).
Each unit chart runs in these shapes:

| Environment    | Driven by                                                         | Notes                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Production** | `helm/<unit>/values.yaml` + `helm/<unit>/values.production.yaml`  | Public cluster (k3s + MetalLB), TLS via Let's Encrypt, host/path routing through the Gateway API.                                                      |
| **Staging**    | `helm/<unit>/values.yaml` + `helm/<unit>/values.staging.yaml`     | Its **own** VPS and its own cluster (plan 0002), not a second half of the production release. Same chart, same resource names, different `baseDomain`. |
| **Local**      | `helm/portfolio/values.yaml` + a `values.localhost*.yaml` overlay | Docker Desktop Kubernetes, locally built `:dev` images, no registry, no admin.                                                                         |

Routing is the Kubernetes **Gateway API**, served by **Envoy Gateway**, with
**cert-manager** issuing the certificates. The charts declare only `Gateway`,
`HTTPRoute`, `Issuer` and `ReferenceGrant` objects; the data plane is provisioned by
the implementation. See
[`plans/0001-gateway-api-migration.md`](./plans/0001-gateway-api-migration.md).

### Two charts, one library

[Plan 0015](./plans/0015-one-chart-becomes-one-chart-per-unit.md) split the chart:

```
helm/
  common/      library chart: a static app (Deployment, Service, HTTPRoute), the
               Gateway of a host set, the unit's Issuer, the HTTPS redirect
  portfolio/   the portfolio unit: its four apps and the /velista route
  velista/     the velista unit: velista, the back office, luna-shopper-backend/,
               the ReferenceGrant and the PriorityClass
```

The rule: **a unit renders only into `.Release.Namespace`, and it owns its
Gateway, its Issuer and its certificates.** No values key names the unit's own namespace;
`helm --namespace` decides, and every script passes the `NAMESPACE` of the unit's
`unit.env`. Each Gateway is named after its chart and has one HTTP and one HTTPS
listener per host. `install.sh` turns on Envoy Gateway's merged gateways, so the
Gateways of both units share one data plane and one LoadBalancer Service, and no
two units may serve the same host. The MetalLB pool is the cluster's, applied by
`install.sh --ip`, never by a chart.

The one place where the units meet is the portfolio path of velista:
`externalRoutes` in the portfolio values renders HTTPRoute `velista-portfolio` with
a backend in the `luna-shopper` namespace, and `referenceGrants` in the velista
values allows it. `provision-release.sh --check` fails when either namespace
literal differs from the other unit's `unit.env`.

Each unit chart commits its `Chart.lock`, and `charts/` is git ignored. Before a
render or an install, build the library dependency offline:

```sh
helm dependency build --skip-refresh k8s/helm/<unit>
```

After a change to `helm/common`, run `helm dependency update k8s/helm/<unit>` for
both units and commit the lock files with the change.

### Deploy units

The apps deploy in **units** ([plan 0014](./plans/0014-a-deploy-unit-is-a-tag-a-chart-and-two-environments.md)).
A unit is a set of apps that ship together into one namespace, under one Helm
release and one version stream. Two units exist:

| Unit        | Apps                                                         | Namespace      | Release     | Tag prefix    |
| ----------- | ------------------------------------------------------------ | -------------- | ----------- | ------------- |
| `portfolio` | shell, odontogram, damoclesSword, landingV2                  | `portfolio`    | `portfolio` | `portfolio-v` |
| `velista`   | velista, luna-shopper-admin, the seven Luna Shopper services | `luna-shopper` | `velista`   | `velista-v`   |

A unit is declared in two places:

- The tag `deploy:<unit>` on a `project.json` names the unit of an app. Nx can
  query it: `npx nx show projects --projects tag:deploy:velista --with-target build:docker`.
- [`units/<unit>/unit.env`](./units) names the namespace, the release, the chart,
  the e2e gates, the Secrets, the hosts and the build variables of each
  environment. It is shell sourceable, so a script on a host reads it with no Nx.

`node tools/deploy/units.mjs check` keeps the two equal, and `pr.yml` runs it. It
fails when an app with a `build:docker` target has no `deploy:` tag or has two,
and when a `unit.env` is incomplete. `node tools/deploy/units.mjs list` prints
every unit as JSON, and `projects <unit>` prints the apps of one unit.

Each unit has its chart (plan 0015), its own pipelines and release (plan
0016), and its own tag prefix, notes and version stream (plan 0017).

To move an app to another unit, change its tag. To split a unit or add one,
follow section 4 of plan 0014: retag the apps, add `units/<new>/unit.env` and a
chart, create the two GitHub environments, and add the scopes of the moved apps
to `UNITS` in `tools/release/rules.mjs`. The stateful member of a split keeps the
namespace, so data never moves for a split.

### Pipelines and gates

[Plan 0016](./plans/0016-each-unit-deploys-from-its-own-job.md) gives each unit
its own pipelines:

| Workflow             | Trigger                  | Calls              | Environment                                      |
| -------------------- | ------------------------ | ------------------ | ------------------------------------------------ |
| `staging-<unit>.yml` | push to `main`, dispatch | `stage-unit.yml`   | `<unit>-staging`                                 |
| `release-<unit>.yml` | a Release `<unit>-v*`    | `release-unit.yml` | `<unit>-production`                              |
| `redeploy.yml`       | dispatch on `main`       | `deploy-unit`      | `<unit>-production-redeploy` or `<unit>-staging` |

A Release whose tag lacks the unit's prefix starts `release-<unit>.yml`, which
writes one summary line and deploys nothing. `redeploy.yml` is the rollback
(plan 0017 D7): it builds nothing, and on production it deploys an existing
version with the chart of the unit's newest tag that has a published Release.

`stage-unit.yml` lists the unit's affected images (`tag:deploy:<unit>`), runs
lint and tests over everything affected, builds the base image and the unit's
images under `staging`, runs the unit's gates, and deploys. `release-unit.yml`
builds every image of the unit under the version and deploys with
`deploy-release.sh <unit> <version>`. Both deploy through the composite action
`.github/actions/deploy-unit`: the registry check, the environment check, SSH
with pinned host keys, an rsync of `k8s/` to `~/deploy/<unit>/k8s/`, the
cutover, the preflight, the upgrade, and a diagnosis on failure.

**A gate is a directory** under `e2e/` with `gate.sh` and `gate.env`. `gate.env`
names the `/etc/hosts` names the runner points at itself (`HOSTS`), the projects
whose being affected runs the gate (`TRIGGERS`), the browsers to install
(`BROWSERS`) and the images it pulls (`IMAGES`). `gate.sh <e2e projects>` starts
its stack, runs the suites and tears down. `units.mjs check` asserts that every
e2e project is named by exactly one gate.

| Gate                   | Unit      | What it runs                                                                                  |
| ---------------------- | --------- | --------------------------------------------------------------------------------------------- |
| `portfolio-frontend`   | portfolio | the shell and the remotes behind a proxy, the remote entry checks, `/velista` reaches velista |
| `luna-shopper-backend` | velista   | `luna-shopper-backend-e2e` against the service images                                         |
| `velista-luna`         | velista   | velista on its origin and under `/velista`, plus the Luna stack for `velista-luna-e2e`        |

**Deploys and host patching exclude each other on the host.** Every helm and
kubectl step of a deploy, and `nx-host-patch` from its first package operation
until it reboots, holds `flock` on `/run/lock/nx-deploy.lock`
(`bootstrap/host-lock.sh`). A deploy waits up to fifteen minutes for it and
says that it waits.

This document is about running the stack **locally end to end** (build every image
from scratch, deploy, and run e2e against the real containers). For the production
CI/CD pipeline and the chart internals see the [root README](../README.md).

---

## Dependencies

- **Docker** with the **Kubernetes** feature enabled (Docker Desktop). The cluster
  must be running and `kubectl config current-context` should be `docker-desktop`.
  Because Docker Desktop's Kubernetes shares the Docker image store, locally built
  images are visible to the cluster with no registry push. On Windows, if the cluster
  refuses to start at all, see
  [`docker-desktop-kubernetes-wsl2.md`](./docker-desktop-kubernetes-wsl2.md).
- **Docker Buildx** (bundled with Docker Desktop) — the build executor uses
  `docker buildx build --load`.
- **Helm** 3.x and **kubectl**.
- **Node 24** and the workspace dependencies installed (`npm ci`).
- For e2e: **Cypress** and **Playwright** browsers (`npx playwright install chromium`).
- **Kubernetes 1.31 or newer** if you use a mode that routes through the gateway.
  Gateway API v1.5+ CRDs use CEL functions (`isIP`, `format.dns1123Label`) that older
  API servers cannot compile, and the bundle refuses to install anything older than
  v1.5.0 over itself. Check with `kubectl version`; on Docker Desktop this means
  keeping Docker Desktop reasonably current. Port mode (the default) needs none of
  this.

> Everything below also works on a real **k3s + MetalLB** cluster; only the overlay
> values differ (issuer, LoadBalancer addressing). The commands assume Docker
> Desktop.

---

## Cluster bootstrap (once per cluster)

The routing layer's prerequisites are **not** part of the Helm chart, which is what
keeps the implementation swappable: the chart names it only through
`gateway.className`. Install them once with the script pair in
[`bootstrap/`](./bootstrap):

```powershell
# Windows / Docker Desktop
./k8s/bootstrap/install.ps1 -Issuer selfsigned
```

```sh
# Linux / the VPS
./k8s/bootstrap/install.sh --ip <the machine's public address>
```

It installs, at pinned versions: the Gateway API CRDs (standard channel), MetalLB
and its pool on the VPS, Envoy Gateway with the EnvoyProxy `merged` and its `eg`
GatewayClass, cert-manager with its Gateway integration enabled, and locally the
`selfsigned` ClusterIssuer. A public cluster gets no ClusterIssuer: each unit chart
renders its own ACME `Issuer`. It is idempotent, and it prints the GatewayClass name
at the end because that value is what `gateway.className` must match.

**Only the gateway-routed modes need this.** `values.localhost.yaml` (port mode, the
default) sets `gateway.enabled: false` and stays the zero setup path.

---

## Log retention on your own cluster

The velista chart states in its privacy policy how long logs are kept
(`lunaShopperBackend.legal.applicationLogDays` and `assistantLogDays`, 30 and 7 by
default). Nothing in the chart can make that true, because container logs are not
in the cluster: they are the kubelet's files under `/var/log/pods` on each node.
Kubernetes bounds those files by size (10 MiB, five files) and by the life of the
pod. It never bounds them by age, so a database pod that runs for months keeps its
lines for months.

On a host that `bootstrap/provision-host.sh` set up, `nx-log-retention` does it
hourly (k8s plan 0018, [`README-new-cluster.md`](./README-new-cluster.md) section
10c). On any other cluster that is your job, before you publish the policy:

- Run [`bootstrap/log-retention.sh`](./bootstrap/log-retention.sh) as root on each
  node from a timer. It needs only bash, coreutils and gzip. Write its rules to
  `/etc/nx-log-retention.conf`, one `<namespace>/<container> <days>` per line;
  the comment at the top of the script explains them.
- Or, if you ship logs to an aggregator, set its retention to the same numbers,
  and bound the node files as above anyway, because they are still there.
- State the same numbers in the chart's `legal` values, so the policy says what
  your nodes do.

The chart's `lunaShopperBackend.assistant.logTurnText` is false by default, and
then the assistant logs no words of a conversation at all, only their lengths.

Managed Kubernetes keeps node logs under the provider's own policy; read it before
you state a number. The Docker Desktop path of
[`README-homelab.md`](./README-homelab.md) is a temporary bridge and is not
covered: Docker Desktop keeps container logs its own way.

---

## Local quickstart (port mode — the default)

Port mode exposes every app on its own `localhost:<port>`: shell on **80**, remotes
on **8082–8084**. No hosts-file edits, no admin, no reverse proxy.

The shell bakes its remote URLs at build time, so it is told where the remotes live
via `MFE_REMOTE_URLS` (a per-remote `name=url` map). The shell's own port is not baked
and can change freely.

```sh
# 1. The base image (dev-tagged). Build it first: the app images are FROM it.
npx nx run docker/local-http-server:build --configuration=development

# 2. The four app images, development configuration. Each build:docker runs the
#    app's `nx build` first (dependsOn), so MFE_REMOTE_URLS has to be set in the
#    shell that runs Nx. Only the shell bundle bakes it (the remotes ignore it).
export MFE_REMOTE_URLS="odontogram=http://localhost:8082,damoclesSword=http://localhost:8083,landingV2=http://localhost:8084"
npx nx run-many -t build:docker --configuration=development \
  --projects shell,odontogram,damoclesSword,landingV2

# 3. Deploy the portfolio unit.
helm dependency build --skip-refresh k8s/helm/portfolio
helm upgrade --install portfolio k8s/helm/portfolio \
  --namespace portfolio --create-namespace \
  --values k8s/helm/portfolio/values.yaml \
  --values k8s/helm/portfolio/values.localhost.yaml

# 4. Open the shell.
#    -> http://localhost
kubectl get pods -n portfolio
```

> Prefer the remote ports to line up with the dev-serve ports (shell 4200,
> odontogram 4202, damoclesSword 4203, landingV2 4204)? Then set those `lbPort`s in
> `values.localhost.yaml` and build the shell with **no** env. A development build's
> default string remotes already resolve to each remote's dev-serve port.
> `MFE_REMOTE_URLS` is only needed when the ports differ, as they do above.

**The local overlays deploy the portfolio unit only.** `values.localhost.yaml`,
`values.localhost-mfe.yaml` and `values.local.yaml` of `helm/portfolio` replace the
`apps` list with locally built images and empty `externalRoutes`, so a local
deployment has no velista and no `/velista` route on the portfolio host.

There is no build stage inside an app image (k8s plan 0007). `nx build` runs on the
host, and `build:docker` sets `"context": "dist"`, so the image only copies the
finished `dist/apps/<project>` bundle onto `local-http-server`. The first run takes as
long as the Angular builds, and later runs reuse the Nx cache. The `docker/builder`
image (the whole workspace after `npm ci`) is not part of this flow: no app image is
FROM it.

### Rebuilding after a code change

Rebuild the app image, then roll the deployment. `build:docker` runs `nx build` first,
so the bundle picks up the source change. The tag stays `dev`, so Kubernetes needs the
restart to use the new image:

```sh
npx nx run odontogram:build:docker --configuration=development
kubectl rollout restart deployment/odontogram -n portfolio
```

---

## Local modes

The shell bakes its remote URLs at build time, so **each mode needs the shell built a
particular way**. Pick one overlay:

| Overlay                               | Topology                                                                                   | Reach it at                  | Build the shell with                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------- |
| **`values.localhost.yaml`** (default) | each app its own LoadBalancer port (shell 80, remotes 8082–8084). **No bootstrap needed.** | `http://localhost`           | `MFE_REMOTE_URLS=odontogram=http://localhost:8082,…` |
| `values.localhost-mfe.yaml`           | one `localhost` host, remotes under `/mfe/<remote>`, through the gateway                   | `http://localhost`           | `MFE_BASE_URL=http://localhost/mfe`                  |
| `values.local.yaml`                   | `portfolio.localhost` / `mfe.localhost` hostnames (closest to production)                  | `http://portfolio.localhost` | `MFE_BASE_URL=http://mfe.localhost`                  |

The two gateway modes need [the bootstrap](#cluster-bootstrap-once-per-cluster) run
once, with `-Issuer selfsigned`. They no longer set a storage class for
certificates: certificates live in cert-manager issued Secrets rather than on a PVC,
so the local and production certificate paths are now the same objects and differ
only by the issuer name.

The shell resolves its remotes by build-time precedence: **`MFE_REMOTE_URLS`** (an
explicit per-remote `name=url` map, for distinct origins/ports) → **`MFE_BASE_URL`** (a
single host, remotes at `${base}/<remote>`) → default string remotes (each remote's
dev-serve port). Both env vars are read from the environment of the shell's
`nx build`, by `apps/shell/webpack.config.ts` (development) and
`apps/shell/webpack.prod.config.ts` (production), through the shared helpers in
`apps/shell/remote-urls.ts`. They are not Docker build args.

Why three? A locale-less deep link such as `/odontogram` must reach the **shell**
(where odontogram's locale guard inserts the locale, giving `/odontogram/en`), not the remote's blank entry page. In
production the shell and remotes live on separate hosts, so there is no clash. Port
mode reproduces that with separate ports; mfe-path reproduces it with a path prefix;
the hostnames overlay reproduces it literally but needs hosts-file entries:

```
# C:\Windows\System32\drivers\etc\hosts  (needs administrator)
127.0.0.1 portfolio.localhost mfe.localhost
```

> Chrome and Edge resolve `*.localhost` to loopback internally, so the hostnames mode
> may work in a browser with no hosts entry at all. The Windows resolver does not do
> this, so `curl`, Node, and Playwright still need the entries.

To switch modes, rebuild the shell with the matching env from the table's last column,
`helm upgrade` with the other overlay, then `kubectl rollout restart deployment/shell`.

---

## Running e2e against the local deployment

The e2e suites accept an `E2E_BASE_URL` that points them at an already-running
deployment (no dev server is started, self-signed TLS is accepted). Match it to the
mode you deployed:

```sh
# Port mode (default) — shell on 80:
export E2E_BASE_URL=http://localhost
# hostnames mode:
# export E2E_BASE_URL=http://portfolio.localhost

# Playwright remotes (run one browser project locally):
npx playwright test -c apps/damoclesSword-e2e/playwright.config.ts --project=chromium
npx playwright test -c apps/landing-v2-e2e/playwright.config.ts --project=chromium

# Cypress shell:
npx cypress run --project apps/shell-e2e --browser electron
```

> `odontogram-e2e` compiles again (its tsconfig pins `moduleResolution: node10`) and
> its specs drive the shell's `/odontogram` mount. CI still excludes it, because
> neither `shell:serve` nor `shell:serve-static` serves a history API fallback, so
> its deep links answer 404 there. See `apps/odontogram-e2e/cypress.config.ts`.

### e2e against the published images (what CI runs)

`k8s/e2e/portfolio-frontend/compose.yml` stands up the **published** images (default: the `staging` tag)
behind its own nginx on the staging hostnames, mirroring the Kubernetes topology,
so the exact shell image, which bakes the staging MFE host, is tested unchanged.
That stack is Docker Compose and deliberately keeps nginx: it exists to test the
**images**, not the cluster's routing layer. Its prefix handling must stay
equivalent to the `HTTPRoute`s, so changing one is a prompt to check the other.
It is the stack of the `portfolio-frontend` gate, which the portfolio pipeline
runs after pushing the staging images and before deploying, so a failure gates
the deploy. velista's own origin is the `velista-luna` gate's
(`e2e/velista-luna`). To run a gate yourself:

```sh
echo "127.0.0.1 staging.ichirokuxvi.com mfe.staging.ichirokuxvi.com" | sudo tee -a /etc/hosts
docker login ghcr.io                                   # only if a package is still private
bash k8s/e2e/portfolio-frontend/gate.sh damoclesSword-e2e
```

Override `E2E_IMAGE_PREFIX` / `E2E_IMAGE_TAG` to point at other images (e.g. a
release version instead of `staging`).

---

## Possible problems

- **The Docker Desktop cluster won't start at all** (HTTP 500, "Unable to start a
  cluster", and `kubectl` left with no context). On Windows this is almost always the
  WSL2 VM booting with cgroup v1 while the kind node image requires cgroup v2. Clearing
  images or resetting the cluster cannot fix it, because the fault is below Docker. See
  [`docker-desktop-kubernetes-wsl2.md`](./docker-desktop-kubernetes-wsl2.md).
- **`kubectl config current-context` is not `docker-desktop`.** The images live in the
  Docker Desktop image store; another cluster won't see them without a registry push.
- **A rebuilt image isn't picked up.** The tag stays `dev`, so `helm upgrade` alone
  won't restart a pod. `kubectl rollout restart deployment/<app>`.
- **A source change didn't show up in the container.** Check that the image was
  rebuilt through `build:docker` (which runs `nx build` first) and that the deployment
  was restarted. A change to `MFE_REMOTE_URLS` / `MFE_BASE_URL` needs the shell
  rebuilt with the new value in the environment of that `nx build`.
- **Nx returns a cached "success" but no image is built.** The docker build/push
  executor is marked non-cacheable in `nx.json` (`@portfolio/docker:build` →
  `cache: false`) precisely because a Docker image is a side effect Nx can't track. If
  you re-enable caching, pass `--skip-nx-cache`.
- **Port already in use (80 and 8082–8084 in port mode, or 80/443 for the other overlays).** Something
  else (a running `nx serve`, IIS, another service) holds the port. Stop it, or use a
  different overlay.
- **The Service to reach is not in the unit's namespace.** With merged gateways,
  Envoy Gateway provisions one data plane Deployment and Service for every Gateway
  of the class, named `envoy-eg-<hash>`, in the **`envoy-gateway-system`**
  namespace. No chart declares either object, and the name carries a hash, so look
  it up rather than memorise it:
  `kubectl get svc -n envoy-gateway-system -l gateway.envoyproxy.io/owning-gatewayclass=eg`.
- **LoadBalancer stuck `<pending>` / not reachable.** Docker Desktop publishes
  LoadBalancer services on `localhost` even while `EXTERNAL-IP` shows `<pending>`; just
  use `localhost`. No MetalLB runs locally. On the **public** cluster the same
  symptom is a real bug with a different cause: the pool that `install.sh --ip`
  applies must allow `envoy-gateway-system`, or the data plane Service never gets
  the address while every pod looks perfectly healthy.
- **`Gateway ... PROGRAMMED False` locally.** Expected on Docker Desktop when no
  address is assigned. Traffic still flows. Check the listeners instead, which do
  report `Programmed=True` and an `Attached Routes` count:
  `kubectl describe gateway portfolio -n portfolio`.
- **A route isn't serving.** Unlike Ingress, a route that fails to attach says so:
  `kubectl get httproute -n portfolio -o wide` and
  `kubectl describe gateway portfolio -n portfolio`.
- **Gateway API CRDs won't install.** They need Kubernetes 1.31+ (see Dependencies).
  On an older API server the CRDs fail to compile their CEL validation rules.
- **`kubectl port-forward` resets connections under load.** The unbundled `dev` remotes
  fire hundreds of chunk requests and overwhelm `port-forward`. Prefer the LoadBalancer
  (`localhost` directly); only fall back to `port-forward` if a port is unavailable.
- **Certificate warnings in the browser locally.** Expected. The local overlays issue
  from the `selfsigned` ClusterIssuer, since the hosts have no public DNS and ACME
  would only fail and burn rate limits. Check issuance with
  `kubectl get certificate -n portfolio`; `READY: True` is what matters.

---

## Operating the release

```sh
# Preview rendered manifests for a given mode
helm template portfolio k8s/helm/portfolio -n portfolio \
  --values k8s/helm/portfolio/values.yaml \
  --values k8s/helm/portfolio/values.localhost.yaml

# Inspect
kubectl -n portfolio get pods,svc
kubectl -n portfolio get gateway,httproute,certificate
kubectl -n envoy-gateway-system get svc        # the provisioned data plane

# Tear down (the chart only; the bootstrap stays)
helm uninstall portfolio -n portfolio
```
