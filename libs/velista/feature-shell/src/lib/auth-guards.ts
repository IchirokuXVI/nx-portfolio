import { inject } from '@angular/core';
import {
  PRIMARY_OUTLET,
  Router,
  UrlSegment,
  type CanActivateFn,
  type UrlTree,
} from '@angular/router';
import { SessionStore } from '@portfolio/velista/data-access';

/**
 * Which of the two pages a visitor belongs on (plan 0007, section 2.1).
 *
 * Authentication decides **where you are**, not what a template renders. Both guards
 * return a `UrlTree` rather than `false`, so the router navigates before either
 * component is created and there is no frame of the wrong page: the same mechanism
 * `localeCorrectionGuard` already uses on the parent route. Parent guards resolve
 * first, so the locale is settled before either of these runs.
 *
 * `feature-shell` may import `@portfolio/velista/data-access`: rule D1 (plan 0004)
 * forbids that of `ui`, and this is not `ui`. `SessionStore` is provided on the app
 * injector rather than at root (rule D5, plan 0005), and a route guard resolves against
 * the route injector, which is a descendant of it, so it is visible here.
 */

/** The dashboard's path, relative to the app's mount. */
const HOME_PATH = 'home';

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
 */
export const anonymousOnlyGuard: CanActivateFn = (_route, state) => {
  if (!inject(SessionStore).isAuthenticated()) {
    return true;
  }

  return retarget(state.url, (segments) => [
    ...segments,
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
export const authenticatedGuard: CanActivateFn = (_route, state) => {
  if (inject(SessionStore).isAuthenticated()) {
    return true;
  }

  return retarget(state.url, (segments) => {
    const last = segments[segments.length - 1];
    return last !== undefined && last.path === HOME_PATH
      ? segments.slice(0, -1)
      : segments;
  });
};
