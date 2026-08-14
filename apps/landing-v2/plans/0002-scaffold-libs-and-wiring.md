# 0001 — Scaffold `landing-v2` libraries, wire the shell, empty remote entry

> Repo-relative paths. Aliases only across lib boundaries. Commit locally only.
> Prereq: the `landingV2` app already exists (see `0000`). Do the steps in order.

## Goal
Stand up the empty-but-wired structure so `0002`–`0005` have real projects to fill:
the `libs/landing-v2/*` scope, the shell's empty-path `:locale` child repointed to
landingV2 (cutover), and the remote-entry left blank (renders only through the shell).

## 1. Generate the libraries
Use the Angular library generator (jest + eslint + scss per `nx.json` generator
defaults). Mirror the existing landing/damoclesSword lib layout.

```sh
# models (buildable-agnostic, publishable=false)
npx nx g @nx/angular:library --name=landing-v2/models \
  --directory=libs/landing-v2/models --importPath=@portfolio/landing-v2/models \
  --unitTestRunner=jest --linter=eslint --skipModule=true --standalone=true --no-interactive

npx nx g @nx/angular:library --name=landing-v2/data-access \
  --directory=libs/landing-v2/data-access --importPath=@portfolio/landing-v2/data-access \
  --unitTestRunner=jest --linter=eslint --no-interactive

npx nx g @nx/angular:library --name=landing-v2/ui \
  --directory=libs/landing-v2/ui --importPath=@portfolio/landing-v2/ui \
  --unitTestRunner=jest --linter=eslint --style=scss --no-interactive

npx nx g @nx/angular:library --name=landing-v2/feature-shell \
  --directory=libs/landing-v2/feature-shell --importPath=@portfolio/landing-v2/feature-shell \
  --unitTestRunner=jest --linter=eslint --style=scss --no-interactive
```

> The three detail-page feature libs (`feature-portfolio`, `feature-odontogram`,
> `feature-damocles`) are generated in `0004`, next to their content, to keep this
> plan focused.

After each generation, sanity-check the import path landed in `tsconfig.base.json`
and that the lib builds: `npx nx lint landing-v2/<lib>`.

### Asset-import types (do not skip)
Any leaf `tsconfig.lib.json` / `tsconfig.spec.json` that will `import('...svg?raw')`
or `import('...png')` needs `"types/**/*.d.ts"` (or the shared asset `.d.ts`) in
`include` — see the "Asset import types" memory and how `libs/landing/ui` and
`libs/damoclesSword/ui` do it. Copy that setup into `libs/landing-v2/ui` (and any
detail-page lib that imports assets) so tests + build resolve asset modules.

## 2. Remote entry stays empty (render only through shell)
Confirm `apps/landing-v2/src/app/remote-entry/entry.ts` (`RemoteEntry`) has an
**empty template with no `<router-outlet>`**, matching
`apps/landing/src/app/remote-entry/entry.ts`. Delete the generated
`remote-entry/nx-welcome.ts` and any reference to it. This is intentional (CLAUDE.md):
hitting port 4204 directly must render ~nothing; the shell supplies the outlet.

## 3. Point the remote's routes at feature-shell
Edit `apps/landing-v2/src/app/remote-entry/entry.routes.ts` to lazy-load the wrapper,
mirroring `apps/damoclesSword/src/app/remote-entry/entry.routes.ts`:

```ts
import { Route } from '@angular/router';

export const remoteRoutes: Route[] = [
  {
    path: '',
    loadChildren: () =>
      import('@portfolio/landing-v2/feature-shell').then((m) => m.LandingV2Routes),
  },
];
```

## 4. feature-shell: the routed wrapper
Mirror `libs/landing/feature-shell` (`landing-wrapper` + `routes.ts`). Create:
- `libs/landing-v2/feature-shell/src/lib/routes.ts` exporting `LandingV2Routes`:
  - `{ path: '', component: LandingV2Wrapper }` — the landing page.
  - Child routes for the detail pages are **added in `0004`** (e.g.
    `portfolio`, `odontogram`, `damoclesSword`), so the wrapper hosts a
    `<router-outlet>` OR the landing page renders at `''` and detail pages at their
    own paths — decide in `0004`; for now just the index route.
- `libs/landing-v2/feature-shell/src/lib/landing-v2-wrapper/landing-v2-wrapper.ts`
  — thin component that injects the projects + info-table services (from `0002`),
  resolves the current locale via `RokuTranslator.getLocale()`, and passes data to
  `<lib-landing-v2-ui>` (from `0003`). Model on
  `libs/landing/feature-shell/src/lib/landing-wrapper/landing-wrapper.ts`.
- Export the routes + wrapper from `libs/landing-v2/feature-shell/src/index.ts`.

## 5. Replace landing with landingV2 at the locale root (decided cutover — D2)
`apps/shell/src/app/app.routes.ts` — the generator inserted a **root-level**
`landingV2` route. Remove that top-level entry, and point the existing **empty-path**
`:locale` child at `landingV2/Routes` (replacing `landing/Routes`). landingV2 mounts at
the locale root, so its detail pages must be namespaced under `projects/` (`0004`) to
avoid colliding with the `odontogram` / `damoclesSword` sibling routes:

```ts
{
  path: ':locale',
  component: LocaleWrapperComponent,
  children: [
    { path: 'odontogram',    loadChildren: () => import('odontogram/Routes').then((m) => m.remoteRoutes) },
    { path: 'damoclesSword', loadChildren: () => import('damoclesSword/Routes').then((m) => m.remoteRoutes) },
    { path: '',              loadChildren: () => import('landingV2/Routes').then((m) => m.remoteRoutes) }, // was landing/Routes
    { path: '**', component: NotFoundComponent },
  ],
}
```

The old `landing` remote route is now gone (v1 retired from routing). Leave the
`'landing'` entry in `apps/shell/module-federation.config.ts` `remotes` and the
`libs/landing/*` code in place for now — an unrouted remote is harmless; deleting the
app/libs is a separate later cleanup. Landing page URL is now `/<locale>` (e.g. `/en`).

## 6. Verify
1. `npx nx lint landingV2 landing-v2/models landing-v2/data-access landing-v2/ui landing-v2/feature-shell`
   and `npx nx test landing-v2/feature-shell` — pass (stubs allowed to be near-empty;
   `passWithNoTests` is on).
2. `npx nx build landingV2 --configuration=development` — compiles (empty page OK).
3. Live: `npx nx serve shell` (boots the shell + dev remotes). Open
   `http://localhost:<shellport>/en` — an empty shell-hosted page renders (no errors in
   console; the real UI arrives in `0003`). Confirm port **4204** direct
   (`http://localhost:4204`) shows the intentional empty remote root.
4. Commit locally: `chore(landing-v2): scaffold libs + route landingV2 at locale root`.

## Conflict discipline
Shared files touched here are additive or generator-owned: `tsconfig.base.json`,
`apps/shell/src/app/app.routes.ts` (repoint the empty-path child), and
`apps/shell/module-federation.config.ts` (already has `landingV2`). Do not modify
`libs/landing/*` (retired but left in place) or other remotes.
