# Kubernetes / Helm

The Helm chart in [`helm/`](./helm) deploys the whole micro-frontend system — the
`shell` host plus the `landing`, `odontogram`, `damoclesSword`, `landingV2` remotes —
as one release. The same chart runs in three shapes:

| Environment | Driven by | Notes |
| --- | --- | --- |
| **Production** | `helm/values.yaml` | Public cluster (k3s + MetalLB), TLS via Let's Encrypt, host/path routing behind the reverse proxy. Deployed by CI. |
| **Staging** | `helm/values.yaml` (`staging.enabled`) | Same release/namespace, its own hostnames. |
| **Local** | `helm/values.yaml` + a `values.localhost*.yaml` overlay | Docker Desktop Kubernetes, locally built `:dev` images, no registry, no admin. |

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

> Everything below also works on a real **k3s + MetalLB** cluster; only the overlay
> values differ (storage class, LoadBalancer addressing). The commands assume Docker
> Desktop.

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
| **`values.localhost.yaml`** (default) | each app its own LoadBalancer port (shell 80, remotes 8081–8084) | `http://localhost` | `MFE_REMOTE_URLS=landing=http://localhost:8081,…` |
| `values.localhost-mfe.yaml` | one `localhost` host, remotes under `/mfe/<remote>`, behind the reverse proxy | `http://localhost` | `MFE_BASE_URL=http://localhost/mfe` |
| `values.local.yaml` | `portfolio.localhost` / `mfe.localhost` hostnames (closest to production) | `http://portfolio.localhost` | `MFE_BASE_URL=http://mfe.localhost` |

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
- **PVC stuck `Pending` / pod won't start (mfe-path & hostnames overlays).** The
  chart's default `certsVolume.storageClassName` is k3s's `local-path`; Docker Desktop
  uses `hostpath`. The local overlays already set `certsVolume.storageClassName:
  hostpath` — keep that if you copy them.
- **LoadBalancer stuck `<pending>` / not reachable.** Docker Desktop publishes
  LoadBalancer services on `localhost` even while `EXTERNAL-IP` shows `<pending>`; just
  use `localhost:<port>`. The MetalLB pool is disabled locally (`metallb.enabled:
  false`) because its public IP isn't routable on Docker Desktop.
- **`kubectl port-forward` resets connections under load.** The unbundled `dev` remotes
  fire hundreds of chunk requests and overwhelm `port-forward`. Prefer the LoadBalancer
  (`localhost` directly); only fall back to `port-forward` if a port is unavailable.
- **certbot noise.** Let's Encrypt is disabled locally (`certbot.enabled: false`) since
  the hosts have no public DNS; the init container's self-signed certs are enough for
  nginx to start in the overlays that keep the proxy.

---

## Operating the release

```sh
# Preview rendered manifests for a given mode
helm template nx-portfolio helm -n nx-portfolio \
  --values helm/values.yaml --values helm/values.localhost.yaml

# Inspect
kubectl -n nx-portfolio get pods,svc

# Tear down
helm uninstall nx-portfolio -n nx-portfolio
```
