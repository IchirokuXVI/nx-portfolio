# Creating a new app (remote)

The full flow for standing up a new remote micro-frontend: generate the app, make
it zoneless, empty the remote entry, wire the shell route, and generate its
`libs/<app>/*` scope. (Adding a single lib to an **existing** app is just step 5's
generator with the right `--directory`/`--importPath`, plus the zoneless test
setup and asset-import-types step.) Reference files to copy from:
`apps/landing-v2/{module-federation.config.ts,project.json,src/bootstrap.ts,src/app/app.config.ts,src/app/app.routes.ts,src/app/remote-entry/*}`
and `apps/shell/{module-federation.config.ts,src/app/app.routes.ts}`.

## 1. Generate the remote app

Nx Angular **remote** generator, hosted by the shell. Name and folder are the same
kebab-case string (see SKILL.md "Naming"):

```sh
npx nx g @nx/angular:remote --name=my-app --directory=apps/my-app \
  --host=shell --style=scss --prefix=app --e2eTestRunner=playwright \
  --unitTestRunner=jest --no-interactive
```

This creates `apps/my-app` (exposing `./Routes` from
`src/app/remote-entry/entry.routes.ts`), an `apps/my-app-e2e` Playwright project,
adds `'my-app'` to `apps/shell/module-federation.config.ts` `remotes`, inserts a
`my-app` route in `apps/shell/src/app/app.routes.ts`, and adds the `my-app/Routes`
alias to `tsconfig.base.json`. Verify each landed.

Confirm the rokutranslator singleton override is present in the shell's
`module-federation.config.ts` (it already forces
`@portfolio/localization/rokutranslator` to `singleton: true, strictVersion:
true`). Every remote must agree, or locale state fragments across boundaries.

## 2. Make it zoneless (required for new apps)

Mirror `apps/landing-v2` exactly:

- **`project.json`** build options must NOT contain `"polyfills": ["zone.js"]`.
  Remove it if the generator added it.
- **`src/test-setup.ts`**:

  ```ts
  import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';
  setupZonelessTestEnv({
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  ```

- **`src/app/app.config.ts`** must NOT use `provideZoneChangeDetection`. Match
  landing-v2's minimal config (`provideBrowserGlobalErrorListeners()` +
  `provideRouter(appRoutes)`); if Angular needs an explicit zoneless provider for
  the app to boot, add `provideZonelessChangeDetection()`. Verify the app serves
  with no NgZone warnings.

## 3. Remote entry stays EMPTY (renders only through the shell)

`apps/my-app/src/app/remote-entry/entry.ts` is a component with an **empty
template and no `<router-outlet>`** (copy landing-v2's). **Delete** the generated
`remote-entry/nx-welcome.ts` and any reference to it. Point the remote routes at
the feature-shell wrapper:

```ts
// apps/my-app/src/app/remote-entry/entry.routes.ts
import { Route } from '@angular/router';
export const remoteRoutes: Route[] = [
  {
    path: '',
    loadChildren: () =>
      import('@portfolio/my-app/feature-shell').then((m) => m.MyAppShellRoutes),
  },
];
```

## 4. Wire the shell route (locale-first)

The shell's top-level route is `:locale`, a componentless route guarded by
`localeGuard`. Its children render in the shell's root outlet under the active
locale. Move the generator's root-level `my-app` route to be a **child of
`:locale`** in `apps/shell/src/app/app.routes.ts`, at your own path segment,
mirroring the existing entries:

```ts
{
  path: 'my-app',                      // your own path segment
  title: 'app-title',
  data: { titleNs: 'my-app', titleFallback: 'My App' },
  loadChildren: () => import('my-app/Routes').then((m) => m.remoteRoutes),
},
```

Keep the `**` NotFound child last. `localeGuard` redirects locale-less URLs
(`/my-app` → `/<guess>/my-app`), so you do not handle that here.

> Only mount at the empty `''` locale child if you are deliberately replacing the
> root landing app — that was landingV2's one-off cutover, not the default. Then
> namespace internal detail pages (e.g. under `projects/`) so they do not collide
> with sibling remotes under `:locale`.

## 5. Generate the lib scope

Mirror `libs/landing-v2/*` / `libs/damoclesSword/*`. Angular libraries, jest +
eslint + scss:

```sh
npx nx g @nx/angular:library --name=my-app/models \
  --directory=libs/my-app/models --importPath=@portfolio/my-app/models \
  --unitTestRunner=jest --linter=eslint --skipModule=true --standalone=true --no-interactive

npx nx g @nx/angular:library --name=my-app/data-access \
  --directory=libs/my-app/data-access --importPath=@portfolio/my-app/data-access \
  --unitTestRunner=jest --linter=eslint --no-interactive

npx nx g @nx/angular:library --name=my-app/ui \
  --directory=libs/my-app/ui --importPath=@portfolio/my-app/ui \
  --unitTestRunner=jest --linter=eslint --style=scss --no-interactive

npx nx g @nx/angular:library --name=my-app/feature-shell \
  --directory=libs/my-app/feature-shell --importPath=@portfolio/my-app/feature-shell \
  --unitTestRunner=jest --linter=eslint --style=scss --no-interactive
```

Add `feature-<name>` libs (one per route) as the app needs them, like
damoclesSword's `feature-home` / `feature-about` / `feature-contact` /
`feature-services`, or landingV2's `feature-project`. After each generation,
confirm the alias landed in `tsconfig.base.json`, set each new lib to **zoneless**
(step 2's `test-setup.ts`), and run `npx nx lint my-app/<lib>`.

Lib roles (Nx convention):
- **models** — interfaces/types only (structural type + `*Translation` type +
  a `Translated<X>` join type). No Angular runtime. Optionally a
  **`models-localization`** sibling of flat `key → string` JSON per locale — see
  `references/localization.md`.
- **data-access** — static data + in-memory service + DI token. Depends on models
  + `@portfolio/shared/data-access` + `@portfolio/shared/util`. →
  `references/data-access.md`.
- **ui** — presentational components + the i18n namespace + translation JSON
  assets. → `references/localization.md`.
- **feature-shell** — the routed, locale-aware wrapper. →
  `references/routing-and-locale.md`.

### Asset-import types gotcha (do not skip)

Any leaf `tsconfig.lib.json` / `tsconfig.spec.json` that will
`import('...svg?raw')` or `import('...png')` (any `ui` lib, or a lib importing an
image) needs `"types/**/*.d.ts"` (or the shared asset `.d.ts`) added to `include`.
Copy the setup from `libs/landing-v2/ui` or `libs/damoclesSword/ui` so tests and
build resolve asset modules.

## 6. Deployment wiring (only when the app should deploy)

Mirror an existing app's `project.json`:
- a `build:docker` target (`@portfolio/docker:build`, `imageName`
  `nx-portfolio/my-app`, `forwardEnv: ['BUILDER_TAG']`, dev/prod configurations);
- `serve` / `serve-static` on your dev port, `serve` having
  `dependsOn: ['shell:serve']` (so serving the remote boots the shell too);
- production + staging entries in `k8s/helm/values.yaml` under `apps` (staging
  gated by `staging.enabled`).

CI picks up affected micro-frontends automatically. Remote URLs are static module
federation, embedded at build time — not runtime.

## 7. Verify

1. `npx nx lint my-app <each new lib>` and `npx nx test my-app <each new lib>` pass.
2. `npx nx build my-app --configuration=development` compiles.
3. `npx nx serve shell` (boots shell + dev remotes). Open
   `http://localhost:<shellPort>/en/my-app` — the shell-hosted page renders with no
   console errors. The remote's own port renders the intentional empty root.
4. Commit locally (`feat(my-app): scaffold ...`). **Do not push.**
