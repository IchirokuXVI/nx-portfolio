# 0007 Build once and run in parallel

The staging pipeline takes about 24 minutes and the release pipeline about 20. Almost none of
that is work the pipeline has to do. It is one job running every step in a line, compiling the
same workspace ten separate times inside ten separate containers, with no cache surviving
between runs.

Measured on a green 23m49s run, **11.2 minutes of that is compilation that should be about 4**,
because the shared libraries are rebuilt once per image rather than once, and **2m38s is spent
exporting and re-importing an image nothing reads from the local daemon**. Section 1 has the
numbers; section 2.5 answers the question they raise, which is whether the builder image that
causes most of this is worth what it costs.

This plan restructures `.github/workflows/docker-ci.yml`. `release.yml` has the same shape and
the same faults; it gets the same treatment once staging has proved the design, and section 8
says why it is deliberately second rather than done in the same pass.

## 1. Where the time goes today

Everything below happens in a single `staging-deploy` job, in this order, with each step waiting
on the one before it. These are measured numbers, from run
[33229050837](https://github.com/IchirokuXVI/nx-portfolio/actions/runs/33229050837), a green run
of 23m49s. All ten apps were affected, which is the ordinary case here: anything touching a
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

Two estimates in an earlier draft of this plan were wrong and are worth recording as fixed.
**Computing affected costs 13 seconds, not the minute and a half guessed**, so collapsing the
seven graph boots is a tidiness change and not a performance one. **The deploy costs 50 seconds**,
so the Helm rollout is not a floor worth designing around. Both corrections move effort toward
steps 2, 5, 6 and 7, which are 83% of the run between them.

### 1.1 Where the builder image's 4m43s goes

From the buildx progress output in that run:

| Phase                                                          | Cost   |
| -------------------------------------------------------------- | ------ |
| buildx start, gha cache manifest, ~1.09 GB of cached layers    | ~1m40s |
| `--load`: `sending tarball` 65.7s, `importing to docker` 59.5s | 68s    |
| exporting the build cache back to gha                          | 11s    |
| `docker push` of `builder:latest`                              | 90s    |

**The `npm ci` layer was `CACHED`.** The lockfile scoped gha cache is working exactly as
designed. Nearly none of this 4m43s is dependency installation; **2m38s of it, 56%, is moving
the image around rather than making it**, and most of that is avoidable outright (section 2.3).

### 1.2 Where the image step's 7m30s goes

The per project `nx build` timings, printed by Nx inside each image build:

| Project       | Build  | Project                       | Build |
| ------------- | ------ | ----------------------------- | ----- |
| odontogram    | 103.0s | luna-shopper-backend-auth     | 48.1s |
| damoclesSword | 95.9s  | luna-shopper-backend-catalog  | 46.6s |
| landingV2     | 95.3s  | luna-shopper-backend-gateway  | 32.8s |
| velista       | 94.2s  | luna-shopper-backend-core     | 30.3s |
| shell         | ~95s   | luna-shopper-backend-realtime | 30.2s |

That is **roughly 11.2 minutes of compilation**, which Nx's default `--parallel=3` compresses into
7m30s of wall time. Every Angular line reads "and 2 tasks it depends on" or "and 4 tasks it
depends on": those dependencies are the shared libraries, and they are rebuilt once per image
because each build happens in its own container. On top of that, the five Luna images spend
another 76s between them on `sending tarball` for `--load`.

This is section 2.1 measured. The compilation is real work; doing it ten times is not.

## 2. The structural faults

### 2.1 Every image compiles the whole workspace from scratch

This is the largest one by a wide margin, and it is the reason step 5 dominates.

`apps/docker/builder/src/Dockerfile` is the whole workspace baked into an image:

```dockerfile
FROM node:22
WORKDIR /app
COPY --parents **/package*.json .
RUN npm ci --legacy-peer-deps
COPY . .
```

and every app image then compiles itself inside a container built from it:

```dockerfile
FROM ${TARGET_REGISTRY}nx-portfolio/builder:${BUILDER_TAG} AS builder
RUN npx nx build ${NX_APP} --configuration=${NODE_ENV}

FROM ${TARGET_REGISTRY}nx-portfolio/local-http-server:${BUILDER_TAG}
COPY --from=builder /app/dist/apps/${NX_APP} /var/www/html/
```

Three separate things go wrong here at once.

**The Nx cache cannot span the images.** Each `RUN npx nx build` happens in its own container
with an empty `.nx/cache`, so the shared libraries under `libs/shared` are compiled again for
every app that consumes them. Ten images means the shared graph is built ten times. Nx exists
to not do that, and the containerisation is what stops it.

**The Docker layer cache cannot help either.** The `RUN npx nx build` layer sits directly on
top of the builder image, and the builder image's `COPY . .` layer changes on every commit by
construction. So the build layer is invalidated on every commit, always, even for an app whose
sources did not change. `affected` narrows which images are attempted, but for every image
that is attempted the cache is guaranteed cold.

**And `DOCKER_BUILD_CACHE_MODE: min` discards it on purpose.** `min` exports only the final
image's layers, which excludes the builder stage entirely. The comment in the workflow is
honest about the reasoning ("the `nx build` re-runs every commit regardless, so caching it
buys little"), and it is correct given the design. It is a symptom of the design, not a
mistake within it.

The fix is to stop compiling inside Docker. **Build the bundles once on the runner with a
single Nx invocation, then let each Dockerfile do nothing but copy the finished directory.**
Both Dockerfile families already end by copying exactly `dist/apps/<project>` out of the build
stage and nothing else, so the runtime stages need no change at all. One `nx run-many -t build`
shares the library graph across every affected app and can be cached between runs, and the ten
image builds collapse into ten `COPY` operations that take seconds each.

### 2.2 Everything is one job

GitHub will run these in parallel for free and the workflow asks for none of it. Nothing in
steps 4, 6 and 7 depends on the others: unit tests do not need the e2e stack, the frontend e2e
stack and the Luna stack are separate compose projects on separate ports, and neither reads
the other's result. They run one after another purely because they are steps in one job.

Splitting into jobs also removes an accidental dependency: unit tests currently run inside the
builder image, so they cannot start until the builder image has been built, loaded and pushed.
There is no reason for the tests to be in a container at all. `pr.yml` already runs the same
suites directly on the runner.

### 2.3 The builder image pays for every byte twice, on the critical path

`tools/docker/src/executors/build/build.ts` always ends its buildx command with `--load`:

```ts
buildCommandArr.push(contextDir);
buildCommandArr.push('--load');
```

and `pushToRegistry` then invokes the push executor, which shells out to `docker push`.

With the `docker-container` driver that `setup-buildx-action` installs, `--load` exports the
finished image out of the builder and imports it into the local Docker daemon, as a full
tarball round trip. `docker push` then reads it back out of the daemon and uploads it. For the
builder image, which is `node:22` plus a complete `node_modules` plus the entire repository,
that is a multi gigabyte export and re-import that buys nothing: nothing in CI consumes the
image from the local daemon. The app Dockerfiles resolve `FROM …/builder` from the registry,
and both e2e stacks pull from the registry.

`buildx --push` streams layers to the registry straight out of the build, skipping the export
and the import, and overlaps the upload with the remaining build steps. This lever is already
known and was never pulled.

The builder image also blocks the entire pipeline while it is built and pushed, because
everything downstream is `FROM` it. Under section 2.1 it stops being an input to CI at all.

### 2.4 Nothing is cached between runs

`nx.json` sets `"neverConnectToCloud": true`, so there is no remote computation cache, and the
workflow never caches `.nx/cache` either. Every lint, test and build in CI is cold, forever.

What the workflow does cache is worse than nothing:

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
install performed is `nx` itself. Whatever `node_modules` a job ends up with is therefore
whichever tree happened to be saved under that key at some point in the past. The e2e steps
later run `npx playwright test` and `npx cypress run`, which need real workspace dependencies,
and get them by cache luck or by an implicit `npx` download. `pr.yml` does this correctly with
`setup-node`'s `cache: npm` plus `npm ci`, and this workflow should match it.

`actions/cache` on `.nx/cache`, keyed on the commit with a `restore-keys` prefix, gives cross
run reuse without contradicting `neverConnectToCloud`. It is a local cache directory restored
from GitHub's cache, not a connection to anything.

### 2.5 The builder image: keep the guarantee, drop the image

The builder image exists for a good reason, and this plan does not want to give that reason up.
It is there so an app is built the same way every time, independent of whichever runner and
whichever environment GitHub hands out. That is a correct thing to want, and the runner is
genuinely a moving target: GitHub rebuilds `ubuntu-latest` continuously and rolls major versions
under the same label.

The question is not whether to keep the guarantee. It is whether **building an image of your own**
is the way to get it. It is not, and it turns out to be both the most expensive option and a
weaker guarantee than it looks.

**The pin is not as firm as it appears.** The Dockerfile says `FROM node:22`, which is a mutable
tag. In the measured run, buildx resolved it to `node:22@sha256:8a34c4ab…`, at build time. Nothing
records that digest, so the next time the `npm ci` layer is invalidated by a lockfile change, a
different `node:22` can be resolved and nobody will notice. What exists today is not "always the
same environment"; it is "the same environment until dependencies next change", which is a
weaker property than the design intends.

**The expensive part is not the part that guarantees anything.** From section 1.1, `npm ci` is
already `CACHED`, and 2m38s of the 4m43s is tarball export, import and push. None of that
contributes to reproducibility. It is the cost of _distributing_ an image, paid on every push to
main, for an image whose only CI consumer is the next step of the same job.

**A digest pinned upstream image gives more, for almost nothing.** Pin `node:22` by digest in the
workflow and run the build inside it:

```yaml
env:
  # The one place the build environment is defined. Bump deliberately, in a commit.
  BUILD_IMAGE: node:22@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d

steps:
  - run: docker run --rm -v "$PWD":/w -w /w "$BUILD_IMAGE" npm ci --legacy-peer-deps
  - run: |
      docker run --rm -v "$PWD":/w -w /w \
        -e MFE_BASE_URL -e MFE_REMOTE_URLS -e LUNA_GATEWAY_URL -e LUNA_REALTIME_URL \
        "$BUILD_IMAGE" npx nx run-many -t build --configuration production --projects "$APPS"
```

Compare that against what the builder image provides today, point by point.

- **Same Debian base, same glibc, same system libraries.** Identical, because it is the same
  upstream image.
- **`node_modules` produced by that same environment**, so native modules match what runs the
  build. Preserved, because `npm ci` runs in the container too.
- **Insulation from GitHub changing the runner image.** Preserved. The runner only starts
  containers; it does not compile anything.
- **Reproducibility over time.** _Improved._ A digest in a committed workflow file is explicit,
  reviewable, and changes only when a person changes it. Today's `node:22` cannot make that
  claim.
- **Cost.** A pull of `node:22` rather than a build, export, import and push. Roughly 4m43s
  becomes tens of seconds.
- **The Nx cache.** _Newly possible._ Because the workspace is bind mounted rather than baked in,
  one `nx run-many` builds all ten apps in one container, sharing the library graph, and
  `.nx/cache` survives on the runner to be saved by `actions/cache`. This is the 11.2 minutes of
  duplicated compilation from section 1.2, and the current design structurally cannot recover it.

A job level `container:` would also work and reads more cleanly, but it makes running buildx in
the same job awkward, and the `docker run` form keeps the bind mounted `.nx/cache` that matters
most here.

**What happens to the builder project.** It stays. `k8s/README.md` uses it for the local full
stack, and that is a real use with no deadline attached to it. What stops is building and pushing
it on every push to main. If it drifts behind the lockfile, a person refreshes it when they next
want the local full stack, which is exactly when they would notice.

**The middle option, for the record.** If a self built image is still wanted, the minimum repair
is to make it dependencies only, dropping `COPY . .`, and tag it by lockfile hash so it is
rebuilt only when dependencies actually change rather than on every commit. That removes most of
the 4m43s. It does **not** recover section 1.2's duplicated compilation, because each app would
still compile in its own container with its own empty Nx cache. It is strictly worse than the
digest pin and strictly better than today.

## 3. Smaller faults, worth fixing in the same pass

**Seven graph boots to compute affected.** The `Get affected apps` and `Get affected e2e`
steps call `nx show projects` seven times, and each call constructs the project graph. One
`nx show projects --affected --json` plus filtering in `jq` gives the same six lists from one
boot. Measured at 13 seconds in total, so this is a legibility change, not a speed one. It earns
its place only because the split in 5.8 needs those lists as job outputs anyway.

**Playwright and Cypress are installed twice, uncached.** `npx playwright install --with-deps
chromium` appears in both the frontend e2e step and the Luna tier 2 step, and `npx cypress
install` in the first. None of it is cached, and `--with-deps` re-runs an `apt install` every
time. `pr.yml` already caches `~/.cache/ms-playwright` keyed on the resolved Playwright
version; do the same here, add `~/.cache/Cypress`, and drop `--with-deps` to a one time
system dependency install.

**`--pull always` re-downloads unaffected images.** The frontend e2e stack pulls every image
at the `staging` tag on every run, including the ones this run did not rebuild. That is the
intended semantics (test the combination about to be deployed), so it stays, but it belongs in
a job that runs in parallel with something rather than in the middle of a line.

**`fetch-depth: 0`** clones all history to let Nx diff against a SHA. It is tens of seconds
rather than minutes, so it is listed for completeness and not worth changing first.

**Unit tests run on main what `pr.yml` already ran on the PR.** The comment defends this
deliberately, and this plan does not argue with it. Restructured, the duplicate run costs
almost nothing: it moves onto the runner, gets the Nx cache, and sits in a parallel job off the
critical path. Keeping a gate that is nearly free is the right trade.

## 4. The shape it should have

```
setup ──┬─> lint + test ───────────────────────┐
        │                                      │
        └─> build bundles + push images ──┬─> e2e frontend ──┼─> deploy
                                          └─> e2e luna ──────┘
```

Four observations about this graph.

**`build bundles + push images` is one job, not a matrix.** Once the images are `FROM nginx` plus
a `COPY`, a ten way matrix would spend more time on ten checkouts and ten dependency installs
than it saves on the builds. One job that runs `nx run-many -t build` and then `nx run-many -t
build:docker` is both faster and simpler. If measurement later shows the image phase is still
material, a matrix is an easy follow up, and splitting the bundle build out as an artifact is
what makes it possible.

**The two e2e jobs are genuinely independent.** Today they cost 3m56s and 51s in series; in
parallel they cost 3m56s.

**`lint + test` hangs off `setup` alone**, not off the build, because nothing about a unit test
needs an image. It gates the deploy and otherwise stays out of the way. Today it costs 3m40s on
the critical path; here it costs nothing, because it finishes well inside the build job.

**The deploy needs all three**, which is the existing guarantee: a red suite means the mutable
`staging` tag is not rolled out.

Against the measured run, the critical path becomes roughly:

| Job              | Estimate | Reasoning                                                     |
| ---------------- | -------- | ------------------------------------------------------------- |
| setup            | ~1m      | `npm ci` with the npm cache, one graph boot                   |
| build and push   | ~4m cold | one `nx run-many` over ten apps, then ten `COPY` image builds |
| e2e (the slower) | ~4m      | unchanged by this plan                                        |
| deploy           | ~50s     | unchanged, measured                                           |

That is **about 10 minutes cold**, against 23m49s measured today. The build job is the only
estimate with real uncertainty: 11.2 minutes of compilation with the shared libraries built once
instead of ten times, and running at the runner's full parallelism rather than `--parallel=3`,
should land near 4 minutes, and much less whenever the Nx cache hits. **The frontend e2e suite
then becomes the largest single item in the pipeline**, which is the right problem to have next
and is not addressed here.

## 5. Changes, in order

Each step is independently useful and independently revertable. The order is chosen so that
the two largest wins land first and so nothing depends on a later step.

### 5.1 Measure

Done, in section 1, against run 33229050837. Repeat it after 5.3 and after 5.8, because those
are the two steps that move enough to change what the ceiling is. The prediction worth checking
is that the frontend e2e suite (3m56s today, and untouched by any of this) becomes the largest
single item once compilation stops being one.

### 5.2 Pin the build environment by digest, and build once

This is 2.5 and 2.1 landing together, because they are the same edit: the moment compilation
moves out of the per image containers it has to happen somewhere, and that somewhere should be a
digest pinned `node:22` rather than the runner's bare filesystem.

Add `BUILD_IMAGE` to the workflow env as a digest pinned `node:22`, run `npm ci` and one
`nx run-many -t build` inside it over a bind mounted workspace, and keep `.nx/cache` on the
runner where `actions/cache` can save it (5.5). The reproducibility argument and the point by
point comparison against today's builder image are in 2.5.

### 5.3 Reduce the images to a copy

The other half of 5.2, and together with it the change with the widest blast radius, so the two
land together and alone. Once the bundles exist on the runner, the images have nothing left to
compile.

All ten Dockerfiles end their build stage by copying exactly `dist/apps/${NX_APP}` and nothing
else, which is what makes this a mechanical change rather than a redesign.

The build context has to move with the compilation. Today every app target uses the executor's
default `context: "dockerfile"`, so the context is `apps/<app>/src`, and `dist` is not in it at
all. The obvious repair is `context: "root"`, but that ships the entire workspace to the daemon
ten times per run and would hand back much of what this step wins.

Point each image at its own build output instead. Add a `dist` value to the `context` enum in
`tools/docker/src/executors/build/schema.json`, mapped in the executor beside the three that
already exist:

```ts
const mappedContexts = {
  project: projectRoot,
  root: context.root,
  dockerfile: path.dirname(dockerfile),
  dist: path.join(context.root, 'dist/apps', context.projectName),
} as const;
```

No per app path is needed, because the executor already knows the project name. The context is
then a few megabytes of finished bundle, the Dockerfile copies all of it, and the frontend
family reduces to:

```dockerfile
ARG BUILDER_TAG=latest
ARG TARGET_REGISTRY

FROM ${TARGET_REGISTRY}nx-portfolio/local-http-server:${BUILDER_TAG}
COPY . /var/www/html/
CMD ["nginx", "-g", "daemon off;"]
```

with `"context": "dist"` added to each app's `build:docker` options. The Luna family keeps only
its runtime stage, copying `.` and running the same `npm ci --omit=dev` against the pruned
lockfile that `nx prune` already writes into that directory.

`docker/builder` keeps `context: "root"`, since the whole workspace is the point of that image,
and it is the one project that still wants a `.dockerignore` excluding `node_modules`, `.git`,
`.nx` and `dist`.

Then make the bundle a declared dependency rather than a thing CI remembers to do first:

```jsonc
// nx.json, targetDefaults
"build:docker": {
  "dependsOn": ["build"]
}
```

Keyed on the target name and not on the executor, deliberately. `docker/builder` and
`docker/local-http-server` use the same executor under a target literally named `build`, and an
executor keyed default would make those two depend on themselves.

The five Luna services override that default with `"dependsOn": ["prune"]` in their own
`build:docker`, because their image needs more than the bundle. `prune` already depends on
`build` and writes `package.json`, `package-lock.json` and `workspace_modules` into the same
`dist/apps/<project>` directory, which is exactly what the runtime stage's `npm ci --omit=dev`
consumes. Depending on `build` alone would produce an image that cannot install its
dependencies.

This keeps local development working the same way it reads: `nx run shell:build:docker` still
produces an image from a clean checkout, it just builds the bundle on the host first, with the
Nx cache, instead of inside a container without one. `docker/full-stack` and the flows in
`k8s/README.md` inherit that unchanged.

Two consequences to state plainly. **`MFE_BASE_URL`, `MFE_REMOTE_URLS`, `LUNA_GATEWAY_URL` and
`LUNA_REALTIME_URL` now have to be set on the `nx build` rather than forwarded as build args**,
because that is where webpack reads them; `forwardEnv` for those names stops doing anything and
comes out of the app `project.json` files. **And the build environment changes** from the pinned
`node:22` image to the runner's `setup-node` plus `npm ci --legacy-peer-deps` from the same
lockfile. That is the environment `pr.yml` has always built and tested in, so it is not new
ground, but it is the thing to look at first if a bundle comes out different.

### 5.4 Push instead of load

In `tools/docker/src/executors/build/build.ts`, choose the output mode from whether the image
is going to a registry:

```ts
buildCommandArr.push(options.pushToRegistry ? '--push' : '--load');
```

and, when it pushed, skip the separate `push` executor call rather than running `docker push`
over an image the daemon no longer needs to hold. Multi tag still works: buildx accepts
repeated `-t` with a single `--push`.

`--load` stays the default for local development, where the point is to end up with an image in
the local daemon.

This one is worth doing even if nothing else in this plan is. Measured, it removes 68s from the
builder image alone and another 76s spread across the five Luna images, for a change of one
expression.

### 5.5 Take the builder image off the critical path

With 5.2 and 5.3 landed, nothing in CI is `FROM nx-portfolio/builder`, and the `Build main docker
builder` step and the `docker run builder … nx run-many -t test` step both come out of the
workflow. That is the 4m43s from section 1.1, in full. The project itself stays, because
`k8s/README.md` uses it for the local full stack; 2.5 covers what is and is not given up by no
longer publishing it on every push.

Its `production` configuration keeps `pushToRegistry`, so a person can still refresh the
published image by hand when the local full stack needs it. It is simply no longer something
every push to main pays for.

### 5.6 Fix the dependency install and cache the Nx cache

Replace the `Cache Nx` and `Install Nx` pair with the same shape `pr.yml` uses:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm
- run: npm ci --legacy-peer-deps
```

and add, in every job that runs an Nx target:

```yaml
- uses: actions/cache@v4
  with:
    path: .nx/cache
    key: nx-${{ runner.os }}-${{ github.sha }}
    restore-keys: nx-${{ runner.os }}-
```

`restore-keys` is what makes this work: an exact key never hits on a new commit, and the prefix
falls back to the most recent cache on the branch, which is the previous run.

### 5.7 One graph boot for the affected lists

Collapse the seven `nx show projects` calls into one `--affected --json` invocation plus `jq`
filtering, and emit the six lists as job outputs the downstream jobs consume. The `build_all`
and first run branches keep their current meaning.

While in there: the Luna affected step exists only because `nx show projects` prints JSON when
stdout is not a TTY and lines when it is, and the workflow was parsing both shapes. Reading
`--json` everywhere and parsing it with `jq` retires that whole class of bug.

### 5.8 Split into jobs

Build the graph from section 4. `setup` publishes the affected lists; `lint-test`,
`build-and-push`, `e2e-frontend`, `e2e-luna` and `deploy` consume them. Each job restores
`node_modules` and `.nx/cache`, and each e2e job restores its browser caches keyed on the
resolved tool version, as `pr.yml` does.

Keep `concurrency: staging-deploy` with `cancel-in-progress: false` at the workflow level. The
serialisation guarantee is about the Helm release and must survive the split.

The two `if: … != ''` guards that currently skip e2e become job level `if:` conditions, so a
commit that affects no suite skips the job rather than every step in it.

### 5.9 Cache the browsers

`~/.cache/ms-playwright` keyed on the version from `require('@playwright/test/package.json')`,
`~/.cache/Cypress` keyed on the Cypress version, and `--with-deps` reduced to a single system
dependency install per job. Copy the pattern from `pr.yml` rather than inventing a second one.

## 6. What could go wrong

**A bundle built on the runner differs from one built in the builder image.** Both are node 22
installing the same lockfile with the same flag, and `pr.yml` has always built on the runner, so
this is unlikely. The check is direct: build one app both ways at the same commit and compare
`dist/apps/<app>`. Do it for `shell`, because it is the app with build time configuration baked
in, and for one Luna service, because `nx prune` writes a lockfile.

**The build context becomes the new bottleneck.** This is the trap in 5.3, and the reason that
step specifies a `dist` context rather than the more obvious `root`. Sending the workspace to
the daemon ten times a run would undo a good part of the win. It is easy to verify: the buildx
log prints the context transfer size, and it should read as megabytes per image, not hundreds.

**An app whose image needs something outside `dist/apps/<project>`.** None does today, which
section 5.3 establishes by inspection of all ten Dockerfiles. But a `dist` context makes that a
constraint rather than a coincidence, and a future app wanting a config file next to its bundle
has to either emit it into `dist` as a build output or use `root` and accept the context cost.
Worth knowing before someone hits it and reaches for `root` without noticing what it costs.

**Losing the pinned build environment.** Building inside a published image is genuinely more
reproducible than building on a runner. What is given up is small, because the lockfile and the
node major version are both pinned either way, and what is bought is most of the pipeline's
wall time. Worth naming as a real trade rather than pretending it costs nothing.

**A green pipeline that tested less than it used to.** Every suite that runs today still runs
after the split, on the same commit, gating the same deploy. Confirm it by listing the suites
in a run before and after; the split must change when things run, never whether they run.

**Cache poisoning across runs.** `.nx/cache` restored by prefix means a run can inherit an entry
computed by an earlier commit. That is the point, and Nx's hashing is what makes it safe. If a
build ever looks impossibly fast and wrong, `restore-keys` is the first thing to drop.

## 7. What this does not change

The deploy half of the workflow stays exactly as `k8s/plans/0003` left it: preflight with
`provision-release.sh --check --env staging`, `helm upgrade --install --atomic --timeout 10m`,
then `rollout restart` for the affected deployments and a separate `rollout status` loop that
observes them, then the diagnosis step on failure. Those steps are correct and they are not
where the time goes.

The affected base stays "the head SHA of the last successful run of this workflow on this
branch", and `workflow_dispatch` with `build_all` still rebuilds everything.

## 8. Production comes second, not with it

`release.yml` has the same four faults and would take the same five changes. It is deliberately
not in this plan.

Staging exists to absorb exactly this kind of change, and a pipeline rewrite is the kind of
change that finds its problems in the second week rather than the first run. Production deploys
on a published release, which is rare enough that 20 minutes costs little and a broken deploy
path costs a lot. So: land this on staging, let it run for a few weeks of ordinary pushes, and
then port it, at which point the Dockerfile and executor changes from 5.2, 5.3 and 5.4 are already
shared and only the workflow file is left to write.
