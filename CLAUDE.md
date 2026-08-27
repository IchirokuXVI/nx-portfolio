# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

An Nx monorepo hosting a personal portfolio built as an Angular **module-federation** micro-frontend system, plus a custom Nx docker build/deploy toolchain and Kubernetes/Helm deployment config.

- `shell` — the host application. Owns the router and mounts remotes at runtime.
- `odontogram`, `damoclesSword`, `landingV2`, `velista` — remote micro-frontend apps, each exposing routes via `./Routes` (module federation).
- `apps/docker/*` — non-Angular Nx "app" projects (builder, local-http-server) that just wrap a Dockerfile; tagged `type:static-docker` or `type:dynamic-docker` and driven by CI (see below).
- `tools/docker` — a custom Nx plugin (`@portfolio/docker`) providing the `build` and `push` executors used by every app's `build:docker` target, plus an `application` generator for scaffolding a Dockerfile into a new app.
- `libs/<scope>/*` — Nx libraries grouped by micro-frontend scope (`damoclesSword`, `odontogram`, `landing-v2`, `velista`) plus `shared`, following the `data-access` / `feature-*` / `ui` / `models` naming convention.
- `k8s/helm` — Helm chart deployed via CI to a k3s cluster. Routing is the Gateway API (`Gateway` + one `HTTPRoute` per app); the data plane is provisioned by Envoy Gateway in its own namespace, not declared by the chart.
- `k8s/bootstrap` — one-off per-cluster install of the Gateway API CRDs, Envoy Gateway, cert-manager and a ClusterIssuer (`install.sh` / `install.ps1`). Deliberately outside the chart, so the chart names the implementation only through `gateway.className`.

## Common commands

Run everything through Nx (`npx nx ...`); there are no top-level `package.json` scripts.

```sh
# Serve the shell with its dev remotes — damoclesSword is served separately
npx nx serve shell

# Serve a single remote directly (each depends on shell:serve via `dependsOn`)
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

## Architecture

### Module federation topology

`shell` is the only app with `serve-static`/`serve` acting as host; its `module-federation.config.ts` declares `remotes: ['odontogram', 'damoclesSword', 'landingV2', 'velista']`. Each remote's own `module-federation.config.ts` exposes `./Routes` from `src/app/remote-entry/entry.routes.ts`. Path aliases like `damoclesSword/Routes` (defined in `tsconfig.base.json`) let the shell lazy-load a remote's routes as if they were a local module:

```ts
loadChildren: () => import('damoclesSword/Routes').then((m) => m.remoteRoutes);
```

**Remotes render only through the shell — a remote served on its own port shows a blank page.** Each remote's `bootstrap.ts` bootstraps its `RemoteEntry` / `RemoteEntryComponent` as the root, and that component has an **empty template with no `<router-outlet>`** (`apps/<remote>/src/app/remote-entry/entry.ts`). The router still matches routes, but there is no outlet to render them into, so hitting e.g. `http://localhost:4203` directly yields ~200 bytes of empty host element. This is intentional: it stops users (and tests) from reaching a remote through its own port, where the shell's global styles and singleton-`RokuTranslator` locale config are absent and the page renders differently from production. The shell supplies the outlet (and the locale/theme context) when it lazy-loads the remote, so **always develop and test remotes through the shell** (`npx nx serve <remote>` still boots the shell via `dependsOn`, so use the shell URL like `/<locale>/<remote>`, not the remote's own port). Consequently e2e projects point at the shell, not the remote's port.

### Locale-first routing

The shell's top-level route is `:locale` (e.g. `/en/damoclesSword/...`), handled by `LocaleWrapperComponent` (`apps/shell/src/app/locale-wrapper-component.ts`). It keeps the URL's locale segment in sync with `RokuTranslator`'s active locale by watching route params and rewriting the URL (full navigation, not just router state) when they diverge. Each remote that needs its own locale-aware layer follows the same pattern (see `libs/damoclesSword/feature-shell`).

### Localization: RokuTranslator

`libs/shared/localization/rokutranslator` is a hand-rolled i18next wrapper (singleton instance exported as `RokuTranslator`) — not a generic i18n library pulled from npm. Key points:

- Namespaces are registered per-locale via lazy `LoaderFunction`s (`addNamespace`/`addTranslations`), so each remote can contribute its own translation JSON (see `libs/damoclesSword/ui/assets/i18n/*.json`) without the shell knowing about it upfront.
- `libs/shared/localization/rokutranslator-angular` wraps it for Angular (service, pipe, `provideRokuTranslator`).
- In module federation config, `@portfolio/localization/rokutranslator` is forced `singleton: true` across the shell and all remotes — every micro-frontend must share the exact same instance or locale state fragments across app boundaries. The rule lives in **one** file, `module-federation.shared.ts` at the workspace root, which all six configs import; a `shared` callback only governs its own build, so declaring it in the host alone does nothing for the remotes. Do not add `strictVersion`: staging deploys only the affected remotes, so a version bump would leave a mixed fleet, and strict enforcement turns that ordinary window into a blank page. Read that file before editing the list — an earlier version of this rule named a library that did not exist and therefore never applied once, and `rokutranslator-angular` cannot be added the same way (Nx passes it under its project name, which nothing imports).

### Library layout

Under `libs/<scope>/`, scopes are `shared`, `damoclesSword`, `odontogram`, `landing-v2`, `velista`. Within a scope, libraries follow Nx's convention: `data-access` (API/services), `feature-*` (routed feature libs / remote entry points), `ui` (presentational components + static assets), `models` / `models-localization` (types, and per-domain translation keys). Import via the `@portfolio/<scope>/<lib>` TS path aliases in `tsconfig.base.json` — do not use relative paths across library boundaries.

`@nx/enforce-module-boundaries` is configured permissively (`onlyDependOnLibsWithTags: ['*']`) — there's no hard tag-based dependency firewall today, so don't rely on lint to catch cross-scope layering mistakes.

**Icons live in `libs/shared/ui` as standalone components** (`home-icon`, `save-icon`, `trash-icon`, `upload-icon`, …), each following the same pattern: an `*-icon.svg` inlined via `import('./*.svg?raw')` + `DomSanitizer`, exposed through `@portfolio/shared/ui`. Before adding a new icon, check whether one already exists there and reuse it; if it doesn't, add the new icon component to `libs/shared/ui` (never inline raw `<svg>` markup in a feature/ui component) and export it from that lib's `index.ts`.

### Environments & API access

`libs/shared/environments` exports a plain `environment` object (`BACK_API_DOMAIN`, `BACK_API_PATH`, `BACK_API_PORT`) swapped at build time via the standard `fileReplacements` mechanism (`environment.ts` vs `environment.prod.ts`). `libs/shared/data-access` has the shared API URL resolver / consumer helpers built on top of it.

### Docker & CI/CD

- `tools/docker`'s `build` executor (`tools/docker/src/executors/build/build.ts`) shells out to `docker buildx build`. **It is project-agnostic**: it knows nothing about micro-frontends or this repo. The only build args it injects itself are `NX_APP` (the project name) and `TARGET_REGISTRY` (the resolved registry). `push` runs after `build` when `pushToRegistry: true`.
- Its own operational config comes from options and generic `DOCKER_*` env fallbacks: `DOCKER_REGISTRY`, `DOCKER_USERNAME`/`DOCKER_PASSWORD`/`DOCKER_SKIP_LOGIN`, `DOCKER_IMAGE_TAG` (overrides `versionTags`, comma-separated), and the cache options `cache`/`cacheMode`/`cacheScope` (env `DOCKER_BUILD_CACHE`/`_MODE`/`_SCOPE`; backends `local`/`gha`/`registry`).
- Project-specific values reach the Dockerfile as ordinary build args: a target's `buildArgs` (e.g. `NODE_ENV`, `BUILDER_TAG` per configuration) plus a **`forwardEnv`** option that lists env var names to forward as build args when set (this is how `MFE_BASE_URL` / `MFE_REMOTE_URLS` / `BUILDER_TAG` reach the shell build from CI). The executor never references those names itself.
- **Two environments, both on the single k3s cluster / one MetalLB IP, routed by the Gateway API (Envoy Gateway) on distinct hostnames:** production (`ichirokuxvi.com` + `mfe.ichirokuxvi.com`) and staging (`staging.ichirokuxvi.com` + `mfe.staging.ichirokuxvi.com`). They are one Helm release in one namespace; staging apps are gated by `staging.enabled` in `values.yaml`.
- The **shell embeds its micro-frontend base URL at build time** (`apps/shell/webpack.prod.config.ts` reads `MFE_BASE_URL`, default the production host), so the shell image is environment-specific. Every other app image is environment-agnostic. Remote URLs are static module federation, not runtime — do not assume the shell can switch environments at runtime.
- `.github/workflows/docker-ci.yml` (**staging, on push to `main`**) computes affected projects against the last successful run, builds/tests them, then builds affected micro-frontends with `DOCKER_IMAGE_TAG=staging` and the staging `MFE_BASE_URL`, `helm upgrade`s (preserving the live production version from `/root/helm-live/prod-tag.yaml`), and `kubectl rollout restart`s the changed `*-staging` deployments so they re-pull the mutable tag.
- `.github/workflows/release.yml` (**production, on GitHub Release published**) builds *all* micro-frontends at the release commit with `DOCKER_IMAGE_TAG=<version>,latest` and the production `MFE_BASE_URL`, then runs `k8s/helm/deploy-release.sh <version>` on the host, which pins `productionImageTag` in `/root/helm-live/prod-tag.yaml` and `helm upgrade`s. Production apps are pinned to immutable version tags; rollback is `deploy-release.sh <older-version>` (or `helm rollback`).
- Adding a new deployable app should get a `build:docker` target (development/production configurations, `imageName` option) mirroring the existing apps' `project.json`; a matching `src/Dockerfile`; production and staging entries in `values.yaml` under `apps`; and — if it's a plain static/dynamic docker wrapper rather than an Angular app — the `type:static-docker`/`type:dynamic-docker` tag so CI picks it up correctly.

## Code style

- Prettier is the source of truth (`.prettierrc`): single quotes, 2-space indent, trailing commas (es5), `arrowParens: always`, plus `prettier-plugin-organize-imports` and `prettier-plugin-organize-attributes` (Angular template attributes are auto-sorted into groups: outputs, two-way bindings, inputs, structural directives, then everything else, then `data-*`).
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

- **Never push code.** Commit locally only, unless the user explicitly asks for a push. Even when a push is explicitly requested, confirm with the user before running it — a prior "yes" does not carry forward to later pushes.
