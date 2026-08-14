# 0001: Localization refactor (RokuTranslator namespace scoping + per-app locales)

> Detailed implementation plan produced from the earlier investigation brief.
> Two problems are addressed: (1) namespace leaking in translation resolution, and
> (2) globally hardcoded supported locales. Problem 1 is the priority and is fully
> specified. Problem 2 has a recommended design plus open questions for Daniel.
> Deliver/land Problem 1 first; Problem 2 can follow as a second commit.

## Key decision from Daniel

Scope translation resolution with i18next's **`{ ns: 'namespace' }` option**, not by
concatenating `namespace + ':' + key`. `RokuTranslator.t(key, options)` already
forwards its `options` straight to `i18next.t` (see below), so the plumbing exists;
the work is passing `{ ns }` down from the service and pipe, and making the option
authoritative in i18next config.

---

## Part A: current behavior (confirmed, with refs)

### Problem 1: resolution is not scoped to a namespace

- Core `t()` forwards options untouched:
  `libs/shared/localization/rokutranslator/src/lib/rokutranslator.ts:299`
  ```ts
  t(key: string, options?: TOptions): string {
    ...
    return this.i18nextInstance.t(key, options as ...);
  }
  ```
- i18next is created with `defaultNS` set to the **whole namespace array**:
  `rokutranslator.ts:97` (`defaultNS: this.config.namespaces`). With no `ns` in the
  call options, `i18next.t('some.key')` resolves against every namespace in priority
  order.
- Priority order is built by `unshift`, so a namespace added later outranks earlier
  ones: `addNamespace` at `rokutranslator.ts:199-213` (`this.config.namespaces.unshift(...)`).
- Net effect: if two libraries register keys with the same name, the higher priority
  namespace's value is returned for both. That is the leak.
- The Angular service passes no `ns`:
  `libs/shared/localization/rokutranslator-angular/src/lib/rokutranslator-service.ts:78`
  ```ts
  t(s: string) { return RokuTranslator.t(s); }
  ```
- The pipe passes only the key:
  `libs/shared/localization/rokutranslator-angular/src/lib/rokutranslator-pipe.ts:10`
  ```ts
  transform(key: string): string { return this._serv.t(key); }
  ```
- Secondary bug (loader overwrite): `setLocaleNamespaceLoader`
  (`rokutranslator.ts:240-248`) does `map.get(locale)?.set(namespace, loader)`, so a
  second `RokuTranslatorService` declaring an already registered namespace silently
  replaces the first loader. `addTranslations` (`rokutranslator.ts:250-279`) calls it
  unconditionally.

### Problem 2: supported locales are one global list

- Hardcoded in the shell and passed once at init:
  `apps/shell/src/app/app.config.ts:10` (`const SUPPORTED_LOCALES = ['en','es','fr'];`)
  and `:16-21` (`provideAppInitializer(() => RokuTranslator.init({ ..., supportedLocales }))`).
- `config.supportedLocales` drives `isLocaleSupported` (`rokutranslator.ts:151-167`),
  `getBrowserLocale` (`:117-133`), and `getSupportedLocales` (`:135-137`).
- Each library already declares its own locales through
  `provideRokuTranslator({ locales })` / `RokuTranslatorModule.withConfig({ locales })`
  (for example `libs/landing/ui/src/lib/landing-ui-module.ts:10` declares
  `['en','es']`), but those locales are only used to preload translations, never to
  form the supported set.
- The shell's `LocaleWrapperComponent` validates the URL's locale segment against the
  single global list (uses `isLocaleSupported` / `formatLocale` / `changeLocale`).

### Hard constraint to respect

Only the shell can run `provideAppInitializer`, so `RokuTranslator.init(...)` must stay
in the shell. Remotes and libraries cannot initialize the singleton; they can only
contribute to it after init through their DI providers when a route loads.

---

## Part B: Problem 1 design (namespace scoping via `{ ns }`)

### B.1 Make the `ns` option authoritative in i18next

In `init` (`rokutranslator.ts:92-105`), add `nsSeparator: false` to the createInstance
options. Reason: by default i18next treats a `:` inside the key string as a namespace
separator, so a key that contains a colon (or a caller who accidentally writes
`ns:key`) can still override our explicit `ns` option and leak. Keys in this codebase
use `.` as the separator (for example `'section-what-we-do.main-title'`), so disabling
`nsSeparator` is safe and makes `{ ns }` the single source of truth. Confirm no
existing key contains `:` (grep during implementation).

```ts
.createInstance({
  lng: this.config.locale,
  fallbackLng: 'en-US',
  ns: [],
  defaultNS: this.config.namespaces,
  nsSeparator: false, // {{ ns }} option is authoritative; keys never carry a namespace
  load: 'languageOnly',
  resources: {},
}, cb)
```

Keep `defaultNS` as the array so a call with no `ns` still behaves exactly as today
(backwards compatible fallback).

### B.2 Service: default to the library's namespace

`RokuTranslatorService` already knows its namespace via
`_defaultNamespace` (`rokutranslator-service.ts:27`). New signature:

```ts
t(key: string, ns?: string): string {
  return RokuTranslator.t(key, { ns: ns ?? this._defaultNamespace ?? this._namespaces[0] });
}
```

- Default resolution target is the library's own `defaultNamespace`, which stops the
  leak: a lookup only ever reads that namespace.
- Optional `ns` lets a component read a key it declared under one of its extra
  `_namespaces`, or (deliberately) from a shared namespace.
- Fallback chain: `defaultNamespace`, else first of `namespaces`, else `undefined`.
  When `undefined` is passed, i18next uses `defaultNS` (the global array) exactly as
  today, so libraries that configured only `namespaces` and no `defaultNamespace` keep
  working. Flag whether any such library exists (grep for `namespaces:` without
  `defaultNamespace:`); if one does, decide whether to require a default namespace.

### B.3 Pipe: optional namespace argument

```ts
transform(key: string, ns?: string): string {
  return this._serv.t(key, ns);
}
```

Template usage stays backwards compatible:

```html
{{ 'section-what-we-do.intro' | rokuT }}            <!-- default namespace -->
{{ 'common.save' | rokuT: 'shared' }}               <!-- explicit namespace -->
```

Do not change pipe purity in this refactor; the async load / locale change behavior is
unchanged from today (see open question O5).

### B.4 Loader overwrite on duplicate namespace

Recommended: in `addTranslations` / `setLocaleNamespaceLoader`, if a loader already
exists for the `(locale, namespace)` pair, `console.warn` and keep the first
registration rather than silently overwriting. Do not merge (merging hides real
collisions). This preserves current preload behavior while surfacing accidental
namespace reuse. Confirm the direction with Daniel (open question O2).

### B.5 Testing parity

`RokuTranslatorTestingService` (used by ~40 `.spec.ts` files via
`provideRokuTranslatorTesting`) must mirror the new `t(key, ns?)` signature so specs
compile. It can ignore `ns` and echo the key as today.

---

## Part C: Problem 2 design (per-app supported locales)

Init stays in the shell (constraint). Two options:

- **Option A: union/aggregation (recommended first step).** Each
  `RokuTranslatorService` registers its declared `_locales` into the singleton at
  construction, and `config.supportedLocales` becomes the union of everything
  registered. Add `RokuTranslator.registerSupportedLocales(locales: string[])` that
  merges (dedupes) into `config.supportedLocales`; call it from the service
  constructor. The shell keeps a small base set (or none) at init. Satisfies the
  constraint, minimal change, one behavior caveat below.
- **Option B: per-app/per-namespace resolution.** `isLocaleSupported(locale, ns?)`
  resolves against the locales declared for that namespace/service, and the shell's
  `LocaleWrapperComponent` (and each remote's locale layer) validates against the
  active app's set rather than a global list. More correct for "each app supports a
  different set", but the shell must know which app/route is active when it validates.

Caveat for Option A: because supported locales become a growing union, the shell's
initial `getBrowserLocale` / `LocaleWrapperComponent` validation runs before remotes
load, so at init the set only contains what the shell registered. `isLocaleSupported`
returns `true` for everything when the set is empty (`rokutranslator.ts:152`), so the
first navigation may accept a locale later found unsupported by the target app. Decide
whether the shell seeds a base set, and whether locale validation re-runs after a
remote registers (open question O3).

Recommendation: ship Option A to remove the hardcoded list and get per-app locales
into the union, and record Option B as a follow-up once Daniel confirms the desired
LocaleWrapper semantics (global gate vs per-route gate).

Files touched for Option A:
- `rokutranslator.ts`: add `registerSupportedLocales`; `init` no longer requires a
  hardcoded list.
- `rokutranslator-service.ts`: call `registerSupportedLocales(this._locales)` in the
  constructor.
- `apps/shell/src/app/app.config.ts`: drop or shrink `SUPPORTED_LOCALES`.
- `apps/shell/src/app/locale-wrapper-component.ts`: no signature change under Option A;
  under Option B it must scope validation per route.

---

## Part D: migration list (every call site)

Library (must change):
- `libs/shared/localization/rokutranslator/src/lib/rokutranslator.ts`: `nsSeparator:false`;
  loader overwrite warn; `registerSupportedLocales` (Problem 2).
- `libs/shared/localization/rokutranslator-angular/src/lib/rokutranslator-service.ts`:
  `t(key, ns?)`; register locales.
- `libs/shared/localization/rokutranslator-angular/src/lib/rokutranslator-pipe.ts`:
  `transform(key, ns?)`.
- `libs/shared/localization/rokutranslator-angular/src/lib/testing/rokutranslator-testing-service.ts`:
  mirror `t(key, ns?)`.
- `provide-rokutranslator.ts` / `rokutranslator-module.ts`: no signature change
  expected; verify `locales` reach registration.

Consumers (backwards compatible, no forced edit; audit only):
- Shell: `apps/shell/src/app/app.config.ts`, `apps/shell/src/app/locale-wrapper-component.ts`.
- TS call sites of `service.t(...)`: `libs/damoclesSword/ui/src/lib/section-hiring/section-hiring.ts`,
  `libs/damoclesSword/ui/src/lib/layout/layout.ts`, `libs/landing/ui/src/lib/landing/landing.ts`,
  `libs/shared/ui/src/lib/not-found/not-found.ts`,
  `libs/odontogram/ui/src/lib/tooth-treatment-detailed-form/tooth-treatment-detailed-form.ts`,
  `libs/odontogram/ui/src/lib/tooth-treatments-modal/tooth-treatments-modal.ts`,
  `libs/landing-v2/...` components. All keep the single-arg form.
- Templates using `| rokuT` across damoclesSword, landing, landing-v2, odontogram,
  shared. No change required; the `ns` argument is opt-in.

### Backwards-compatibility risk to verify

Scoping to the default namespace **fixes** the leak but changes behavior for any call
that was (knowingly or not) relying on cross-namespace fallback: a key used in library
A that actually lives only in library B's namespace will now return the raw key instead
of B's value. During implementation, grep each library's keys against its own i18n JSON
and confirm no component reads a key it does not own. Any real cross-namespace read
becomes an explicit `t(key, 'thatNamespace')` or `| rokuT: 'thatNamespace'`.

---

## Part E: test plan

Core (`rokutranslator.spec` / shared-spec):
- `t(key, { ns })` resolves only within `ns`.
- Leak test: register the same key in two namespaces with different values; each
  resolves to its own namespace; a lookup with the wrong `ns` does not return the
  other's value.
- `nsSeparator:false`: a key literally containing `:` is looked up verbatim and does
  not split into a namespace.
- Duplicate namespace loader: second registration warns and does not clobber the first.
- Problem 2: `registerSupportedLocales` unions/dedupes; `getSupportedLocales` reflects
  the union; `isLocaleSupported` honors it.

Angular:
- Service `t(key)` uses default namespace; `t(key, otherNs)` targets the override.
- Pipe `transform(key)` and `transform(key, ns)`.
- `RokuTranslatorTestingService` signature parity so the ~40 existing `.spec.ts`
  compile and pass unchanged.

Regression:
- `npx nx affected -t test lint build` (mirrors CI) after each part.

---

## Part F: sequencing

1. Part B (namespace scoping) + Part E core/angular/testing specs. Land as one commit.
2. Part C Option A (per-app locales union) + its specs. Land as a second commit.
3. Part C Option B only if Daniel confirms per-route validation semantics.

---

## Open questions for Daniel

- **O1** Any library that configures `namespaces` but no `defaultNamespace`? If so,
  require a default namespace, or keep the array fallback for it?
- **O2** Duplicate-namespace loader: warn-and-keep-first (recommended), merge, or throw?
- **O3** Supported locales semantics: global union (Option A) enough, or do you want the
  shell's `LocaleWrapperComponent` to validate per active app/route (Option B)? And
  should the shell seed a base locale set for init-time detection?
- **O4** `nsSeparator: false` acceptable given keys use `.`? (Confirm no key contains `:`.)
- **O5** Out of scope here, but flag: the pipe is pure, so it does not re-evaluate on
  async translation load or runtime locale change on its own. Leave as-is or address
  separately?

## After the refactor

Unblocks `apps/shell/CASE_STUDY.md` question 3 (the "why hand-roll RokuTranslator"
answer), which is on hold. Do not edit that answer; flag when this lands so Daniel can
rewrite it from scratch.
