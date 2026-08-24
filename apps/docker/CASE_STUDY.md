# Docker & Kubernetes — Case Study (Infrastructure)

> Answers (`A:`) are written by Daniel. `> Note (Claude):` blocks flag things the
> code shows that an answer may have missed. This covers the whole build/deploy
> foundation: the custom Nx docker plugin, Dockerfiles, CI/CD, and k3s/Helm.

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
A: **The local cache and the "swap dance"** — I do not fully remember the original
reason. My recollection is that it came from how I cached the buildx folder in GitHub
Actions during a deploy: build into a new folder, then move it into place once the build
succeeds.

**Going generic (`forwardEnv`)** — making the executor stop referencing project specific
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
A:

**Q: The `type:static-docker` vs `type:dynamic-docker` tags — what's the distinction and how does CI use it?**
A:

**Q: The `builder`, `reverse-proxy`, `certbot`, `local-http-server` docker apps — what does each do?**
A:

## CI/CD (`.github/workflows/docker-ci.yml`)

**Q: The pipeline computes affected projects against the *last successful commit on the branch* (via `gh run list`) rather than the previous commit. Why, and what problem did that solve?**
A:

**Q: Why run tests *inside the builder docker image* (`docker run … builder:latest npx nx run-many -t test`) rather than on the runner directly?**
A:

**Q: Walk through the build order: main builder → affected static-docker apps → test → build:docker → deploy. Why that sequence?**
A:

## Kubernetes / Helm deploy

**Q: You deploy to a k3s cluster via `helm upgrade` over SSH after rsync'ing `k8s/`. Why k3s + this rsync/SSH approach instead of GitOps (ArgoCD/Flux) or a managed cluster?**
A:

**Q: How is the Helm chart structured (app deployment/service templates, the reverse-proxy templates, the LoadBalancer IP-address pool)?**
A:

**Q: TLS: how do the reverse-proxy + certbot pieces get and renew Let's Encrypt certs (the init-container certs, the deploy hook)?**
A:

**Q: How does the reverse-proxy route traffic to the shell + remotes, and how does that mirror the local `compose.yml` / reverse-proxy setup?**
A:
