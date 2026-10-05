import { inject } from '@angular/core';
import {
  Router,
  type RedirectFunction,
  type Route,
  type UrlTree,
} from '@angular/router';
import { ResourceRegistry } from '@portfolio/luna-shopper-admin/feature-resource';
import { COMPOSITE_ID_SEPARATOR } from '@portfolio/luna-shopper-admin/models';
import {
  peopleTree,
  toBasket,
  toList,
  toListOfOldLine,
  zonesTree,
} from './shopper-redirects';

/**
 * The addresses the six flat screens had, kept as redirects (admin plan 0045,
 * target 8). Admin plan 0047 deletes them.
 *
 * Users, zones, memberships, lists, list lines and shopping lists were six
 * lists under `/shoppers`. A bookmark, a link in a chat and the browser's own
 * history still hold those addresses, and each one lands where the same rows
 * are now:
 *
 * | Old address               | Goes to                                       |
 * | ------------------------- | --------------------------------------------- |
 * | `users`                   | the people                                    |
 * | `users/{id}`              | that person                                   |
 * | `memberships`, `lists`    | the zones, or the tab of the zone a `zoneId`  |
 * |                           | parameter names                               |
 * | `memberships/{id}`        | that member's form, under the zone it names   |
 * | `lists/{id}`              | that list, under the zone it reads            |
 * | `list-lines`              | the zones                                     |
 * | `list-lines/{id}`         | the list the line is on, under its zone       |
 * | `shopping-lists`          | the people, or the tab an `ownerUserId` or a  |
 * |                           | `zoneId` parameter names                      |
 * | `shopping-lists/{id}`     | that shopping list, under the owner it reads  |
 *
 * Zones kept their address, so nothing is said about them here.
 *
 * Every target is asked of the registry, so a redirect cannot point at an
 * address the route table does not have.
 *
 * **Relative to the Shoppers section**, which held the old screens: these are
 * mounted among its hand written screens.
 */
export function oldShopperAddresses(): Route[] {
  return [
    { path: 'users', pathMatch: 'full', redirectTo: () => peopleTree() },
    { path: 'users/:id', redirectTo: toPerson },
    {
      path: 'memberships',
      pathMatch: 'full',
      redirectTo: toZoneTab('memberships'),
    },
    { path: 'memberships/:id', redirectTo: toMember },
    { path: 'lists', pathMatch: 'full', redirectTo: toZoneTab('lists') },
    { path: 'lists/:id', redirectTo: toList },
    { path: 'list-lines', pathMatch: 'full', redirectTo: () => zonesTree() },
    { path: 'list-lines/:id', redirectTo: toListOfOldLine },
    { path: 'shopping-lists', pathMatch: 'full', redirectTo: toBaskets },
    { path: 'shopping-lists/:id', redirectTo: toBasket },
  ];
}

/** One person, by the id the old address carried. */
const toPerson: RedirectFunction = ({ params }) => {
  const registry = inject(ResourceRegistry);
  const path = registry.rowPath('users', params['id']);
  return path === null ? peopleTree() : inject(Router).createUrlTree([...path]);
};

/**
 * The zones, or one tab of the zone a `zoneId` parameter names: the old
 * memberships and lists screens took the zone as a filter.
 */
function toZoneTab(resource: string): RedirectFunction {
  return ({ queryParams }) => {
    const zoneId: unknown = queryParams['zoneId'];
    return typeof zoneId === 'string' && zoneId !== ''
      ? under(resource, { zoneId }, zonesTree())
      : zonesTree();
  };
}

/**
 * One member's form. The old address was the pair of the zone and the
 * membership, and the new one is the same pair under that zone.
 */
const toMember: RedirectFunction = ({ params }) => {
  const registry = inject(ResourceRegistry);
  const id: unknown = params['id'];
  const fallback = zonesTree();
  if (typeof id !== 'string') {
    return fallback;
  }

  const [zoneId] = id.split(COMPOSITE_ID_SEPARATOR);
  const path = registry.rowPath('memberships', id, { zoneId });
  return path === null ? fallback : inject(Router).createUrlTree([...path]);
};

/**
 * The people, or the Shopping lists tab of the person or the zone a parameter
 * names: the old screen took both as filters.
 */
const toBaskets: RedirectFunction = ({ queryParams }) => {
  const owner: unknown = queryParams['ownerUserId'];
  const zoneId: unknown = queryParams['zoneId'];
  const fallback = peopleTree();

  if (typeof owner === 'string' && owner !== '') {
    return under('baskets', { ownerUserId: owner }, fallback);
  }
  return typeof zoneId === 'string' && zoneId !== ''
    ? under('zone-baskets', { zoneId }, fallback)
    : fallback;
};

/** The list of a resource under the parent the address named. */
function under(
  resource: string,
  known: Readonly<Record<string, string>>,
  fallback: UrlTree
): UrlTree {
  const path = inject(ResourceRegistry).pathOf(resource, known);
  return path === null ? fallback : inject(Router).createUrlTree([...path]);
}
