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
  APP_AVAILABLE_LOCALES,
  LUNA_SHOPPER_ADMIN_UI_TRANSLATIONS,
} from '@portfolio/luna-shopper-admin/ui';

/**
 * Every library that ships translation assets, listed in the layer that already
 * knows which libraries this app is made of.
 *
 * Adding a second one is a single entry here. `ui` owns its loader because a
 * relative `import()` has to be written beside the folder it reads; what it does not
 * own is which namespaces this app has, which is composition and belongs to the
 * app's entry point.
 */
const sources: readonly TranslationSource[] = [
  LUNA_SHOPPER_ADMIN_UI_TRANSLATIONS,
];

/** The namespace a bare `| rokuT` key is looked up in. */
const defaultNamespace = LUNA_SHOPPER_ADMIN_UI_TRANSLATIONS.namespace;

/**
 * The app's translations, as providers the **app injector** installs.
 *
 * There is one `provideRokuTranslator` per app injector and it names the default
 * namespace, so it is a statement about the whole app; velista's plan 0005 D11 is
 * the account of why it belongs here rather than in a routed library.
 *
 * English is the only locale (plan 0001, section 3) and there is no locale segment
 * in the URL, so nothing switches languages and nothing routes on one. The keys are
 * still keys, because hard coding the text would cost almost nothing today and a
 * rewrite later.
 *
 * The service is **initialized** rather than injected into existence. Nothing in a
 * template injects it directly (the pipe does, but only once something renders), so
 * without this its construction time, and therefore the moment the loads start,
 * would be an accident of which component happens to render first. An environment
 * initializer runs when the app injector is created, which is what lets
 * `DocumentTitle` await `loaded$` and find something already in flight.
 */
export const LUNA_SHOPPER_ADMIN_TRANSLATION_PROVIDERS: (
  | Provider
  | EnvironmentProviders
)[] = [
  ...provideRokuTranslator({
    locales: APP_AVAILABLE_LOCALES,
    defaultNamespace,
    namespaces: sources
      .map((source) => source.namespace)
      .filter((namespace) => namespace !== defaultNamespace),
    loader: composeTranslationLoader(sources),
  }),
  provideEnvironmentInitializer(() => void inject(RokuTranslatorService)),
];
