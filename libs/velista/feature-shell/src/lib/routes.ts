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
 * lands — `zones/:zoneId`, `lists/:listId`, `auth/*`, `account`, `settings` are
 * what is left. Paths keep the word `zones` even though the interface says group
 * (rule N2): the translation layer renames the word, the code never does.
 *
 * The export is named for its role, not for the product, so a rename stays a data
 * edit (rule N1); the `@portfolio/velista/feature-shell` path already scopes it.
 */
/**
 * The two sheets, as children of whichever page they cover (plan 0008, rule E1).
 *
 * They are routes rather than a signal toggling a template branch, and the reason
 * that decides it is the Android back button: nothing was pushed onto the history
 * stack by a signal, so back would close the **app** rather than the sheet. As routes
 * the page beneath stays mounted and keeps its scroll, and the strings `LandingPage`
 * and `HomePage` were recording in `pendingRoutes` become one `routerLink` each.
 *
 * Both pages offer both actions, so this is one function called twice rather than four
 * entries written out: the two copies must not be able to drift, and the only thing
 * that differs between them is where Cancel goes back to.
 *
 * `zones` and not the word the interface uses, per rule N2 (plan 0001).
 */
function entrySheetRoutes(returnTo: 'landing' | 'home'): Route[] {
  return [
    {
      path: 'zones/new',
      data: { returnTo },
      loadComponent: () =>
        import('@portfolio/velista/feature-entry').then(
          (m) => m.CreateGroupSheet
        ),
    },
    {
      path: 'zones/join',
      data: { returnTo },
      loadComponent: () =>
        import('@portfolio/velista/feature-entry').then((m) => m.JoinCodeSheet),
    },
  ];
}

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
    // **Every route with a non empty path comes before the `''` front door**, and a
    // spec fails the moment that stops being true (plan 0008, section 4.1.1).
    //
    // Giving the front door children turned it from a terminal route into a prefix.
    // Its path is `''`, so it consumes no segments and then offers `zones/new` to
    // whatever is left, which is the same shape `0001` section 6.1 documents in the
    // shell: an empty path route swallows the segments meant for its siblings. The
    // order makes the question moot, and it is cheaper to assert once than to test
    // every route against every other. `zones/:zoneId`, when it lands, would be
    // shadowed by `zones/new` if it were ever appended after this.
    children: [
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
        children: [...entrySheetRoutes('home')],
      },
      {
        // A cold arrival on somebody else's invite link, and the one way in that is
        // not a sheet: there is no page underneath to cover (plan 0008, section 4.1).
        // Public, because the whole point is that the recipient has no account.
        path: 'join/:code',
        loadComponent: () =>
          import('@portfolio/velista/feature-entry').then((m) => m.JoinLinkPage),
      },
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
        //
        // Last, and the only empty path here. See the note on `children` above.
        path: '',
        canActivate: [anonymousOnlyGuard],
        loadComponent: () =>
          import('@portfolio/velista/feature-landing').then(
            (m) => m.LandingPage
          ),
        children: [...entrySheetRoutes('landing')],
      },
    ],
  },
];
