import { inject } from '@angular/core';
import { Route } from '@angular/router';
import {
  localeGuard,
  localizedTitle,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { OdontogramFeatureFullOdontogramCrud } from '@portfolio/odontogram/feature-full-odontogram-crud';
import {
  ODONTOGRAM_APP_KEY,
  ODONTOGRAM_DEFAULT_LOCALE,
} from '@portfolio/odontogram/ui';
import { NotFoundComponent } from '@portfolio/shared/ui';
import { ODONTOGRAM_USABLE_LOCALES } from './usable-locales';

/**
 * `/{mount}/{locale}` — the locale is a segment of **this** app's table now, below
 * wherever the app is mounted, rather than a `:locale` route the shell owned on
 * everybody's behalf (plan 0003).
 *
 * The guard runs on the parent, so by the time anything below it renders the segment
 * after the mount is a supported canonical locale. That ordering is the contract, not
 * an optimization: this app's own not found page is localized, so there is no page it
 * can draw, not even a failure, before the language is settled.
 *
 * The guard reads the mount from `APP_MOUNT_PATH`, which `app-providers.ts` supplies,
 * so this table says nothing about where the app sits. In a standalone build the
 * mount is `''` and these same routes serve `/{locale}` with nothing here changing.
 */
export const appRoutes: Route[] = [
  {
    path: '',
    canActivate: [localeGuard],
    // This app's own title, from this app's own translator (plan 0005 D10). The
    // shell used to set it, through a `titleNs` in its route data naming odontogram's
    // namespace; with a translator per app the shell has none to look it up in.
    title: localizedTitle('app-title'),
    // Hold activation until the strings are in. `loaded$` settles either way, so a
    // failed chunk renders the page with keys rather than never rendering at all.
    resolve: { translationsReady: () => inject(RokuTranslatorService).loaded$ },
    data: {
      appKey: ODONTOGRAM_APP_KEY,
      supportedLocales: ODONTOGRAM_USABLE_LOCALES,
      defaultLocale: ODONTOGRAM_DEFAULT_LOCALE,
    },
    children: [
      {
        path: ':locale',
        component: OdontogramFeatureFullOdontogramCrud,
      },
      {
        /**
         * **Load bearing, and not merely a 404.** The guard above only runs when this
         * parent route matches, and a parent with `children` matches only if one of
         * them matches the remainder. With `:locale` as the only child, any URL
         * without a locale segment failed to match the whole branch, Angular fell
         * through to the shell's routes, and the app's own guard, the one whose job
         * is to *insert* the missing locale, never ran at all. `/odontogram` came out
         * as `/en/odontogram`, locale first, exactly what this plan removes.
         *
         * So the app claims every path below its mount, and the guard settles the
         * locale for all of them. Anything still here afterwards carries a supported
         * canonical locale and simply is not a route, which is the app's own 404,
         * drawn in a language the visitor can read.
         */
        path: '**',
        component: NotFoundComponent,
      },
    ],
  },
];
