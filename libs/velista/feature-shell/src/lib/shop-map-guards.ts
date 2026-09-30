import { inject } from '@angular/core';
import {
  Router,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type CanDeactivateFn,
  type CanMatchFn,
  type Route,
  type UrlSegment,
} from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { ProfileStore, SessionStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { shopMapPath } from '@portfolio/velista/platform';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Only an account with `shopMap.record` reaches a shop's walks (velista `0122`).
 * Anybody else is sent to the shop's map, which every shopper may see.
 *
 * ## It waits for `me` when it has to
 *
 * The permission comes from `GET /v1/account/me` (backend `0175`), which the app
 * reads when its startup gate lifts. A link opened cold can reach this guard
 * first, and there is no safe way to guess: letting the page through would draw
 * a mapper's screen for somebody who may not be one, and turning them away would
 * send a mapper to the shopper's map. So an unknown answer waits for the one read
 * `ProfileStore` shares with everybody else, and a read that fails turns them
 * away, the safe direction.
 *
 * It never sends anybody to a page it guards, so it cannot loop.
 *
 * Somebody signed out is `authenticatedGuard`'s to turn away. Angular runs every
 * `canActivate` of a route at once, so this one answers true for them straight
 * away rather than reading `me` with no token, which would leave the profile
 * read failed for the sign in that follows.
 */
export const shopMapRecordGuard: CanActivateFn = async (route) => {
  if (!inject(SessionStore).isAuthenticated()) {
    return true;
  }
  const profile = inject(ProfileStore);
  const router = inject(Router);
  const locale = inject(RokuLocaleStore).locale();
  const basePath = inject(APP_BASE_PATH);

  if (profile.permissions() === null) {
    await profile.load();
  }
  if (profile.can('shopMap.record')) {
    return true;
  }
  return router.parseUrl(shopMapPath(locale, basePath, locationIdFrom(route)));
};

/**
 * A walk's pages take a uuid where the walk id goes, as the server's ids are, so
 * `walks/settings` and a sheet over the list are never read as a walk.
 * `shops`, the shop's id, `walks`, then the walk's id, read positionally: at
 * `canMatch` time there are no params.
 */
export const walkIdGuard: CanMatchFn = (
  _route: Route,
  segments: UrlSegment[]
) => UUID.test(segments[3]?.path ?? '');

function locationIdFrom(route: ActivatedRouteSnapshot): string {
  for (
    let current: ActivatedRouteSnapshot | null = route;
    current !== null;
    current = current.parent
  ) {
    const id = current.paramMap.get('locationId');
    if (id !== null) {
      return id;
    }
  }
  return '';
}

/** A page that asks before it is left with something unsent (velista `0123`). */
export interface LeavesWithUnsavedWork {
  canLeave(): boolean | Promise<boolean>;
}

/**
 * The unsaved warning on leaving a page that saves a walk (velista `0123`,
 * target 6; the `Unsaved` board). The page saves what it holds, and when the
 * save does not arrive it shows "Not saved yet" and answers with the choice.
 * The browser's own warning, for a closed tab or a reload, is the page's
 * `beforeunload`, since no route guard runs then. Velista `0126` puts the same
 * guard on its recording screen.
 */
export const unsavedWalkGuard: CanDeactivateFn<LeavesWithUnsavedWork> = (
  component
) =>
  component !== null && typeof component.canLeave === 'function'
    ? component.canLeave()
    : true;
