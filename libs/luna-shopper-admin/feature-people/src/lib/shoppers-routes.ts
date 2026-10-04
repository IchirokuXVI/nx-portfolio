import type { Route } from '@angular/router';
import {
  RESOURCE_DESCRIPTOR,
  RESOURCE_FORM_MODE,
  RESOURCE_ID_FROM,
  ResourceFormPage,
  resourceSplitRoute,
  resourceTabRoute,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';
import { BasketPage } from './basket-page';
import { BASKETS, ZONE_BASKETS } from './baskets';
import { LIST_LINES } from './list-lines';
import { ListPage } from './list-page';
import { LISTS } from './lists';
import { MEMBERSHIPS } from './memberships';
import { PersonPage } from './person-page';
import { PersonDetailsTab, PersonZonesTab } from './person-tabs';
import {
  BASKET_PARAM,
  DETAILS_TAB,
  EDIT_SEGMENT,
  LIST_PARAM,
  PERSON_PARAM,
  PERSON_ZONES_TAB,
  ZONE_PARAM,
} from './shopper-params';
import { toBasket, toListOfLine } from './shopper-redirects';
import { ShoppersPage } from './shoppers-page';
import { USERS } from './users';
import { ZoneDetailsTab } from './zone-details-tab';
import { ZoneMembersTab } from './zone-members-tab';
import { ZonePage } from './zone-page';
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
 * /shoppers/people/{userId}/details                tab: the account
 * /shoppers/people/{userId}/zones                  tab: the zones it is in
 * /shoppers/people/{userId}/shopping-lists         tab: what it owns
 * /shoppers/people/{userId}/shopping-lists/{id}    one shopping list
 * /shoppers/people/{userId}/edit                   the account's form
 * /shoppers/zones                                  tab: the zones
 * /shoppers/zones/{zoneId}                         goes to its members
 * /shoppers/zones/{zoneId}/members                 tab: who is in it
 * /shoppers/zones/{zoneId}/members/{id}            one member's form
 * /shoppers/zones/{zoneId}/lists                   tab: its lists
 * /shoppers/zones/{zoneId}/lists/{listId}          one list, and its lines
 * /shoppers/zones/{zoneId}/lists/{listId}/edit     the list's form
 * /shoppers/zones/{zoneId}/lists/{listId}/lines       goes to the list
 * /shoppers/zones/{zoneId}/lists/{listId}/lines/{id}   one line's form
 * /shoppers/zones/{zoneId}/shopping-lists          tab: drawn from the zone
 * /shoppers/zones/{zoneId}/shopping-lists/{id}     goes to it under its owner
 * /shoppers/zones/{zoneId}/details                 tab: the zone's facts
 * /shoppers/zones/{zoneId}/edit                    the zone's form
 * ```
 *
 * Every segment but `details`, `zones` under a person, `edit` and the
 * parameters is a descriptor's own, so the table and the registry cannot
 * disagree about where a resource is.
 *
 * ## Why a form is beside the page and not inside it
 *
 * A form is a page of its own, with its own header and its way back. So it is
 * a sibling of the page whose tab lists the rows, and the router reaches it by
 * failing the tab first: the tab is a terminal route and cannot take the
 * segment after it. `chainsRoutes` is built the same way (admin plan 0042).
 *
 * ## Why the page of a row is at the empty path under its parameter
 *
 * The parameter route has no component, so a route under it inherits the
 * parameter. The page and the forms beside it are then all children of the one
 * route that names the row.
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
                {
                  path: '',
                  component: PersonPage,
                  children: [
                    { path: '', pathMatch: 'full', redirectTo: DETAILS_TAB },
                    { path: DETAILS_TAB, component: PersonDetailsTab },
                    { path: PERSON_ZONES_TAB, component: PersonZonesTab },
                    resourceTabRoute(BASKETS),
                  ],
                },
                formOf(USERS, PERSON_PARAM),
                {
                  path: `${BASKETS.segment}/:${BASKET_PARAM}`,
                  component: BasketPage,
                },
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
                {
                  path: '',
                  component: ZonePage,
                  children: [
                    {
                      path: '',
                      pathMatch: 'full',
                      redirectTo: MEMBERSHIPS.segment,
                    },
                    { path: MEMBERSHIPS.segment, component: ZoneMembersTab },
                    resourceTabRoute(LISTS),
                    resourceTabRoute(ZONE_BASKETS),
                    { path: DETAILS_TAB, component: ZoneDetailsTab },
                  ],
                },
                formOf(ZONES, ZONE_PARAM),
                {
                  // One member's role and name in this zone. Its way back is
                  // one segment up, which is the Members tab.
                  path: `${MEMBERSHIPS.segment}/:id`,
                  component: ResourceFormPage,
                  data: {
                    [RESOURCE_DESCRIPTOR]: MEMBERSHIPS,
                    [RESOURCE_FORM_MODE]: 'edit',
                  },
                },
                {
                  path: `${LISTS.segment}/:${LIST_PARAM}`,
                  children: [
                    { path: '', pathMatch: 'full', component: ListPage },
                    formOf(LISTS, LIST_PARAM),
                    {
                      // The lines are drawn on the list's own page, so their
                      // segment alone is no screen. A line's form goes back
                      // one segment up, as every form does, and lands here.
                      path: LIST_LINES.segment,
                      pathMatch: 'full',
                      redirectTo: toListOfLine,
                    },
                    {
                      path: `${LIST_LINES.segment}/:id`,
                      component: ResourceFormPage,
                      data: {
                        [RESOURCE_DESCRIPTOR]: LIST_LINES,
                        [RESOURCE_FORM_MODE]: 'edit',
                      },
                    },
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

/**
 * The form of the row a page is about, beside that page: `edit` under the
 * row's own address, reading its id from the page's parameter.
 */
function formOf(descriptor: AnyResourceDescriptor, param: string): Route {
  return {
    path: EDIT_SEGMENT,
    component: ResourceFormPage,
    data: {
      [RESOURCE_DESCRIPTOR]: descriptor,
      [RESOURCE_FORM_MODE]: 'edit',
      [RESOURCE_ID_FROM]: param,
    },
  };
}
