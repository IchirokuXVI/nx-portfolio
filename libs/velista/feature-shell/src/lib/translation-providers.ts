import {
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import {
  provideRokuTranslator,
  RokuTranslatorService,
  type LoaderFunction,
  type TranslationSource,
} from '@portfolio/localization/rokutranslator-angular';
import {
  APP_AVAILABLE_LOCALES,
  VELISTA_UI_TRANSLATIONS,
} from '@portfolio/velista/ui';

/**
 * Every library that ships translation assets, in the layer that already knows which
 * libraries the app is made of (plan 0006, section 3).
 *
 * Adding a second one is a single entry here. `ui` owns the loader because a relative
 * `import()` has to be written beside the folder it reads; what it does not own is the
 * decision of which namespaces this app has, which is composition and belongs to the
 * app's entry point.
 */
const sources: readonly TranslationSource[] = [VELISTA_UI_TRANSLATIONS];

/** The namespace a bare `| rokuT` key is looked up in. */
const defaultNamespace = VELISTA_UI_TRANSLATIONS.namespace;

/**
 * Turns a list of descriptors into the one loader `provideRokuTranslator` takes.
 *
 * The library accepts a single loader for every namespace and passes the one it wants
 * as the second argument, so composing several libraries means dispatching on it.
 * `odontogram` already hand rolls this shape inline; what is new is that the branches
 * are derived from the descriptors instead of written out at the composition site.
 *
 * An unknown namespace falls back to the first source rather than throwing. The
 * library only ever asks for namespaces it was configured with, and those come from
 * this same list, so the fallback is unreachable in practice. It exists because the
 * alternative is a rejected promise, and a rejected loader is the one thing
 * `translations-ready.ts` would rather never see.
 *
 * Exported so the routing can be tested with fake sources rather than by loading this
 * app's real asset files, which is what makes "adding a library is one entry" an
 * assertion instead of a claim.
 */
export function composeTranslationLoader(
  from: readonly TranslationSource[]
): LoaderFunction {
  return (locale, namespace) =>
    (from.find((source) => source.namespace === namespace) ?? from[0]).loader(
      locale,
      namespace
    );
}

/**
 * The app's translations, as providers the **app injector** installs.
 *
 * ## Why they are not on `AppUiModule`
 *
 * They used to be, as `RokuTranslatorModule.withConfig`, on the reasoning that
 * `AppLayout` imports it and, as the parent route component, passes them down to every
 * page. A standalone component's imported NgModule provides that component's **own**
 * injector, and a page reached by `loadComponent` on a child route is created against
 * the route's environment injector instead, so `AppLayout` could use the `| rokuT`
 * pipe while every page below it threw `NG0201`. Plan 0005 section 3.5 has the full
 * account. The app injector is the one that really does sit above every page.
 *
 * ## Why the service is initialized rather than injected into existence
 *
 * Nothing in a template injects `RokuTranslatorService` directly (the pipe does, but
 * only once something renders), so without the initializer its construction time, and
 * therefore the moment the loads start, would be an accident of which component
 * happens to render first. An **environment** initializer runs when the injector it is
 * declared on is created, which is the app injector in both the mounted and the
 * standalone case. `app-providers.ts` already uses this for `ConnectionRecovery`, for
 * the same reason: being available is the library's business, being running is the
 * app's.
 *
 * This is what makes the ordering in section 4.2.1 hold with no timing to reason
 * about: the loads have started before any guard runs, so by the time
 * `translationsReadyResolver` waits, it is waiting on something already in flight.
 */
export const VELISTA_TRANSLATION_PROVIDERS: (
  Provider | EnvironmentProviders
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
