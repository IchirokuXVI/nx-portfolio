import { inject } from '@angular/core';
import {
  Router,
  type CanActivateFn,
  type CanMatchFn,
  type Route,
  type UrlSegment,
} from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { ZoneStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';

/**
 * A UUID, in the shape core actually mints them.
 *
 * Every id in the product comes from `@PrimaryGeneratedColumn('uuid')` on
 * `BaseEntity`, so this is checkable rather than agreed: no reserved word can ever
 * collide with one. The version and variant nibbles are matched loosely on purpose,
 * because what is being separated here is "an id" from "a word", not v4 from v7.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * **Rule G1 (plan 0010, section 4.1): `zones/:zoneId` matches only a UUID.**
 *
 * `0008` predicted half of this problem by name and the larger half runs the other way.
 * `zones/new` and `zones/join` are children of `''` and of `home` (rule E1), and `''`
 * is declared last. So a `zones/:zoneId` added in the obvious place, before `''`, is
 * offered the URL `/zones/new` first, matches it with `zoneId` set to the string
 * `new`, consumes every segment and wins. The create sheet becomes unreachable and the
 * person who tapped Create a group gets a group page firing `GET /v1/zones/new`.
 *
 * Reordering cannot fix it. The sheets have to stay children of the pages they cover or
 * rule E1 is gone, and `''` has to stay last or `0008`'s rule is gone. The two are not
 * in conflict: the parameterised route simply needs to be able to **decline** a URL
 * rather than be ordered around it.
 *
 * `canMatch` and not `canActivate`, and that is the whole mechanism: a false
 * `canActivate` aborts the navigation, while a false `canMatch` makes the router carry
 * on to the next route, which is exactly the fall through this needs. `/zones/new` is
 * declined, matching continues, `''` accepts it, and its child renders the sheet.
 *
 * It pays twice. `/en/velista/zones/whatever` from a mistyped link now falls through to
 * the front door instead of spending a request to be told `not_found`.
 */
export const zoneIdGuard: CanMatchFn = (
  _route: Route,
  segments: UrlSegment[]
) => {
  // `segments` is what is left after the parent consumed its own, so the id is the
  // second: `zones` then the id. Read positionally rather than from a param map,
  // because at `canMatch` time the route has not been matched and there are no params.
  return UUID.test(segments[1]?.path ?? '');
};

/**
 * The sheets over the group page, for the people who may actually use them.
 *
 * **Rule C1 (plan 0009) applied to a different kind of permission**: which person may
 * see which screen is a property of the route, where it can be tested, rather than a
 * branch in a template. Rule G2 still holds over the top of it, and this is still only
 * about what is *drawn*: core re-resolves the caller's membership on every request, so
 * a guard passing has never meant a write will be allowed.
 *
 * A zone that is not in the cache sends the caller to the group page rather than being
 * refused. That is the deep link case, and the group page is where the zone is loaded;
 * once it is there, the sheet is one tap away and the guard has an answer. Guessing
 * `true` would open a sheet over a page with no data in it, and guessing `false` would
 * make a shared link to a sheet silently do nothing.
 */
function requireRole(
  test: (role: 'OWNER' | 'ADMIN' | 'MEMBER') => boolean
): CanActivateFn {
  return (route) => {
    const zoneId = zoneIdFrom(route);
    const zone = inject(ZoneStore).zoneById(zoneId);

    if (
      zone !== undefined &&
      zone.myStatus === 'APPROVED' &&
      zone.status === 'ACTIVE' &&
      test(zone.myRole)
    ) {
      return true;
    }

    return groupPageOf(zoneId);
  };
}

/** Rename, regenerate, delete, and every row action: OWNER or ADMIN (section 5.4). */
export const zoneStaffGuard: CanActivateFn = requireRole(
  (role) => role === 'OWNER' || role === 'ADMIN'
);

/**
 * Starting a list: **any approved member**, which is deliberately not staff.
 *
 * `ListService.create` requires only `requireApproved` and makes the creator a WRITER
 * of what they made, so a guard demanding staff here would hide a control that works
 * (section 5.5).
 */
export const zoneMemberGuard: CanActivateFn = requireRole(() => true);

/**
 * The zone id out of the route the guard is attached to.
 *
 * Walked up the tree because a sheet is a child of the page that declares `:zoneId`,
 * and a confirm sheet sits three levels below it.
 */
function zoneIdFrom(route: {
  paramMap: { get(name: string): string | null };
  parent: unknown;
}): string {
  let current: typeof route | null = route;

  while (current !== null) {
    const id = current.paramMap.get('zoneId');
    if (id !== null) {
      return id;
    }
    current = current.parent as typeof route | null;
  }

  return '';
}

/**
 * Where a refused sheet sends its caller.
 *
 * Built from the locale and the app's base path rather than by string surgery on the
 * URL, so neither the locale segment nor the mount is written down here: the mount is
 * `''` in the standalone build (plan 0001, extraction contract item 5).
 */
function groupPageOf(zoneId: string) {
  const router = inject(Router);
  const locale = inject(RokuLocaleStore).locale();
  const basePath = inject(APP_BASE_PATH);

  return router.parseUrl(
    zoneId === ''
      ? appPath(locale, basePath, 'home')
      : appPath(locale, basePath, 'zones', zoneId)
  );
}
