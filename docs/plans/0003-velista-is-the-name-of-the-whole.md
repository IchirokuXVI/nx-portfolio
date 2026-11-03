# 0003: Velista is the name of the whole

> The owner decided on 2026-11-02 that Luna Shopper is renamed and that the whole product
> is Velista. The parts are named by role: `velista-server` (today
> `apps/luna-shopper-backend` and `libs/luna-shopper`), `velista-client` (today
> `apps/velista` and `libs/velista`) and `velista-admin` (today `apps/luna-shopper-admin`
> and `libs/luna-shopper-admin`). The TypeScript alias prefix of all three becomes
> `@velista/`. The portfolio and `libs/shared` keep `@portfolio/`.
>
> This plan renames the identity layer inside `nx-portfolio`, in one pull request, in a
> quiet window: project names, directories, aliases, image names, env keys, chart values
> keys and template names, gate directories, scripts, release scopes and the documents
> that describe them. It does not rename anything a running cluster or a stored record
> holds. Namespace, release, Secrets, databases, StatefulSets, Kubernetes object names,
> JetStream streams and the backup keys move in k8s `0019` or stay. Because this pull
> request already touches every `project.json`, it also installs the tag constraints that
> replace `onlyDependOnLibsWithTags: ['*']`.
>
> Every path in this plan is written as it is today. The `plans/` directories move with
> their apps (`apps/luna-shopper-backend/plans` becomes `apps/velista-server/plans`, and
> so on), so a plan named here by its current path is found under the new one after the
> merge. This file lives in `docs/plans`, which does not move, and neither does `k8s/plans`.
>
> Prerequisite reading: `CLAUDE.md`, backend `0144` (the last mass rename, and the merge
> lessons it left), k8s `0014` (units and tags), k8s `0016` (the pipelines, the gates, the
> restart step in `.github/actions/deploy-unit/action.yml`), k8s `0017` (release scopes),
> velista `0165` (the mount factory), `tools/release/rules.mjs`, `tools/deploy/units.mjs`,
> `eslint.config.mjs`, `tsconfig.base.json`, `k8s/units/velista/unit.env`,
> `k8s/e2e/luna-shopper-backend/luna-slot.sh`, `tools/dev/ng-slot.sh`.
>
> **Build order.** First in the Velista series, alone. Nothing else in the series starts
> before it merges, because every other plan is written against the new names and paths.
> It cannot start while any pull request other than a Renovate one is open (target state
> 1). After it merges, docs `0004`, backend `0240` to `0243`, velista `0178`, k8s `0020`
> and k8s `0021` run in parallel. k8s `0019` follows `0003` and backend `0240`. docs
> `0005` comes last. The series order, as every plan of the series states it: docs `0003`
> first, alone, after the pull request gate; then in parallel docs `0004`, backend `0240` to
> `0243`, velista `0178`, k8s `0020` and `0021` (backend `0242` after velista `0178` for the
> admin mechanism, k8s `0020` after backend `0241` for the generated files); k8s `0019`
> after docs `0003` and backend `0240`, in the same rollup to `main` as `0240`; docs `0005`
> last, with docs `0006` read from the start.

## Brief for the agent

### Objective

Apply one name map to the whole workspace in one pull request: 66 projects renamed, six
directory roots moved with `git mv`, 50 aliases moved under `@velista/`, ten image names
changed, `LUNA_*` env keys renamed to `VELISTA_*`, the chart values key and template names
renamed, two gate directories and the server slot script renamed, release scopes added,
and every document that names the old paths updated. Install scope and type tags on all
103 projects and the `depConstraints` that enforce them. Leave every persisted identifier
exactly as it is. Do the replacement with a script that is committed and run once, so the
same map can later port a branch across the rename.

### Context

- **The graph.** `npx nx show projects` lists 103 projects. 42 names start with
  `luna-shopper`: 10 under `apps/luna-shopper-backend*` (the umbrella project
  `luna-shopper-backend`, seven Nest services, the Python `transcriber`, and
  `luna-shopper-backend-e2e`), 11 under `luna-shopper-admin`, and 21 libraries named
  `luna-shopper/<lib>`. 24 names start with `velista`: the app, `velista-e2e`,
  `velista-luna-e2e` and 21 libraries named `velista/<lib>`. 87 projects carry no tag
  today; 13 carry `deploy:*`, one `microfrontend:angular`, two `type:*-docker`.
- **Aliases.** `tsconfig.base.json` holds 29 aliases that start with
  `@portfolio/luna-shopper` (19 under `@portfolio/luna-shopper/`, among them the
  subpaths `contracts/brand-key`, `platform/tracing`, `postal-codes/dataset` and
  `test-fixtures/jest`, and 10 under `@portfolio/luna-shopper-admin/`) and 21 under
  `@portfolio/velista/`. The six curation and leaflet tools have no alias.
- **Imports across groups today.** The backend imports `@portfolio/luna-shopper/*` 1278
  times and nothing from `libs/shared`. velista imports `shop-map/*` 52 times,
  `contracts` 4, `basket-rules` 2, `postal-codes` 1, `osm-places` 1, and from
  `libs/shared` only the two RokuTranslator libraries and `shared/data-access`. The admin
  imports `@portfolio/luna-shopper/contracts` 5 times, `shared/ui` 18, `shared/data-access`
  9. `velista-luna-e2e` and `luna-shopper-backend-e2e` import
  `@portfolio/luna-shopper/test-fixtures`. `libs/velista/data-access`, `models`, `native`
  and `platform` import nothing from `velista/feature-*` or `velista/ui`, and neither do
  `libs/luna-shopper-admin/data-access` and `models`.
- **`libs/shared/model-engines`** is used by nobody but
  `libs/luna-shopper/tools/curation/cli` and `libs/luna-shopper/tools/leaflet/cli`, which
  import it by the relative path `../../../../../shared/model-engines/src/index.mjs`. The
  path keeps its depth after the move, so it keeps working.
- **About 2,270 tracked files contain `luna`** (case insensitive), 1,184 of them under
  `apps/luna-shopper-backend` and 469 under some `plans/` directory. The word is not
  always ours: `.claude/skills/prompt-master/SKILL.md` names a GPT model "Luna". A blind
  case insensitive replace is therefore wrong.
- **Kubernetes object names equal project names today.** The chart values name each
  Deployment and Service after its project (`luna-shopper-backend-gateway`, `velista`,
  `luna-shopper-admin`), and `stage-unit.yml` (line 116) builds the staging restart list
  from the affected image names. `.github/actions/deploy-unit/action.yml` (line 240)
  skips a name that matches no Deployment and prints only "Skipping". After this plan the
  names differ until k8s `0019`, so that coupling has to go (D5).
- **Persisted identifiers that carry the old name.** In a cluster: namespace
  `luna-shopper`; the Secrets in `SECRETS` of `k8s/units/velista/unit.env`; the
  ConfigMap `luna-shopper-backend-config`; databases and roles `luna_auth`, `luna_core`,
  `luna_catalog`, `luna_harvester` (`k8s/bootstrap/provision-release.sh:872-875`); the
  StatefulSets and Services `luna-shopper-backend-<role>-db` that the DB URLs name; the
  PriorityClass `luna-stateful`; the backup object keys; the label
  `app.kubernetes.io/part-of: luna-shopper-backend` in selectors. In JetStream, with file
  storage on a PVC: the stream `LUNA_EVENTS` and its durable consumer `luna-realtime`
  (`apps/luna-shopper-backend/realtime/src/app/realtime/constants.ts`), and the stream
  `LUNA_ACCOUNT_DELETIONS` (`libs/luna-shopper/contracts/src/lib/events/identity.events.ts`).
  On the wire: the NATS queue groups `queue: 'luna-shopper-backend-<service>'` in each
  service's `main.ts`. On developer machines: the compose project default
  `${COMPOSE_PROJECT_NAME:-luna-shopper-backend}` and the slot projects `luna-slot<N>`,
  which prefix every Postgres volume (slot 3 is a locked catalog that others copy); the
  shared volume `luna-transcriber-models`; the records `<main .git>/luna-slot-locks` and
  `<main .git>/luna-slot-ephemeral`, which worktrees on older commits also read; and the
  git ignored files in each checkout (`apps/luna-shopper-backend/*/.env`, `.env.test`,
  `apps/luna-shopper-backend/.env.luna-shopper-backend`,
  `apps/luna-shopper-backend/secrets/*.key`, `apps/velista/.env`,
  `apps/luna-shopper-admin/.env`, `k8s/e2e/luna-shopper-backend/.env.slot` and `.run/`).
  `git mv` does not move ignored files.
- **Env keys.** About 60 distinct `LUNA_*` keys exist (`LUNA_GATEWAY_URL`,
  `LUNA_REALTIME_URL`, `LUNA_IMAGE_PREFIX`, `LUNA_IMAGE_TAG`, `LUNA_SLOT`,
  `LUNA_INTEGRATION`, `LUNA_REQUIRE_STACK` and the port keys), plus
  `LUNA_SHOPPER_ADMIN_*` (Angular injection tokens of the admin), `NG_LUNA_SHOPPER_ADMIN_*`,
  `DEFAULT_LUNA_*` and `DEV_LUNA_*`. No GitHub secret or variable has a `LUNA_` name;
  `BUILD_ENV_STAGING` and `BUILD_ENV_PRODUCTION` in `k8s/units/velista/unit.env` carry
  the two URL keys into the bundle build. Existing `VELISTA_*` keys
  (`VELISTA_APP_URL`, `VELISTA_DATA_ACCESS_PROVIDERS` and others) do not collide with the
  map below.
- **Names that carry the product in strings.** The OpenAPI title `'Luna Shopper API'`
  (`apps/luna-shopper-backend/gateway/src/app/docs/openapi-document.ts:28`);
  `DEFAULT_LEGAL_APP_NAME = 'Luna Shopper'`
  (`libs/luna-shopper/contracts/src/lib/legal/legal-settings.ts:23`); the harvester
  user agent default `'LunaShopper/0.1 (+https://velista.app; personal price comparison;
  contact@velista.app)'` (`apps/luna-shopper-backend/harvester/src/app/config/app-config.ts:75`
  and `k8s/helm/velista/values.yaml:398`); the sentence that names the software in the
  four legal texts under `libs/velista/feature-legal/assets/legal/` ("built on Luna
  Shopper").
- **Release titles.** `tools/release/rules.mjs` has `SCOPES`, `UNITS` and
  `WORKSPACE_SCOPES`. `luna`, `luna-shopper`, `luna-shopper-admin` and `velista` are
  scopes; `admin` exists; `server` and `client` do not. A title with no scope belongs to
  every unit's notes. `.github/workflows/pr-title.yml` checks out the pull request's merge
  commit, so a scope added in this pull request is valid for its own title.
- **The workspace is an npm workspace** (`"workspaces": ["apps/**", "libs/**"]`), and the
  seven Nest services have a `package.json` named `luna-shopper-backend-<service>`. The
  lock file lists them by path and name.

### Target state

1. **The gate held.** At the start of the build and again just before the pull request
   is opened, this prints nothing:

   ```sh
   gh pr list --state open --limit 200 --json number,author,headRefName,title \
     --jq '.[] | select(.author.login != "app/renovate") | select(.headRefName != "dev")
           | "#\(.number) \(.author.login) \(.title)"'
   ```

   `gh pr list` reports Renovate as `app/renovate` (the REST API calls the same account
   `renovate[bot]`). The filter covers every base, not only `dev`, because a pull
   request stacked on a feature branch also lands in `dev` later. A `dev` to `main`
   rollup carries no unmerged work and is excluded by its head. If the command prints a
   line, stop and report it.
2. **The name map is code.** `tools/rename/name-map.mjs` exports the tables of the
   section "The name map" below as data: projects, directories, aliases, images, env
   key rules, protected tokens and excluded paths. The section and the file agree.
3. **Directories moved.** `apps/luna-shopper-backend` is `apps/velista-server`,
   `apps/luna-shopper-backend-e2e` is `apps/velista-server-e2e`, `apps/luna-shopper-admin`
   is `apps/velista-admin`, `apps/velista` is `apps/velista-client`, `apps/velista-e2e`
   is `apps/velista-client-e2e`, `apps/velista-luna-e2e` is `apps/velista-stack-e2e`,
   `libs/luna-shopper` is `libs/velista-server`, `libs/luna-shopper-admin` is
   `libs/velista-admin`, `libs/velista` is `libs/velista-client`. `git log --follow`
   works on a moved file because each move is a `git mv` in a commit of its own, with no
   content change in that commit.
4. **Projects renamed.** `npx nx show projects` lists 103 names, none starts with
   `luna-shopper`, and the 66 new names of the project table exist. No old name
   resolves.
5. **Aliases moved.** `tsconfig.base.json` holds 50 `@velista/*` aliases (19 under
   `@velista/server/`, 21 under `@velista/client/`, 10 under `@velista/admin/`) and no
   `@portfolio/luna-shopper` or `@portfolio/velista` alias. No source file imports an old
   alias.
6. **Images renamed.** Each `build:docker` target names its image by the image table.
   The chart values, `compose.apps.yml`, the gate `IMAGES` lists and the `image-scan.yml`
   input follow. The registry segment `nx-portfolio/` stays (docs `0005` owns it).
7. **The chart renders the same objects.** With each of `values.staging.yaml`,
   `values.production.yaml` and `values.homelab.yaml`, `helm template velista
   k8s/helm/velista` before and after the rename differs only in `image:` lines, the
   `HARVEST_USER_AGENT` value and the `# Source:` comments. No object name, label,
   selector, Secret reference or ConfigMap name changes. The values key
   `lunaShopperBackend` is `velistaServer`, the directory `templates/luna-shopper-backend`
   is `templates/velista-server`, and every `define` named `lunaShopperBackend.*` is
   `velistaServer.*`.
8. **Persisted identifiers untouched.** Every token of the protected table appears in the
   same files, the same number of times, before and after (`git grep -c` per token).
9. **Env keys renamed.** No tracked file names a `LUNA_` key except the protected stream
   names and the compatibility readers of D8. `apps/velista-client/webpack.prod.config.ts`
   reads `VELISTA_GATEWAY_URL` and `VELISTA_REALTIME_URL`, and `k8s/units/velista/unit.env`
   passes them.
10. **Checkouts can follow.** `node tools/rename/move-local-files.mjs` moves the ignored
    files of a checkout from the old directories to the new ones, renames their `LUNA_*`
    keys in place with values kept, and refuses to overwrite a file that already exists
    at the target. The slot scripts' `--list` still sees a worktree whose `.env.slot`
    carries `LUNA_SLOT`.
11. **Tags and constraints.** Every one of the 103 `project.json` files has exactly one
    `scope:` tag, by the tag table. `eslint.config.mjs` has the `depConstraints` of D6 and
    no `sourceTag: '*'` entry. `npx nx run-many --all -t lint` passes, which proves the
    graph obeys them today.
12. **Release scopes.** `rules.mjs` has `server` and `client` in `SCOPES` and in
    `UNITS.velista`. Every old scope stays. `CONTRIBUTING.md` says which scope a new
    title uses. `node --test tools/release/release-notes.test.mjs` passes.
13. **Strings.** The OpenAPI title is `Velista API`. `DEFAULT_LEGAL_APP_NAME` is
    `'Velista'`. The harvester user agent product token is `Velista/0.1` (the URL and the
    mailbox inside it are unchanged; backend `0242` owns them). The legal texts name the
    software Velista in a sentence that reads correctly when the operator's app name is
    also Velista (D9).
14. **Documents.** `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `k8s/README*.md`,
    `tools/dev/README.md`, `k8s/e2e/*/parallel-worktree-testing.md`, the three skills
    under `.claude/skills/nx-portfolio-angular-developer`, `.vscode/launch.json` and every
    `README.md` beside code name the new paths, projects, commands and keys.
15. **Everything is green.** `npx nx run-many --all -t lint test build` passes. The
    OpenAPI document and the admin wire types are regenerated and current.
    `node tools/deploy/units.mjs check` passes. The pull request title passes
    `node tools/release/release-notes.mjs --check`.

### Scope

In: every tracked file outside the excluded paths of the name map; the `git mv` of the
nine directory roots and of the files named in the map; `tools/rename/` (new);
`tsconfig.base.json`; `eslint.config.mjs`; every `project.json`; `package.json` files of
the seven services and the regenerated `package-lock.json`; `k8s/helm/velista/**` by hand
under target state 7; `k8s/units/velista/unit.env` (`GATES`, `BUILD_ENV_*`);
`k8s/e2e/**`; `k8s/catalog-*/**` and `k8s/bootstrap/**` only where they name a project,
path, values key or script (never an object, Secret or database name); `.github/**`;
`tools/**`; `.claude/skills/nx-portfolio-angular-developer/**`; the documents of target
state 14.

Out, and why:

- The persisted layer (namespace, release, Secrets, ConfigMap, databases and roles,
  StatefulSets, Services, Deployments and every other Kubernetes object name, PVCs,
  PriorityClass, backup keys, the release task ledger): k8s `0019`, which recreates them
  in the new namespace anyway.
- JetStream stream and consumer names, NATS queue groups, browser storage keys: kept
  (D4); k8s `0019` D11 decides the streams, the consumer and the queue groups (it keeps
  them).
- The Android `appId` and package `app.velista`, the domains, the keystore and
  `assetlinks.json`: they already say velista, and a change would break installed apps.
- The contents of every `plans/` directory and of `docs/reports`: history. An old plan
  keeps the names it was written with, and a reader maps them through the name map.
- The registry path, the GitHub organisation and the repository name: docs `0005`.
- Moving the `scope:shared-core` libraries to a directory of their own: owner decision 11
  says tag now, extract later.
- `libs/shared/model-engines`: stays in `libs/shared`, tagged `scope:server` (D6); docs
  `0005` moves it with the server.

### Constraints

- One pull request. Commits in this order, so a reviewer can read each: (1) the
  `tools/rename/` scripts and their tests; (2) the `git mv` commit, nothing else; (3) the
  output of the replacement script; (4) the hand edits of the chart and the excluded
  files; (5) tags and constraints; (6) regenerated files (`openapi.json`,
  `wire-types.ts`, `package-lock.json`); (7) documents.
- The replacement is ordered and token based (D3). File stems and long names go before
  short ones, and the generic word last. The script refuses to run when two sources map
  onto one target, when a target directory already exists, or when a protected token
  count changes.
- Never edit `openapi.json` or `wire-types.ts` by hand. Run
  `npx nx run velista-server-gateway:openapi`, then
  `npx nx run velista-admin/models:wire-types`. Never run prettier over a directory.
- No change of behaviour. Apart from the strings of target state 13, a built bundle and a
  built image differ from today's only in paths and names.
- Use Git Bash on Windows for every script and `git mv`. Watch CRLF in generated files.
- Run `npx nx reset` after the moves and before any Nx command.

### Action boundaries

- Stop before you start, and again before `gh pr create`, if target state 1 prints a
  line.
- Stop and ask before you rename any token of the protected table, any Kubernetes object
  name, any database or role name, or any key that a GitHub environment holds.
- Stop and ask if a `depConstraints` entry fails on today's graph. Do not change
  application code to satisfy a constraint; report the edge.
- Do not touch a cluster, a registry or a GitHub setting. Do not delete an image.
- Do not run the local file mover in the main checkout. It is the owner's step.
- Do not add a dependency.

### Progress evidence

| Target state | Evidence |
| --- | --- |
| 1 | The command of target state 1, run twice, prints nothing |
| 2 | `node --test tools/rename/*.test.mjs` passes; the tests assert that the module's tables equal the counts of this plan (66 projects, 50 aliases, 10 images, 9 directory roots) and that no two sources share a target |
| 3 | `git show --stat` of the move commit lists renames only (`R100`); `git log --follow apps/velista-server/gateway/src/main.ts` reaches commits before the rename |
| 4 | `npx nx reset && npx nx show projects \| wc -l` prints 103; `npx nx show projects \| grep -c '^luna-shopper'` prints 0 |
| 5 | `grep -c '"@velista/' tsconfig.base.json` prints 50; `git grep -n "@portfolio/\(luna-shopper\|velista\)/"` outside excluded paths prints nothing |
| 6 | `node tools/deploy/units.mjs check` passes and its image list names the ten new images |
| 7 | `helm template` with each values file at the base commit and at the head, saved to files, and `diff` limited to the lines of target state 7 |
| 8 | `node tools/rename/apply-rename.mjs --verify-protected <base-sha>` reports equal counts for every protected token |
| 9 | `git grep -n -w -E "LUNA_[A-Z_]+"` outside excluded paths prints only the protected names and the D8 readers |
| 10 | `node --test tools/rename/move-local-files.test.mjs` passes against a temporary directory with old style ignored files; `bash k8s/e2e/velista-server/server-slot.sh --list` in a worktree whose `.env.slot` holds `LUNA_SLOT=3` reports slot 3 |
| 11 | `node -e` over every `project.json` asserting one `scope:` tag each; `npx nx run-many --all -t lint` |
| 12 | `node --test tools/release/release-notes.test.mjs`; `node tools/release/release-notes.mjs --check "feat(server): …"` and `"feat(luna): …"` both pass |
| 13 | `grep '"title"' apps/velista-server/gateway/docs/openapi.json` shows `Velista API`; the spec of `legal-settings.ts` and `template-version.spec.ts` pass |
| 14 | `git grep -n -i "luna"` over the documents of target state 14 prints only intentional history lines, each listed in the PR body |
| 15 | `npx nx run-many --all -t lint test build`; `openapi-document.spec.ts` and `wire-types.spec.ts` pass; `node tools/deploy/units.mjs check`; the PR title check |

## The name map

### Directories

Applied in this order (longer paths first).

| Old | New |
| --- | --- |
| `apps/luna-shopper-backend-e2e` | `apps/velista-server-e2e` |
| `apps/luna-shopper-backend` | `apps/velista-server` |
| `apps/luna-shopper-admin` | `apps/velista-admin` |
| `apps/velista-luna-e2e` | `apps/velista-stack-e2e` |
| `apps/velista-e2e` | `apps/velista-client-e2e` |
| `apps/velista` | `apps/velista-client` |
| `libs/luna-shopper-admin` | `libs/velista-admin` |
| `libs/luna-shopper` | `libs/velista-server` |
| `libs/velista` | `libs/velista-client` |
| `k8s/e2e/luna-shopper-backend` | `k8s/e2e/velista-server` |
| `k8s/e2e/velista-luna` | `k8s/e2e/velista-stack` |
| `k8s/helm/velista/templates/luna-shopper-backend` | `k8s/helm/velista/templates/velista-server` |

Files renamed beside the directories: `luna-slot.sh` becomes `server-slot.sh`;
`apps/luna-shopper-backend/.env.luna-shopper-backend.example` becomes
`apps/velista-server/.env.velista-server.example`; any other tracked file whose name
contains `luna-shopper` follows the project rules below.

### Projects and tags

Each `velista-server` service is `velista-server-<service>` for `assistant`, `auth`,
`catalog`, `core`, `gateway`, `harvester`, `realtime`, `transcriber`.

| Old name | New name | Tags added |
| --- | --- | --- |
| `luna-shopper-backend` | `velista-server` | `scope:server` |
| `luna-shopper-backend-<service>` (8) | `velista-server-<service>` | `scope:server` |
| `luna-shopper-backend-e2e` | `velista-server-e2e` | `scope:e2e` |
| `luna-shopper/contracts` | `velista-server/contracts` | `scope:shared-core` |
| `luna-shopper/basket-rules` | `velista-server/basket-rules` | `scope:shared-core` |
| `luna-shopper/shop-map/model` | `velista-server/shop-map/model` | `scope:shared-core` |
| `luna-shopper/shop-map/recorder` | `velista-server/shop-map/recorder` | `scope:shared-core` |
| `luna-shopper/shop-map/editor` | `velista-server/shop-map/editor` | `scope:shared-core` |
| `luna-shopper/postal-codes` | `velista-server/postal-codes` | `scope:shared-core` |
| `luna-shopper/osm-places` | `velista-server/osm-places` | `scope:shared-core` |
| `luna-shopper/platform` | `velista-server/platform` | `scope:server` |
| `luna-shopper/test-fixtures` | `velista-server/test-fixtures` | `scope:server` |
| `luna-shopper/carrefour` | `velista-server/carrefour` | `scope:server` |
| `luna-shopper/deza` | `velista-server/deza` | `scope:server` |
| `luna-shopper/dia` | `velista-server/dia` | `scope:server` |
| `luna-shopper/eljamon` | `velista-server/eljamon` | `scope:server` |
| `luna-shopper/lidl` | `velista-server/lidl` | `scope:server` |
| `luna-shopper/mercadona` | `velista-server/mercadona` | `scope:server` |
| `luna-shopper/curation-auth` | `velista-server/curation-auth` | `scope:server` |
| `luna-shopper/curation-cli` | `velista-server/curation-cli` | `scope:server` |
| `luna-shopper/curation-groups` | `velista-server/curation-groups` | `scope:server` |
| `luna-shopper/curation-suggestions` | `velista-server/curation-suggestions` | `scope:server` |
| `luna-shopper/leaflet-chains` | `velista-server/leaflet-chains` | `scope:server` |
| `luna-shopper/leaflet-cli` | `velista-server/leaflet-cli` | `scope:server` |
| `luna-shopper-admin` | `velista-admin` | `scope:admin`, `type:app` |
| `luna-shopper-admin/data-access` | `velista-admin/data-access` | `scope:admin`, `type:data-access` |
| `luna-shopper-admin/models` | `velista-admin/models` | `scope:admin`, `type:models` |
| `luna-shopper-admin/ui` | `velista-admin/ui` | `scope:admin`, `type:ui` |
| `luna-shopper-admin/feature-<x>` (7: `auth`, `brands`, `catalog`, `dashboard`, `harvest`, `people`, `resource`) | `velista-admin/feature-<x>` | `scope:admin`, `type:feature` |
| `velista` | `velista-client` | `scope:client`, `type:app` |
| `velista-e2e` | `velista-client-e2e` | `scope:e2e` |
| `velista-luna-e2e` | `velista-stack-e2e` | `scope:e2e` |
| `velista/data-access` | `velista-client/data-access` | `scope:client`, `type:data-access` |
| `velista/models` | `velista-client/models` | `scope:client`, `type:models` |
| `velista/native` | `velista-client/native` | `scope:client`, `type:native` |
| `velista/platform` | `velista-client/platform` | `scope:client`, `type:platform` |
| `velista/ui` | `velista-client/ui` | `scope:client`, `type:ui` |
| `velista/feature-<x>` (16: `account`, `assistant`, `auth`, `catalog`, `entry`, `home`, `install`, `landing`, `legal`, `lists`, `setup`, `shell`, `shop-map`, `shopping-lists`, `walk-lab`, `zones`) | `velista-client/feature-<x>` | `scope:client`, `type:feature` |

`name-map.mjs` lists the eight services, the seven admin features and the sixteen client
features one row each, so the module holds 66 rows. The 37 projects that keep their names
get tags only: `scope:portfolio` for `shell`, `odontogram`, `damoclesSword`, `landingV2`,
their four `-e2e` projects and every library under `libs/damoclesSword`,
`libs/odontogram` and `libs/landing-v2`; `scope:shared` for every library under
`libs/shared` except `model-engines`; `scope:server` for `shared/model-engines`;
`scope:tooling` for `docker`, `docker/builder` and `docker/local-http-server`. Existing
`deploy:*`, `microfrontend:angular` and `type:*-docker` tags stay.

### Aliases

| Old prefix | New prefix | Aliases |
| --- | --- | --- |
| `@portfolio/luna-shopper-admin/` | `@velista/admin/` | 10 |
| `@portfolio/luna-shopper/` | `@velista/server/` | 19 |
| `@portfolio/velista/` | `@velista/client/` | 21 |

The rest of the path is kept: `@portfolio/luna-shopper/contracts/brand-key` becomes
`@velista/server/contracts/brand-key`.

### Images

| Old `imageName` | New `imageName` |
| --- | --- |
| `nx-portfolio/luna-shopper-backend-<service>` (8) | `nx-portfolio/velista-server-<service>` |
| `nx-portfolio/luna-shopper-admin` | `nx-portfolio/velista-admin` |
| `nx-portfolio/velista` | `nx-portfolio/velista-client` |

The chart values change the last path segment of `image:` only (for example
`ghcr.io/ichirokuxvi/nx-portfolio/velista-server-gateway`). The entry's `name:` stays.

### Env keys

Applied in this order, each anchored at a word start: `NG_LUNA_SHOPPER_ADMIN_` to
`NG_VELISTA_ADMIN_`; `LUNA_SHOPPER_ADMIN_` to `VELISTA_ADMIN_`; `DEFAULT_LUNA_` to
`DEFAULT_VELISTA_`; `DEV_LUNA_` to `DEV_VELISTA_`; `LUNA_` to `VELISTA_`. The protected
names `LUNA_EVENTS` and `LUNA_ACCOUNT_DELETIONS` are masked before and restored after.
The script refuses to run when a target key already exists with a different meaning.

### Words, last

After every rule above: `Luna Shopper backend` to `Velista server`; `Luna Shopper admin`
and `luna-shopper-admin` (in prose) to `Velista admin`; `Luna Shopper` to `Velista`;
`lunaShopperBackend` to `velistaServer`; `LunaShopperBackend` to `VelistaServer`;
`LunaShopper` to `Velista`; `Luna slot` to `server slot`. A remaining case insensitive
`luna` is not replaced by the script. It prints each one with its file and line, and the
builder resolves it by hand or adds it to the allow list with a reason.

### Protected tokens

Masked before the replacement and restored after, in every file: `luna_auth`,
`luna_core`, `luna_catalog`, `luna_harvester` and their `_test` forms;
`luna-shopper-backend-secrets`; `luna-shopper-backend-{auth,core,catalog,harvester}-db-secret`;
`luna-shopper-backend-backup-secret`; `luna-shopper-backend-operator`;
`luna-shopper-backend-config`; `luna-shopper-backend-{auth,core,catalog,harvester}-db`;
`luna-stateful`; `NAMESPACE=luna-shopper` and every other occurrence of the namespace
`luna-shopper` as a namespace value (the builder finds them with
`git grep -n -E "(namespace|-n|NAMESPACE)[ =:]+luna-shopper\b"`); `LUNA_EVENTS`;
`luna-realtime` as the consumer name; `LUNA_ACCOUNT_DELETIONS`; every
`queue: 'luna-shopper-backend-<service>'`; `COMPOSE_PROJECT_NAME:-luna-shopper-backend`;
the `luna-slot${…}` compose project expression; `luna-slot-locks`;
`luna-slot-ephemeral`; `luna-transcriber-models`; `luna-admin:reloaded-for-version`
(`libs/luna-shopper-admin/data-access/src/lib/client-version-interceptor.ts`).

### Excluded paths

Not rewritten by the script: `**/plans/**`, `docs/plans/**`, `docs/reports/**`,
`**/docs/research/**`, every file under `**/__fixtures__/**` except its `README.md`
(captured third party data, where "LUNA" is sometimes a brand: the El Jamón capture lists
`JUAN LUNA`;
the `README.md` files are ours and name capture commands, so they are rewritten),
`.claude/skills/prompt-master/**`, `apps/luna-shopper-backend/gateway/docs/openapi.json`,
`libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, `package-lock.json`, binary
files. Rewritten by hand, under target state 7 and the protected table:
`k8s/helm/**`, `k8s/bootstrap/**`, `k8s/release-tasks/**`, `k8s/catalog-*/**`,
`k8s/units/**`.

## Decisions taken in this plan

- **D1. Directories carry the full role name: `apps/velista-server`, `libs/velista-server`,
  and the same for client and admin.** One directory name equals one project name prefix,
  so a path tells the reader the project. `libs/server` beside `libs/shared`,
  `libs/odontogram` and `libs/landing-v2` would read as a portfolio server for as long as
  both live in `nx-portfolio`, and renaming twice (once here, once in docs `0005`) costs a
  second mass rename. Rejected: `libs/server`, `libs/client`, `libs/admin`.
- **D2. Aliases mirror directories: `@velista/server/*`, `@velista/client/*`,
  `@velista/admin/*`.** One prefix, `@velista/`, and an alias that tells where the code
  lives. The shared-core libraries (`contracts` and the six beside it) keep the `server`
  segment because they live under `libs/velista-server`, and owner decision 11 extracts
  them later; that extraction moves directory and alias together. Rejected: a flat
  `@velista/<lib>`, which collides at once (`data-access`, `models`, `ui` exist in both
  client and admin).
- **D3. A committed, ordered, token based script, run once.** `tools/rename/name-map.mjs`
  holds the map, `tools/rename/apply-rename.mjs` applies it (`git mv` first, then ordered
  replacement in tracked text files outside the excluded paths, with protected tokens
  masked), and `tools/rename/move-local-files.mjs` moves a checkout's ignored files. The
  map is applied stems first and the generic word last, as the backend `0144` merge
  taught. The same scripts port an open branch across the rename later. Rejected: an IDE
  rename (not reproducible, no protection) and a blind `sed` (would rename database names,
  queue groups and a GPT model).
- **D4. Persisted and wire identifiers keep the old name.** A JetStream stream or durable
  consumer with a new name is a new, empty stream or a cursor that starts over; an
  account deletion in flight would never reach core or catalog. A new NATS queue group
  during a rolling update means the old pod and the new pod each receive every request,
  so a write runs twice. A renamed compose project or volume orphans a developer's data.
  These names are invisible to users. k8s `0019` D11 owns the decision for the streams,
  the consumer and the queue groups: it keeps all of them, and a later plan may rename
  them with a drain.
- **D5. Kubernetes object names stay in this plan, and the staging restart list stops
  assuming they equal project names.** Under `k8s/helm/velista`, docs `0003` changes the
  `image` fields, the values key `lunaShopperBackend`, the template directory and `define`
  names and the harvester user agent token, and no Kubernetes object name; k8s `0019`
  renames every object. k8s `0019` moves every object into a new namespace
  and can rename each one there at no extra cost. Renaming Deployments here would delete
  and recreate them in place, break the portfolio's route to Service `velista` until both
  charts redeploy, and cost production a second interruption. The restart list in
  `stage-unit.yml` and `deploy-unit` becomes: every Deployment of the release whose
  container image is one of the images this run built, read from
  `helm get manifest`, the way `k8s/helm/deploy-release.sh` already reads its
  Deployments. That rule holds after `0019` too, and k8s `0019` and docs `0005` rely on
  it. Rejected: a table of old Deployment
  names in `units.mjs`, which `0019` would have to delete, and which the silent skip in
  `deploy-unit` would hide when wrong.
- **D6. Tags and constraints.**
  - Scopes: `scope:server`, `scope:shared-core`, `scope:client`, `scope:admin`,
    `scope:e2e`, `scope:portfolio`, `scope:shared`, `scope:tooling`. Every project has
    one, because `@nx/enforce-module-boundaries` reports a project that imports anything
    and matches no constraint (`projectWithoutTagsCannotHaveDependencies`).
  - `scope:shared-core` is the framework free code any client may use: `contracts`,
    `basket-rules`, `shop-map/model`, `shop-map/recorder`, `shop-map/editor`,
    `postal-codes`, `osm-places`. The recorder and the editor import only
    `shop-map/model` and Node built ins, and velista uses both. `platform` (Nest),
    `test-fixtures` (server test data), the six chain adapters and the curation and
    leaflet tools are `scope:server`: no client uses them. `model-engines` is
    `scope:server` because only server tools use it.
  - The constraints, in `eslint.config.mjs`:

    ```js
    depConstraints: [
      { sourceTag: 'scope:shared-core', onlyDependOnLibsWithTags: ['scope:shared-core'],
        bannedExternalImports: ['@angular/*', '@nestjs/*', 'typeorm', 'rxjs'] },
      { sourceTag: 'scope:server', onlyDependOnLibsWithTags: ['scope:server', 'scope:shared-core'] },
      { sourceTag: 'scope:client', onlyDependOnLibsWithTags: ['scope:client', 'scope:shared-core', 'scope:shared'] },
      { sourceTag: 'scope:admin', onlyDependOnLibsWithTags: ['scope:admin', 'scope:shared-core', 'scope:shared'] },
      { sourceTag: 'scope:e2e', onlyDependOnLibsWithTags: ['scope:server', 'scope:shared-core', 'scope:client', 'scope:admin', 'scope:shared'] },
      { sourceTag: 'scope:portfolio', onlyDependOnLibsWithTags: ['scope:portfolio', 'scope:shared'] },
      { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
      { sourceTag: 'scope:tooling', onlyDependOnLibsWithTags: ['scope:tooling'] },
      { sourceTag: 'type:data-access', notDependOnLibsWithTags: ['type:feature', 'type:ui'] },
      { sourceTag: 'type:models', notDependOnLibsWithTags: ['type:feature', 'type:ui'] },
      { sourceTag: 'type:native', notDependOnLibsWithTags: ['type:feature', 'type:ui'] },
      { sourceTag: 'type:platform', notDependOnLibsWithTags: ['type:feature', 'type:ui'] },
    ]
    ```

    The keys are those of `DepConstraint` in
    `node_modules/@nx/eslint-plugin/src/utils/runtime-lint-utils.d.ts` (Nx 22.7.2). Every
    matching constraint applies, so a client data-access library meets both its scope
    rule and its type rule. `notDependOnLibsWithTags` is transitive
    (`findDependenciesWithTags`), which is what the rule of owner decision 11 needs:
    `velista-client/data-access` reaches `platform`, which reaches
    `shop-map/recorder`, and none of them may lead to a feature or `ui`.
  - The type rule covers the admin as well as the client. Both obey it today, and an
    unequal rule would need an explanation.
  - Rejected: a dedicated tag such as `reuse:angular-client`. `type:` tags describe each
    library once and serve later rules too.
- **D7. Image names change their last segment only.** `nx-portfolio/` is the repository
  path in the registry and follows the repository in docs `0005`. Changing it here would
  rename every image twice.
- **D8. `LUNA_*` keys become `VELISTA_*` now.** The Compose path of k8s `0020` publishes
  these keys to operators, and a key renamed after that is a breaking change for every
  deployment. The cost now is local: each checkout's ignored `.env` files.
  `move-local-files.mjs` renames them with values kept, and `server-slot.sh` and
  `ng-slot.sh` read `LUNA_SLOT` beside `VELISTA_SLOT` in another worktree's `.env.slot`,
  so `--list` stays correct while worktrees on older commits exist. That reader is the
  only `LUNA_` key left, marked for removal in docs `0005`.
- **D9. The legal texts name the software without the circular sentence, and keep their
  version.** With `DEFAULT_LEGAL_APP_NAME` equal to `Velista`, "{{appName}} is built on
  Velista" reads "Velista is built on Velista". The four sentences become one that works
  for any app name, for example "The software behind {{appName}} is Velista, open source
  software published under its own licence." Naming the software is not a change of what
  a person accepts, so `LEGAL_TEMPLATES` keeps its version and no account is asked to
  accept again (backend `0231`). The owner may decide otherwise (owner decision 5).
- **D10. The release title.**
  `refactor(server,client,admin)!: Luna Shopper becomes Velista (plan docs 0003)` (77
  characters). `server` and `client` are added in this pull request, and `pr-title.yml`
  checks the merge commit, so they are valid for this title. A title with no scope
  (`refactor!: …`) also passes, but it would put a breaking change line into the
  portfolio's notes. `rules.mjs` has no `workspace` scope, and adding one for a single
  pull request is not worth a permanent scope. The `!` is honest: every project name,
  alias, env key and image name a developer or a script uses changes.
- **D11. The staging run after the merge rebuilds everything, by design.** Every
  `project.json` changes, so `nx show projects --affected` lists every project and both
  `staging-portfolio.yml` and `staging-velista.yml` build every image of their unit. The
  portfolio redeploys identical code. The velista unit deploys the same code under the
  new image names into the old namespace, with the old object names, and each Deployment
  rolls because its image reference changed. k8s `0019` moves it later.
- **D12. The CI filter of `pr.yml` keeps its meaning.** It selects projects with
  `grep -E '^luna-shopper'`, which today matches the admin too. It becomes
  `grep -E '^velista-(server|admin)'`. Any other filter by prefix keeps the set it
  selected before, and the builder lists each one in the PR body.
- **D13. The contract schema ids move from `luna://` to `velista://`.** The owner decided
  this on 2026-11-03. `schemaId(path)` in `libs/velista-server/contracts/src/schemas/builders.ts`
  builds `velista://<path>`, and every comment, spec and literal that names a `luna://` id
  follows. The ids are keys inside one ajv instance: none appears in `openapi.json`, the
  admin wire types or a stored row, so no reader outside the code sees the change. The
  rename is one explicit rule of the script, applied before "Words, last", and the
  progress evidence includes `git grep -n "luna://"` printing nothing outside the excluded
  paths. Rejected: keeping `luna://` as an internal name, and the URN form of backend
  `0242` D2 for every contract, which no outside reader needs.

## Owner decisions

1. **The e2e project names.** Recommendation: `velista-server-e2e`, `velista-client-e2e`
   (today `velista-e2e`, the client against its own data access) and `velista-stack-e2e`
   (today `velista-luna-e2e`, the client against a running server). Reusing the name
   `velista-e2e` for a different suite is rejected: an old branch, a log line or a merge
   script would read it with the old meaning. The gate directories follow:
   `k8s/e2e/velista-server` and `k8s/e2e/velista-stack`.
2. **The library directory scheme.** Recommendation: `libs/velista-server`,
   `libs/velista-client`, `libs/velista-admin` (D1). Alternative: `libs/server`,
   `libs/client`, `libs/admin`, cleaner inside the future Velista repository and
   ambiguous inside `nx-portfolio` until docs `0005`.
3. **`LUNA_*` env keys.** Recommendation: rename now (D8). Alternative: keep them until
   docs `0005`, at the price of publishing `LUNA_` keys in the Compose path of k8s `0020`
   or renaming them there.
4. **The alias scheme.** Recommendation: `@velista/server/*`, `@velista/client/*`,
   `@velista/admin/*` (D2). Alternative: also move the seven `scope:shared-core` libraries
   to `libs/velista-core` with `@velista/core/*` in this same pull request, since every
   import line is rewritten anyway. That contradicts owner decision 11 as written, so the
   plan does not do it unless the owner says so.
5. **The legal texts.** Recommendation: the sentence of D9, no version bump. Alternative:
   bump `LEGAL_TEMPLATES` and the four `templateVersion` fields, which asks every account
   to accept the terms again.
6. **The harvester user agent.** Recommendation: change the product token to
   `Velista/0.1` now. A chain that filters by user agent may answer the new token
   differently (Mercadona has answered 403 before); the first scheduled production run
   after the release shows it. Alternative: keep `LunaShopper/0.1` until backend `0242`
   rewrites the whole string.

## Owner steps outside the code

- **Before the build: hold the window.** Merge or close every pull request that target
  state 1 lists, and open none until this one merges. Renovate pull requests may stay
  open; rebase each after the merge (its branch only touches `package.json`, the lock
  file and image digests, and the lock file moves here).
- **Before the build: stop every slot.** In each checkout and worktree, run
  `tools/dev/ng-slot.sh --down --keep-slot` and
  `bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down --keep-slot` (or
  `--down --keep-data` for a slot whose databases you keep). A running process holds the
  old paths and the old `.env` values.
- **After the merge, in the main checkout and each worktree you keep:** pull, run
  `npm install`, run `node tools/rename/move-local-files.mjs`, run `npx nx reset`, and
  start slots through `tools/dev/ng-slot.sh --up` and
  `bash k8s/e2e/velista-server/server-slot.sh --up`. The compose volumes keep their names,
  so the databases come back as they were.
- **After the merge into `main`: watch the first staging runs.** Both pipelines build
  every image (D11). The new image names are new packages in the GitHub container
  registry. Today's packages are public. If a new package is created private, the
  cluster cannot pull it, `--atomic` rolls staging back, and the deploy job fails with
  `ImagePullBackOff` in its diagnosis. Then open each new package
  (`velista-server-*`, `velista-client`, `velista-admin`) in GitHub, set its visibility
  to public, and rerun the failed job. Production pulls the same packages at the next
  release, so check them before that.
- **Update the memory of the guiding agent.** The memory files under
  `~/.claude/projects/` name the old plan directories, projects, aliases, scripts and
  keys. After the merge, rewrite them through the name map (`tools/rename/name-map.mjs`
  is the reference).
