import { signal } from '@angular/core';
import {
  defineResource,
  type AnyResourceDescriptor,
} from '@portfolio/luna-shopper-admin/models';
import { NotFoundPage } from '@portfolio/luna-shopper-admin/ui';
import type { AdminSection } from './admin-section';
import { AdminShellPage } from './admin-shell-page';
import { recordLeaveGuard } from './record-leave-guard';
import { RecordDetailsTab, RecordPage } from './record-page';
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
import {
  adminRoutes,
  recordEditRedirect,
  recordRoute,
  resourceCreateRoute,
  resourceFormBranch,
  resourceRoutes,
  resourceSplitRoute,
  resourceTabRoute,
} from './routes';

interface Shop {
  id: string;
  name: string;
}

const shops = defineResource<Shop>({
  name: 'shops',
  segment: 'shops',
  labels: { one: 'shops.one', many: 'shops.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'shops.name' }],
  list: { columns: ['name'], compact: ['name'] },
  actions: { create: true, edit: true },
  gateway: () => {
    throw new Error('not used');
  },
});

const items = defineResource<Shop>({
  ...shops,
  name: 'items',
  segment: 'items',
  labels: { one: 'items.one', many: 'items.many' },
});

/** A list that only reads: no row of it opens, and nothing adds one. */
const logs = defineResource<Shop>({
  ...shops,
  name: 'logs',
  segment: 'logs',
  labels: { one: 'logs.one', many: 'logs.many' },
  actions: {},
});

/** One section with no segment, which mounts its resources at the root. */
function root(...resources: readonly AnyResourceDescriptor[]): AdminSection[] {
  return [{ key: 'root', label: 'root', resources }];
}

describe('resourceRoutes', () => {
  const [branch] = resourceRoutes(shops);
  const children = branch.children ?? [];

  /**
   * A resource with no page of its own opens on the record page, which reads
   * a row, changes it and adds one (admin plan 0053).
   */
  it('is a list, and the record page at `new` and at `:id`, under the segment', () => {
    expect(branch.path).toBe('shops');
    expect(children.map((route) => route.path)).toEqual(['', 'new', ':id']);
    expect(children.map((route) => route.component)).toEqual([
      ResourceListPage,
      RecordPage,
      RecordPage,
    ]);
  });

  /** Leaving a form with changes asks first, on both routes. */
  it('puts the leave guard on both routes of the record page', () => {
    expect(children[1].canDeactivate).toEqual([recordLeaveGuard]);
    expect(children[2].canDeactivate).toEqual([recordLeaveGuard]);
  });

  /**
   * A parameter matches anything, so declaring it first would swallow `new` and
   * send the create screen off to read a row called "new".
   */
  it('declares `new` before `:id`', () => {
    const paths = children.map((route) => route.path);

    expect(paths.indexOf('new')).toBeLessThan(paths.indexOf(':id'));
  });

  /**
   * Route `data` is inherited only under conditions that depend on whether an
   * ancestor has a component, which is a rule nobody should have to remember
   * while adding a screen. Stating it three times is cheap and cannot be wrong.
   */
  it('states the descriptor on every child rather than relying on inheritance', () => {
    for (const child of children) {
      expect(child.data?.[RESOURCE_DESCRIPTOR]).toBe(shops);
    }
  });

  /** `new` adds a record. `:id` opens one, and says no mode: it reads first. */
  it('tells the page that adds from the page that opens a record', () => {
    expect(children[1].data?.[RESOURCE_FORM_MODE]).toBe('create');
    expect(children[2].data?.[RESOURCE_FORM_MODE]).toBeUndefined();
  });

  /** A resource that names a page of its own keeps the routes it had. */
  it('keeps the old form for a resource with a detail or an editor', () => {
    class ShopEditor {}
    const withEditor = defineResource<Shop>({ ...shops, editor: ShopEditor });
    const withDetail = defineResource<Shop>({ ...shops, detail: NotFoundPage });

    expect(
      resourceRoutes(withEditor)[0].children?.map((route) => route.component)
    ).toEqual([ResourceListPage, ShopEditor, ShopEditor]);
    expect(
      resourceRoutes(withDetail)[0].children?.map((route) => [
        route.path,
        route.component,
      ])
    ).toEqual([
      ['', ResourceListPage],
      ['new', ResourceFormPage],
      [':id/edit', ResourceFormPage],
      [':id', NotFoundPage],
    ]);
    for (const route of [
      ...(resourceRoutes(withEditor)[0].children ?? []),
      ...(resourceRoutes(withDetail)[0].children ?? []),
    ]) {
      expect(route.canDeactivate).toBeUndefined();
    }
  });

  /**
   * A resource with no `POST` behind it would otherwise answer a typed URL with
   * a form that fills in, submits and is refused by the gateway, which is a
   * worse answer than the not found page (plan 0007, section 1).
   */
  it('declares no create route for a resource that cannot be created', () => {
    const readOnly = defineResource<Shop>({
      ...shops,
      actions: { edit: true },
    });
    const [branch] = resourceRoutes(readOnly);

    expect(branch.children?.map((route) => route.path)).toEqual(['', ':id']);
  });

  /**
   * The admin table is the case this exists for: it can be read and it can
   * never be written, so it has a list and nothing else, and `resource-list`
   * draws its rows as text rather than as controls that lead nowhere.
   */
  it('declares no detail route for a resource with neither an editor nor a screen', () => {
    const listOnly = defineResource<Shop>({ ...shops, actions: {} });
    const [branch] = resourceRoutes(listOnly);

    expect(branch.children?.map((route) => route.path)).toEqual(['']);
  });

  /** A resource with its own detail screen gets that at `:id`, not the form. */
  it('mounts a resource own detail component in place of the form', () => {
    const withDetail = defineResource<Shop>({ ...shops, detail: NotFoundPage });
    const [branch] = resourceRoutes(withDetail);
    const detail = branch.children?.find((route) => route.path === ':id');

    expect(detail?.component).toBe(NotFoundPage);
  });

  /**
   * A descriptor knows only its own segment, and where it is mounted is the
   * section's business. That is what makes moving fourteen screens into sections
   * a change to one list rather than to fourteen descriptors.
   */
  it('is unchanged by the section it ends up in', () => {
    const [inside] = resourceRoutes(shops);

    expect(inside.path).toBe('shops');
  });
});

describe('adminRoutes', () => {
  const routes = adminRoutes(root(shops, items));
  const children = routes[0].children ?? [];

  it('puts every section inside the chrome', () => {
    expect(routes).toHaveLength(1);
    expect(routes[0].component).toBe(AdminShellPage);
  });

  it('mounts a section resources under the branch it declares', () => {
    const branch = children.find((route) => route.children !== undefined);
    const paths = branch?.children?.map((route) => route.path);

    expect(branch?.path).toBe('');
    expect(paths).toContain('shops');
    expect(paths).toContain('items');
  });

  /**
   * A route with children matches a URL it has fully consumed even when none of
   * its children does, so a section with no segment answers `/` whatever is
   * inside it. Declared after the branches, the redirect would never be reached.
   */
  it('declares the empty path before the branches that could swallow it', () => {
    const paths = children.map((route) => route.path);

    expect(paths[0]).toBe('');
    expect(children[0].redirectTo).toBe('shops');
  });

  it('lands the empty path on the first resource any section mounted', () => {
    const empty = children.find(
      (route) => route.path === '' && route.redirectTo !== undefined
    );

    expect(empty?.redirectTo).toBe('shops');
    expect(empty?.pathMatch).toBe('full');
  });

  /**
   * A screen that says the address is wrong and also takes away the menu leaves
   * the operator with nothing but the back button.
   */
  it('keeps the not found page inside the chrome, and last', () => {
    const last = children[children.length - 1];

    expect(last.path).toBe('**');
    expect(last.component).toBe(NotFoundPage);
  });

  it('survives being given no sections at all', () => {
    const empty = adminRoutes([]);

    expect(empty[0].children?.map((route) => route.path)).toEqual(['**']);
  });
});

/**
 * A section that owns a segment (admin plan 0022, sections 1.2 and 2).
 *
 * A resource moves from `/items` to `/catalog/items`, so a URL says which
 * section drew the screen. An operator who lands on `/list-lines` from a
 * bookmark cannot tell which of five sections it belongs to, and the navigation
 * says so only while the tab is open.
 */
describe('adminRoutes with a section segment', () => {
  class CatalogHome {}

  const harvest = { path: 'runs', children: [] };
  const sections: AdminSection[] = [
    {
      key: 'catalog',
      label: 'shell.sections.catalog',
      segment: 'catalog',
      home: CatalogHome,
      resources: [shops, items],
      screens: [harvest],
    },
  ];
  const branch = (adminRoutes(sections)[0].children ?? []).find(
    (route) => route.path === 'catalog'
  ) as (typeof sections)[number] & { children?: { path?: string }[] };

  it('mounts the resources, then the screens, then the home', () => {
    expect(branch.children?.map((route) => route.path)).toEqual([
      'shops',
      'items',
      'runs',
      '',
    ]);
  });

  it('draws the section home at the empty path of its own branch', () => {
    const home = branch.children?.find((route) => route.path === '');

    expect(home?.component).toBe(CatalogHome);
    expect(home?.pathMatch).toBe('full');
  });
});

/**
 * Two sections at the root, which is the overview and the admins section.
 *
 * **A section with one screen has no segment**, so the admins list stays at
 * `/admins` rather than moving to `/admins/admins`. Angular tries each sibling
 * in turn and moves on when a branch's children do not match the rest of the
 * URL, so the two do not shadow each other.
 */
describe('adminRoutes with two sections at the root', () => {
  class Overview {}

  const children =
    adminRoutes([
      { key: 'overview', label: 'shell.sections.overview', home: Overview },
      { key: 'admins', label: 'shell.sections.admins', resources: [shops] },
    ])[0].children ?? [];

  it('gives each of them a branch at the empty path', () => {
    expect(children.map((route) => route.path)).toEqual(['', '', '**']);
  });

  it('mounts the one screen section at the root, not under itself', () => {
    const admins = children[1];

    expect(admins.children?.map((route) => route.path)).toContain('shops');
  });

  /**
   * A section mounted at the root with a home of its own already draws the
   * app's empty path, so nothing stands in for it.
   */
  it('emits no redirect beside the overview', () => {
    const redirects = children.filter(
      (route) => route.redirectTo !== undefined
    );

    expect(redirects).toEqual([]);
  });
});

/**
 * A resource whose `:id` is taken by a detail component of its own (plan 0009,
 * section 1).
 *
 * `detail` wins at `:id`, because a row that is read is a different screen from
 * the one that changes it. Without a second route, turning on `edit` for a zone
 * or a list would change nothing at all: the generic form would have nowhere to
 * be reached, and the operator would find a resource that claims to be editable
 * and offers no way to edit it.
 */
describe('resourceRoutes for a resource with its own detail screen', () => {
  class ZoneDetail {}

  const zones = defineResource<Shop>({
    ...shops,
    name: 'zones',
    segment: 'zones',
    detail: ZoneDetail,
    actions: { edit: true },
  });

  it('puts the form at `:id/edit`, beside the detail screen at `:id`', () => {
    const [branch] = resourceRoutes(zones);
    const children = branch.children ?? [];

    expect(children.map((route) => route.path)).toEqual([
      '',
      ':id/edit',
      ':id',
    ]);
    expect(children.map((route) => route.component)).toEqual([
      ResourceListPage,
      ResourceFormPage,
      ZoneDetail,
    ]);
    expect(children[1].data?.[RESOURCE_FORM_MODE]).toBe('edit');
  });

  /** A read only resource with a detail screen gets no form to reach at all. */
  it('declares no edit route for a resource that cannot be changed', () => {
    const readOnly = defineResource<Shop>({
      ...shops,
      name: 'baskets',
      segment: 'baskets',
      detail: ZoneDetail,
      actions: undefined,
    });
    const [branch] = resourceRoutes(readOnly);

    expect(branch.children?.map((route) => route.path)).toEqual(['', ':id']);
  });

  /**
   * A resource whose detail view already **is** the form needs no second route:
   * for it, `:id` is the editor.
   */
  it('adds nothing where the generic form is already the detail screen', () => {
    const [branch] = resourceRoutes(shops);

    expect(branch.children?.map((route) => route.path)).not.toContain(
      ':id/edit'
    );
  });
});

/**
 * The screen the app opens to (admin plan 0016).
 *
 * `0004` refused an empty landing page, and that refusal stands. What this
 * argument adds is a page that answers, on arrival, the questions an operator
 * otherwise opens six screens to answer, so it replaces the redirect rather than
 * sitting in front of it.
 */
describe('adminRoutes with a home', () => {
  class DashboardPage {}

  const children =
    adminRoutes(root(shops, items), DashboardPage)[0].children ?? [];
  const empty = children.filter(
    (route) => route.path === '' && route.component
  );

  it('draws the home at the empty path, inside the chrome', () => {
    expect(empty).toHaveLength(1);
    expect(empty[0].component).toBe(DashboardPage);
    expect(empty[0].pathMatch).toBe('full');
  });

  /**
   * A component at the empty path and a redirect from it would draw whichever
   * was declared first, which is a question nobody should have to answer by
   * reading the route table.
   */
  it('emits no redirect beside it', () => {
    expect(children.filter((route) => route.redirectTo !== undefined)).toEqual(
      []
    );
  });

  /** An app with a home and no sections still has a screen to open on. */
  it('needs no resource to have somewhere to land', () => {
    const alone = adminRoutes([], DashboardPage)[0].children ?? [];

    expect(alone.map((route) => route.path)).toEqual(['', '**']);
    expect(alone[0].component).toBe(DashboardPage);
  });

  /** Without one, nothing changes at all. */
  it('still redirects to the first resource when no home is given', () => {
    const without = adminRoutes(root(shops, items))[0].children ?? [];
    const redirect = without.find((route) => route.redirectTo !== undefined);

    expect(redirect?.redirectTo).toBe('shops');
    expect(redirect?.component).toBeUndefined();
  });

  /** A redirect into a section names the section as well as the resource. */
  it('redirects through the segment where the first section has one', () => {
    const [chrome] = adminRoutes([
      { key: 'catalog', label: 'c', segment: 'catalog', resources: [shops] },
    ]);
    const redirect = chrome.children?.find(
      (route) => route.redirectTo !== undefined
    );

    expect(redirect?.redirectTo).toBe('catalog/shops');
  });
});

/**
 * A list that is part of a larger page (admin plan 0042).
 *
 * The same list component in every case, told through route `data` which part
 * of the page it is. A second list component is what the plan forbids.
 */
describe('resourceTabRoute', () => {
  const tab = resourceTabRoute(shops);

  it('is the list alone, at the resource own segment', () => {
    expect(tab.path).toBe('shops');
    expect(tab.component).toBe(ResourceListPage);
    expect(tab.children).toBeUndefined();
  });

  it('tells the list that the page above drew the header', () => {
    expect(tab.data).toEqual({
      [RESOURCE_DESCRIPTOR]: shops,
      [RESOURCE_LIST_EMBED]: 'tab',
    });
  });
});

describe('recordRoute', () => {
  /** A caller that mounts by hand cannot mount the page without its guard. */
  it('is the record page at the path it was given, with the leave guard', () => {
    const route = recordRoute(shops, { path: 'members/:id' });

    expect(route.path).toBe('members/:id');
    expect(route.component).toBe(RecordPage);
    expect(route.canDeactivate).toEqual([recordLeaveGuard]);
    expect(route.data).toEqual({ [RESOURCE_DESCRIPTOR]: shops });
  });

  it('says that the page adds a record, and where the ID is', () => {
    expect(recordRoute(shops, { path: 'new', mode: 'create' }).data).toEqual({
      [RESOURCE_DESCRIPTOR]: shops,
      [RESOURCE_FORM_MODE]: 'create',
    });
    expect(
      recordRoute(shops, { path: 'details', idFrom: 'shopId' }).data
    ).toEqual({
      [RESOURCE_DESCRIPTOR]: shops,
      [RESOURCE_ID_FROM]: 'shopId',
    });
  });

  /** Admin plan 0056, section 2: the page gives way to a child below 72 rem. */
  it('names the child the page gives way to, only where the caller says one', () => {
    expect(
      recordRoute(shops, { path: ':id', yieldsTo: 'aisles' }).data
    ).toEqual({
      [RESOURCE_DESCRIPTOR]: shops,
      [RECORD_YIELDS_TO]: 'aisles',
    });
    expect(recordRoute(shops, { path: ':id' }).data).not.toHaveProperty(
      RECORD_YIELDS_TO
    );
  });
});

describe('resourceFormBranch', () => {
  const branch = resourceFormBranch(shops);
  const children = branch.children ?? [];

  /**
   * Under the segment, so that one route up from a form, which is where the
   * form goes back to, is the address the list is at.
   */
  it('is the record page under the segment, with no list', () => {
    expect(branch.path).toBe('shops');
    expect(branch.component).toBeUndefined();
    expect(children.map((route) => route.path)).toEqual(['new', ':id']);
    expect(children.map((route) => route.component)).toEqual([
      RecordPage,
      RecordPage,
    ]);
  });

  it('states the descriptor on each route, and the mode on the one that adds', () => {
    expect(children[0].data).toEqual({
      [RESOURCE_DESCRIPTOR]: shops,
      [RESOURCE_FORM_MODE]: 'create',
    });
    expect(children[1].data).toEqual({ [RESOURCE_DESCRIPTOR]: shops });
  });

  /** The rules of the three routes hold for the two of them. */
  it('leaves out what the resource cannot do', () => {
    const readOnly = defineResource<Shop>({
      ...shops,
      actions: { edit: true },
    });
    const listOnly = defineResource<Shop>({ ...shops, actions: {} });

    expect(
      resourceFormBranch(readOnly).children?.map((route) => route.path)
    ).toEqual([':id']);
    expect(resourceFormBranch(listOnly).children).toEqual([]);
  });

  it('mounts the resource own editor where it named one', () => {
    class ShopEditor {}
    const withEditor = defineResource<Shop>({ ...shops, editor: ShopEditor });

    expect(
      resourceFormBranch(withEditor).children?.map((route) => route.component)
    ).toEqual([ShopEditor, ShopEditor]);
  });
});

describe('resourceCreateRoute', () => {
  it('is the create form alone, for a caller that mounts the rest', () => {
    const create = resourceCreateRoute(shops);

    expect(create.path).toBe('new');
    expect(create.component).toBe(ResourceFormPage);
    expect(create.data).toEqual({
      [RESOURCE_DESCRIPTOR]: shops,
      [RESOURCE_FORM_MODE]: 'create',
    });
  });

  it('uses the resource own editor where it named one', () => {
    class ShopEditor {}
    const withEditor = defineResource<Shop>({ ...shops, editor: ShopEditor });

    expect(resourceCreateRoute(withEditor).component).toBe(ShopEditor);
  });
});

describe('resourceSplitRoute', () => {
  class ShopPage {}

  const open = [{ path: ':shopId', component: ShopPage }];
  const split = resourceSplitRoute(shops, {
    children: open,
    listWidth: '340px',
    underHeader: true,
    emptyKey: 'shops.pick',
  });

  it('is the split page at the segment, with what can be open as its children', () => {
    expect(split.path).toBe('shops');
    expect(split.component).toBe(ResourceSplitPage);
    expect(split.children).toBe(open);
  });

  it('tells the list it is a column, and the page how to lay it out', () => {
    expect(split.data).toEqual({
      [RESOURCE_DESCRIPTOR]: shops,
      [RESOURCE_LIST_EMBED]: 'column',
      [SPLIT_LIST_WIDTH]: '340px',
      [SPLIT_UNDER_HEADER]: true,
      [SPLIT_EMPTY_KEY]: 'shops.pick',
    });
  });

  /** A split under nothing, with nothing to say while no row is open. */
  it('answers plainly for what the caller left out', () => {
    const bare = resourceSplitRoute(shops, {
      children: [],
      listWidth: '216px',
    });

    expect(bare.data?.[SPLIT_UNDER_HEADER]).toBe(false);
    expect(bare.data?.[SPLIT_EMPTY_KEY]).toBeNull();
  });
});

/**
 * A section that holds its resources mounts them itself, through its screens
 * (admin plan 0042). The route factory must not also mount them as flat lists,
 * or `/shops` would answer with a list that has no chain to read.
 */
describe('adminRoutes with held resources', () => {
  const screen = { path: 'chains', children: [] };
  const children =
    adminRoutes([
      {
        key: 'chains',
        label: 'shell.sections.chains',
        held: [shops, items],
        screens: [screen],
      },
    ])[0].children ?? [];
  const branch = children.find((route) => route.children !== undefined);

  it('mounts the section screens and nothing for what it holds', () => {
    expect(branch?.children).toEqual([screen]);
  });

  /** A held resource is not somewhere the empty path can land. */
  it('emits no redirect to a held resource', () => {
    expect(children.filter((route) => route.redirectTo !== undefined)).toEqual(
      []
    );
  });
});

/**
 * A section whose own address is no screen (admin plan 0044): the harvester
 * has three tabs and opens on the first.
 */
describe('adminRoutes with a section that opens on one of its tabs', () => {
  class Home {}

  const review = { path: 'review', children: [] };
  const branchOf = (section: AdminSection) =>
    (adminRoutes([section])[0].children ?? []).find(
      (route) => route.path === 'harvest'
    );

  const section: AdminSection = {
    key: 'harvest',
    label: 'shell.sections.harvest',
    segment: 'harvest',
    landing: 'review',
    screens: [review],
  };

  it('redirects the section own address to that tab, after its screens', () => {
    const children = branchOf(section)?.children ?? [];

    expect(children.map((route) => route.path)).toEqual(['review', '']);
    expect(children[1]).toEqual({
      path: '',
      pathMatch: 'full',
      redirectTo: 'review',
    });
  });

  /**
   * Relative, so it is resolved under the section's segment, and the query
   * parameters of the address ride along.
   */
  it('redirects relative to the section', () => {
    const redirect = (branchOf(section)?.children ?? []).find(
      (route) => route.path === ''
    );

    expect(String(redirect?.redirectTo).startsWith('/')).toBe(false);
  });

  /** The home is declared first and would win, so no redirect is declared. */
  it('declares no redirect beside a home', () => {
    const children = branchOf({ ...section, home: Home })?.children ?? [];
    const empty = children.filter((route) => route.path === '');

    expect(empty).toHaveLength(1);
    expect(empty[0].component).toBe(Home);
    expect(empty[0].redirectTo).toBeUndefined();
  });

  it('declares none for a section that names no landing', () => {
    const children =
      branchOf({ ...section, landing: undefined })?.children ?? [];

    expect(children.map((route) => route.path)).toEqual(['review']);
  });

  /** A held resource is mounted by the section's own table, wherever it holds it. */
  it('mounts no resource the section holds under a tab', () => {
    const children =
      branchOf({ ...section, held: [shops], heldUnder: 'setup' })?.children ??
      [];

    expect(children.map((route) => route.path)).toEqual(['review', '']);
  });
});

/**
 * The routes of a record that holds tabs (admin plan 0054, section 2.2).
 *
 * A tab is a child route, so it has an address and a reload stays on it. The
 * page reads the address of each tab from the route that carries its key.
 */
describe('recordRoute, for a record with tabs', () => {
  class NotesTab {}

  const withTabs = (
    children: NonNullable<
      NonNullable<
        Parameters<typeof defineResource<Shop>>[0]['record']
      >['children']
    >,
    details?: 'last'
  ) =>
    defineResource<Shop>({
      ...(shops as unknown as Parameters<typeof defineResource<Shop>>[0]),
      name: 'chains',
      segment: 'chains',
      record: { sections: [], children, details },
    });

  const byName = (name: string) =>
    [shops, items, logs].find((descriptor) => descriptor.name === name);

  it('is the page alone for a record with no tab', () => {
    const chains = withTabs([{ as: 'link', resource: 'items', by: 'chainId' }]);

    const route = recordRoute(chains, { path: ':id' });

    expect(route.component).toBe(RecordPage);
    expect(route.children).toBeUndefined();
  });

  it('mounts Details, then a part at its name, and opens on the first', () => {
    const chains = withTabs([
      { as: 'tab', name: 'notes', label: 'chains.notes', component: NotesTab },
    ]);

    const route = recordRoute(chains, { path: ':id' });
    const [first, details, notes] = route.children ?? [];

    expect(route.component).toBe(RecordPage);
    expect(route.canDeactivate).toEqual([recordLeaveGuard]);
    expect(first).toEqual({
      path: '',
      pathMatch: 'full',
      redirectTo: 'details',
    });
    expect(details).toEqual({
      path: 'details',
      component: RecordDetailsTab,
      canDeactivate: [recordLeaveGuard],
      data: { [RECORD_TAB]: 'details' },
    });
    expect(notes).toEqual({
      path: 'notes',
      component: NotesTab,
      data: { [RECORD_TAB]: 'notes' },
    });
  });

  it('puts Details last, and opens on the first tab, when the block says so', () => {
    const chains = withTabs(
      [
        {
          as: 'tab',
          name: 'notes',
          label: 'chains.notes',
          component: NotesTab,
        },
      ],
      'last'
    );

    const children = recordRoute(chains, { path: ':id' }).children ?? [];

    expect(children.map((route) => route.path)).toEqual([
      '',
      'notes',
      'details',
    ]);
    expect(children[0].redirectTo).toBe('notes');
  });

  it('mounts a list tab at the segment of its resource, fixed by `by`', () => {
    const chains = withTabs([{ as: 'tab', resource: 'logs', by: 'chainId' }]);

    const route = recordRoute(chains, { path: ':id', lists: byName });
    const list = route.children?.[2];

    expect(list).toEqual({
      path: 'logs',
      component: ResourceListPage,
      data: {
        [RESOURCE_DESCRIPTOR]: logs,
        [RESOURCE_LIST_EMBED]: 'tab',
        [RECORD_TAB]: 'logs',
        [RESOURCE_LIST_FIXED]: 'chainId',
      },
    });
  });

  /**
   * A tab mounted from `lists` has no routes under it, so a row that opens
   * or a button that adds would lead to an address nothing answers.
   */
  it('refuses to mount by itself a list tab that opens or adds rows', () => {
    const opens = withTabs([{ as: 'tab', resource: 'items', by: 'chainId' }]);
    const adds = withTabs([
      { as: 'tab', resource: 'logs', by: 'chainId', add: 'logs.add' },
    ]);

    expect(() => recordRoute(opens, { path: ':id', lists: byName })).toThrow(
      /The tab "items" of "chains" opens or adds rows/
    );
    expect(() => recordRoute(adds, { path: ':id', lists: byName })).toThrow(
      /The tab "logs" of "chains" opens or adds rows/
    );
    // The same tab through `tabs` is the caller's to mount, with its forms.
    expect(() =>
      recordRoute(opens, {
        path: ':id',
        tabs: { items: resourceTabRoute(items) },
      })
    ).not.toThrow();
  });

  it('refuses two tabs that are known by the same key', () => {
    const chains = withTabs([
      { as: 'tab', resource: 'logs', by: 'chainId' },
      { as: 'tab', resource: 'logs', by: 'ownerId' },
    ]);

    expect(() => recordRoute(chains, { path: ':id', lists: byName })).toThrow(
      /Two tabs of "chains" are known by "logs"/
    );
  });

  it('refuses two children that `counts` would count under one key', () => {
    const chains = defineResource<Shop>({
      ...(shops as unknown as Parameters<typeof defineResource<Shop>>[0]),
      name: 'chains',
      segment: 'chains',
      record: {
        sections: [],
        children: [
          { as: 'link', resource: 'logs', by: 'chainId' },
          { as: 'panel', resource: 'logs', by: 'ownerId' },
        ],
        counts: () => () => signal({}),
      },
    });

    expect(() => recordRoute(chains, { path: ':id' })).toThrow(
      /Two children counted by `counts` of "chains" are known by "logs"/
    );
  });

  it('allows children of one resource that are found by no key', () => {
    const children = [
      { as: 'tab', resource: 'logs', by: 'chainId', count: 'name' },
      { as: 'link', resource: 'logs', by: 'chainId', count: 'name' },
      { as: 'panel', resource: 'logs', by: 'ownerId', count: 'name' },
      // One tab and one child that `counts` counts may share a key: the
      // address finds the first by it, and `counts` the second.
      { as: 'link', resource: 'logs', by: 'ownerId' },
    ] as const;
    const counted = defineResource<Shop>({
      ...(shops as unknown as Parameters<typeof defineResource<Shop>>[0]),
      name: 'chains',
      segment: 'chains',
      record: { sections: [], children, counts: () => () => signal({}) },
    });
    // With no `counts`, a child with no `count` field is found by nothing.
    const uncounted = withTabs([
      { as: 'link', resource: 'logs', by: 'chainId' },
      { as: 'link', resource: 'logs', by: 'ownerId' },
    ]);

    expect(() =>
      recordRoute(counted, { path: ':id', lists: byName })
    ).not.toThrow();
    expect(() => recordRoute(uncounted, { path: ':id' })).not.toThrow();
  });

  it('takes the whole route of a tab from the caller, and marks it', () => {
    const chains = withTabs([
      { as: 'tab', resource: 'items', by: 'chainId' },
      { as: 'tab', name: 'notes', label: 'chains.notes', component: NotesTab },
    ]);
    class PricesTab {}
    class PriceForm {}

    const route = recordRoute(chains, {
      path: ':id',
      tabs: {
        items: resourceSplitRoute(items, { children: [], listWidth: '20rem' }),
        notes: {
          path: 'prices',
          component: PricesTab,
          children: [{ path: ':scope', component: PriceForm }],
        },
      },
    });
    const [, , split, notes] = route.children ?? [];

    expect(split.component).toBe(ResourceSplitPage);
    expect(split.data?.[RECORD_TAB]).toBe('items');
    expect(split.data?.[RESOURCE_LIST_FIXED]).toBe('chainId');
    expect(split.data?.[RESOURCE_LIST_EMBED]).toBe('column');
    // The route says how the tab is mounted, down to its own path.
    expect(notes.path).toBe('prices');
    expect(notes.component).toBe(PricesTab);
    expect(notes.children).toHaveLength(1);
    expect(notes.data).toEqual({ [RECORD_TAB]: 'notes' });
  });

  it('says so at once when a list tab has neither a route nor a descriptor', () => {
    const chains = withTabs([{ as: 'tab', resource: 'items', by: 'chainId' }]);

    expect(() => recordRoute(chains, { path: ':id' })).toThrow(
      /The tab "items" of "chains" has no route/
    );
  });

  it('gives the page that adds a record no tabs', () => {
    const chains = withTabs([
      { as: 'tab', name: 'notes', label: 'chains.notes', component: NotesTab },
    ]);

    const route = recordRoute(chains, { path: 'new', mode: 'create' });

    expect(route.children).toBeUndefined();
  });

  it('finds the list of a tab among every resource the app names', () => {
    const chains = withTabs([{ as: 'tab', resource: 'logs', by: 'chainId' }]);

    const [shell] = adminRoutes([
      { key: 'a', label: 'a', segment: 'a', resources: [chains] },
      { key: 'b', label: 'b', segment: 'b', held: [logs] },
    ]);
    const record = shell.children
      ?.find((route) => route.path === 'a')
      ?.children?.find((route) => route.path === 'chains')
      ?.children?.find((route) => route.path === ':id');

    expect(record?.children?.map((route) => route.path)).toEqual([
      '',
      'details',
      'logs',
    ]);
  });
});

describe('recordEditRedirect', () => {
  it('is a route at `:id/edit` that draws nothing of its own', () => {
    const route = recordEditRedirect();

    expect(route.path).toBe(':id/edit');
    expect(route.component).toBeUndefined();
    expect(route.canActivate).toHaveLength(1);
  });
});
