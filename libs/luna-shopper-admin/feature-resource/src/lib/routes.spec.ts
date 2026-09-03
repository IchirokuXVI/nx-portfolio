import {
  defineResource,
  type AnyResourceDescriptor,
} from '@portfolio/luna-shopper-admin/models';
import { NotFoundPage } from '@portfolio/luna-shopper-admin/ui';
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
});

describe('adminRoutes', () => {
  const routes = adminRoutes([shops, items]);
  const children = routes[0].children ?? [];

  it('puts every resource inside the chrome', () => {
    expect(routes).toHaveLength(1);
    expect(routes[0].component).toBe(AdminShellPage);
    expect(children.filter((route) => route.path === 'shops')).toHaveLength(1);
    expect(children.filter((route) => route.path === 'items')).toHaveLength(1);
  });

  it('lands the empty path on the first resource the app named', () => {
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

  it('survives being given no resources at all', () => {
    const empty = adminRoutes([] as readonly AnyResourceDescriptor[]);

    expect(empty[0].children?.map((route) => route.path)).toEqual(['**']);
  });
});
