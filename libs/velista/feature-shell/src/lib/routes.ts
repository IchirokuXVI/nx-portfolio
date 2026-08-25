import { Route } from '@angular/router';
import { localeCorrectionGuard } from '@portfolio/localization/rokutranslator-angular';
import { APP_DEFAULT_LOCALE, APP_KEY, AppLayout } from '@portfolio/velista/ui';
import { ScaffoldPlaceholder } from './scaffold-placeholder/scaffold-placeholder';
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
    canActivate: [localeCorrectionGuard],
    data: {
      appKey: APP_KEY,
      supportedLocales: APP_USABLE_LOCALES,
      defaultLocale: APP_DEFAULT_LOCALE,
    },
    children: [
      {
        // Home. Replaced by feature-home when plan 0003 is built; the placeholder
        // exists so the mount point is real and testable from day one.
        path: '',
        component: ScaffoldPlaceholder,
      },
    ],
  },
];
