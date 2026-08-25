---
name: nx-portfolio-angular-developer
description: >-
  Conventions and procedures for developing Angular in this Nx
  module-federation portfolio monorepo — creating apps/remotes and libs,
  writing in-memory data-access services behind DI tokens, localizing with
  RokuTranslator, building zoneless components, wiring locale-first routing,
  and testing. Invoke whenever writing or changing Angular code in this repo:
  a new app, a new lib, a data-access service, a localized component, routing,
  or specs. Reference implementations: odontogram, damoclesSword, landingV2.
---

# Developing Angular in nx-portfolio

Use this whenever you write or change Angular code in this monorepo. It captures
how the portfolio is built so your change matches the existing apps —
`odontogram`, `damoclesSword`, and `landingV2` (folder `apps/landing-v2`) are the
reference implementations to copy from. Open the reference file for whatever you
are doing; the sections below are the shared context that applies to all of it.

## Architecture in one screen

- **Module federation.** The **shell** (`apps/shell`) is the only host. It owns the
  `/:locale/...` router, the locale context, and the shared singletons — most
  importantly `RokuTranslator`, initialized exactly once in the shell
  (`provideAppInitializer`) and forced `singleton: true, strictVersion: true` in
  every module-federation config. Each remote exposes a single `./Routes` entry and
  is lazy-loaded at runtime by the shell via `import('<app>/Routes')`, mounted as a
  child of the shell's `:locale` route.
- **Remotes render only through the shell.** A remote's `RemoteEntry` component has
  an empty template with no `<router-outlet>`, so its own port is blank by design.
  The shell supplies the outlet, global styles, and locale. Develop and test
  through the shell URL `/<locale>/<app>`, never the remote's own port.
- **Library layout.** Under `libs/<scope>/`, scopes are `shared`, `landing-v2`,
  `damoclesSword`, `odontogram` (one scope per app, plus `shared`). Within a scope:
  `models` (types), `data-access` (services), `ui` (presentational components +
  i18n assets), `feature-shell` (the remote's route table + locale wrapper),
  `feature-*` (routed feature libs), optional `models-localization` (domain-term
  translations). Import across libs only via `@portfolio/<scope>/<lib>` aliases.

## Non-negotiables (apply to every change)

1. **Localize everything.** No hardcoded user-facing strings. UI chrome goes
   through a RokuTranslator namespace (i18n JSON keys); per-record *content*
   (descriptions, values) lives already-translated in the data-access translation
   tables. `en` is the default/fallback locale. → `references/localization.md`.
2. **Data access is an in-memory service behind a DI token.** Every data domain
   ships a `*Memory` implementation seeded from static `.ts` data, so the app runs
   and every unit test passes with **no backend**. An API implementation is
   optional and swapped in per-environment later. Inject the token (typed as the
   interface), never a concrete class. → `references/data-access.md`.
3. **Code is zoneless.** New apps and libs have no `zone.js` polyfill, use
   `setupZonelessTestEnv` in tests, and never `provideZoneChangeDetection`. Use
   **signals** for state and change detection. (The shell host is still zone-based;
   nothing new should be.) → `references/testing.md`, `references/ui-and-components.md`.
4. **All frontend UI / visual design goes through the `design-taste-frontend`
   skill.** Do not hand-roll a look — invoke that skill, then implement to it.
   → `references/ui-and-components.md`.
5. **Cross-lib imports use `@portfolio/<scope>/<lib>` aliases**, never relative
   paths across a library boundary. Run `npx nx lint <project>` and `npx nx test
   <project>` for every project you touch. **Commit locally only; never push**
   (confirm before any push even if asked before).

## What are you doing? → open the matching reference

| Task | Reference |
|------|-----------|
| Create a new app (remote) or a new lib | `references/creating-a-new-app.md` |
| Add/change a data-access service or static data | `references/data-access.md` |
| Add/change translated text or a locale | `references/localization.md` |
| Routing, the feature-shell wrapper, locale guards | `references/routing-and-locale.md` |
| Build components, icons, styling, signals | `references/ui-and-components.md` |
| Write or fix specs | `references/testing.md` |

Reference source files to copy shapes from live under `apps/{landing-v2,odontogram,shell}`
and `libs/{landing-v2,damoclesSword,odontogram,shared}/*`; each reference file names
the exact ones for its topic.
