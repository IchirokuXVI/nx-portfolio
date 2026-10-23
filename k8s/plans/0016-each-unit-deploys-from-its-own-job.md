> **PR:** [#818](https://github.com/IchirokuXVI/nx-portfolio/pull/818)

# 0016 Each unit deploys from its own job

> Third plan of the deploy unit series (`0014` the unit, `0015` the charts, `0017` the
> releases). This plan replaces the two deploy workflows with one pipeline per unit, moves
> the deploy parameters into GitHub environments, turns the e2e gates into per unit scripts,
> and performs the cutover from one release to two on each cluster. After it, a change to
> velista never deploys the portfolio and a red velista gate never blocks the portfolio.
> Every statement below was read on the branch of PR #810 at `e5320be3`.
>
> Prerequisite reading: `0003` (deploys that wait and observe), `0007` (build one time,
> deploy from its own job), `0009` (a bundle that cannot load never reaches staging), `0011`,
> `0013` (the `host-staging` and `host-production` environments, the concurrency groups
> host patching shares with the deploys), `0014`, `0015`, `apps/velista/plans/0165` D7 and
> D8, `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md`, `.github/actions/workspace/action.yml`.

## Brief for the agent

### Objective

Make every unit ship through the same reusable pipeline, parameterised by its `unit.env`
and by a GitHub environment that holds its host and key. Cut both clusters over from the
one release `nx-portfolio` to the releases `portfolio` and `velista` with a script that is
idempotent, runs from the deploy preflight, and costs one short planned interruption. Delete
the old chart and the old workflows when the cutover is done.

Use `antislop` with `antislop-code` for every comment you write.

### Context

Every statement below was read on the branch of PR #810 at `e5320be3`.

- **`docker-ci.yml`** (staging, on push to `main`): `setup` finds the last successful run of
  this workflow (`gh run list --workflow`, `:148-158`) and lists the affected projects
  (`:184-191`); `lint-test`; `build` builds the base image on the runner (`:321-325`), then
  the bundles inside the build image with `MFE_BASE_URL`, `LUNA_GATEWAY_URL`,
  `LUNA_REALTIME_URL`, `VELISTA_APP_URL`, `VELISTA_APP_VERSION=staging` (`:337-351`), then
  `DOCKER_IMAGE_TAG=staging nx run-many -t build:docker` (`:377-384`); three gates
  (`e2e-frontend` `:393-555`, `e2e-luna` `:568-642`, `e2e-velista-luna` `:663-792`); one
  `deploy` (`:804-1050`) that needs every gate, rsyncs `./k8s/` to `~/k8s/` with `--delete`
  (`:896-897`), runs the preflight over SSH (`:906-915`), `helm upgrade --install
  nx-portfolio --atomic` (`:970-975`), restarts and watches the affected Deployments
  (`:1008-1021`), runs the release tasks and diagnoses on failure. Concurrency group
  `staging-deploy` (`:41-43`). SSH with `StrictHostKeyChecking=no` (`:102`).
- **`release.yml`** (production, on a published Release): builds every image with
  `DOCKER_IMAGE_TAG=<version>,latest`, no gate, `deploy-release.sh <version>` over SSH,
  concurrency `production-release`. `VELISTA_APP_URL` is not set in that build, so velista
  and the Capacitor config fall back to `https://velista.app`.
- **Secrets are repository scoped**: `SSH_DEPLOY_HOST`, `SSH_DEPLOY_HOST_STAGING`,
  `SSH_DEPLOY_USER`, `SSH_DEPLOY_KEY`; the variable `SSH_KNOWN_HOSTS` is read only by
  `host-patch.yml`. The environments `host-staging` and `host-production` (plan 0013) are
  used only by host patching, through `host-patch.yml`, which takes a `concurrency-group`
  input and passes `staging-deploy` or `production-release` so that a patch never overlaps a
  deploy (`host-maintenance.yml:67,84`).
- **The gates mix units.** `e2e-velista-luna` starts the portfolio compose stack
  (`k8s/e2e/portfolio-frontend/compose.yml` plus `compose.luna.yml`, `:739-740`) only to
  reach velista through its proxy. The frontend compose still starts a `landing` service
  from an image that no project builds. `e2e-frontend` checks velista under the portfolio
  path and on its own origin (`:489-529`), which is the contract of plan 0165 D7.
- **The base image crosses environments.** Every frontend image is `FROM
  nx-portfolio/local-http-server:${BUILDER_TAG}` and CI never sets `BUILDER_TAG`, so the
  default `latest` applies. Staging pushes `latest` whenever the base is affected
  (`:321-325`), and the next production release builds on it.
- **GitHub reusable workflows**: a job calls one with `uses:` at job level; the called
  workflow's job may set `environment:` and the calling job may not; `secrets: inherit`
  passes the caller's secrets; an environment's secrets reach a job that names the
  environment, after its protection rules; environments carry deployment branch and tag
  rules; a job level `concurrency` on the caller applies to the called run.
- **Helm adoption**: Helm takes over an existing object when it carries the annotations
  `meta.helm.sh/release-name` and `meta.helm.sh/release-namespace` and the label
  `app.kubernetes.io/managed-by: Helm`. `helm uninstall` leaves an object alone when it
  carries `helm.sh/resource-policy: keep`.
- **Envoy Gateway in merged mode** rejects a second listener with the same port, protocol
  and hostname. The old Gateway and a new Gateway for the same host cannot coexist.
- **`pr.yml`** runs `check-tasks.mjs` and, from `0014`, `units.mjs check`.
- `image-scan.yml` hard codes thirteen image names. `host-maintenance.yml` hard codes six
  endpoints per environment.

### Target state

- `.github/workflows/stage-unit.yml` and `release-unit.yml` are reusable pipelines. Four
  thin callers exist: `staging-portfolio.yml`, `staging-velista.yml`, `release-portfolio.yml`,
  `release-velista.yml`. `docker-ci.yml` and `release.yml` are deleted.
- The deploy steps live in one composite action `.github/actions/deploy-unit`. A unit's host,
  user, key and known hosts come from its GitHub environment.
- A gate is a directory under `k8s/e2e` with `gate.sh` and `gate.env`. The velista unit no
  longer needs the portfolio stack to test itself.
- `k8s/bootstrap/split-release.sh --env <e>` has run on staging and on production. `helm
  list -A` shows `portfolio` in `portfolio` and `velista` in `luna-shopper`, and the
  namespace `nx-portfolio` is gone. The old chart files are deleted.
- `image-scan.yml` and `host-maintenance.yml` read their lists from the registry.

### Scope

`.github/workflows/{stage-unit,release-unit,staging-portfolio,staging-velista,release-portfolio,release-velista,image-scan,host-maintenance}.yml`,
`.github/actions/deploy-unit/action.yml`, deletion of `docker-ci.yml` and `release.yml`,
`k8s/e2e/portfolio-frontend/**`, `k8s/e2e/luna-shopper-backend/gate.*`,
`k8s/e2e/velista-luna/**` (new), `k8s/bootstrap/split-release.sh` (new),
`k8s/bootstrap/install.sh` (`--merge-only`, the takeover of the live pool),
`k8s/bootstrap/host-patch.sh` and `k8s/bootstrap/provision-host.sh` (the host lock),
`k8s/helm/deploy-release.sh` (the lock), deletion of `k8s/helm/Chart.yaml`,
`k8s/helm/templates/`, `k8s/helm/values*.yaml` and `k8s/helm/.helmignore`,
`apps/docker/local-http-server/project.json`,
`tools/deploy/units.mjs` (an `endpoints` command), `CLAUDE.md`, `k8s/README.md`,
`k8s/README-new-cluster.md`, `CONTRIBUTING.md`.

### Constraints

- Build one time per pipeline run, outside Docker, as plan 0007 states. The build of a unit
  covers that unit's affected images and the base image.
- Deploys wait and the workflow observes (plan 0003). Staging keeps `--atomic`, production
  keeps `--wait` with no `--atomic`, for the reasons `deploy-release.sh` records. The
  installs of the cutover (D5) use neither, because a failed install under `--atomic` is an
  uninstall, and an uninstall of a release that adopted live objects deletes them.
- A deploy never runs with a host key check off. The known hosts come from the
  environment's `SSH_KNOWN_HOSTS` variable, as host patching does.
- The cutover script is idempotent, has a `--plan` mode that only prints, refuses to run
  when it cannot read both charts, and leaves the cluster as it found it when a step before
  the swap fails. It is run from the preflight so that the order of merges cannot break a
  cluster, and by hand when the owner prefers.
- Every workflow file keeps the `renovate:` comments that `0013` relies on.

### Action boundaries

- The GitHub environments and their secrets are the owner's (section 6). The pipelines must
  fail with a readable summary when an environment lacks a value, as today's gate step does.
- Run the cutover on staging through the staging pipeline, after the owner merges. Do not
  run it on production. The first production release after the merge runs it, or the owner
  runs it by hand before that.
- Stop and ask before you delete any image from the registry, any Secret, or any PVC.

### Progress evidence

A staging run of `staging-portfolio.yml` and one of `staging-velista.yml` on the same
commit, with the cutover in the first one's log. `helm list -A` on staging. A commit that
touches only `libs/landing-v2` runs the portfolio pipeline through deploy and the velista
pipeline through `setup` with nothing affected. The six staging URLs answer, Certificates
are Ready in both namespaces, one Envoy Service exists in `envoy-gateway-system`.

## 1. Purpose

The deploy of a unit should know its unit from one input and its target from one
environment. Everything else (the affected list, the images, the gates, the chart, the
namespace, the release name, the release tasks) follows from `unit.env` and the tags. A
third unit is then two caller files, two environments and no pipeline edit.

## 2. What stays true

- A push to `main` is a staging deploy of what changed. A published Release is a production
  deploy at a pinned version (plan 0002). `0017` makes the Release per unit.
- The staging gates run against the images the run just pushed (plan 0009).
- `provision-release.sh --check` and `check-tasks.mjs` run before any SSH, and the release
  tasks run in `pre` and `post` phases around the upgrade (plan 0011).
- Host patching never overlaps a deploy to the same host (plan 0013 D6).

## 3. Decisions

### D1. Two reusable pipelines and one composite action

`stage-unit.yml` (`workflow_call`, input `unit`, input `build_all`) has the jobs of today's
`docker-ci.yml`, scoped to one unit:

1. `setup`: base SHA from the last successful run of the **calling** workflow
   (`github.workflow` is the caller's name inside a reusable workflow, so each unit keeps its
   own history); the affected lists come from `nx show projects --affected --with-target
   build:docker --projects tag:deploy:<unit> --json`, plus the testable and e2e projects
   that intersect the unit's gates (D3). Outputs `images`, `deployments`, `gates`.
2. `lint-test`: `nx affected -t lint test` over the whole graph from this unit's base, so a
   shared library change tests the library in both pipelines. That is accepted, and the PR
   workflow proved it once already.
3. `build`: the base image (D6), the bundles with the unit's environment (`MFE_BASE_URL` for
   the portfolio; `LUNA_GATEWAY_URL`, `LUNA_REALTIME_URL`, `VELISTA_APP_URL`,
   `VELISTA_APP_VERSION` for velista; the `BUILD_ENV_STAGING` variables of `unit.env`,
   `0014` D1, plus the version that the pipeline sets), the runtime manifest assertion for
   Luna, and
   `build:docker` with `DOCKER_IMAGE_TAG=staging`.
4. `gate`: a matrix over the unit's gates (D3), each one job.
5. `deploy`: `environment: <unit>-staging`, `concurrency: { group: deploy-<unit>-staging,
   cancel-in-progress: false }` (D2), needs `gate` and `lint-test`, runs the composite
   action with `mode: staging`.

`release-unit.yml` (`workflow_call`, inputs `unit`, `version`) has `setup` (every project of
the unit, no `--affected`), `test` (`nx affected -t lint test` from the previous tag of this
unit to the released tag, so that what this release ships new is tested, shared libraries
included, while a red test in the other unit's own code cannot block it), `build` (the
unit's images and the base image with `DOCKER_IMAGE_TAG=<version>,latest` and
`BUILDER_TAG=<unit>-v<version>`, D6), and `deploy` with `environment: <unit>-production`,
`concurrency: deploy-<unit>-production` and `mode: production`.

`.github/actions/deploy-unit/action.yml` holds the steps both deploys share: the `units.mjs
check` and `check-tasks.mjs` runs, the environment gate with the readable summary, the SSH
agent and known hosts, the rsync, the preflight, the cutover (D5), the upgrade, the rollout
observation, the release tasks, the diagnosis. Inputs: `unit`, `mode`, `version`,
`deployments`, `host`, `user`, `key`, `known_hosts`. The rsync target is
`~/deploy/<unit>/k8s/`, so two units deploying from two commits to one host never overwrite
each other's chart.

### D2. Thin callers, one GitHub environment per unit and stage

`staging-<unit>.yml`:

```yaml
name: Staging deploy, <unit>
on:
  push: { branches: [main] }
  workflow_dispatch: { inputs: { build_all: { type: boolean, default: true } } }
jobs:
  stage:
    uses: ./.github/workflows/stage-unit.yml
    with: { unit: <unit>, build_all: ${{ inputs.build_all || false }} }
    secrets: inherit
```

`release-<unit>.yml` listens to `release: published`, keeps the condition of `0017` D1 on
the calling job (for this plan: a tag that starts with `<unit>-v` or, until `0017`, a bare
`v`), derives the version, and calls `release-unit.yml`.

The environments are `portfolio-staging`, `portfolio-production`, `velista-staging`,
`velista-production`. Each holds the secrets `SSH_DEPLOY_HOST`, `SSH_DEPLOY_USER`,
`SSH_DEPLOY_KEY` and the variable `SSH_KNOWN_HOSTS`, with the same names in all four. Today
the two staging environments hold the same values, and so do the two production ones. A new
server for velista is an edit to `velista-staging` and `velista-production` and nothing
else. The repository secrets `SSH_DEPLOY_HOST`, `SSH_DEPLOY_HOST_STAGING` and the shared
user and key are deleted after the cutover, once `host-maintenance.yml` reads from the
`host-*` environments too (section 6).

Concurrency is per unit and sits on the `deploy` job of the reusable pipelines:
`deploy-<unit>-staging` and `deploy-<unit>-production`, `cancel-in-progress: false`. A group
on the calling job would queue the builds and gates of one unit behind the other unit's
deploy, and GitHub keeps one pending run per group, so a third run would cancel the other
unit's pending deploy. Per unit groups make two runs of one unit queue (the newer pending
one replaces the older, which is right for a newer commit) and never touch the other unit.

Exclusion against host patching moves to where the two actually meet, the host. The
composite action runs its helm and kubectl steps under `flock` on `/run/lock/nx-deploy.lock`
with a wait of fifteen minutes, and `nx-host-patch` holds the same lock from its first
package operation until it reboots or exits. `provision-host.sh` creates the lock file with
a mode that both the `deploy` account and root can open. `host-patch.yml` drops its
`concurrency-group` input and `host-maintenance.yml` stops naming the deploy groups. A
deploy that arrives during a reboot fails at SSH and says so, and the next push retries it.
When a unit gets its own host (backlog `0002`) nothing here changes.

### D3. A gate is a directory

`k8s/e2e/<gate>/gate.sh` starts its stack, waits, runs its suites against the affected e2e
projects it is given, prints a summary and tears down. `gate.env` declares what the
pipeline must prepare: `HOSTS` (the `/etc/hosts` names), `TRIGGERS` (the e2e projects whose
being affected runs the gate; empty means always when the unit deploys), `BROWSERS`
(`playwright`, `cypress`, both or none, for the caches), `IMAGES` (the images to pull with
the run's tag). The `gate` job of `stage-unit.yml` is one matrix entry per gate of
`unit.env` `GATES` whose triggers are affected, and it knows nothing else.

Three gates exist after this plan:

- `portfolio-frontend` (portfolio): today's compose stack minus the dead `landing` service.
  It keeps the `/velista` proxy to a `velista:staging` container pulled from the registry,
  because the portfolio host's contract includes the portfolio path and the route is the
  portfolio's (`0015` D6). It asserts only that `/velista/en` reaches that container (a 200
  whose body names `app-velista-root`). The image behind it is the other unit's and may be
  mid change, so the checks of the rewritten base and the absent manifest, which test
  velista's own nginx, move to the `velista-luna` gate. The three remote entry checks stay.
- `luna-shopper-backend` (velista): today's `e2e-luna`, wrapped.
- `velista-luna` (velista, new directory): velista's own image behind a proxy that serves
  `staging.velista.app` and a `/velista` location on a portfolio shaped host, plus the Luna
  stack. `compose.luna.yml` and `nginx.luna.conf` move here from `portfolio-frontend`. The
  base rewrite and manifest checks of plan 0165 D7 run here, against the image this run
  built. The portfolio stack is not started. `k8s/units/velista/unit.env` gains
  `velista-luna` in `GATES`.

From this plan on, `units.mjs check` asserts that every e2e project is named by exactly one
gate's `TRIGGERS`: `shell-e2e`, `odontogram-e2e`, `damoclesSword-e2e` and `landingV2-e2e` by
`portfolio-frontend`; `velista-e2e` and `velista-luna-e2e` by `velista-luna`;
`luna-shopper-backend-e2e` by `luna-shopper-backend`.

### D4. Production deploys per unit, with one version for all units until `0017`

`release-unit.yml` deploys one unit with `deploy-release.sh <unit> <version>`. Until
`0017`, a bare `vX.Y.Z` Release runs both callers with the same version, which is today's
behaviour split in two runs. `0017` replaces the bare tag with one prefix per unit.

### D5. The cutover: one release becomes two

`k8s/bootstrap/split-release.sh --env <staging|production|homelab> [--plan]` runs on the
host as the deploy account. The composite action runs it in the preflight, before the
release tasks' `check` and `pre` phases (`0015` D9), when `helm status nx-portfolio`
succeeds or a cutover ConfigMap says a run stopped part way. It is a no op afterwards. It
changes owners and places, not versions: both units come up at the image tags their live
pods run, read from the `shell` and `luna-shopper-backend-gateway` Deployments. The
portfolio is a fresh install into `portfolio`, velista is a move of its Secrets, its ledger
and its volumes into `luna-shopper` (`0014` D3), and the pipeline's own upgrade follows as
on any other run. It records the step it reached in ConfigMap
`deploy-cutover` of each namespace, which is also the adoption marker that `deploy-release.sh`
reads (`0015` D10). Steps, each idempotent:

1. **Merge the data plane.** `install.sh --merge-only` applies the `EnvoyProxy merged` and
   the GatewayClass `parametersRef`. Envoy Gateway replaces the per Gateway fleet with the
   merged one. The script waits until the merged Service holds the address and deletes the
   old `envoy-nx-portfolio-portfolio-*` Service and Deployment if the controller leaves them
   behind, because with a one address pool the new Service stays `Pending` while the old
   one holds it. This is the first interruption, seconds long, and the rehearsal (section 5)
   measures it.
2. **Make Helm forget the old release.** Delete its storage Secrets:
   `kubectl -n nx-portfolio delete secret -l owner=helm,name=nx-portfolio`. Every object
   stays exactly as it is. `helm uninstall` is not used, not even with a keep annotation:
   Helm decides what to keep from the manifest it stored, not from the live objects, so an
   annotation added with `kubectl` is ignored and the uninstall deletes everything, pool
   and Gateway included.
3. **Take the pool over.** Read the address from the live `IPAddressPool main-pool`, then
   `install.sh --ip <addr>` applies the spec of `0015` D5 (`serviceAllocation.namespaces:
   [envoy-gateway-system]`) over the existing objects.
4. **Prepare both namespaces.** Create `portfolio` and `luna-shopper`. Copy into each the
   TLS Secrets of its hosts with the cert-manager annotations stripped. Copy into
   `luna-shopper`, verbatim, the six Luna Secrets, the backup Secret and the `release-tasks`
   ConfigMap: never regenerated, because a new `HARVESTER_ACTOR_ID` orphans every row the
   harvester wrote and new JWT keys sign every user out. Then `helm install portfolio -n
   portfolio --set imageTag=<live tag> --set gateway.enabled=false`, with no `--atomic`. The
   four portfolio pods come up with no route. No traffic moves.
5. **Move velista's data.** Take a fresh dump of the four databases through the backup
   CronJobs, as a release task does, and wait for it. Patch the five PersistentVolumes
   (four Postgres, NATS) to `persistentVolumeReclaimPolicy: Retain`. Delete the Luna
   StatefulSets and Deployments in `nx-portfolio` (the backend interruption starts), delete
   their PersistentVolumeClaims, clear each PersistentVolume's `claimRef` and point it at
   the same claim name in `luna-shopper`, and create those claims there with `volumeName`
   set. No byte is copied: a `local-path` volume is a directory on the node, and only its
   claim changes. Then `helm install velista -n luna-shopper --set imageTag=<live tag>
   --set gateway.enabled=false`, no `--atomic`: the StatefulSets adopt the claims by name,
   the migration hooks run against a schema they already wrote, and the backend interruption
   ends when the services are Ready, a few minutes after it began. The PriorityClass
   `luna-stateful`, cluster scoped, gets the Helm annotations of the new release before the
   install so that the chart adopts it rather than failing on ownership.
6. **The swap.** Delete `Gateway portfolio` and every HTTPRoute in `nx-portfolio`, the old
   `velista-portfolio` route among them (the edge interruption starts; the portfolio chart
   renders that route again in `portfolio`, `0015` D6), then `helm upgrade portfolio --set
   gateway.enabled=true` and `helm upgrade velista --set gateway.enabled=true`, both without `--atomic`. Each new Gateway
   programs its listeners from the copied Secrets. The interruption ends when both Gateways
   report `Programmed` and both releases are `deployed`, which is seconds to a minute. The
   ACME challenges for the re-issued certificates then run through the new Issuers and
   replace the copied Secrets in the background.
7. **Clean up.** When every Certificate in both namespaces is Ready under its Issuer and
   both releases have served for an hour, delete the namespace `nx-portfolio` with
   everything still in it (the old pods, Services and the old release's leftovers), and
   delete `ClusterIssuer letsencrypt-prod` and its account Secret. The retained
   PersistentVolumes are bound to `luna-shopper` by then and survive. Record the result in
   the step summary.

`--plan` prints the object lists of steps 2, 5 and 7, the two live tags and the two Gateway
specs, and exits. A failure in steps 1 to 4 leaves the old objects serving, Helm or no Helm;
the script says which step failed and that a rerun continues from it. A failure inside
step 5 leaves the data on retained volumes and in the dump of its first action, and the
script prints the PersistentVolume names and the exact command that rebinds each one, so
that a person can finish the step or put the claims back in `nx-portfolio`. A failure in step 6 is
the one that needs a person, and the diagnosis step prints both Gateways, both releases and
the Envoy status. A failed `helm install velista` is left as it is for that person; nothing
uninstalls it (`0015` D10).

Staging goes first, through the first `staging-*` run after the merge. Production follows
at the first `release-*` run or by the owner's hand, with the same script. The owner may
want an hour of the day with little traffic for production: the edge is interrupted for
seconds in steps 1 and 6, and the backend for the few minutes of step 5, all inside a
quarter of an hour. `--env homelab` exists for the owner's home release and is run by
hand.

> **As built.** Three changes to D5, all in `split-release.sh` and the runbook
> section "Existing clusters: the cutover":
>
> - **Production runs the cutover only when allowed.** The preflight runs it by itself
>   on staging. On production it runs only when the variable `ALLOW_CUTOVER` of
>   `<unit>-production` is `true`. Otherwise a deploy to a cluster that is not cut over
>   stops before any change, with one summary line that names the two ways forward:
>   set the variable inside a maintenance window and re-run, or run
>   `split-release.sh --env production` by hand. The orchestrator decided this because
>   the production maintenance window was closed.
> - **Step 6 enables the new Gateways first and deletes the old one after.** With the
>   old Gateway deleted first, the class has no Gateway for a moment, Envoy Gateway
>   tears the merged data plane down and builds it again, and the rehearsal measured 12
>   to 17 seconds with no answer. In the other order the duplicate HTTPS listeners wait
>   as Conflicted until the old Gateway goes, and the rehearsal measured no gap.
>   `SPLIT_SWAP_ORDER=old-first` restores the order written above.
> - **Step 3 uses `install.sh --pool-only --ip`**, which applies the pool and nothing
>   else, after stripping the pool's Helm annotations. A cluster with no MetalLB skips
>   the step. `--env local` takes no dump, because Docker Desktop has no object storage.
>
> The pipelines also pass no `secrets: inherit` (D2): an environment that lacked
> `SSH_DEPLOY_HOST` would otherwise fall back to the repository secret of that name,
> which is production's.

### D6. The base image is tagged per environment and version

`docker/local-http-server` builds with the tag `staging` in the staging pipelines and with
the full release tag (`velista-v0.15.0`) in a release, and every frontend build of that run
gets `BUILDER_TAG` set to the same value. The full tag and not the bare number, because two
units at the same number would otherwise overwrite one `0.15.0` base from two commits. The
`latest` tag of the base is no longer pushed by a deploy. A staging push can thus no longer
change what the next production release builds on. Both staging pipelines may push
`local-http-server:staging` from the same commit, which is the same bytes.

### D7. Lists come from the registry

`units.mjs endpoints <env>` prints `https://` plus every host of every unit (from
`HOSTS_<ENV>`), and `units.mjs images` prints every deployable image. `host-maintenance.yml`
computes its `endpoints` inputs with the first, and `image-scan.yml` its matrix with the
second, in a small step before the jobs that need them. A new unit then needs no edit in
either file.

### D8. The old chart and workflows are deleted in the same PR

`k8s/helm/Chart.yaml`, `templates/`, `values*.yaml`, `.helmignore`, `docker-ci.yml` and
`release.yml` go. `nx.json` keeps no workflow file in `sharedGlobals` (`0014` D6). Every
reference in the READMEs and `CLAUDE.md` moves to the new names.

### D9. The PR workflow stays whole

`pr.yml` keeps running lint, test and the Luna integration over the whole workspace. A PR is
not a deploy and owes no unit anything.

## 4. Who edits what

One builder, one PR, title `feat(ci): each deploy unit ships from its own pipeline into its
own release (plan 0016)`. The PR body names #809, #810, the `0014` PR and the `0015` PR as
merged first, and lists the four environments and their four values for the owner to create
before the merge. The scope list is the file list.

## 5. Acceptance

- The four caller workflows and the two reusable ones parse (`actionlint` locally).
- The cutover is rehearsed before the merge on Docker Desktop Kubernetes: the old chart is
  installed from the base commit (a `git worktree` at `dev`) with the local values, Luna on
  against Secrets from `provision-release.sh`, then `split-release.sh --env local` runs
  every step except the address move of step 3, the volume rebinding of step 5 included
  (Docker Desktop's hostpath volumes rebind the same way), and the builder records the length of the
  interruptions of steps 1 and 6 in the PR.
- On staging, after the merge: the `staging-portfolio` run shows the cutover steps in its
  summary; `helm list -A` shows `portfolio` and `velista`, and `kubectl get ns` shows no
  `nx-portfolio`; `kubectl
  get gateway -A` shows two Gateways, both `Programmed`; `kubectl get certificate -A` shows
  six Ready; `kubectl get svc -n envoy-gateway-system` shows one LoadBalancer with the
  address; the six URLs answer over TLS; `staging.ichirokuxvi.com/velista/en` answers from
  the velista pod with the rewritten base; `staging.velista.app/.well-known/assetlinks.json`
  answers (PR #810).
- A commit that touches only `libs/landing-v2`: the portfolio pipeline builds one image,
  runs the `portfolio-frontend` gate and deploys; the velista pipeline stops after `setup`.
- A commit that fails the `velista-luna` gate blocks the velista deploy and not the
  portfolio deploy.
- The first `staging-velista` run after the cutover records no release task as `skipped`,
  and `kubectl get cm release-tasks -n luna-shopper -o yaml` shows the ledger copied from
  the old namespace.
- During a dispatched `host-maintenance` run against staging, a staging deploy of either
  unit waits on the host lock and completes after the patch, or fails at SSH during the
  reboot with that reason in its summary.
- `host-maintenance.yml` with the registry endpoints passes a dispatch run against staging.
- `node tools/deploy/units.mjs check` passes with the gate directories.

## 6. The owner's part

Before the merge:

1. Create the environments `portfolio-staging`, `portfolio-production`, `velista-staging`
   and `velista-production`. In each, the secrets `SSH_DEPLOY_HOST`, `SSH_DEPLOY_USER`,
   `SSH_DEPLOY_KEY` and the variable `SSH_KNOWN_HOSTS`, with today's staging values in the
   two staging ones and today's production values in the two production ones.
2. Optionally a required reviewer on the two production environments. `0017` adds the tag
   rules.

After the cutover on both clusters: move `SSH_DEPLOY_HOST_STAGING` and `SSH_DEPLOY_HOST`
(each as `SSH_DEPLOY_HOST` of its environment), `SSH_DEPLOY_USER` and `SSH_DEPLOY_KEY` into
the `host-staging` and `host-production` environments that `host-maintenance.yml` already
uses, then delete the four repository secrets. The builder changes that workflow to read all
four from the environments in this PR, so that host maintenance keeps its hosts.

## 7. `CLAUDE.md`

Rewrite the two workflow bullets of `Docker & CI/CD`:

> - **Each unit has its own staging and production pipeline.** `staging-<unit>.yml` (on
>   push to `main`) and `release-<unit>.yml` (on a published Release) are thin callers of
>   `stage-unit.yml` and `release-unit.yml`. A pipeline builds the unit's affected images
>   and the base image, runs the unit's gates (`GATES` in `unit.env`, one directory under
>   `k8s/e2e` each), and deploys through the composite action `deploy-unit` into the unit's
>   namespace and release, with the host and key of the GitHub environment
>   `<unit>-staging` or `<unit>-production`. A red gate of one unit never blocks another.
>   Deploys and host patching exclude each other through `flock` on the host, not through a
>   GitHub concurrency group.
> - **The cutover from one release to two happened through `split-release.sh`** (k8s plan
>   0016). It is idempotent and still runs in the preflight; on a cluster that is already
>   split it does nothing.

Update "A new deployable app needs these things" to name the tag, the chart entry and, for
a new unit, the two callers and the two environments.

## 8. Decisions left for the owner

1. **D2, exclusion against host patching through a lock on the host** (recommended) or
   through one concurrency group per host on the deploy jobs, which host patching can hold
   as today, at the cost of GitHub cancelling one unit's pending deploy whenever the other
   unit queues two.
2. **D5, who runs the production cutover**: the first release after the merge, or the owner
   by hand in a quiet hour.
3. **D6**, whether production should also keep pushing `local-http-server:latest` for the
   local compose files that still name it (`k8s/e2e/*/compose*.yml` use `:staging`; only
   `values.local*.yaml` and a developer's `docker build` would notice).
