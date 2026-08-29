# Docker & Kubernetes — Case Study (Infrastructure)

> Answers (`A:`) are written by Daniel. `> Note (Claude):` blocks flag things the
> code shows that an answer may have missed. This covers the whole build/deploy
> foundation: the custom Nx docker plugin, Dockerfiles, CI/CD, and k3s/Helm.

> **Superseded in places, as of 2026-08-29.** `k8s/plans/0007` changed the build
> topology: apps are compiled once, outside Docker, in a digest pinned `node:24`, the
> images are a base plus a `COPY` of the finished bundle, the executor pushes with
> `buildx --push` instead of `--load` plus `docker push`, and both workflows are split
> into per phase jobs. Answers and notes below that describe a build stage inside each
> image, `forwardEnv` carrying `MFE_BASE_URL`, or `--push` as a future improvement
> describe how it worked before that plan. They are left as written rather than
> rewritten, because they are a record of the reasoning at the time.

## The custom Nx docker plugin (`tools/docker`, `@portfolio/docker`)

**Q: Why write your own Nx docker plugin (build/push executors + generator) instead of an off-the-shelf one like `@nx-tools/nx-docker`?**
A: I actually noticed an Nx Docker plugin existed only after I had already started
writing my own, and I decided to keep going anyway. The main reason was that I wanted
to try building executors and a new type of app in Nx and learn how that works. Honestly
my executor ended up very similar to the Nx one, so beyond the freedom to add my own
features and the learning itself, I did not really gain extra functionality from rolling
my own.

> Note (Claude): The executor injects only two build args of its own (`NX_APP`,
> `TARGET_REGISTRY`) and forwards everything else the project asks for, so it stays close
> to a generic `buildx` wrapper. The parts that reach a little past a stock plugin today
> are the multi backend cache selection (`local` / `gha` / `registry`) and the version tag
> override via `DOCKER_IMAGE_TAG`.

**Q: The `build` executor shells out to `docker buildx build`. Walk through the main design choices: the local buildx cache keyed by a hash of the image name (and the "swap dance"), the mapped build contexts (`project` / `root` / `dockerfile`), and the `forwardEnv` refactor that made the executor stop knowing about `MFE_BASE_URL` and friends (it now injects only `NX_APP` / `TARGET_REGISTRY` itself).**
A: **The local cache and the "swap dance".** I do not fully remember the original
reason. My recollection is that it came from how I cached the buildx folder in GitHub
Actions during a deploy: build into a new folder, then move it into place once the build
succeeds.

**Going generic (`forwardEnv`).** Making the executor stop referencing project specific
build args was deliberate. I wanted the plugin to be reusable and not tied to portfolio
details, so the project lists the env var names it wants (`forwardEnv`) and the executor
forwards them without knowing what they mean.

> Note (Claude): On the swap dance, the recollection is of the old setup. Neither workflow
> uses it today: `docker-ci.yml` and `release.yml` both set `DOCKER_BUILD_CACHE=gha`, and
> the swap only runs on the `cacheType === 'local'` branch, so in CI the `type=gha` backend
> does all the caching (there is no `actions/cache` tarball for the buildx dir anymore, only
> for Nx / `node_modules`). The swap dance is still live for **local** `nx run <app>:build:docker`
> runs (default `cache=local`): it builds into `cacheNew`, then, only after a successful
> build, `fs.rename`s it over `cacheCurrent`. That avoids buildx's same directory read and
> write hazard and unbounded cache growth (the classic `mv .buildx-cache-new .buildx-cache`
> pattern from `docker/build-push-action`). So it is not dead code, but it is not what makes
> CI caching work.
>
> On the build contexts: `context` (`project` / `root` / `dockerfile`) selects the directory
> passed as the buildx context, so a Dockerfile can `COPY` from its own project dir, from the
> workspace root (needed by the builder, which bakes all project code), or from the Dockerfile's
> own folder. Default is `dockerfile`.
>
> On `forwardEnv`: confirmed by the code. The executor injects only `NX_APP` and
> `TARGET_REGISTRY`; every other build arg is either an explicit `buildArgs` entry in
> `project.json` or a name listed in `forwardEnv` that the executor copies from the
> environment when set (an explicit `buildArgs` of the same name wins). The shell's target
> uses `forwardEnv: ["BUILDER_TAG", "MFE_BASE_URL", "MFE_REMOTE_URLS"]`.

**Q: The `push` executor and `pushToRegistry` flow — how images get tagged and pushed, and how the registry is configured (`DOCKER_REGISTRY`, skip-login)?**
A: I added the push step inside build (and a build step inside push) because I wanted to
be able to build and push in one go without running two commands manually. To stop the
two from calling each other forever, I guard it with a condition: when build calls push it
passes `skipBuild`, and push only builds when that flag is not set, so there is no recursion.

> Note (Claude): Confirmed. `build` calls `push({ ...options, skipBuild: true })` only when
> `pushToRegistry` is set, and `push` rebuilds only when `skipBuild` is falsy (a standalone
> `nx run <app>:push`). Tagging: `versionTags` (or the `DOCKER_IMAGE_TAG` override) maps to
> `registry/imageName:tag`, lowercased, one `docker push` per tag. The registry comes from
> the `registry` option or `DOCKER_REGISTRY`; login uses `DOCKER_USERNAME` / `DOCKER_PASSWORD`
> via `--password-stdin`, unless `skipLogin` (or `DOCKER_SKIP_LOGIN=true`) is set. CI skips
> the login because `docker/login-action` already authenticated the runner.

**Q: The `application` generator scaffolds a Dockerfile into a new app. What does it set up and why have a generator for it?**
A: I have a bunch of docker apps, so the generator simply makes my life easier by giving
me all of the files I need when creating one. On the tags, I made the static versus dynamic
split to know which docker apps need a rebuild even when the docker app itself was not
modified, because it actually uses files from other projects. The builder docker image has
all the project code, so on every deploy it needs a rebuild (unless there is a better way to
do this without rebuilding, I am not sure). The other docker apps should be fine without a
rebuild unless their own files change.

> Note (Claude): TODO (Daniel): fix the generator so it aligns with the rest of the repo.
> Right now `applicationGenerator` emits `tags: ['type:docker']` and a `configurations.development.tag: 'dev'`
> option, but the executor no longer reads `tag` (it reads `versionTags`), and CI keys off
> `type:static-docker` / `type:dynamic-docker`, not `type:docker`. A freshly generated app
> would neither be picked up by the affected query nor tag its image, so the generator has
> drifted from the executor and CI.
>
> On avoiding the dynamic rebuild: the builder is the only `type:dynamic-docker` app, and
> because it bakes **all** project code it genuinely is affected by nearly every change, so
> "always rebuild" is correct and Nx `affected` cannot skip it. The lever is not skipping the
> rebuild but making it cheap: its expensive `npm ci` layer is already CACHED (the gha cache
> scope is keyed on the lockfile hash), so only the source `COPY` re-runs. The remaining cost
> is materializing the roughly 1 GB deps layer through `--load`; switching the executor to
> `buildx --push` (push cached layers straight to the registry) would avoid that. Nx
> `implicitDependencies` / explicit `inputs` would only help a dynamic-docker app that bakes a
> **subset** of other projects, since it could then be affected-tracked; that does not help the
> builder, whose subset is everything.

## Dockerfiles

**Q: How is an Angular app containerized (multi-stage build → static serve via nginx)? Walk through a per-app Dockerfile.**
A: Right now all the Angular apps share the same Dockerfile structure, but I keep a separate
Dockerfile per app because it might differ at some point, especially if I add apps that are
not Angular. The shape is a multi-stage build with the builder: build the app in the builder
stage, then copy the result into an nginx static serve image. I am serving statically through
nginx because it was the simplest and most common way I found to serve the app to the reverse
proxy. I have not researched http servers much beyond that.

> Note (Claude): Confirmed. Stage 1 is `FROM …/nx-portfolio/builder:${BUILDER_TAG}` and runs
> `npx nx build ${NX_APP} --configuration=${NODE_ENV}`. Stage 2 is
> `FROM …/nx-portfolio/local-http-server:${BUILDER_TAG}` and copies `/app/dist/apps/${NX_APP}`
> into `/var/www/html/`, then `CMD ["nginx", "-g", "daemon off;"]`. `BUILDER_TAG` selects the
> tag for both base images, so a dev build uses the `:dev` builder and server. The static nginx
> config (baked into `local-http-server`) does two things worth calling out for module
> federation: it adds `Access-Control-Allow-Origin: *` on static assets (the shell loads each
> remote's files cross origin) and declares the `.mjs` MIME type, plus the usual Angular SPA
> fallback (`try_files $uri $uri/ /index.html`).

**Q: The `type:static-docker` vs `type:dynamic-docker` tags — what's the distinction and how does CI use it?**
A: (Answered in the generator question above.) The split tells CI which docker apps need a
rebuild even when the app's own files were not modified, because they bake in files from other
projects. The builder is `dynamic-docker` (it has all the project code, so it rebuilds on every
deploy); the others are `static-docker` and only need a rebuild when their own files change.

> Note (Claude): In CI this maps to two paths. The builder (`type:dynamic-docker`) is built
> unconditionally at the top of every run; the `static-docker` apps (`certbot`, `reverse-proxy`,
> `local-http-server`) go through the normal Nx `affected` query and are built only when changed.
> See the generator answer for whether the builder rebuild can be made cheaper.

**Q: The `builder`, `reverse-proxy`, `certbot`, `local-http-server` docker apps — what does each do?**
A: **Builder** has all of the project code, compiles every app and can also run the tests. I
made it so I did not need to install packages and dependencies multiple times.

**Reverse proxy** is an nginx that redirects each request to the correct Angular app, since each
app has its own container with its own nginx. It is the piece that links all the apps in one
place, and it is configured from a Helm template so the routing is built dynamically from the
values set in Helm.

**Certbot** issues the TLS certificates and is wired together with the reverse proxy so they work
as a pair.

**Local http server** is the base for the static serve on the Angular apps. It is a small wrapper
around `nginx:latest` that clears the default html folder and swaps in the correct nginx config
for serving an Angular app.

> Note (Claude): Details behind each. **Builder** is a digest pinned `node:24`; it copies every
> `package*.json` first (`COPY --parents`, the `dockerfile:1-labs` syntax) and runs
> `npm ci --legacy-peer-deps` before `COPY . .`, so the expensive dependency layer is cached
> until the lockfile changes. It used to be the image every app build and the CI test step ran
> FROM. Since k8s/plans/0007 it is neither: the app images copy a bundle built outside them, and
> CI builds and tests inside a digest pinned upstream `node:24` instead, so nothing is FROM this
> image and neither workflow builds it. It survives for the local full stack (k8s/README.md). **Reverse-proxy**'s image is literally just `FROM nginx:latest`; it ships no
> config of its own, the routing comes entirely from the Helm template mounted at runtime.
> **Local-http-server** is `FROM nginx:latest`, `rm -rf` of the default html, and copies in
> `nginx-static-app.conf` (the CORS + `.mjs` + SPA-fallback config above). **Certbot** is the
> official `certbot/certbot` image plus `docker-cli`; `entrypoint.sh` requires a `DOMAINS` env
> and issues each cert with the webroot HTTP-01 challenge (`certbot certonly --webroot -w
/var/www/certbot`), retrying with backoff (five 3-minute retries, then every 15 minutes, cap 100) because ACME can fail transiently. It then enters a `certbot renew` loop every 12 hours.
> The key detail: certbot runs as a **sidecar in the same pod** as the reverse-proxy nginx, so
> it reloads nginx with `pkill -HUP nginx` and they share two volumes: `/var/www/certbot` (where
> nginx serves the ACME challenge) and `/certs` (where `deploy-hook.sh` copies `fullchain.pem` →
> `<domain>.crt` and `privkey.pem` → `<domain>.key` for nginx to read). The `docker-cli` in the
> image is for the local `compose.yml` path, where the reload goes through Docker instead of a
> shared process namespace.

## CI/CD (`.github/workflows/docker-ci.yml`)

**Q: The pipeline computes affected projects against the _last successful commit on the branch_ (via `gh run list`) rather than the previous commit. Why, and what problem did that solve?**
A: It is exactly that. Diffing only the previous commit has problems. A merge can bring in
multiple commits at once, and the previous commit might itself have been skipped because its
tests failed or it had compile errors. So the safest base is the last commit that actually
succeeded, which is the last one whose apps were really built and deployed.

> Note (Claude): Confirmed. The `last_success` step runs `gh run list` filtered to this
> workflow and branch, takes the first run with `conclusion == "success"`, and uses its
> `headSha` as the `--base` for every `nx affected` query. When there is no previous success
> (first run) it falls back to building everything, which is also how missing staging images
> get bootstrapped.

**Q: Why run tests _inside the builder docker image_ (`docker run … builder:latest npx nx run-many -t test`) rather than on the runner directly?**
A: Since the builder image is already built, I thought it was better to run the tests in a
controlled environment rather than a barebones runner. If I ever need specific configuration to
run the tests, I only have to tweak the builder, not the runner, and anyone who wants to run the
tests can do it with the builder.

> Note (Claude): Consistent with the build order: the builder is built at the top of the run,
> so by the test step the image already exists locally and `docker run …builder:latest` reuses
> it. The same image is the FROM base of every app build, so tests and builds share one toolchain
> definition.

**Q: Walk through the build order: main builder → affected static-docker apps → test → build:docker → deploy. Why that sequence?**
A: First the builder is needed, because it is the one that installs all the dependencies and
builds the other apps and the tests. After the builder it does not really matter whether the
static docker apps are built before or after; they are very quick and usually do not change.
Then the tests run before building the app images, because if the tests fail the build can be
skipped. The e2e has to go last because it needs all the other images built and running, and the
same goes for the Helm deploy, because it needs the images pushed to the registry.

> Note (Claude): Matches the workflow. One nuance on "tests before build lets the build be
> skipped": the steps run sequentially and a failed test step fails the job, so the later
> `build:docker` / e2e / deploy steps never run. The e2e stage additionally pulls the exact
> images that were just pushed (`docker compose … --pull always` against the `staging` tag), so
> it can only run after the push, and the Helm deploy runs only after e2e passes.

## Kubernetes / Helm deploy

**Q: You deploy to a k3s cluster via `helm upgrade` over SSH after rsync'ing `k8s/`. Why k3s + this rsync/SSH approach instead of GitOps (ArgoCD/Flux) or a managed cluster?**
A: I used SSH simply because it was the easiest thing to set up at the moment and I did not
have time for anything more complicated. For now it works, but I know it has to change for a
scalable solution.

**Q: How is the Helm chart structured (app deployment/service templates, the reverse-proxy templates, the LoadBalancer IP-address pool)?**
A: Production and staging are currently a bit nested, because staging is turned on with a
variable on the same machine as production. I might change that later, but it works for now.
Each app has its own deployment and service, so it is isolated.

> Note (Claude): The chart is data driven from the `apps` list in `values.yaml`. Each entry
> renders one Deployment and one Service (`templates/apps/*.tpl` `range` over the list), and the
> same list also feeds the reverse proxy's routing, the certbot `DOMAINS`, and the init
> container's dummy certs, so adding an app in one place wires it everywhere. Staging entries are
> gated by `staging.enabled` (`{{- if or (ne .env "staging") $.Values.staging.enabled }}`), so
> one release in one namespace holds both environments. The image tag is chosen per entry by
> `env`: production apps use `productionImageTag` (an immutable version, kept in
> `/root/helm-live/prod-tag.yaml` **outside** the rsynced chart and passed with a second `-f`, so
> staging deploys never disturb it and a rollback is just re-pinning an older version); staging
> apps use the mutable `stagingImageTag`. App Services are plain ClusterIP (the proxy fronts
> them); only the reverse-proxy Service is a `LoadBalancer`, and it is the sole consumer of the
> MetalLB `IPAddressPool` (`ipadd-pool.yaml.tpl`), a single `/32` for the bare-metal IP, scoped
> to the namespace and gated by `metallb.enabled`. The `lbPort` field on an app switches it to
> its own LoadBalancer for the local "port" mode.

**Q: TLS: how do the reverse-proxy + certbot pieces get and renew Let's Encrypt certs (the init-container certs, the deploy hook)?**
A: For nginx to start it needs either to drop the TLS config, which I do not want, or to have
some certs in place, so I use dummy certs so it can start without errors. The certs are stored in
a PVC so they are not generated more than once, and if they are not there the dummy ones are
generated. Certbot is sort of connected to the reverse proxy in that it tells the proxy to reload
when new certs are issued.

> Note (Claude): The flow across the two pieces. An alpine **init container** (`init-certs`)
> runs first and, for every host in `apps`, writes a self-signed `openssl` cert into the shared
> `/certs` PVC only if one is not already there, so nginx always has a `.crt`/`.key` to load and
> can start serving 443 before any real cert exists. The **certbot sidecar** (same pod, gated by
> `certbot.enabled`) then requests real Let's Encrypt certs over the webroot HTTP-01 challenge and
> its `deploy-hook.sh` overwrites the dummy files in `/certs` with the real `fullchain`/`privkey`,
> then reloads nginx. Three volumes make it work: `certs` (PVC, shared by init container, certbot,
> and nginx), `certbot-webroot` (emptyDir, where nginx serves `/.well-known/acme-challenge/`), and
> `letsencrypt-data` (PVC, so certbot's account and issued certs survive pod restarts and it does
> not re-request and burn rate limits). `shareProcessNamespace: true` is what lets certbot reload
> nginx with `pkill -HUP nginx`. Local deploys set `certbot.enabled: false` (no public DNS), so the
> dummy certs are the whole TLS story there.

**Q: How does the reverse-proxy route traffic to the shell + remotes, and how does that mirror the local `compose.yml` / reverse-proxy setup?**
A: Helm generates a dynamic `nginx.conf` with a proxy block for each app. The `compose.yml`
generates dummy certs for the staging domains and simply runs all the app images; it is used
solely for the e2e tests in GitHub Actions.

> Note (Claude): The generated config (`_nginx.conf.tpl`, rendered into a ConfigMap) groups the
> `apps` by `host` into one `server` block per host (listening on 80 and 443 with that host's
> cert), and inside each host a `location <path>` per app that `proxy_pass`es to
> `http://<app-name>:80` (the app's ClusterIP Service). For any non `/` path it rewrites the
> prefix off (`rewrite ^<path>/?(.*)$ /$1 break`) so the app sees a root relative URL, and it
> serves `/.well-known/acme-challenge/` from the webroot for certbot. A `checksum/config`
> annotation on the Deployment restarts the proxy only when the rendered config actually changes.
> `k8s/e2e/compose.yml` mirrors this topology with static files instead of templates: a `certs`
> init service (the same alpine + openssl dummy certs, for the two staging hosts), a bare
> `nginx:latest` reverse proxy mounting a hand written `k8s/e2e/nginx.conf`, and the five app
> images pulled at the `staging` tag. It exists so the e2e suite exercises the real published
> staging images through the same proxy shape the cluster uses, not a dev server.
