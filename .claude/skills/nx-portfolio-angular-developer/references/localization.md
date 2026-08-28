# Localization (RokuTranslator)

Localize everything. `RokuTranslator` is a hand-rolled i18next wrapper exported as
a **shared singleton** (initialized once in the shell, forced `singleton: true,
strictVersion: true` across module federation). Do not add a generic npm i18n
library, and do not create a second instance. Copy from `libs/landing-v2/ui` and
`libs/odontogram/ui`.

Two kinds of text, kept separate:
- **UI chrome** (labels, buttons, headings) → i18n JSON keys in the `ui` lib's
  namespace.
- **Per-record content** (project descriptions, table values) → lives
  already-translated in the data-access translation tables (see
  `references/data-access.md`), not as i18n keys. Data-access services return
  already-localized objects for the active locale.

## Locale constants (in the `ui` lib)

`libs/my-app/ui/src/lib/my-app-locales.ts`:

```ts
export const MY_APP_APP_KEY = 'my-app';               // per-app locale-storage key
export const MY_APP_AVAILABLE_LOCALES: string[] = ['en', 'es']; // what the UI CAN load
export const MY_APP_DEFAULT_LOCALE = 'en';
```

`AVAILABLE` = the locales the UI ships assets for. The **enabled** subset
(`*_USABLE_LOCALES`) is the feature-shell's call — see `references/routing-and-locale.md`.

## Register the namespace (in the `ui` lib's NgModule)

`RokuTranslatorService` registers the namespace(s) itself from this config — you do
**not** call `addNamespace` by hand:

```ts
RokuTranslatorModule.withConfig({
  locales: MY_APP_AVAILABLE_LOCALES,
  defaultNamespace: 'my-app',
  loader: (locale) => import(`../../assets/i18n/${locale}.json`),
})
```

Chrome strings go in `libs/my-app/ui/src/assets/i18n/{en,es,...}.json`.

### Optional: a `models-localization` lib for domain terms

If you keep domain-term translations in a `models-localization` lib (flat
`key → string` JSON per locale, exported as `{ en, es }`), add a second namespace
and branch the loader (odontogram's pattern):

```ts
RokuTranslatorModule.withConfig({
  locales: MY_APP_AVAILABLE_LOCALES,
  defaultNamespace: 'my-app/ui',
  namespaces: ['my-app/models'],
  loader: (locale, namespace) =>
    namespace === 'my-app/models'
      ? import('@portfolio/my-app/models-localization').then((m) => m[locale])
      : import(`../../assets/i18n/${locale}.json`),
})
```

## Consume translations in components

Via `@portfolio/localization/rokutranslator-angular`:
- the **impure pipe**: `{{ 'my.key' | rokuT }}` (re-translates in place on a locale
  change);
- or the service: `inject(RokuTranslatorService).t('my.key')`.

## React to runtime locale changes

The language switch is a soft, no-reload switch: it calls
`RokuLocaleStore.switchAppLocale(MY_APP_APP_KEY, lang)`, which loads the new
language and rewrites only the leading locale segment of the URL. Anything that
depends on the locale must re-fetch through the RokuTranslator service's
`withLocale` operator so it re-runs on each change:

```ts
this._i18n
  .withLocale((locale) => this._service.getList(locale))
  .pipe(takeUntilDestroyed(this._destroyRef))
  .subscribe((data) => (this.data = data));
```

## Testing localization

Provide `provideRokuTranslatorTesting()` /
`RokuTranslatorTestingModule.forTesting()` from
`@portfolio/localization/rokutranslator-angular` in component specs that read
translations. See `references/testing.md`.
