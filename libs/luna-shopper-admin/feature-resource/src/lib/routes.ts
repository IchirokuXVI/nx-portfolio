import type { Route } from '@angular/router';
import {
  hasDetailScreen,
  type AnyResourceDescriptor,
} from '@portfolio/luna-shopper-admin/models';
import { NotFoundPage } from '@portfolio/luna-shopper-admin/ui';
import { AdminShellPage } from './admin-shell-page';
import { ResourceFormPage } from './resource-form-page';
import { ResourceListPage } from './resource-list-page';
import { RESOURCE_DESCRIPTOR, RESOURCE_FORM_MODE } from './resource-route-data';

/**
 * The three routes every resource has.
 *
 * A list, a form for a new row, and a form for an existing one. The second and
 * third are the same component: create and edit are one act from two starting
 * points (plan 0004, section 5), and the edit route doubles as the detail view
 * because the form draws the fields it cannot change as well as the ones it
 * can.
 *
 * The descriptor is repeated on each child rather than stated once on the
 * parent. Route `data` is inherited only under conditions that depend on
 * whether an ancestor has a component, which is a rule nobody should have to
 * remember while adding a screen; stating it three times is cheap and cannot be
 * wrong.
 *
 * `new` is declared before `:id`, because a parameter matches anything and
 * would otherwise swallow it, sending the create screen off to read a row
 * called "new".
 */
export function resourceRoutes(descriptor: AnyResourceDescriptor): Route[] {
  const data = { [RESOURCE_DESCRIPTOR]: descriptor };

  return [
    {
      path: descriptor.segment,
      children: [
        { path: '', component: ResourceListPage, data },

        // A create screen only where there is something to create. A resource
        // with no `POST` behind it would otherwise answer a typed URL with a
        // form that fills in, submits, and is refused by the gateway, which is
        // a worse answer than the not found page (plan 0007, section 1).
        ...(descriptor.actions?.create === true
          ? [
              {
                path: 'new',
                component: ResourceFormPage,
                data: { ...data, [RESOURCE_FORM_MODE]: 'create' },
              },
            ]
          : []),

        // The detail screen: the resource's own component where it named one,
        // and the generic form otherwise, which draws the fields it cannot
        // change beside the ones it can. A resource with neither has no such
        // route, and `resource-list` draws its rows as text rather than as
        // controls that lead nowhere.
        ...(hasDetailScreen(descriptor)
          ? [
              {
                path: ':id',
                component: descriptor.detail ?? ResourceFormPage,
                data: { ...data, [RESOURCE_FORM_MODE]: 'edit' },
              },
            ]
          : []),
      ],
    },
  ];
}

/**
 * Everything behind the chrome.
 *
 * The shell is a route rather than a wrapper around the router outlet, so the
 * navigation and the environment badge are drawn once and survive every
 * navigation between resources. The not found page is **inside** it, because a
 * screen that says the address is wrong and also takes away the menu leaves the
 * operator with nothing but the back button.
 *
 * The empty path lands on the first resource the app named. There is no
 * dashboard and this plan does not add one: an operator opens this tool to
 * change a specific thing, and a landing page in front of that is a click
 * between them and it.
 */
export function adminRoutes(
  descriptors: readonly AnyResourceDescriptor[],
  sections: readonly Route[] = []
): Route[] {
  const first = descriptors[0];

  return [
    {
      path: '',
      component: AdminShellPage,
      children: [
        ...descriptors.flatMap(resourceRoutes),
        // Screens that are not a resource, inside the same chrome (plan 0006).
        // The harvester's are the first: a run is a process rather than a row,
        // and a review queue is not a list somebody edits, so neither of them
        // can be a descriptor. They are still part of this app, so they belong
        // under the same navigation rather than in a branch of their own that
        // draws its own header.
        //
        // After the resource branches and before `**`, which is the only place
        // they can go: a catch all matches anything, so a route declared after
        // it is unreachable.
        ...sections,
        ...(first === undefined
          ? []
          : [
              {
                path: '',
                pathMatch: 'full' as const,
                redirectTo: first.segment,
              },
            ]),
        { path: '**', component: NotFoundPage },
      ],
    },
  ];
}
