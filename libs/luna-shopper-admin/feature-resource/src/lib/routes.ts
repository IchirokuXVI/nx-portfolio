import type { Type } from '@angular/core';
import type { Route } from '@angular/router';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';
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
export function resourceRoutes(
  descriptor: AnyResourceDescriptor,
  screens: ResourceScreens = {}
): Route[] {
  const data = { [RESOURCE_DESCRIPTOR]: descriptor };
  const form = screens.form ?? ResourceFormPage;

  return [
    {
      path: descriptor.segment,
      children: [
        { path: '', component: ResourceListPage, data },
        {
          path: 'new',
          component: form,
          data: { ...data, [RESOURCE_FORM_MODE]: 'create' },
        },
        {
          path: ':id',
          component: form,
          data: { ...data, [RESOURCE_FORM_MODE]: 'edit' },
        },
      ],
    },
  ];
}

/**
 * What one resource draws with, where the generic answer is not enough.
 *
 * There is one of these today and the plans said there would be: prices need a
 * screen that names the scope a price belongs to, states its kind and says how
 * many shops it covers, because a price is not attached to a shop and an
 * interface that hides that is not simpler, it is wrong
 * (`apps/luna-shopper-admin/plans/0005`, sections 2 and 4).
 *
 * A component named here rather than on the descriptor, because a descriptor is
 * a plain object in a library that knows nothing about Angular, and putting a
 * component type on it would make every entity's configuration depend on the
 * framework its screens happen to be written in.
 */
export interface ResourceScreens {
  /** Drawn instead of {@link ResourceFormPage}, for create and for edit. */
  readonly form?: Type<unknown>;
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
 *
 * The two optional arguments answer different questions, which is why they are
 * two. `screens` says what a named resource draws instead of the generic form,
 * keyed by descriptor name, so it belongs beside the descriptors it changes.
 * `sections` carries screens that are not a resource at all, and they are added
 * after every resource branch.
 */
export function adminRoutes(
  descriptors: readonly AnyResourceDescriptor[],
  screens: Readonly<Record<string, ResourceScreens>> = {},
  sections: readonly Route[] = []
): Route[] {
  const first = descriptors[0];

  return [
    {
      path: '',
      component: AdminShellPage,
      children: [
        ...descriptors.flatMap((descriptor) =>
          resourceRoutes(descriptor, screens[descriptor.name])
        ),
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
