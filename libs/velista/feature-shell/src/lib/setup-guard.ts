import {
  effect,
  EnvironmentInjector,
  inject,
  Injectable,
  type EffectRef,
} from '@angular/core';
import {
  PRIMARY_OUTLET,
  Router,
  UrlSegment,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type UrlTree,
} from '@angular/router';
import { ProfileStore, SessionStore } from '@portfolio/velista/data-access';

/** The setup's path, relative to the app's locale. */
const SETUP_PATH = 'setup';

/**
 * What the setup guard remembers for the length of one document.
 *
 * Root scoped, and deliberately holding nothing but plain state: it injects nothing, so
 * there is no app token for it to resolve from the wrong injector (rule D5 is about
 * services that reach `APP_API_CONFIG` or a store; this reaches neither). The guard
 * injects the stores and hands them over. One document, one copy, which is exactly the
 * lifetime section 3 asks for: "the first navigation of the document only".
 */
@Injectable({ providedIn: 'root' })
export class SetupPromptMemory {
  /** The accounts this document has already sent to the setup. */
  private readonly _asked = new Set<string>();

  /** The watch on a profile still being read, if any. At most one at a time. */
  private _waiting: EffectRef | null = null;

  hasAsked(userId: string): boolean {
    return this._asked.has(userId);
  }

  markAsked(userId: string): void {
    this._asked.add(userId);
  }

  /** Replace whatever was waiting with a new watch, or with nothing. */
  wait(watch: EffectRef | null): void {
    this._waiting?.destroy();
    this._waiting = watch;
  }
}

/**
 * Walks a new account into the setup, once (velista `0098`, section 3).
 *
 * Never for somebody anonymous or a guest: a guest gives a name on the join page, and
 * the other two questions are about shopping they are not doing. Never for an account
 * whose `appState.setupCompletedAt` is set. Otherwise, **once per document** for each
 * account, the page asked for is swapped for the setup's welcome.
 *
 * ## Once, and not on every navigation
 *
 * Every exit from the setup marks it over, so the account only reaches this guard
 * unfinished when that write was lost. Asking again once per cold start is a nuisance;
 * asking on every press of Home would be a trap for somebody who just said Not now.
 *
 * "Once per document" and not "on the first navigation": a person who registers lands
 * on home by a later navigation of the same document, and that is the moment a new
 * account most needs the setup.
 *
 * ## It never asks the server, and never waits
 *
 * The answer is read from what `ProfileStore` holds. `0071`'s startup gate has already
 * waited for the backend once, and a guard that awaited a second read would leave the
 * router with nothing to render: a white screen nobody can explain.
 *
 * On a cold start the profile is not held yet, because it is read when the startup gate
 * lifts, after the first navigation has settled. So an unknown answer lets the page
 * through and leaves a watch behind: when the profile lands and says the setup is owed,
 * and the person is still on the page this guard let through, it moves them to the
 * setup, replacing that page in the history. Anywhere else, it does nothing, and the
 * next guarded navigation decides from the profile it then holds.
 */
export const setupGuard: CanActivateFn = (route, state) => {
  const session = inject(SessionStore);
  const userId = session.userId();
  if (!session.isAuthenticated() || session.isGuest() || userId === null) {
    return true;
  }

  const memory = inject(SetupPromptMemory);
  if (memory.hasAsked(userId)) {
    return true;
  }

  const router = inject(Router);
  const setup = setupTree(router, state.url, route);
  const profile = inject(ProfileStore);
  const pending = profile.setupPending();

  if (pending === false) {
    memory.wait(null);
    return true;
  }

  if (pending === true) {
    memory.wait(null);
    memory.markAsked(userId);
    return setup;
  }

  // Unknown: let the page through, and decide when the profile lands.
  const allowed = state.url;
  const watch = effect(
    () => {
      const answer = profile.setupPending();
      if (answer === null) {
        return;
      }

      memory.wait(null);
      if (
        !answer ||
        memory.hasAsked(userId) ||
        session.userId() !== userId ||
        destination(router) !== allowed
      ) {
        return;
      }

      memory.markAsked(userId);
      void router.navigateByUrl(setup, { replaceUrl: true });
    },
    { injector: inject(EnvironmentInjector), manualCleanup: true }
  );
  memory.wait(watch);

  return true;
};

/**
 * Where the router is, or is going: the navigation in flight if there is one.
 *
 * The profile can land while the navigation the guard let through is still resolving,
 * and then `router.url` is still the page before it.
 */
function destination(router: Router): string {
  const current = router.getCurrentNavigation();
  return current === null
    ? router.url
    : router.serializeUrl(current.finalUrl ?? current.extractedUrl);
}

/**
 * The setup's welcome, built out of the URL the guard was handed.
 *
 * Neither the mount nor the locale may be written down (extraction contract item 5,
 * plan 0001), so this keeps whatever is above the guarded page and replaces the rest,
 * the same way `authenticatedGuard` finds the front door.
 */
function setupTree(
  router: Router,
  url: string,
  route: ActivatedRouteSnapshot
): UrlTree {
  const tree = router.parseUrl(url);
  const primary = tree.root.children[PRIMARY_OUTLET];
  const above = route.pathFromRoot
    .slice(0, -1)
    .reduce((count, ancestor) => count + ancestor.url.length, 0);

  if (primary !== undefined) {
    primary.segments = [
      ...primary.segments.slice(0, above),
      new UrlSegment(SETUP_PATH, {}),
    ];
    // A sheet's outlet or a query on the refused page has no meaning on the setup.
    primary.children = {};
  }
  tree.queryParams = {};
  tree.fragment = null;

  return tree;
}
