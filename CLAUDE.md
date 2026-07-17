# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

An Nx monorepo hosting a personal portfolio built as an Angular **module-federation** micro-frontend system, plus a custom Nx docker build/deploy toolchain and Kubernetes/Helm deployment config.

- `shell` — the host application. Owns the router and mounts remotes at runtime.
- `landing`, `odontogram`, `damoclesSword` — remote micro-frontend apps, each exposing routes via `./Routes` (module federation).
- `apps/docker/*` — non-Angular Nx "app" projects (builder, reverse-proxy, certbot, local-http-server) that just wrap a Dockerfile; tagged `type:static-docker` or `type:dynamic-docker` and driven by CI (see below).
- `tools/docker` — a custom Nx plugin (`@portfolio/docker`) providing the `build` and `push` executors used by every app's `build:docker` target, plus an `application` generator for scaffolding a Dockerfile into a new app.
- `libs/<scope>/*` — Nx libraries grouped by micro-frontend scope (`damoclesSword`, `landing`, `odontogram`) plus `shared`, following the `data-access` / `feature-*` / `ui` / `models` naming convention.
- `k8s/helm` — Helm chart deployed via CI to a k3s cluster.

## Common commands

Run everything through Nx (`npx nx ...`); there are no top-level `package.json` scripts.

```sh
# Serve the shell with its dev remotes (odontogram, landing) — damoclesSword is served separately
npx nx serve shell

# Serve a single remote directly (each depends on shell:serve via `dependsOn`)
npx nx serve damoclesSword
npx nx serve odontogram
npx nx serve landing

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

# e2e (shell/landing/odontogram/damoclesSword-e2e use Cypress or Playwright per project)
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

`shell` is the only app with `serve-static`/`serve` acting as host; its `module-federation.config.ts` declares `remotes: ['landing', 'odontogram', 'damoclesSword']`. Each remote's own `module-federation.config.ts` exposes `./Routes` from `src/app/remote-entry/entry.routes.ts`. Path aliases like `damoclesSword/Routes` (defined in `tsconfig.base.json`) let the shell lazy-load a remote's routes as if they were a local module:

```ts
loadChildren: () => import('damoclesSword/Routes').then((m) => m.remoteRoutes);
```

Remotes can also run standalone (own `serve`/`serve-static` target, own `app.routes.ts` that imports its own `entry.routes.ts` directly) for isolated development.

### Locale-first routing

The shell's top-level route is `:locale` (e.g. `/en/damoclesSword/...`), handled by `LocaleWrapperComponent` (`apps/shell/src/app/locale-wrapper-component.ts`). It keeps the URL's locale segment in sync with `RokuTranslator`'s active locale by watching route params and rewriting the URL (full navigation, not just router state) when they diverge. Each remote that needs its own locale-aware layer follows the same pattern (see `libs/damoclesSword/feature-shell`).

### Localization: RokuTranslator

`libs/shared/localization/rokutranslator` is a hand-rolled i18next wrapper (singleton instance exported as `RokuTranslator`) — not a generic i18n library pulled from npm. Key points:

- Namespaces are registered per-locale via lazy `LoaderFunction`s (`addNamespace`/`addTranslations`), so each remote can contribute its own translation JSON (see `libs/damoclesSword/ui/assets/i18n/*.json`) without the shell knowing about it upfront.
- `libs/shared/localization/rokutranslator-angular` wraps it for Angular (service, pipe, `provideRokuTranslator`).
- In module federation config, `@portfolio/localization/rokutranslator` is forced `singleton: true, strictVersion: true` across shell and all remotes — every micro-frontend must share the exact same instance or locale state fragments across app boundaries. Keep this in mind if a dependency bump changes this package.

### Library layout

Under `libs/<scope>/`, scopes are `shared`, `damoclesSword`, `landing`, `odontogram`. Within a scope, libraries follow Nx's convention: `data-access` (API/services), `feature-*` (routed feature libs / remote entry points), `ui` (presentational components + static assets), `models` / `models-localization` (types, and per-domain translation keys). Import via the `@portfolio/<scope>/<lib>` TS path aliases in `tsconfig.base.json` — do not use relative paths across library boundaries.

`@nx/enforce-module-boundaries` is configured permissively (`onlyDependOnLibsWithTags: ['*']`) — there's no hard tag-based dependency firewall today, so don't rely on lint to catch cross-scope layering mistakes.

### Environments & API access

`libs/shared/environments` exports a plain `environment` object (`BACK_API_DOMAIN`, `BACK_API_PATH`, `BACK_API_PORT`) swapped at build time via the standard `fileReplacements` mechanism (`environment.ts` vs `environment.prod.ts`). `libs/shared/data-access` has the shared API URL resolver / consumer helpers built on top of it.

### Docker & CI/CD

- `tools/docker`'s `build` executor (`tools/docker/src/executors/build/build.ts`) shells out to `docker buildx build`, using a local buildx cache keyed by image name and reading `PORTFOLIO_DOCKER_REGISTRY` from the environment. It auto-injects `NX_APP` and `TARGET_REGISTRY` build args. `push` runs after `build` when `pushToRegistry: true` in the target configuration.
- `.github/workflows/docker-ci.yml` (runs on push to `main`) computes affected projects via `nx show projects --affected` against the last successful commit on the branch, then: builds `type:static-docker`-tagged apps directly, runs tests inside the `builder` docker image, builds remaining apps with `build:docker`, and finally rsyncs `k8s/` to the deploy host and runs `helm upgrade nx-portfolio ./k8s/helm`.
- Adding a new deployable app should get a `build:docker` target (development/production configurations, `imageName` option) mirroring the existing apps' `project.json`, and — if it's a plain static/dynamic docker wrapper rather than an Angular app — the `type:static-docker`/`type:dynamic-docker` tag so CI picks it up correctly.

## Code style

- Prettier is the source of truth (`.prettierrc`): single quotes, 2-space indent, trailing commas (es5), `arrowParens: always`, plus `prettier-plugin-organize-imports` and `prettier-plugin-organize-attributes` (Angular template attributes are auto-sorted into groups: outputs, two-way bindings, inputs, structural directives, then everything else, then `data-*`).
- `*.html` files are linted with `@angular-eslint/template/recommended` + `prettier/prettier` using the `angular` parser.
