> **PR:** [#199](https://github.com/IchirokuXVI/nx-portfolio/pull/199)

# 0009 A bundle that cannot load never reaches staging

## 1. The problem

Staging deploys keep failing on a Helm hook, and every time the cause is the same
one wearing a different package name.

```
Error: UPGRADE FAILED: release nx-portfolio failed, and has been rolled back
due to atomic being set: pre-upgrade hooks failed: 1 error occurred:
	* job luna-shopper-backend-catalog-reference-seed failed: BackoffLimitExceeded
```

The pod behind that line said:

```
Error: Cannot find module 'uuid'
Require stack:
- /app/seed-reference.js
```

The catalog service itself was fine. It had started, answered its readiness
probe, and served traffic in two e2e gates. What could not load was
`seed-reference.js`, a second bundle in the same image that only a Helm hook
ever runs.

### 1.1 Why the image is missing a package at all

`apps/luna-shopper-backend/<svc>/package.json` is a **hand written** runtime
manifest. `nx prune` turns it into the `package-lock.json` the Dockerfile
installs from with `npm ci --omit=dev`, so a package the bundle requires and the
manifest does not name is simply not in the image.

Webpack would write that manifest itself. `generatePackageJson` does exactly this
job, and it is switched on. But it is switched on for the `main.ts` plugin
**alone**, because each extra entry point is its own `NxAppWebpackPlugin` and two
writers would race for the same file. `webpack.config.js` says so where it
declares the second entry.

So the generator sees one bundle, and the image runs more than one:

| Service   | Bundles                                      |
| --------- | -------------------------------------------- |
| gateway   | `main.js`                                    |
| realtime  | `main.js`                                    |
| assistant | `main.js`                                    |
| core      | `main.js`, `migrate.js`                      |
| harvester | `main.js`, `migrate.js`                      |
| auth      | `main.js`, `migrate.js`, `admin-cli.js`      |
| catalog   | `main.js`, `migrate.js`, `seed-reference.js` |

Six of those ten bundles are invisible to the generator. A package reachable only
from one of them reaches the image only if a person remembered to type it.

### 1.2 Why nothing catches it

Nothing runs those bundles before the deploy does.

- `lint` and the type checker read the source, where the import is present and
  correct.
- The unit suites import the modules directly under ts-jest. They never load a
  webpack bundle, and they resolve against the root `node_modules`, which has
  every package in the workspace.
- Both e2e gates exercise the running service, which is `main.js`.

So the whole pipeline is green, and the first thing that ever executes
`seed-reference.js` is a Kubernetes Job in the staging cluster.

### 1.3 Why it costs the whole release

If a missing package killed one pod, this would be an incident with a rollback
and a fix. It does not. The Jobs that run the secondary bundles are Helm hooks
(`0002` section 5 for the migration Job, `0067` section 7 for the seed), so
`--atomic` rolls the entire release back, including the parts that were correct.

### 1.4 It has happened four times

| Date       | Missing                                                               | Where it surfaced                             |
| ---------- | --------------------------------------------------------------------- | --------------------------------------------- |
| 2026-08-28 | `ioredis`, `tslib`, `@socket.io/redis-adapter`, the OpenTelemetry SDK | every image, dead at boot                     |
| 2026-09-01 | `@nestjs/jwt` in the gateway                                          | the tier 2 e2e gate, run 33544201465          |
| 2026-09-03 | `uuid` in catalog's `seed-reference.js`                               | the staging pre-upgrade hook, run 33754176536 |
| 2026-09-04 | `@nestjs/jwt` in core, catalog and harvester                          | this plan, before it shipped                  |

The fourth is the one that argues for the check rather than for more care. Plan
`0072` gave core, catalog and harvester the admin gate, which builds a
`JwtModule`. `auth` got the manifest entry. The other three did not, and it sat
on `dev` unnoticed. The first build of any of those three services would have
produced an image that exits at boot, and the migration Jobs for all three are
Helm hooks, so it would have taken the release with it.

## 2. What this adds

`apps/luna-shopper-backend/tools/ci/assert-runtime-manifest.mjs`.

For each service it reads **every** `.js` file at the root of the built dist
directory, collects the bare `require(...)` specifiers, and asserts each one
resolves in that service's pruned `package-lock.json`.

Two decisions inside it matter.

**It reads the built bundle, not the source.** The source cannot answer this
question. A `import type` is erased and must not be listed. `data-source.ts` is
the TypeORM CLI path and is never bundled, so its `dotenv` and `tsconfig-paths`
imports are not runtime dependencies. `tslib` is emitted by the compiler and
written by nobody. A source level sweep gets all four wrong. The bundle is the
artifact the image runs, and `target: 'node'` leaves every external as a literal
`require`, so the bundle states its own dependencies exactly.

**It compares against the lockfile, not the manifest.** `npm ci` installs from
the lockfile. That is the file that decides what is in the image. It also makes
the workspace libraries fall out for free: `copy-workspace-modules` puts them in
as `file:workspace_modules/...` entries, so they resolve without a special case.

## 3. Where it runs

Three places, and the first is the one that matters.

**`pr.yml`, in `verify`.** `manifest-check` joins `lint` and `test` in the
existing `nx affected` invocation. Only the seven Luna Shopper services declare
the target, so a pull request touching only the Angular micro frontends pays
nothing: Nx skips a target a project does not have.

This is not free, and the comment on the job now says so. `manifest-check`
depends on `prune`, so an affected service is built. That is the whole point: the
failure lives in the built bundle and in nothing else.

**`docker-ci.yml`, between building the bundles and pushing the images.** The
last moment the failure is cheap. Everything after that step is expensive or
public: images pushed under a mutable tag, two e2e gates, then an `--atomic`
upgrade of staging. It reads the dist directories the previous step just wrote,
so it needs no image, no registry and no cluster.

**`release.yml`, at the same point.** Production has never been hit by this, and
only by luck. It deploys immutable version tags, so it would fail on a fresh
image nobody could have smoke tested, and `deploy-release.sh` runs without
`--atomic`, so it would leave a half upgraded release rather than a rolled back
one. That is worse than what staging suffers, not better.

The target is **uncached**. The two things it reads, the dist output of `prune`
and the checker script, are not inputs Nx hashes for these projects, so a cached
entry could replay a pass from before either changed. It takes about a second.

## 4. The check is checked

`assert-runtime-manifest.test.mjs`, run by `node --test` in `pr.yml`
unconditionally.

A gate written as a script is easy to break into a permanent pass, and nothing
else in the pipeline would notice: widen the require pattern until it matches
nothing, read the wrong lockfile key so every package looks installed, glob the
wrong extension so no bundle is read at all. Each of those is a test, against
synthetic dist directories, in under a second.

The case that matters most is `reads every bundle, not only main.js`, which is
the 2026-09-03 outage in miniature: a complete `main.js` beside a `migrate.js`
that is missing a package. A checker reading `main.js` alone calls that a pass.

`refuses a dist directory with no bundle` is the other one worth naming. An empty
dist directory must be an error, not a clean bill of health. A green tick that
inspected nothing is the most expensive false pass there is.

## 5. What this does not cover

The check answers one question: can every bundle resolve every package it
requires. It says nothing about whether the package is the right **version**,
whether the code in the bundle is correct, or whether the Job that runs it will
succeed for any other reason.

In particular it would not have caught the three earlier hook failures this
repository has already fixed and documented in
`templates/luna-shopper-backend/migration-job.yaml.tpl`: a `pre-install` hook
running before its ConfigMap exists, a hook migrating a database the same upgrade
has not created yet, and a mutable tag under a derived `IfNotPresent` running the
previous release's migrations. Those are chart bugs and the chart carries the
reasoning for each. This is an image bug, and it is the one that had nothing
watching it.
