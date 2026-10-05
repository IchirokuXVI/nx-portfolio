import type { Route } from '@angular/router';
import {
  recordEditRedirect,
  recordRoute,
  resourceSplitRoute,
  resourceTabRoute,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';
import { BASKETS, ZONE_BASKETS } from './baskets';
import { LIST_LINES } from './list-lines';
import { LISTS } from './lists';
import { MEMBERSHIPS } from './memberships';
import {
  EDIT_SEGMENT,
  LIST_PARAM,
  PERSON_PARAM,
  ZONE_PARAM,
} from './shopper-params';
import { toBasket, toListOfLine } from './shopper-redirects';
import { ShoppersPage } from './shoppers-page';
import { USERS } from './users';
import { ZONES } from './zones';

/**
 * The seven resources the Shoppers section holds, in the order the registry
 * names them. The section registers these and mounts none of them as a flat
 * list: {@link shoppersRoutes} is where each one is.
 *
 * The two that have no parent, the people and the zones, are the section's two
 * tabs.
 */
export const SHOPPER_RESOURCES: readonly AnyResourceDescriptor[] = [
  USERS,
  ZONES,
  MEMBERSHIPS,
  LISTS,
  LIST_LINES,
  BASKETS,
  ZONE_BASKETS,
];

/**
 * A zone holds its members and its lists (admin plan 0045).
 *
 * ```
 * /shoppers                                        goes to the people
 * /shoppers/people                                 tab: the people
 * /shoppers/people/{userId}                        goes to its details
 * /shoppers/people/{userId}/details                tab: the account, read or changed
 * /shoppers/people/{userId}/zones                  tab: the zones it is in
 * /shoppers/people/{userId}/shopping-lists         tab: what it owns
 * /shoppers/people/{userId}/shopping-lists/{id}    one shopping list, read only
 * /shoppers/people/{userId}/edit                   goes to its details, as a form
 * /shoppers/zones                                  tab: the zones
 * /shoppers/zones/{zoneId}                         goes to its members
 * /shoppers/zones/{zoneId}/members                 tab: who is in it
 * /shoppers/zones/{zoneId}/members/{id}            one member, read first
 * /shoppers/zones/{zoneId}/lists                   tab: its lists
 * /shoppers/zones/{zoneId}/lists/{listId}          one list, and its lines
 * /shoppers/zones/{zoneId}/lists/{listId}/edit     goes to the list, as a form
 * /shoppers/zones/{zoneId}/lists/{listId}/lines       goes to the list
 * /shoppers/zones/{zoneId}/lists/{listId}/lines/{id}   one line, read first
 * /shoppers/zones/{zoneId}/shopping-lists          tab: drawn from the zone
 * /shoppers/zones/{zoneId}/shopping-lists/{id}     goes to it under its owner
 * /shoppers/zones/{zoneId}/details                 tab: the zone, read or changed
 * /shoppers/zones/{zoneId}/edit                    goes to its details, as a form
 * ```
 *
 * Every segment but `details`, `zones` under a person, `edit` and the
 * parameters is a descriptor's own, so the table and the registry cannot
 * disagree about where a resource is.
 *
 * ## A person and a zone are the record page
 *
 * Both are `RecordPage` (admin plan 0057), and their tabs are the children
 * their descriptors name. The tabs that list another resource are handed over
 * whole, because a row of each opens a page that belongs with it. The old
 * address of the form of each, `edit`, leads to Details with its form open.
 *
 * ## So are a list and a shopping list
 *
 * Each is `RecordPage` with no tabs (admin plan 0058): one section, its lines
 * as a panel, and the Record block. The old address of the form of a list,
 * `edit`, leads to the list with its form open. A shopping list only reads.
 *
 * ## Why a page of a row is beside the tab and not inside it
 *
 * The page of a member, of a list and of a shopping list has its own header
 * and its way back. So it is a sibling of the page whose tab lists the rows,
 * and the router reaches it by failing the tab first: the tab is a terminal
 * route and cannot take the segment after it. `chainsRoutes` is built the
 * same way (admin plan 0042).
 *
 * ## Why the page of a row is at the empty path under its parameter
 *
 * The parameter route has no component, so a route under it inherits the
 * parameter. The page and the routes beside it are then all children of the
 * one route that names the row.
 *
 * ## Nothing here makes a row
 *
 * There is no `new` under any of these. A person, a zone, a list and a line
 * are each made in the app by somebody who will own them.
 */
export function shoppersRoutes(): Route[] {
  return [
    {
      path: '',
      component: ShoppersPage,
      children: [
        // Before the tabs. This route matches the section's own address by
        // itself, since a route with children matches a URL it has fully
        // consumed, so the redirect has to be one of its children.
        { path: '', pathMatch: 'full', redirectTo: USERS.segment },
        resourceSplitRoute(USERS, {
          // The 340 px of the mock.
          listWidth: '21.25rem',
          underHeader: true,
          emptyKey: 'people.users.choose',
          children: [
            {
              path: `:${PERSON_PARAM}`,
              children: [
                recordRoute(USERS, {
                  path: '',
                  idFrom: PERSON_PARAM,
                  tabs: { [BASKETS.name]: resourceTabRoute(BASKETS) },
                }),
                recordEditRedirect(EDIT_SEGMENT),
                // One shopping list, on the record page (admin plan 0058).
                // Its way back is one segment up, which is the tab that
                // lists what the person owns.
                recordRoute(BASKETS, { path: `${BASKETS.segment}/:id` }),
              ],
            },
          ],
        }),
        resourceSplitRoute(ZONES, {
          listWidth: '21.25rem',
          underHeader: true,
          emptyKey: 'people.zones.choose',
          children: [
            {
              path: `:${ZONE_PARAM}`,
              children: [
                recordRoute(ZONES, {
                  path: '',
                  idFrom: ZONE_PARAM,
                  tabs: {
                    [LISTS.name]: resourceTabRoute(LISTS),
                    [ZONE_BASKETS.name]: resourceTabRoute(ZONE_BASKETS),
                  },
                }),
                recordEditRedirect(EDIT_SEGMENT),
                // One member's role and name in this zone, on the record
                // page (admin plan 0053). Its way back is one segment up,
                // which is the Members tab.
                recordRoute(MEMBERSHIPS, {
                  path: `${MEMBERSHIPS.segment}/:id`,
                }),
                {
                  path: `${LISTS.segment}/:${LIST_PARAM}`,
                  children: [
                    recordRoute(LISTS, { path: '', idFrom: LIST_PARAM }),
                    recordEditRedirect(EDIT_SEGMENT),
                    {
                      // The lines are drawn on the list's own page, so their
                      // segment alone is no screen. A line's page goes back
                      // one segment up, as every record does, and lands here.
                      path: LIST_LINES.segment,
                      pathMatch: 'full',
                      redirectTo: toListOfLine,
                    },
                    recordRoute(LIST_LINES, {
                      path: `${LIST_LINES.segment}/:id`,
                    }),
                  ],
                },
                {
                  // A shopping list belongs to a person, so a row of the
                  // zone's tab opens under its owner. The row is read to find
                  // who that is.
                  path: `${ZONE_BASKETS.segment}/:id`,
                  redirectTo: toBasket,
                },
              ],
            },
          ],
        }),
      ],
    },
  ];
}
