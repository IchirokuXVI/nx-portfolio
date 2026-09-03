import type { Route } from '@angular/router';

/**
 * The route table, served from this app's own origin.
 *
 * **No `:locale` segment and no `localeGuard`**, unlike every other app in this
 * workspace (plan 0001, section 3). The only thing that segment buys is a shareable
 * URL that opens in a stated language, and there is nothing here to share: one
 * operator, one browser, no links sent to anyone. The cost of carrying it is a
 * guard, a route table shaped around it, and a redirect on every cold load.
 *
 * So a path here is just a path, and the `**` below is a genuine catch-all rather
 * than the always-matching child a locale-inserting guard needs underneath it.
 */
export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./placeholder-page').then((m) => m.PlaceholderPage),
  },
  // Everything else, for now. `0004` brings the real chrome and with it a localized
  // not found page; until there is more than one route, sending an unknown URL to
  // the only page there is beats a 404 that says less.
  { path: '**', redirectTo: '' },
];
