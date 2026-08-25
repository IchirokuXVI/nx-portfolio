# 0014 Rename the app to `luna-shopper-backend`

## 1. Goal

Today the backend occupies the bare name `luna-shopper`: the directory
`apps/luna-shopper/`, the umbrella Nx project `luna-shopper`, the Helm value key
`lunaShopper`, and the Helm template folder `k8s/helm/templates/luna-shopper/`.
When a Luna Shopper **frontend** app arrives it will want that same bare name, and
`nx run luna-shopper:seed` will stop being self explanatory.

This plan renames the backend so the two can never be confused, and inventories
every reference that has to move with it.

The e2e project already anticipates this: it is called `luna-shopper-backend-e2e`
and lives in `apps/luna-shopper-backend-e2e/`, and `k8s/e2e/luna-shopper-backend/`
already uses the target name too. This plan makes the rest of the tree agree with
them.

> This plan file itself lives inside the directory being renamed. After step 5.1
> its path becomes `apps/luna-shopper-backend/plans/0014-...md`.

## 2. Scope decision

Not everything that contains the string `luna-shopper` should become
`luna-shopper-backend`. Three tiers:

### Tier 1, rename (the actual ask)

| Thing | From | To |
| --- | --- | --- |
| App directory | `apps/luna-shopper/` | `apps/luna-shopper-backend/` |
| Umbrella Nx project | `luna-shopper` | `luna-shopper-backend` |
| Shared dev env file | `.env.luna-shopper` | `.env.luna-shopper-backend` |
| Helm template folder | `k8s/helm/templates/luna-shopper/` | `k8s/helm/templates/luna-shopper-backend/` |
| Helm secrets doc | `k8s/helm/luna-shopper-secrets.md` | `k8s/helm/luna-shopper-backend-secrets.md` |

That alone removes the collision: the bare `luna-shopper` name and the bare
`apps/luna-shopper/` path are both freed for the frontend.

### Tier 2, optional consistency (recommend: **do it in the same pass**)

| Thing | From | To |
| --- | --- | --- |
| Helm values key | `lunaShopper` | `lunaShopperBackend` |
| Helm helper define | `lunaShopper.env` | `lunaShopperBackend.env` |
| Compose project name default | `luna-shopper` | `luna-shopper-backend` |

These do not strictly collide with a frontend, but they are cheap right now
(the chart is not deployed, see section 4) and expensive later.

**Service project names** (`luna-shopper-auth`, `-core`, `-catalog`, `-gateway`,
`-realtime`) and their **image names** (`nx-portfolio/luna-shopper-auth`, and so
on) are deliberately **left alone**. A frontend will never own a project called
`luna-shopper-auth`, so there is no ambiguity to fix, and renaming them would
churn every `project.json`, `package.json`, `jest.config.cts`, `webpack.config.js`
output path, `dist/apps/*` path, Helm service entry, image repo and
`.vscode/launch.json` entry for no gain. If you disagree, section 6.3 lists what
that would add.

### Tier 3, do **not** rename

`libs/luna-shopper/*` and the `@portfolio/luna-shopper/*` path aliases stay as
they are. `contracts` is the shared API contract library and is explicitly meant
to be consumed by a frontend, so scoping it to `backend` would be actively wrong.
`platform` and `test-fixtures` are backend only, but they sit in the same scope
folder and renaming them would touch **113 files / 147 import sites** for zero
disambiguation value.

The product name **"Luna Shopper"** in prose, comments, `mailFrom` values and
docs also stays. It is the product, not the app.

Database names (`luna_auth`, `luna_core`, `luna_catalog`), the `LUNA_*_PORT`
compose variables and `LUNA_ENV` contain no `shopper` segment and are untouched.

## 3. Complete reference inventory

191 tracked files contain `luna-shopper` or `lunaShopper`, 694 occurrences
(`package-lock.json` excluded). Broken down:

| Area | Occurrences | Of which `@portfolio/luna-shopper/*` imports (Tier 3, no change) | To review |
| --- | --- | --- | --- |
| `apps/luna-shopper/**` | 448 | 135 | 313 |
| `k8s/**` | 171 | 0 | 171 |
| `libs/luna-shopper/**` | 33 | 7 | 26 |
| `apps/luna-shopper-backend-e2e/**` | 12 | 2 | 10 |
| `.vscode/launch.json` | 12 | 0 | 12 |
| `.gitignore` | 12 | 0 | 12 |
| `tsconfig.base.json` | 6 | 3 | 3 |
| **Total** | **694** | **147** | **547** |

So **547 occurrences across 110 files** actually need review, and the great
majority of those are the literal path prefix `apps/luna-shopper/`, which is
mechanical. The remaining 81 files carry nothing but `@portfolio/luna-shopper/*`
imports and are not touched at all.

The per file counts in the tables below are **matching lines**, so a line holding
two occurrences counts once; that is why they sum to less than 694.

### 3.1 Root level files

| File | Refs | What |
| --- | --- | --- |
| `.gitignore` | 9 | ignores `apps/luna-shopper/.env.luna-shopper`, `apps/luna-shopper/*/.env`, `apps/luna-shopper/*/.env.test`, `apps/luna-shopper/.snapshots/`, `apps/luna-shopper/secrets/*` plus the `!.../secrets/.gitkeep` negation, and `k8s/e2e/luna-shopper-backend/.env.slot` (this last one is already correct) |
| `.vscode/launch.json` | 12 | four debug configs: `nx serve luna-shopper-<svc>` plus `apps/luna-shopper/<svc>/dist/**` source map globs |
| `tsconfig.base.json` | 6 | the three `@portfolio/luna-shopper/*` aliases pointing at `libs/luna-shopper/*` (**Tier 3, no change**) |
| `nx.json` | 0 | nothing to do |
| `.github/workflows/*` | 0 | **nothing to do.** CI is entirely `nx affected` driven and hardcodes no project name |

### 3.2 `apps/luna-shopper/` umbrella

| File | Refs | What |
| --- | --- | --- |
| `project.json` | 6 | `"name": "luna-shopper"`, `sourceRoot`, the `// ` doc comment, three `node apps/luna-shopper/tools/db/*.js` commands |
| `.env.luna-shopper.example` | 9 | its own filename in the copy instructions, the `apps/luna-shopper/secrets/jwt.*` openssl commands, per service `.env` paths |
| `docs/testing-strategy.md` | 13 | paths and `nx run luna-shopper:*` invocations |
| `tools/README.md` | 7 | paths and target names |
| `tools/db/env.js` | 4 | hardcoded `envDir` for auth/core/catalog plus `apps/luna-shopper/.env.luna-shopper` |
| `tools/db/seed.js` | 2 | paths |
| `tools/db/snapshot.js` | 2 | paths including `.snapshots/` |
| `tools/db/restore.js` | 5 | paths |
| `tools/db/guard.js` | 1 | path |
| `plans/0001` through `plans/0013` | 49 | doc references; `0001-create-app.md` (12) and `0013-test-data-fixtures-and-seeding.md` (24) carry most of them |

### 3.3 Per service (`auth`, `core`, `catalog`, `gateway`, `realtime`)

Same shape in each. Counts are auth / core / catalog / gateway / realtime.

| File | Refs | What |
| --- | --- | --- |
| `project.json` | 17 / 17 / 16 / 12 / 12 | `sourceRoot`, `outputs` `dist/apps/luna-shopper-<svc>`, build `cwd: apps/luna-shopper/<svc>`, `imageName`, `jestConfig` paths, and the `migration:run|revert|generate` plus `seed` commands with full `apps/luna-shopper/<svc>/src/app/db/...` paths |
| `webpack.config.js` | 1 each | `output.path` = `dist/apps/luna-shopper-<svc>` (project name, Tier 2 only) |
| `jest.config.cts` | 2 each | `displayName` plus coverage dir |
| `jest.integration.config.cts` | 2 (auth, core) | same |
| `package.json` | 2 each | `"name"` (project name, Tier 2 only) |
| `.env.example` | 6 / 3 / 3 / 4 / 3 | `apps/luna-shopper/secrets/jwt.*` paths and copy instructions |
| `.env.test.example` | 4 / 2 / 2 | same |
| `src/main.ts` | 2 each | startup log line carrying the service name (Tier 2 only) |
| `src/app/app.module.ts` | 4 / 4 / 4 / 5 / 5 | `envFilePath: ['apps/luna-shopper/<svc>/.env', 'apps/luna-shopper/.env.luna-shopper']` and `PlatformModule.forRoot({ serviceName })` |
| `src/app/db/data-source.ts` | 4 (auth, core, catalog) | env file paths plus the migrations glob |
| `src/app/db/cli.js`, `db/seed/cli.js` | 1 to 3 each | env file paths |
| `src/Dockerfile` | 0 paths | only the "Luna Shopper" prose header; the image is built through the `NX_APP` build arg, so **no path edit is needed** |
| `docs/*.md` | 2 / 3 / 9 | `auth/docs/data-model.md`, `core/docs/data-model.md`, `gateway/docs/architecture.md` |
| about 100 `src/**/*.ts` files | 1 to 2 each | **all `@portfolio/luna-shopper/{contracts,platform}` imports, Tier 3, no change** |

### 3.4 `apps/luna-shopper-backend-e2e/` (already correctly named)

| File | Refs | What |
| --- | --- | --- |
| `project.json` | 4 | `implicitDependencies` (project names, Tier 2 only) plus the `// e2e` doc comment mentioning `k8s/e2e/luna-shopper-backend` |
| `src/support/db.ts` | 4 | `apps/luna-shopper/.snapshots/.e2e-restore-target`, `apps/luna-shopper/tools/db/<script>` and a `nx run luna-shopper:*` comment |
| `playwright.config.ts`, `core-flow.spec.ts`, `seeded-flow.spec.ts` | 1 each | comments and imports |

### 3.5 `k8s/`

| File | Refs | What |
| --- | --- | --- |
| `k8s/helm/values.yaml` | 32 | the `lunaShopper:` key (Tier 2), five production plus five staging service entries with `name: luna-shopper-<svc>` and `image: ghcr.io/.../luna-shopper-<svc>` (Tier 2), `natsUrl: nats://luna-shopper-nats:4222`, three postgres entries `luna-shopper-<svc>-db` with `secret: luna-shopper-<svc>-db-secret`, plus prose |
| `k8s/helm/templates/luna-shopper/*.tpl` (8 files) | 42 total | folder rename plus every `.Values.lunaShopper` reference and the `lunaShopper.env` define (`nats.yaml.tpl` 13, `deployment` 7, `migration-job` 7, `postgres` 5, `configmap`/`pdb`/`service` 3 each, `_env.tpl` 1) |
| `k8s/helm/templates/reverse-proxy/_nginx.conf.tpl` | 2 | `.Values.lunaShopper.enabled` and `.services` |
| `k8s/helm/templates/reverse-proxy/deployment.yaml.tpl` | 2 | same |
| `k8s/helm/luna-shopper-secrets.md` | 18 | filename, `lunaShopper.*` value paths, secret names |
| `k8s/e2e/luna-shopper-backend/compose.yml` | 6 | `name: ${COMPOSE_PROJECT_NAME:-luna-shopper}` (Tier 2), plus prose and `nx serve luna-shopper-<svc>` examples, and a stale `cp .env.luna-shopper.example .env` line |
| `k8s/e2e/luna-shopper-backend/luna-slot.sh` | 30 | compose project name and paths |
| `k8s/e2e/luna-shopper-backend/luna-slot.ps1` | 23 | same |
| `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md` | 10 | docs |

### 3.6 `libs/luna-shopper/` (Tier 3, path text only)

`contracts`, `platform`, `test-fixtures`: 3 refs each in `project.json`,
`README.md` and `jest.config.cts`, plus a handful of comments in
`platform/src/**` and `test-fixtures/src/**` that mention
`apps/luna-shopper/<svc>/...` paths. Only those **prose path mentions** need
updating; the project names and the aliases stay.

## 4. Why this is cheap right now

`luna-shopper` has **never reached `main`**. Verified: `git ls-tree origin/main apps/`
has no luna entry, and `lunaShopper.enabled` is `false` in `values.yaml`.
Consequences:

- **No images exist in `ghcr.io/ichirokuxvi/nx-portfolio/luna-shopper-*`**, so an
  image rename orphans nothing and needs no registry cleanup.
- **Nothing is deployed to the cluster**, so renaming Deployments, Services, the
  NATS StatefulSet and the three Postgres StatefulSets does not strand PVCs, does
  not need a data migration, and cannot cause downtime.
- **No `api.` or `rt.` DNS records** are cut over.
- **CI hardcodes nothing.** `.github/workflows/*` contains zero `luna` references;
  it is fully `nx affected` driven.

The only live state at risk is a developer's **local** docker compose stack: the
default compose project name `luna-shopper` names the containers, network and
volumes, so changing it (Tier 2) makes existing local volumes invisible. That is
a one line `docker compose down -v` followed by a reseed.

## 5. Execution order

Do it as one commit; a half renamed tree does not build.

1. **Move directories with `git mv`** (preserves history):
   - `git mv apps/luna-shopper apps/luna-shopper-backend`
   - `git mv k8s/helm/templates/luna-shopper k8s/helm/templates/luna-shopper-backend`
   - `git mv k8s/helm/luna-shopper-secrets.md k8s/helm/luna-shopper-backend-secrets.md`
   - `git mv apps/luna-shopper-backend/.env.luna-shopper.example apps/luna-shopper-backend/.env.luna-shopper-backend.example`
2. **Rewrite the path prefix everywhere.** Order matters, longest first, so the
   already correct strings are not double prefixed:
   1. `apps/luna-shopper-backend-e2e` and `k8s/e2e/luna-shopper-backend` are
      already correct. Protect them by rewriting `apps/luna-shopper/` (with the
      trailing slash) rather than the bare `apps/luna-shopper`.
   2. `apps/luna-shopper/` becomes `apps/luna-shopper-backend/`
   3. `.env.luna-shopper` becomes `.env.luna-shopper-backend`
   4. `templates/luna-shopper/` becomes `templates/luna-shopper-backend/`
   5. `luna-shopper-secrets.md` becomes `luna-shopper-backend-secrets.md`
   6. Bare `luna-shopper` used as an **Nx target invocation**: `nx run luna-shopper:seed`,
      `:db:snapshot`, `:db:restore` become `luna-shopper-backend:...`. Grep for
      `luna-shopper:` specifically, and do **not** touch `luna-shopper/contracts`,
      `luna-shopper/platform` or `luna-shopper/test-fixtures`.
3. **`apps/luna-shopper-backend/project.json`**: set `"name": "luna-shopper-backend"`
   and update `sourceRoot` plus the `// ` doc comment.
4. **Tier 2 (if taken)**: `lunaShopper` becomes `lunaShopperBackend` across
   `k8s/helm/**` (values, all templates, the reverse-proxy templates, the secrets
   doc), and `COMPOSE_PROJECT_NAME:-luna-shopper` becomes
   `COMPOSE_PROJECT_NAME:-luna-shopper-backend` in `compose.yml` and both
   `luna-slot` scripts.
5. **Hand check** the files a blind substitution gets wrong:
   - `.gitignore` (the `k8s/e2e/luna-shopper-backend/.env.slot` line is already
     correct and must not become `-backend-backend`)
   - `apps/luna-shopper-backend/.env.luna-shopper-backend.example` (its own name
     appears inside the copy instructions)
   - `k8s/e2e/luna-shopper-backend/compose.yml` line 13, which already tells you
     to copy the example to a bare root `.env`; that instruction is stale versus
     the current `.env.luna-shopper` scheme and should be corrected while here
   - `apps/luna-shopper-backend-e2e/project.json`, the `// e2e` comment
   - `tsconfig.base.json`: **must stay unchanged**
6. **Verify** (section 7).

## 6. Complexity assessment

### 6.1 Verdict

**Low to moderate: mechanical, wide, and low risk.** 547 occurrences over 110
files once the Tier 3 imports are excluded, but the large majority of them are
one literal string, `apps/luna-shopper/`, replaced by one other literal string.
There is no code restructuring, no API change and no data migration. Budget
**half a day** including verification, most of it spent on the Helm chart and on
re reading the docs and plan files for sentences that a substitution mangles.

### 6.2 What makes it easy

- Never deployed, never published (section 4). This is by far the biggest factor;
  the same rename after go live would mean new image repos, new k8s objects, PVC
  migration and a DNS cutover.
- CI hardcodes no project names.
- Nx resolves projects by the `name` in `project.json`, not by directory, so the
  directory move and the project rename are independent and can be verified
  separately.
- The Dockerfiles take the project name through the `NX_APP` build arg, so not one
  Dockerfile needs a path edit.
- `apps/luna-shopper-backend-e2e/` and `k8s/e2e/luna-shopper-backend/` already use
  the destination name, so a third of the infrastructure is pre migrated.

### 6.3 What makes it fiddly

- **Two similar names in flight.** `apps/luna-shopper/` must be rewritten while
  `apps/luna-shopper-backend-e2e/` must not. Always anchor on the trailing slash,
  then grep for `luna-shopper-backend-backend` afterwards.
- **Hardcoded env paths in runtime code.** Every service's `app.module.ts`,
  `data-source.ts`, `db/cli.js` and `db/seed/cli.js` names its `.env` by a
  workspace relative path. These fail at **runtime**, not at compile time, so the
  compiler will not catch a miss. Same for the `tools/db/*.js` orchestrators.
  Booting each service once is the only real check.
- **The Helm chart is text templates.** `helm lint` and `helm template` catch a
  dangling `.Values.lunaShopper` only when `enabled` is true, so lint with
  `--set lunaShopperBackend.enabled=true` or the rename goes unverified.
- **The `.snapshots/` directory** is git ignored and lives at
  `apps/luna-shopper/.snapshots/`. Any local snapshots must be moved by hand or
  recreated; the e2e restore target file is read from that path.
- **Local docker volumes** are orphaned by the Tier 2 compose project rename.
- **Plan files 0001 through 0013** describe the old paths. They are historical
  records, so update the paths (they are still used as working references) but do
  not rewrite their narrative.
- **If Tier 2 grows into service renames** (`luna-shopper-auth` becoming
  `luna-shopper-backend-auth`), add: 5 `project.json` names plus their `serve`
  `buildTarget` self references, 5 `package.json` names, 7 jest `displayName`s, 5
  `webpack.config.js` output paths, 15 `dist/apps/*` output declarations, 5
  `imageName`s, 10 Helm service entries plus 3 postgres entries and their secret
  names, `nats://luna-shopper-nats`, 4 `.vscode` debug configs, the e2e
  `implicitDependencies`, and 5 `serviceName` values. Call it about 120 more
  occurrences and a materially higher chance of a runtime miss.
  **Not recommended**, see section 2.

### 6.4 Risk

Low. The failure mode is a missed string, and the worst case is a service that
cannot find its `.env` at boot, which is loud and immediate. Nothing is
destructive, nothing is externally visible, and `git mv` keeps the history. The
change is trivially revertible as a single commit.

## 7. Verification

```sh
# 1. No stale references, and no double prefixes from an over eager substitution
git grep -n 'apps/luna-shopper/'            # expect: nothing
git grep -n 'luna-shopper-backend-backend'  # expect: nothing
git grep -n '\.env\.luna-shopper\b'         # expect: nothing
git grep -n 'templates/luna-shopper/'       # expect: nothing
git grep -n '\.Values\.lunaShopper\b'       # expect: nothing (if Tier 2 taken)

# 2. The aliases and the libs must be untouched
git grep -n '@portfolio/luna-shopper/'      # expect: 147 hits, unchanged
git diff --stat tsconfig.base.json          # expect: no change

# 3. Nx sees the renamed project and still resolves the graph
npx nx show projects | grep luna
npx nx graph --file=graph.json

# 4. Everything still builds, lints and tests
npx nx run-many -t lint test build -p luna-shopper-auth,luna-shopper-core,luna-shopper-catalog,luna-shopper-gateway,luna-shopper-realtime,luna-shopper/contracts,luna-shopper/platform,luna-shopper/test-fixtures

# 5. The umbrella targets still resolve under the new name
npx nx run luna-shopper-backend:db:snapshot -- --label rename-check

# 6. Runtime env resolution, the part the compiler cannot check.
#    Bring up compose, then boot each service and confirm it reads its .env.
docker compose -f k8s/e2e/luna-shopper-backend/compose.yml up -d
npx nx serve luna-shopper-auth      # then core / catalog / gateway / realtime

# 7. The chart still renders
helm lint k8s/helm --set lunaShopperBackend.enabled=true
helm template k8s/helm --set lunaShopperBackend.enabled=true > /dev/null

# 8. End to end
npx nx e2e luna-shopper-backend-e2e
```

## 8. Follow ups

- Once this lands, `apps/luna-shopper/` and the project name `luna-shopper` are
  free. A frontend should claim `luna-shopper-frontend` (or, if it becomes a
  module federation remote, the remote name `lunaShopper`, following the existing
  `landing` / `odontogram` / `damoclesSword` convention) rather than the bare
  name, so the pair reads symmetrically.
- `libs/luna-shopper/contracts` is the seam the frontend will import from. Keep it
  free of NestJS and Node only dependencies so a browser build can consume it.
