import type { Type } from '@angular/core';
import type { Route } from '@angular/router';
import {
  hasDetailScreen,
  type AnyResourceDescriptor,
} from '@portfolio/luna-shopper-admin/models';
import { NotFoundPage } from '@portfolio/luna-shopper-admin/ui';
import type { AdminSection } from './admin-section';
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
 * Everything behind the chrome, one branch per section (admin plan 0022).
 *
 * The shell is a route rather than a wrapper around the router outlet, so the
 * navigation and the environment badge are drawn once and survive every
 * navigation between screens. The not found page is **inside** it, because a
 * screen that says the address is wrong and also takes away the menu leaves the
 * operator with nothing but the back button.
 *
 * A section builds one branch under its own segment, holding its resources, its
 * hand written screens, and its home at the branch's empty path. That is the
 * whole of the mounting, and **`resourceRoutes` is unchanged, which is the
 * point**: a descriptor still knows only its own segment, and where it is
 * mounted is the section's business. `0021` already mounted `POSTAL_CODES`
 * inside `harvestRoutes` and passed it through `resourceRoutes` untouched, with
 * a comment about why one resource was a special case. This is that mechanism
 * made general, so it is how every resource is mounted and the special case is
 * gone.
 *
 * A section with no segment mounts its children at the root, which is what the
 * overview and the admins section want and is why the segment is optional. Two
 * of them do not shadow each other: Angular tries each sibling in turn and moves
 * on when a branch's children do not match the rest of the URL, so `/admins`
 * fails the overview's branch and matches the admins section's.
 *
 * **The exception is the root URL itself**, and it is why the empty path below
 * is declared before the branches rather than after them. A route with children
 * matches a URL it has fully consumed even when none of its children does, so a
 * section with no segment answers `/` whatever is inside it.
 */
export function adminRoutes(
  sections: readonly AdminSection[],
  home?: Type<unknown>
): Route[] {
  return [
    {
      path: '',
      component: AdminShellPage,
      children: [
        // The screen the app opens to, or the redirect that stands in for one.
        // Never both: a route table with a component at the empty path and a
        // redirect from it draws whichever was declared first, which is a
        // question nobody should have to answer by reading this file.
        //
        // `pathMatch: 'full'` either way, so it matches the app's own root and
        // nothing else and cannot shadow a section. **Before** the branches, and
        // that order is load bearing: a section with no segment matches the root
        // URL even when none of its children does, because Angular treats a
        // fully consumed URL against a route with children as a match with none
        // of them activated. Declared after the branches, a redirect here would
        // never be reached by an app whose first section has no segment.
        ...emptyPath(sections, home),
        ...sections.map(sectionBranch),
        { path: '**', component: NotFoundPage },
      ],
    },
  ];
}

/**
 * One section's branch: its resources, its own screens, then its home.
 *
 * The hand written screens are the harvester's and were the whole of `0006`: a
 * run is a process rather than a row, and a review queue is not a list somebody
 * edits, so neither of them can be a descriptor. They belong under the same
 * chrome as a list rather than in a branch of their own that draws its own
 * header, and now they belong under the same section as well.
 *
 * The home is last for readability alone. An empty path with `pathMatch: 'full'`
 * matches only the branch's own URL, so the order cannot be wrong; reading the
 * branch in the order an operator meets it is what makes the file answerable.
 */
function sectionBranch(section: AdminSection): Route {
  return {
    path: section.segment ?? '',
    children: [
      ...(section.resources ?? []).flatMap(resourceRoutes),
      ...(section.screens ?? []),
      ...(section.home === undefined
        ? []
        : [
            {
              path: '',
              pathMatch: 'full' as const,
              component: section.home,
            },
          ]),
    ],
  };
}

/**
 * What sits at the app's empty path: the home, else a redirect, else nothing.
 *
 * A section mounted at the root with a home of its own already draws it, which
 * is exactly what the overview is, so nothing stands in for it. Without either,
 * the app lands on the first resource any section mounted, which is what it did
 * before `0016` and is what keeps an app that declares no home working.
 *
 * Nothing is a real case. An app with no resources and no home has no screen to
 * open on, and a redirect to a segment that does not exist would land on the not
 * found page by a route the app itself declared.
 */
function emptyPath(
  sections: readonly AdminSection[],
  home: Type<unknown> | undefined
): Route[] {
  if (home !== undefined) {
    return [{ path: '', pathMatch: 'full', component: home }];
  }

  const claimed = sections.some(
    (section) => section.segment === undefined && section.home !== undefined
  );
  if (claimed) {
    return [];
  }

  const first = sections.find(
    (section) => (section.resources ?? []).length > 0
  );
  const resource = first?.resources?.[0];

  if (first === undefined || resource === undefined) {
    return [];
  }

  return [
    {
      path: '',
      pathMatch: 'full',
      redirectTo:
        first.segment === undefined
          ? resource.segment
          : `${first.segment}/${resource.segment}`,
    },
  ];
}
