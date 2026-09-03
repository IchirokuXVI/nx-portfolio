import type { Route } from '@angular/router';
import {
  requireNoSession,
  requireSession,
  SIGN_IN_PATH,
} from '@portfolio/luna-shopper-admin/data-access';

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
 *
 * Two routes, and the guards on them are a pair (plan 0002): nothing renders
 * without a session, and an operator who has one has no business on the login
 * screen. Both guards answer with a *fixed* URL rather than the one they were
 * handed, because a guard that redirects to the URL it is guarding loops forever
 * with no error and a white tab, and this is exactly the pair of routes where
 * that mistake is available.
 */
export const appRoutes: Route[] = [
  {
    path: SIGN_IN_PATH,
    canActivate: [requireNoSession],
    loadComponent: () =>
      import('@portfolio/luna-shopper-admin/feature-auth').then(
        (m) => m.SignInPage
      ),
  },
  {
    path: '',
    canActivate: [requireSession],
    loadComponent: () =>
      import('./placeholder-page').then((m) => m.PlaceholderPage),
  },
  // Everything else, for now. `0004` brings the real chrome and with it a localized
  // not found page; until there is more than one route, sending an unknown URL to
  // the only page there is beats a 404 that says less. It lands on the guarded
  // route, so an unknown URL from a signed out operator still reaches the login
  // screen rather than a page they cannot see.
  { path: '**', redirectTo: '' },
];
