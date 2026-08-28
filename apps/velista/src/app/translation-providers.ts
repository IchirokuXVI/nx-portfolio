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
  VELISTA_UI_TRANSLATIONS,
} from '@portfolio/velista/ui';

/**
 * Every library that ships translation assets, in the layer that already knows which
 * libraries the app is made of (plan 0006 section 3, moved here by plan 0005 D11).
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
 * The app's translations, as providers the **app injector** installs.
 *
 * ## Why this file is in the app rather than in `feature-shell`
 *
 * It was in `feature-shell` because plan 0006 installed these providers from the route
 * table, and the route table lives there. Plan 0005 D9 moved the providers to the app
 * injector and the file did not follow, which left `app-providers.ts` reaching into a
 * lazily loaded library by relative path, suppressing `@nx/enforce-module-boundaries`
 * to do it. The docblock below already argued for the move: which namespaces an app has
 * is composition and belongs to the app's entry point. `feature-shell` was never the
 * intended home, it was the reachable one. The suppression is gone with the import.
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
 * ## Why they are not on the route table either
 *
 * That was the next attempt, and it works for everything that renders. It does not
 * work for `gatewayInterceptor`, which injects `RokuTranslatorService` to set
 * `Accept-Language`: a functional interceptor resolves from whichever injector
 * declares `provideHttpClient`, and that is the app's, above the route. Providers on a
 * route are visible to everything below them and to nothing above, so the interceptor
 * saw no service and threw `NG0201` on every gateway request.
 *
 * So the destination is the app injector, and `app-providers.ts` spreads this array
 * there. This file still owns *what* the app's translations are; it just stopped
 * owning where they are installed.
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
 * about: the loads have started before any guard runs, so by the time the
 * `translationsReady` resolver in `routes.ts` waits, it is waiting on something
 * already in flight.
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
