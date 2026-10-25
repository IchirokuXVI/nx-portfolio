> **PR:** [#820](https://github.com/IchirokuXVI/nx-portfolio/pull/820)

# 0017 Each unit has its own release

> Last plan of the deploy unit series (`0014` the unit, `0015` the charts, `0016` the deploy
> path). This plan gives each unit its own tag prefix, its own release notes and its own
> version stream, and adds a manual redeploy for rollbacks. Every statement below was read on
> the branch of PR #810 at `e5320be3`.
>
> Prerequisite reading: `0011` (the `PRODUCTION_RELEASE` window of a release task), `0014`
> D5, `0016` D2 and D4, `CONTRIBUTING.md` (the release procedure), `tools/release/rules.mjs`
> and `tools/release/release-notes.mjs`, `apps/velista/plans/0034` D4 (the client version
> floor), `apps/velista/plans/0167` (the Android `versionName` reads `VELISTA_APP_VERSION`).

## Brief for the agent

### Objective

Let the owner publish a Release for one unit and have only that unit build and deploy, with
notes that list only that unit's changes. Keep the version numbers that velista already
carries into its clients. Give production a one command rollback per unit.

Use `antislop` with `antislop-code` for every comment you write.

### Context

Every statement below was read on the branch of PR #810 at `e5320be3`.

- **One tag stream for everything.** A GitHub Release `vX.Y.Z` (latest `v0.14.2`) rebuilds
  every image with `DOCKER_IMAGE_TAG=<version>,latest`, pins the chart with `--set
  imageTag=<version>`, and sets `VELISTA_APP_VERSION=<version>` in the bundle build.
  velista's gateway enforces `minClientVersion: '0.5.2'` against that number
  (`k8s/helm/values.production.yaml:76`, after `0015` in the velista chart), the admin app
  reads `LUNA_ADMIN_APP_VERSION || VELISTA_APP_VERSION`, and the Android `versionName` (PR
  #810) comes from the same variable. Each release task names the one `PRODUCTION_RELEASE`
  that runs it (`k8s/release-tasks/tasks/0004-*/task.env` says `0.14.0`).
- **Release notes come from PR titles.** `tools/release/release-notes.mjs` walks the commits
  between two refs (default: the previous tag by `git describe --tags`), maps them to merged
  PRs with `gh`, skips the `dev` to `main` rollups, and groups by type. It has no filter by
  scope. `0014` D5 adds `UNITS` and `WORKSPACE_SCOPES` to `rules.mjs` with no reader yet.
- **`CONTRIBUTING.md:103-134`** describes the procedure: `release-notes.mjs --version vX.Y.Z
  --out notes.md`, then `gh release create vX.Y.Z --notes-file notes.md`.
- **The `release` event has no tag filter.** A workflow that listens to `release:
  published` runs for every Release and must test the tag itself. A Release that a workflow
  creates with `GITHUB_TOKEN` starts no workflow.
- **GitHub environments** accept deployment tag rules, for example `velista-v*` on
  `velista-production`, which stops a job of that environment from running on another tag.
- After `0016`, `release-portfolio.yml` and `release-velista.yml` both accept a bare
  `vX.Y.Z` and deploy their unit with that version.
- **Nx Release** (`nx release`) offers release groups with a tag pattern per group and
  conventional commit versioning from commit messages. This repository versions nothing in
  `package.json` files, derives notes from PR titles rather than commit messages, and
  publishes Releases by hand.

### Target state

- Tags are `portfolio-vX.Y.Z` and `velista-vX.Y.Z`. The bare `vX.Y.Z` is refused by both
  release callers with a summary line that names the two prefixes.
- `release-notes.mjs --unit <u>` writes the notes of one unit and defaults `--from` to the
  previous tag with that unit's prefix.
- Both production environments carry a tag rule for their prefix.
- `redeploy.yml` (`workflow_dispatch` on the default branch, with unit, environment and
  version) deploys an already built version with the chart of the unit's newest release,
  which is the rollback. It refuses a version from before the unit's first release under
  plan 0016.
- `CONTRIBUTING.md` describes the procedure per unit.

### Scope

`.github/workflows/release-portfolio.yml`, `release-velista.yml`, `redeploy.yml` (new),
`tools/release/release-notes.mjs` and its test, `k8s/release-tasks/check-tasks.mjs`
(`UNIT` already required by `0015`; the version comparison reads the unit's prefix),
`CONTRIBUTING.md`, `CLAUDE.md`, `k8s/README-new-cluster.md` step 8.

### Constraints

- velista's numbers continue. The first velista tag after the merge is `velista-v0.15.0` or
  the next number the owner picks above `0.14.2`, never lower, because `minClientVersion`
  and the installed Android apps compare against it.
- The notes generator still prints every title it cannot parse and drops none.
- A release of one unit must not touch the other unit's release. `helm history` of the other
  unit is unchanged afterwards.

### Action boundaries

- The seed tags and the tag rules are the owner's (section 6).
- Do not adopt `nx release`. D6 records why, and the owner decides when that changes.

### Progress evidence

A `velista-v*` Release on staging's commit deploys velista only, with notes that contain no
portfolio scope. After two velista releases, a `redeploy.yml` run of the older one on
production puts its images back and `helm history velista` shows the new revision.

## 1. Purpose

A unit that cannot be released alone is not isolated. The tag is where a release begins, so
the tag names the unit. Everything downstream (which images build, which chart is pinned,
whose notes are written, whose tasks run) reads the prefix.

## 2. What stays true

- A person publishes the Release. CI does not create tags.
- Production is pinned to immutable version tags. Rollback is a deploy of an older version
  (plan 0003), now per unit.
- Release tasks run in a window on data they expect (plan 0011).

## 3. Decisions

### D1. Tag prefixes, and the bare tag is refused

`release-<unit>.yml` has two jobs. `release` carries `if:
startsWith(github.event.release.tag_name, '<prefix>')` on the calling job itself and calls
`release-unit.yml` with the version that follows the prefix, so that a run for another
unit's tag starts no reusable workflow and enters no concurrency group. `refuse` runs in the
other case and writes one summary line ("this tag is not a release of <unit>; the prefixes
are `portfolio-v` and `velista-v`") and exits green, so that the Actions list shows the
refusal and not a failure. The transitional bare `v` branch of `0016` D4 is removed.

**As built.** The caller passes the whole tag, not the version: `release-unit.yml` needs
the tag to check out, and it reads the version after `TAG_PREFIX` of `unit.env`. It
refuses a tag without that prefix, so the version has one source.

### D2. Both streams continue from `0.14.2`

The owner seeds `portfolio-v0.14.2` and `velista-v0.14.2` on the commit of `v0.14.2`, so
that `git describe --tags --match '<prefix>*'` finds a previous tag on the first run and the
notes cover the right range. The next releases are `portfolio-v0.15.0` and `velista-v0.15.0`
or higher. The old `v*` tags stay in history and are never created again.

The portfolio could restart at `1.0.0`; nothing compares its number. The recommendation is to
continue, so that one rule covers both and the release notes range needs no special case.

**As built.** The seeds sit on `v0.14.3`, not `v0.14.2`. `v0.14.3` was published after this
plan was written, so it is the commit both streams continue from: `portfolio-v0.14.3` and
`velista-v0.14.3`. Everything below that names `0.14.2` as the seed reads `0.14.3`. The
next releases are still `portfolio-v0.15.0` and `velista-v0.15.0`.

### D3. Notes per unit

`release-notes.mjs --unit <u>` keeps a PR when its scope is in `UNITS[u]` or in
`WORKSPACE_SCOPES`, or when it has no scope (a bare `type: summary` title, listed under
its type with a note). `--from` defaults to the previous tag with the unit's prefix, `--to`
to `HEAD` or the given tag. `--version` accepts the prefixed tag. A workspace scoped PR thus
appears in both units' notes; that is the honest account of a shared change that ships
twice. The test covers the filter, the default range, and an unscoped title.

**As built.** A title that cannot be parsed stays in the notes of every unit, under the
section that names it, because the notes drop nothing. An unscoped title is labelled
`**no scope**`, and a footnote says which titles every unit lists and counts the ones left
out as another unit's. With `--unit` and no `--from`, a range with no earlier tag of the
unit is refused instead of walking all of history. `--version` must carry the unit's
prefix; `--to` may name any ref.

### D4. Release tasks compare against the unit's version

`run-release-tasks.sh --release <version>` receives the version without the prefix, as
today. `check-tasks.mjs` keeps `PRODUCTION_RELEASE` as a bare number and asserts that the
task's `UNIT` has a `TAG_PREFIX`. The existing four tasks name velista versions already.

**As built.** It also refuses a `PRODUCTION_RELEASE` written as the whole tag
(`velista-v0.15.0`) with a message that says to write the version alone.

### D5. Build variables per unit in a release

`release-unit.yml` sets the unit's `BUILD_ENV_PRODUCTION` variables from `unit.env`, and
velista's include `VELISTA_APP_URL=https://velista.app` and
`VELISTA_APP_VERSION=<version>`. The admin app receives the same number. The portfolio has
`MFE_BASE_URL` only. The build has two invocations, as `0016` D1 states. The base image
`local-http-server` builds first, alone, with `DOCKER_IMAGE_TAG=<unit>-v<version>`. The
unit's images build after it with `DOCKER_IMAGE_TAG=<version>,latest` and
`BUILDER_TAG=<unit>-v<version>`. One `run-many` cannot do both, because `DOCKER_IMAGE_TAG`
sets the tags of every project it builds, and the base must carry the prefixed tag and no
`latest` (`0016` D6).

### D6. `nx release` is not adopted

Nx Release groups would give `portfolio-v{version}` and `velista-v{version}` tags, a
version bump derived from conventional commits, and a changelog per group. It is not adopted
now because:

- The repository's convention is the **PR title**, checked by `pr-title.yml` and parsed by
  `rules.mjs`. Nx reads commit messages, and `dev` merges into `main` by merge commit, so the
  messages Nx would read are the branch commits, not the titles.
- Nothing here has a `package.json` version to bump, and the Docker release support of Nx
  publishes images itself, which the custom executor already does with its cache and tag
  conventions.
- A Release created by a workflow with `GITHUB_TOKEN` starts no deploy, so the deploy would
  have to be chained inside the same run, which changes the "a person publishes" rule.

The map `UNITS` and the `--unit` flag give the per unit notes with one small change. When the
velista unit splits and three streams exist, the trade changes; the owner decides then.

### D7. A manual redeploy per unit

`redeploy.yml` (`workflow_dispatch` with inputs `unit`, `environment` and `version`) runs
**from the default branch** (`gh workflow run redeploy.yml --ref main -f unit=velista -f
environment=production -f version=0.15.0`). A dispatch needs the workflow file at the ref
it runs on, and only the default branch is sure to have it.

On production it checks out the unit's **newest** tag `<unit>-v*`, not `main` and not the
tag of the version to deploy. That tag carries the chart that production runs now, the
composite action `deploy-unit` of `0016` and the two argument `deploy-release.sh`. `main`
may hold chart changes that no release has shipped yet. The tag of an older version may
hold none of those three things. It then holds `deploy-<unit>-production` and calls
`deploy-unit` with no build, which runs `deploy-release.sh <unit> <version>`. That puts the
older images back under the current chart, and the release tasks' ledger sees a version it
has already finished.

It refuses a version older than the unit's **first release after `0016` landed**, the
oldest tag `<unit>-v*` whose commit contains `.github/actions/deploy-unit/action.yml`. The
seeded `velista-v0.14.2` and `portfolio-v0.14.2` (D2) point at the commit of `v0.14.2` and
fall below that line: their images were built for the combined chart and were never deployed
by a unit chart. The refusal writes one summary line that names the line and the way back
below it.

Below the line, a rollback takes the path from before the split:

- **On a cluster not yet cut over** (`0016` D5), `deploy-release.sh <older-version>` from a
  checkout of `v0.14.2` or older against the release `nx-portfolio`, or `helm rollback
  nx-portfolio`.
- **On a cluster already cut over**, `helm rollback <unit> 1`. Revision 1 of each unit
  release is the cutover install, which runs the images that were live before the split
  under the unit chart. Nothing older than that revision is reachable.

A dispatch from `main` cannot pass the tag rule of `<unit>-production` (section 6). On
production the job thus names the environment `<unit>-production-redeploy`, which holds the
same secrets and variable, allows the branch `main` only, and has a required reviewer.
Releases stay tag only. On staging the job names `<unit>-staging`, checks out `main` and
redeploys the `staging` tag; `version` is ignored there.

**As built.** Three additions. Before any SSH, the resolve job checks with `docker manifest
inspect` that every image the newest chart deploys exists at the tag. An older version
that lacks an image the unit has now is refused there, and not found as a Deployment that
cannot pull. A refusal fails the run: unlike a foreign tag on `release-<unit>.yml`, a
dispatch that deployed nothing did not do what it was asked. The way back below the line
is written `helm rollback <release> 1 -n <namespace>`, because `helm` needs the namespace.
The `version` input takes `0.15.0`, `v0.15.0` or `velista-v0.15.0`.

## 4. Who edits what

One builder, one PR, title `feat(release): one tag prefix, one notes file and one redeploy
per deploy unit (plan 0017)`. The scope list is the file list.

## 5. Acceptance

- `node tools/release/release-notes.mjs --check "feat(velista): a thing (plan 0017)"` still
  passes; `node --test tools/release/release-notes.test.mjs` passes with the new cases.
- `node tools/release/release-notes.mjs --unit velista --from velista-v0.14.2 --to HEAD`
  prints notes with no portfolio scope, and the portfolio command the reverse.
- A Release `velista-v0.15.0` runs `release-velista.yml` through deploy and
  `release-portfolio.yml` to its one summary line. `helm history portfolio` is unchanged.
- After a second velista release (`velista-v0.15.1` or the next number), `redeploy.yml`
  dispatched on `main` with `velista`, `production`, `0.15.0` puts `0.15.0` back, observed
  through `kubectl get deployment -n luna-shopper -o
  jsonpath='{.items[*].spec.template.spec.containers[*].image}'`. The run's log shows the
  checkout of the newest `velista-v*` tag, and `helm history portfolio` is unchanged.
- `redeploy.yml` with `velista`, `production`, `0.14.2` is refused before any SSH, with a
  summary line that names `velista-v0.15.0` as the oldest version it deploys and `helm
  rollback velista 1` as the way back below it.

## 6. The owner's part

1. `git tag portfolio-v0.14.2 v0.14.2 && git tag velista-v0.14.2 v0.14.2 && git push
   origin portfolio-v0.14.2 velista-v0.14.2` (two tags in one push, under the limit of
   three that creates no events).
2. Tag rules `portfolio-v*` on `portfolio-production` and `velista-v*` on
   `velista-production`. No branch is allowed on either.
3. The environments `portfolio-production-redeploy` and `velista-production-redeploy` (D7),
   with the values of the matching production environment, the branch rule `main` only and
   a required reviewer.
4. Publish the next Release of each unit with its prefix.

**As built.** Items 2 and 3 are a script, not settings pages:
`k8s/bootstrap/github-environments.sh --env production ... --reviewer <login>` gives each
`<unit>-production` the tag rule `<TAG_PREFIX>*` and no branch, and creates each
`<unit>-production-redeploy` with the four values, the branch rule `main` and the
reviewer. A reviewer or a wait timer that an environment already has is kept. Item 1
seeds `v0.14.3` (D2).

## 7. `CLAUDE.md` and `CONTRIBUTING.md`

`CLAUDE.md`, `Docker & CI/CD`: replace the production bullet with

> - **A Release is per unit.** The tag is `<unit>-vX.Y.Z` (`portfolio-v0.15.0`,
>   `velista-v0.15.0`). `release-<unit>.yml` builds that unit's images at the tag, pins its
>   chart to the version, and deploys it. The notes come from `node
>   tools/release/release-notes.mjs --unit <unit> --version <unit>-vX.Y.Z --out notes.md`.
>   A bare `vX.Y.Z` deploys nothing. To roll back, dispatch `redeploy.yml` on `main` with
>   the unit, the environment and the older version. It deploys that version's images with
>   the chart of the unit's newest release, and it refuses a version from before the
>   unit's first release under k8s plan 0016. Below that line the way back is `helm
>   rollback <unit> 1`.

`CONTRIBUTING.md`: the release section becomes the per unit procedure with both commands,
and states that velista's numbers never decrease because clients compare them.

## 8. Decisions left for the owner

1. **D2**, the portfolio continues at `0.15.0` (recommended) or restarts at `1.0.0`.
2. **D3**, workspace scoped PRs appear in every unit's notes (recommended) or in none.
3. **D6**, revisit `nx release` when velista splits into more streams.
