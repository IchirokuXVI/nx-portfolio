import { inject, type Type } from '@angular/core';
import {
  PRIMARY_OUTLET,
  Router,
  type CanActivateFn,
  type Route,
} from '@angular/router';
import {
  hasDetailScreen,
  isRecordChildList,
  RECORD_DETAILS_TAB,
  recordChildKey,
  recordTabs,
  type AnyResourceDescriptor,
  type RecordChild,
} from '@portfolio/luna-shopper-admin/models';
import { NotFoundPage } from '@portfolio/luna-shopper-admin/ui';
import type { AdminSection } from './admin-section';
import { AdminShellPage } from './admin-shell-page';
import { recordLeaveGuard } from './record-leave-guard';
import { RECORD_EDIT_PARAM, RecordDetailsTab, RecordPage } from './record-page';
import { ResourceFormPage } from './resource-form-page';
import { ResourceListPage } from './resource-list-page';
import {
  RECORD_TAB,
  RECORD_YIELDS_TO,
  RESOURCE_DESCRIPTOR,
  RESOURCE_FORM_MODE,
  RESOURCE_ID_FROM,
  RESOURCE_LIST_EMBED,
  RESOURCE_LIST_FIXED,
  SPLIT_UNDER_HEADER,
} from './resource-route-data';
import {
  ResourceSplitPage,
  SPLIT_EMPTY_KEY,
  SPLIT_LIST_WIDTH,
} from './resource-split-page';

/**
 * How the route factory finds the descriptor of a list tab by its name.
 *
 * A record names the resource of a list tab and holds no descriptor of it,
 * and a route table is built before there is a registry to ask.
 */
export type ResourceByName = (
  name: string
) => AnyResourceDescriptor | undefined;

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
  return routesOf(descriptor);
}

/**
 * {@link resourceRoutes}, for a caller that knows the other resources. It is
 * a function of its own because `resourceRoutes` is handed to `flatMap`,
 * which would pass an index where the resolver goes.
 */
function routesOf(
  descriptor: AnyResourceDescriptor,
  lists?: ResourceByName
): Route[] {
  const data = { [RESOURCE_DESCRIPTOR]: descriptor };

  return [
    {
      path: descriptor.segment,
      children: [
        { path: '', component: ResourceListPage, data },
        ...resourceFormRoutes(descriptor, lists),
      ],
    },
  ];
}

/**
 * The list of a resource as part of a larger page (admin plan 0042): a tab of
 * its parent's page, at the tab's own path.
 *
 * The same list component, told through route `data` that the page above it
 * already drew the header. Its forms are {@link resourceFormRoutes}, mounted by
 * the caller beside the page and not inside it, so that a form is a page of its
 * own with its own header and its way back.
 */
export function resourceTabRoute(descriptor: AnyResourceDescriptor): Route {
  return {
    path: descriptor.segment,
    component: ResourceListPage,
    data: { [RESOURCE_DESCRIPTOR]: descriptor, [RESOURCE_LIST_EMBED]: 'tab' },
  };
}

/**
 * The list of a resource as a column, with whatever is open beside it (admin
 * plan 0042).
 *
 * `children` are what can be open: the row's own page, and a form for a new
 * one. The list navigates to the row's id relative to this route, so the
 * row's page is the child whose path is a parameter.
 */
export function resourceSplitRoute(
  descriptor: AnyResourceDescriptor,
  options: {
    readonly children: Route[];
    /** How wide the column is beside the open row, as a CSS length. */
    readonly listWidth: string;
    /** Whether a page header is drawn above the split by the page holding it. */
    readonly underHeader?: boolean;
    /** What the pane beside the list says while nothing is open, as a key. */
    readonly emptyKey?: string;
  }
): Route {
  return {
    path: descriptor.segment,
    component: ResourceSplitPage,
    data: {
      [RESOURCE_DESCRIPTOR]: descriptor,
      [RESOURCE_LIST_EMBED]: 'column',
      [SPLIT_LIST_WIDTH]: options.listWidth,
      [SPLIT_UNDER_HEADER]: options.underHeader === true,
      [SPLIT_EMPTY_KEY]: options.emptyKey ?? null,
    },
    children: options.children,
  };
}

/**
 * The form routes of a resource, without its list: `new`, and `:id`.
 *
 * Under the resource's own segment, so that the form's way back, which is one
 * route up, is the address the list is at.
 */
export function resourceFormBranch(descriptor: AnyResourceDescriptor): Route {
  return {
    path: descriptor.segment,
    children: resourceFormRoutes(descriptor),
  };
}

/** The create route of a resource alone, for a caller that mounts the rest. */
export function resourceCreateRoute(descriptor: AnyResourceDescriptor): Route {
  return {
    path: 'new',
    component: descriptor.editor ?? ResourceFormPage,
    data: {
      [RESOURCE_DESCRIPTOR]: descriptor,
      [RESOURCE_FORM_MODE]: 'create',
    },
  };
}

/**
 * One route that mounts the record page (admin plan 0053, section 2.7), for a
 * caller that mounts by hand.
 *
 * `mode: 'create'` is the page that adds a record. Without it the page opens
 * the record whose ID the route holds, and reads it first. Every route built
 * here carries the leave guard, so a caller cannot mount the page without it.
 *
 * **A record whose block names a tab gets child routes** (admin plan 0054,
 * section 2.2): `details` for the view of the record, one for each tab in
 * the order of `children`, and an empty path that goes to the first of them.
 * A record with no tab is the page alone, as before. The page that adds a
 * record never has tabs, because a record that does not exist holds nothing.
 *
 * - A part is mounted at its `name`, as its `component`.
 * - A list is mounted at the segment of its resource, as that resource's
 *   list, fixed to the record. Its descriptor comes from `lists`.
 * - `tabs` hands over the whole route of a tab, by the `name` of a part or
 *   the `resource` of a list, for a tab with routes of its own under it. The
 *   descriptor still says that the tab exists, what it is called and where
 *   its count is. The route says how it is mounted.
 *
 * A list tab with neither a route nor a descriptor cannot be mounted, and the
 * factory says so when the route table is built and not when the tab is
 * pressed.
 *
 * **A list mounted from `lists` is one that only reads.** The tab has no
 * routes under it, so a row that opens, or a button that adds, would lead to
 * an address nothing answers. A list whose rows open, that adds rows, or
 * whose child names `add`, is refused here: its route comes through `tabs`.
 *
 * **Two children that are found by one key cannot share it.** A tab is
 * found by its key in the address and in `tabs`. A child with no `count`
 * field is found by its key in `record.counts`. The factory refuses two tabs
 * with one key, such as two tabs of one resource, and two children that
 * `counts` would count under one key.
 */
export function recordRoute(
  descriptor: AnyResourceDescriptor,
  options: {
    readonly path: string;
    readonly mode?: 'create';
    /** The route parameter that holds the ID, when it is on a route above. */
    readonly idFrom?: string;
    /** The whole route of a tab, by the key of its child. */
    readonly tabs?: Readonly<Record<string, Route>>;
    /** The descriptor of a list tab that `tabs` does not mount. */
    readonly lists?: ResourceByName;
    /**
     * The path of the tab this page gives way to below 72 rem, while a route
     * under that tab is open (`RECORD_YIELDS_TO`).
     */
    readonly yieldsTo?: string;
  }
): Route {
  const route: Route = {
    path: options.path,
    component: RecordPage,
    canDeactivate: [recordLeaveGuard],
    data: {
      [RESOURCE_DESCRIPTOR]: descriptor,
      ...(options.mode === 'create' ? { [RESOURCE_FORM_MODE]: 'create' } : {}),
      ...(options.idFrom === undefined
        ? {}
        : { [RESOURCE_ID_FROM]: options.idFrom }),
      ...(options.yieldsTo === undefined
        ? {}
        : { [RECORD_YIELDS_TO]: options.yieldsTo }),
    },
  };

  assertChildKeys(descriptor);

  const tabs = options.mode === 'create' ? [] : recordTabs(descriptor);
  if (tabs.length === 0) {
    return route;
  }

  const children = tabs.map((tab) =>
    tab.child === null
      ? detailsTabRoute()
      : childTabRoute(descriptor, tab.child, tab.key, options)
  );

  return {
    ...route,
    children: [
      // A record opens on its first tab.
      { path: '', pathMatch: 'full', redirectTo: children[0].path },
      ...children,
    ],
  };
}

/**
 * Refuse a record where two children that are found by one key share it.
 *
 * Two uses of the key, and a clash is within one of them: the tabs, which
 * the address and `tabs` find by it, and the children with no `count` field
 * on a record that states `counts`, which finds their count by it. A link or
 * a panel that takes its count from a field is found by nothing, so any
 * number of those may be of the same resource.
 */
function assertChildKeys(descriptor: AnyResourceDescriptor): void {
  const block = descriptor.record;
  const children = (block?.children ?? []) as readonly RecordChild[];
  const refuse = (found: readonly RecordChild[], what: string): void => {
    const seen = new Set<string>();
    for (const key of found.map(recordChildKey)) {
      if (seen.has(key)) {
        throw new Error(
          `Two ${what} of "${descriptor.name}" are known by "${key}", ` +
            'and each is found by that key alone.'
        );
      }
      seen.add(key);
    }
  };

  refuse(
    children.filter((child) => child.as === 'tab'),
    'tabs'
  );
  if (block?.counts !== undefined) {
    refuse(
      children.filter((child) => child.count === undefined),
      'children counted by `counts`'
    );
  }
}

/** The Details tab: the view of the record, which asks before it is left. */
function detailsTabRoute(): Route {
  return {
    path: RECORD_DETAILS_TAB,
    component: RecordDetailsTab,
    canDeactivate: [recordLeaveGuard],
    data: { [RECORD_TAB]: RECORD_DETAILS_TAB },
  };
}

/** The route of one tab that is not Details, marked with its key. */
function childTabRoute(
  descriptor: AnyResourceDescriptor,
  child: RecordChild,
  key: string,
  options: {
    readonly tabs?: Readonly<Record<string, Route>>;
    readonly lists?: ResourceByName;
  }
): Route {
  // What the list is fixed by rides every list tab, also one a caller
  // mounted: the route says which filter, and the page says which record.
  const marks = {
    [RECORD_TAB]: key,
    ...(isRecordChildList(child) ? { [RESOURCE_LIST_FIXED]: child.by } : {}),
  };

  const handed = options.tabs?.[key];
  if (handed !== undefined) {
    return { ...handed, data: { ...handed.data, ...marks } };
  }

  if (!isRecordChildList(child)) {
    return { path: child.name, component: child.component, data: marks };
  }

  const list = options.lists?.(child.resource);
  if (list === undefined) {
    throw new Error(
      `The tab "${child.resource}" of "${descriptor.name}" has no route. ` +
        'Hand its route to recordRoute through `tabs`, or its descriptor ' +
        'through `lists`.'
    );
  }
  if (
    child.add !== undefined ||
    list.actions?.create === true ||
    hasDetailScreen(list)
  ) {
    throw new Error(
      `The tab "${child.resource}" of "${descriptor.name}" opens or adds ` +
        'rows, and a tab mounted from `lists` has no route for either. ' +
        'Hand its route to recordRoute through `tabs`, and mount its forms.'
    );
  }
  const tab = resourceTabRoute(list);
  return { ...tab, data: { ...tab.data, ...marks } };
}

/**
 * The old address of the form of a record, `…/:id/edit`, as a redirect to
 * the record with its form open (admin plan 0054, section 4.3).
 *
 * A guard and not `redirectTo`: a relative redirect keeps the query of the
 * address it came from and cannot add to it, and the mount of the resource is
 * not known here for an absolute one.
 *
 * The route factory adds none by itself. Only a resource that had a form at
 * that address has links to it out in the world, so the caller that moved
 * the resource onto the record page mounts this beside it.
 */
export function recordEditRedirect(path = ':id/edit'): Route {
  return { path, canActivate: [toRecordForm], children: [] };
}

/** One segment up, with the parameter that opens the form. */
const toRecordForm: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const tree = router.parseUrl(state.url);
  const segments = tree.root.children[PRIMARY_OUTLET]?.segments ?? [];

  return router.createUrlTree(
    ['/', ...segments.slice(0, -1).map((segment) => segment.path)],
    { queryParams: { ...tree.queryParams, [RECORD_EDIT_PARAM]: '1' } }
  );
};

function resourceFormRoutes(
  descriptor: AnyResourceDescriptor,
  lists?: ResourceByName
): Route[] {
  const data = { [RESOURCE_DESCRIPTOR]: descriptor };

  // A resource with no page of its own opens on the record page: one page
  // that reads a row, changes it and adds one (admin plan 0053). A resource
  // that names a `detail` or an `editor` keeps the routes it has, until the
  // plan that moves it.
  if (descriptor.detail === undefined && descriptor.editor === undefined) {
    return [
      // Only where there is something to add, for the reason given below.
      ...(descriptor.actions?.create === true
        ? [recordRoute(descriptor, { path: 'new', mode: 'create' })]
        : []),
      ...(hasDetailScreen(descriptor)
        ? [recordRoute(descriptor, { path: ':id', lists })]
        : []),
    ];
  }

  return [
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
  // Every resource the app names, for a record whose tab is the list of
  // another one. The registry reads the same sections once the app runs.
  const named = sections.flatMap((section) => [
    ...(section.resources ?? []),
    ...(section.held ?? []),
  ]);
  const lists: ResourceByName = (name) =>
    named.find((descriptor) => descriptor.name === name);

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
        ...sections.map((section) => sectionBranch(section, lists)),
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
function sectionBranch(section: AdminSection, lists: ResourceByName): Route {
  return {
    path: section.segment ?? '',
    children: [
      ...(section.resources ?? []).flatMap((descriptor) =>
        routesOf(descriptor, lists)
      ),
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
      // A section with no screen at its own address opens on one of its tabs
      // (admin plan 0044). Never beside a home: the home is declared first and
      // would win.
      ...(section.landing === undefined || section.home !== undefined
        ? []
        : [
            {
              path: '',
              pathMatch: 'full' as const,
              redirectTo: section.landing,
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
