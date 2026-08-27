import {
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import {
  composeTranslationLoader,
  provideRokuTranslator,
  RokuTranslatorService,
  type TranslationSource,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ODONTOGRAM_AVAILABLE_LOCALES,
  ODONTOGRAM_MODELS_TRANSLATIONS,
  ODONTOGRAM_UI_TRANSLATIONS,
} from '@portfolio/odontogram/ui';

/**
 * Every library that ships translation assets for odontogram.
 *
 * The dispatch between them used to be written out by hand inside
 * `odontogram-ui-module.ts`, as an `if (namespace === 'odontogram/models')`. That is
 * the shape `composeTranslationLoader` now derives from the descriptors, so adding a
 * third library is one entry here rather than another branch (plan 0005 D11).
 */
const sources: readonly TranslationSource[] = [
  ODONTOGRAM_UI_TRANSLATIONS,
  ODONTOGRAM_MODELS_TRANSLATIONS,
];

/** The namespace a bare `| rokuT` key is looked up in. */
const defaultNamespace = ODONTOGRAM_UI_TRANSLATIONS.namespace;

/**
 * The app's translations, as providers the **app injector** installs.
 *
 * In the app rather than in `ui` or `feature-shell`, because this is composition:
 * which libraries odontogram is made of is the app's fact, and the app is the only
 * place `app-providers.ts` can import from without reaching across a library
 * boundary by relative path (plan 0005 D11). Each asset owning library keeps its own
 * descriptor and its own loader, since a relative `import()` has to be written beside
 * the folder it reads.
 *
 * The environment initializer is what makes the loads *start*. Nothing injects
 * `RokuTranslatorService` directly (the pipe does, but only once something renders),
 * so without it the moment the translations begin loading would be an accident of
 * which component rendered first. `provideAppInitializer` is the wrong hook: it runs
 * once from the root injector at bootstrap, and under the shell this app is not
 * bootstrapping at all (plan 0005 D8).
 */
export const ODONTOGRAM_TRANSLATION_PROVIDERS: (
  Provider | EnvironmentProviders
)[] = [
  ...provideRokuTranslator({
    locales: ODONTOGRAM_AVAILABLE_LOCALES,
    defaultNamespace,
    namespaces: sources
      .map((source) => source.namespace)
      .filter((namespace) => namespace !== defaultNamespace),
    loader: composeTranslationLoader(sources),
  }),
  provideEnvironmentInitializer(() => void inject(RokuTranslatorService)),
];
