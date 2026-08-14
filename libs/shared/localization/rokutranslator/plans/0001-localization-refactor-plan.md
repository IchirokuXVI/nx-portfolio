# Localization refactor — investigation brief

> This is a **brief for a future agent/session**, not the implementation plan itself.
> Your job when you pick this up: **inspect the whole localization architecture, then
> produce a detailed implementation plan** (steps, affected files, migration, tests,
> backwards compatibility) to fix the two problems below. Do **not** implement the fix
> yet unless Daniel asks; deliver the detailed plan first for review.

## Background

`RokuTranslator` is a hand rolled localization layer with two levels:

1. `libs/shared/localization/rokutranslator/src/lib/rokutranslator.ts`
   A framework agnostic **singleton** wrapper around i18next. It holds the current
   locale and the registered namespaces, uses a custom i18next `backend` with per
   locale, per namespace lazy loader functions, persists the locale to `localStorage`
   ('roku-locale'), and detects the browser locale. `defaultNS` is the full namespace
   array, and `addNamespace` uses `unshift` so a later namespace has higher priority.
2. `libs/shared/localization/rokutranslator-angular/src/lib/`
   The Angular adapter: `rokutranslator-service.ts` (`RokuTranslatorService`, provided
   per library, not root), `provide-rokutranslator.ts` (`provideRokuTranslator`),
   `rokutranslator-pipe.ts`, `rokutranslator-module.ts`, plus a `testing/` folder.

**Why the singleton exists (hard constraint to respect):** `RokuTranslator` must be
initialized at app startup via `provideAppInitializer`, and in this micro-frontend
setup only the **shell** (host) can run an app initializer. Remotes and libraries
cannot. So configuration currently happens once in the shell
(`apps/shell/src/app/app.config.ts`, which also hardcodes
`SUPPORTED_LOCALES = ['en','es','fr']`). Any fix must work within, or deliberately
change, this initialization constraint.

## Problem 1 — namespace leaking (translation resolution is not scoped)

`RokuTranslator.t(key)` and `RokuTranslatorService.t(key)` take only a string and do
not scope the lookup to the calling library's namespace. Because `defaultNS` is the
whole namespace array resolved in priority order, if two libraries use the same key
the translation is shared between them. This is considered a bug. Separately, the
loader registered for a namespace is **overwritten** if a second
`RokuTranslatorService` is created with a namespace already in use.

**Daniel's proposed direction (validate and expand, do not assume it is complete):**
- Give the pipe and the service `t()` method a second, optional `namespace` argument.
  When omitted, use the library's default namespace.
- Have `RokuTranslatorService.t()` build the i18next key as `namespace + ':' + key` so
  resolution targets that namespace explicitly and cannot leak into other libraries.
- Consider whether the loader overwrite on a duplicate namespace should warn, merge,
  or be prevented.

## Problem 2 — supported locales are global, should be per app

`SUPPORTED_LOCALES` is a single global list configured in the shell, but each app may
support a different set of locales.

**Daniel's proposed direction (validate and expand):**
- Ideally resolve the supported locales **dynamically** from the locales each service
  instance (or namespace) declares, instead of one hardcoded global list.
- This may require moving/duplicating `RokuTranslator` configuration out of the shell
  and into each app, which collides with the `provideAppInitializer` constraint above.
  Reconcile this: figure out how each app/lib can declare its own supported locales
  while initialization still happens once in the host. Aggregating the supported
  locales from all registered service instances is one candidate.

## What to inspect before writing the plan

- The core: `rokutranslator.ts` (`init`, `changeLocale`, `getBrowserLocale`,
  `isLocaleSupported`, `getSupportedLocales`, `addNamespace`, `addTranslations`,
  `setLocaleNamespaceLoader`, `t`).
- The Angular layer: service, `provideRokuTranslator`, the pipe, the module, and the
  `testing/` helpers.
- Consumers: `apps/shell/src/app/app.config.ts` (init + supported locales),
  `apps/shell/src/app/locale-wrapper-component.ts` (uses `isLocaleSupported` /
  `formatLocale` / `changeLocale`), and every feature lib that calls
  `provideRokuTranslator` or uses the pipe (grep the workspace).
- The existing specs so you know what behavior must not regress.

## Deliverable (what the plan you write must contain)

1. A confirmed description of current behavior for both problems, with file:line refs.
2. A concrete API design for the namespace argument on the pipe and `t()` (signatures,
   default-namespace behavior, the `namespace:key` construction, edge cases like a key
   that already contains a colon).
3. A design for per app supported locales that respects the app-initializer
   constraint, including how `isLocaleSupported`, `getBrowserLocale`, and the shell's
   `LocaleWrapperComponent` locale validation are affected.
4. A migration list: every call site that must change, and whether the change is
   backwards compatible (the namespace arg should be optional).
5. Test plan updates (unit + the `*.shared-spec.ts` style if relevant).
6. Any open questions for Daniel.

## After the refactor

This work also unblocks the case study: `apps/shell/CASE_STUDY.md` question 3 (the
RokuTranslator "why hand-roll" answer) is **on hold** and will be rewritten from
scratch by Daniel once this lands. Do not edit that answer; just flag when the
refactor is done so Daniel can revisit it.
