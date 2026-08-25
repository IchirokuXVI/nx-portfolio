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

You are adding a new **remote** to an Nx Angular **module-federation** portfolio.
`odontogram`, `damoclesSword`, and `landingV2` (folder `apps/landing-v2`) are the
reference implementations — copy their shape.

## How the system fits together (read once)

The **shell** (`apps/shell`) is the only host. It owns the `/:locale/...` router,
the locale context, and the shared singletons — most importantly `RokuTranslator`,
which is initialized exactly once in the shell (`provideAppInitializer`) and forced
`singleton: true, strictVersion: true` in every module-federation config. Each
remote exposes a single `./Routes` entry and is lazy-loaded at runtime by the shell
via `import('<app>/Routes')`, mounted as a child of the shell's `:locale` route.

A remote **renders only through the shell**: its `RemoteEntry` component has an
empty template with no `<router-outlet>`, so opening the remote on its own port is
blank by design. The shell supplies the outlet, the global styles, and the locale.
Always develop and test through the shell URL (`/<locale>/<app>`), never the
remote's own port.

## Non-negotiables

1. **Localize everything.** No hardcoded user-facing strings. UI chrome goes
   through a RokuTranslator namespace (i18n JSON); per-record *content*
   (descriptions, values) lives already-translated in the data-access translation
   tables. `en` is the default/fallback locale. → `references/localization.md`.
2. **Always ship an in-memory data-access service.** Every data domain gets a
   `*Memory` implementation behind an interface + DI token, seeded from static
   `.ts` data, so the app runs and every unit test passes with **no backend**. An
   API implementation is optional and swapped in per-environment later. →
   `references/data-access.md`.
3. **New apps are zoneless.** No `zone.js` polyfill, `setupZonelessTestEnv` in
   tests, no `provideZoneChangeDetection`. (The shell host is still zone-based;
   new remotes are not.) → `references/scaffolding.md`.
4. **All frontend UI / visual design goes through the `design-taste-frontend`
   skill.** Do not hand-roll a look — invoke that skill, then implement to it.
   Icons are standalone components in `@portfolio/shared/ui`; reuse them, never
   inline `<svg>`.
5. **Commit locally only; never push** (confirm before any push even if asked
   before). Cross-lib imports use `@portfolio/<scope>/<lib>` aliases, never
   relative paths across a library boundary.

## Naming (get this right before generating)

The **nx project name, the app folder name, and the module-federation remote name
are all identical and kebab-case** — e.g. app `my-app`, folder `apps/my-app`,
remote `my-app`, e2e `apps/my-app-e2e`, Routes alias `my-app/Routes`, lib scope
`libs/my-app/*` with aliases `@portfolio/my-app/<lib>`. This is the Nx generator
default and avoids the naming/lint friction of a mismatched name.

> `landingV2` (camelCase project, `apps/landing-v2` folder) is a **legacy
> exception** — do not copy it. New apps keep name and folder the same, kebab-case.

## Procedure

Work the steps in order; open the matching reference file for the detail and the
copy-paste shapes. Ask the user (or infer and state your assumption) for: the app
name (kebab), the locales it enables (default `['en','es']`, `en` default; some
apps add `fr`), a free dev port (existing: odontogram 4202, landingV2 4204, plus
shell/landing/damoclesSword), and whether it mounts under its own path segment
(default, like odontogram/damoclesSword) or at the locale root (landingV2's
special cutover — not the default).

1. **Scaffold the app + libs and wire the shell** — generate the remote, make it
   zoneless, empty the remote entry, add the `:locale` child route, generate the
   `libs/my-app/{models,data-access,ui,feature-shell}` scope. →
   `references/scaffolding.md`
2. **Data access** — one in-memory service per domain, behind an interface + DI
   token, seeded from static data. → `references/data-access.md`
3. **Localization** — register the UI namespace, ship per-locale JSON, expose the
   AVAILABLE/USABLE/DEFAULT locale constants. → `references/localization.md`
4. **feature-shell** — the routed, locale-aware wrapper hosting the page(s) inside
   the shared layout. → `references/feature-shell.md`
5. **UI** — invoke `design-taste-frontend`, then build the presentational
   components in the `ui` lib.
6. **Testing** — zoneless jest, memory-backed specs, the shared-spec contract. →
   `references/testing.md`
7. **Deployment** (only if it should deploy) and **verify** — see the end of
   `references/scaffolding.md`.

## Verify before you call it done

`npx nx lint <project>` and `npx nx test <project>` pass for the app and every new
lib; `npx nx build my-app --configuration=development` compiles; `npx nx serve
shell` renders `/<locale>/my-app` with no console errors. Commit locally with a
`feat(my-app): ...` message. Do not push.
