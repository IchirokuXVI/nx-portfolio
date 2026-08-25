# Kubernetes / Helm

The Helm chart in [`helm/`](./helm) deploys the whole micro-frontend system — the
`shell` host plus the `landing`, `odontogram`, `damoclesSword`, `landingV2` remotes —
as one release. The same chart runs in three shapes:

| Environment | Driven by | Notes |
| --- | --- | --- |
| **Production** | `helm/values.yaml` | Public cluster (k3s + MetalLB), TLS via Let's Encrypt, host/path routing through the Gateway API. Deployed by CI. |
| **Staging** | `helm/values.yaml` (`staging.enabled`) | Same release/namespace, its own hostnames. |
| **Local** | `helm/values.yaml` + a `values.localhost*.yaml` overlay | Docker Desktop Kubernetes, locally built `:dev` images, no registry, no admin. |

Routing is the Kubernetes **Gateway API**, served by **Envoy Gateway**, with
**cert-manager** issuing the certificates. The chart declares only `Gateway` and
`HTTPRoute` objects; the data plane is provisioned by the implementation. See
[`plans/0001-gateway-api-migration.md`](./plans/0001-gateway-api-migration.md).

This document is about running the stack **locally end to end** (build every image
from scratch, deploy, and run e2e against the real containers). For the production
CI/CD pipeline and the chart internals see the [root README](../README.md).

---

## Dependencies

- **Docker** with the **Kubernetes** feature enabled (Docker Desktop). The cluster
  must be running and `kubectl config current-context` should be `docker-desktop`.
  Because Docker Desktop's Kubernetes shares the Docker image store, locally built
  images are visible to the cluster with no registry push.
- **Docker Buildx** (bundled with Docker Desktop) — the build executor uses
  `docker buildx build --load`.
- **Helm** 3.x and **kubectl**.
- **Node 22** and the workspace dependencies installed (`npm ci --legacy-peer-deps`).
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
./k8s/bootstrap/install.sh --issuer letsencrypt --email you@example.com
```

It installs, at pinned versions: the Gateway API CRDs (standard channel), Envoy
Gateway, its `eg` GatewayClass, cert-manager with its Gateway integration enabled,
and a `ClusterIssuer` (`selfsigned` or `letsencrypt-prod`). It is idempotent, and it
prints the GatewayClass name at the end because that value is what
`gateway.className` must match.

**Only the gateway-routed modes need this.** `values.localhost.yaml` (port mode, the
default) sets `gateway.enabled: false` and stays the zero setup path.

---

## Local quickstart (port mode — the default)

Port mode exposes every app on its own `localhost:<port>`: shell on **80**, remotes
on **8081–8084**. No hosts-file edits, no admin, no reverse proxy.

The shell bakes its remote URLs at build time, so it is told where the remotes live
via `MFE_REMOTE_URLS` (a per-remote `name=url` map). The shell's own port is not baked
and can change freely.

```sh
# 1. Base images (dev-tagged). Build these first: the app images build FROM them.
npx nx run docker/builder:build --configuration=development
npx nx run docker/local-http-server:build --configuration=development

# 2. The five app images, development configuration. MFE_REMOTE_URLS is baked into
#    the shell only (the remotes ignore it).
export MFE_REMOTE_URLS="landing=http://localhost:8081,odontogram=http://localhost:8082,damoclesSword=http://localhost:8083,landingV2=http://localhost:8084"
npx nx run-many -t build:docker --configuration=development \
  --projects shell,landing,odontogram,damoclesSword,landingV2

# 3. Deploy.
helm upgrade --install nx-portfolio helm \
  --namespace nx-portfolio --create-namespace \
  --values helm/values.yaml --values helm/values.localhost.yaml

# 4. Open the shell.
#    -> http://localhost
kubectl get pods -n nx-portfolio
```

> Prefer the remote ports to line up with the dev-serve ports (shell 4200, remotes
> 4201–4204)? Then set those `lbPort`s in `values.localhost.yaml` and build the shell
> with **no** env — a development build's default string remotes already resolve to
> `http://localhost:4201..4204`. `MFE_REMOTE_URLS` is only needed when the ports
> differ, as they do above.

The app images build inside `builder:dev` (which runs `npm ci` for the whole
monorepo), so the first run takes a while; later runs reuse the Buildx layer cache.

### Rebuilding after a code change

The app images build `FROM builder:dev`, which froze a copy of the repo (`COPY . .`)
when it was built. So a source change is **not** picked up by rebuilding the app image
alone — refresh `builder:dev` first, then rebuild the app image, then roll the
deployment (the tag stays `dev`, so Kubernetes needs the restart to re-pull):

```sh
npx nx run docker/builder:build --configuration=development   # refresh the frozen source
npx nx run odontogram:build:docker --configuration=development
kubectl rollout restart deployment/odontogram -n nx-portfolio
```

`builder:dev`'s `npm ci` layer is cached (unless `package*.json` changed), so the
refresh is mostly just re-copying the working tree.

---

## Local modes

The shell bakes its remote URLs at build time, so **each mode needs the shell built a
particular way**. Pick one overlay:

| Overlay | Topology | Reach it at | Build the shell with |
| --- | --- | --- | --- |
| **`values.localhost.yaml`** (default) | each app its own LoadBalancer port (shell 80, remotes 8081–8084). **No bootstrap needed.** | `http://localhost` | `MFE_REMOTE_URLS=landing=http://localhost:8081,…` |
| `values.localhost-mfe.yaml` | one `localhost` host, remotes under `/mfe/<remote>`, through the gateway | `http://localhost` | `MFE_BASE_URL=http://localhost/mfe` |
| `values.local.yaml` | `portfolio.localhost` / `mfe.localhost` hostnames (closest to production) | `http://portfolio.localhost` | `MFE_BASE_URL=http://mfe.localhost` |

The two gateway modes need [the bootstrap](#cluster-bootstrap-once-per-cluster) run
once, with `-Issuer selfsigned`. They no longer set a storage class for
certificates: certificates live in cert-manager issued Secrets rather than on a PVC,
so the local and production certificate paths are now the same objects and differ
only by the issuer name.

The shell resolves its remotes by build-time precedence: **`MFE_REMOTE_URLS`** (an
explicit per-remote `name=url` map, for distinct origins/ports) → **`MFE_BASE_URL`** (a
single host, remotes at `${base}/<remote>`) → default string remotes (each remote's
dev-serve port). Both env vars are plumbed through the docker `build` executor into
the shell Dockerfile.

Why three? A locale-less deep link such as `/odontogram` must reach the **shell**
(which redirects to `/en/odontogram`), not the remote's blank entry page. In
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

> `landing-e2e` and `odontogram-e2e` currently fail to compile (`TS5095`: their
> tsconfig sets `module: commonjs` under the workspace's `moduleResolution: bundler`)
> and their specs predate the through-shell routing. That is a pre-existing issue,
> unrelated to the deployment.

### e2e against the published images (what CI runs)

`e2e/compose.yml` stands up the **published** images (default: the `staging` tag)
behind its own nginx on the staging hostnames, mirroring the Kubernetes topology,
so the exact shell image, which bakes the staging MFE host, is tested unchanged.
That stack is Docker Compose and deliberately keeps nginx: it exists to test the
**images**, not the cluster's routing layer. Its prefix stripping must stay
equivalent to the `HTTPRoute` filters, so changing one is a prompt to check the other.
CI runs this after pushing the staging images and before deploying, so a failure
gates the deploy. To run it yourself:

```sh
echo "127.0.0.1 staging.ichirokuxvi.com mfe.staging.ichirokuxvi.com" | sudo tee -a /etc/hosts
docker login ghcr.io                                   # the images are private
docker compose -f e2e/compose.yml up -d --pull always
E2E_BASE_URL=https://staging.ichirokuxvi.com \
  npx playwright test -c apps/damoclesSword-e2e/playwright.config.ts --project=chromium
docker compose -f e2e/compose.yml down -v
```

Override `E2E_IMAGE_PREFIX` / `E2E_IMAGE_TAG` to point at other images (e.g. a
release version instead of `staging`).

---

## Possible problems

- **`kubectl config current-context` is not `docker-desktop`.** The images live in the
  Docker Desktop image store; another cluster won't see them without a registry push.
- **A rebuilt image isn't picked up.** The tag stays `dev`, so `helm upgrade` alone
  won't restart a pod. `kubectl rollout restart deployment/<app>`.
- **A source change didn't show up in the container.** The app images build `FROM
  builder:dev`, which froze the repo at its own build time. Rebuild `builder:dev`
  before the app image (see "Rebuilding after a code change"). This also applies to
  `MFE_REMOTE_URLS` / `MFE_BASE_URL` behavior changes in `apps/shell/webpack.config.ts`.
- **Nx returns a cached "success" but no image is built.** The docker build/push
  executor is marked non-cacheable in `nx.json` (`@portfolio/docker:build` →
  `cache: false`) precisely because a Docker image is a side effect Nx can't track. If
  you re-enable caching, pass `--skip-nx-cache`.
- **Port already in use (4200–4204, or 80/443 for the other overlays).** Something
  else (a running `nx serve`, IIS, another service) holds the port. Stop it, or use a
  different overlay.
- **The Service to reach is not in `nx-portfolio`.** Envoy Gateway provisions a data
  plane Deployment and Service *for* the Gateway, named
  `envoy-nx-portfolio-portfolio-<hash>`, in the **`envoy-gateway-system`** namespace.
  Neither object is declared by this chart, and the name carries a hash, so look it up
  rather than memorise it: `kubectl get svc -n envoy-gateway-system`.
- **LoadBalancer stuck `<pending>` / not reachable.** Docker Desktop publishes
  LoadBalancer services on `localhost` even while `EXTERNAL-IP` shows `<pending>`; just
  use `localhost`. The MetalLB pool is disabled locally (`metallb.enabled: false`)
  because its public IP isn't routable on Docker Desktop. On the **public** cluster the
  same symptom is a real bug with a different cause: the pool must list
  `envoy-gateway-system` in `metallb.serviceNamespaces`, or the data plane Service
  never gets the address while `kubectl get svc -n nx-portfolio` looks perfectly
  healthy.
- **`Gateway ... PROGRAMMED False` locally.** Expected on Docker Desktop: the only
  failing condition is "No addresses have been assigned", because no MetalLB pool is
  active. Traffic still flows. Check the listeners instead, which do report
  `Programmed=True` and an `Attached Routes` count:
  `kubectl describe gateway portfolio -n nx-portfolio`.
- **A route isn't serving.** Unlike Ingress, a route that fails to attach says so:
  `kubectl get httproute -n nx-portfolio -o wide` and
  `kubectl describe gateway portfolio -n nx-portfolio`.
- **Gateway API CRDs won't install.** They need Kubernetes 1.31+ (see Dependencies).
  On an older API server the CRDs fail to compile their CEL validation rules.
- **`kubectl port-forward` resets connections under load.** The unbundled `dev` remotes
  fire hundreds of chunk requests and overwhelm `port-forward`. Prefer the LoadBalancer
  (`localhost` directly); only fall back to `port-forward` if a port is unavailable.
- **Certificate warnings in the browser locally.** Expected. The local overlays issue
  from the `selfsigned` ClusterIssuer, since the hosts have no public DNS and ACME
  would only fail and burn rate limits. Check issuance with
  `kubectl get certificate -n nx-portfolio`; `READY: True` is what matters.

---

## Operating the release

```sh
# Preview rendered manifests for a given mode
helm template nx-portfolio helm -n nx-portfolio \
  --values helm/values.yaml --values helm/values.localhost.yaml

# Inspect
kubectl -n nx-portfolio get pods,svc
kubectl -n nx-portfolio get gateway,httproute,certificate
kubectl -n envoy-gateway-system get svc        # the provisioned data plane

# Tear down (the chart only; the bootstrap stays)
helm uninstall nx-portfolio -n nx-portfolio
```
