import {
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import {
  DAMOCLES_AVAILABLE_LOCALES,
  DAMOCLES_UI_TRANSLATIONS,
} from '@portfolio/damoclesSword/ui';
import {
  composeTranslationLoader,
  provideRokuTranslator,
  RokuTranslatorService,
  type TranslationSource,
} from '@portfolio/localization/rokutranslator-angular';

/** Every library that ships translation assets for damoclesSword. */
const sources: readonly TranslationSource[] = [DAMOCLES_UI_TRANSLATIONS];

/** The namespace a bare `| rokuT` key is looked up in. */
const defaultNamespace = DAMOCLES_UI_TRANSLATIONS.namespace;

/**
 * The app's translations, as providers the **app injector** installs.
 *
 * In the app rather than in `ui`, because this is composition: which libraries
 * damoclesSword is made of is the app's fact, and the app is the only place
 * `app-providers.ts` can import from without reaching across a library boundary by
 * relative path (plan 0005 D11).
 *
 * The environment initializer is what makes the loads *start*. Nothing injects
 * `RokuTranslatorService` directly (the pipe does, but only once something renders),
 * so without it the moment the translations begin loading would be an accident of
 * which component rendered first. `provideAppInitializer` is the wrong hook: it runs
 * once from the root injector at bootstrap, and under the shell this app is not
 * bootstrapping at all (plan 0005 D8).
 */
export const DAMOCLES_TRANSLATION_PROVIDERS: (
  Provider | EnvironmentProviders
)[] = [
  ...provideRokuTranslator({
    locales: DAMOCLES_AVAILABLE_LOCALES,
    defaultNamespace,
    namespaces: sources
      .map((source) => source.namespace)
      .filter((namespace) => namespace !== defaultNamespace),
    loader: composeTranslationLoader(sources),
  }),
  provideEnvironmentInitializer(() => void inject(RokuTranslatorService)),
];
