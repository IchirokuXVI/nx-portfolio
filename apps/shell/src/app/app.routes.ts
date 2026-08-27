import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    // **Migrated (plan 0003): odontogram owns its own locale segment**, so it mounts
    // at the top level and its own guard settles the locale below `/odontogram`.
    // It sets its own document title too, which is why there is no `titleNs` here.
    path: 'odontogram',
    loadChildren: () => import('odontogram/Routes').then((m) => m.remoteRoutes),
  },
  {
    // **Migrated (plan 0003): damoclesSword owns its own locale segment**, so it
    // mounts at the top level and its own guard settles the locale below
    // `/damoclesSword`. It sets its own document title too.
    path: 'damoclesSword',
    loadChildren: () =>
      import('damoclesSword/Routes').then((m) => m.remoteRoutes),
  },
  {
    // **Migrated (plan 0003): velista owns its own locale segment**, so it mounts at
    // the top level and its own guard settles the locale below `/velista`. It sets
    // its own document title too.
    path: 'velista',
    loadChildren: () => import('velista/Routes').then((m) => m.remoteRoutes),
  },
  {
    // **Migrated (plan 0003): landingV2 owns its own locale segment.** Its mount is
    // empty, so its URLs are unchanged at `/{locale}/...`; what changed is who
    // decides, and the shell now inserts nothing on its behalf.
    //
    // **Must stay BELOW every mounted app.** An empty path route with `loadChildren`
    // is not terminal: it consumes no segments and then offers the whole path to its
    // own table, so placed above the entries for `odontogram` and the rest it would
    // swallow them and render landingV2's not found page instead. `app.routes.spec.ts`
    // asserts the order rather than leaving it to review.
    //
    // `isLocaleSegment` cannot be used to disambiguate `/en` from `/velista` here and
    // must not be reached for: a two letter app mount would be indistinguishable from
    // a locale, and the ordering rule is correct however the mounts happen to be
    // spelled today.
    path: '',
    loadChildren: () => import('landingV2/Routes').then((m) => m.remoteRoutes),
  },
];
