import { inject } from '@angular/core';
import { Route } from '@angular/router';
import {
  DAMOCLES_APP_KEY,
  DAMOCLES_DEFAULT_LOCALE,
} from '@portfolio/damoclesSword/ui';
import {
  localeGuard,
  localizedTitle,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { NotFoundComponent } from '@portfolio/shared/ui';
import { DamoclesSwordWrapper } from './damocles-sword-wrapper/damocles-sword-wrapper';
import { DAMOCLES_USABLE_LOCALES } from './usable-locales';

/**
 * `/{mount}/{locale}` — the locale is a segment of **this** app's table now, below
 * wherever the app is mounted, rather than a `:locale` route the shell owned on
 * everybody's behalf (plan 0003).
 *
 * The guard runs on the parent, so by the time anything below it renders the segment
 * after the mount is a supported canonical locale. That ordering is the contract, not
 * an optimization: the app's own pages are localized, so there is nothing it can draw
 * before the language is settled.
 *
 * The guard reads the mount from the route chain, which `entry.routes.ts` supplies,
 * so this table says nothing about where the app sits. In a standalone build the
 * mount is `''` and these same routes serve `/{locale}` with nothing here changing.
 */
export const appRoutes: Route[] = [
  {
    path: '',
    canActivate: [localeGuard],
    // This app's own title, from this app's own translator (plan 0005 D10). The
    // shell used to set it through a `titleNs` in its route data; with a translator
    // per app the shell has none to look it up in.
    title: localizedTitle('app-title'),
    // Hold activation until the strings are in. `loaded$` settles either way, so a
    // failed chunk renders the page with keys rather than never rendering at all.
    resolve: { translationsReady: () => inject(RokuTranslatorService).loaded$ },
    data: {
      appKey: DAMOCLES_APP_KEY,
      supportedLocales: DAMOCLES_USABLE_LOCALES,
      defaultLocale: DAMOCLES_DEFAULT_LOCALE,
    },
    children: [
      {
        // The locale, which this app now owns. `DamoclesSwordWrapper` (the chrome,
        // and the language selector) moves down to here so it renders *below* the
        // guard: the header shows the active language, and the guard is what settles
        // it.
        path: ':locale',
        component: DamoclesSwordWrapper,
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('@portfolio/damoclesSword/feature-home').then(
                (m) => m.DamoclesSwordFeatureHome
              ),
          },
          {
            path: 'about',
            loadComponent: () =>
              import('@portfolio/damoclesSword/feature-about').then(
                (m) => m.DamoclesSwordFeatureAbout
              ),
          },
          {
            path: 'contact',
            loadComponent: () =>
              import('@portfolio/damoclesSword/feature-contact').then(
                (m) => m.DamoclesSwordFeatureContact
              ),
          },
          {
            path: 'services',
            loadComponent: () =>
              import('@portfolio/damoclesSword/feature-services').then(
                (m) => m.DamoclesSwordFeatureServices
              ),
          },
          {
            path: '**',
            redirectTo: '',
          },
        ],
      },
      {
        /**
         * **Load bearing, and not the 404 it looks like.** The guard above only runs
         * when this parent route matches, and a parent with `children` matches only
         * if one of them matches the remainder. With `:locale` as the only child, the
         * bare mount `/damoclesSword` matched nothing here, Angular fell through to
         * the shell's routes, and this app's guard, the one whose job is to *insert*
         * the missing locale, never ran at all.
         *
         * `:locale` is a parameter, so it claims any single segment and this is only
         * reached when there is **no** segment after the mount. That is always the
         * guard's insert case, so the guard always redirects and this component never
         * actually renders. It is here to make the parent match.
         *
         * A `redirectTo` would be the obvious thing and is wrong: Angular applies
         * redirects during recognition, *before* guards, so `redirectTo: ''` would
         * bounce between this route and its own parent forever without the guard ever
         * getting a say.
         */
        path: '**',
        component: NotFoundComponent,
      },
    ],
  },
];
