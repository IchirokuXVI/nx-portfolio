---
name: nx-portfolio-angular-developer
description: >-
  Conventions and procedures for developing Angular in this Nx
  module-federation portfolio monorepo: creating apps/remotes and libs,
  writing in-memory data-access services behind DI tokens, localizing with
  RokuTranslator, building zoneless components, wiring app-owned locale
  routing, and testing. Invoke whenever writing or changing Angular code in
  this repo: a new app, a new lib, a data-access service, a localized
  component, routing, or specs. Reference implementations: damoclesSword,
  landingV2, odontogram.
---

# Developing Angular in nx-portfolio

Use this whenever you write or change Angular code in this monorepo. It captures
how the portfolio apps are built so your change matches them. `damoclesSword` and
`landingV2` (folder `apps/landing-v2`) are the reference implementations to copy
from; `odontogram` is older and still zone-based. Open the reference file for
whatever you are doing; the sections below are the shared context.

`CLAUDE.md` is the authority on architecture. Read its "Module federation
topology", "App-owned locale routing" and "Localization: RokuTranslator" sections
before you touch routing or translations. This skill adds the procedures.

## Architecture in one screen

- **Module federation.** The **shell** (`apps/shell`) is the only host. It mounts
  each remote at a top-level path (`/damoclesSword`, `/odontogram`, `/velista`,
  and `landingV2` at the empty path, last) and lazy-loads its single `./Routes`
  entry via `import('<app>/Routes')`. The shell owns no `:locale` route and no
  translator.
- **Each app owns its locale and its translator.** URLs are
  `/{mount}/{locale}/{rest}`. The app installs `localeGuard` on its own parent
  route, and `provideRokuTranslator` gives it one `RokuTranslator` of its own.
  `@portfolio/localization/rokutranslator` is shared as `singleton: true` through
  `module-federation.shared.ts` at the workspace root, without `strictVersion`.
- **The app layer is three files.** `app-providers.ts` (everything the app
  provides, spread into both run modes), `translation-providers.ts` (which
  libraries contribute translations) and `remote-entry/entry.routes.ts` (the
  providers plus `data.mountPath`, which is what the shell loads).
- **Remotes render only through the shell.** A remote's `RemoteEntry` component has
  an empty template with no `<router-outlet>`, so its own port is blank by design.
  Develop and test through the shell URL `/<app>/<locale>`. velista is the one
  exception: it is also a standalone app and renders on its own port.
- **Library layout.** Under `libs/<scope>/`, the portfolio scopes are `shared`,
  `landing-v2`, `damoclesSword`, `odontogram` and `velista`. Within a scope:
  `models` (types), `data-access` (services), `ui` (presentational components +
  i18n assets), `feature-shell` (the app's route table + locale wrapper),
  `feature-*` (routed feature libs), optional `models-localization` (domain-term
  translations). Import across libs only via `@portfolio/<scope>/<lib>` aliases.
- **velista and `luna-shopper-admin` talk to the Luna backend.** They follow the
  same routing and localization rules, but their data access, sheets and
  navigation rules live in `CLAUDE.md` and in their own `plans/` directories.

## Rules for every change

1. **Localize everything.** No hardcoded user-facing strings. UI chrome goes
   through a RokuTranslator namespace (i18n JSON keys); per-record *content*
   (descriptions, values) lives already-translated in the data-access translation
   tables. `en` is the default/fallback locale. → `references/localization.md`.
2. **Data access is an in-memory service behind a DI token.** Every data domain
   ships a `*Memory` implementation seeded from static `.ts` data, so the app runs
   and every unit test passes with **no backend**. An API implementation is
   optional and swapped in per-environment later. Inject the token (typed as the
   interface), never a concrete class. → `references/data-access.md`.
3. **New code is zoneless.** New apps and libs have no `zone.js` polyfill, use
   `setupZonelessTestEnv` in tests, and never `provideZoneChangeDetection`. Use
   **signals** for state and change detection. (`shell`, `odontogram` and the
   older libraries under `landing-v2`, `damoclesSword`, `odontogram` and `shared`
   are still zone-based; do not copy that.) → `references/testing.md`,
   `references/ui-and-components.md`.
4. **Nothing created per app may use `@angular/core/rxjs-interop`** in a service
   that several remotes provide. Module federation does not dedupe it, and the
   result is an `NG0203` with a correct DI graph. `CLAUDE.md` explains why.
5. **Frontend UI and visual design go through the `design-taste-frontend`
   skill.** Invoke that skill, then implement to it in Angular and SCSS.
   → `references/ui-and-components.md`.
6. **Cross-lib imports use `@portfolio/<scope>/<lib>` aliases**, never relative
   paths across a library boundary. Run `npx nx lint <project>` and `npx nx test
   <project>` for every project you touch. Finish as `CLAUDE.md` "Git workflow"
   says.

## What are you doing? → open the matching reference

| Task | Reference |
|------|-----------|
| Create a new app (remote) or a new lib | `references/creating-a-new-app.md` |
| Add/change a data-access service or static data | `references/data-access.md` |
| Add/change translated text or a locale | `references/localization.md` |
| Routing, the feature-shell wrapper, the locale guard | `references/routing-and-locale.md` |
| Build components, icons, styling, signals | `references/ui-and-components.md` |
| Write or fix specs | `references/testing.md` |

Reference source files to copy shapes from live under
`apps/{landing-v2,damoclesSword,shell}` and
`libs/{landing-v2,damoclesSword,odontogram,shared}/*`; each reference file names
the exact ones for its topic.
