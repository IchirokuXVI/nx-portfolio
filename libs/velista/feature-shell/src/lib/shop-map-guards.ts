import { inject } from '@angular/core';
import {
  Router,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type CanMatchFn,
  type Route,
  type UrlSegment,
} from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { ProfileStore } from '@portfolio/velista/data-access';
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
 */
export const shopMapRecordGuard: CanActivateFn = async (route) => {
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
