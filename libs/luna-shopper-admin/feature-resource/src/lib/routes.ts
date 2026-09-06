import type { Type } from '@angular/core';
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
                // The resource's own editor where it named one, and the generic
                // form otherwise. Create and edit stay one component either
                // way, which is what keeps them one act.
                path: 'new',
                component: descriptor.editor ?? ResourceFormPage,
                data: { ...data, [RESOURCE_FORM_MODE]: 'create' },
              },
            ]
          : []),

        // The edit screen, for a resource whose `:id` is taken by a detail
        // component of its own.
        //
        // Without it, turning on `edit` for a zone or a list would change
        // nothing at all: `detail` wins at `:id`, so the generic form would
        // have no route to be reached at, and the operator would find a
        // resource that claims to be editable and offers no way to edit it.
        // The resources whose detail view *is* the generic form need no such
        // route, because for them `:id` is already the editor.
        //
        // Before `:id` for readability only. A terminal route has to consume
        // the whole remaining URL, so `:id` cannot match two segments whatever
        // the order.
        ...(descriptor.detail !== undefined && descriptor.actions?.edit === true
          ? [
              {
                path: ':id/edit',
                component: descriptor.editor ?? ResourceFormPage,
                data: { ...data, [RESOURCE_FORM_MODE]: 'edit' },
              },
            ]
          : []),

        // The detail screen: the resource's own component where it named one,
        // and the generic form otherwise, which draws the fields it cannot
        // change beside the ones it can. A resource with neither has no such
        // route, and `resource-list` draws its rows as text rather than as
        // controls that lead nowhere.
        //
        // `detail` before `editor`, because a resource naming both means the two
        // screens are genuinely different: one reads a row and one changes it.
        // Nothing names both today, and the order says which would win.
        ...(hasDetailScreen(descriptor)
          ? [
              {
                path: ':id',
                component:
                  descriptor.detail ?? descriptor.editor ?? ResourceFormPage,
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
 * The empty path lands on the first resource the app named, unless the app gave
 * it a `home` (admin plan 0016). `0004` refused a landing page because an
 * operator opens this tool to change a specific thing and a page in front of
 * that is a click between them and it. That argument is against an *empty*
 * landing page and it stands; it is not against one that answers, on arrival,
 * the questions an operator otherwise opens six screens to answer.
 *
 * So the home is optional and the redirect is what it replaces. Without one
 * nothing changes at all, which is what keeps every app and every spec that
 * never names a home exactly as it was.
 */
export function adminRoutes(
  descriptors: readonly AnyResourceDescriptor[],
  sections: readonly Route[] = [],
  home?: Type<unknown>
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
        // The screen the app opens to, or the redirect that stands in for one.
        // Never both: a route table with a component at the empty path and a
        // redirect from it draws whichever was declared first, which is a
        // question nobody should have to answer by reading this file.
        //
        // `pathMatch: 'full'` either way. Without it the empty path matches
        // every URL under the chrome, and the dashboard would be drawn over
        // every resource in the app.
        ...emptyPath(home, first),
        { path: '**', component: NotFoundPage },
      ],
    },
  ];
}

/**
 * What sits at the empty path: the home, else the redirect, else nothing.
 *
 * Nothing is a real case. An app with no resources and no home has no screen to
 * open on, and a redirect to a segment that does not exist would land on the not
 * found page by a route the app itself declared.
 */
function emptyPath(
  home: Type<unknown> | undefined,
  first: AnyResourceDescriptor | undefined
): Route[] {
  if (home !== undefined) {
    return [{ path: '', pathMatch: 'full', component: home }];
  }

  return first === undefined
    ? []
    : [{ path: '', pathMatch: 'full', redirectTo: first.segment }];
}
