import {
  effect,
  EnvironmentInjector,
  inject,
  runInInjectionContext,
  untracked,
} from '@angular/core';
import { Router, UrlTree, type ActivatedRouteSnapshot } from '@angular/router';
import { TokenStore } from '@portfolio/velista/data-access';
import { authenticatedGuard } from './auth-guards';

/**
 * Leaves a signed in page the moment the server refuses the session under it.
 *
 * `authenticatedGuard` decides where a visitor belongs, but a guard runs only on a
 * navigation. A session that ends in the middle of a page, because a refresh was
 * refused, left that page drawn with every request failing, and the visitor met the
 * guard only on their next tap, which then looked like the tap had signed them out.
 * A pair restored by Android's backup after a reinstall is the plainest way to reach
 * it: the home page renders from the restored pair, its first requests are refused,
 * and the screen stays empty.
 *
 * This runs the same guard again on the page that is open, so the redirect, the
 * `returnUrl` and the front door are the guard's and nothing here repeats them. It
 * reacts to `TokenStore.refused` only, never to a sign out somebody asked for, because
 * every such caller navigates on its own and a second navigation would race it.
 */
export function leavePageWhenSessionRefused(): void {
  const tokens = inject(TokenStore);
  const router = inject(Router);
  const injector = inject(EnvironmentInjector);
  let seen = untracked(tokens.refused);

  effect(() => {
    const refused = tokens.refused();
    if (refused === seen) {
      return;
    }
    seen = refused;

    untracked(() => {
      const state = router.routerState.snapshot;
      const guarded = guardedRoute(state.root);
      if (guarded === null) {
        return;
      }

      const verdict = runInInjectionContext(injector, () =>
        authenticatedGuard(guarded, state)
      );
      if (verdict instanceof UrlTree) {
        void router.navigateByUrl(verdict, { replaceUrl: true });
      }
    });
  });
}

/** The highest route on the open page that only a signed in visitor may see. */
function guardedRoute(
  route: ActivatedRouteSnapshot
): ActivatedRouteSnapshot | null {
  if (route.routeConfig?.canActivate?.includes(authenticatedGuard)) {
    return route;
  }

  for (const child of route.children) {
    const found = guardedRoute(child);
    if (found !== null) {
      return found;
    }
  }

  return null;
}
