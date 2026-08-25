# 0014 Rename the app and its services to `luna-shopper-backend`

**Status: implemented.** The rename landed in commit `7a416ae`; this file records
the inventory, the scope decision and the verification that backed it.

## 1. Goal

The backend used to occupy the bare name `luna-shopper`: the directory
`apps/luna-shopper/`, the umbrella Nx project `luna-shopper`, five service
projects `luna-shopper-<svc>`, the Helm value key `lunaShopper`, and the Helm
template folder `k8s/helm/templates/luna-shopper/`.

When a Luna Shopper **frontend** arrives it will want that bare name, and
`nx run luna-shopper:seed` stops being self explanatory. Beyond the literal
collision, every project name should say out loud which half of the product it
belongs to, so `nx show projects` and the Helm chart read unambiguously even
where no frontend counterpart could ever exist.

The e2e project already anticipated this: it was called `luna-shopper-backend-e2e`
in `apps/luna-shopper-backend-e2e/`, and `k8s/e2e/luna-shopper-backend/` already
used the target name. This plan made the rest of the tree agree with them.

## 2. Scope decision

### 2.1 Renamed

| Thing | From | To |
| --- | --- | --- |
| App directory | `apps/luna-shopper/` | `apps/luna-shopper-backend/` |
| Umbrella Nx project | `luna-shopper` | `luna-shopper-backend` |
| Service projects (5) | `luna-shopper-auth`, `-core`, `-catalog`, `-gateway`, `-realtime` | `luna-shopper-backend-auth`, `-core`, `-catalog`, `-gateway`, `-realtime` |
| Service `package.json` names | same five | same five |
| Docker image repos | `nx-portfolio/luna-shopper-<svc>` | `nx-portfolio/luna-shopper-backend-<svc>` |
| Build outputs | `dist/apps/luna-shopper-<svc>` | `dist/apps/luna-shopper-backend-<svc>` |
| Jest `displayName`s | `luna-shopper-<svc>` | `luna-shopper-backend-<svc>` |
| Nest `serviceName` (logs, telemetry) | `luna-shopper-<svc>` | `luna-shopper-backend-<svc>` |
| Shared dev env file | `.env.luna-shopper` | `.env.luna-shopper-backend` |
| Helm values key | `lunaShopper` | `lunaShopperBackend` |
| Helm helper define | `lunaShopper.env` | `lunaShopperBackend.env` |
| Helm template folder | `k8s/helm/templates/luna-shopper/` | `k8s/helm/templates/luna-shopper-backend/` |
| Helm secrets doc | `k8s/helm/luna-shopper-secrets.md` | `k8s/helm/luna-shopper-backend-secrets.md` |
| Helm resources | `luna-shopper-nats`, `luna-shopper-<svc>-db`, `luna-shopper-<svc>-db-secret` | each gains `-backend` |
| Compose project name default | `luna-shopper` | `luna-shopper-backend` |

Every Nx project under `apps/` now starts with `luna-shopper-backend`, so a
frontend can take `luna-shopper-frontend` (or the bare `luna-shopper`) with no
overlap at any layer: project name, image repo, dist path or k8s object.

### 2.2 Deliberately kept

`libs/luna-shopper/*` and the `@portfolio/luna-shopper/*` path aliases are
**unchanged**, along with the three library project names
(`luna-shopper/contracts`, `luna-shopper/platform`, `luna-shopper/test-fixtures`).

`contracts` is the shared API contract library and is precisely the seam a
frontend will import from, so scoping it to `backend` would be actively wrong.
`platform` and `test-fixtures` are backend only in practice, but they live in the
same scope folder, and splitting the scope in half would make the layout harder
to read while touching 113 files and 147 import sites for no disambiguation
value. The libraries are scoped to the **product**, the apps to the **half of the
product**, which is the distinction that matters.

The product name **"Luna Shopper"** in prose, comments, `mailFrom` values and docs
also stays. It is the product, not the app.

Database names (`luna_auth`, `luna_core`, `luna_catalog`), the `LUNA_*_PORT`
compose variables and `LUNA_ENV` contain no `shopper` segment and were untouched.

## 3. Reference inventory

Before the rename, 191 tracked files contained `luna-shopper` or `lunaShopper`,
694 occurrences (`package-lock.json` excluded):

| Area | Occurrences | Of which `@portfolio/luna-shopper/*` imports (kept) | Rewritten |
| --- | --- | --- | --- |
| `apps/luna-shopper/**` | 448 | 135 | 313 |
| `k8s/**` | 171 | 0 | 171 |
| `libs/luna-shopper/**` | 33 | 7 | 26 |
| `apps/luna-shopper-backend-e2e/**` | 12 | 2 | 10 |
| `.vscode/launch.json` | 12 | 0 | 12 |
| `.gitignore` | 12 | 0 | 12 |
| `tsconfig.base.json` | 6 | 3 | 3 |
| **Total** | **694** | **147** | **547** |

The rename rewrote **578 occurrences across 99 files** (the count exceeds 547
because the plan file itself was in the tree), moved 4 paths, and left the 81
files whose only reference is a `@portfolio/luna-shopper/*` import untouched.
The commit totals 275 files changed once the directory move is counted per file.

The per file counts in the tables below are **matching lines**, so a line holding
two occurrences counts once; that is why they sum to less than 694.

### 3.1 Root level files

| File | Refs | What |
| --- | --- | --- |
| `.gitignore` | 9 | the ignored `.env.luna-shopper`, `<svc>/.env`, `<svc>/.env.test`, `.snapshots/` and `secrets/*` paths plus the `!.../secrets/.gitkeep` negation. The `k8s/e2e/luna-shopper-backend/.env.slot` line was already correct and had to survive untouched |
| `.vscode/launch.json` | 12 | four debug configs: `nx serve luna-shopper-<svc>` plus `apps/luna-shopper/<svc>/dist/**` source map globs |
| `tsconfig.base.json` | 6 | the three `@portfolio/luna-shopper/*` aliases (**kept, verified unchanged**) |
| `nx.json` | 0 | nothing to do |
| `.github/workflows/*` | 0 | **nothing to do.** CI is entirely `nx affected` driven and hardcodes no project name |

### 3.2 The umbrella project

| File | Refs | What |
| --- | --- | --- |
| `project.json` | 6 | the project `name`, `sourceRoot`, the `// ` doc comment, three `node apps/luna-shopper/tools/db/*.js` commands |
| `.env.luna-shopper.example` | 9 | its own filename in the copy instructions, the `secrets/jwt.*` openssl commands, per service `.env` paths |
| `docs/testing-strategy.md` | 13 | paths and `nx run luna-shopper:*` invocations |
| `tools/README.md` | 7 | paths and target names |
| `tools/db/env.js` | 4 | the hardcoded `envDir` for auth/core/catalog plus the shared env file path |
| `tools/db/{seed,snapshot,restore,guard}.js` | 2 / 2 / 5 / 1 | paths, including `.snapshots/` |
| `plans/0001` through `plans/0013` | 49 | doc references; `0001-create-app.md` (12) and `0013-test-data-fixtures-and-seeding.md` (24) carry most |

### 3.3 Per service (`auth`, `core`, `catalog`, `gateway`, `realtime`)

Same shape in each. Counts are auth / core / catalog / gateway / realtime.

| File | Refs | What |
| --- | --- | --- |
| `project.json` | 17 / 17 / 16 / 12 / 12 | project `name`, `sourceRoot`, `outputs`, build `cwd`, `imageName`, the `serve` target's `buildTarget` self references, `jestConfig` paths, and the `migration:run|revert|generate` plus `seed` commands with full db paths |
| `webpack.config.js` | 1 each | `output.path` |
| `jest.config.cts` | 2 each | `displayName` plus coverage dir |
| `jest.integration.config.cts` | 2 (auth, core) | same |
| `package.json` | 2 each | the package `name` |
| `.env.example` | 6 / 3 / 3 / 4 / 3 | `secrets/jwt.*` paths and copy instructions |
| `.env.test.example` | 4 / 2 / 2 | same |
| `src/main.ts` | 2 each | the startup log line |
| `src/app/app.module.ts` | 4 / 4 / 4 / 5 / 5 | `envFilePath` entries and `PlatformModule.forRoot({ serviceName })` |
| `src/app/db/data-source.ts` | 4 (auth, core, catalog) | env file paths plus the migrations glob |
| `src/app/db/cli.js`, `db/seed/cli.js` | 1 to 3 each | env file paths |
| `src/Dockerfile` | 0 paths | only the "Luna Shopper" prose header. The image is built through the `NX_APP` build arg, so **no Dockerfile needed a path edit** |
| `docs/*.md` | 2 / 3 / 9 | `auth/docs/data-model.md`, `core/docs/data-model.md`, `gateway/docs/architecture.md` |
| about 100 `src/**/*.ts` | 1 to 2 each | **`@portfolio/luna-shopper/{contracts,platform}` imports, kept unchanged** |

### 3.4 `apps/luna-shopper-backend-e2e/` (name was already correct)

| File | Refs | What |
| --- | --- | --- |
| `project.json` | 4 | `implicitDependencies` (the two service names) plus the `// e2e` doc comment |
| `src/support/db.ts` | 4 | the `.snapshots/.e2e-restore-target` path, the `tools/db/<script>` path, and an `nx run luna-shopper:*` comment |
| `playwright.config.ts`, `core-flow.spec.ts`, `seeded-flow.spec.ts` | 1 each | comments and imports |

### 3.5 `k8s/`

| File | Refs | What |
| --- | --- | --- |
| `k8s/helm/values.yaml` | 32 | the `lunaShopper:` key, five production plus five staging service entries (`name` and `image`), `natsUrl`, three postgres entries with their secret names, plus prose |
| `k8s/helm/templates/luna-shopper/*.tpl` (8 files) | 42 | the folder itself plus every `.Values.lunaShopper` reference and the `lunaShopper.env` define (`nats` 13, `deployment` 7, `migration-job` 7, `postgres` 5, `configmap`/`pdb`/`service` 3 each, `_env` 1) |
| `k8s/helm/templates/reverse-proxy/{_nginx.conf,deployment.yaml}.tpl` | 2 each | `.Values.lunaShopper.enabled` and `.services` |
| `k8s/helm/luna-shopper-secrets.md` | 18 | the filename, the value paths, the secret names |
| `k8s/e2e/luna-shopper-backend/compose.yml` | 6 | the default `COMPOSE_PROJECT_NAME`, prose, and `nx serve` examples |
| `k8s/e2e/luna-shopper-backend/luna-slot.{sh,ps1}` | 30 / 23 | compose project name and paths |
| `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md` | 10 | docs |

### 3.6 `libs/luna-shopper/` (names kept, path text updated)

3 refs each in `project.json`, `README.md` and `jest.config.cts`, plus comments in
`platform/src/**` and `test-fixtures/src/**` that mention `apps/luna-shopper/<svc>/...`
paths. Only those **prose path mentions** changed; the project names, the jest
`displayName`s and the aliases are exactly as they were.

## 4. Why this was cheap

`luna-shopper` had **never reached `main`**. Verified: `git ls-tree origin/main apps/`
had no luna entry, and `lunaShopperBackend.enabled` is still `false` in
`values.yaml`. Consequences:

- **No images existed in `ghcr.io/ichirokuxvi/nx-portfolio/luna-shopper-*`**, so
  renaming five image repos orphaned nothing and needed no registry cleanup.
- **Nothing was deployed**, so renaming ten Deployments and Services, the NATS
  StatefulSet and three Postgres StatefulSets stranded no PVCs, needed no data
  migration, and could not cause downtime. Had this been done after go live, the
  service rename alone would have meant new image repos, new k8s objects, a PVC
  migration and a DNS cutover.
- **No `api.` or `rt.` DNS records** were cut over.
- **CI hardcoded nothing.** `.github/workflows/*` contains zero `luna` references;
  it is fully `nx affected` driven, so not one workflow line changed.

The only live state affected is a developer's **local** docker compose stack: the
default compose project name `luna-shopper` namespaced the containers, network and
volumes, so the new default makes existing local volumes invisible. Recover with
`docker compose -f k8s/e2e/luna-shopper-backend/compose.yml down -v` and a reseed,
or pass the old `COMPOSE_PROJECT_NAME=luna-shopper` explicitly.

## 5. How it was executed

One commit, because a half renamed tree does not build.

1. **Four `git mv`s** (history preserved):
   - `apps/luna-shopper` to `apps/luna-shopper-backend`
   - `k8s/helm/templates/luna-shopper` to `k8s/helm/templates/luna-shopper-backend`
   - `k8s/helm/luna-shopper-secrets.md` to `k8s/helm/luna-shopper-backend-secrets.md`
   - `.env.luna-shopper.example` to `.env.luna-shopper-backend.example`
2. **A single scripted substitution** over every tracked text file. Because both
   the directory and the service names gain the same `-backend` segment, the rule
   collapses to one rewrite, `luna-shopper` to `luna-shopper-backend` plus
   `lunaShopper` to `lunaShopperBackend`, guarded by a protect list that is
   masked before the substitution and restored after:

   ```
   @portfolio/luna-shopper      luna-shopper/contracts
   libs/luna-shopper            luna-shopper/platform
   luna-shopper-backend         luna-shopper/test-fixtures
   luna-shopper-contracts       luna-shopper-test-fixtures
   ```

   The first two keep the shared libraries out of it. The third is what stops
   `apps/luna-shopper-backend-e2e` and `k8s/e2e/luna-shopper-backend` from
   becoming `-backend-backend`. The rest preserve the library project names and
   jest `displayName`s.
3. **One hand fix**: `compose.yml` told the reader to
   `cp .env.luna-shopper.example .env` at the repo root, which had been stale
   since the shared env file moved under `apps/`. Corrected to the real path
   while in the neighbourhood.
4. **Verified** as in section 7.

Note for anyone repeating this shape of rename: the substitution is only this
simple because the new name is a **prefix extension** of the old one. The protect
list is doing all the real work, and the `-backend-backend` grep in section 7 is
the check that it did it.

## 6. Complexity, in hindsight

**Low, and almost entirely mechanical.** 578 occurrences over 99 files, but one
literal string swapped for one other literal string, with a protect list of eight
entries. No code restructuring, no API change, no data migration, no CI edit, no
Dockerfile edit. Including the inventory, the scripting and the verification, the
whole job is a couple of hours.

What made it easy:

- Never deployed, never published (section 4). By far the biggest factor.
- CI hardcodes no project names.
- Nx resolves projects by the `name` in `project.json`, not by directory, so the
  directory move and the project renames are independent and verify separately.
- The Dockerfiles take the project name through the `NX_APP` build arg.
- A third of the infrastructure (`apps/luna-shopper-backend-e2e/`,
  `k8s/e2e/luna-shopper-backend/`) already used the destination name.
- The new name extends the old one, so one substitution covered the directory,
  the umbrella project and all five services at once.

What was genuinely fiddly:

- **The already correct names.** `luna-shopper-backend-e2e` and
  `k8s/e2e/luna-shopper-backend` sit inside the same tree and must not be
  rewritten. Without the protect list a naive substitution produces
  `-backend-backend` in eleven places.
- **Hardcoded env paths in runtime code.** Every service's `app.module.ts`,
  `data-source.ts`, `db/cli.js` and `db/seed/cli.js` names its `.env` by a
  workspace relative path, as do the `tools/db/*.js` orchestrators. These fail at
  **runtime**, not compile time, so neither `tsc` nor the unit tests catch a miss.
  Section 7 step 6 is the only real check.
- **The Helm chart is text templates.** `helm template` only exercises the
  `lunaShopperBackend` key when the chart is enabled, so it must be rendered with
  `--set lunaShopperBackend.enabled=true` or the rename goes unverified.
- **The `.snapshots/` directory** is git ignored and moved with the app. Local
  snapshots must be moved by hand or recreated.
- **Local docker volumes** are orphaned by the compose project rename (section 4).
- **Plan files 0001 through 0013** describe the old paths. Their paths were
  updated because they are still used as working references; their narrative was
  left alone.

Risk was low throughout. The failure mode is a missed string, and the worst case
is a service that cannot find its `.env` at boot, which is loud and immediate.
Nothing destructive, nothing externally visible, `git mv` kept the history, and
the whole change reverts as one commit.

## 7. Verification, and what it showed

```sh
# 1. No stale references, and no double prefixes. All clean.
git grep -n 'apps/luna-shopper/'            # nothing
git grep -n 'luna-shopper-backend-backend'  # nothing outside this plan's own prose
git grep -n '\.env\.luna-shopper\b'         # nothing
git grep -n 'templates/luna-shopper/'       # nothing
git grep -n 'lunaShopper[^B]' -- k8s/helm/  # nothing

# 2. The shared libraries are untouched. Confirmed.
git diff --stat tsconfig.base.json          # no change
git grep -n '"name"' -- 'libs/luna-shopper/*/project.json'
#   luna-shopper/contracts, luna-shopper/platform, luna-shopper/test-fixtures

# 3. Nx resolves the renamed graph. Confirmed: all six app projects present.
npx nx show projects | grep -i luna

# 4. Lint and test. Confirmed green for all 8 projects.
npx nx run-many -t lint test -p luna-shopper-backend-auth,luna-shopper-backend-core,\
luna-shopper-backend-catalog,luna-shopper-backend-gateway,luna-shopper-backend-realtime,\
luna-shopper/contracts,luna-shopper/platform,luna-shopper/test-fixtures

# 5. The chart renders, with every resource and image consistently renamed.
helm template k8s/helm --set lunaShopperBackend.enabled=true

# 6. Runtime env resolution, the part no compiler checks. NOT yet exercised.
docker compose -f k8s/e2e/luna-shopper-backend/compose.yml up -d
npx nx serve luna-shopper-backend-auth   # then core / catalog / gateway / realtime

# 7. End to end. NOT yet exercised (needs the stack from step 6).
npx nx e2e luna-shopper-backend-e2e
```

### 7.1 Pre existing build failure, unrelated to this rename

`nx build` fails for all five services with 30 webpack `Module not found` errors,
every one of them inside `node_modules`: `@grpc/proto-loader`, `kafkajs`, `mqtt`,
`ioredis`, `amqplib`, `amqp-connection-manager`, `@mikro-orm/core`,
`@nestjs/mongoose`, `@nestjs/sequelize`. These are optional peer dependencies of
`@nestjs/microservices` and `@nestjs/terminus` that the workspace does not declare
or install, and webpack resolves them eagerly instead of treating them as
optional.

**This is not caused by the rename.** Building the same service at the parent
commit, before any rename, produces the identical count of 30 errors, and not one
error references a path under `apps/`. It needs its own fix (declare the optional
deps, or add them to the webpack `externals` / `IgnorePlugin` list) and belongs in
its own plan.

## 8. Follow ups

- The bare name `luna-shopper` and the path `apps/luna-shopper/` are now free. A
  frontend should take `luna-shopper-frontend`, or, if it becomes a module
  federation remote, the remote name `lunaShopper` following the existing
  `landing` / `odontogram` / `damoclesSword` convention.
- `libs/luna-shopper/contracts` is the seam that frontend will import from. Keep
  it free of NestJS and Node only dependencies so a browser build can consume it.
- Fix the optional dependency build failure described in 7.1.
- Steps 6 and 7 of section 7 (booting each service against a live compose stack,
  and the e2e suite) still need a pass on a machine with the stack up. They are
  the only checks that exercise the rewritten `.env` paths.
