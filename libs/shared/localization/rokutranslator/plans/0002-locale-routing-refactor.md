# 0002: Locale routing refactor (per-app locales, locale-less entry, pre-render correction)

> Supersedes Part C of [[0001-localization-refactor]] (global supported-locales union).
> The namespace scoping from 0001 (Parts A/B) is already implemented and committed;
> this plan does not touch it. Deliver the detailed design; implement only after Daniel
> approves.

## Goal

Make supported locales per app, sourced from each app's `provideRokuTranslator` /
`RokuTranslatorModule.withConfig` config, while keeping locale-first routing. Concretely:

1. **Locale-less entry redirects.** `https://domain.tld/damoclesSword` (no locale)
   redirects to `https://domain.tld/{locale}/damoclesSword`, where `{locale}` is the
   locale saved for that app, else the browser locale, else a default. `https://domain.tld`
   (root) redirects to landing at `https://domain.tld/{locale}`.
2. **Per-app remembered locale.** The selected language is stored per app (for example
   FR for damoclesSword, EN for odontogram). Moving between apps switches the active
   language to that app's stored one.
3. **Root redirect.** `/` sends to landing, which loads, reads its locales from config,
   and settles the URL + locale. (Same mechanism as point 1.)

## Locked decisions (from Daniel)

- **Keep the full page reload for a real, post-render locale switch.** A user changing
  language from the switcher reloads the page. Reason: backend / in-memory data is also
  localized, and a reload re-fetches it cleanly. Do **not** make translations reactive.
- **No reload before first render.** Choosing / correcting the locale happens during
  route activation, before any component paints. Because nothing has rendered yet, the
  pure `rokuT` pipe has not run, so the URL and locale can be set with a router
  navigation (a `UrlTree`), not a reload.
- **Only a valid locale ever reaches the URL.** If the URL carries an invalid or
  unsupported locale, it is corrected before render (no reload).
- **Per-app persisted locale.** Storage is keyed per app, not one global key.
- **Singleton `RokuTranslator` for now.** One active locale at a time is fine; only one
  app renders at a time. May change later.
- **Locales come from `provideRokuTranslator` config.** No hardcoded global list in the
  shell.

## The two-phase model (why the chicken-and-egg dissolves)

An app's locales live in its module and are only known once that module loads. But
routing never needs them *before* the app loads:

- **Phase 1 (pre-load, shell):** decide only "is the first URL segment a locale or not",
  and if a locale is missing, redirect to `/{guess}/{path}` with a best-guess locale
  (stored-for-app, else browser, else default). No app locales needed here.
- **Phase 2 (post-load, in the app's route activation):** the app's config is now
  available, so validate the URL locale against the app's real locales and correct it
  (via `UrlTree`) if unsupported. Still before the app's components render, so no reload.

A real language switch is a *third*, post-render path that keeps the reload.

## Design

### D1: distinguish "locale" from "app" in the first URL segment

Today `path: ':locale'` (`apps/shell/src/app/app.routes.ts:7`) greedily binds the first
segment, so `/damoclesSword` is read as `locale = 'damoclesSword'`. Replace the string
path with a **`UrlMatcher`** that matches the locale branch only when segment[0] is a
well-formed locale (`^[a-z]{2}(-[A-Z]{2})?$`, the same shape as
`RokuTranslator.isLocaleValid`, `rokutranslator.ts:195`). Locales are two-letter codes;
every app path (`odontogram`, `damoclesSword`, `landingV2`, and the empty landing path)
is not, so the matcher cleanly separates them. Also keep the shell's known app-path list
authoritative so a future two-letter app path could be special-cased.

Routes become, in order:

```
[
  { matcher: localeSegmentMatcher, component: LocaleWrapper, children: [ ...apps... ] },
  { path: '**', canActivate: [addLocaleRedirect] }, // no locale (incl. root): redirect
]
```

- `/en/damoclesSword` matches the matcher (`en` is a locale) and loads normally.
- `/damoclesSword`, `/damoclesSword/services`, `/` fail the matcher and hit
  `addLocaleRedirect`, which returns a `UrlTree` for `/{guess}/{originalPath}`
  (preserving remaining segments, query params, and fragment).
- `/de/damoclesSword` (well-formed but unsupported) matches the matcher, loads the app,
  and is corrected in Phase 2.

### D2: per-app locales surfaced to a pre-render guard

`provideRokuTranslator` / `withConfig` runs when the remote's wrapper component is
created (for example `DamoclesSwordWrapper` imports `DamoclesSwordUiModule`,
`libs/damoclesSword/feature-shell/src/lib/damocles-sword-wrapper/damocles-sword-wrapper.ts:6`),
which is **after** guards run. So the guard cannot read the singleton registry in time.
Instead, surface each app's locales as **route `data`** on the remote's top route, which
is loaded with the route config (during `loadChildren`) before any component is created.

Each app declares its locales **once** as a const and uses it in three places, all
inside the remote package (so it stays DRY and authoritative):

```ts
// libs/damoclesSword/.../damocles-locales.ts
export const DAMOCLES_LOCALES = ['en', 'es', 'fr'] as const;
export const DAMOCLES_DEFAULT_LOCALE = 'en';
```

1. `RokuTranslatorModule.withConfig({ locales: DAMOCLES_LOCALES, ... })`.
2. The remote's top route: `data: { supportedLocales: DAMOCLES_LOCALES, defaultLocale: DAMOCLES_DEFAULT_LOCALE }`.
3. The in-app language switcher's option list.

### D3: the pre-render correction guard (Phase 2)

A shared `localeCorrectionGuard` (new, in a shared localization/routing lib) attached to
each remote's top route (`canActivate`, or a `resolve`). It runs during that route's
activation, before the wrapper renders:

1. Read `supportedLocales` / `defaultLocale` from `route.data`.
2. Read the URL locale param from the parent (`:locale`).
3. Compute `desired`:
   - the URL locale if it is in `supportedLocales`;
   - else the app's stored locale (if still supported);
   - else the browser locale (if supported);
   - else `defaultLocale` (or `supportedLocales[0]`).
4. Ensure translations for `desired` are loaded (await the app's `loaded$` / the
   relevant `addTranslations` promise) so the first paint is already translated.
5. Persist `desired` under the app's storage key.
6. If `desired !== urlLocale`: return a `UrlTree` for `/{desired}/{restOfPath}` (router
   navigation, no reload, nothing rendered yet). Otherwise call
   `RokuTranslator.changeLocale(desired)` and allow activation.

This absorbs the validation currently in `LocaleWrapperComponent`
(`locale-wrapper-component.ts:57-72`), but now scoped to the app's own locales.

### D4: the shell redirect for missing locale (Phase 1)

`addLocaleRedirect` (guard/`CanActivate` on the fallthrough route) handles
locale-less and root URLs:

1. Take the full requested path.
2. Resolve `guess` = stored locale for the target app (derived from the first path
   segment / app map), else `RokuTranslator.getBrowserLocale()`, else a global default
   (`'en'`). No validation against the app here (app not loaded yet).
3. Return a `UrlTree` for `/{guess}/{path}` preserving query + fragment.

Phase 2's guard then corrects `guess` if the target app does not support it.

### D5: per-app locale storage

Replace the single `roku-locale` key (`rokutranslator.ts:47,190`) usage with per-app
keys, owned by the Angular routing layer (not the framework-agnostic core):

- Key scheme: `roku-locale:{appKey}` where `appKey` is the app's route path
  (`damoclesSword`, `odontogram`, `landingV2`), with the empty landing path mapped to the
  key `landing` (follow the app name; O1).
- Helpers `readAppLocale(appKey)` / `writeAppLocale(appKey, locale)` in the shared lib.
- Drop the core's generic `roku-locale` global key (O3): per-app keys plus the browser
  and default steps cover every case.

### D6: decouple navigation from the core

Today `RokuTranslator.onLocaleChange` is wired by `LocaleWrapperComponent` to rewrite the
URL via `window.location.href` (a full reload) on every `changeLocale`
(`locale-wrapper-component.ts:23-55`). That conflates the two paths. Split them:

- `RokuTranslator.changeLocale` stays framework-agnostic and performs **no navigation**.
- The **switcher** (post-render, real switch) explicitly does the reload:
  `changeLocale(locale)` + `writeAppLocale(...)` + `window.location.href = /{locale}/...`.
- The **guard** (pre-render) does `changeLocale(locale)` + returns a `UrlTree` (no
  reload).

`onLocaleChange` becomes an optional notification hook (or is removed).

### D7: shell init no longer hardcodes locales

`apps/shell/src/app/app.config.ts:10,16-21` drops `SUPPORTED_LOCALES`. `RokuTranslator.init`
runs with no `supportedLocales` (the field becomes optional / unused globally).
`getBrowserLocale` (`rokutranslator.ts:117-133`) stops requiring a global supported list;
it returns the formatted browser locale as a raw guess, and the per-app guard validates.
`getSupportedLocales()` global (`rokutranslator.ts:135-137`) is deprecated; the switcher
reads the app's locales const / route data instead.

## Migration list (call sites)

Shell:
- `apps/shell/src/app/app.routes.ts`: `:locale` string path becomes `localeSegmentMatcher`;
  add the `addLocaleRedirect` fallthrough.
- `apps/shell/src/app/locale-wrapper-component.ts`: remove the `window.location.href`
  navigation side-effect and the global validation; slim to an outlet, or retire in
  favor of the matcher + guard.
- `apps/shell/src/app/app.config.ts`: drop `SUPPORTED_LOCALES`; `init()` without it.

Core (`libs/shared/localization/rokutranslator/src/lib/rokutranslator.ts`):
- `changeLocale`: no navigation; per-app persistence moved out (or parameterized).
- `getBrowserLocale`: return browser locale without the global-supported gate.
- `onLocaleChange`: reduce to a notification hook or remove.
- `getSupportedLocales` / `supportedLocales` config: deprecate global usage.

Shared (new, in `libs/shared/localization/rokutranslator-angular`; O7):
- `localeSegmentMatcher` (UrlMatcher), `addLocaleRedirect`, `localeCorrectionGuard`,
  `readAppLocale` / `writeAppLocale`, `resolveGuessLocale`.

Each remote (damoclesSword, odontogram, landing, landing-v2):
- Add a `*-locales.ts` const; use it in `withConfig` / `provideRokuTranslator`.
- Attach `data: { supportedLocales, defaultLocale }` + `canActivate: [localeCorrectionGuard]`
  to the remote's top route (`entry.routes.ts` / feature-shell `routes.ts`).
- Switcher (for example `DamoclesSwordWrapper.changeLocale` and landing-v2's
  `language-switch`): list the app's own locales; on change, persist per-app and trigger
  the explicit reload.

## Decisions resolved

- **O1 (resolved):** the root landing app's storage key is `landing` (follow the app
  name), so `roku-locale:landing`.
- **O2 (resolved):** `defaultLocale` is an **optional** field on the app's locales
  config / route data; when omitted it falls back to `supportedLocales[0]`. This keeps
  simple apps terse while allowing an explicit default where the first-declared locale
  is not the intended default.
- **O3 (resolved):** drop the global `roku-locale` key. Resolution relies on the per-app
  key plus browser plus default (the browser step already covers a brand-new app with no
  stored locale), so a cross-app global fallback adds nothing.
- **O4 (resolved):** when the URL locale is unsupported, prefer the **last-used (stored)
  locale** for that app; if it is also unsupported or absent, fall back to the browser
  locale (if supported), then to the default. This is exactly the D3 resolution order
  (url-valid, then stored, then browser, then default), so a valid URL locale always
  wins but any correction respects the user's prior choice before the default.
- **O7 (resolved):** the shared `localeSegmentMatcher`, `addLocaleRedirect`,
  `localeCorrectionGuard`, and per-app storage helpers live in
  `libs/shared/localization/rokutranslator-angular`.

## Remaining edge cases (not blocking)

- **E1** Two-letter app path collision: only the app-path list disambiguates. Acceptable
  to rely on "no app is a 2-letter code" plus the shell's known-path list.
- **E2** Preserve query params + fragment through both redirects (required, via `UrlTree`).

## Test plan

Unit:
- `localeSegmentMatcher`: matches `en` / `en-US`, rejects `damoclesSword` / `''`.
- `localeCorrectionGuard`: supported URL locale passes; unsupported returns a `UrlTree`
  to the corrected locale; guess priority (url, stored, browser, default) resolves in
  order; query/fragment preserved.
- `addLocaleRedirect`: locale-less and root URLs redirect to `/{guess}/...`.
- Per-app persistence read/write.

e2e (Playwright, through the shell):
- `/damoclesSword` redirects to `/{locale}/damoclesSword` from stored/browser locale.
- `/` redirects to `/{locale}` (landing).
- `/de/damoclesSword` corrects to a supported locale.
- App switch (damoclesSword FR then odontogram) lands on odontogram's stored locale.
- First-load correction does not full-reload (assert no flash / single navigation);
  explicit switcher change does reload.

## Sequencing

1. Core decoupling (D6, D7): remove nav side-effect, relax `getBrowserLocale`, drop the
   hardcoded list. Ship with 0001's namespace fix already in place.
2. Shell routing (D1, D4): matcher + `addLocaleRedirect`.
3. Per-remote wiring (D2, D3, D5): locales const, route data, correction guard, per-app
   storage, switcher updates. One remote first (damoclesSword) as the reference, then the
   others.
4. Tests + e2e.

## After this refactor

Together with [[0001-localization-refactor]], this unblocks `apps/shell/CASE_STUDY.md`
question 3 (the "why hand-roll RokuTranslator" answer), which stays on hold until Daniel
rewrites it.
