import {
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import {
  LANDING_V2_AVAILABLE_LOCALES,
  LANDING_V2_UI_TRANSLATIONS,
} from '@portfolio/landing-v2/ui';
import {
  composeTranslationLoader,
  provideRokuTranslator,
  RokuTranslatorService,
  type TranslationSource,
} from '@portfolio/localization/rokutranslator-angular';

/** Every library that ships translation assets for landingV2. */
const sources: readonly TranslationSource[] = [LANDING_V2_UI_TRANSLATIONS];

/** The namespace a bare `| rokuT` key is looked up in. */
const defaultNamespace = LANDING_V2_UI_TRANSLATIONS.namespace;

/**
 * The app's translations, as providers the **app injector** installs.
 *
 * In the app rather than in `ui`, because this is composition: which libraries
 * landingV2 is made of is the app's fact, and the app is the only place
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
export const LANDING_V2_TRANSLATION_PROVIDERS: (
  Provider | EnvironmentProviders
)[] = [
  ...provideRokuTranslator({
    locales: LANDING_V2_AVAILABLE_LOCALES,
    defaultNamespace,
    namespaces: sources
      .map((source) => source.namespace)
      .filter((namespace) => namespace !== defaultNamespace),
    loader: composeTranslationLoader(sources),
  }),
  provideEnvironmentInitializer(() => void inject(RokuTranslatorService)),
];
