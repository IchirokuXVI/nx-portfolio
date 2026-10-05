# CLAUDE.md

This file gives guidance to Claude Code (claude.ai/code) for work in this repository.

## Repository overview

This repository is an Nx monorepo. It holds four things:

- A personal portfolio, built as an Angular **module-federation** micro-frontend system.
- A NestJS backend for velista (Luna Shopper).
- A custom Nx toolchain that builds and deploys Docker images.
- The Kubernetes and Helm deployment configuration.

The main parts:

- `shell` is the host application. It owns the router and mounts the remotes at runtime.
- `odontogram`, `damoclesSword`, `landingV2` and `velista` are remote micro-frontend apps. Each one exposes its routes through `./Routes` (module federation).
- `apps/luna-shopper-backend/*` is the backend of velista. It has seven NestJS services (`gateway`, `realtime`, `auth`, `core`, `catalog`, `harvester`, `assistant`) over NATS. It uses four Postgres instances and Redis. See "Luna Shopper backend" below.
- `apps/docker/*` holds Nx "app" projects that are not Angular (builder, local-http-server). Each one only wraps a Dockerfile. Each has the tag `type:static-docker` or `type:dynamic-docker`, and CI drives it (see "Docker & CI/CD").
- `tools/docker` is a custom Nx plugin (`@portfolio/docker`). It provides the `build` and `push` executors that the `build:docker` target of each app uses. It also provides an `application` generator that adds a Dockerfile to a new app.
- `libs/<scope>/*` holds the Nx libraries, one group for each scope. The scopes are `damoclesSword`, `odontogram`, `landing-v2`, `velista`, `luna-shopper`, `luna-shopper-admin` and `shared`. The library names follow the `data-access` / `feature-*` / `ui` / `models` convention.
- `k8s/helm` is the Helm chart that CI deploys to a k3s cluster. Routing uses the Gateway API (one `Gateway` and one `HTTPRoute` for each app). Envoy Gateway provisions the data plane in its own namespace. The chart does not declare it.
- `k8s/bootstrap` installs, one time for each cluster, the Gateway API CRDs, Envoy Gateway, cert-manager and a ClusterIssuer (`install.sh` / `install.ps1`). It is outside the chart on purpose. Thus the chart names the implementation only through `gateway.className`.

## Common commands

Run all tasks through Nx (`npx nx ...`). The top-level `package.json` has no scripts.

```sh
# Serve the shell. `devRemotes` is empty, so every remote is served from its
# last build rather than watched; serve a remote itself to get watch on it.
npx nx serve shell

# Serve a single remote in watch mode. damoclesSword, landingV2 and velista
# carry `dependsOn: ['shell:serve']`, so each boots the shell too. odontogram
# does not, so start `nx serve shell` beside it.
npx nx serve damoclesSword
npx nx serve odontogram
npx nx serve landingV2

# Production build (all apps default to the `production` build configuration)
npx nx build shell
npx nx build damoclesSword --configuration=development

# Lint / test a single project
npx nx lint <project>
npx nx test <project>
npx nx test <project> -t "<test name pattern>"      # single test, jest -t
npx nx test <project> --testFile=<path>              # single spec file

# Test / lint / build every project in the workspace
npx nx run-many --all --target=test
npx nx run-many --all --target=lint
npx nx run-many --all --target=build

# e2e (shell/odontogram/damoclesSword/landingV2/velista-e2e use Cypress or Playwright per project)
npx nx e2e <project>-e2e

# Run a target across every affected project (mirrors CI)
npx nx affected -t lint test build

# Explore the project/dependency graph
npx nx graph
npx nx show project <project> --web

# Docker build for an app (uses the custom @portfolio/docker:build executor)
npx nx run <project>:build:docker --configuration=production
```

Target one project, the whole workspace (`run-many --all`), or only the changed projects (`affected`). CI uses `affected`.

### Serving from a worktree: dev slots

Each app has a fixed port. Two checkouts that both run `nx serve` thus collide. A **slot** is an integer N that moves a whole stack to other ports.

**Slot 0 belongs to the developer.** It uses exactly the ports that `project.json` and the compose file name, and nothing moves it. `--auto` never takes slot 0, and workers start at slot 1.

Each other slot gets a block of 100 ports in a high band, clear of the other software on the machine:

- The front end starts at `42000 + (N-1)*100`. Slot 1 has the shell on 42000 and velista on 42005.
- The backend starts at `43000 + (N-1)*100`. Slot 1 has the gateway on 43000 and auth-db on 43010.

The band is above the crowded range below 10000. It is below the Windows ephemeral range (49152 and up) and each Hyper-V reservation (50000 and up). Do not use `default + N*100`. That formula put slots on 4300 and 5532, and there they collided with other software.

**The front end slot number and the backend slot number are independent.** Front end slot 5 can talk to backend slot 1, 2 or 8. Many front end slots can share one backend at the same time. That is the usual arrangement while nobody changes the backend. Thus `luna-slot` allows the origin of each front end slot in `CORS_ORIGINS`, not only one. `ng-slot` finds its backend in this order: the recorded choice, the luna slot of this worktree, the only gateway that listens, slot 0. It does not assume its own number. `--backend-slot <n>` and `--app-slot <n>` state the choice explicitly.

```sh
# which slots are taken (reads every worktree's claim, then probes the ports)
tools/dev/ng-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list

# claim the lowest free slot and serve; --up writes the env files first if absent
tools/dev/ng-slot.sh --up                       # all six Angular apps
tools/dev/ng-slot.sh --up --apps shell,velista  # ...or just some
tools/dev/ng-slot.sh --up 5 --backend-slot 1    # ...pointed at a named backend
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up   # compose + migrations + seven services

# bounce processes without losing the slot (or, for luna, the databases)
tools/dev/ng-slot.sh --restart --apps velista
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --restart --services gateway

# give the slot back when you are finished with it
tools/dev/ng-slot.sh --down
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down

# ...or stop everything and keep the number
tools/dev/ng-slot.sh --down --keep-slot
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down --keep-slot

# keep this slot's databases, which also locks the slot against --auto
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down --keep-data
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --unlock 3   # ...and release it later
```

**Check first, then claim, and start instances only through these scripts.** `--list` reads the claim of each worktree and probes the ports. It is the one accurate answer to the question of what runs now. Run it before you take a slot. Let `--up` with no number take the lowest free slot. A manual `nx serve` or `docker compose up` writes no claim and no `.env` for the slot. It thus collides with slot 0, which belongs to the developer.

**A slot is cheap to ask for and expensive to run.** Take the least that does the job.

- One Angular dev server uses 700 MB to 1 GB of RAM. A full front end slot (the shell, four remotes and the admin app) uses 4 GB to 6 GB.
- A Luna slot runs seven Nest services at about 230 MB each. It also runs seven containers on the default compose profile (four Postgres, NATS, Redis, Mailpit) with its own Postgres volumes. The `test` and `observability` profiles add more containers.
- A few slots that are not shared thus exhaust a 32 GB machine. Luna is the half that grows fastest.

Follow these rules:

- Serve only the apps that you change (`--apps shell,velista`).
- Point at a backend that already listens. Do not start one without a reason. Start your own Luna slot only to change backend code, to run disruptive migrations, or to get an isolated database.
- Run `--down` after you finish, also on an abandoned task.

**To edit code, you need none of those steps.** All apps and services run with watch on. Each one watches its own sources _and_ the libraries it consumes. A change thus recompiles and reloads by itself, and only the app you edited rebuilds.

A running process cannot pick up a rewritten `.env` (a slot move, `--backend-slot`, `--app-slot`). Nx loads `{projectRoot}/.env` at the start of the task, and webpack reads the values one time. The rewrite _does_ start a rebuild, but the rebuild silently keeps the old values. Nothing looks wrong. Use `--restart` for that case. Use `--down` to finish with a slot, not to check your work.

**A slot is borrowed, and `--down` gives it back.** `--down` stops the processes. It removes the derived keys of this slot from the `.env` files it owns, and it deletes the claim. A later `--up` can thus give you a **different** number. Pass `--keep-slot` after someone told you to use a specific slot, or for any other reason that the number must survive. `--restart` restarts the processes and does not release the slot.

On `luna-slot.sh`, `--down --keep-data` keeps the databases of this slot and **locks** the slot. `--auto` then does not give them to another worktree. To take the slot back, name the number. To clear the lock, use `--unlock <n>`. `ng-slot.sh` has no `--keep-data`, because the front end has no data.

**A second run never overwrites your edits.** The scripts rewrite only the keys that the slot decides. `DERIVED_KEYS` in each script names them. These edits thus survive a second run and a slot move:

- A pasted `GEMINI_API_KEY`.
- A `HARVEST_ENABLED` that you set for a crawl.
- A base URL that points at a local recording.

A key that is blank on purpose stays blank. `--reset-env` puts the other keys back to the shipped defaults. `--reset-env --keep-env A,B` spares the named keys. Add a new key that depends on the slot to `DERIVED_KEYS`. Without that, the script preserves a stale value. The script prints a warning for a preserved value that names a port of another slot.

**One checkout runs one slot, unless the slot is `--ephemeral`.** All of the above is per worktree: eight `.env` files and one claim. To point this checkout at another slot thus rewrites them.

`bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 3` runs a slot and does not configure the checkout for it:

- It writes nothing under the worktree and makes no claim. The script gives the values of the slot to the processes through their environment. There they outrank a `.env`, because Nx and `@nestjs/config` both leave a set variable alone.
- A developer on slot 0 thus continues to serve it while a tool drives slot 3 in the same checkout.
- The slot number is required on `--up`, `--down` and `--restart`, because nothing records it. Slot 0 is refused.
- The rendered files, logs and pids are in `$TMPDIR/luna-slot-ephemeral/slot<n>`. `--down` removes that directory.
- An ephemeral `--up` refuses a slot that a worktree claims, that a lock keeps, or that another ephemeral run holds.
- It holds its own number with a record in the main `.git` directory. The record exists from before the first process starts until `--ephemeral --down` removes it.
- `--list` prints that record as `ephemeral (pid N)`, and `--auto` skips it.
- A record is stale after its pid is gone and all its ports are closed. The next `--ephemeral --up` of that number takes it over (`tools/dev/plans/0004`).

`libs/luna-shopper/tools/curation/cli` takes its rehearsal slot this way.

The slot scripts are Bash only. Git Bash is the supported shell on Windows. Git ignores all files that the scripts write, and they are per worktree. **Do not add a port override to a `project.json` to work around a collision.** Use a slot. `tools/dev/README.md` explains why the remote ports cannot come from the project graph. `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md` covers the backend half.

## Architecture

### Module federation topology

`shell` is the only app whose `serve-static` / `serve` acts as host. Its `module-federation.config.ts` declares `remotes: ['odontogram', 'damoclesSword', 'landingV2', 'velista']`. The `module-federation.config.ts` of each remote exposes `./Routes` from `src/app/remote-entry/entry.routes.ts`. Path aliases such as `damoclesSword/Routes` are in `tsconfig.base.json`. With them, the shell lazy-loads the routes of a remote like a local module:

```ts
loadChildren: () => import('damoclesSword/Routes').then((m) => m.remoteRoutes);
```

**Remotes render only through the shell. A remote on its own port shows a blank page.** The `bootstrap.ts` of each remote bootstraps its `RemoteEntry` / `RemoteEntryComponent` as the root. That component has an **empty template with no `<router-outlet>`** (`apps/<remote>/src/app/remote-entry/entry.ts`). The router still matches routes, but no outlet exists to render them. A direct request to `http://localhost:4203`, for example, thus returns about 200 bytes of empty host element.

This is intentional. It stops users and tests from reaching a remote through its own port. There the global styles of the shell are absent, and the page renders differently from production. The shell supplies the outlet, the locale and the theme context as it lazy-loads the remote. **Always develop and test remotes through the shell.** `npx nx serve <remote>` starts the shell through `dependsOn` for each remote except `odontogram`. Use the shell URL, such as `/<remote>/<locale>`, and not the port of the remote. The e2e projects thus point at the shell and not at the port of a remote.

**velista is the exception, and the only one.** It is a standalone app that is _also_ exposed as a remote (`apps/velista/plans/0013-own-origin-and-the-installable-app.md`). It is served from its own origin, and it is installable there as a PWA. `http://localhost:4205` renders the real app and not a blank page. `AppRoot` (`apps/velista/src/app/app-root.ts`) has a `<router-outlet>`, and no `RemoteEntry` exists. The blank page rule exists because a remote on its own port lacks the global styles of the shell. velista draws its own chrome and owns its own token scope inside `AppLayout`. It thus borrows nothing from the shell, and its own port is not a degraded view. The rule holds for the other three remotes.

Both modes of velista come from **one** route factory, `appRootRoute(mount)` (`apps/velista/src/app/app-root-route.ts`). `remote-entry/entry.routes.ts` calls it with `'/velista'`, and `app.routes.ts` calls it with `''`. Put each difference between the mounted mode and the standalone mode in that factory as an argument. Never write it as a literal in both files. `app-root-route.spec.ts` asserts that the mount reaches both `data.mountPath` and `APP_BASE_PATH`.

The service worker is the other half of that split. `provideServiceWorker` is in `app.config.ts` only, never in `appProviders`. `appProviders` is spread into both modes. A registration there makes the page of the portfolio register the worker of velista on the origin of the portfolio.

### App-owned locale routing

**`/{mount}/{locale}/{rest}`, for each app, in both run modes.** Examples: `/damoclesSword/en/about`, `/odontogram/es`, `/velista/en/home`. `landingV2` mounts at the empty path. Its mount thus contributes no segment, and the rule becomes `/{locale}/{rest}`. That is the same rule, not an exception. In a standalone build the mount is also empty. That makes it cheap to extract an app: its route table is always "locale, then my routes", relative to its mount.

The shell owns no `:locale` route and no translator. Each app installs `localeGuard` (from `rokutranslator-angular`) on its own parent route. The guard reads its configuration from route `data` (`appKey`, `supportedLocales`, `defaultLocale`) and from the mount. The `entry.routes.ts` of the app states the mount as `data.mountPath`.

The guard establishes one invariant before the routes below it render: **the segment immediately after the mount is a supported, canonical locale.** It never declines a URL and never routes to a not-found page. The 404 page of an app is localized, and thus no page can be drawn before the language is known. `resolveLocaleSegments` holds its four cases, is pure, and carries the tests. The cases are: adopt the locale, rewrite `en-US` to `en`, replace an unsupported locale, insert a missing one.

Know these three consequences before you edit a route table:

- **The parent route of an app needs a child that always matches** (a last `**` child). A parent with `children` matches only after one of them matches the remainder. With `:locale` as the only child, a URL with no locale thus fails to match the branch. The guard that inserts the locale then never runs.
- **Do not use `@angular/core/rxjs-interop` in code that is created per app.** It is a secondary entry point that module federation does not dedupe. Each remote bundles its own copy, with its own copy of the internal module state of core. `toSignal` and `takeUntilDestroyed` call `assertInInjectionContext`, which reads that state. The assertion thus runs against the remote that loaded `rxjs-interop` first, while the core of the shell set the injector. The result is a hard `NG0203` with a correct DI graph. `RokuLocaleStore` writes its signal by hand for exactly this reason. Components are fine in practice, because they resolve within their own app. A service that many remotes provide is not.
- **The mount must reach the guard through route `data`, not DI.** A guard resolves against the closest environment injector at the preactivation phase. The `providers` injector of a route is not reliably one of them. `inject(APP_MOUNT_PATH)` there thus returns the default of the token. The _locale switcher_ reads the token, and a component injector has no such problem.

In the `app.routes.ts` of the shell, **each mounted app comes before the empty-path `landingV2` entry**. An empty-path route with `loadChildren` is not terminal, and it swallows the siblings below it. `app.routes.spec.ts` asserts the order.

### Sheets are addressed under a `sheet` segment (velista)

**`<the URL of the covered page>/sheet/<the subject of the sheet>`.** A sheet in velista is a child route by rule E1. It thus has a URL, and this is the shape of that URL: `…/lists/:listId/sheet/lines/:lineId/edit`, `…/zones/:zoneId/sheet/lists/new`, `…/account/sheet/name`.

The marker sits **immediately after the covered page** and in no other position. That position is the rule, not a detail of it. The URL of a page is unique. A marker directly after it thus gives each page a sheet namespace that no other page can reach. Do not move the marker to the right, after the resource that the sheet addresses. That moves two colliding URLs by the same amount, and they still collide.

The reason is that pages and sheets shared one namespace before. The line sheets of the list page sit below `lines/:lineId`, which is also the URL of the **line page**. `lines/:lineId/confirm/delete` was thus declared over both screens, and it resolved to the route that was declared first. A delete from a row on the list drew its dialog over the line page and not over the list. Its siblings worked only because the line page had no children with those names.

Two rules follow from it:

- **Never write the segment by hand.** `sheet()` in `libs/velista/feature-shell/src/lib/routes.ts` adds it, together with `sheetFallGuard`. The table thus declares the subject of a sheet, and it cannot declare a sheet that opts out. Callers that open a sheet use `sheetSegments()` from `@portfolio/velista/platform`. `SHEET_SEGMENT` is there too, for the rare absolute URL.
- **No page can take a `sheet` segment.** A sheet over such a page collides with a sheet over its parent again. `routes.spec.ts` asserts both directions. Each route that carries the fall guard is addressed under the marker, and no other route is. No page path contains the marker.

### Going back never leaves the app (velista)

**A back control pops the history. Each one also names a fallback URL that it uses instead of an unsafe pop.** `PageNavigation.back(fallbackUrl)` is for the top left chevron of a page. `SheetNavigation.dismiss(fallbackUrl)` is for the cancel control of a sheet, its scrim and Escape. Both arguments are required, and no other code in velista can call `Location.back()`. `no-unguarded-history-back.spec.ts` scans the whole scope and the app for a `.back()` with no arguments. It names each file that has one.

A pop is only safe onto an entry that **this document pushed**. Below the entry that a tab loaded on sits the site that sent the link. A raw pop from a shared link or a reload thus leaves velista entirely, from a chevron that promises one screen up. `AppHistory` (`libs/velista/platform`) answers that question. `app-providers.ts` starts it with `watch()` in an environment initializer. Nothing injects it before a back button is pressed, and by then each navigation it needed to see is in the past.

- **The history state cannot answer the question.** `navigationId > 1` looks like the answer and is wrong. A navigation that _replaces_ increases that id and adds no entry. A cold arrival makes exactly such navigations. A guard redirect inherits `replaceUrl` from the initial navigation. The locale guard that corrects `/zones/z1` thus produces id 2 on the first and only entry. A sheet that is opened from a link and submitted through `leaveTo` does the same. Both read as history, and both pop off the site.
- **To count too few entries is the safe error.** `AppHistory` treats an entry that this app cannot account for as no entry. The cost is a back button that walks to its fallback and does not pop. To count too many sends a person out of the app. Each unknown case thus answers no: an `AppHistory` that is not started, a navigation whose start it did not see, a popstate onto an entry it did not write.

### Localization: RokuTranslator

`libs/shared/localization/rokutranslator` is a hand-made i18next wrapper (the `RokuTranslator` **class**). It is not a generic i18n library from npm. **Each app has one instance, not each page.** `provideRokuTranslator` creates the instance, binds it to the `ROKU_TRANSLATOR` token and provides the `RokuLocaleStore` beside it. Two apps that are reachable in one session thus hold independent locales. To resolve either from an injector with no `provideRokuTranslator` above it is an error, by design. Key points:

- Namespaces are registered for each locale through lazy `LoaderFunction`s (`addNamespace` / `addTranslations`). Each library can thus contribute its own translation JSON (see `libs/damoclesSword/ui/assets/i18n/*.json`). The app does not need to know the location of the assets.
- A library that ships assets exports a `TranslationSource` descriptor next to them. The **app** (`apps/<app>/src/app/translation-providers.ts`) lists the descriptors and calls `composeTranslationLoader`. Composition belongs to the app. The app is also the only place that `app-providers.ts` can import from with no relative path across a library boundary.
- `libs/shared/localization/rokutranslator-angular` wraps it for Angular (service, pipe, `provideRokuTranslator`).
- In the module federation configuration, `@portfolio/localization/rokutranslator` is forced to `singleton: true` across the shell and all remotes. **This removes duplicate code. It is not a correctness rule.** The module exports a stateless class. To share it thus means one copy of i18next, not one locale.
- The rule is in **one** file, `module-federation.shared.ts` at the workspace root, and all five configuration files import it. A `shared` callback governs only its own build. A declaration in the host alone thus does nothing for the remotes.
- Do not add `strictVersion`. Staging deploys only the affected remotes, and a version bump thus leaves a mixed fleet. Strict enforcement turns that ordinary window into a blank page.
- Read that file before you edit the list. A name that matches no import is silently never applied. `rokutranslator-angular` cannot be added the same way, because Nx passes it under its project name, which nothing imports.

### Library layout

Under `libs/<scope>/`, the scopes are `shared`, `damoclesSword`, `odontogram`, `landing-v2`, `velista`, `luna-shopper` and `luna-shopper-admin`. Within a scope, the libraries follow the Nx convention:

- `data-access`: API and services.
- `feature-*`: routed feature libraries and remote entry points.
- `ui`: presentational components and static assets.
- `models` / `models-localization`: types, and translation keys for each domain.

Import through the `@portfolio/<scope>/<lib>` TS path aliases in `tsconfig.base.json`. Do not use relative paths across library boundaries.

`@nx/enforce-module-boundaries` has a permissive configuration (`onlyDependOnLibsWithTags: ['*']`). No hard dependency firewall by tag exists today. Do not rely on lint to catch layer mistakes across scopes.

**Icons are standalone components in `libs/shared/ui`** (`home-icon`, `trash-icon`, `upload-icon`, `arrow-icon`, …). Each one follows the same pattern. An `*-icon.svg` is inlined through `import('./*.svg?raw')` and `DomSanitizer`, and exposed through `@portfolio/shared/ui`. Before you add an icon, look for an existing one there and reuse it. With no existing icon, add the new icon component to `libs/shared/ui` and export it from the `index.ts` of that library. Never inline raw `<svg>` markup in a feature or ui component.

**Read the directory listing, not only `index.ts`.** `save-icon`, `close-icon` and `edit-icon` exist under `libs/shared/ui/src/lib` but are **not** exported, on purpose. They are internals of `in-place-crud`, which is what the barrel exposes. To reuse one, export it. Do not add a second copy of the same glyph.

### Environments & API access

`libs/shared/environments` exports a plain `environment` object (`BACK_API_DOMAIN`, `BACK_API_PATH`, `BACK_API_PORT`). The standard `fileReplacements` mechanism swaps it at build time (`environment.ts` and `environment.prod.ts`). `libs/shared/data-access` has the shared API URL resolver and the consumer helpers that are built on it.

### Docker & CI/CD

- The `build` executor of `tools/docker` (`tools/docker/src/executors/build/build.ts`) calls `docker buildx build`. **It is project-agnostic.** It knows nothing about micro-frontends or this repository. The only build args that it injects itself are `NX_APP` (the project name) and `TARGET_REGISTRY` (the resolved registry). `push` runs after `build` with `pushToRegistry: true`.
- Its own operational configuration comes from options and from generic `DOCKER_*` environment fallbacks. These are `DOCKER_REGISTRY`, `DOCKER_USERNAME` / `DOCKER_PASSWORD` / `DOCKER_SKIP_LOGIN`, and `DOCKER_IMAGE_TAG` (comma-separated, overrides `versionTags`). The cache options are `cache` / `cacheMode` / `cacheScope`. Their environment names are `DOCKER_BUILD_CACHE` / `_MODE` / `_SCOPE`, and the backends are `local` / `gha` / `registry`.
- Project-specific values reach the Dockerfile as ordinary build args. One source is the `buildArgs` of a target (`BUILDER_TAG` for each configuration, which selects the base image tag). The other is the **`forwardEnv`** option, a list of environment variable names. The executor forwards each one that is set as a build arg. Today each app forwards exactly `BUILDER_TAG`. The executor never refers to those names itself.
- **`MFE_BASE_URL` and `MFE_REMOTE_URLS` are not build args** (k8s plan 0007). The Dockerfile of an app has no build stage. `nx build` runs one time for the whole workspace outside Docker. `build:docker` sets `"context": "dist"`, and the finished bundle is copied in. `webpack.prod.config.ts` thus reads those two from the environment of that `nx build`. Both workflows set them with `docker run -e` on the builder container. To add them to `forwardEnv` does nothing.
- **Two environments run on two separate k3s clusters, one VPS each** (k8s plan 0002). Production has `ichirokuxvi.com`, `mfe.`, `velista.app`, `api.velista.app` and `rt.velista.app`. Staging has the same five names one label down: `staging.ichirokuxvi.com`, `mfe.staging.`, `staging.velista.app`, `api.staging.velista.app`, `rt.staging.velista.app`.
- The chart describes **one** environment. Two things decide which one: the cluster that you point it at, and the values file that you pass beside `values.yaml`. That file is `values.production.yaml` or `values.staging.yaml`. No `env` field, no `-staging` resource name and no `staging.enabled` switch exist. Resource names are identical in both clusters.
- Hosts come from `baseDomain` plus a `hostPrefix` for each entry. The environment file can override the host of an entry by name in `hostOverrides`. That puts velista and its two backend services on the domain of velista. An explicit `host` on an entry wins over both, and the local values files use that. `ichirokuxvi.com/velista` still works: the shell mounts the remote at that path and loads it from the new origin.
- The **shell embeds its micro-frontend base URL at build time**. `apps/shell/webpack.prod.config.ts` reads `MFE_BASE_URL`, and the default is the production host. The shell image is thus environment-specific. Each other app image is environment-agnostic. Remote URLs are static module federation, not runtime. Do not assume that the shell can switch environments at runtime.
- `.github/workflows/docker-ci.yml` (**staging, on push to `main`**) does these steps in order:
  1. It computes the affected projects against the last successful run, then builds and tests them.
  2. It builds the affected micro-frontends with `DOCKER_IMAGE_TAG=staging` and the staging URLs.
  3. It runs **two e2e gates against the images it just pushed**. They are `e2e-frontend` over `k8s/e2e/portfolio-frontend/compose.yml`, and `e2e-luna` over the Luna compose pair.
  4. It deploys over SSH to **`SSH_DEPLOY_HOST_STAGING`**. First comes `provision-release.sh --check --env staging`, which rejects in seconds a deploy that cannot work. Then comes `helm upgrade --install --atomic --timeout 10m` with `values.staging.yaml`. Then comes `kubectl rollout restart` for the changed deployments. A separate `rollout status` loop then observes them.
  5. A failure runs a diagnosis step that prints pods, events and logs.
- `.github/workflows/release.yml` (**production, on GitHub Release published**) builds _all_ micro-frontends at the release commit. It uses `DOCKER_IMAGE_TAG=<version>,latest` and the production URLs. It then deploys to `SSH_DEPLOY_HOST`: the preflight first, then `k8s/helm/deploy-release.sh <version>`. That script passes `--set imageTag=<version>` with `values.production.yaml` and `--wait`. It then observes `rollout status` before it reports success. Production is pinned to immutable version tags. To roll back, run `deploy-release.sh <older-version>` or `helm rollback`. The script does not use `--atomic` on purpose, and it explains the reason.
- **Deploys wait, and the workflow observes the result** (k8s plan 0003). `helm upgrade` with no `--wait` returns as soon as the manifests are accepted. `kubectl rollout restart` is asynchronous. A deploy that does not wait thus reports success while pods crashloop or a rollout hangs at zero available replicas.
- **A release task runs in a window, on data it expects** (k8s plan 0011).
  - A task under `k8s/release-tasks/tasks/` runs by itself one time for each cluster and can delete data.
  - Its `task.env` thus states `RUN_UNTIL_STAGING` and `RUN_UNTIL_PRODUCTION` (a UTC date or `never`) and the one `PRODUCTION_RELEASE` that runs it. Its `check.sh` refuses data that it was not written for.
  - An absent window is a refusal, not a default. A closed window is recorded in the ledger as `expired`, which is final. A task that is already `pre-done` always finishes.
  - Both deploy paths run `run-release-tasks.sh --phase check`, which changes nothing, next to `provision-release.sh --check`. `k8s/release-tasks/check-tasks.mjs` reads each `task.env` on each pull request and before any SSH in both deploy jobs.
  - A window is at most 14 days after the commit that wrote it. A dump is kept for that long.
  - A change that deletes rows that a person or a harvest wrote goes in a release task, not in a migration. The one exception is a schema change that cannot work without it.
  - `k8s/release-tasks/README.md` is the full account.
- **Scripts provision the cluster, not prose.** Three scripts run in order:
  1. `k8s/bootstrap/provision-host.sh` turns a bare VPS into a machine. Run it as root over a root login. It makes the `ichiroku` and `deploy` accounts and their keys, and optionally `--k3s` and `--lock-root`.
  2. `k8s/bootstrap/install.sh` turns the machine into a cluster.
  3. `k8s/bootstrap/provision-release.sh --env <env>` makes the cluster ready for the chart. It makes the namespace and six Secrets. The DB URLs are derived from the same generated passwords, and thus they cannot disagree.
- `--check` renders the chart and asserts that each `secretKeyRef` / `configMapKeyRef` it refers to exists. Staging and production run the same three scripts with different arguments. No host script per environment exists. `k8s/README-new-cluster.md` is the runbook for a new machine, in order. It includes the DNS step and the root lockout step, which must happen at a particular moment.
- **CI deploys as `deploy`, an unprivileged account.** Both workflows rsync the chart into the home of that user and run helm and kubectl there. This works with no sudo, because `install.sh` writes the k3s kubeconfig world readable. Nothing in the deploy path can assume root or a home directory of `/root`.
- A new deployable app needs these things:
  - A `build:docker` target that mirrors the `project.json` of the existing apps. It has development and production configurations, the `imageName` option, `"context": "dist"`, and `forwardEnv: ["BUILDER_TAG"]`.
  - A matching `src/Dockerfile`.
  - One entry in `values.yaml` under `apps` (`name`, `image`, `hostPrefix`, `path`). Add no environment and no second staging entry.
  - For a plain static or dynamic docker wrapper that is not an Angular app, the `type:static-docker` / `type:dynamic-docker` tag. CI needs it to pick the app up correctly.

## Code style

- Prettier is the source of truth (`.prettierrc`): single quotes, 2-space indent, trailing commas (es5) and `arrowParens: always`. It uses three plugins: `prettier-plugin-organize-imports`, `prettier-plugin-organize-attributes` and `prettier-plugin-go-template`. The last one parses `*.yaml.tpl`. The attributes plugin sorts Angular template attributes into groups: outputs, two-way bindings, inputs, structural directives, all other attributes, then `data-*`.
- `*.html` files are linted with `@angular-eslint/template/recommended` and `prettier/prettier`, with the `angular` parser.

## Plan files

- Plan and design documents are in a `plans/` directory next to the app or library they describe. Examples are `apps/landing-v2/plans/` and `libs/shared/localization/rokutranslator/plans/`.
- **Each plan file has the name `NNNN-kebab-title.md`**: a four digit number with leading zeros, then a kebab-case title. The numbers are per `plans/` directory and sequential. They **always start at `0001`** (no `0000`, no files with no number). The next plan in a directory takes the next free number.
- A plan in `plans/` is **part of the build order**: it is in development, or it is next.
- **The plan that you were named is the whole job. Read the others, build none of them.**
  - Read around the task. A plan states the contracts, tokens and rules that adjacent plans already fixed. The surrounding `plans/` directory holds that context. Open all that you need to understand your plan.
  - Code for a plan that nobody asked for is a different act, and that decision is not yours.
  - If plan X needs plan Y or plan Z first, say so and stop. Name the plans and say what each one lacks. Let the user decide to widen the task or not.
  - That is one round trip. The alternative is a pull request three times its expected size. Its reviewer asked for one plan and gets three.
  - Build each part of the named plan that the absent dependency does not block. State plainly the parts that you left out, and the reason.
- A design that is agreed but **not scheduled for development** goes in `plans/backlog/`. That directory is its own number namespace and starts at `0001`. A parked design thus does not use a number in the build sequence. After a backlog plan is picked up, it moves into `plans/` and takes the next free number there. A backlog plan opens with a `> **Status: backlog. Not scheduled for development.**` blockquote. The file thus states its status by itself, not only by its location.
- **An implemented plan names the pull request that implemented it.** The line goes at the top of the file, above the `# NNNN Title` heading. A backlog plan carries its status blockquote in the same position.

  ```markdown
  > **PR:** [#178](https://github.com/IchirokuXVI/nx-portfolio/pull/178)
  ```

  Write it after `gh pr create` returns the URL, and push the amendment onto the same branch. The plan then lands inside the PR that it names. Without it, only a commit message or a release note links a plan to its change. The plan then says nothing about its release or the location of the code.

## Luna Shopper backend

### The harvester is deployed, and three switches control it

`luna-shopper-backend-harvester` (plan 0038) fetches prices from supermarket storefronts and store locations from OpenStreetMap. It writes its results into catalog over NATS. It owns the fourth Postgres, after auth, core and catalog. **Its fourth run mode fetches nothing.** `LEAFLET_IMPORT` (plan 0081) reads a JSON document that an admin uploads. The output is identical to the output of a crawl, and only the fetch differs. That is why it is a run here and not a write in catalog.

**It is deployed in both clusters, and both can start a run.** `values.staging.yaml` and `values.production.yaml` both set `enabled: true` and `harvestEnabled: true`. Neither cluster fetches a storefront. That permission is one row for each chain in the database of the harvester, and each row is off (plan 0083). A catalog discovery run is several thousand HTTP requests over many minutes. Price crawls still run here against the compose stack, because the development machine has room for them. A cluster runs store discovery, which is two requests, and leaflet imports, which are none.

**The actor id is provisioned, not configured.** `provision-release.sh` generates the uuid by which catalog knows the harvester, one time for each cluster. It keeps the uuid in the Secret of the environment. Both `HARVESTER_ACTOR_ID` and the `SERVICE_ACTOR_IDS` of catalog read that one key. It is not a values field, and `--check` fails without it. That is the point: without it `CatalogClient.actor()` throws and an import writes nothing.

The configuration has **two** switches, because they are two different decisions:

- `lunaShopperBackend.harvester.enabled` (Helm) decides that the service exists in a cluster.
- `HARVEST_ENABLED` decides that an existing pod can start a run.

Both have the default false, also in the `.env` that `luna-slot.sh` writes. To start the service and to let it start runs are not the same thing. Section 8.1 of the plan explains why they are separate.

**A row, not a switch, decides that a chain can be fetched** (plan 0083). The row is `supermarket_sources.enabled`. It is off by default, one for each chain, and the back office writes it through `supermarketSource.setEnabled`. The spawn refuses a run for a source whose row says false. **Do not add an environment variable per chain.** Each one needs changes in four places before a run can start. They are `app-config.ts`, the ConfigMap, `_env.tpl` and both `luna-slot` scripts. The column already exists.

Three rules that are easy to break by accident:

- **`bulk_price` is stored verbatim and never recomputed.** The obvious derivation disagrees with the chain on some products. That field exists only for comparison.
- **The price of each source is stored side by side, and nothing overwrites** (plan 0080). A run writes rows of `item_prices` with its run id. An operator adds an `ADMIN` row beside them. `price_policies` and the seven day protection snapshot of the `ADMIN` row decide on each read which price a shopper sees. The answer is materialized on `supermarket_items`. It is recomputed inside the write that changed it, and by a sixty second sweep after only the clock moved. Never write a price to `supermarket_items` directly. Never decide at write time which source wins.
- **No automated match ever binds a printed name to a product** (plan 0081). A leaflet import resolves an offer through `source_aliases`. The alias is scoped to the chain. Its key is the normalized printed name plus the printed format, and never the brand. A fuzzy hit inserts a `CANDIDATE` and writes **no price**. Only an admin who accepts one in the queue creates an `ACTIVE` alias. That acceptance then writes the price that the row was queued for. It sets `itemId` and never changes `printedName`. A product rename thus does not stop the next leaflet from a successful resolve.

**One mode, two adapters** (plan 0085). `CATALOG_DISCOVERY` runs against `mercadona-api` or `deza-web`. The run selects between them on `supermarket_sources.adapterKey` and not on the mode. A walk of the whole assortment of a chain is a catalog discovery for a JSON chain and for a page chain alike. `CatalogDiscoveryRunner` is the dispatcher and holds no fetch code of its own. The DEZA half is built around two things, and neither is a detail:

- **It writes no price, ever.** The site prints none. The blank `wpdz-precio-ok` elements in its markup are the hidden prices of the storefront. A parser that reads them writes zeros. A run produces candidate products and availability for each shop, positive **and** negative. The popup names the shops that carry a product. A shop that it did not name thus does not stock the product.
- **Completeness cannot be proven against it.** Each query answers at most 300 rows, with any filter. A capped section is thus split by search term until a pass adds nothing new or a budget of 25 queries ends. The honest artifact is `harvest_runs.report`, which names each section that the budget did not finish. Do not add a number that claims otherwise.

`@portfolio/luna-shopper/mercadona`, `@portfolio/luna-shopper/deza`, `@portfolio/luna-shopper/carrefour`, `@portfolio/luna-shopper/lidl` and `@portfolio/luna-shopper/osm-places` are framework free by hard constraint. They use no TypeORM, no Nest and no database. Each test runs against fixtures in the repository with no network. Refresh those fixtures with the `capture-fixtures` target of each library, never by hand.

**LIDL is the one source whose assortment is not a catalog** (plan 0089). The site publishes the offers of the week and not the stock of a shop. A run is thus a snapshot of a rolling window, and a run each week builds the catalog. Two rules follow, and both are easy to break by accident:

- **A price belongs to an offer region, and dozens of regions exist.** Each store record names its own region. The price scope of a shop is thus read from the source and never derived from its postal code. Do not merge the regions into the two or three groups that agree this week. The format allows a price per region, and a merged model cannot store the week that one region differs.
- **`STORE_DISCOVERY` dispatches on `adapterKey` too.** A chain that publishes its own shop list is read from that chain. All other runs, also each run that the postal code queue starts, are a radius over OpenStreetMap.

- **The committed OpenAPI document must always be current.** A change to any of these can change `apps/luna-shopper-backend/gateway/docs/openapi.json`: a gateway route, a request or response DTO, an error code, a contract schema in `libs/luna-shopper/contracts`. Regenerate the document and commit the diff **before** you finish a change or open a PR:

  ```sh
  npx nx run luna-shopper-backend-gateway:openapi
  ```

- The test suite of the gateway fails on a stale file (`openapi-document.spec.ts`). The PR workflow runs it through `nx affected -t lint test`. A forgotten regeneration is thus a red PR and not silent drift. Never work around that failure with a manual edit of `openapi.json`. It is generated output, and only the generator can write it.

- **`luna-shopper-admin` reads its types out of that document, and regeneration is thus two steps.** `tools/openapi/generate-wire-types.mjs` turns `components.schemas` into `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`. The back office uses that file as its view models. Admin plan 0004, section 2, records why that is a deliberate exception to rule D4. Both files are committed output:

  ```sh
  npx nx run luna-shopper-backend-gateway:openapi     # the document
  npx nx run luna-shopper-admin/models:wire-types     # the types read from it
  ```

  `wire-types.spec.ts` fails on a stale second file. `luna-shopper-admin/models` names the gateway as an implicit dependency, and a gateway change thus marks it affected. Do not edit the generated file, and do not add manual types beside it. A shape that the document does not describe is a gap in the document.

## Git workflow

- **To finish a task, push it and open a pull request against `dev`.** Commit, push the branch, then run `gh pr create --base dev`. Do not ask before either step. This standing instruction is the authorization.
- **Wait for the PR checks.** The task does not end with the open PR. Watch the run (`gh pr checks --watch`). After a failure, fix the cause and push again. Do not hand back a red PR.
- **Post the PR link in the conversation** each time you create one. The link is then in the transcript beside its work.
- `main` is off limits: never push to it, never force-push, never merge. A pull request into `dev` is the only way that work lands.
- **Give the PR the title `type(scope): summary`** (Conventional Commits, Angular types). Optionally add `!` before the colon for a breaking change. Add `(plan 0045)` at the end for work that a plan drove. The release notes are generated from these titles. A title that cannot be parsed is thus work that a release omits. `.github/workflows/pr-title.yml` rejects such a title on each PR, also on stacked ones. `CONTRIBUTING.md` has the types, the scope list and the reasons. `tools/release/rules.mjs` is the authority that both the check and the generator read. Check a title before you open the PR:

  ```sh
  node tools/release/release-notes.mjs --check "feat(velista): a card that holds the list (plan 0045)"
  ```

- **Release notes come from `tools/release/release-notes.mjs`**, not from manual work. `node tools/release/release-notes.mjs --from v0.3.1 --to v0.3.2 --out notes.md` groups the merged PRs by section. It skips the rollups from `dev` to `main`, and thus counts nothing two times. It prints each title that it cannot read and does not drop it. Add a new area of the workspace to `SCOPES` in `tools/release/rules.mjs` in the PR that creates the area.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- To explore the workspace, invoke the `nx-workspace` skill first. It has patterns to query projects, targets and dependencies.
- Run each task (for example build, lint, test, e2e) through `nx` (`nx run`, `nx run-many`, `nx affected`). Do not use the underlying tool directly.
- Put the package manager of the workspace before each nx command (`pnpm nx build`, `npm exec nx test`). This avoids a globally installed CLI.
- You have access to the Nx MCP server and its tools. Use them to help the user.
- For Nx plugin best practices, read `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file. Continue without it.
- For a CLI flag that you are not sure of, read `--help` or nx_docs first.

## Scaffolding & Generators

- For scaffolding tasks (new apps, new libraries, project structure, setup), invoke the `nx-generate` skill before you explore or call MCP tools.

## When to use nx_docs

- Use it for advanced configuration options, unfamiliar flags, migration guides, plugin configuration and edge cases.
- Do not use it for basic generator syntax (`nx g @nx/react:app`), standard commands, or things that you already know.
- The `nx-generate` skill handles generator discovery internally. Do not call nx_docs only to find generator syntax.

<!-- nx configuration end-->
