# Localization (RokuTranslator)

Localize everything. `RokuTranslator` is a hand-rolled i18next wrapper, and each
app has exactly one instance of its own, created by `provideRokuTranslator`. The
shell has none. Do not add a generic npm i18n library. Copy from
`libs/landing-v2/ui` and `libs/odontogram/ui`.

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

## Register the namespace (descriptor in `ui`, composition in the app)

The library that ships the assets exports a `TranslationSource` descriptor next
to them. The loader lives there because a relative dynamic `import()` resolves
against the file it is written in:

```ts
// libs/my-app/ui/src/lib/translations.ts
import type { TranslationSource } from '@portfolio/localization/rokutranslator-angular';
import { MY_APP_AVAILABLE_LOCALES } from './my-app-locales';

export const MY_APP_UI_TRANSLATIONS: TranslationSource = {
  namespace: 'my-app',
  locales: MY_APP_AVAILABLE_LOCALES,
  loader: (locale) => import(`../../assets/i18n/${locale}.json`),
};
```

Chrome strings go in `libs/my-app/ui/assets/i18n/{en,es,...}.json`. The folder
sits beside `src`, not inside it, which is what `../../assets` reaches from
`src/lib`.

The **app** lists its sources and creates the translator, because which
libraries an app is made of is composition:

```ts
// apps/my-app/src/app/translation-providers.ts
const sources: readonly TranslationSource[] = [MY_APP_UI_TRANSLATIONS];
const defaultNamespace = MY_APP_UI_TRANSLATIONS.namespace;

export const MY_APP_TRANSLATION_PROVIDERS: (Provider | EnvironmentProviders)[] = [
  ...provideRokuTranslator({
    locales: MY_APP_AVAILABLE_LOCALES,
    defaultNamespace,
    namespaces: sources
      .map((source) => source.namespace)
      .filter((namespace) => namespace !== defaultNamespace),
    loader: composeTranslationLoader(sources),
  }),
  // Starts the loads. Not `provideAppInitializer`: under the shell this app does
  // not bootstrap.
  provideEnvironmentInitializer(() => void inject(RokuTranslatorService)),
];
```

`app-providers.ts` spreads `MY_APP_TRANSLATION_PROVIDERS`. Copy
`apps/landing-v2/src/app/translation-providers.ts`. Do not call `addNamespace`
by hand, and do not register a namespace in the `ui` NgModule.

### Optional: a `models-localization` lib for domain terms

If you keep domain-term translations in a `models-localization` lib (flat
`key → string` JSON per locale, exported as `{ en, es }`), export a second
descriptor and add it to the app's `sources` (odontogram's pattern, in
`libs/odontogram/ui/src/lib/translations.ts`):

```ts
export const MY_APP_MODELS_TRANSLATIONS: TranslationSource = {
  namespace: 'my-app/models',
  locales: MY_APP_AVAILABLE_LOCALES,
  loader: (locale) =>
    import('@portfolio/my-app/models-localization').then(
      (m) => (m as Record<string, Record<string, string>>)[locale]
    ),
};
```

## Consume translations in components

Via `@portfolio/localization/rokutranslator-angular`:
- the **impure pipe**: `{{ 'my.key' | rokuT }}` (re-translates in place on a locale
  change);
- or the service: `inject(RokuTranslatorService).t('my.key')`.

## React to runtime locale changes

The language switch is a soft, no-reload switch: it calls
`RokuLocaleStore.switchAppLocale(MY_APP_APP_KEY, lang, mountPath)`, which loads
the new language and rewrites only the locale segment after the mount. Anything that
depends on the locale must re-fetch through the RokuTranslator service's
`withLocale` operator so it re-runs on each change:

```ts
this._i18n
  .withLocale((locale) => this._service.getList(locale))
  .pipe(takeUntilDestroyed(this._destroyRef))
  .subscribe((data) => (this.data = data));
```

`takeUntilDestroyed` comes from `@angular/core/rxjs-interop`. That is fine in a
component, as here. Do not use it in a service that several remotes provide
(`CLAUDE.md`, "App-owned locale routing").

## Testing localization

Provide `provideRokuTranslatorTesting()` /
`RokuTranslatorTestingModule.forTesting()` from
`@portfolio/localization/rokutranslator-angular` in component specs that read
translations. See `references/testing.md`.
