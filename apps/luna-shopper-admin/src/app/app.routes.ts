import type { Route } from '@angular/router';
import {
  requireNoSession,
  requireSession,
  SIGN_IN_PATH,
} from '@portfolio/luna-shopper-admin/data-access';
import { SignInPage } from '@portfolio/luna-shopper-admin/feature-auth';
import { DashboardPage } from '@portfolio/luna-shopper-admin/feature-dashboard';
import { harvestRoutes } from '@portfolio/luna-shopper-admin/feature-harvest';
import { adminRoutes } from '@portfolio/luna-shopper-admin/feature-resource';
import { ADMIN_RESOURCES } from './resources';

/**
 * The route table, served from this app's own origin.
 *
 * **No `:locale` segment and no `localeGuard`**, unlike every other app in this
 * workspace (plan 0001, section 3). The only thing that segment buys is a shareable
 * URL that opens in a stated language, and there is nothing here to share: one
 * operator, one browser, no links sent to anyone. The cost of carrying it is a
 * guard, a route table shaped around it, and a redirect on every cold load.
 *
 * So a path here is just a path, and the `**` inside the shell is a genuine
 * catch-all rather than the always-matching child a locale-inserting guard needs
 * underneath it.
 *
 * Two branches, and the guards on them are a pair (plan 0002): nothing renders
 * without a session, and an operator who has one has no business on the login
 * screen. Both guards answer with a *fixed* URL rather than the one they were
 * handed, because a guard that redirects to the URL it is guarding loops forever
 * with no error and a white tab, and this is exactly the pair of routes where
 * that mistake is available.
 */
export const appRoutes: Route[] = [
  {
    // Imported rather than lazy-loaded, which is a change from `0002` and is
    // forced by `0003`: the re-authentication overlay lives in this library and
    // is drawn by `AppRoot`, above every route, because covering the screen must
    // not unmount whatever is on it. A library statically imported there cannot
    // also be lazy-loaded here, and `@nx/enforce-module-boundaries` says so.
    //
    // It costs nothing worth having. The login screen is the first thing this app
    // draws, so deferring it defers the only page an unauthenticated operator can
    // see, and the overlay has to be able to appear in the same frame the session
    // ends in.
    path: SIGN_IN_PATH,
    canActivate: [requireNoSession],
    component: SignInPage,
  },
  {
    // Everything else: the chrome, one branch per resource, and a not found page
    // inside the chrome rather than instead of it (plan 0004, sections 3 and 7).
    // The guard is on this route and not on its children, so a URL under it that
    // matches nothing still reaches the login screen when there is no session,
    // rather than drawing a "no such screen" page to somebody who is not signed
    // in and cannot tell the difference.
    path: '',
    canActivate: [requireSession],
    // The resources, then the screens that are not resources (plan 0006), then
    // the screen the empty path draws (admin plan 0016). The harvester's are
    // hand written because a run is a process and a review queue is a decision,
    // and neither is a row with a form; they still sit inside this branch, so
    // the session guard covers them and the chrome draws around them exactly as
    // it does around a list.
    //
    // The third argument replaces the redirect to the first resource. `0004`
    // refused a landing page in front of the thing an operator came to change,
    // and that refusal was about an empty one: this page answers, on arrival,
    // the questions six screens otherwise answer.
    children: adminRoutes(ADMIN_RESOURCES, harvestRoutes(), DashboardPage),
  },
];
