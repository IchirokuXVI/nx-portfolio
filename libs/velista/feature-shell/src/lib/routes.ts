import { type Route } from '@angular/router';
import { localeCorrectionGuard } from '@portfolio/localization/rokutranslator-angular';
import { APP_DEFAULT_LOCALE, APP_KEY, AppLayout } from '@portfolio/velista/ui';
import { anonymousOnlyGuard, authenticatedGuard } from './auth-guards';
import { VELISTA_TRANSLATION_PROVIDERS } from './translation-providers';
import { translationsReadyResolver } from './translations-ready';
import { APP_USABLE_LOCALES } from './usable-locales';

/**
 * This app's route table. The shell lazy-loads it through `velista/Routes`.
 *
 * Every page renders inside `AppLayout`, the parent route that owns the app's own
 * chrome and its theme token scope (plan 0001, the extraction contract, items 1
 * and 4). `localeCorrectionGuard` validates the shell's `:locale` segment against
 * the set this app supports and corrects the URL with a router navigation when it
 * does not match.
 *
 * The route table from plan 0001, section 6.2, is filled in as each page plan
 * lands — `zones/:zoneId`, `lists/:listId`, `join/:code`, `auth/*`, `account`,
 * `settings`. Paths keep the word `zones` even though the interface says group
 * (rule N2): the translation layer renames the word, the code never does.
 *
 * The export is named for its role, not for the product, so a rename stays a data
 * edit (rule N1); the `@portfolio/velista/feature-shell` path already scopes it.
 */
export const AppShellRoutes: Route[] = [
  {
    path: '',
    component: AppLayout,
    // The app's translations, installed on the route that owns every page rather
    // than by `app-providers.ts` (plan 0006, section 3.5 chose the latter, and it
    // cannot be done: `entry.routes.ts` lazy-loads this library, so a static import
    // of it from the app is `@nx/enforce-module-boundaries`' "static imports of
    // lazy-loaded libraries are forbidden", and it would fold this whole library
    // into the remote's entry chunk besides).
    //
    // Nothing about the plan's ownership changes, only the import site: this file
    // is still `feature-shell` composing, and the providers still land on an
    // injector that sits above every page, which is the property plan 0005 section
    // 3.5 was about. `AppUiModule` failed precisely because a standalone
    // component's imported module provides that component and not the routes below
    // it; a route's providers are the opposite, and reach every child route.
    //
    // It also makes the two run modes identical here. The mounted app and the
    // standalone bootstrap both enter through this table, so neither has to
    // remember to install these separately.
    providers: [...VELISTA_TRANSLATION_PROVIDERS],
    canActivate: [localeCorrectionGuard],
    // No page of this app is created until its strings have arrived (plan 0006,
    // section 4). On the parent, so it is decided once for the app rather than
    // repeated by every page ever added, and after the locale guard: Angular runs a
    // route's `canActivate` to completion before its `resolve`, so the locale is
    // already settled and this can only ever wait for the language it will render.
    resolve: { translationsReady: translationsReadyResolver },
    data: {
      appKey: APP_KEY,
      supportedLocales: APP_USABLE_LOCALES,
      defaultLocale: APP_DEFAULT_LOCALE,
    },
    children: [
      {
        // The front door (plans 0003 and 0007). A designed screen for somebody with
        // no account, not a signed-out fallback, which is why it sits at the mount:
        // that is the URL a home screen shortcut is installed against.
        //
        // Guarded rather than adaptive. `0003` rendered both screens from one
        // component and let a `@switch` decide, which made "a signed in user never
        // sees the front door" a fact about a template instead of a property of the
        // route. As a redirect it is checkable, and the signed in user still reaches
        // their groups in one navigation.
        path: '',
        canActivate: [anonymousOnlyGuard],
        loadComponent: () =>
          import('@portfolio/velista/feature-landing').then(
            (m) => m.LandingPage
          ),
      },
      {
        // The dashboard (plan 0003). Its guard also carries what `selectHomeState`'s
        // anonymous branch used to, and earlier: nothing here is constructed, and no
        // request is fired, on behalf of somebody who is not signed in.
        //
        // Both routes stay lazy, so the shell's initial payload carries the layout and
        // the locale guard but neither page, and a visitor downloads the one screen
        // they are actually shown. That was the split's whole point and it only starts
        // paying once there are two of them, which there now are.
        path: 'home',
        canActivate: [authenticatedGuard],
        loadComponent: () =>
          import('@portfolio/velista/feature-home').then((m) => m.HomePage),
      },
    ],
  },
];
