# nx-portfolio

A personal portfolio built as an **Angular module-federation micro-frontend system** inside an [Nx](https://nx.dev) monorepo, shipped with a custom Nx Docker build/push toolchain and deployed to a **k3s** cluster via **Helm**.

- **`shell`** — host application. Owns the router and lazy-loads the remotes at runtime.
- **`odontogram`, `damoclesSword`, `landingV2`, `velista`** — remote micro-frontends, each exposing its routes via `./Routes` (module federation). They render **only through the shell**: a remote served on its own port shows a blank page (see note below).
- **`apps/docker/*`** — non-Angular Nx "app" projects that wrap a Dockerfile (`builder`, `reverse-proxy`, `certbot`, `local-http-server`).
- **`tools/docker`** — custom Nx plugin (`@portfolio/docker`) providing the `build`/`push` executors behind every `build:docker` target.
- **`libs/<scope>/*`** — libraries grouped by scope (`shared`, `damoclesSword`, `odontogram`, `landing-v2`, `velista`).
- **`k8s/`** — Kubernetes manifests + the Helm chart deployed by CI.

For architecture and coding conventions see [`CLAUDE.md`](./CLAUDE.md).

## Local development

Everything runs through Nx (`npx nx ...`); there are no top-level npm scripts.

```sh
npx nx serve shell           # host + its dev remotes (odontogram, landingV2)
npx nx serve damoclesSword   # a single remote standalone
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

---

## Deployment / CI/CD

Three GitHub Actions workflows, one per boundary:

| Workflow | Trigger | Does |
| --- | --- | --- |
| **`pr.yml`** | PR into `main` or `dev` | lint + unit-test the affected projects (against the PR's target branch). Fast pre-merge feedback. |
| **`docker-ci.yml`** | push to `main` | unit-test affected, build + push affected staging images, e2e them (`k8s/e2e/portfolio-frontend/compose.yml`), deploy staging. |
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
  ├─ Build & push affected Angular apps           (nx run-many -t build:docker)
  ├─ e2e the staging images                       (k8s/e2e/portfolio-frontend/compose.yml — gates the deploy)
  └─ Deploy: rsync k8s/ to the host + `helm upgrade`
```

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

- Registry: **`ghcr.io/ichirokuxvi`** (env `DOCKER_REGISTRY`). Images are named `nx-portfolio/<app>` and tagged `latest` in the `production` configuration.
- The workflow logs in with `docker/login-action` using the built-in `GITHUB_TOKEN`, so the executor is told to skip its own login via `DOCKER_SKIP_LOGIN=true`.
- `push` only happens for targets whose `production` configuration sets `pushToRegistry: true` (see each app's `project.json`).
- Tests run _inside_ `ghcr.io/<repo-lowercase>/builder:latest` — the builder image is rebuilt first so tests use the current toolchain.

### Deploy step (SSH → Helm)

After images are pushed, the workflow ships the manifests and upgrades the release on the cluster host over SSH:

```sh
rsync -avz --delete ./k8s/ $SSH_DEPLOY_USER@$SSH_DEPLOY_HOST:~/k8s/
ssh $SSH_DEPLOY_USER@$SSH_DEPLOY_HOST <<'EOF'
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  helm upgrade nx-portfolio ./k8s/helm -n nx-portfolio
EOF
```

Because image tags are pinned to `latest`, `helm upgrade` alone wouldn't restart pods that already run `latest`. Each Deployment template carries a `rollme: {{ randAlphaNum 8 }}` annotation, so every `helm upgrade` changes the pod template and forces a fresh pull + rollout.

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
2. Add it to `k8s/helm/values.yaml` under `apps` (`name`, `image`, `host`, `path`).

---

## Kubernetes / Helm

> **Running the whole stack locally** (build every image from scratch on Docker
> Desktop Kubernetes and run e2e against the real containers) is documented in
> [`k8s/README.md`](./k8s/README.md), including the port / mfe-path / hostnames local
> modes and common pitfalls. The rest of this section covers the production chart.

The cluster is **k3s** (single node) with **MetalLB** for `LoadBalancer` services and the built-in **`local-path`** storage class for volumes. Everything lives in the **`nx-portfolio`** namespace.

- `k8s/namespace.yaml` — the namespace (applied out of band; not part of the chart).
- `k8s/helm/` — the chart (`Chart.yaml`, `values.yaml`, `templates/`) that CI upgrades.

### What the chart renders (`k8s/helm/values.yaml` drives everything)

**One Deployment + Service per app** (`templates/apps/*`), generated by ranging over `values.apps`:

- Deployment: 1 replica, container port `80`, small CPU/memory requests+limits, `imagePullPolicy: Always`, and the `rollme` annotation described above.
- Service: `ClusterIP` on port `80` — only the reverse proxy is exposed externally.

**A reverse-proxy pod** (`templates/reverse-proxy/*`) that is the single public entrypoint:

- **`reverse-proxy` service** — type `LoadBalancer`, ports `80`/`443`. MetalLB assigns it the fixed IP from `values.ipAddress` (`46.62.204.230`), pinned via an `IPAddressPool` + `L2Advertisement` (`templates/ipadd-pool.yaml.tpl`).
- **nginx container** — config is generated from `values.apps` into a ConfigMap (`_nginx.conf.tpl`): one `server` block per unique `host`, and within it a `location <path>` per app that `proxy_pass`es to `http://<app>:80` (rewriting the path prefix away for non-`/` paths).
- **certbot sidecar** — obtains/renews Let's Encrypt certificates for the unique set of `host`s (passed in via the `DOMAINS` env var). `shareProcessNamespace: true` lets it reload nginx after a renewal.
- **`init-certs` init container** — generates self-signed _dummy_ certs for every host on first boot so nginx can start (and serve the ACME HTTP-01 challenge) before real certificates exist.
- **Volumes:** `certs-pvc` (shared cert dir, `ReadWriteOnce`, `local-path`), `letsencrypt-pvc` (Let's Encrypt state, so certs survive pod restarts), and an `emptyDir` webroot for the ACME challenge.

### Routing / hosts

From `values.apps`:

| App             | Host                  | Path             |
| --------------- | --------------------- | ---------------- |
| `shell`         | `ichirokuxvi.com`     | `/`              |
| `odontogram`    | `mfe.ichirokuxvi.com` | `/odontogram`    |
| `damoclessword` | `mfe.ichirokuxvi.com` | `/damoclesSword` |
| `landingv2`     | `mfe.ichirokuxvi.com` | `/landingV2`     |
| `velista`       | `mfe.ichirokuxvi.com` | `/velista`       |

DNS for both hosts must point at `46.62.204.230`.

### Operating the release manually

Run from the cluster host (or anywhere with `KUBECONFIG` pointed at the k3s config):

```sh
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# Preview rendered manifests without applying
helm template nx-portfolio ./k8s/helm -n nx-portfolio

# Install / upgrade (what CI runs)
helm upgrade --install nx-portfolio ./k8s/helm -n nx-portfolio

# Inspect
kubectl -n nx-portfolio get pods,svc
kubectl -n nx-portfolio logs deploy/reverse-proxy -c certbot   # cert issuance/renewal
```

> The namespace itself and MetalLB must exist before the first install. `kubectl apply -f k8s/namespace.yaml` creates the namespace; MetalLB is a cluster prerequisite (the chart only declares the address pool, not the controller).
