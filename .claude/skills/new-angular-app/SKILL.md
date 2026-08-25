---
name: new-angular-app
description: >-
  Scaffold a new Angular micro-frontend "app" (remote) in this Nx
  module-federation monorepo, the way odontogram / damoclesSword / landingV2
  are built: an empty-shell remote wired into the host, a per-scope
  libs/<scope>/{models,data-access,ui,feature-shell,feature-*} layout, a
  localized RokuTranslator namespace, and an in-memory data-access service
  behind a DI token so the app runs and tests with no backend. Invoke when
  asked to add / create / scaffold a new app, remote, micro-frontend, or
  page-app in this portfolio, or to add a new lib scope for one.
---

# Create a new Angular app (remote micro-frontend) in nx-portfolio

You are adding a new remote to an Nx Angular **module-federation** portfolio.
Follow the shape the existing apps already use — `odontogram`, `damoclesSword`,
and `landingV2` (dir `apps/landing-v2`) are the reference implementations. Read
their `CASE_STUDY.md` and, for landingV2, `apps/landing-v2/plans/*.md` (the
`0001-overview` + `0002-scaffold-libs-and-wiring` plans are a working recipe)
before you start, plus the root `CLAUDE.md` sections "Module federation
topology", "Locale-first routing", "Localization: RokuTranslator", and
"Library layout".

## Non-negotiables (the user called these out explicitly)

1. **Localize everything.** No hardcoded user-facing strings. Page/UI chrome
   goes through a RokuTranslator namespace (i18n JSON); per-record *content*
   (descriptions, values) lives already-translated in the data-access
   translation tables. English is the default/fallback locale.
2. **Always ship an in-memory data-access service.** Every data domain gets a
   `*Memory` implementation behind an interface + DI token, seeded from static
   `.ts` data, so the app runs and every unit test passes with **no backend**.
   The API implementation is optional and swapped in per-environment later; the
   memory one is what the deployed demo and the tests use today.
3. **Any frontend UI / visual design work goes through the `design-taste-frontend`
   skill.** Do not hand-roll a look. Invoke that skill for the landing/detail
   page design, then implement to it.
4. **Commit locally only; never push** (CLAUDE.md git workflow). Confirm before
   any push even if previously asked.
5. **Cross-lib imports use `@portfolio/<scope>/<lib>` aliases**, never relative
   paths across a library boundary.

## Before you generate anything

Ask the user (or infer, then state your assumption) for:

- **App name** — becomes the module-federation remote name. It **must be a valid
  JS identifier** (module-federation requirement), so it is `camelCase`, e.g.
  `landingV2`. The **directory** may be kebab-case (`apps/landing-v2`). Keep both
  and be consistent:
  - `nx` project name / remote / MF name / `NX_APP`: **`myApp`** (camelCase).
  - App directory: **`apps/my-app`**; e2e: **`apps/my-app-e2e`**.
  - Routes alias: **`myApp/Routes`**.
  - Lib scope directory: **`libs/my-app/*`**; import alias
    **`@portfolio/my-app/<lib>`** (libs have no identifier restriction, so the
    hyphen is fine there).
- **Locales** it enables (default `['en','es']`, `en` default; some apps add
  `fr` — damoclesSword does).
- **A free dev port** (existing: shell host, odontogram 4202, landingV2 4204,
  landing/damoclesSword on their own — pick the next free one).
- **Does it mount at the locale root or under its own path segment?** Most remotes
  mount at `/<locale>/<appPath>` (like odontogram, damoclesSword). landingV2 is
  special: it replaced `landing` at the locale root, so its detail pages are
  namespaced under `projects/`. Default a new app to its **own path segment**.

## Step 1 — Generate the remote app

Use the Nx Angular **remote** generator, hosted by the shell (mirror the command
recorded in `apps/landing-v2/plans/0001-overview.md`):

```sh
npx nx g @nx/angular:remote --name=myApp --directory=apps/my-app \
  --host=shell --style=scss --prefix=app --e2eTestRunner=playwright \
  --unitTestRunner=jest --no-interactive
```

This creates `apps/my-app` (exposing `./Routes` from
`src/app/remote-entry/entry.routes.ts`), an `apps/my-app-e2e` Playwright project,
adds `'myApp'` to `apps/shell/module-federation.config.ts` `remotes`, inserts a
`myApp` route in `apps/shell/src/app/app.routes.ts`, and adds the `myApp/Routes`
alias to `tsconfig.base.json`. Verify each of those landed. Also confirm the
rokutranslator singleton override is present in
`apps/my-app/module-federation.config.ts` (the shell forces
`@portfolio/localization/rokutranslator` to `singleton: true, strictVersion:
true` — every remote must agree, or locale state fragments across boundaries).

## Step 2 — Remote entry stays EMPTY (renders only through the shell)

This is intentional and enforced across the repo (CLAUDE.md). Confirm
`apps/my-app/src/app/remote-entry/entry.ts` is a component with an **empty
template and no `<router-outlet>`** (copy `apps/landing-v2/src/app/remote-entry/entry.ts`),
and **delete** the generated `remote-entry/nx-welcome.ts` and any reference to
it. Hitting the remote's own port directly must render ~nothing; the shell
supplies the outlet, locale, and theme context. Point the remote routes at the
feature-shell wrapper:

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

## Step 3 — Wire the shell route (locale-first)

The shell's top-level route is `:locale` (guarded by `localeGuard`). Move the
generator's root-level `myApp` route to be a **child of `:locale`** in
`apps/shell/src/app/app.routes.ts`, mounted at your path segment, mirroring the
existing entries:

```ts
{
  path: 'myApp',                       // your own path segment
  title: 'app-title',
  data: { titleNs: 'myApp', titleFallback: 'My App' },
  loadChildren: () => import('myApp/Routes').then((m) => m.remoteRoutes),
},
```

Leave the `**` NotFound child last. (Only mount at the empty `''` locale child
if you are deliberately replacing the root landing app — that was landingV2's
special cutover, not the default.)

## Step 4 — Generate the lib scope

Mirror the existing `libs/landing-v2/*` / `libs/damoclesSword/*` layout. Generate
Angular libraries (jest + eslint + scss), per
`apps/landing-v2/plans/0002-scaffold-libs-and-wiring.md`:

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

Add `feature-<name>` libs for routed sub-pages as the app needs them (one per
route, like damoclesSword's `feature-home` / `feature-about` / `feature-contact`
/ `feature-services`, or landingV2's `feature-project`). After each generation,
confirm the alias landed in `tsconfig.base.json` and `npx nx lint my-app/<lib>`
passes.

Roles (Nx convention, per CLAUDE.md "Library layout"):
- **models** — interfaces / types only (structural type + `*Translation` type +
  a `Translated<X>` join type). No Angular runtime. Optionally a
  **`models-localization`** sibling holding flat `key → string` JSON per locale
  (`{en,es}.json` exported as `{ en, es }`) — odontogram does this for domain
  term translations, loaded via a branching loader (Step 5).
- **data-access** — static data + in-memory service + DI token (Step 6). Depends
  on models + `@portfolio/shared/data-access` + `@portfolio/shared/util`.
- **ui** — presentational components + the i18n namespace + translation JSON
  assets (Step 5). Never inline raw `<svg>`; pull icons from `@portfolio/shared/ui`.
- **feature-shell** — the routed, locale-aware wrapper (Step 7).

### Asset-import types gotcha (do not skip)

Any leaf `tsconfig.lib.json` / `tsconfig.spec.json` that will
`import('...svg?raw')` or `import('...png')` (any `ui` lib, or a lib importing an
image/screenshot) needs `"types/**/*.d.ts"` (or the shared asset `.d.ts`) added
to `include`. Copy the setup from `libs/landing-v2/ui` or `libs/damoclesSword/ui`
so tests and build resolve asset modules. (This is a recurring failure — see the
"Asset import types" memory.)

## Step 5 — Localization (RokuTranslator namespace)

The **ui** lib owns the namespace. Follow `libs/landing-v2/ui` /
`libs/odontogram/ui`:

- Declare the locales the UI ships assets for, in a small `my-app-locales.ts`:

  ```ts
  export const MY_APP_APP_KEY = 'myApp';         // per-app locale-storage key
  export const MY_APP_AVAILABLE_LOCALES: string[] = ['en', 'es'];
  export const MY_APP_DEFAULT_LOCALE = 'en';
  ```

- Register the namespace in the ui NgModule via `RokuTranslatorModule.withConfig`,
  lazily loading per-locale JSON. The `RokuTranslatorService` registers the
  namespace(s) itself from this config — you do **not** call `addNamespace` by
  hand:

  ```ts
  RokuTranslatorModule.withConfig({
    locales: MY_APP_AVAILABLE_LOCALES,
    defaultNamespace: 'myApp',
    loader: (locale) => import(`../../assets/i18n/${locale}.json`),
  })
  ```

  If you also use a `models-localization` lib, add a second namespace and branch
  the loader (odontogram's pattern):

  ```ts
  RokuTranslatorModule.withConfig({
    locales: MY_APP_AVAILABLE_LOCALES,
    defaultNamespace: 'myApp/ui',
    namespaces: ['myApp/models'],
    loader: (locale, namespace) =>
      namespace === 'myApp/models'
        ? import('@portfolio/my-app/models-localization').then((m) => m[locale])
        : import(`../../assets/i18n/${locale}.json`),
  })
  ```

- Put chrome strings in `libs/my-app/ui/src/assets/i18n/{en,es,...}.json`.
- Components read translations via `@portfolio/localization/rokutranslator-angular`:
  the `rokuT` pipe (`{{ 'my.key' | rokuT }}`) or `RokuTranslatorService.t(...)`.
  The `RokuTranslator` singleton is shared across shell + remotes — do not create
  a second instance, and do not add a generic npm i18n library.
- The **feature-shell** owns which locales are actually *enabled* — a
  `usable-locales.ts` that defaults to `[...MY_APP_AVAILABLE_LOCALES]` and drives
  both the route-data guard and the language switcher (Step 7).
- Per-record content is **not** i18n keys: it lives already-translated in the
  data-access translation table (Step 6). Data-access services return
  already-localized objects for the active locale.

## Step 6 — data-access: the in-memory service pattern (REQUIRED)

This is the core of "runs and tests with no backend". For each data domain,
create these, mirroring `libs/landing-v2/data-access/src/lib/project/` and
`libs/odontogram/data-access/src/lib/odontogram/`:

1. **`static-<x>-data.ts`** — the structural table: `export const XS: readonly
   StaticX[] = [...]` (locale-independent fields: ids, slugs, tags, links, lazy
   asset `import()`s).
2. **`static-<x>-translation-data.ts`** — per-locale copy: `export const
   XS_TRANSLATIONS: readonly XTranslation[] = [...]`, one row per (record ×
   locale), `en` present as the fallback. (Skip this only for a domain with no
   translatable content.)
3. **`<x>-service.ts`** — the interface **and** the DI token:

   ```ts
   import { inject } from '@angular/core';
   import { serviceToken } from '@portfolio/shared/data-access';
   import { XMemory } from './x-memory';

   export interface XServiceI {
     getList(locale: string, filter?: XFilter): Observable<TranslatedX[]>;
     getById(id: string, locale: string): Observable<TranslatedX>;
   }

   // Inject THIS token (typed as the interface), never the concrete class.
   export const X_SERVICE = serviceToken<XServiceI>(
     'X_SERVICE',
     () => inject(XMemory),   // default = in-memory impl
   );
   ```

4. **`<x>-memory.ts`** — `@Injectable({ providedIn: 'root' })` class
   `implements XServiceI`, joining the structural row with its localized row
   (fallback to `en`), resolving lazy assets, and returning `of(...)`. Use
   `@portfolio/shared/util`'s `InMemoryFilter` (`setFilterConfig` with per-field
   `check` fns) for list filtering and `NotFoundResourceError` from
   `@portfolio/shared/data-access` for misses; mint ids with `uuidv4()` on
   create. See `projects-memory.ts` / `odontogram-memory.ts` for the exact shape.

The **API** implementation is optional and added later: an `XApi` class
`@Injectable({ providedIn: 'root' })` `extends ApiConsumer implements XServiceI`,
with `constructor() { super(inject(OwnApiUrlResolver)); }` (resolves the base URL
from the `BACK_API_*` env values in `libs/shared/environments`), injecting
`HttpClient` and mapping HTTP 404 → `NotFoundResourceError`. Switch
implementations per environment at a route/remote injector with
`provideService(X_SERVICE, XApi)` (`useExisting`) — do **not** change the token's
default. Today everything runs in memory; only build the API impl when a backend
exists.

Export the service + memory (+ api) flat from the data-access `index.ts`.

## Step 7 — feature-shell: the routed, locale-aware wrapper

Mirror `libs/landing-v2/feature-shell` (or `libs/damoclesSword/feature-shell`):

- **`routes.ts`** exporting a `Route[]` (re-exported from `index.ts` under an
  app-specific alias, e.g. `export { appRoutes as MyAppShellRoutes }`): a parent
  route rendering a shared `Layout`/wrapper (the site header/footer chrome,
  hosting a `<router-outlet>`), guarded by `localeCorrectionGuard` with route
  `data` of `{ appKey: MY_APP_APP_KEY, supportedLocales: MY_APP_USABLE_LOCALES,
  defaultLocale: MY_APP_DEFAULT_LOCALE }`; child routes are the actual pages
  (index wrapper + any detail/`loadComponent` pages, or lazy-loaded `feature-*`).
- **A wrapper component** that either (a) injects the data-access **tokens**
  (typed as the interfaces), resolves the current locale, and **re-fetches on
  language change** with the Angular RokuTranslator service, passing
  already-localized data down to the `ui` components:

  ```ts
  this._i18n
    .withLocale((locale) => this._service.getList(locale))
    .pipe(takeUntilDestroyed(this._destroyRef))
    .subscribe((data) => (this.data = data));
  ```

  and/or (b) hosts a `<router-outlet>` + language selector that switches locale
  in place via `RokuLocaleStore.switchAppLocale(MY_APP_APP_KEY, lang)` (no reload
  — damoclesSword's wrapper). odontogram needs no wrapper (its CRUD feature is
  the routed component); use one when the app has sub-routes or a header switcher.
- **`usable-locales.ts`** — `MY_APP_USABLE_LOCALES`, the enabled subset,
  defaulting to `[...MY_APP_AVAILABLE_LOCALES]`; restrict here to disable a
  language.

## Step 8 — UI design

Invoke the **`design-taste-frontend`** skill for any landing/detail page or
visual component work. Read the app's `plans/` design-system section if one
exists (landingV2's `0001-overview` locks a dark / gold-accent system). Implement
to the skill's output. Icons come from `@portfolio/shared/ui` as standalone
components — reuse existing ones (`home-icon`, `save-icon`, …); if one is
missing, add it there and export it, never inline `<svg>`.

## Step 9 — Testing (jest, memory-backed)

- Copy `test-setup.ts` from an existing lib. (The newest app, landingV2, is
  **zoneless** — `setupZonelessTestEnv`; odontogram/damoclesSword use
  `setupZoneTestEnv`. Match whichever the app you scaffold from uses.)
- Every data domain's memory service gets a spec that drives it through
  `TestBed.inject(XMemory)` and asserts against the static data with
  `firstValueFrom` (see `projects-memory.spec.ts`). No backend, no HTTP mock.
- When both a memory and an API impl exist, put the shared behavior in
  `<x>-service.shared-spec.ts` as an **exported function**
  `runSharedXServiceTests(factory: () => XServiceI)` (a `describe` builder, not a
  self-running suite). Both `<x>-memory.spec.ts` and `<x>-api.spec.ts` build their
  own `TestBed` `factory()` and call it, then add impl-specific tests (memory
  reaches into the seed; api uses `provideHttpClientTesting()` +
  `HttpTestingController`, overriding `OwnApiUrlResolver.getApiUrl`). See
  odontogram's `odontogram-service.shared-spec.ts`.
- Components get standard Angular `TestBed` specs; inject data via the DI token so
  the memory impl backs them automatically. For components that read translations,
  provide `provideRokuTranslatorTesting()` / `RokuTranslatorTestingModule.forTesting()`
  from `@portfolio/localization/rokutranslator-angular`.
- Run `npx nx lint <project>` and `npx nx test <project>` for every project you
  touch; they must pass on your new files. `passWithNoTests` is on, so stubs are
  fine early.

## Step 10 — Deployment wiring (only when the app should deploy)

Mirror an existing app's `project.json`:
- a `build:docker` target (`@portfolio/docker:build`, `imageName`
  `nx-portfolio/myApp`, `forwardEnv: ['BUILDER_TAG']`, dev/prod configurations);
- `serve` / `serve-static` on your dev port, `serve` having
  `dependsOn: ['shell:serve']` (so serving the remote boots the shell too);
- production + staging entries in `k8s/helm/values.yaml` under `apps` (staging
  gated by `staging.enabled`).
CI picks up affected micro-frontends automatically (see CLAUDE.md "Docker &
CI/CD"). Remote URLs are static module federation, embedded at build time — not
runtime.

## Step 11 — Verify

1. `npx nx lint myApp <each new lib>` and `npx nx test myApp <each new lib>` pass.
2. `npx nx build myApp --configuration=development` compiles.
3. Live: `npx nx serve shell` (boots shell + dev remotes). Open
   `http://localhost:<shellPort>/en/myApp` — the shell-hosted page renders with no
   console errors. Confirm the remote's own port renders the intentional empty
   root.
4. Add / update the app's `CASE_STUDY.md` and any `plans/NNNN-*.md` (plan files
   are `NNNN-kebab-title.md`, four digits, per-directory numbering starting at
   `0001`).
5. Commit locally (`feat(myApp): scaffold ...`). **Do not push.**

## Quick reference — reference files to copy from

- App scaffold: `apps/landing-v2/{module-federation.config.ts,project.json,src/bootstrap.ts,src/app/app.config.ts,src/app/app.routes.ts,src/app/remote-entry/*}`
- Shell wiring: `apps/shell/{module-federation.config.ts,src/app/app.routes.ts}`, `tsconfig.base.json` aliases
- Lib scope: `libs/landing-v2/*` and `libs/damoclesSword/*` (+ `libs/odontogram/*` for CRUD + models-localization)
- In-memory data-access: `libs/landing-v2/data-access/src/lib/project/*`, odontogram's `*-memory.ts` / `*-api.ts` / `*-service.ts` / `*-service.shared-spec.ts`
- DI token helpers: `libs/shared/data-access` (`serviceToken`, `provideService`, `ApiConsumer`, `OwnApiUrlResolver`, `NotFoundResourceError`)
- Localization: `libs/{landing-v2,odontogram}/ui/src/lib/{*-ui-module.ts,*-locales.ts}`, `libs/shared/localization/*` (`RokuTranslatorService`, `RokuTranslatorPipe`, `provideRokuTranslator`, `RokuLocaleStore`)
- The scaffold recipe itself: `apps/landing-v2/plans/0001-overview.md` + `0002-scaffold-libs-and-wiring.md`
