# 0014 A deploy unit is a tag, a chart and two environments

> Asked for by the owner on 2026-10-23: "isolate velista and luna-shopper deployments from
> portfolio/other projects deployments. The shell will keep deploying odontogram, landing and
> every remote by his own. luna-shopper-admin, luna-shopper-backend and velista might have
> different deploys at some point too, so think about every app in the repo being able to be
> deployed by itself or with other apps. No need to make luna-shopper and velista deploy
> separately, for now the 3 apps will be together. Build, test and other common things can be
> done with NX, but the deployment will be in a different kubernetes namespace, different
> server... for now it will actually be the same server, only the namespace will differ but
> github actions needs new parameters specific for velista. This is to allow velista to work
> on its own, so I have the option to create new servers without deploying the whole
> portfolio."
>
> This is the first of four plans. It defines the vocabulary and the registry that `0015`
> (the charts), `0016` (the deploy path) and `0017` (the releases) build on. It changes no
> cluster and no deploy. Read all four before you build any of them. The series sits on top
> of the open pull requests #809 (velista plan 0165, velista leaves the shell) and #810
> (velista plans 0166 and 0167, the Android app), and every statement below was read on the
> branch of #810 at `e5320be3`.
>
> Prerequisite reading: `0002` (one environment per cluster, one values file per
> environment), `0003` (deploys that wait and report), `0006` (scripts provision the
> cluster, not prose), `0007` (the bundle is built one time outside Docker), `0011` (release
> tasks run in a window), `0013` (host maintenance and the GitHub environments it created),
> `apps/velista/plans/0165-velista-leaves-the-shell.md` (the `mounts` schema and the
> portfolio path of velista), and the `Docker & CI/CD` section of `CLAUDE.md`.

## Brief for the agent

### Objective

Give the repository one definition of a deploy unit, declare the two units that exist
today, and write the one registry that every later plan and every workflow reads. After this
plan, a reader can answer "which apps deploy together, into which namespace, under which
release name, through which GitHub environments" from one directory, and a check in the pull
request workflow fails when a deployable project belongs to no unit or to two.

Use `antislop` with `antislop-code` for every comment you write.

### Context

Every statement below was read on the branch of PR #810 at `e5320be3`.

- **There is one deployment unit per cluster today.** One chart (`k8s/helm`), one Helm
  release `nx-portfolio` (hard coded at `.github/workflows/docker-ci.yml:970` and defaulted
  in `k8s/helm/deploy-release.sh:38`), one namespace `nx-portfolio` (`k8s/helm/values.yaml:1`,
  `k8s/namespace.yaml`). Every staging deploy re-applies all thirteen images and every
  route. Staging runs `helm upgrade --atomic`, so a failure in velista rolls the portfolio
  back too, and the reverse.
- **CI selects deployable apps by target, not by group.** `docker-ci.yml:190` lists
  `nx show projects --affected --type app --with-target build:docker`. The Luna services are
  then picked out by the name prefix `^luna-shopper-backend-` (`:214`). The deployment names
  are the lowercased project names (`:212`). No project carries a tag that names its group.
  The only tags in the workspace are `microfrontend:angular` on the shell and
  `type:static-docker` / `type:dynamic-docker` on the two `apps/docker` projects.
- **The deploy job needs every gate.** `docker-ci.yml:805-813` makes the one deploy job
  depend on `e2e-frontend`, `e2e-luna` and `e2e-velista-luna`. A red velista gate blocks a
  portfolio deploy.
- **Secrets are repository scoped.** `SSH_DEPLOY_HOST`, `SSH_DEPLOY_HOST_STAGING`,
  `SSH_DEPLOY_USER` and `SSH_DEPLOY_KEY` serve both environments and every app. The GitHub
  environments `host-staging` and `host-production` exist (plan 0013) and are used only by
  host patching.
- **One version stream.** A GitHub Release `vX.Y.Z` (the latest is `v0.14.2`) rebuilds every
  image and pins the whole chart with `--set imageTag=<version>`. velista's
  `VELISTA_APP_VERSION`, the gateway's `minClientVersion` (`values.production.yaml:76`) and
  the `PRODUCTION_RELEASE` of each release task use the same numbers.
- **Release note scopes already separate the groups.** `tools/release/rules.mjs:50-95` lists
  `shell, odontogram, damoclesSword, landingV2` and `velista, luna, luna-shopper, gateway,
  realtime, auth, core, catalog, harvester, assistant, contracts, admin, luna-shopper-admin`
  in separate comment blocks, plus workspace scopes (`shared, i18n, k8s, helm, docker, ci,
  tools, e2e, deps, release`) and the retired `android`. Nothing maps a scope to a group.
- **The velista side already stands alone in the chart.** Everything behind
  `lunaShopperBackend.enabled` is Luna named, every Secret the provisioner writes is Luna's,
  the portfolio apps own no Secret, ConfigMap or volume, and `hostOverrides` already puts
  velista, admin, api and rt on the `velista.app` zone.
- **The portfolio path of velista crosses the two groups.** After PR #809, HTTPRoute
  `velista-portfolio` serves `ichirokuxvi.com/velista` from the velista Service with the
  prefix kept, the landing links to `/velista/<locale>`, and the backend's CORS list names
  the portfolio origin.
- **The repository has a precedent for a small registry read by scripts and CI.**
  `k8s/release-tasks/tasks/NNNN-*/task.env` is a shell sourceable file, read as text by
  `k8s/release-tasks/check-tasks.mjs`, tested with `node --test`, and run in `pr.yml` and
  in both deploy jobs.

### Target state

- `tools/release/rules.mjs` exports `UNITS`, a map from unit name to the scopes that belong
  to it, and `WORKSPACE_SCOPES`, the scopes that belong to no unit.
- Every project with a `build:docker` target carries exactly one tag `deploy:<unit>`, and
  `<unit>` names a directory `k8s/units/<unit>/` with a `unit.env`.
- `tools/deploy/units.mjs` lists units, prints the projects of a unit, and checks the
  invariants in section 3. `pr.yml` runs the check next to `check-tasks.mjs`.
- `CLAUDE.md` and `k8s/README.md` explain what a unit is and how to add or split one.
- Nothing deploys differently. The staging and production workflows, the chart and the
  cluster are unchanged by this plan.

### Scope

`tools/release/rules.mjs` and its test, `tools/deploy/units.mjs` with `units.test.mjs`,
`k8s/units/portfolio/unit.env`, `k8s/units/velista/unit.env`, one `tags` line in each
deployable `project.json`, `nx.json` (`sharedGlobals`), `.github/workflows/pr.yml`,
`CLAUDE.md`, `k8s/README.md`.

### Constraints

- The check must run with Node alone, with no `nx` process, so that it is cheap in `pr.yml`.
  Read each `project.json` as a file. Tags are static JSON.
- `unit.env` is shell sourceable (`KEY=value`, no spaces around `=`, values quoted when
  they hold spaces) and read as text by Node, as `task.env` is.
- No field of `unit.env` repeats what a chart values file states. The hosts of a unit are
  the one exception, and section 3 says why.
- Keep the image names (`ghcr.io/ichirokuxvi/nx-portfolio/<app>`) as they are. The registry
  path is a storage detail, and a rename gains no isolation.

### Action boundaries

- Do not create the charts, the workflows or the GitHub environments. They are `0015`,
  `0016` and the owner's part of `0016`.
- Do not rename any project, image, namespace or release.
- Stop and ask before you touch any `.env` writer (`luna-slot.sh`, `ng-slot.sh`).

### Progress evidence

`node tools/deploy/units.mjs check` passes on the branch and fails (with the file named)
when a tag is removed from one `project.json` in a scratch run. `node --test
tools/deploy/units.test.mjs` and the rules test pass. A green `pr.yml` with the new step.

## 1. Purpose

A monorepo is not a monolith. The workspace keeps one dependency graph, one `affected`
computation, one lint, one test run and one build. The deployments stop being one thing.
Each **deploy unit** is a set of apps that ship together, into one Kubernetes namespace,
under one Helm release, from one GitHub environment per stage, under one version stream.
Two units exist today:

| Unit | Apps | Namespace | Release | Tag prefix | GitHub environments |
| --- | --- | --- | --- | --- | --- |
| `portfolio` | shell, odontogram, damoclesSword, landingV2 | `portfolio` | `portfolio` | `portfolio-v` | `portfolio-staging`, `portfolio-production` |
| `velista` | velista, luna-shopper-admin, luna-shopper-backend-{gateway, realtime, auth, core, catalog, harvester, assistant} | `nx-portfolio` (section 3 D3) | `velista` | `velista-v` | `velista-staging`, `velista-production` |

The owner's words fix the grouping: the three velista apps stay together for now, and the
shell keeps shipping its remotes. The design must make the next split (admin alone, backend
alone, velista web alone) a matter of a tag, a chart directory and two environments, with
no workflow edit. Section 4 is that recipe.

## 2. What stays true

- Nx builds, lints and tests the whole workspace. `nx affected` decides what changed, from
  the graph and not from path filters, because a shared library change must rebuild the apps
  of both units.
- The bundle is built one time outside Docker and copied into the image (plan 0007).
- One environment per cluster, one values file per environment (plan 0002). A unit adds a
  dimension: one values file per unit per environment.
- The deploy account is unprivileged and runs helm and kubectl from its home (plan 0006).
- Release tasks run in a window and refuse data they were not written for (plan 0011). They
  all touch Luna data, so they belong to the velista unit.

## 3. Decisions

### D1. A unit is declared in two places that a check keeps equal

The **tag** `deploy:<unit>` on a `project.json` says which unit an app ships with. Nx reads
it: `nx show projects --affected --with-target build:docker --projects tag:deploy:velista
--json` is the image list of a staging run, and `--projects tag:deploy:velista` without
`--affected` is the image list of a release. The tag is the only place that names an app's
unit, so moving an app is one line.

The **registry** `k8s/units/<unit>/unit.env` says what the unit is made of besides its apps:

```sh
UNIT=velista
NAMESPACE=nx-portfolio
RELEASE_NAME=velista
CHART=k8s/helm/velista
TAG_PREFIX=velista-v
# Gate directories under k8s/e2e, in the order they run. Plan 0016 defines a gate.
GATES="luna-shopper-backend velista-luna"
# The Secrets that provision-release.sh writes for this unit, and that --check asserts.
SECRETS="luna-shopper-backend-secrets luna-shopper-backend-auth-db-secret luna-shopper-backend-core-db-secret luna-shopper-backend-catalog-db-secret luna-shopper-backend-harvester-db-secret luna-shopper-backend-backup-secret"
RELEASE_TASKS=true
# The public hosts, one list per environment. Read by host maintenance and the endpoint
# checks; asserted against the rendered Gateway by `units.mjs check` from plan 0015 on.
HOSTS_STAGING="staging.velista.app admin.staging.velista.app api.staging.velista.app rt.staging.velista.app"
HOSTS_PRODUCTION="velista.app admin.velista.app api.velista.app rt.velista.app"
# The variables the bundle build of this unit needs, per environment. Today they are
# literals in the workflow env blocks. Plan 0016 reads them from here.
BUILD_ENV_STAGING="LUNA_GATEWAY_URL=https://api.staging.velista.app LUNA_REALTIME_URL=https://rt.staging.velista.app VELISTA_APP_URL=https://staging.velista.app"
BUILD_ENV_PRODUCTION="LUNA_GATEWAY_URL=https://api.velista.app LUNA_REALTIME_URL=https://rt.velista.app VELISTA_APP_URL=https://velista.app"
```

The portfolio file has `NAMESPACE=portfolio`, `RELEASE_NAME=portfolio`,
`CHART=k8s/helm/portfolio`, `TAG_PREFIX=portfolio-v`, `GATES="portfolio-frontend"`,
`SECRETS=""`, `RELEASE_TASKS=false`, the hosts `staging.ichirokuxvi.com
mfe.staging.ichirokuxvi.com` and `ichirokuxvi.com mfe.ichirokuxvi.com`, and
`MFE_BASE_URL=https://mfe.staging.ichirokuxvi.com` and `MFE_BASE_URL=https://mfe.ichirokuxvi.com`
as its build variables. `VELISTA_APP_VERSION` is not listed: it is the run's tag or version,
and the pipeline sets it.

Why two places and not one: the tag lives where Nx can query it with `--affected`, which no
registry can do. The registry lives where Bash scripts on the host can source it, where no
Nx exists. `units.mjs check` keeps them equal (D4). The hosts are repeated from the values
files on purpose: host maintenance runs on a GitHub runner against a server that may be
down, and must know the URLs without a render. The check asserts that the list equals the
hostnames of the rendered Gateway, once the chart exists (`0015`).

The `CHART`, `GATES`, `SECRETS`, `RELEASE_TASKS` and `BUILD_ENV_*` fields have no reader
until `0015` and `0016`. They are declared now so that the registry is complete from the first commit and
the later plans add readers, not fields.

### D2. Unit names, and what is not a unit

The units are `portfolio` and `velista`. The name of the velista unit is the product the
owner ships, not `luna` and not `luna-shopper`, because the back office and the backend
exist to serve velista and the owner groups them under it. If the backend splits later it
becomes its own unit under its own name (section 4).

Not a unit: `docker/local-http-server` (the nginx base image of every frontend) and
`docker/builder`. They are workspace artifacts that any deploying workflow builds for its
own tag. Plan `0016` D6 fixes their tag. The e2e projects are not units either. A gate
belongs to a unit through `GATES`.

### D3. Namespaces: the stateless unit moves, the stateful one stays

The portfolio unit gets the namespace `portfolio`. The velista unit keeps `nx-portfolio`
for now.

The reason is data. The velista unit owns four Postgres StatefulSets, NATS, their PVCs,
their Secrets and the release task ledger, all in `nx-portfolio`. A Kubernetes namespace
cannot be renamed, so moving the unit means moving the volumes (PV rebinding or dump and
restore), copying the Secrets verbatim, and a window. The portfolio unit owns four stateless
nginx pods and two certificates. Moving it is a fresh install. Plan `0016` D5 is the cutover
for both.

The name `nx-portfolio` for the velista namespace is the honest cost of this choice. It is
a values key of the unit and nothing else reads it, so it can change later without a
redesign. The natural moment is the move to its own server (backlog `0002`), where a restore
into a fresh cluster is the move anyway and the namespace is `velista` from the start.

Alternatives the owner can pick instead, each one line in `unit.env` plus the cutover work:

- **B.** velista moves to `velista` now and the portfolio keeps `nx-portfolio`. Cost: a
  stateful move in staging and production (dump through the existing backup CronJobs,
  restore with `restore-database.sh`, or PV rebinding on `local-path`), the Secrets copied
  with `kubectl get secret -o yaml` and never regenerated (a regenerated
  `HARVESTER_ACTOR_ID` orphans every catalog row the harvester wrote, and regenerated JWT
  keys sign every user out), and a downtime of the API for the length of the restore.
- **C.** Both move and `nx-portfolio` disappears. Cost of B plus nothing.

### D4. One check, in the pull request workflow

`tools/deploy/units.mjs` has three commands:

- `list` prints every unit as JSON (`name`, the fields of `unit.env`, `projects`).
- `projects <unit>` prints the project names tagged `deploy:<unit>`, one per line, for shell
  loops that have no Nx.
- `check` fails with the file and the reason when: a project with `build:docker` carries no
  `deploy:` tag or more than one; a tag names a unit with no directory; a unit has no
  project; a required key of `unit.env` is missing or empty where it must not be
  (`SECRETS` may be empty, `HOSTS_*` may not); a `GATES` entry names no directory under
  `k8s/e2e`; the `TAG_PREFIX` of two units collide or one is a prefix of another; from
  `0015` on, the `CHART` directory exists and its rendered Gateway hostnames equal `HOSTS_*`.

It reads `project.json` files directly (a glob over `apps/**/project.json`), so it needs no
Nx daemon and finishes in well under a second. `pr.yml` runs `node --test
tools/deploy/units.test.mjs` and `node tools/deploy/units.mjs check` beside the
`check-tasks` steps. The deploy workflows of `0016` run the check too, before any SSH.

### D5. Scopes map to units in `rules.mjs`

```js
export const UNITS = {
  portfolio: ['shell', 'odontogram', 'damoclesSword', 'landingV2'],
  velista: ['velista', 'luna', 'luna-shopper', 'gateway', 'realtime', 'auth', 'core',
            'catalog', 'harvester', 'assistant', 'contracts', 'admin', 'luna-shopper-admin',
            'android'],
};
export const WORKSPACE_SCOPES = ['shared', 'i18n', 'k8s', 'helm', 'docker', 'ci', 'tools',
                                 'e2e', 'deps', 'release'];
```

A test asserts that every scope in `SCOPES` is in exactly one unit or in
`WORKSPACE_SCOPES`, and that the unit keys equal the directories under `k8s/units`. The map
has no reader until `0017` gives `release-notes.mjs` a `--unit` flag. A PR title with a
workspace scope lands in the notes of every unit. That is the honest answer for a shared
library change that ships twice.

### D6. `nx.json` names the real workflow files

`nx.json:18` lists `{workspaceRoot}/.github/workflows/ci.yml` in `sharedGlobals`, a file
that does not exist. Replace it with the files that `0016` will create and that exist today
(`docker-ci.yml`, `release.yml`, `pr.yml`), so that a workflow change invalidates the cache
as the input intends. `0016` updates the list when it renames them.

## 4. How a unit splits or a new one appears

The recipe, so that the owner can judge whether the design keeps its promise. Nothing here is
built now.

1. Decide the name and which apps move. Retag them `deploy:<new>`.
2. Create `k8s/units/<new>/unit.env` and `k8s/helm/<new>/` (copy the closest chart, keep only
   the moved apps in its values, keep the library chart dependency).
3. Create the GitHub environments `<new>-staging` and `<new>-production` with the same four
   secret names as every other unit, and the two thin caller workflows of `0016` D2.
4. Run the cutover of `0016` D5 for the new unit (it adopts what already exists, so a split
   is a cutover with a shorter list).
5. Add the scopes of the moved apps to `UNITS`, seed the first tag `<new>-v<current>`.

Two rules for a split:

- **The stateful member keeps the namespace.** When admin or the velista web leaves the
  velista unit, the backend keeps `nx-portfolio` (or whatever the velista namespace is by
  then) and the stateless app gets a fresh namespace. Data never moves for a split.
- **Cross unit traffic goes through a public hostname or an explicit grant, never through a
  namespace local Service name.** Today the one cross unit edge is the portfolio path of
  velista (plan `0015` D6). A new edge is a new decision in the plan that creates it.

## 5. Who edits what

One builder, one PR, title `feat(ci): a deploy unit is a tag, a registry and a check (plan
0014)`. Files: `k8s/units/portfolio/unit.env`, `k8s/units/velista/unit.env`,
`tools/deploy/units.mjs`, `tools/deploy/units.test.mjs`, `tools/release/rules.mjs`,
`tools/release/release-notes.test.mjs`, `apps/*/project.json` (thirteen `tags` edits),
`nx.json`, `.github/workflows/pr.yml`, `CLAUDE.md`, `k8s/README.md`.

## 6. Acceptance

- `node tools/deploy/units.mjs list` prints two units with four and nine projects.
- `node tools/deploy/units.mjs check` exits 0. Remove the tag from
  `apps/odontogram/project.json` in a scratch run: it exits 1 and names the file.
- `npx nx show projects --projects tag:deploy:velista --with-target build:docker --json`
  prints the nine velista projects.
- `node --test tools/deploy/units.test.mjs tools/release/release-notes.test.mjs` passes.
- `pr.yml` is green with the new steps. `docker-ci.yml` and `release.yml` are untouched.

## 7. `CLAUDE.md`

Add to the `Docker & CI/CD` section, after the bullet on the two clusters:

> **Apps deploy in units** (k8s plan 0014). A unit is a set of apps that ship together into
> one namespace under one Helm release and one version stream. The tag `deploy:<unit>` on a
> `project.json` names the unit of an app, and `k8s/units/<unit>/unit.env` names the
> namespace, the release, the chart, the gates and the hosts. `node tools/deploy/units.mjs
> check` keeps the two equal and runs on every PR. The units are `portfolio` (the shell and
> its three remotes) and `velista` (velista, the back office and the seven Luna services).
> To move an app, change its tag. To split a unit, follow section 4 of the plan.

Replace the existing sentence "A new deployable app needs these things" list's chart bullet
with: "A `deploy:<unit>` tag, and one entry in the `apps` of that unit's chart values."

## 8. Decisions left for the owner

1. **D3, the namespace of the velista unit.** `nx-portfolio` for now (recommended), or a
   stateful move to `velista` now (B or C).
2. **D2, the unit names.** `portfolio` and `velista`, or other words.
3. **Whether `android` stays a velista scope.** It is retired; it is listed so old titles
   parse into velista's notes.

## 9. Sources

The shape of this series follows the current guidance of the tools in use:

- Nx on tags and `--projects tag:` queries, and on `affected` from the graph rather than
  path filters: https://nx.dev/docs/reference/nx-commands and
  https://nx.dev/docs/kb/affected-base-commit. Nx on "a monorepo is not a monolith":
  https://nx.dev/blog/monorepo-is-not-monolith.
- Nx Release groups and independent versioning, considered and not adopted (`0017` D6):
  https://nx.dev/docs/guides/nx-release/release-groups and
  https://nx.dev/docs/guides/nx-release/release-projects-independently.
- GitHub reusable workflows and environments: https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows
  and https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments.
- Helm library charts: https://helm.sh/docs/topics/library_charts/.
- Gateway API across namespaces and ReferenceGrant: https://gateway-api.sigs.k8s.io/guides/multiple-ns/
  and https://gateway-api.sigs.k8s.io/reference/api-types/referencegrant/.
- Envoy Gateway deployment modes (merged gateways): https://gateway.envoyproxy.io/docs/tasks/operations/deployment-mode/.
- cert-manager with the Gateway API: https://cert-manager.io/docs/usage/gateway/.
- A public monorepo with thin callers over one reusable deploy workflow (Novu):
  https://github.com/novuhq/novu/tree/next/.github/workflows.
