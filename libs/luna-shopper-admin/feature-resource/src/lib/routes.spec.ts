import {
  defineResource,
  type AnyResourceDescriptor,
} from '@portfolio/luna-shopper-admin/models';
import { NotFoundPage } from '@portfolio/luna-shopper-admin/ui';
import type { AdminSection } from './admin-section';
import { AdminShellPage } from './admin-shell-page';
import { ResourceFormPage } from './resource-form-page';
import { ResourceListPage } from './resource-list-page';
import { RESOURCE_DESCRIPTOR, RESOURCE_FORM_MODE } from './resource-route-data';
import { adminRoutes, resourceRoutes } from './routes';

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

/** One section with no segment, which mounts its resources at the root. */
function root(...resources: readonly AnyResourceDescriptor[]): AdminSection[] {
  return [{ key: 'root', label: 'root', resources }];
}

describe('resourceRoutes', () => {
  const [branch] = resourceRoutes(shops);
  const children = branch.children ?? [];

  it('is a list, a create form and an edit form under the segment', () => {
    expect(branch.path).toBe('shops');
    expect(children.map((route) => route.path)).toEqual(['', 'new', ':id']);
    expect(children.map((route) => route.component)).toEqual([
      ResourceListPage,
      ResourceFormPage,
      ResourceFormPage,
    ]);
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

  it('tells the two forms apart by mode', () => {
    expect(children[1].data?.[RESOURCE_FORM_MODE]).toBe('create');
    expect(children[2].data?.[RESOURCE_FORM_MODE]).toBe('edit');
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
