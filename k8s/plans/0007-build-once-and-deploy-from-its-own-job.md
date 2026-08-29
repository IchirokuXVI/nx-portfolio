# 0007 Build once, in a pinned environment, and deploy from its own job

Staging takes about 24 minutes and production about 20. Almost none of it is work the pipeline
has to do.

Measured on a green 23m49s staging run, **11.2 minutes is compilation that should be about 4**,
because the shared libraries are rebuilt once per image instead of once, and **2m38s is spent
exporting and re-importing an image nothing reads from the local daemon**. Both workflows are
also a single job apiece, which means a deploy that fails on a dropped SSH connection can only be
retried by rebuilding and re-pushing all ten images first.

This plan rewrites **both** `.github/workflows/docker-ci.yml` (staging) and
`.github/workflows/release.yml` (production). They have the same faults and take the same
changes, and the parts that differ between them are exactly the parts that should differ:
affected versus everything, a mutable tag versus an immutable one, and which host is deployed to.

Three decisions frame everything below.

1. **Compilation moves out of the per image containers** and happens once, so the Nx cache can
   span every app.
2. **It happens inside a digest pinned upstream `node:24`**, so the build environment is
   reproducible without the repository having to build and publish an image of its own.
3. **Every phase becomes its own job**, so a failure is retried at the granularity of the thing
   that failed. The deploy in particular.

## 1. Where the time goes today

Everything in `docker-ci.yml` happens in a single `staging-deploy` job, in order, with each step
waiting on the one before it. These are measured numbers, from run
[33229050837](https://github.com/IchirokuXVI/nx-portfolio/actions/runs/33229050837), a green run
of 23m49s in which all ten apps were affected. That is the ordinary case here: anything touching a
shared library affects everything.

| #   | Step                                                                   | Measured | Share |
| --- | ---------------------------------------------------------------------- | -------- | ----- |
| 1   | Checkout, buildx, node, `npm install nx@…` (60s of it the npm install) | 1m25s    | 6%    |
| 2   | Build, `--load` and push the `builder` image                           | 4m43s    | 20%   |
| 3   | Seven `nx show projects` calls to compute affected                     | 13s      | 1%    |
| 4   | Build affected static docker apps                                      | 18s      | 1%    |
| 5   | `docker run builder … nx run-many -t test`                             | 3m40s    | 15%   |
| 6   | `nx run-many -t build:docker` over ten apps                            | 7m30s    | 31%   |
| 7   | Frontend e2e: browser installs, compose stack, five suites             | 3m56s    | 17%   |
| 8   | Luna tier 2 e2e                                                        | 51s      | 4%    |
| 9   | rsync, preflight, `helm upgrade --atomic`, rollout restart and status  | 50s      | 3%    |

Two estimates in an earlier draft of this plan were wrong and are recorded here as corrected.
**Computing affected costs 13 seconds, not the minute and a half guessed**, so collapsing the seven
graph boots is a legibility change and not a performance one. **The deploy costs 50 seconds**, so
the Helm rollout is not a floor worth designing around. Both corrections push effort toward steps
2, 5, 6 and 7, which are 83% of the run between them.

### 1.1 Where the builder image's 4m43s goes

From the buildx progress output in that run:

| Phase                                                          | Cost   |
| -------------------------------------------------------------- | ------ |
| buildx start, gha cache manifest, ~1.09 GB of cached layers    | ~1m40s |
| `--load`: `sending tarball` 65.7s, `importing to docker` 59.5s | 68s    |
| exporting the build cache back to gha                          | 11s    |
| `docker push` of `builder:latest`                              | 90s    |

**The `npm ci` layer was `CACHED`.** The lockfile scoped gha cache is working exactly as designed.
Almost none of this 4m43s is dependency installation; **2m38s of it, 56%, is moving the image
around rather than making it.**

### 1.2 Where the image step's 7m30s goes

The per project `nx build` timings, printed by Nx inside each image build:

| Project       | Build  | Project                       | Build |
| ------------- | ------ | ----------------------------- | ----- |
| odontogram    | 103.0s | luna-shopper-backend-auth     | 48.1s |
| damoclesSword | 95.9s  | luna-shopper-backend-catalog  | 46.6s |
| landingV2     | 95.3s  | luna-shopper-backend-gateway  | 32.8s |
| velista       | 94.2s  | luna-shopper-backend-core     | 30.3s |
| shell         | ~95s   | luna-shopper-backend-realtime | 30.2s |

**Roughly 11.2 minutes of compilation**, which Nx's default `--parallel=3` compresses into 7m30s of
wall time. Every Angular line reads "and 2 tasks it depends on" or "and 4 tasks it depends on":
those dependencies are the shared libraries, rebuilt once per image because each build happens in
its own container. On top of that the five Luna images spend another 76s between them on
`sending tarball` for `--load`.

### 1.3 Production

`release.yml` was not separately profiled, because it is the same steps in the same order with
`affected` removed. It builds the builder image, tests everything, and builds all ten app images,
so it pays section 1.1 in full and rather more than section 1.2. Its ~20 minutes are the same
~20 minutes.

## 2. The structural faults

### 2.1 Every image compiles the whole workspace from scratch

`apps/docker/builder/src/Dockerfile` bakes the workspace into an image:

```dockerfile
FROM node:22
WORKDIR /app
COPY --parents **/package*.json .
RUN npm ci --legacy-peer-deps
COPY . .
```

and every app image compiles itself inside a container built from it:

```dockerfile
FROM ${TARGET_REGISTRY}nx-portfolio/builder:${BUILDER_TAG} AS builder
RUN npx nx build ${NX_APP} --configuration=${NODE_ENV}

FROM ${TARGET_REGISTRY}nx-portfolio/local-http-server:${BUILDER_TAG}
COPY --from=builder /app/dist/apps/${NX_APP} /var/www/html/
```

Three things go wrong at once.

**The Nx cache cannot span the images.** Each `RUN npx nx build` runs in its own container with an
empty `.nx/cache`, so the shared libraries are compiled again for every app that consumes them.
This is the 11.2 minutes.

**The Docker layer cache cannot help either.** The `RUN npx nx build` layer sits on top of the
builder image, whose `COPY . .` layer changes on every commit by construction. The build layer is
therefore invalidated on every commit, always, even for an app whose sources did not change.

**And `DOCKER_BUILD_CACHE_MODE: min` discards it deliberately.** `min` exports only the final
image's layers, excluding the builder stage. The workflow comment is honest about why ("the
`nx build` re-runs every commit regardless"), and correct given the design. It is a symptom, not a
mistake.

### 2.2 Each workflow is a single job

Nothing in steps 5, 7 and 8 depends on the others. Unit tests do not need the e2e stack; the
frontend and Luna stacks are separate compose projects on separate ports and neither reads the
other's result. They run in series purely because they are steps in one job.

The split also removes an accidental dependency: unit tests run inside the builder image, so they
cannot start until it has been built, exported and pushed. There is no reason for them to be in a
container at all, and `pr.yml` already runs the same suites on the runner.

**And a single job cannot be partially retried.** This is the fault with the sharpest edge. The
staging deploy is steps 27 to 32 of one job, so a deploy that fails on a dropped SSH connection, a
transient DNS failure or a rollout that needed one more minute can only be retried by re-running
the whole job: rebuilding and re-pushing ten images, re-running every suite, roughly 23 minutes,
to retry an `ssh` command. Section 4.3 is about fixing this specifically.

### 2.3 `--load` plus a separate `docker push`

`tools/docker/src/executors/build/build.ts` always ends its buildx command with `--load`, and
`pushToRegistry` then invokes the push executor, which shells out to `docker push`.

With the `docker-container` driver that `setup-buildx-action` installs, `--load` exports the
finished image out of the builder and imports it into the local Docker daemon as a full tarball
round trip; `docker push` then reads it back out and uploads it. Nothing in either workflow
consumes an image from the local daemon: the app Dockerfiles resolve `FROM …/builder` from the
registry, and both e2e stacks pull from the registry.

`buildx --push` streams layers to the registry straight out of the build, skipping the export and
the import entirely. Measured, that is 68s on the builder image and 76s across the five Luna
images.

### 2.4 Nothing is cached between runs

`nx.json` sets `"neverConnectToCloud": true`, so there is no remote computation cache, and neither
workflow caches `.nx/cache`. Every lint, test and build in CI is cold, in both environments,
forever.

What is cached is worse than nothing:

```yaml
- name: Cache Nx
  uses: actions/cache@v4
  with:
    path: |
      node_modules
      ~/.npm
    key: nx-${{ runner.os }}-${{ env.NX_VERSION }}

- name: Install Nx
  run: npm install nx@$NX_VERSION
```

The key contains no lockfile hash, so it never changes when dependencies change, and the only
install performed is `nx` itself. Whatever `node_modules` a job ends up with is therefore whichever
tree happened to be saved under that key at some point in the past. The e2e steps later run
`npx playwright test` and `npx cypress run`, which need real workspace dependencies, and get them
by cache luck or an implicit `npx` download.

`actions/cache` on `.nx/cache` does not contradict `neverConnectToCloud`. It is a local cache
directory restored from GitHub's cache, not a connection to anything.

### 2.5 The builder image: keep the guarantee, drop the image

The builder image exists so an app is built the same way every time, independent of whichever
runner GitHub hands out. That is a correct thing to want, and the runner is a genuinely moving
target: GitHub rebuilds `ubuntu-latest` continuously and rolls major versions under the same label.

The question is not whether to keep the guarantee. It is whether **building an image of your own**
is the way to get it. It is not, and it turns out to be both the most expensive option and a
weaker guarantee than it looks.

**The pin is not as firm as it appears.** The Dockerfile says `FROM node:22`, a mutable tag. In the
measured run buildx resolved it to `node:22@sha256:8a34c4ab…` at build time, and nothing records
that digest. The next time a lockfile change invalidates the `npm ci` layer, a different `node:22`
can be resolved and nobody will notice. What exists today is not "always the same environment"; it
is "the same environment until dependencies next change".

**The expensive part is not the part that guarantees anything.** From 1.1, `npm ci` is already
`CACHED` and 2m38s of the 4m43s is tarball export, import and push. None of that contributes to
reproducibility. It is the cost of _distributing_ an image, paid on every push to main and every
release, for an image whose only CI consumer is the next step of the same job.

**A digest pinned upstream image gives more, for almost nothing.** Section 5 has the mechanics.
Point by point against what the builder image provides today:

- **Same Debian base, same glibc, same system libraries.** Identical, because it is the same
  upstream image.
- **`node_modules` produced by that same environment**, so native modules match what runs the
  build. Preserved, because `npm ci` runs in the container too.
- **Insulation from GitHub changing the runner image.** Preserved. The runner only starts
  containers; it compiles nothing.
- **Reproducibility over time.** _Improved._ A digest in a committed workflow file is explicit,
  reviewable, and changes only when a person changes it. `node:22` cannot make that claim.
- **Cost.** A pull rather than a build, export, import and push. 4m43s becomes tens of seconds.
- **The Nx cache.** _Newly possible._ Because the workspace is bind mounted rather than baked in,
  one `nx run-many` builds every app in one container sharing the library graph, and `.nx/cache`
  survives on the runner for `actions/cache` to save. This is section 1.2's 11.2 minutes, which the
  current design structurally cannot recover.

**What happens to the builder project.** It stays. `k8s/README.md` uses it for the local full
stack, and that is a real use. What stops is building and pushing it on every push to main and
every release. If it drifts behind the lockfile, a person refreshes it when they next want the
local full stack, which is exactly when they would notice.

**The middle option, for the record.** If a self built image were still wanted, the minimum repair
is to make it dependencies only, dropping `COPY . .`, and tag it by lockfile hash so it rebuilds
only when dependencies change. That removes most of the 4m43s but does **not** recover 1.2, because
each app would still compile in its own container with its own empty cache. Strictly worse than the
digest pin, strictly better than today. It is not what this plan does.

## 3. Smaller faults, worth fixing in the same pass

**Seven graph boots to compute affected.** `nx show projects` is called seven times and each call
constructs the project graph. Measured at 13 seconds in total, so this is a legibility change, not
a speed one. It earns its place because the job split needs those lists as job outputs anyway.

**Playwright and Cypress are installed twice, uncached.** `npx playwright install --with-deps
chromium` appears in both the frontend e2e step and the Luna tier 2 step, and `npx cypress install`
in the first. None of it is cached and `--with-deps` re-runs an `apt install` every time. `pr.yml`
already caches `~/.cache/ms-playwright` keyed on the resolved Playwright version.

**`fetch-depth: 0`** clones all history so Nx can diff against a SHA. Tens of seconds, listed for
completeness, not worth changing first.

**Unit tests run on main what `pr.yml` already ran on the PR**, and again in `release.yml` at the
release commit. Both workflows defend this deliberately in comments and this plan does not argue
with it. Restructured, the duplicate run is nearly free: it moves onto the runner, gets the Nx
cache, and sits in a parallel job off the critical path.

## 4. The shape both workflows should have

### 4.1 Staging

```
setup ──┬─> lint-test ──────────────────────────────┐
        │                                           │
        └─> build ──┬─> e2e-frontend ───────────────┼─> deploy
                    └─> e2e-luna ──────────────────┘
```

| Job            | Does                                                               | Skips when              |
| -------------- | ------------------------------------------------------------------ | ----------------------- |
| `setup`        | affected lists as job outputs                                      | never                   |
| `lint-test`    | `nx run-many -t lint test` over affected                           | nothing testable        |
| `build`        | bundles once in the pinned image, then ten `COPY` images, `--push` | nothing to build        |
| `e2e-frontend` | compose stack on the staging hostnames, affected suites            | no frontend suite       |
| `e2e-luna`     | tier 2 stack against the pushed images                             | no Luna image affected  |
| `deploy`       | rsync, preflight, `helm upgrade --atomic`, restart, rollout status | no staging host secrets |

### 4.2 Production

```
setup ──┬─> test ────┐
        └─> build ───┴─> deploy
```

Same jobs, three differences, all of them intentional and all of them pre-existing:

- **No `affected`.** `setup` resolves the release version and lists every project. A release builds
  everything at the release commit by design.
- **Immutable tags.** `DOCKER_IMAGE_TAG=<version>,latest` rather than `staging`, so `deploy`
  pins with `--set imageTag=<version>` and needs no `rollout restart`.
- **No e2e jobs.** `release.yml` has none today. This plan does not add them: production releases a
  commit that already passed staging, and adding a gate is a policy change rather than a speed one.
  Section 8 covers why that is nonetheless worth revisiting, and the job split makes adding one a
  small change rather than a rewrite.

### 4.3 Why the deploy is its own job

This is the requirement that most shapes the design, so it is worth being precise about what it
buys.

GitHub's **Re-run failed jobs** re-runs only the jobs that failed and the jobs that depend on them,
reusing the outputs of the jobs that succeeded. With the deploy as its own leaf job, a deploy that
fails is retried by itself, in about a minute, against the images that are already in the registry.
Today the same retry costs a full rebuild of ten images and every suite.

The failures this actually covers are the ordinary ones: a dropped SSH connection, a host that was
briefly unreachable, a `rollout status` that needed one more minute than its timeout allowed, a
preflight that failed because a Secret had not been created yet. None of them are reasons to
recompile anything.

For production it buys something further. **Re-running the deploy job is "deploy this exact version
again", with no rebuild**, which is the operation you most want to be cheap and boring on the
environment where things go wrong at the worst time.

Two requirements follow, and they are the whole cost of the feature:

- **The deploy job may only depend on job outputs**, never on another job's step outputs. So the
  affected deployment list (staging) and the resolved version (production) become outputs of
  `setup`, and the deploy job does its own `actions/checkout` for the chart it rsyncs.
- **The "is a host configured" gate becomes the deploy job's first step.** When the secrets are
  unset every later step skips and the job is green, which preserves today's behaviour exactly: the
  run stays green and the summary says plainly that it did not deploy.

The same reasoning makes `lint-test`, `e2e-frontend` and `e2e-luna` their own jobs. A flaky e2e
suite is re-run without rebuilding images, which is the second most common retry after the deploy.

### 4.4 The trap in `needs`: a skipped job skips its dependents

By default a job whose `needs` contains a **skipped** job is itself skipped. Since `e2e-frontend`
and `e2e-luna` skip whenever nothing relevant is affected, a plain `needs` list would silently skip
the deploy on exactly the commits that are cheapest to deploy.

The deploy job therefore needs an explicit condition:

```yaml
deploy:
  needs: [setup, lint-test, e2e-frontend, e2e-luna]
  if: >-
    !cancelled()
    && needs.lint-test.result != 'failure'
    && needs.e2e-frontend.result != 'failure'
    && needs.e2e-luna.result != 'failure'
```

`!cancelled()` rather than `always()`, deliberately: `always()` would deploy even when a person
cancelled the run, which is the one time you certainly do not want a deploy. Testing each result
against `'failure'` rather than for `'success'` is what lets `skipped` through.

This is the single most likely thing to get wrong in the split, and it fails in the quiet
direction, so it deserves a test: push a commit that touches only `README.md` and confirm the
deploy job still runs.

### 4.5 What the two workflows share

After the split the two files have a great deal in common, and the cure for that is one composite
action rather than a reusable workflow. `.github/actions/workspace/action.yml`:

```yaml
name: Workspace
description: Dependencies installed in the pinned build image, plus the Nx cache.
inputs:
  build-image:
    required: true
runs:
  using: composite
  steps:
    - uses: actions/cache@v4
      with:
        path: node_modules
        key: node-modules-${{ runner.os }}-${{ inputs.build-image }}-${{ hashFiles('package-lock.json') }}
    - uses: actions/cache@v4
      with:
        path: .nx/cache
        key: nx-cache-${{ runner.os }}-${{ github.sha }}
        restore-keys: nx-cache-${{ runner.os }}-
    - shell: bash
      run: |
        [ -d node_modules ] || docker run --rm -u "$(id -u):$(id -g)" \
          -v "$PWD":/w -w /w -e HOME=/tmp -e npm_config_cache=/w/.npm \
          "${{ inputs.build-image }}" npm ci --legacy-peer-deps
```

The `node_modules` key includes the build image, because that tree is produced by that image and
must not be reused across a Node bump. The `.nx/cache` key is per commit with a prefix
`restore-keys`, which is what makes it hit at all: an exact key never matches on a new commit, and
the prefix falls back to the most recent cache on the branch.

A full reusable workflow for the build job was considered and rejected: with two callers it costs
more indirection than it removes. Revisit it if the two build jobs start to drift.

## 5. The build environment: a digest pinned Node 24

### 5.1 Node 24 is supported

`@angular/core@21.2.6` and `@angular/build@21.2.6` both declare
`node: "^20.19.0 || ^22.12.0 || >=24.0.0"`. Nx 22.7.2 declares no constraint. Node 24 is in support
and is the version the toolchain expects to be current.

### 5.2 The form, and the permission trap in it

```yaml
env:
  # The one place the build environment is defined. Bump deliberately, in a commit.
  BUILD_IMAGE: node:24@sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2

steps:
  - run: |
      docker run --rm \
        -u "$(id -u):$(id -g)" \
        -v "$PWD":/w -w /w \
        -e CI=true -e HOME=/tmp -e npm_config_cache=/w/.npm \
        -e MFE_BASE_URL -e MFE_REMOTE_URLS -e LUNA_GATEWAY_URL -e LUNA_REALTIME_URL \
        "$BUILD_IMAGE" \
        npx nx run-many -t build prune --configuration production --projects "$APPS"
```

**`-u "$(id -u):$(id -g)"` is not optional.** Without it the container runs as root and everything
it writes, `node_modules`, `dist`, `.nx/cache`, is root owned on the runner. Every later step runs
as the `runner` user: `actions/cache` fails to save, buildx fails to read the context, artifact
upload fails. Some of those fail loudly and some do not, which is the worst combination.

**`-e HOME=/tmp` is the consequence of that.** With a uid that has no entry in the image's
`/etc/passwd`, npm has no home directory to resolve and falls over. Pointing `HOME` at `/tmp` and
`npm_config_cache` inside the workspace gives it somewhere writable. Add `.npm/` to `.gitignore`.

**`-e CI=true` because a container inherits nothing.** Actions sets `CI` on the runner, and Nx
reads it to decide not to start its file watching daemon. Inside the container that variable is
gone, so Nx would start a daemon in something about to be deleted. Every `docker run` in both
workflows passes it.

**`-t build prune`, not `-t build`.** `prune` exists only on the five Luna services and writes the
pruned manifest and lockfile beside the bundle, which their runtime install needs. Naming both
targets in the one invocation is a no-op for the projects that lack `prune`.

**The image builds that follow must pass `--exclude-task-dependencies`.** Without it, a cold Nx
cache lets `nx run-many -t build:docker` satisfy its own `dependsOn` by compiling the bundle right
there, on the runner, outside the pinned image, and nothing in the log says that is what happened.
The flag is what turns "we build in a container" from a convention into a property. It is a real
flag and it works: with it, Nx reports running `build:docker` alone, with no "and N tasks it
depends on".

**A job level `container:` would read better** and was considered. It makes running buildx in the
same job awkward, and it does not obviously keep the bind mounted `.nx/cache` that this design
depends on, so `docker run` wins on the thing that matters.

### 5.3 What the bump touches

`node:22` and `node-version: 22` appear in seven places that matter:

| File                                             | Today               | Becomes                            |
| ------------------------------------------------ | ------------------- | ---------------------------------- |
| `.github/workflows/docker-ci.yml`                | `node-version: 22`  | `BUILD_IMAGE`, digest pinned       |
| `.github/workflows/release.yml`                  | `node-version: 22`  | `BUILD_IMAGE`, digest pinned       |
| `.github/workflows/pr.yml` (two jobs)            | `node-version: 22`  | `node-version: 24`                 |
| `apps/luna-shopper-backend/*/src/Dockerfile` (5) | `FROM node:22-slim` | `FROM node:24-slim@sha256:ba849c…` |
| `apps/docker/builder/src/Dockerfile`             | `FROM node:22`      | `FROM node:24@sha256:be23f5…`      |
| `docker/prod/common/Dockerfile.builder`          | `FROM node:22`      | `FROM node:24`                     |

**`pr.yml` moves too, and in the same commit.** Leaving pull requests on Node 22 while main builds
on 24 means the gate that is supposed to keep main green is testing a different runtime from the
one that ships. It does not need the container treatment, because a PR check is not what produces a
deployed artifact, but it does need the same major version.

**The Luna runtime images move too.** Building a service on Node 24 and running it on `node:22-slim`
is a real mismatch, not a cosmetic one. Their runtime stage is the one place a digest pin costs
something worth noting: it freezes the base until a person bumps it, which means security patches
to the runtime image become a deliberate action. That is the intended trade, and section 5.4 is how
it gets made.

`apps/docker/CASE_STUDY.md` mentions `FROM node:22` in prose and should be corrected in the same
pass.

### 5.4 Bumping the digest

A pin nobody ever moves is a stale base image with known vulnerabilities. Resolve the current
digest with:

```sh
docker buildx imagetools inspect node:24 --format '{{println .Manifest.Digest}}'
```

and bump `BUILD_IMAGE` and the Dockerfile pins in one commit, letting the pipeline prove the new
environment before it reaches production. Node publishes patch releases roughly monthly. This is a
chore, and it is the chore being bought in exchange for the guarantee actually holding.

The digests recorded in this plan were resolved on 2026-08-29:

- `node:24` → `sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2`
- `node:24-slim` → `sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e`

They will be stale by the time this is built. Re-resolve rather than copying them.

## 6. Changes, in order

Each step is independently useful and independently revertable. Staging goes first at every step
and production follows once staging has run on it, which is the sequencing argued for in section 8.

### 6.1 Measure

Done, in section 1. Repeat after 6.3 and after 6.7, the two steps that move enough to change what
the ceiling is. The prediction worth checking is that the frontend e2e suite, 3m56s today and
untouched by this plan, becomes the largest single item in staging.

### 6.2 Pin the build environment and bump to Node 24

Add `BUILD_IMAGE` to both workflows, add the composite action from 4.5, and make the Node 24 edits
from 5.3 including `pr.yml` and the Luna runtime stages. Nothing else changes yet: the builder image
still exists and images still compile inside themselves. This lands the environment change on its
own so that if a bundle comes out different, the cause is unambiguous.

### 6.3 Build once, and reduce the images to a copy

The change with the widest blast radius. All ten Dockerfiles end their build stage by copying
exactly `dist/apps/${NX_APP}` and nothing else, which is what makes this mechanical.

Run one `nx run-many -t build` in the pinned container, then delete every builder stage. The
frontend family becomes:

```dockerfile
ARG BUILDER_TAG=latest
ARG TARGET_REGISTRY

FROM ${TARGET_REGISTRY}nx-portfolio/local-http-server:${BUILDER_TAG}
COPY . /var/www/html/
CMD ["nginx", "-g", "daemon off;"]
```

The build context has to move with the compilation. Every app target uses the executor's default
`context: "dockerfile"`, so the context is `apps/<app>/src` and `dist` is not in it. The obvious
repair is `context: "root"`, but that ships the workspace to the daemon ten times per run and hands
back much of the win. Point each image at its own output instead, by adding a `dist` value to the
`context` enum in `tools/docker/src/executors/build/schema.json`:

```ts
const mappedContexts = {
  project: projectRoot,
  root: context.root,
  dockerfile: path.dirname(dockerfile),
  dist: path.join(context.root, 'dist/apps', context.projectName),
} as const;
```

No per app path is needed, because the executor already knows the project name. The context becomes
a few megabytes of finished bundle. Add `"context": "dist"` to each app's `build:docker`.
`docker/builder` keeps `context: "root"` and is the one project that still wants a `.dockerignore`.

Then declare the dependency rather than relying on CI ordering, **in each app's own
`project.json`**:

```jsonc
// apps/<frontend>/project.json, in the build:docker target
"dependsOn": ["build"]
```

An earlier draft of this plan put that in `nx.json` `targetDefaults` under the key
`build:docker`, and it silently did nothing. **Nx reads a targetDefaults key containing a colon
as `plugin:executor`**, so `build:docker` was taken as executor `docker` from plugin `build`,
which matches no target in the workspace. `nx show project <app> --json` reported no `dependsOn`
at all, and the only symptom would have been an image built from a stale `dist`. Keying it by
executor is not the repair either: `docker/builder` and `docker/local-http-server` run that same
executor under a target literally named `build`, so an executor keyed default would make those
two depend on themselves. Ten explicit entries it is.

The five Luna services use `"dependsOn": ["prune"]` instead, because their image needs more than
the bundle. `prune` already depends on `build` and writes `package.json`, `package-lock.json` and
`workspace_modules` into the same `dist/apps/<project>` directory, which is what the runtime
stage's `npm ci --omit=dev` consumes. Depending on `build` alone produces an image that cannot
install its dependencies.

Two related traps, both found by building it:

**`nx run <project>:build:docker` is ambiguous** and does not mean what it looks like. `nx run`
parses `project:target:configuration`, so the second colon is read as a configuration name. Use
the `nx run-many -t build:docker --projects <app>` form, which is what CI uses and what these
target names require.

**`--graph=stdout` renders the task id with the target's `defaultConfiguration`**, not the one
that will actually run, so a `build:docker` task shows as `…:development` even under
`--configuration production`. It is a display artefact and nothing more: the executor logs its
resolved options, and those correctly show `pushToRegistry: true` and `versionTags: ['latest']`.
Do not go debugging a configuration bug that is not there.

One consequence to state plainly: **`MFE_BASE_URL`, `MFE_REMOTE_URLS`, `LUNA_GATEWAY_URL` and
`LUNA_REALTIME_URL` now go on the `nx build`**, because that is where webpack reads them.
`forwardEnv` for those four names stops doing anything and comes out of the app `project.json`
files. `BUILDER_TAG` stays, because it still selects the `local-http-server` base tag.

### 6.4 Push instead of load

In `tools/docker/src/executors/build/build.ts`, choose the output mode from the destination:

```ts
buildCommandArr.push(options.pushToRegistry ? '--push' : '--load');
```

and skip the separate `push` executor call when it pushed. Multi tag still works: buildx accepts
repeated `-t` with a single `--push`, which is what production's `<version>,latest` needs. `--load`
stays the default for local development, where an image in the local daemon is the point.

Worth doing even if nothing else here is: measured, 68s on the builder image and 76s across the
five Luna images, for one expression.

### 6.5 Take the builder image off the critical path

With 6.3 landed, nothing in either workflow is `FROM nx-portfolio/builder`, and the
`Build … docker builder` step and the `docker run builder … nx run-many -t test` step come out of
both files. That is section 1.1 in full, twice. The project stays for the local full stack; its
`production` configuration keeps `pushToRegistry` so a person can refresh it by hand.

### 6.6 One graph boot for the affected lists

Collapse the seven `nx show projects` calls into one `--affected --json` invocation plus `jq`, and
emit the lists as `setup` job outputs. `build_all` and the first run branch keep their meaning.
Production's `setup` does the same without `--affected`.

While in there: the Luna affected step exists only because `nx show projects` prints JSON when
stdout is not a TTY and lines when it is, and the workflow parses both shapes. Reading `--json`
everywhere retires that class of bug.

### 6.7 Split both workflows into jobs

Build the graphs from 4.1 and 4.2, with the deploy conditions from 4.4. Keep
`concurrency: staging-deploy` and `concurrency: production-release` with `cancel-in-progress:
false` at the workflow level: the serialisation guarantee is about the Helm release and must
survive the split.

### 6.8 Cache the browsers

`~/.cache/ms-playwright` keyed on the version from `require('@playwright/test/package.json')`,
`~/.cache/Cypress` keyed on the Cypress version, and `--with-deps` reduced to one system dependency
install per job. Copy the pattern from `pr.yml` rather than inventing a second one.

### 6.9 What implementation verified, and what it could not

Recorded here because the gap matters for reading the first real run.

Verified on a Windows workstation with Docker Desktop, at implementation time:

- **One `nx run-many -t build prune` builds all ten apps**, reporting "10 projects and 14 tasks
  they depend on". Fourteen, not ten times fourteen: the shared libraries are built once, which is
  the whole claim of section 2.1.
- **The four config values reach the bundles through the `nx build`**, not through docker build
  args. `mfe.staging.…` and `velista.staging.…` appear in the shell's `runtime.js` and manifests,
  and `api.staging.…` / `rt.staging.…` in velista's bundle.
- **All ten images build from a `dist` context**, and the build context transfer reads as 13.79 MB
  for an Angular app rather than the workspace.
- **A frontend image serves the app**: `docker run` on the landingV2 image answers 200 with the
  Angular document.
- **A Luna image runs on Node 24**: `node --version` reports v24.20.0 inside it, the pruned
  `package.json`, lockfile and `workspace_modules` are all present, and Nest bootstraps far enough
  to fail on missing runtime environment variables rather than on a module load or a native binary.
  That is the strongest signal available without the full stack.
- **The executor's unit tests cover both new behaviours**, `--push` when bound for a registry and
  the `dist` context, and the whole plugin suite passes.

**The near miss worth recording.** Rewriting the five Luna Dockerfiles from one template quietly
deleted a documented exception: `auth` uses `npm install --omit=dev`, not `npm ci`, because nx
22.7's `prune-lockfile` misplaces `entities@2.2.0` in the mailer's optional CSS inlining chain, and
`npm ci` refuses the resulting tree. The original file said so in a ten line comment. The image
build failed, and finding out why took a detour through the wrong hypothesis (that npm 11 was
stricter than npm 10, which an A/B against `node:22-slim` and `node:24-slim` disproved: both reject
it).

Two lessons, both of which generalise past this plan. **A file that looks like four identical
siblings and one odd one out is usually carrying a reason**, and rewriting from a template is how
that reason gets lost. **And the exception had been invisible in CI**, because the last run served
`auth`'s install layer from the build cache: the log reads `#11 CACHED` against a command
(`npm install`) that no longer matched what a fresh build would run. Layer caching had been hiding
whether that step still worked. The `dist` context and this plan's smaller images make that kind of
masking less likely, since there is far less left to cache.

Not verifiable off a Linux runner, and therefore the things to watch on the first run:

- **The `-u`/`HOME` container mechanics.** File ownership across a bind mount behaves differently
  on Windows, so the uid mapping in 5.2 is written from the known correct pattern rather than
  demonstrated here. If it is wrong the symptom is a cache that fails to save or a buildx context
  it cannot read, in the first job that runs.
- **Actual timings.** Every number in section 4 is still a projection.
- **The skipped-`needs` condition in 4.4.** It can only be exercised by a real commit that affects
  nothing, which is the test named in section 7.

## 7. What could go wrong

**A skipped job silently skips the deploy.** Section 4.4. The most likely mistake in the whole
plan, and it fails quietly. Test it with a commit that touches only `README.md`.

**Root owned files from the build container.** Section 5.2. Forgetting `-u` breaks cache saving and
context reads, sometimes loudly and sometimes not.

**A bundle built on Node 24 differs from one built on Node 22.** This is a real version bump, not
just a relocation, and it is why 6.2 lands alone. Build one app at the same commit on both and
compare `dist/apps/<app>`. Do it for `shell`, which bakes build time configuration, and for one Luna
service, which runs `nx prune`.

**The build context becomes the new bottleneck.** The reason 6.3 specifies a `dist` context rather
than `root`. Verify from the buildx log: the context transfer should read as megabytes per image,
not hundreds.

**An app needing something outside `dist/apps/<project>`.** None does today, established by
inspection of all ten Dockerfiles. A `dist` context makes that a constraint rather than a
coincidence; a future app wanting a config file beside its bundle must emit it into `dist` or accept
`root` and its cost.

**A red run makes the next run rebuild more.** The affected base is the last successful run's head
SHA, so a failed deploy leaves images pushed under `staging` that the next push rebuilds. Harmless,
and the deploy retry from 4.3 now makes it rarer rather than more common.

**Losing the pinned build environment.** Nothing is lost: 2.5 makes the pin stricter. What is gained
is a chore, 5.4, and a pin nobody moves is worse than a floating tag.

**A green pipeline that tested less than it used to.** Every suite that runs today still runs, on
the same commit, gating the same deploy. Confirm by listing the suites in a run before and after.
The split must change when things run, never whether they run.

## 8. What this does not change, and what it defers

**The deploy logic itself.** Both deploys keep exactly the behaviour `k8s/plans/0003` gave them:
staging preflights, runs `helm upgrade --install --atomic --timeout 10m`, then `rollout restart` for
the affected deployments and a separate `rollout status` loop; production runs
`k8s/helm/deploy-release.sh <version>`, which uses `--wait` rather than `--atomic` for the reasons
argued in that script. They move into their own jobs unchanged.

**The affected base** stays "the head SHA of the last successful run of this workflow on this
branch", and `workflow_dispatch` with `build_all` still rebuilds everything.

**Production still has no e2e.** Deferred, not dismissed. The argument for leaving it is that every
commit in a release already passed staging's suites. The argument against is that production images
are not the images staging tested: the shell and velista bake different URLs, so the artifact that
reaches production is genuinely untested as an artifact. That is a real gap and a policy decision
rather than a performance one, which is why it is not bundled into a plan about speed. The job split
in 4.2 makes adding an `e2e` job between `build` and `deploy` a small change when that decision is
made.

**Staging leads production through every step of section 6.** Staging exists to absorb this kind of
change, and a pipeline rewrite finds its problems in the second week rather than the first run.
Production deploys on a published release, which is rare enough that 20 minutes costs little and a
broken deploy path costs a lot. Land each step on staging, let it run for a few ordinary pushes,
then port it. The Dockerfile, executor and Node changes in 6.2, 6.3 and 6.4 are shared the moment
they land, so what is left to port each time is only the workflow file.
