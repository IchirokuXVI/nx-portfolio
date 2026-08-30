import { inject } from '@angular/core';
import {
  PRIMARY_OUTLET,
  Router,
  UrlSegment,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type UrlTree,
} from '@angular/router';
import { SessionStore } from '@portfolio/velista/data-access';

/**
 * Which page a visitor belongs on (plan 0007, section 2.1, and plan 0009, rule C1).
 *
 * Authentication decides **where you are**, not what a template renders. Every guard
 * here returns a `UrlTree` rather than `false`, so the router navigates before any
 * component is created and there is no frame of the wrong page: the same mechanism
 * `localeCorrectionGuard` already uses on the parent route. Parent guards resolve
 * first, so the locale is settled before any of these runs.
 *
 * `feature-shell` may import `@portfolio/velista/data-access`: rule D1 (plan 0004)
 * forbids that of `ui`, and this is not `ui`. `SessionStore` is provided on the app
 * injector rather than at root (rule D5, plan 0005), and a route guard resolves against
 * the route injector, which is a descendant of it, so it is visible here.
 */

/** The dashboard's path, relative to the app's mount. */
const HOME_PATH = 'home';

/** The segment every credential screen sits under, and the one a redirect strips. */
const AUTH_PATH = 'auth';

/**
 * Builds a sibling URL out of the one the guard was handed.
 *
 * Neither the locale segment nor the `velista` mount segment may be written down: the
 * locale varies per navigation, and extraction contract item 5 (plan 0001) forbids the
 * mount, which is `''` in the standalone build. Rewriting the parsed tree carries both
 * through untouched and needs to know nothing about either.
 */
function retarget(
  url: string,
  rewrite: (segments: UrlSegment[]) => UrlSegment[]
): UrlTree {
  const router = inject(Router);
  const tree = router.parseUrl(url);
  const primary = tree.root.children[PRIMARY_OUTLET];

  // Always present in practice: every URL that reaches these guards has at least the
  // shell's locale segment above the app. Left unchanged rather than invented if it
  // ever is not, because a redirect built out of nothing would be a guess.
  if (primary !== undefined) {
    primary.segments = rewrite(primary.segments);
  }

  return tree;
}

/**
 * The front door, for people who are not signed in.
 *
 * A signed in visitor is sent onward to the dashboard in one navigation, which is what
 * keeps `0003`'s reasoning intact: the product is launched from a phone home screen and
 * a returning user should not have to navigate past a marketing page.
 *
 * It also covers `auth/login` and `auth/register` (plan 0009, section 4.2), and on
 * register that is **rule C2 enforced at the route**: a guest who filled in the
 * register form would get a valid new account and silently lose every group on the one
 * they already had.
 */
export const anonymousOnlyGuard: CanActivateFn = (_route, state) => {
  if (!inject(SessionStore).isAuthenticated()) {
    return true;
  }

  return retarget(state.url, (segments) => [
    ...withoutAuthTail(segments),
    new UrlSegment(HOME_PATH, {}),
  ]);
};

/**
 * The dashboard, for people who are.
 *
 * This also carries what `selectHomeState`'s anonymous branch used to: a stale load
 * state from a previous session can never show a signed in shape to somebody who is not
 * signed in. It does it better, because it runs before the page's constructor and so
 * also stops a request being fired on behalf of a user who is not there.
 */
export const authenticatedGuard: CanActivateFn = (route, state) => {
  if (inject(SessionStore).isAuthenticated()) {
    return true;
  }

  // Keep the mount and the locale, drop the page. Written as "how much of the URL is
  // above this page" rather than as a suffix to remove, because the pages this guards
  // are one, two and four segments long and their sheets add more on top.
  const frontDoor = segmentsAbove(route);
  return retarget(state.url, (segments) => segments.slice(0, frontDoor));
};

/**
 * How many segments of the URL belong to whatever is **above** the guarded page.
 *
 * That is the app's front door: this app's mount, whatever it is called, plus the one
 * locale segment `localeGuard` settled. Everything after it is the page being refused.
 *
 * Counted off the route tree rather than matched in the URL, because neither half may
 * be written down here. The mount is `''` in the standalone build and `velista` under
 * the shell (extraction contract item 5, plan 0001), and the locale is whichever of
 * the supported ones this navigation carries.
 *
 * **A count, and not a suffix to strip, because this is what made the app hang.** The
 * earlier version dropped a trailing `home` and returned the URL unchanged for
 * anything else, so an anonymous visitor deep linking to a group, a members screen, a
 * list or the account page was redirected to the URL they were already on. The router
 * cancels the navigation, starts the redirect, runs this guard again, and gets the
 * same answer forever: the tab spins on a white page instead of landing on the front
 * door. `home` was the only page this guarded when it was written, and the bug arrived
 * with the second one rather than with a change here.
 */
function segmentsAbove(route: ActivatedRouteSnapshot): number {
  return route.pathFromRoot
    .slice(0, -1)
    .reduce((count, ancestor) => count + ancestor.url.length, 0);
}

/**
 * The upgrade screen, for the one person it is for and nobody else.
 *
 * **Rule C1 (plan 0009, section 4.2), and it is a safety rule rather than tidiness.**
 * `auth/upgrade` converts the caller's existing user in place and keeps their `userId`,
 * so it is the only path that keeps a guest's groups, while `auth/register` creates a
 * new user row. This guard and `anonymousOnlyGuard` are one decision taken from
 * opposite ends: whichever of the two screens a guest reaches, they end up on this one.
 *
 * Anybody else here is either anonymous, with no account to upgrade, or already
 * registered, in which case `upgrade()` refuses anyway. Neither belongs on a form that
 * cannot succeed, so each goes where the rest of the app already sends them.
 */
export const guestOnlyGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionStore);
  if (session.isGuest()) {
    return true;
  }

  const home = session.isAuthenticated();
  return retarget(state.url, (segments) => {
    const base = withoutAuthTail(segments);
    return home ? [...base, new UrlSegment(HOME_PATH, {})] : base;
  });
};

/**
 * Drops `auth/<screen>` off the end of a URL, leaving the app's own mount.
 *
 * The credential screens are two segments deep where the dashboard is one, so a
 * redirect away from one cannot be built by appending or by dropping a single segment.
 * Working from the `auth` segment rather than from a count is what keeps this correct
 * if a third screen is ever nested deeper.
 */
function withoutAuthTail(segments: UrlSegment[]): UrlSegment[] {
  const authAt = segments.findIndex((segment) => segment.path === AUTH_PATH);
  return authAt === -1 ? segments : segments.slice(0, authAt);
}
