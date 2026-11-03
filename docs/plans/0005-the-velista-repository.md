# 0005: The Velista repository

> Velista moves out of `nx-portfolio` into a public GitHub repository named `Velista`. The
> new repository holds the server, the client, the back office, their libraries, the velista
> chart, the deploy machinery and the plans. `nx-portfolio` keeps the portfolio (the shell,
> its three remotes, `libs/shared`) and its own unit. The new history starts fresh: commit one
> is the `LICENSE` file that docs `0004` wrote, commit two imports the tree. `nx-portfolio`
> is not archived, because the portfolio lives on there, and every `> **PR:**` link in a
> velista plan keeps pointing at a pull request that still exists.
>
> The plan is a move, not a redesign. The first deploy from the new repository renders the
> same chart with the same values into the same namespace that `nx-portfolio` deployed the
> day before, so it changes no running object. That is true only because every other plan
> of the series has landed in `nx-portfolio` first: the names (docs `0003`), the baseline
> migrations (backend `0240`), the namespace and databases under the new names (k8s `0019`).
>
> The new repository is described with the names that docs `0003` produces: projects
> `velista-server-*`, `velista-client`, `velista-admin`; directories `apps/velista-server`,
> `apps/velista-client`, `apps/velista-admin` and their libraries under `libs/velista-server`,
> `libs/velista-client`, `libs/velista-admin`; the alias prefix `@velista/*`. Where docs
> `0003` as built names a directory differently, its names win and this plan follows them.
> Paths in `nx-portfolio` are written as they are today (2026-11-03). The plan directories
> move with docs `0003` (`apps/luna-shopper-backend/plans` to `apps/velista-server/plans`
> and so on), and this file lives in `docs/plans`, which does not move.
>
> Prerequisite reading: docs `0003` and `0004`, k8s `0019`, k8s `0014` to `0017` (the deploy
> units, the charts, the pipelines, the per unit releases), k8s backlog `0003` (the owner's
> deployment in a private repository), k8s `0013` (Renovate, host maintenance),
> `k8s/README-new-cluster.md` sections 7 and 10b, `k8s/bootstrap/github-environments.sh`,
> `.github/workflows/stage-unit.yml`, `release-unit.yml`, `redeploy.yml`, `pr.yml`,
> `nx-migrate.yml`, `.github/actions/deploy-unit/action.yml`, `renovate.json`,
> `tools/deploy/units.mjs`, `tools/release/rules.mjs`, and docs `0006`, the owner's runbook,
> which holds every step of this plan that a person does by hand.
>
> **Build order.** Last in the series. It needs docs `0003` merged, docs `0004` merged (the
> license file is commit one), backend `0240` to `0243`, velista `0178`, k8s `0020` and
> `0021` merged, and k8s `0019` run on both clusters, so that staging and production both
> answer `helm list -n velista` with the release `velista` and k8s `0019`'s clean up step
> has deleted the namespace `luna-shopper` on both. Nothing runs beside it: while the
> move is under way, no other pull request touches the velista half of `nx-portfolio`; the
> command of docs `0003` target state 1 (which filters Renovate as `app/renovate`, the way
> `gh pr list --json author` reports it) lists the open ones. docs `0006` is written beside
> this plan and is read from the start of the series. The series order, as every plan of
> the series states it: docs `0003` first, alone, after the pull request gate; then in
> parallel docs `0004`, backend `0240` to `0243`, velista `0178`, k8s `0020` and `0021`
> (backend `0242` after velista `0178` for the admin mechanism, k8s `0020` after backend
> `0241` for the generated files); k8s `0019` after docs `0003` and backend `0240`, in the
> same rollup to `main` as `0240`; docs `0005` last, with docs `0006` read from the start.

## Brief for the agent

### Objective

Create the content of the public repository `Velista` from `nx-portfolio` at one commit of
`dev`: a first commit with `LICENSE` alone, a second commit with the Velista tree, pruned of
the portfolio, with root configuration and dependencies that build, lint and test green from
a clean clone. Make the new repository's pipelines deploy the velista unit to both clusters
without a change to any running object, and remove the velista unit from `nx-portfolio` in
the right order, so that two repositories never deploy one namespace.

### Context

- **Projects.** `nx show projects` lists 103 projects on 2026-11-03: 26 of the portfolio
  (`shell`, `odontogram`, `damoclesSword`, `landingV2`, their e2e projects and the libraries
  under `libs/damoclesSword`, `libs/odontogram`, `libs/landing-v2`), 8 under `libs/shared`
  (`localization/rokutranslator`, `localization/rokutranslator-angular`, `shared/data-access`,
  `shared/environments`, `shared/models`, `shared/model-engines`, `shared/ui`, `shared/util`),
  3 docker projects (`docker`, the plugin in `tools/docker`; `docker/local-http-server`;
  `docker/builder`), and 66 of Velista.
- **What Velista takes from `libs/shared`.** The client imports only the RokuTranslator pair
  and `serviceToken` plus `provideService` from `@portfolio/shared/data-access`
  (`libs/shared/data-access/src/lib/service-token.ts`, 76 lines). The admin app imports the
  same three and eight icons of `@portfolio/shared/ui` (ChevronLeftIcon, WarningIcon,
  MoreIcon, TrashIcon, MenuIcon, LockIcon, CloseIcon, CheckIcon); its edge to `shared/util`
  comes only through the `shared/ui` barrel. The server imports nothing from `libs/shared`.
  `libs/shared/model-engines` is imported only by `libs/luna-shopper/tools/curation/cli` and
  `libs/luna-shopper/tools/leaflet/cli`, by relative path
  (`../../../../../shared/model-engines/src/index.mjs`).
- **Base image.** The client and admin Dockerfiles build `FROM
  ${TARGET_REGISTRY}nx-portfolio/local-http-server:${BUILDER_TAG}`
  (`apps/velista/src/Dockerfile:22`, `apps/luna-shopper-admin/src/Dockerfile:23`). Nothing
  of Velista uses `docker/builder`.
- **CI facts.** `DOCKER_REGISTRY: ghcr.io/ichirokuxvi` sits in `stage-unit.yml:37` and
  `release-unit.yml:30`; `REGISTRY` in `tools/deploy/units.mjs:83`; the image prefix in
  every chart value, in `k8s/e2e/*/compose*.yml` and in `renovate.json` (the rule "Our own
  images are tagged by the pipeline"). The callers pass `secrets: inherit`; the deploy reads
  `SSH_DEPLOY_HOST`, `SSH_DEPLOY_USER`, `SSH_DEPLOY_KEY` (secrets) and `SSH_KNOWN_HOSTS`
  (variable) from the environment `<unit>-staging`, `<unit>-production` or
  `<unit>-production-redeploy`, and production also reads `ALLOW_CUTOVER`
  (`release-unit.yml:272`) and, after k8s `0019`, `ALLOW_RENAME`. `nx-migrate.yml` needs the repository secret `AUTOMATION_TOKEN`.
  `host-maintenance.yml` and `host-patch.yml` use the environments `host-staging` and
  `host-production` (with `SSH_SOAK_CHECK_HOST` on production).
- **`BUILD_ENV_*` of the velista unit.** Today `BUILD_ENV_STAGING` and
  `BUILD_ENV_PRODUCTION` in `k8s/units/velista/unit.env` carry the client's three URLs into
  `nx build`, and the admin build reads the gateway key from the same list. velista `0178`
  removes the realtime and app keys; the gateway key (`VELISTA_GATEWAY_URL` after docs
  `0003`) leaves `unit.env` only after backend `0242` gives the admin the same runtime
  mechanism. With both merged, as this plan's build order requires, both lines are empty
  and the new repository builds one client image and one admin image for every
  deployment.
- **First runs in a repository with no history.** `stage-unit.yml` finds no last green run
  and builds every image of the unit. `release-unit.yml` finds no previous tag and tests
  every project. `redeploy.yml` refuses every production version until the new repository
  has a published `velista-v*` Release that carries `.github/actions/deploy-unit`.
  `release-notes.mjs --unit velista` finds no previous tag. `check-tasks.mjs` measures each
  release task window from the commit that last changed its `task.env`, which becomes the
  import commit; every window of tasks `0001` to `0005` is a past date by then, so none
  fails.
- **The cross namespace check.** `provision-release.sh` (lines 309 to 346) fails a render
  that names a namespace no unit of `k8s/units` has. Today the portfolio chart names the
  velista namespace (`externalRoutes`, `k8s/helm/portfolio/values.yaml:111`), the velista
  chart names `portfolio` (`referenceGrants`, `k8s/helm/velista/values.yaml:109-111`), and
  the portfolio gate pulls the velista image (`k8s/e2e/portfolio-frontend/gate.env`
  `IMAGES`, `compose.yml:68`). k8s `0019` D7 decides whether this coupling survives
  (section 3.2).
- **The last velista release** of `nx-portfolio` is `velista-v0.18.0` (2026-10-30).
  velista numbers never go down (`CLAUDE.md`, k8s `0017`).

### Target state

1. The repository `Velista` exists, public, under the owner's choice of account or
   organisation. Its first commit on `main` holds `LICENSE` alone, the file docs `0004`
   wrote, byte for byte. Its second commit imports the tree of section 1 from one named
   commit of `nx-portfolio` `dev`, and its message names that commit SHA. `dev` branches
   from `main` at the second commit.
2. A clean clone passes `npm ci` and `npx nx run-many --all -t lint test build`, and
   `npx nx show projects --json` lists 71 projects (section 1.4 has the arithmetic).
3. `package.json` and `package-lock.json` hold no dependency that no Velista project imports.
   `nx.json` names no plugin of a removed dependency.
4. `tsconfig.base.json` names only Velista paths, under `@velista/*`. No file of the new
   repository imports `@portfolio/`.
5. `CLAUDE.md`, `CONTRIBUTING.md`, `README.md` and the skills describe the new repository.
   `git grep -n "module federation\|module-federation"` outside `plans/` names only the
   sentence that says Velista uses none.
6. Every plan directory is copied as it is, and the next plan in each directory takes the
   next free number.
7. `helm template` of the velista chart from the new repository and from `nx-portfolio` at
   the import commit, with the same values files and the same `imageTag`, differ in nothing,
   or only in the image repository of each Deployment when the registry path changes
   (section 4).
8. The new repository's `staging-velista.yml` has deployed staging green and its
   `release-velista.yml` has deployed production green, each with `kubectl rollout status`
   of every velista Deployment successful.
9. `nx-portfolio` holds no velista caller, no `k8s/units/velista`, no velista choice in
   `redeploy.yml`, no Luna job in `pr.yml`, and its own unit still deploys green.
10. Exactly one repository runs `host-maintenance.yml` against the two hosts.

### Scope

In the new repository: the whole imported tree, its root configuration, its workflows, its
documentation. In `nx-portfolio`: the removal pull request of section 3 and the portfolio
side of the cross namespace check. Out: any change to the charts' templates beyond section
3.2, any change to a cluster by hand, the owner's private deployment of k8s backlog `0003`,
the extraction of shared client code (the owner's decision 11 tags it now and extracts it
later), and the Compose path itself (k8s `0020`, which travels as files).

### Constraints

- No history rewrite of `nx-portfolio`. No force push anywhere. `main` of `nx-portfolio`
  stays off limits as `CLAUDE.md` says.
- The import is one commit of the paths of section 1.1, copied at their source locations
  from one commit of `nx-portfolio`. Every later edit (the folds and renames of D3 to D7,
  the pruning, the root configs, the docs) is its own commit or pull request in the new
  repository, so that `git diff --no-index` of the import against its source shows nothing.
- Generated files stay generated: the OpenAPI document and the admin wire types are
  regenerated with `npx nx run velista-server-gateway:openapi` and the admin wire types
  target, never edited.
- The release task files travel unchanged, so the ledger ConfigMap `release-tasks` in the
  namespace and the files agree.
- The new repository's first velista release number is higher than `velista-v0.18.0` or
  whatever the last `velista-v*` of `nx-portfolio` is on the day.
- Two repositories never deploy one namespace: the order of section 4.4 is not optional.

### Action boundaries

Stop and ask before: creating the repository or any environment, secret, variable, ruleset
or package permission (all of them are the owner's, docs `0006` phase 4); running any
workflow against a cluster; deleting or disabling a workflow in `nx-portfolio`; deleting any
image or package; changing a chart template; adding a dependency; publishing a Release.
The agent never reads a secret value. When a check needs one, the owner runs it.

### Progress evidence

- `git log --format='%H %s' --reverse | head -2` in the new repository shows the license
  commit and the import commit; `git show --stat $(git rev-list --max-parents=0 HEAD)` lists
  `LICENSE` alone.
- In a fresh clone: `npm ci`, `npx nx run-many --all -t lint test build`, then
  `npx nx show projects --json | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).length)"`
  prints 71.
- `git grep -n "@portfolio/"` in the new repository prints nothing outside `plans/`.
- For each dependency removed, `git grep -n "<name>"` over `apps libs tools` prints nothing.
- `node tools/deploy/units.mjs check` and `node k8s/release-tasks/check-tasks.mjs` pass in
  both repositories; `bash k8s/bootstrap/provision-release.sh --check --unit velista --env
  staging --render-only` passes in the new one and the portfolio equivalent in the old one.
- The `helm template` comparison of section 4.2, its diff attached to the pull request.
- `gh run list --workflow staging-velista.yml --repo <owner>/Velista` shows a green run, and
  its deploy summary shows each `kubectl rollout status` successful. The same for
  `release-velista.yml` after the first Release.
- `gh workflow list --repo IchirokuXVI/nx-portfolio` shows no velista caller.

## 1. What moves

### 1.1 The tree, by directory

Every entry is copied from `nx-portfolio` at the import commit. Names after docs `0003`.

| Today in `nx-portfolio` (names after docs `0003`) | In `Velista` | Note |
| --- | --- | --- |
| `apps/velista-server/*`, `apps/velista-client`, `apps/velista-admin` and their e2e projects | same | the 66 projects |
| `libs/velista-server/*`, `libs/velista-client/*`, `libs/velista-admin/*` | same | |
| `libs/shared/localization/rokutranslator`, `rokutranslator-angular` | `libs/shared/localization/*` | copied, alias renamed (D3) |
| `libs/shared/data-access/src/lib/service-token.ts` | folded into `@velista/client/platform` (D4) | |
| eight icon components of `libs/shared/ui` | the admin's `ui` library (D5) | |
| `libs/shared/model-engines` | `libs/shared/model-engines` | moves; leaves `nx-portfolio` with its consumers |
| `k8s/helm/velista`, `k8s/helm/common` | same | common is copied; the portfolio keeps its own copy |
| `k8s/helm/deploy-release.sh`, `restore-database.sh`, `luna-shopper-backend-secrets.md` (renamed `velista-server-secrets.md` by k8s `0019`) | same | |
| `k8s/units/velista`, `k8s/units/unit-env.sh` | same | |
| `k8s/e2e/velista-server`, `k8s/e2e/velista-stack` (today `luna-shopper-backend`, `velista-luna`) | same | the gates of `velista-server-e2e` and `velista-stack-e2e` |
| `k8s/release-tasks` | same | tasks unchanged |
| `k8s/bootstrap` | same | copied; both repositories keep one until k8s backlog `0003` decides |
| `k8s/catalog-import`, `catalog-reset`, `catalog-seed` | same | `restore-first-catalog.sh` only if k8s `0019` owner decision 5 kept it |
| `k8s/plans`, `k8s/README*.md`, `k8s/docker-desktop-kubernetes-wsl2.md` | same | the plans are history of both units and are copied whole |
| `tools/deploy`, `tools/release`, `tools/dev`, `tools/openapi`, `tools/catalog`, `tools/leaflets`, `tools/shop-map` | same | `tools/dev/ng-slot.sh` loses the portfolio apps |
| `tools/docker` and `apps/docker/local-http-server` | same | the plugin and the base image, copied |
| `.github/workflows/*` except `staging-portfolio.yml`, `release-portfolio.yml` | same | |
| `.github/actions/*` | same | |
| `renovate.json`, `migrations.json`, `skills-lock.json`, `.agents` | same | |
| `nx.json`, `tsconfig.base.json`, `jest.config.ts`, `jest.preset.js`, `eslint.config.mjs`, `playwright.reporters.ts`, `.prettierrc`, `.prettierignore`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.dockerignore`, `.env.development`, `.env.production`, `types/` | same | pruned (1.3) |
| `.claude/settings.json`, `.claude/skills/*` | same | the Angular skill renamed (D7) |
| `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `docs/` | same | rewritten (1.5) |
| `package.json`, `package-lock.json` | same | pruned (1.3) |

### 1.2 What does not move

The shell, `odontogram`, `damoclesSword`, `landingV2`, their e2e projects and libraries;
`libs/shared/ui`, `shared/util`, `shared/environments`, `shared/models`, the rest of
`shared/data-access`; `module-federation.shared.ts`; `apps/docker/builder` and
`apps/docker/CASE_STUDY.md`; `k8s/helm/portfolio`, `k8s/units/portfolio`,
`k8s/e2e/portfolio-frontend`; `staging-portfolio.yml`, `release-portfolio.yml`;
`docker/prod`, `docker/dev`; `trailer.png`. `docker/ddns` is the owner's (owner decision 4;
the plan recommends it stays, because it keeps the `ichirokuxvi.com` zone pointed at a home
line and names nothing of Velista).

### 1.3 Pruning the root

- **`tsconfig.base.json`**: keep only the paths of moved projects, renamed to `@velista/*`.
- **`nx.json`**: drop the `@nx/cypress/plugin` entry and every target default that names a
  removed project or `module-federation.shared.ts`.
- **`package.json`**: find each candidate by listing the dependencies that only the
  portfolio imports. For each name in `dependencies` and `devDependencies`, `git grep -ln
  "<name>"` over `apps libs tools` and the root configs of the new tree; a name with no hit
  is a candidate. Start with `cypress`, `@nx/cypress`, `eslint-plugin-cypress` (Cypress
  runs only `shell-e2e` and `odontogram-e2e`; every Velista e2e project is Playwright),
  `@angular/material` (imported only by `apps/shell` and `libs/odontogram`),
  `@module-federation/enhanced` and `@nx/module-federation` (no Velista project calls
  `withModuleFederation`, as `apps/luna-shopper-admin/webpack.config.ts:16` says for the
  admin), `deep-equal` and `@types/deep-equal` (only `libs/shared/util`). `d3-*` stays: the
  admin uses it. Remove one group at a time and run `npx nx run-many --all -t
  lint test build` after each; a red build puts the group back. `npm install` rewrites the
  lock file; commit both. The `name` field becomes the owner's choice (docs `0004` decides
  `license`; keep `"private": true`, because nothing is published to npm).
- **`.gitignore`**: drop `apps/shell/.env` and the portfolio lines; keep `tmp`.
- **`.env.development` and `.env.production`**: read on 2026-11-03, each holds one line,
  `NODE_ENV=development` and `NODE_ENV=production`. They move as they are.
- **`eslint.config.mjs`**: drop the Cypress block if one exists.

### 1.4 The expected project count

66 Velista projects, plus the two RokuTranslator libraries, plus `shared/model-engines`,
plus `docker` (the plugin) and `docker/local-http-server`: 71. `nx-portfolio` keeps 26
portfolio projects, 7 of `libs/shared` (all but `model-engines`) and 3 docker projects: 36.
If docs `0003` splits or merges a project, both numbers move by that and the builder states
the new arithmetic.

### 1.5 The documentation

- **`CLAUDE.md`** is rewritten for the new repository. These sections go: "Module
  federation topology", the module federation half of "App-owned locale routing" (the shell
  ordering rule, the `rxjs-interop` dedupe trap, which exists only because remotes bundle
  their own copy), "Localization: RokuTranslator" loses the `module-federation.shared.ts`
  bullets, the `serve shell` and remote commands of "Common commands", the shell and remote
  parts of "Docker & CI/CD" (`MFE_BASE_URL`, the shell image). These stay and are renamed:
  dev slots, the sheet and back navigation rules, RokuTranslator, the library layout, the
  whole "Luna Shopper backend" section (renamed "velista-server"), the Docker and CI/CD
  bullets of the velista unit, plan files, the Git workflow, the Nx guidelines.
- **`CONTRIBUTING.md`**: the scopes of the new `rules.mjs` (section 2.4).
- **`README.md`**: what Velista is, the two deploy paths of k8s `0020` and `0021`, the license.
- **`docs/`**: copied whole, `docs/plans` included, so this plan and docs `0006` travel.

## 2. CI and Renovate in the new repository

### 2.1 Workflows

The new repository runs the same pipelines with one unit. Edits on import:

- `stage-unit.yml:37` and `release-unit.yml:30`: `DOCKER_REGISTRY` names the registry path
  of owner decision 2. `units.mjs:83` `REGISTRY` and the default image prefix follow. The
  `E2E_IMAGE_PREFIX` of the gate job follows.
- `redeploy.yml`: the `unit` choice is `[velista]`.
- `pr.yml`: unchanged in shape. The `verify-infra` job (the Luna compose stack) stays.
- `host-maintenance.yml`, `host-patch.yml`: kept only in the repository that owner
  decision 6 picks; in the other one the file is deleted in the same pull request.
- `nx-migrate.yml`: kept. It needs the secret `AUTOMATION_TOKEN` of the new repository.
- `image-scan.yml`: kept. It reads its list from `units.mjs images`.

### 2.2 What the repository needs from GitHub

Every item is an owner step in docs `0006` phase 4. Secrets and variables do not transfer
between repositories, and environments do not either.

- The environments `velista-staging`, `velista-production` and
  `velista-production-redeploy`, written by `k8s/bootstrap/github-environments.sh` run from a
  checkout of the new repository (it reads `k8s/units` there, so it writes velista ones only).
  `host-staging` and `host-production` only in the repository that runs host maintenance;
  `--units-only` in the other.
- The secret `AUTOMATION_TOKEN`, a fine grained token with contents and pull requests write
  on the new repository.
- Write access to the packages: with a registry path under the account, the packages that
  `nx-portfolio` pushed are linked to `nx-portfolio`, and a workflow of another repository
  can push to them only after the owner adds the new repository under each package's
  "Manage Actions access" with the role Write. With a path under an organisation the new
  repository creates its own packages. The chart sets no `imagePullSecrets`
  (`k8s/helm/velista/values.yaml:35`), so every package must be public for the nodes to pull.
- The Renovate GitHub App installed on the new repository (an installation is per
  repository or per account selection).
- A ruleset for `main` like the one `nx-portfolio` has (ruleset "PR main": no deletion, no
  force push, changes through a pull request) and one for `dev` with the required checks
  `verify`, `verify-infra` (both `pr.yml`) and `title` (`pr-title.yml`). `nx-portfolio`
  has no rule on `dev` today; the owner decides whether the new one gets it (docs `0006`).
- Dependabot alerts on, if the owner wants Renovate's `vulnerabilityAlerts` rules to act:
  those read GitHub's alerts. `osvVulnerabilityAlerts` reads OSV and needs nothing. On
  2026-11-03 `GET repos/IchirokuXVI/nx-portfolio/vulnerability-alerts` answered 404, which
  means off or not readable with the token used.
- Neither `ALLOW_CUTOVER` (k8s `0016`) nor `ALLOW_RENAME` (k8s `0019` D10) is needed: both
  clusters are cut over and renamed before this plan runs, and `split-release.sh --status`
  and `rename-release.sh --status` both answer `none`.

### 2.3 Renovate

`renovate.json` moves as it is, with two edits: the rule "Our own images are tagged by the
pipeline" names the new registry path, and `matchPackageNames` of the Nx rule drops
`@module-federation/**` only if nothing depends on it after section 1.3. `nx-portfolio`
keeps its own `renovate.json`. When host maintenance runs from one repository only, the
other repository's `install.sh` pins become a copy that nothing deploys from; its Renovate
custom manager for `k8s/bootstrap/install.sh` is removed there, so the two copies never
disagree under automerge.

### 2.4 Release scopes and notes

`tools/release/rules.mjs` in the new repository keeps the velista scopes and the workspace
scopes, drops `shell`, `odontogram`, `damoclesSword`, `landingV2` from `SCOPES` and the
`portfolio` key from `UNITS`, and adds the scopes docs `0003` introduces. Old scopes stay
parseable: the file already keeps `android` for old titles, and the same applies to `luna`,
`luna-shopper` and `luna-shopper-admin`. In `nx-portfolio` the `velista` key of `UNITS` goes
and the velista scopes stay in `SCOPES`, so old titles still parse there.

`release-notes.mjs` in the new repository sees no pull request before the import. The first
Release note there is written by hand, or generated with `--from <import tag>` after the
owner tags the import commit (`velista-import`, owner decision 8). Every later note is
generated as today.

## 3. What stays in `nx-portfolio`, and what it loses

### 3.1 The removal pull request

One pull request into `dev` of `nx-portfolio`, merged only at step 4 of section 4.4:

- Deletes `staging-velista.yml`, `release-velista.yml`, `k8s/units/velista`,
  `k8s/helm/velista`, the two velista gates, the task directories under
  `k8s/release-tasks/tasks`, `k8s/catalog-*`, and every velista project and library. The
  runner and `check-tasks.mjs` stay, because `deploy-unit` and `pr.yml` call
  `check-tasks.mjs` on every run whatever `RELEASE_TASKS` says; the builder confirms it
  passes on an empty `tasks/`.
- `redeploy.yml`: the `unit` choice becomes `[portfolio]`.
- `pr.yml`: the `verify-infra` job goes, and so do the steps of `verify` that test Luna
  tools (`assert-runtime-manifest.test.mjs`, `find-leaflets.test.mjs`).
- `tools/release/rules.mjs`: `UNITS.velista` goes, the scopes stay.
- `tools/deploy/units.mjs`: nothing to change in code; `check` stops finding
  `deploy:velista` tags once the projects are gone. Its tests keep their fixtures.
- `tsconfig.base.json`, `package.json`, `nx.json`, `CLAUDE.md`, `.claude/skills`: the
  velista parts go. The Angular skill keeps its name in `nx-portfolio`.
- `libs/shared` stays whole, except `shared/model-engines` (its only consumers left).

### 3.2 The `/velista` mount

k8s `0019` D7 decides what `/velista` on the portfolio host becomes: A, the mount kept
(backend `velista-client` in namespace `velista`); B, a 301 redirect to the velista host
rendered by the portfolio chart alone (its recommendation); C, dropped. This plan follows
that decision, and the two must agree:

- **B or C.** The portfolio chart names no velista Service, and the velista chart's
  `referenceGrants` entry, the `/velista` check of `k8s/e2e/portfolio-frontend/gate.sh` and
  `velista` in its `IMAGES` are gone before this plan starts (the builder confirms; if one
  is left, it goes in the removal pull request). Nothing else of section 3.2 applies.
- **A.** The portfolio chart's `externalRoutes` names the namespace `velista`, the velista
  chart's `referenceGrants` names `portfolio`, and the portfolio gate pulls
  `velista:staging`. With one unit per repository, the cross namespace check of
  `provision-release.sh` (lines 309 to 346) fails in both. This plan then adds a field
  `PEER_NAMESPACES` to `unit.env` (`"portfolio"` in the velista unit, `"velista"` in the
  portfolio unit), makes the check accept a namespace listed there, and has
  `units.mjs check` validate the field's shape. The gate's image reference moves to the new
  registry path in the same pull request. A change of the velista namespace then needs a
  pull request in each repository, which is the coupling k8s `0019` D7 warns about.

### 3.3 Memory and skills

The assistant's memory files under the owner's profile describe paths of `nx-portfolio`.
After the move the guiding agent writes the update (docs `0006` phase 5). The skill
`nx-portfolio-angular-developer` stays in `nx-portfolio`.

## 4. The first deploy changes no running object

### 4.1 Why

k8s `0019` already runs both clusters with the release `velista` in the namespace `velista`,
the databases and Secrets under the new names, from `nx-portfolio`. The new repository's
`stage-unit.yml` renders the same chart, with the same values files, into the same
namespace and release. `split-release.sh --status` answers `none` (no namespace
`nx-portfolio`) and `rename-release.sh --status` answers `none` (no namespace
`luna-shopper` after its step 9), so the preflight does nothing. If the import comes more
than 14 days after the production rename, the `luna_<x>` fallback of
`restore-database.sh` (k8s `0019` D3) is dead and is dropped in the new repository.

Two differences are expected and harmless. A staging deploy restarts the affected
Deployments anyway, because the `staging` tag is mutable (`deploy-unit`), so pods are new
while the specs are equal. The restart list is the rule of docs `0003` D5: every Deployment
of the release whose container image is one of the images this run built, read from
`helm get manifest`. It never assumes that a Deployment is named after its project, so it
holds unchanged in the new repository. When owner decision 2 moves the registry path, the image
repository of each Deployment changes: a rolling update to the same bytes under another
name, which the comparison of 4.2 shows as the only difference.

### 4.2 How to prove it

Before the first run, on a machine with `helm`:

```sh
helm dependency build k8s/helm/velista
helm template velista k8s/helm/velista -n velista \
  -f k8s/helm/velista/values.yaml -f k8s/helm/velista/values.staging.yaml \
  --set imageTag=staging > /tmp/new.yaml        # in the Velista clone
# the same command in nx-portfolio at the import commit > /tmp/old.yaml
diff /tmp/old.yaml /tmp/new.yaml
```

Repeat with `values.production.yaml` and the live production tag. Then, on each host as
the deploy account, compare the live release with the new render: `helm get manifest
velista -n velista` against the same `helm template` with the live `imageTag`.

### 4.3 What the first run looks like

The first staging run builds every image of the unit (no last green run in the new
repository), runs both gates, and deploys. The first production deploy is the first Release
of the new repository, `velista-vX.Y.Z` above the last number of `nx-portfolio`. Until that
Release exists, `redeploy.yml` of the new repository refuses every production version, and
the way back is `helm rollback velista <revision> -n velista` on the host. A version released
from `nx-portfolio` cannot be redeployed from the new repository.

### 4.4 The order on the day

The push of the import commit to `main` of the new repository starts its
`staging-velista.yml` at once. So the velista environments of the new repository are
written only at step 4 below; before that, a deploy job finds an environment with no values
(GitHub creates an environment that a job names, empty) and stops before SSH.

1. The new repository is green on `pr.yml` for a pull request into its `dev`, and the
   `helm template` comparison of 4.2 is clean.
2. A dry run: the first `staging-velista.yml` run of the new repository (the import push,
   or a dispatch) builds every image, pushes it, runs both gates, and stops at the readable
   summary of `deploy-unit` "The environment names a host", before any SSH. That proves the
   build, the push to the registry and the gates.
3. In `nx-portfolio`, the owner disables `staging-velista.yml` and `release-velista.yml`
   (Actions, the workflow, "Disable workflow", or `gh workflow disable`). Deleting them on
   `dev` is not enough, because the callers run from `main` and `dev` reaches `main` only in
   a rollup. From here no push to `main` of `nx-portfolio` deploys velista.
4. The owner writes the velista environments of the new repository and re-runs its deploy
   job. With a green staging deploy, the removal pull request of section 3.1 merges into
   `nx-portfolio` `dev`.
5. The next velista Release is published in the new repository and deploys production.

Between steps 3 and 5 neither repository deploys velista production. That window should be
short, and no velista production change is planned inside it.

## Decisions taken in this plan

- **D1. Fresh history.** Commit one is `LICENSE`, commit two the import. The alternative,
  `git filter-repo --path apps/luna-shopper-backend --path apps/velista ... --path-rename
  apps/luna-shopper-backend:apps/velista-server ...`, keeps the commits of the moved
  directories. The plan prefers the fresh start: the owner asked for the license in commit
  one, which a rewrite cannot give without placing the license before history it did not
  cover; a rewrite gives every kept commit a new SHA, and plans, memories and PR bodies cite
  SHAs of `nx-portfolio`; the old PR numbers keep their meaning in `nx-portfolio`, where the
  pull requests are. What is lost in the new repository: `git blame` stops at the import
  commit, and `git log` of a file shows nothing before it. Both stay available in
  `nx-portfolio`, and the import commit message names the source SHA for that lookup.
  Owner decision 3.
- **D2. One import commit from one source commit**, so the import is checkable and the
  pruning is reviewable on its own.
- **D3. The RokuTranslator pair is copied and renamed** to `@velista/localization/*`.
  `@portfolio` has no meaning in the new repository. The alternative, keeping
  `@portfolio/localization/*` to ease a later merge back, is rejected because the two copies
  will drift and no merge back is planned.
- **D4. `service-token.ts` folds into `@velista/client/platform`.** One 76 line file. The
  admin imports it from there too, or gets its own copy if the client platform library
  drags in what the admin must not have (the builder checks the graph and says which). A new
  `@velista/shared/data-access` library for one file is rejected.
- **D5. The eight icons move into the admin's `ui` library**, with their SVG files. The
  `shared/ui` barrel is not copied, because it brings `shared/util` and the portfolio's
  components with it. `CLAUDE.md` of the new repository states where icons live.
- **D6. `tools/docker` is copied and its package renamed `@velista/docker`**, with every
  `executor` reference in `project.json` files updated. Keeping `@portfolio/docker` would
  leave the one `@portfolio` name in the new repository.
- **D7. The skill `nx-portfolio-angular-developer` is copied as `velista-angular-developer`**,
  with the module federation and remote sections removed and its reference implementations
  moved from `damoclesSword` and `landingV2` to `velista-client`. Dropping it would lose the
  RokuTranslator, zoneless and spec conventions that the client follows.
- **D8. The plans are copied with their PR links as they are.** Each link keeps pointing at
  `IchirokuXVI/nx-portfolio`, which stays readable. New plans continue each directory's
  numbering (backend `0244` and so on, after the series).
- **D9. `PEER_NAMESPACES`** when the `/velista` mount survives (section 3.2), rather than a
  stub `unit.env` of the other unit, which `units.mjs` and `github-environments.sh` would
  treat as a unit of the repository.

## Owner decisions

1. **Account or organisation.** `IchirokuXVI/Velista` under the account, or a new
   organisation. The plan recommends the account unless the owner wants the registry path
   `ghcr.io/<organisation>/...` and the name on the repository page; an organisation is a
   second place to hold settings and packages. No organisation name is proposed here.
2. **Registry path.** Under the account, `ghcr.io/ichirokuxvi/<image>` keeps every Deployment
   spec equal (section 4); under an organisation, the first deploy changes the image field of
   every Deployment. Recommendation: follow decision 1.
3. **History mode.** Fresh history (recommended, D1) or `git filter-repo`.
4. **`docker/ddns` and the homelab files.** `docker/ddns` serves the portfolio's zone.
   Recommendation: it stays in `nx-portfolio`. `k8s/helm/velista/values.homelab.yaml`,
   `k8s/helm/deploy-homelab.sh` and `k8s/README-homelab.md` move with the chart, as they are,
   unless decision 5 takes them private.
5. **The owner's values in a public repository.** `values.staging.yaml`,
   `values.production.yaml`, the hosts of `unit.env` and the homelab files go into the
   public repository as they are today, unless the owner picks up k8s backlog `0003`.
   Recommendation: keep them public for now and pick backlog `0003` up later. Nothing secret
   is in them: the Google client id is public by design, the ACME email is in certificate
   transparency logs anyway, and every secret is provisioned on the host. Before the import,
   check: `git grep -nE "BEGIN [A-Z ]*PRIVATE KEY|sk-ant-|ghp_|github_pat_|AKIA"` over the
   tree (on 2026-11-03 it finds only fake values in specs and tests, and the comment in
   `github-environments.sh`; the PEM under `apps/luna-shopper-backend/harvester/docs/research`
   is a public CA certificate); `tmp/` is ignored and is not copied; `.env.development` and
   `.env.production` hold only `NODE_ENV`; `apps/velista/android/keystore.properties` is
   ignored and is not copied.
6. **Which repository runs host maintenance.** One of them, never both. Recommendation: the
   new repository, because the stateful workload, the backup schedule that host maintenance
   is timed after, and most Renovate updates live there. The other repository deletes
   `host-maintenance.yml` and `host-patch.yml` and its Renovate manager for `install.sh`.
   In that repository, `provision-host.sh` changes its default `--repo`
   (`k8s/bootstrap/provision-host.sh:76`) and its clone directory, hard coded as
   `$ADMIN_HOME/nx-portfolio` (`:349`), and the hint of `host-patch.yml:122` follows. Each
   host's admin account then clones that repository (docs `0006` phase 5).
7. **A ruleset on `dev`** with the required checks of section 2.2, or none as today.
   Recommendation: require them; a red PR into `dev` is what `CLAUDE.md` already forbids.
8. **The tag of the import commit** for `release-notes.mjs --from`. Recommendation:
   `velista-import`, which `release-unit.yml` ignores because it does not match
   `velista-v*`.
9. **The `name` of `package.json`.** Recommendation: `@velista/source`, mirroring today's
   `@portfolio/source`.

## Owner steps outside the code

All of them are in docs `0006` phase 4 and phase 5, in order, with the commands and the
checks. In short: create the repository with no README and no license from a template,
install Renovate, write the environments, add `AUTOMATION_TOKEN`, grant package access,
create the rulesets, move `tmp/` and the Android keystore by hand, stop every slot and
worktree of the old checkout, disable the old callers at step 3 of section 4.4, and publish
the first Release of the new repository.
