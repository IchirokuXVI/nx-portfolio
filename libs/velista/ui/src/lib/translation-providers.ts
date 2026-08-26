import type { Provider } from '@angular/core';
import { provideRokuTranslator } from '@portfolio/localization/rokutranslator-angular';
import { APP_AVAILABLE_LOCALES } from './app-locales';

/**
 * This app's translation namespace, as providers the **app injector** installs.
 *
 * ## Why this is not `RokuTranslatorModule.withConfig` on `AppUiModule` any more
 *
 * It used to be, imported by `AppLayout` on the stated reasoning that the parent route
 * component "passes them down to every page". A standalone component's imported
 * NgModule providers go into that component's own standalone injector, and a page
 * reached by `loadComponent` on a child route is **not** created against it: the router
 * gives a routed component the route's environment injector. So `AppLayout` could use
 * the pipe and `HomePage` could not, failing with
 * `NG0201: No provider found for RokuTranslatorService` the moment it rendered.
 *
 * That never showed up, because until plan `0005` `AppLayout` threw on `APP_BRAND`
 * first and no page below it ever rendered. Two independent provider placement bugs,
 * the second hidden behind the first.
 *
 * Providing them at the app injector puts them where `AppLayout` **and** every page
 * below it can see them, which is what the original comment intended.
 *
 * ## Why it stays in this library
 *
 * The loader is a relative dynamic import of this library's own asset folder, so it
 * has to be resolved from a file that sits next to those assets. Only the placement in
 * the injector tree changed; the ownership did not.
 */
export const VELISTA_TRANSLATION_PROVIDERS: Provider[] = provideRokuTranslator({
  locales: APP_AVAILABLE_LOCALES,
  defaultNamespace: 'velista',
  loader: (locale) => import(`../../assets/i18n/${locale}.json`),
});
