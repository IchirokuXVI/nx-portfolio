> **PR:** [#745](https://github.com/IchirokuXVI/nx-portfolio/pull/745)

# 0006: a browser with no supported language gets the default, and the page says its language

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". This covers three findings of
> `docs/reports/2026-10-16-velista-e2e-slot1.md`: F7.1 (blocker, a French, German, Portuguese
> or Italian browser sees raw keys on every page and cannot sign in), F7.5 (`<html lang>` is
> always `en`) and F1.1 (browser back after the landing language switch keeps the old
> language under the new URL). The first is in this library. The second belongs in
> `rokutranslator-angular`, so every app gets it. The third is a route shape that each app
> repeats, and the rule for it belongs here, next to the guard.
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0005` (one translator per app), `rokutranslator.ts` (`doInit`,
> `getBrowserLocale`, `addNamespace`, `getLocale`, `changeLocale`),
> `rokutranslator-angular/src/lib/rokutranslator-service.ts` (`init`, `registerOwnedNamespaces`),
> `rokutranslator-angular/src/lib/roku-locale-store.ts` (`publish`, `switchAppLocale`),
> `rokutranslator-angular/src/lib/locale-routing/locale-guard.ts` and `resolve-locale.ts`,
> and the NG0203 rule in `CLAUDE.md` (no `rxjs-interop` in code that each app creates).

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

An app starts with a real locale whatever the browser says, every page carries that locale
on `<html lang>`, and a history move between two locale URLs applies the locale of the URL.

### Context

- **The report's cause is one step early.** `init` from the service passes no locale
  (`rokutranslator-service.ts:116-121`), so `doInit` falls back to `getBrowserLocale()`
  (`rokutranslator.ts:151-157`), which returns `undefined` when no browser language is
  supported (`:232-247`), and i18next is started with `lng: undefined` (`:197`). i18next
  25.10 resolves that init anyway. **The abort is next:** the service chains
  `registerOwnedNamespaces()` (`rokutranslator-service.ts:122`), which calls `addNamespace`
  (`:144-146`), which calls `getLocale()` (`rokutranslator.ts:347`), which throws
  `'No locale set. Did you call init() ?'` (`:285-286`). The throw happens before any
  `addTranslations`, so no loader is ever registered. The error is swallowed by
  `.catch(() => false)` and `loaded$` emits false (`:128-135`), and velista's
  `translationsReady` resolve lets the route draw keys (`feature-shell/src/lib/routes.ts:683`).
- **That is why `/es` and `/en` by URL do not recover.** The guard calls
  `changeLocale(resolved.locale)` (`locale-guard.ts:68`), which sets the locale and calls
  `i18next.changeLanguage` (`rokutranslator.ts:304-310`), but the backend `read` finds no
  loader (`:178-181`). A reload repeats the same init. The routing side already resolves
  stored, then browser, then default (`resolve-locale.ts:51-62`); only the core library is
  wrong. The doc at `rokutranslator.ts:8` says the first supported locale is the fallback,
  and `getBrowserLocale` never implemented that.
- **The default is known only in route data** (`routes.ts:687`, `APP_DEFAULT_LOCALE = 'en'` at
  `libs/velista/ui/src/lib/app-locales.ts:20`). `provideRokuTranslator` takes none
  (`provide-rokutranslator.ts:60-70`).
- **`<html lang="en">` is hard coded in all six apps** (`apps/*/src/index.html:2`), and no
  TypeScript writes `documentElement.lang`. `RokuLocaleStore.publish`
  (`roku-locale-store.ts:79-82`) is the one place every locale change passes through: guard,
  switcher and init.
- **The landing back defect is a guard that does not re-run.** `switchAppLocale`
  (`roku-locale-store.ts:113-138`) navigates with no `replaceUrl`, which pushes an entry.
  `localeGuard` sits on the componentless `path: ''` parent (velista `routes.ts:651`, `:663`)
  and the locale is its `:locale` child (`:708`). With the default `paramsChange`, a popstate
  from `/en` to `/es` changes only the child's param, so the parent's `canActivate` does not
  run and nothing applies `es`. The same shape is at `libs/landing-v2/feature-shell/src/lib/routes.ts:34-35`,
  and damoclesSword and odontogram have the guard at the same spot (`:33` in each).

### Target state

1. `doInit` with no locale resolves to the browser locale, else to a `defaultLocale` from
   the config, else to `supportedLocales[0]`. `RokuTranslatorConfig` gains an optional
   `defaultLocale`, and `provideRokuTranslator` passes it through. Velista passes
   `APP_DEFAULT_LOCALE` in `apps/velista/src/app/translation-providers.ts`. The other apps
   fall back to their first supported locale and need no change.
2. `addNamespace` never throws for a missing locale. When `config.locale` is unset it
   registers the loader and skips the loadable filter. A later `changeLocale` then loads
   the namespaces. This is the second guard, so that no future init path can leave an app
   with no loaders.
3. `RokuLocaleStore` writes `document.documentElement.lang` on construction and in `publish`,
   through `DOCUMENT` from `@angular/core`, never through `rxjs-interop`.
4. The guarded parent route of velista carries `runGuardsAndResolvers` set so that a change
   of the locale segment re-runs `localeGuard`. Use a function that compares the locale
   segment, not `'always'`, so other param changes do not re-run it. Apply the same to
   landing-v2, damoclesSword and odontogram. `changeLocale` returns early when the locale is
   unchanged, so the re-run costs nothing.
5. The `localized-title.ts:26` doc example and the README of this library state the rule:
   the route that carries `localeGuard` must re-run it when the locale segment changes.

### Scope

- `libs/shared/localization/rokutranslator/src/lib/rokutranslator.ts` and
  `rokutranslator.spec.ts` (no test today covers an unsupported browser or init with no
  locale).
- `libs/shared/localization/rokutranslator-angular/src/lib/provide-rokutranslator.ts`,
  `rokutranslator-service.ts`, `roku-locale-store.ts`, and their specs
  (`rokutranslator-service.spec.ts`, `roku-locale-store.spec.ts`, `locale-guard.spec.ts`).
- `apps/velista/src/app/translation-providers.ts`.
- `libs/velista/feature-shell/src/lib/routes.ts` and its spec; the three other
  `feature-shell/src/lib/routes.ts` files.
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- One instance per app stays the rule (plan `0005`). Nothing here reintroduces shared
  state between apps. In the mounted mode, the last app to publish a locale wins the
  `lang` attribute, and that is the app on screen.
- No `@angular/core/rxjs-interop` in `rokutranslator-angular`.
- `strictVersion` stays absent from `module-federation.shared.ts`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change `resolveLocaleSegments`, the
  four cases of the guard, or any `supportedLocales` list.
- If the velista `routes.spec.ts` order assertions fail after adding
  `runGuardsAndResolvers`, stop and report it. The route order must not change.

### Progress evidence

- New specs, each failing before the change:
  - with `navigator.languages = ['fr-FR']` and no stored locale, init resolves to the
    default and `t('key')` returns the English text;
  - `addNamespace` before any locale registers the loader, and the next `changeLocale`
    loads it;
  - `publish('es')` sets `document.documentElement.lang` to `es`;
  - in velista's route table, a navigation from `/en` to `/es` runs `localeGuard` again.
- `npx nx run-many -t lint test -p localization/rokutranslator localization/rokutranslator-angular velista/feature-shell`
  passes. The one known always failing test of `rokutranslator-angular` ("re-renders an
  OnPush host when the load completes") is not yours.
- `npx nx build velista` passes.
- One browser check with Chromium launched with `--lang=fr-FR` on a dev slot: `/` draws
  English text, `/es` draws Spanish, and `<html lang>` follows.

## 1. Not in this plan

- A French or other new locale. The app supports what its route data lists.
- Changing `<html lang="en">` in each `index.html`. The attribute is rewritten at runtime
  before the first paint of translated text.

## 2. Choices that are mine

- **Two guards, not one.** Either change alone stops the throw. The default makes i18next
  start with a real language. The tolerant `addNamespace` makes sure no other init path can
  leave an app with no loaders again.
- **The `lang` write lives in the store, not in velista.** The store is per app and every
  change passes through `publish`, so the three other remotes get the fix for free.
- **A segment comparison, not `'always'`.** `'always'` re-runs the guard on every child
  param change, which includes every list and line id change in velista.

## What the build decided

- **`changeLocale` did not return early, so the build made it.** The brief says the re-run
  costs nothing because `changeLocale` returns early for an unchanged locale. On `d73a36b8`
  it did not: it always called `changeLanguage` and announced. With the re-run, a language
  switch would have announced twice (the switcher, then the guard) and refetched every
  locale keyed pipeline twice. It now returns early for the locale it last **announced**,
  not for `config.locale`, because `init` sets that one without announcing it, and the
  first change after init must still reach a store that read its initial value early.
- **One shared `rerunOnLocaleSegmentChange`, next to the guard.** It lives in
  `locale-guard.ts` and is exported from `rokutranslator-angular`, so the four route tables
  name one function rather than four copies. That file and the barrel are outside the
  Scope list. The function compares the first URL segment below the guarded route, which is
  the locale segment whichever child matched, the `:locale` route or the `**` one.
- **`localized-title.ts` and the README of this library** carry the rule (target state 5),
  so both were edited although Scope does not list them.
- **The default is formatted like any locale** (`formatLocale`) before `init` uses it.
- **Browser check** on velista slot 1 against backend slot 4, Chromium with
  `--lang=fr-FR`: `/` became `/en` in English, `/es` drew Spanish, `<html lang>` followed
  both, and browser back and forward after the bar's switch re-applied the locale of the URL.
