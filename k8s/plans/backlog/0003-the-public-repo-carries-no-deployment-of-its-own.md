# 0003 (backlog) the public repo carries no deployment of its own

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.
>
> Luna Shopper is open source and meant to be deployed by anyone, the way WordPress is the
> software and wordpress.com is one site that runs it. velista is the owner's site. Today the
> public repository is both: the software, and the owner's two clusters, their domains, his
> release tasks and his deploy pipelines. The privacy work of 2026-10-27 (backend `0231`,
> velista `0172` to `0174`) has to provision the owner's legal values like secrets for exactly
> this reason. This plan moves the owner's deployment into a private repository and leaves the
> public one with code, charts, generic values, scripts and an example. It is parked because
> it is a move of the deploy path, which the deploy unit series (`0014` to `0017`) only just
> settled, and because no self-hoster has asked yet.
>
> Every statement below was read on branch `docs/velista-privacy-terms-plans` (based on
> `origin/dev`, 2026-10-27). It needs `0014` to `0017` built (they are) and leans on `0006`
> (scripted provisioning) and `0011` (release tasks).

## Brief for the agent

### Objective

After this plan, a person who clones the public repository can deploy Luna Shopper to their
own domain from the README and one values file, and the public repository names no host,
domain, email, account id or data operation of the owner's deployments. The owner's staging
and production deploy exactly as before, from a private repository.

### Context

What ties the public repository to the owner's deployments today, by kind:

- **Values per environment.** `k8s/helm/velista/values.production.yaml` and
  `values.staging.yaml`, `k8s/helm/portfolio/values.production.yaml` and `values.staging.yaml`.
  They hold the domains (`baseDomain`), the owner's ACME email
  (`velista/values.production.yaml:38`, `velista/values.staging.yaml:31`,
  `portfolio/values.production.yaml:21`), the Google client id (`velista/values.production.yaml:80`,
  `values.staging.yaml:50`), the Mailjet host and API key id (`values.production.yaml:101-106`,
  `values.staging.yaml:58-67`), the CORS origins, `minClientVersion`, the harvester switches
  and the resource sizes of his machines. The homelab files
  (`k8s/helm/*/values.homelab.yaml`, `k8s/helm/deploy-homelab.sh`, `k8s/README-homelab.md`)
  are the owner's home machine.
- **The unit registry.** `k8s/units/velista/unit.env` and `k8s/units/portfolio/unit.env` mix
  the generic shape (`NAMESPACE`, `CHART`, `SECRETS`, `GATES`, `TAG_PREFIX`) with the owner's
  `HOSTS_STAGING`, `HOSTS_PRODUCTION`, `BUILD_ENV_STAGING` and `BUILD_ENV_PRODUCTION`.
- **Scripts that know two environment names.** `provision-release.sh` accepts only
  `--env production|staging` (`k8s/bootstrap/provision-release.sh:85-94`) and reads
  `values.<env>.yaml` beside the chart and `HOSTS_<ENV>` from the unit (`:284`).
  `deploy-release.sh` passes `values.production.yaml` by name (`k8s/helm/deploy-release.sh:224-226`),
  and the staging deploy passes `values.staging.yaml` (`.github/actions/deploy-unit/action.yml:232-233`).
  `provision-host.sh` defaults `--repo` to the owner's repository (`k8s/bootstrap/provision-host.sh:76`).
  `cluster-issuer-dns01.sh` names the owner's zone (`:27`, `:110`).
- **Release tasks.** `k8s/release-tasks/tasks/0001` to `0004` delete and restore rows of the
  owner's catalog, in windows that name his release numbers (for example
  `tasks/0004-remove-chain-sections/task.env`). The runner (`run-release-tasks.sh`,
  `check-tasks.mjs`) is generic.
- **Deploy pipelines.** `staging-portfolio.yml`, `staging-velista.yml` (push to `main`),
  `release-portfolio.yml`, `release-velista.yml` (Release published), `redeploy.yml`, and the
  reusable `stage-unit.yml`, `release-unit.yml` with the composite action
  `.github/actions/deploy-unit`. They read the GitHub environments `<unit>-staging`,
  `<unit>-production` and `<unit>-production-redeploy` (`stage-unit.yml:372-398`,
  `release-unit.yml:229-255`). `host-maintenance.yml` and `host-patch.yml` patch the owner's
  two hosts (`host-maintenance.yml:24-28`, `:91`, `:101`). `k8s/bootstrap/github-environments.sh`
  creates those environments. A failed deploy's diagnosis runs in public Actions logs (k8s
  plan `0018` D4).
- **The registry.** Images go to `ghcr.io/ichirokuxvi/nx-portfolio/<app>`
  (`stage-unit.yml:37`, `release-unit.yml:30`, `tools/deploy/units.mjs:83`,
  `renovate.json:107`, `k8s/helm/*/values.yaml`).
- **Images built for one origin.** The velista, admin and shell bundles embed their URLs at
  build time from `BUILD_ENV_*`, and fall back to the owner's hosts when unset
  (`apps/velista/webpack.prod.config.ts:17,25,41`, `apps/luna-shopper-admin/webpack.prod.config.ts:15`,
  `apps/shell/webpack.prod.config.ts:17`). The Android build names the owner's hosts
  (`apps/velista/android/app/build.gradle:46,51`, `apps/velista/scripts/build-android.mjs:38-45`,
  `apps/velista/capacitor.config.ts:14`), and `apps/velista/public/.well-known/assetlinks.json`
  holds his signing certificate's fingerprint. So the published front end images serve the
  owner's site and nobody else's.
- **Defaults in code that speak for the owner.** The harvester's User-Agent names
  `velista.app` and `contact@velista.app` by default
  (`apps/luna-shopper-backend/harvester/src/app/config/app-config.ts:75`,
  `k8s/helm/velista/values.yaml:377`), so a self-hoster's crawler would identify as the
  owner. The `capture-fixtures` tools do the same (`libs/luna-shopper/*/tools/capture-fixtures.ts`).
  `libs/shared/environments/src/lib/environment.prod.ts:3` and
  `apps/odontogram/project.json:120` name the portfolio's hosts.
- **Prose.** `CLAUDE.md:263` and the rest of `Docker & CI/CD`, `README.md:138,181,221-234`,
  `k8s/README.md`, `k8s/README-new-cluster.md:163-190,324` name the domains and hosts.
  `docker/ddns` and `docker/prod` are the owner's older single host setups. The e2e gates
  impersonate the staging hosts (`k8s/e2e/velista-luna/gate.sh:38,80-137`, its `nginx*.conf`)
  because the images under test were built for them.
- **Not tied to a deployment, and staying.** Plans under every `plans/` directory record
  history and keep their hosts. The landing's link to velista
  (`libs/landing-v2/ui/src/lib/velista-content/velista-content.ts:24`) is the portfolio's
  content. The schema ids `https://ichirokuxvi.com/schemas/harvest-document-*.json`
  (`libs/luna-shopper/contracts/src/schemas/harvest-document/*.ts`) are identifiers, not
  addresses (D7). Spec files use the owner's hosts as sample data.

### Target state

- **Public repository** (this one): the code, both charts with a generic `values.yaml` and a
  `values.example.yaml` each, the bootstrap scripts taking a values file and an environment
  label instead of two fixed names, the release task runner with no tasks, the unit registry
  without hosts or build variables, the PR checks, the image scan, and the reusable workflows
  `stage-unit.yml` and `release-unit.yml` callable from another repository. A README section
  "Deploy your own" goes from a bare VPS to a running site.
- **Private repository** (name is the owner's, for example `velista-deploy`): the owner's
  values files, his unit hosts and build variables, his release tasks, the caller workflows
  for staging, release and redeploy, host maintenance, the GitHub environments and their
  secrets, the homelab files, and a filled copy of the runbook.
- The owner's deploys keep every property of `0016` and `0017`: per unit, per environment,
  the same gates, the host lock, the version tags, the redeploy.

### Scope

Public: `k8s/bootstrap/provision-release.sh`, `provision-host.sh`, `cluster-issuer-dns01.sh`,
`github-environments.sh`, `k8s/helm/deploy-release.sh`, `.github/actions/deploy-unit/action.yml`,
`.github/workflows/stage-unit.yml`, `release-unit.yml`, `tools/deploy/units.mjs` and its test,
`k8s/release-tasks/check-tasks.mjs` and its test, `k8s/units/*/unit.env`,
`k8s/helm/*/values.example.yaml` (new), the three `webpack.prod.config.ts`, the harvester
config and `values.yaml`, `CLAUDE.md`, `README.md`, `k8s/README*.md`. Removed from public: the
files listed under "Private" above. Private: a new repository.

### Constraints

- No deploy of either unit is skipped or doubled during the move (section 5, the order).
- Each step is one PR to `dev` that leaves both clusters deployable.
- The public reusable workflows read nothing of the owner's: every host, URL and secret
  reaches them as an input or a secret from the caller.
- A self-hoster needs no GitHub at all: the scripts and `helm` run from a laptop.
- velista's version numbers continue (plan `0017` D2); tags stay in the public repository.

### Action boundaries

- The private repository, its environments, secrets and tokens are created by the owner
  (section 6). The builder writes the files it holds and a script that copies them.
- Do not rewrite git history. What is committed today stays in history (D8).
- Do not change the charts' templates beyond what D3 needs.

### Progress evidence

A clone of the public repository on a machine with no access to the private one deploys
the velista unit to a throwaway domain with `values.example.yaml` filled in, following the
README. `git grep -nE "velista\.app|ichirokuxvi\.com"` outside `plans/`, spec files, the
landing content and the schema ids prints nothing. A push to public `main` stages both units
from the private repository, and a `velista-v*` Release deploys production from it.

## 1. Purpose

Open source that can be deployed by anyone is software whose repository does not assume
who deploys it. As long as the owner's values sit beside the code, every privacy value,
every host and every data operation of velista is either public or provisioned around the
repository, and every self-hoster starts by deleting the owner's files. The split makes the
owner one operator among many, with the same scripts and the same example as everyone else.

## 2. What stays true

- One chart per unit, one release per unit and environment, one namespace (`0014` to `0016`).
- A person publishes a Release; tags carry the unit prefix (`0017`).
- Secrets are generated on the host by `provision-release.sh` and never committed (`0006`).
- Release tasks run in a window on data they expect (`0011`).

## 3. Decisions

### D1. Two repositories, and the private one is an instance of a public template

The public repository gains `deploy-template/` with what an operator's own deployment
repository holds: `values/<unit>.<env>.yaml` stubs, `units/<unit>.env` with the hosts and
build variables, `release-tasks/` empty, and caller workflows for staging, release and
redeploy that call the public reusable workflows. The owner's private repository is that
template filled in. A self-hoster who wants CI copies the same template. This keeps one
deploy path for everyone, and it is the test that the public path works.

### D2. The private repository runs the owner's whole pipeline

The private callers check out the public repository at the commit or tag to deploy
(`actions/checkout` with `repository:` and `ref:`) and overlay their own directory, then
call the public `stage-unit.yml` or `release-unit.yml`
(`uses: IchirokuXVI/nx-portfolio/.github/workflows/stage-unit.yml@<sha>`), which a private
repository may call when the called repository is public. Build, gates and deploy run there,
so the deploy logs, the diagnosis and the environments are private.

Images: the backend images are environment agnostic and could come from a public build; the
front end images are not (Context, "Images built for one origin"). The simplest correct
rule is that the private pipeline builds every image it deploys, as today, and pushes to the
same registry. The owner grants the private repository write access to the packages
(section 6). A public image publication for self-hosters is a separate decision (owner
decision 3).

### D3. Scripts take a values file and a label

- `provision-release.sh --unit <u> --env <label> --values <file>` (repeatable, after the
  chart's `values.yaml`). `--env` becomes a free label used in messages and the plaintext
  copy's name, no longer `production|staging`. Hosts for `--check` come from `--hosts-file`
  or the values themselves (the rendered Gateway's hostnames), not from `HOSTS_<ENV>`.
- `deploy-release.sh <unit> <version> --values <file>`; the action passes the file the caller
  names.
- `provision-host.sh --repo` loses its default and requires the URL, or defaults to the
  public repository's URL read from a constant at the top of the file with a comment that
  says to change it in a fork. (Writer decision: the second, because a self-hoster usually
  deploys from upstream.)
- `cluster-issuer-dns01.sh` takes `--zone`.
- `github-environments.sh` moves to the template; its examples name `example.com`.

### D4. The unit registry splits into shape and place

`k8s/units/<unit>/unit.env` keeps `UNIT`, `NAMESPACE`, `RELEASE_NAME`, `CHART`, `TAG_PREFIX`,
`GATES`, `SECRETS`, `RELEASE_TASKS`. The hosts and the build variables per environment move
to the operator's `units/<unit>.env` in the deployment repository, which the reusable
workflows receive as an input path. `tools/deploy/units.mjs check` validates both halves when
both are present and the shape alone in public CI.

### D5. Code defaults never name the owner

- The three `webpack.prod.config.ts` fail a production build that lacks its URL variables,
  instead of falling back to the owner's hosts. (Writer decision; the alternative is a
  `localhost` default, which builds an image that silently points nowhere.)
- The harvester's `HARVEST_USER_AGENT` (`app-config.ts:74-76`) has no default and is
  required when `HARVEST_ENABLED` is true; `values.yaml:377` becomes empty and
  `provision-release.sh --check` refuses an enabled harvester without it. The
  `capture-fixtures` tools read it from the environment.
- The Android build reads its host and the app link host from the same `VELISTA_APP_URL`;
  `assetlinks.json` is generated from a fingerprint variable, and the owner's fingerprint
  moves to the private repository. (Coordinate with velista plans `0166` and `0167`.)
- `environment.prod.ts` and `odontogram/project.json:120` belong to the portfolio, which is
  the owner's own site and not a product. They move to build variables only if owner
  decision 5 says the portfolio is a product too.

### D6. Release tasks are the operator's

The four tasks move to the private repository. The runner and `check-tasks.mjs` stay public
and read tasks from a directory the caller passes. A task that ships with a migration (as
`0004` did, `task.env` "ships in the same release as the migration") is merged into the
private repository before the public Release is published; `check-tasks.mjs` in the private
release job refuses a task whose `PRODUCTION_RELEASE` is lower than the tag being deployed
and still `pending`, so a late merge is caught before SSH. A self-hoster's data was never
the owner's, so the owner's tasks are not theirs either. When a deletion matters to every
installation it is a migration, which `CLAUDE.md` already allows when a schema change needs it.

### D7. What stays although it names a domain

Plans, spec files, the landing's link to velista and the schema ids stay. A JSON Schema
`$id` is a name; changing it would make every document already written name a schema that
no longer exists. `CLAUDE.md` keeps the facts about the owner's clusters out of its rules
and moves them to the private repository's own `CLAUDE.md`; the public one describes the
deploy path with placeholders.

### D8. History is not rewritten

The ACME email, the Google client id and the Mailjet API key id are in history today. None
is a secret by itself: a client id is public by design, the API key id is useless without
its secret (which `provision-release.sh` keeps on the host), and the email is the owner's
contact for certificate notices. A history rewrite would break every clone, fork and PR
link. The owner may rotate the Mailjet key pair after the move if he wants the id gone from
the live configuration.

### D9. Triggers cross the repositories by dispatch

- **Staging.** A small public workflow on `push` to `main` sends `repository_dispatch`
  (`event_type: stage`, payload: the commit sha) to the private repository with a
  fine grained token limited to that repository's contents and actions, kept as a public
  repository secret. Secrets are not given to workflows from forks, and `push` to `main`
  never runs fork code. The private `stage-<unit>.yml` listens to that event. The affected
  computation compares the sha against the last successful private staging run, as
  `stage-unit.yml` does against its own runs today.
- **Production.** The owner publishes `velista-vX.Y.Z` in the public repository, as now. A
  public workflow on `release: published` dispatches `event_type: release` with the tag. The
  private release job holds the `<unit>-production` environment and its required reviewer.
  A forked public repository that publishes a release has no token and dispatches nothing.
- **Redeploy** is a `workflow_dispatch` in the private repository only.
- **Fallback without a token**: the private repository polls public `main` every 15 minutes
  on a schedule. It is slower and spends Actions minutes, so it is not the default.

## 4. Who edits what

Public PRs, each green and deployable on its own:

1. `refactor(k8s): scripts take a values file and an environment label (plan NNNN)`. D3, D4,
   with the current files passed explicitly by the current workflows. Nothing moves yet.
2. `refactor(velista): production builds name their origin (plan NNNN)`. D5.
3. `feat(ci): reusable workflows take the operator's unit file and values (plan NNNN)`.
   Inputs for the paths; the current callers pass the in-repo files.
4. `feat(k8s): deploy template and example values (plan NNNN)`. D1, README section.

Private, by the owner with a builder: the repository from the template, the files copied
from public with `git log --follow` noted in its first commit message, the environments.

Public, last:

5. `chore(ci): owner deploys move to their own repository (plan NNNN)`. D9 dispatchers in,
   deploy callers, host maintenance, owner values, homelab files, `docker/ddns`,
   `docker/prod` and the release tasks out. `CLAUDE.md` and READMEs to placeholders.

## 5. The order of the move

1. PRs 1 to 4 land. Both clusters deploy from public, through the new inputs.
2. The private repository exists with its environments. Its staging callers run on
   `workflow_dispatch` only and deploy staging once by hand, while the public staging
   callers are disabled for that hour (Actions, "Disable workflow"), so no two pipelines
   hold the cluster. The host lock (`0016` D2) would serialize them anyway, but two
   pipelines writing one release is a confusing history.
3. With a green private staging deploy, the dispatcher of D9 lands (in PR 5) and the public
   staging callers are deleted in the same PR. From its merge, staging deploys from private.
4. The next production Release runs the private release job. If it fails before SSH, the
   public release callers still exist in the tag's tree; the owner re-runs from there once.
5. PR 5's removals land after one good production release from private.

## 6. The owner's part

1. Create the private repository from `deploy-template/`.
2. Create its environments with `github-environments.sh` (moved there) and the same four
   values per environment, the tag rules of `0017` section 6 and the reviewer.
3. Packages: grant the private repository write access to each
   `ghcr.io/ichirokuxvi/nx-portfolio/*` package (package settings, Manage Actions access).
4. A fine grained token for D9 and the public secret that holds it.
5. Move the legal values of backend `0231` from the local file into private values or keep
   them provisioned (owner decision 4).

## 7. `CLAUDE.md`

The public `CLAUDE.md` loses the owner's hosts and gains one bullet under `Docker & CI/CD`:

> - **The repository deploys nobody's site** (k8s backlog 0003). Charts ship `values.yaml` and
>   `values.example.yaml`. An operator's hosts, values, release tasks and caller workflows live
>   in their own deployment repository, started from `deploy-template/`. velista's are
>   private. Never commit a value that belongs to one deployment.

## 8. Decisions left for the owner

1. **Do it, and when.** Recommended after the privacy series ships, so that its provisioned
   legal values have one move and not two.
2. **The private repository's name**, and whether the portfolio's deployment moves with
   velista's (recommended: yes, one deployment repository with both units).
3. **Public images for self-hosters.** Publish the environment agnostic backend images on
   each release from public CI, or none (recommended for now: none; a self-hoster builds,
   because the front end must be built for their origin anyway). A runtime configuration for
   the front ends, which would make one image serve any origin, is a separate plan and not
   written.
4. **Legal values after the split.** Keep them provisioned like secrets (recommended: one
   path for every operator, and they never sit in a file someone may share) or move them
   into the private values.
5. **Is the portfolio a product?** If not, its hosts may stay in its code defaults (D5).
6. **The repository's own Actions log retention** in public after the move: nothing of the
   owner's runs there, so the default is fine.
7. **Luna Shopper in its own public repository**, apart from the portfolio monorepo. Out of
   scope here; this plan neither needs nor blocks it.

## 9. Decisions of the plan writer

These are mine and the owner can change them:

- A template directory in the public repository rather than only a README, so that the
  owner's own deployment proves the public path.
- The private pipeline builds every image it deploys.
- Dispatch rather than polling, and tags staying public.
- `provision-host.sh --repo` defaults to upstream.
- A production build without URLs fails rather than defaulting.
- History is not rewritten.
