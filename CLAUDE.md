# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

An Nx monorepo hosting a personal portfolio built as an Angular **module-federation** micro-frontend system, a NestJS backend for velista (Luna Shopper), a custom Nx docker build/deploy toolchain and Kubernetes/Helm deployment config.

- `shell` — the host application. Owns the router and mounts remotes at runtime.
- `odontogram`, `damoclesSword`, `landingV2`, `velista` — remote micro-frontend apps, each exposing routes via `./Routes` (module federation).
- `apps/luna-shopper-backend/*` — velista's backend, seven NestJS services (`gateway`, `realtime`, `auth`, `core`, `catalog`, `harvester`, `assistant`) over NATS, with four Postgres instances and Redis. See the section at the bottom of this file.
- `apps/docker/*` — non-Angular Nx "app" projects (builder, local-http-server) that just wrap a Dockerfile; tagged `type:static-docker` or `type:dynamic-docker` and driven by CI (see below).
- `tools/docker` — a custom Nx plugin (`@portfolio/docker`) providing the `build` and `push` executors used by every app's `build:docker` target, plus an `application` generator for scaffolding a Dockerfile into a new app.
- `libs/<scope>/*` — Nx libraries grouped by scope (`damoclesSword`, `odontogram`, `landing-v2`, `velista`, `luna-shopper`) plus `shared`, following the `data-access` / `feature-*` / `ui` / `models` naming convention.
- `k8s/helm` — Helm chart deployed via CI to a k3s cluster. Routing is the Gateway API (`Gateway` + one `HTTPRoute` per app); the data plane is provisioned by Envoy Gateway in its own namespace, not declared by the chart.
- `k8s/bootstrap` — one-off per-cluster install of the Gateway API CRDs, Envoy Gateway, cert-manager and a ClusterIssuer (`install.sh` / `install.ps1`). Deliberately outside the chart, so the chart names the implementation only through `gateway.className`.

## Common commands

Run everything through Nx (`npx nx ...`); there are no top-level `package.json` scripts.

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

There are no top-level `package.json` scripts — run everything through Nx, either targeting a specific project, the whole workspace (`run-many --all`), or only what changed (`affected`, which is what CI uses).

### Serving from a worktree: dev slots

Every app has a fixed port, so two checkouts that both `nx serve` collide. A **slot** is an integer N that shifts a whole stack out of the way. **Slot 0 is the developer's own**, on exactly the ports `project.json` and the compose file already name, and nothing moves it; `--auto` never takes it and workers start at 1. Every other slot gets a 100 port block in a high band well clear of everything else on the machine: the front end at `42000 + (N-1)*100` (slot 1 is shell 42000, velista 42005) and the backend at `43000 + (N-1)*100` (slot 1 is gateway 43000, auth-db 43010). The band is above the crowded sub-10000 range and below the Windows ephemeral range (49152+) and every Hyper-V reservation (50000+), which is why `default + N*100` was abandoned: it landed slots on 4300 and 5532, where they collided with other software rather than with each other.

**The front end and backend slot numbers are independent.** Front end slot 5 may talk to backend slot 1, 2 or 8, and several front end slots can share one backend at the same time, which is the usual arrangement when nobody is changing the backend. So `luna-slot` allows every front end slot's origin in `CORS_ORIGINS` rather than one, and `ng-slot` works its backend out (recorded choice, else this worktree's own luna slot, else the only gateway listening, else slot 0) rather than assuming its own number. `--backend-slot <n>` and `--app-slot <n>` state it explicitly.

```sh
# which slots are taken (reads every worktree's claim, then probes the ports)
tools/dev/ng-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list

# claim the lowest free slot and serve; --up writes the env files first if absent
tools/dev/ng-slot.sh --up                       # all five Angular apps
tools/dev/ng-slot.sh --up --apps shell,velista  # ...or just some
tools/dev/ng-slot.sh --up 5 --backend-slot 1    # ...pointed at a named backend
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up   # compose + migrations + seven services

# bounce processes without losing the slot (or, for luna, the databases)
tools/dev/ng-slot.sh --restart --apps velista
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --restart --services gateway

tools/dev/ng-slot.sh --down
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down
```

**Check first, then claim, and bring instances up only through these scripts.** `--list` reads every worktree's claim and probes the ports, so it is the one accurate answer to what is already running; run it before taking a slot, and let `--up` with no number take the lowest free one. A hand rolled `nx serve` or `docker compose up` writes no claim and no per slot `.env`, so it collides with slot 0, which is the developer's own.

**A slot is cheap to ask for and expensive to run**, so take the least that does the job. An Angular dev server is 700 MB to 1 GB of RAM each (a full front end slot, shell plus four remotes, is 3 GB to 4 GB) and a Luna slot is seven Nest services at roughly 230 MB each plus seven containers on the default compose profile (four Postgres, NATS, Redis, Mailpit, and more again under the `test` or `observability` profiles) with its own Postgres volumes, so a few unshared slots exhaust a 32 GB machine and Luna is the half that adds up fastest. Serve only the apps you are touching (`--apps shell,velista`); point at a backend that is already listening rather than starting one (a Luna slot of your own is for changing backend code, running disruptive migrations, or needing an isolated database); and `--down` when you are finished, including on an abandoned task.

**Editing code needs none of those.** Everything is served with watch on, and each app or service watches its own sources _and_ the libraries it consumes, so a change recompiles and reloads by itself; only the app you edited rebuilds. The one thing a running process cannot pick up is a rewritten `.env` (a slot move, `--backend-slot`, `--app-slot`), because Nx loads `{projectRoot}/.env` when it starts the task and webpack reads its values once — and the rewrite _does_ trigger a rebuild that silently keeps the old values, so nothing looks wrong. That case is `--restart`. Use `--down` when you are finished with a slot, not to check your work.

Both have `.ps1` twins with `-List` / `-Up` / `-Restart` / `-Down`. Everything they write is git ignored and per worktree. **Do not add a port override to a `project.json` to work around a collision**: use a slot. See `tools/dev/README.md` for why the remote ports cannot come from the project graph, and `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md` for the backend half.

## Architecture

### Module federation topology

`shell` is the only app with `serve-static`/`serve` acting as host; its `module-federation.config.ts` declares `remotes: ['odontogram', 'damoclesSword', 'landingV2', 'velista']`. Each remote's own `module-federation.config.ts` exposes `./Routes` from `src/app/remote-entry/entry.routes.ts`. Path aliases like `damoclesSword/Routes` (defined in `tsconfig.base.json`) let the shell lazy-load a remote's routes as if they were a local module:

```ts
loadChildren: () => import('damoclesSword/Routes').then((m) => m.remoteRoutes);
```

**Remotes render only through the shell — a remote served on its own port shows a blank page.** Each remote's `bootstrap.ts` bootstraps its `RemoteEntry` / `RemoteEntryComponent` as the root, and that component has an **empty template with no `<router-outlet>`** (`apps/<remote>/src/app/remote-entry/entry.ts`). The router still matches routes, but there is no outlet to render them into, so hitting e.g. `http://localhost:4203` directly yields ~200 bytes of empty host element. This is intentional: it stops users (and tests) from reaching a remote through its own port, where the shell's global styles are absent and the page renders differently from production. The shell supplies the outlet (and the locale/theme context) when it lazy-loads the remote, so **always develop and test remotes through the shell** (`npx nx serve <remote>` still boots the shell via `dependsOn`, so use the shell URL like `/<remote>/<locale>`, not the remote's own port). Consequently e2e projects point at the shell, not the remote's port.

**velista is the exception, and the only one.** It is a standalone app that is _also_ exposed as a remote (`apps/velista/plans/0013-own-origin-and-the-installable-app.md`). It is served from its own origin, it is installable there as a PWA, and `http://localhost:4205` renders the real app rather than a blank page: `AppRoot` (`apps/velista/src/app/app-root.ts`) has a `<router-outlet>` and there is no `RemoteEntry`. The blank page rule exists because a remote on its own port lacks the shell's global styles and renders differently from production; velista draws its own chrome and owns its own token scope inside `AppLayout`, so it borrows nothing from the shell and its own port is not a degraded view. The other three remotes are unchanged, and the rule still reads true for them.

Both of velista's modes come from **one** route factory, `appRootRoute(mount)` (`apps/velista/src/app/app-root-route.ts`), called with `'/velista'` by `remote-entry/entry.routes.ts` and with `''` by `app.routes.ts`. Anything that differs between mounted and standalone belongs in that factory as an argument, never as a literal in both files. `app-root-route.spec.ts` asserts the mount reaches both `data.mountPath` and `APP_BASE_PATH`. The service worker is the other half of that split: `provideServiceWorker` lives in `app.config.ts` only, never in `appProviders`, because `appProviders` is spread into both modes and registering there would make the portfolio's page register velista's worker on the portfolio's origin.

### App-owned locale routing

**`/{mount}/{locale}/{rest}`, for every app, in both run modes.** `/damoclesSword/en/about`, `/odontogram/es`, `/velista/en/home`. `landingV2` mounts at the empty path, so its mount contributes no segment and the rule degenerates to `/{locale}/{rest}` — the same rule, not an exception. In a standalone build the mount is also empty, which is what makes extracting an app cheap: its route table is always "locale, then my routes", relative to wherever it happens to be mounted.

The shell owns no `:locale` route and no translator. Each app installs `localeGuard` (from `rokutranslator-angular`) on its own parent route, configured from route `data` (`appKey`, `supportedLocales`, `defaultLocale`) plus the mount, which the app's `entry.routes.ts` states as `data.mountPath`. The guard establishes one invariant before anything below it renders: **the segment immediately after the mount is a supported, canonical locale.** It never declines a URL and never routes to a not-found page — an app's own 404 is localized, so no page can be drawn until the language is settled. Its four cases (adopt / rewrite `en-US` to `en` / replace an unsupported locale / insert a missing one) are `resolveLocaleSegments`, which is pure and carries the tests.

Two consequences worth knowing before editing a route table:

- **An app's parent route needs a child that always matches** (a trailing `**`). A parent with `children` matches only if one of them matches the remainder, so with `:locale` as the only child a locale-less URL fails to match the branch at all and the guard that would _insert_ the locale never runs.
- **Nothing created per app may use `@angular/core/rxjs-interop`.** It is a secondary entry point that module federation does not dedupe: each remote bundles its own copy, carrying its own copy of core's internal module state. `toSignal` / `takeUntilDestroyed` call `assertInInjectionContext`, which reads that state, so the check runs against whichever remote loaded `rxjs-interop` first while the injector was set by the shell's core — a hard `NG0203` with a perfectly correct DI graph. `RokuLocaleStore` writes its signal by hand for exactly this reason. Components are fine in practice (they resolve within their own app), but a service provided by several remotes is not.
- **The mount must reach the guard through route `data`, not DI.** A guard resolves against the closest environment injector Angular has created by the preactivation phase, and a route's own `providers` injector is not reliably one of them, so `inject(APP_MOUNT_PATH)` there returns the token's default. The token is what the _locale switcher_ reads, where a component injector has no such problem.

In the shell's `app.routes.ts`, **every mounted app comes before the empty-path `landingV2` entry**; an empty-path route with `loadChildren` is not terminal and would otherwise swallow its siblings. `app.routes.spec.ts` asserts it.

### Sheets are addressed under a `sheet` segment (velista)

**`<the covered page's URL>/sheet/<what the sheet is about>`.** A sheet in velista is a child route by rule E1, so it has a URL, and this is that URL's shape: `…/lists/:listId/sheet/lines/:lineId/edit`, `…/zones/:zoneId/sheet/lists/new`, `…/account/sheet/name`.

The marker sits **immediately after the page being covered** and nowhere else. That placement is the rule, not a detail of it: a page's URL is unique, so stamping the marker straight after it gives every page a sheet namespace no other page can reach into. Moving it rightward, after the resource the sheet addresses, shifts two colliding URLs by the same amount and leaves them colliding.

It exists because pages and sheets used to share one namespace. The list page's line sheets sit below `lines/:lineId`, which is also the **line page's** URL, so `lines/:lineId/confirm/delete` was declared over both screens, resolved to whichever route was declared first, and deleting a line from a row on the list drew the confirmation over the line page instead of the list. Its siblings worked only because the line page had no children by those names.

Two rules follow from it:

- **Never write the segment by hand.** `sheet()` in `libs/velista/feature-shell/src/lib/routes.ts` stamps it, along with `sheetFallGuard`, so the table declares what a sheet is _about_ and cannot declare one that opts out. Callers opening a sheet use `sheetSegments()` from `@portfolio/velista/platform`; `SHEET_SEGMENT` is there too, for the rare absolute URL.
- **No page may take a `sheet` segment**, or a sheet over it could collide with a sheet over its parent again. `routes.spec.ts` asserts both directions: every route carrying the fall guard is addressed under the marker, nothing else is, and no page's path contains it.

### Going back never leaves the app (velista)

**A back control pops the history, and every one of them names a fallback URL it navigates to instead when popping would not be safe.** `PageNavigation.back(fallbackUrl)` for a page's top left chevron, `SheetNavigation.dismiss(fallbackUrl)` for a sheet's cancel, its scrim and Escape. Both arguments are required, and nothing else in velista may call `Location.back()`: `no-unguarded-history-back.spec.ts` scans the whole scope and the app for a `.back()` with no arguments and names any file that has one.

Popping is only safe onto an entry **this document pushed**. Below the entry a tab loaded on sits whichever site sent the link, so a raw pop from a shared link or a reload leaves velista entirely, from a chevron that promises one screen up. `AppHistory` (`libs/velista/platform`) is what answers that question, and `app-providers.ts` starts it with `watch()` in an environment initializer, because nothing injects it until a back button is pressed and by then every navigation it needed to see has happened.

- **The history state cannot answer it, and used to be asked.** The check was `navigationId > 1`, and a navigation that _replaces_ bumps that id without adding an entry. The replacing navigations are exactly the ones a cold arrival makes: a guard redirect inherits `replaceUrl` from the initial navigation, so the locale guard correcting `/zones/z1` produces id 2 on the first and only entry, and so does a sheet opened from a link and submitted through `leaveTo`. Both read as history and popped off the site.
- **Under-counting is the safe way to be wrong.** An entry this app cannot account for is treated as none, which costs a back button that walks to its fallback instead of popping. Over-counting sends somebody out of the app, so anything unknown answers no: an unstarted `AppHistory`, a navigation whose start it was created too late to see, a popstate onto an entry it did not write.

### Localization: RokuTranslator

`libs/shared/localization/rokutranslator` is a hand-rolled i18next wrapper (the `RokuTranslator` **class**) — not a generic i18n library pulled from npm. **There is one instance per app, not one per page**: `provideRokuTranslator` creates it, binds it to the `ROKU_TRANSLATOR` token and provides the `RokuLocaleStore` beside it, so two apps reachable in one session hold independent locales. Resolving either from an injector with no `provideRokuTranslator` above it is an error, by design. Key points:

- Namespaces are registered per-locale via lazy `LoaderFunction`s (`addNamespace`/`addTranslations`), so each library can contribute its own translation JSON (see `libs/damoclesSword/ui/assets/i18n/*.json`) without the app knowing where its assets live. A library that ships assets exports a `TranslationSource` descriptor next to them; the **app** (`apps/<app>/src/app/translation-providers.ts`) lists the descriptors and calls `composeTranslationLoader` — composition belongs to the app, and the app is the only place `app-providers.ts` can import from without crossing a library boundary by relative path.
- `libs/shared/localization/rokutranslator-angular` wraps it for Angular (service, pipe, `provideRokuTranslator`).
- In module federation config, `@portfolio/localization/rokutranslator` is forced `singleton: true` across the shell and all remotes. This is a **deduplication win, not a correctness rule**: the module exports a stateless class, so sharing it means one copy of i18next rather than one locale. (It was load-bearing when the module exported a pre-made instance.) The rule lives in **one** file, `module-federation.shared.ts` at the workspace root, which all six configs import; a `shared` callback only governs its own build, so declaring it in the host alone does nothing for the remotes. Do not add `strictVersion`: staging deploys only the affected remotes, so a version bump would leave a mixed fleet, and strict enforcement turns that ordinary window into a blank page. Read that file before editing the list — an earlier version of this rule named a library that did not exist and therefore never applied once, and `rokutranslator-angular` cannot be added the same way (Nx passes it under its project name, which nothing imports).

### Library layout

Under `libs/<scope>/`, scopes are `shared`, `damoclesSword`, `odontogram`, `landing-v2`, `velista`. Within a scope, libraries follow Nx's convention: `data-access` (API/services), `feature-*` (routed feature libs / remote entry points), `ui` (presentational components + static assets), `models` / `models-localization` (types, and per-domain translation keys). Import via the `@portfolio/<scope>/<lib>` TS path aliases in `tsconfig.base.json` — do not use relative paths across library boundaries.

`@nx/enforce-module-boundaries` is configured permissively (`onlyDependOnLibsWithTags: ['*']`) — there's no hard tag-based dependency firewall today, so don't rely on lint to catch cross-scope layering mistakes.

**Icons live in `libs/shared/ui` as standalone components** (`home-icon`, `trash-icon`, `upload-icon`, `arrow-icon`, …), each following the same pattern: an `*-icon.svg` inlined via `import('./*.svg?raw')` + `DomSanitizer`, exposed through `@portfolio/shared/ui`. Before adding a new icon, check whether one already exists there and reuse it; if it doesn't, add the new icon component to `libs/shared/ui` (never inline raw `<svg>` markup in a feature/ui component) and export it from that lib's `index.ts`.

**Check the directory listing, not just `index.ts`.** `save-icon`, `close-icon` and `edit-icon` exist under `libs/shared/ui/src/lib` but are deliberately **not** exported: they are internals of `in-place-crud`, which is the thing the barrel exposes. Reuse one by exporting it, rather than adding a second copy of the same glyph.

### Environments & API access

`libs/shared/environments` exports a plain `environment` object (`BACK_API_DOMAIN`, `BACK_API_PATH`, `BACK_API_PORT`) swapped at build time via the standard `fileReplacements` mechanism (`environment.ts` vs `environment.prod.ts`). `libs/shared/data-access` has the shared API URL resolver / consumer helpers built on top of it.

### Docker & CI/CD

- `tools/docker`'s `build` executor (`tools/docker/src/executors/build/build.ts`) shells out to `docker buildx build`. **It is project-agnostic**: it knows nothing about micro-frontends or this repo. The only build args it injects itself are `NX_APP` (the project name) and `TARGET_REGISTRY` (the resolved registry). `push` runs after `build` when `pushToRegistry: true`.
- Its own operational config comes from options and generic `DOCKER_*` env fallbacks: `DOCKER_REGISTRY`, `DOCKER_USERNAME`/`DOCKER_PASSWORD`/`DOCKER_SKIP_LOGIN`, `DOCKER_IMAGE_TAG` (overrides `versionTags`, comma-separated), and the cache options `cache`/`cacheMode`/`cacheScope` (env `DOCKER_BUILD_CACHE`/`_MODE`/`_SCOPE`; backends `local`/`gha`/`registry`).
- Project-specific values reach the Dockerfile as ordinary build args: a target's `buildArgs` (`BUILDER_TAG` per configuration, which selects the base image tag) plus a **`forwardEnv`** option that lists env var names to forward as build args when set. Today every app forwards exactly `BUILDER_TAG`. The executor never references those names itself.
- **`MFE_BASE_URL` and `MFE_REMOTE_URLS` are not build args and have not been since k8s plan 0007.** There is no build stage in an app's Dockerfile: `nx build` runs once for the whole workspace outside Docker, `build:docker` sets `"context": "dist"`, and the finished bundle is copied in. So `webpack.prod.config.ts` reads those two from the environment of that `nx build`, and both workflows set them with `docker run -e` on the builder container instead. Adding them to `forwardEnv` would do nothing.
- **Two environments on two separate k3s clusters, one VPS each** (k8s plan 0002): production (`ichirokuxvi.com`, `mfe.`, plus `velista.app`, `api.velista.app`, `rt.velista.app`) and staging (the same five names one label down: `staging.ichirokuxvi.com`, `mfe.staging.`, `staging.velista.app`, `api.staging.velista.app`, `rt.staging.velista.app`). The chart describes **one** environment; which one is decided by the cluster you point it at and the values file you pass beside `values.yaml` — `values.production.yaml` or `values.staging.yaml`. There is no `env` field, no `-staging` resource name and no `staging.enabled` switch; resource names are identical in both clusters. Hosts are derived from `baseDomain` + a per-entry `hostPrefix`, unless the environment file overrides that entry's host by name in `hostOverrides` — which is what puts velista and its two backend services on velista's own domain (an explicit `host` on an entry still wins over both, which is what the local values files use). `ichirokuxvi.com/velista` keeps working: the shell mounts the remote at that path and loads it from the new origin.
- The **shell embeds its micro-frontend base URL at build time** (`apps/shell/webpack.prod.config.ts` reads `MFE_BASE_URL`, default the production host), so the shell image is environment-specific. Every other app image is environment-agnostic. Remote URLs are static module federation, not runtime — do not assume the shell can switch environments at runtime.
- `.github/workflows/docker-ci.yml` (**staging, on push to `main`**) computes affected projects against the last successful run, builds/tests them, builds affected micro-frontends with `DOCKER_IMAGE_TAG=staging` and the staging URLs, runs **two e2e gates against the images it just pushed** (`e2e-frontend` over `k8s/e2e/portfolio-frontend/compose.yml`, `e2e-luna` over the Luna compose pair), then deploys over SSH to **`SSH_DEPLOY_HOST_STAGING`**: `provision-release.sh --check --env staging` first (a deploy that cannot work is rejected in seconds), then `helm upgrade --install --atomic --timeout 10m` with `values.staging.yaml`, then `kubectl rollout restart` for the changed deployments followed by a separate `rollout status` loop that actually observes them. A failure runs a diagnosis step dumping pods, events and logs.
- `.github/workflows/release.yml` (**production, on GitHub Release published**) builds _all_ micro-frontends at the release commit with `DOCKER_IMAGE_TAG=<version>,latest` and the production URLs, then deploys to `SSH_DEPLOY_HOST` (preflight, then `k8s/helm/deploy-release.sh <version>`, which passes `--set imageTag=<version>` with `values.production.yaml` and `--wait`, and verifies with `rollout status` before claiming success). Production is pinned to immutable version tags; rollback is `deploy-release.sh <older-version>` (or `helm rollback`). Deliberately not `--atomic` — see the reasoning in the script.
- **Deploys wait and are verified** (k8s plan 0003). Neither path used to: `helm upgrade` without `--wait` returns as soon as the manifests are accepted, and `kubectl rollout restart` is asynchronous, so both reported success while pods crashlooped or a rollout hung at zero available replicas.
- **The cluster is provisioned by script, not by prose**: `k8s/bootstrap/provision-host.sh` (bare VPS → machine, run as root over a root login: the `ichiroku` and `deploy` accounts, their keys, optionally `--k3s` and `--lock-root`), then `k8s/bootstrap/install.sh` (machine → cluster), then `k8s/bootstrap/provision-release.sh --env <env>` (cluster → ready for the chart: namespace + six Secrets, DB URLs derived from the same generated passwords so they cannot disagree). `--check` renders the chart and asserts every `secretKeyRef`/`configMapKeyRef` it references exists. Staging and production run the same three scripts with different arguments; there is no per environment host script. `k8s/README-new-cluster.md` is the runbook for a fresh machine, in order, including the DNS and root lockout steps that have to happen at a particular moment.
- **CI deploys as `deploy`, an unprivileged account.** Both workflows rsync the chart into that user's home and run helm and kubectl there, which works without sudo because `install.sh` writes the k3s kubeconfig world readable. Nothing in the deploy path may assume root or a home directory of `/root`.
- Adding a new deployable app should get a `build:docker` target (development/production configurations, `imageName` option, `"context": "dist"`, `forwardEnv: ["BUILDER_TAG"]`) mirroring the existing apps' `project.json`; a matching `src/Dockerfile`; one entry in `values.yaml` under `apps` (`name`, `image`, `hostPrefix`, `path` — no environment, and no second staging entry); and — if it's a plain static/dynamic docker wrapper rather than an Angular app — the `type:static-docker`/`type:dynamic-docker` tag so CI picks it up correctly.

## Code style

- Prettier is the source of truth (`.prettierrc`): single quotes, 2-space indent, trailing commas (es5), `arrowParens: always`, plus `prettier-plugin-organize-imports`, `prettier-plugin-organize-attributes` and `prettier-plugin-go-template` (which parses `*.yaml.tpl`; Angular template attributes are auto-sorted into groups: outputs, two-way bindings, inputs, structural directives, then everything else, then `data-*`).
- `*.html` files are linted with `@angular-eslint/template/recommended` + `prettier/prettier` using the `angular` parser.

## Plan files

- Planning and design docs live in a `plans/` directory next to the app or lib they
  describe (for example `apps/landing-v2/plans/`, `libs/shared/localization/rokutranslator/plans/`).
- **Every plan file is named `NNNN-kebab-title.md`**: a four digit zero padded number,
  then a kebab-case title. Numbering is per `plans/` directory, sequential, and
  **always starts at `0001`** (no `0000`, no unnumbered files). The next plan in a
  directory takes the next free number.
- A plan in `plans/` is **part of the build order**: it is being built, or it is next.
- A design that is agreed but **not scheduled for development** goes in `plans/backlog/`
  instead, which is its own numbering namespace starting at `0001`. This keeps parked
  designs from burning a number in the build sequence. When one is picked up it moves
  into `plans/` and takes the next free number there. Backlog plans open with a
  `> **Status: backlog. Not scheduled for development.**` blockquote, so the file says
  so on its own and not only by where it sits.

## Luna Shopper backend

### The harvester runs locally and nowhere else

`luna-shopper-backend-harvester` (plan 0038) fetches prices from supermarket
storefronts and store locations from OpenStreetMap, and writes what it finds into
catalog over NATS. It was the sixth backend service to land (`assistant`, plan
0039, is the seventh) and it owns the fourth Postgres, after auth, core and
catalog.

**It is switched off in production and in staging, on purpose, and the chart says
so in both values files.** A catalog discovery run is 4,383 HTTP requests over
about eighteen minutes, and running it costs a fourth Postgres with its own volume
plus another Node process; the development machine has room for that and the two
VPSs do not. So `lunaShopperBackend.harvester.enabled` is false everywhere,
nothing renders in either cluster (no Deployment, Service, PDB, migration Job,
StatefulSet, PVC or backup CronJob), and runs happen here against the compose
stack. The chart still describes it fully, so the files do not drift.

There are **three** switches, and they are three because they are three different
decisions:

| Switch                                        | Decides                                                 |
| --------------------------------------------- | ------------------------------------------------------- |
| `lunaShopperBackend.harvester.enabled` (Helm) | whether the service exists in a cluster at all          |
| `HARVEST_ENABLED`                             | whether a pod that exists may start any run             |
| `MERCADONA_ENABLED`                           | whether that one storefront specifically may be fetched |

All three default to false, including in the `.env` that `luna-slot.sh` writes.
Bringing the service up and letting it fetch from a third party are not the same
thing, and section 8.1 of the plan is why the second and third exist separately.

Two rules that are easy to break by accident:

- **`bulk_price` is stored verbatim and never recomputed.** The obvious
  derivation disagrees with the chain on 110 of 4,232 products, in the field
  whose only purpose is comparison.
- **An automated fetch never overwrites a price a person typed in** (plan 0038,
  section 6.5). It reports the disagreement instead. When `ItemPrice` and
  `PricePolicy` arrive that rule is _deleted_, not extended.

`@portfolio/luna-shopper/mercadona` and `@portfolio/luna-shopper/osm-places` are
framework free by hard constraint: no TypeORM, no Nest, no database, and every
test runs against checked in fixtures with no network. Refresh those fixtures
with each library's `capture-fixtures` target, never by hand.

- **The committed OpenAPI document must always be current.** Any change to a gateway route, a
  request or response DTO, an error code, or a contract schema in `libs/luna-shopper/contracts`
  can change `apps/luna-shopper-backend/gateway/docs/openapi.json`. Regenerate it and commit the
  diff **before** finishing a change or opening a PR:

  ```sh
  npx nx run luna-shopper-backend-gateway:openapi
  ```

- The gateway's own test suite fails when that file is stale (`openapi-document.spec.ts`), and PR
  checks run it through `nx affected -t lint test`, so a forgotten regeneration is a red PR rather
  than silent drift. Never work around that failure by editing `openapi.json` by hand: it is
  generated output, and the generator is the only thing allowed to write it.

## Git workflow

- **Finish a task by pushing it and opening a pull request against `dev`.** Commit, push the working branch, then `gh pr create --base dev`. No confirmation is needed for either step; this standing instruction is the authorization.
- **Wait for the PR checks.** Opening the PR is not the end of the task. Watch the run (`gh pr checks --watch`), and if it fails, fix the cause and push again rather than handing back a red PR.
- **Post the PR link in the conversation**, every time one is created, so it is in the transcript beside the work it came from.
- `main` is still off limits: never push to it, never force-push, never merge. A pull request into `dev` is the only way work lands.
- **Title the PR `type(scope): summary`** (Conventional Commits, Angular types), optionally `!` before the colon for a breaking change and a trailing `(plan 0045)` when a plan drove it. The release notes are generated from these titles, so a title that cannot be parsed is work missing from a release; `.github/workflows/pr-title.yml` rejects one on every PR, including stacked ones. The types, the scope list and the reasoning are in `CONTRIBUTING.md`, and `tools/release/rules.mjs` is the authority both the check and the generator read. Validate one before opening the PR:

  ```sh
  node tools/release/release-notes.mjs --check "feat(velista): a card that holds the list (plan 0045)"
  ```

- **Release notes come from `tools/release/release-notes.mjs`**, not from hand. `node tools/release/release-notes.mjs --from v0.3.1 --to v0.3.2 --out notes.md` groups the merged PRs by section, skips the `dev` to `main` rollups so nothing is counted twice, and prints any title it could not read rather than dropping it. Add a new area of the workspace to `SCOPES` in `tools/release/rules.mjs` in the same PR that creates it.
