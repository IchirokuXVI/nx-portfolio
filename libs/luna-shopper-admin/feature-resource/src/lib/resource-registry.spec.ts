import { inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  convertToParamMap,
  type ActivatedRouteSnapshot,
} from '@angular/router';
import {
  ContentLocaleStore,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import {
  provideResources,
  provideSections,
  sectionLink,
  sectionScreens,
  type AdminSection,
} from './admin-section';
import {
  parentsFromRoute,
  ResourceReferences,
  ResourceRegistry,
} from './resource-registry';
import { routeParam } from './resource-route-data';

interface Scope {
  id: string;
  label: string;
}

const scopes = defineResource<Scope>({
  name: 'price-scopes',
  segment: 'price-scopes',
  labels: { one: 'scopes.one', many: 'scopes.many' },
  title: (row) => row.label,
  fields: [{ kind: 'text', name: 'label', label: 'scopes.label' }],
  list: { columns: ['label'], compact: ['label'] },
  filters: [{ kind: 'search', param: 'query', label: 'scopes.search' }],
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Scope>({
      path: '/v1/admin/catalog/price-scopes',
      seed: [
        { id: 'ps_1', label: 'Catalonia' },
        { id: 'ps_2', label: 'Madrid' },
      ],
    }),
});

/**
 * The registry, and the reference lookup built on it (plan 0004, section 6).
 *
 * Everything runs against the in-memory gateways, which is the default behind
 * `RESOURCE_GATEWAYS`, so nothing here needs a backend or an `HttpClient`.
 */
describe('ResourceRegistry', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
      ContentLocaleStore,provideResources(scopes)],
    });
  });

  it('finds a resource by the name a reference field points at', () => {
    expect(TestBed.inject(ResourceRegistry).byName('price-scopes')).toBe(
      scopes
    );
  });

  it('has nothing to say about a resource the app did not mount', () => {
    expect(TestBed.inject(ResourceRegistry).byName('items')).toBeUndefined();
  });

  /**
   * A resource mounted at the root, which is what `provideResources` makes and
   * what this app was before it had sections.
   */
  it('answers where a resource with no section around it lives', () => {
    expect(TestBed.inject(ResourceRegistry).pathOf('price-scopes')).toEqual([
      '/',
      'price-scopes',
    ]);
  });

  it('has no path for a resource the app did not mount', () => {
    expect(TestBed.inject(ResourceRegistry).pathOf('items')).toBeNull();
  });

  /**
   * `descriptor.gateway()` calls `inject`, and the registry is asked for one
   * long after it was constructed. Without an injection context the call throws
   * rather than answering, which is the sort of failure that only shows up when
   * somebody opens a form.
   */
  it('builds a gateway outside the moment it was constructed in', async () => {
    const registry = TestBed.inject(ResourceRegistry);

    const page = await registry.gatewayFor(scopes).list({});

    expect(page.items).toHaveLength(2);
  });
});

describe('ResourceReferences', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
      ContentLocaleStore,provideResources(scopes)],
    });
  });

  it('shows the target by name, not by id', async () => {
    const references = TestBed.inject(ResourceReferences);

    await expect(references.resolve('price-scopes', 'ps_2')).resolves.toEqual({
      id: 'ps_2',
      title: 'Madrid',
      // The row rides along, so a references field can ask whether the
      // target is locked (admin plan 0028, section 4.1).
      row: { id: 'ps_2', label: 'Madrid' },
    });
  });

  /**
   * A reference can outlive what it points at. The picker draws that state, so
   * it has to be a value rather than an exception.
   */
  it('answers nothing for an id that no longer exists', async () => {
    const references = TestBed.inject(ResourceReferences);

    await expect(
      references.resolve('price-scopes', 'gone')
    ).resolves.toBeNull();
  });

  it('searches through the target resource own search filter', async () => {
    const references = TestBed.inject(ResourceReferences);

    await expect(references.search('price-scopes', 'madr')).resolves.toEqual([
      { id: 'ps_2', title: 'Madrid' },
    ]);
  });

  /**
   * A picker that showed nothing until something was typed would hide the
   * answer from an operator who does not know what the options are called.
   */
  it('offers the first page when nothing has been typed', async () => {
    const references = TestBed.inject(ResourceReferences);

    await expect(references.search('price-scopes', '')).resolves.toHaveLength(
      2
    );
  });

  it('finds nothing for a resource that does not exist, rather than throwing', async () => {
    const references = TestBed.inject(ResourceReferences);

    await expect(references.search('items', 'x')).resolves.toEqual([]);
    await expect(references.resolve('items', 'x')).resolves.toBeNull();
  });
});

/**
 * Where a resource lives, once a section owns a segment (admin plan 0022,
 * section 3).
 *
 * The registry is the right owner because it is built from the same sections
 * that declare the routes, so a path it answers is a path that exists.
 */
describe('ResourceRegistry pathOf', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
      ContentLocaleStore,
        provideSections(
          {
            key: 'catalog',
            label: 'c',
            segment: 'catalog',
            resources: [scopes],
          },
          { key: 'admins', label: 'a', resources: [] }
        ),
      ],
    });
  });

  it('names the section a resource is mounted in', () => {
    expect(TestBed.inject(ResourceRegistry).pathOf('price-scopes')).toEqual([
      '/',
      'catalog',
      'price-scopes',
    ]);
  });

  /**
   * A refusal's link: a row of the target, or its list narrowed to the id
   * when the link names a filter (admin plan 0036).
   */
  it('builds a refusal link to a row, or to a narrowed list', () => {
    const registry = TestBed.inject(ResourceRegistry);

    expect(
      registry.linkFor({ resource: 'price-scopes', detail: 'scopeId' }, 'ps_1')
    ).toEqual({
      commands: ['/', 'catalog', 'price-scopes', 'ps_1'],
      labelKey: 'resource.error.openRow',
    });
    expect(
      registry.linkFor(
        { resource: 'price-scopes', filter: 'categoryId', label: 'open' },
        'cat_milk'
      )
    ).toEqual({
      commands: ['/', 'catalog', 'price-scopes'],
      queryParams: { categoryId: 'cat_milk' },
      labelKey: 'open',
    });
    expect(registry.linkFor({ resource: 'items' }, 'x')).toBeNull();
  });

  it('registers every resource a section mounted', () => {
    expect(
      TestBed.inject(ResourceRegistry)
        .all()
        .map((descriptor) => descriptor.name)
    ).toEqual(['price-scopes']);
  });
});

/**
 * A resource that lives under a row of another (admin plan 0042).
 *
 * Three levels, which is what the app has: a chain, its shops, and the products
 * in one shop. The descriptors here are small copies of that shape, because a
 * spec in this library cannot import the catalog, which is lazy.
 */
interface Row {
  id: string;
  name: string;
}

function resource(
  name: string,
  segment: string,
  parent?: { resource: string; param: string; filter: string }
) {
  return defineResource<Row>({
    name,
    segment,
    labels: { one: `${name}.one`, many: `${name}.many` },
    title: (row) => row.name,
    fields: [{ kind: 'text', name: 'name', label: `${name}.name` }],
    list: { columns: ['name'], compact: ['name'] },
    actions: { edit: true },
    ...(parent === undefined ? {} : { parent }),
    gateway: () => {
      throw new Error('not used');
    },
  });
}

const chains = resource('supermarkets', 'chains');
const shops = resource('locations', 'shops', {
  resource: 'supermarkets',
  param: 'chainId',
  filter: 'supermarketId',
});
const shopProducts = resource('location-items', 'products', {
  resource: 'locations',
  param: 'shopId',
  filter: 'supermarketLocationId',
});

/** A parent the app did not mount, so nothing under it has an address. */
const orphans = resource('orphans', 'orphans', {
  resource: 'nowhere',
  param: 'nowhereId',
  filter: 'nowhereId',
});

const chainsSection: AdminSection = {
  key: 'chains',
  label: 'shell.sections.chains',
  held: [chains, shops, shopProducts, orphans],
  screens: [],
};

describe('ResourceRegistry with resources a section holds', () => {
  let registry: ResourceRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ContentLocaleStore,
        provideSections(chainsSection, {
          key: 'catalog',
          label: 'c',
          segment: 'catalog',
          resources: [scopes],
        }),
      ],
    });
    registry = TestBed.inject(ResourceRegistry);
  });

  /**
   * The route factory does not mount a held resource, and the registry still
   * has to find it: a reference field pointing at a chain must resolve.
   */
  it('finds a held resource by name, beside the mounted ones', () => {
    expect(registry.byName('supermarkets')).toBe(chains);
    expect(registry.byName('location-items')).toBe(shopProducts);
    expect(registry.all().map((descriptor) => descriptor.name)).toEqual([
      'supermarkets',
      'locations',
      'location-items',
      'orphans',
      'price-scopes',
    ]);
  });

  it('answers a held resource with no parent at its own segment', () => {
    expect(registry.pathOf('supermarkets')).toEqual(['/', 'chains']);
    expect(registry.rowPath('supermarkets', 'sm_1')).toEqual([
      '/',
      'chains',
      'sm_1',
    ]);
  });

  it('puts the section segment in front of a held resource', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ContentLocaleStore,
        provideSections({ ...chainsSection, segment: 'stores' }),
      ],
    });

    expect(TestBed.inject(ResourceRegistry).pathOf('supermarkets')).toEqual([
      '/',
      'stores',
      'chains',
    ]);
  });

  it('lists a parented resource under the row of its parent', () => {
    expect(registry.pathOf('locations', { supermarketId: 'sm_1' })).toEqual([
      '/',
      'chains',
      'sm_1',
      'shops',
    ]);
    expect(
      registry.rowPath('locations', 'loc_1', { supermarketId: 'sm_1' })
    ).toEqual(['/', 'chains', 'sm_1', 'shops', 'loc_1']);
  });

  /**
   * A list can fall back to the list above it, where the operator picks the
   * chain. A row cannot, because the list above is not the row.
   */
  it('falls back to the list above when the parent is unknown, and gives a row no address', () => {
    expect(registry.pathOf('locations')).toEqual(['/', 'chains']);
    expect(registry.pathOf('locations', { supermarketId: '' })).toEqual([
      '/',
      'chains',
    ]);
    expect(registry.rowPath('locations', 'loc_1')).toBeNull();
    expect(
      registry.rowPath('locations', 'loc_1', { supermarketId: '' })
    ).toBeNull();
    // An id that is not a string is not an id.
    expect(
      registry.rowPath('locations', 'loc_1', { supermarketId: 7 })
    ).toBeNull();
  });

  it('builds an address two levels deep', () => {
    const known = { supermarketId: 'sm_1', supermarketLocationId: 'loc_1' };

    expect(registry.pathOf('location-items', known)).toEqual([
      '/',
      'chains',
      'sm_1',
      'shops',
      'loc_1',
      'products',
    ]);
    expect(registry.rowPath('location-items', 'it_1:loc_1', known)).toEqual([
      '/',
      'chains',
      'sm_1',
      'shops',
      'loc_1',
      'products',
      'it_1:loc_1',
    ]);
  });

  /**
   * The shop is known and its chain is not, so the shop has no address and
   * neither has anything in it. The list falls back level by level, to the
   * first list that does have one.
   */
  it('falls back through every level that is missing', () => {
    const known = { supermarketLocationId: 'loc_1' };

    expect(registry.pathOf('location-items', known)).toEqual(['/', 'chains']);
    expect(registry.rowPath('location-items', 'x', known)).toBeNull();
    expect(
      registry.pathOf('location-items', { supermarketId: 'sm_1' })
    ).toEqual(['/', 'chains', 'sm_1', 'shops']);
  });

  /** A row read off the gateway carries the ids, and is passed as it is. */
  it('reads the parent out of a whole row', () => {
    const row = {
      id: 'loc_1',
      supermarketId: 'sm_1',
      address: 'Calle Feria 12',
      priceScopeIds: ['ps_1'],
    };

    expect(registry.rowPath('locations', row.id, row)).toEqual([
      '/',
      'chains',
      'sm_1',
      'shops',
      'loc_1',
    ]);
  });

  it('has no address under a parent the app did not mount', () => {
    expect(registry.pathOf('orphans', { nowhereId: 'n1' })).toBeNull();
    expect(registry.pathOf('orphans')).toBeNull();
    expect(registry.rowPath('orphans', 'o1', { nowhereId: 'n1' })).toBeNull();
  });

  it('builds a refusal link under the parent the caller knows', () => {
    expect(
      registry.linkFor({ resource: 'locations' }, 'loc_1', {
        supermarketId: 'sm_1',
      })
    ).toEqual({
      commands: ['/', 'chains', 'sm_1', 'shops', 'loc_1'],
      labelKey: 'resource.error.openRow',
    });
    expect(
      registry.linkFor(
        { resource: 'locations', filter: 'priceScopeId', label: 'open' },
        'ps_1',
        { supermarketId: 'sm_1' }
      )
    ).toEqual({
      commands: ['/', 'chains', 'sm_1', 'shops'],
      queryParams: { priceScopeId: 'ps_1' },
      labelKey: 'open',
    });
  });

  /** A row whose parent nobody named gets no link, which is still an answer. */
  it('builds no refusal link to a row whose parent is unknown', () => {
    expect(registry.linkFor({ resource: 'locations' }, 'loc_1')).toBeNull();
  });
});

/**
 * A route snapshot as the router builds one under routes that have a
 * component: each level holds only its own parameters.
 */
function snapshotOf(
  ...levels: readonly Record<string, string>[]
): ActivatedRouteSnapshot {
  const path = levels.map((params) => ({
    paramMap: convertToParamMap(params),
  }));
  const leaf = { ...path[path.length - 1], pathFromRoot: path };
  path[path.length - 1] = leaf;
  return leaf as unknown as ActivatedRouteSnapshot;
}

describe('the parents an address names', () => {
  let registry: ResourceRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ContentLocaleStore, provideSections(chainsSection)],
    });
    registry = TestBed.inject(ResourceRegistry);
  });

  it('reads a parameter from the closest route that holds it', () => {
    const route = snapshotOf({ chainId: 'far' }, { chainId: 'near' }, {});

    expect(routeParam(route, 'chainId')).toBe('near');
    expect(routeParam(route, 'shopId')).toBeNull();
  });

  it('names every parent above a resource by its filter', () => {
    const route = snapshotOf({}, { chainId: 'sm_1' }, { shopId: 'loc_1' }, {});

    expect(parentsFromRoute(registry, shopProducts, route)).toEqual({
      supermarketId: 'sm_1',
      supermarketLocationId: 'loc_1',
    });
    expect(parentsFromRoute(registry, shops, route)).toEqual({
      supermarketId: 'sm_1',
    });
  });

  it('leaves out a parent the address does not name', () => {
    const route = snapshotOf({}, { shopId: 'loc_1' });

    expect(parentsFromRoute(registry, shopProducts, route)).toEqual({
      supermarketLocationId: 'loc_1',
    });
    expect(parentsFromRoute(registry, chains, route)).toEqual({});
  });

  /** What it answers is what `pathOf` wants as `known`. */
  it('feeds the registry the address of where the screen already is', () => {
    const route = snapshotOf({ chainId: 'sm_1' }, { shopId: 'loc_1' });

    expect(
      registry.pathOf(
        'location-items',
        parentsFromRoute(registry, shopProducts, route)
      )
    ).toEqual(['/', 'chains', 'sm_1', 'shops', 'loc_1', 'products']);
  });
});

/**
 * Where the rail entry of a section points, for a section that mounts its own
 * resources (admin plan 0042).
 */
describe('sectionLink for a section that holds its resources', () => {
  it('opens on the held resource that has no parent', () => {
    expect(sectionLink(chainsSection)).toBe('/chains');
    expect(
      sectionLink({ ...chainsSection, held: [shops, shopProducts, chains] })
    ).toBe('/chains');
  });

  it('goes through the segment of a section that has one', () => {
    expect(sectionLink({ ...chainsSection, segment: 'stores' })).toBe(
      '/stores/chains'
    );
  });

  it('has nowhere to point when every held resource is under a parent', () => {
    expect(sectionLink({ ...chainsSection, held: [shops] })).toBeNull();
  });

  /**
   * A held resource is a page or a tab of one, and no tab of its section,
   * unless the section says its held resources are its tabs.
   */
  it('draws no second row entry for a held resource', () => {
    expect(sectionScreens(chainsSection)).toEqual([]);
  });

  it('still prefers a home, and then a screen of its own', () => {
    class Home {}

    expect(sectionLink({ ...chainsSection, home: Home })).toBe('/');
    expect(
      sectionLink({
        ...chainsSection,
        links: [{ path: '/runs', label: 'runs' }],
      })
    ).toBe('/runs');
  });
});

/**
 * A section whose held resources are its tabs, one of them at the section's
 * own address (admin plan 0043): the products at `/products`, their groups at
 * `/products/groups`, and a price under one product.
 */
const products = resource('items', '');
const groups = resource('product-groups', 'groups');
const rules = resource('price-policies', 'price-rules');
const prices = resource('prices', 'prices', {
  resource: 'items',
  param: 'productId',
  filter: 'itemId',
});

const productsSection: AdminSection = {
  key: 'products',
  label: 'shell.sections.products',
  segment: 'products',
  held: [products, groups, rules, prices],
  heldTabs: true,
  screens: [],
};

describe('a section whose held resources are its tabs', () => {
  let registry: ResourceRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ContentLocaleStore, provideSections(productsSection)],
    });
    registry = TestBed.inject(ResourceRegistry);
  });

  it('puts a resource with no segment at the address of its section', () => {
    expect(registry.pathOf('items')).toEqual(['/', 'products']);
    // A row of it is one segment under the section, with nothing between.
    expect(registry.rowPath('items', 'i1')).toEqual(['/', 'products', 'i1']);
  });

  it('puts the others one segment under it', () => {
    expect(registry.pathOf('product-groups')).toEqual([
      '/',
      'products',
      'groups',
    ]);
    expect(registry.rowPath('price-policies', 'ADMIN')).toEqual([
      '/',
      'products',
      'price-rules',
      'ADMIN',
    ]);
  });

  it('addresses a resource under a row of the one with no segment', () => {
    expect(registry.pathOf('prices', { itemId: 'i1' })).toEqual([
      '/',
      'products',
      'i1',
      'prices',
    ]);
    // With no product named, the place a product is picked.
    expect(registry.pathOf('prices')).toEqual(['/', 'products']);
  });

  it('draws one tab for each held resource that has no parent, in order', () => {
    expect(sectionScreens(productsSection)).toEqual([
      // Current only on exactly its own address: every other tab is under it.
      { path: '/products', label: 'items.many', exact: true },
      { path: '/products/groups', label: 'product-groups.many' },
      { path: '/products/price-rules', label: 'price-policies.many' },
    ]);
  });

  it('opens on the resource at its own address', () => {
    expect(sectionLink(productsSection)).toBe('/products');
  });

  it('draws no tab for them unless the section says so', () => {
    expect(sectionScreens({ ...productsSection, heldTabs: false })).toEqual([]);
    // It still opens on the resource that has no parent.
    expect(sectionLink({ ...productsSection, heldTabs: false })).toBe(
      '/products'
    );
  });

  it('keeps the tabs after the links a section wrote by hand', () => {
    expect(
      sectionScreens({
        ...productsSection,
        links: [{ path: '/products/import', label: 'import' }],
      }).map((screen) => screen.path)
    ).toEqual([
      '/products/import',
      '/products',
      '/products/groups',
      '/products/price-rules',
    ]);
  });

  it('puts a resource with no segment at the root when its section has none', () => {
    const { segment: _segment, ...rooted } = productsSection;

    expect(sectionScreens(rooted)[0]).toEqual({
      path: '/',
      label: 'items.many',
      exact: true,
    });
    expect(sectionLink(rooted)).toBe('/');
  });
});

/**
 * A section that opens on one of its tabs and holds its resources under
 * another (admin plan 0044): the harvester, whose own address goes to Review
 * and whose brands and postal codes are parts of Setup.
 */
const brands = resource('brands', 'brands');
const postalCodes = resource('postal-codes', 'postal-codes');

const harvestSection: AdminSection = {
  key: 'harvest',
  label: 'shell.sections.harvest',
  segment: 'harvest',
  landing: 'review',
  held: [brands, postalCodes],
  heldUnder: 'setup',
  screens: [],
  links: [
    { path: '/harvest/review', label: 'review' },
    { path: '/harvest/runs', label: 'runs' },
    { path: '/harvest/setup', label: 'setup' },
  ],
};

describe('a section that holds its resources under one of its tabs', () => {
  let registry: ResourceRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ContentLocaleStore,
        provideSections(harvestSection, productsSection),
      ],
    });
    registry = TestBed.inject(ResourceRegistry);
  });

  it('puts the tab between the section and the resource', () => {
    expect(registry.pathOf('brands')).toEqual([
      '/',
      'harvest',
      'setup',
      'brands',
    ]);
    expect(registry.pathOf('postal-codes')).toEqual([
      '/',
      'harvest',
      'setup',
      'postal-codes',
    ]);
  });

  it('puts a row one segment under that', () => {
    expect(registry.rowPath('brands', 'br_1')).toEqual([
      '/',
      'harvest',
      'setup',
      'brands',
      'br_1',
    ]);
  });

  it('leaves a section that names no such tab as it was', () => {
    expect(registry.pathOf('product-groups')).toEqual([
      '/',
      'products',
      'groups',
    ]);
  });

  /** Only what the section holds is under the tab. What it mounts is not. */
  it('puts a resource the route factory mounts straight under the section', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ContentLocaleStore,
        provideSections({
          ...harvestSection,
          held: [brands],
          resources: [postalCodes],
        }),
      ],
    });
    const mixed = TestBed.inject(ResourceRegistry);

    expect(mixed.pathOf('brands')).toEqual(['/', 'harvest', 'setup', 'brands']);
    expect(mixed.pathOf('postal-codes')).toEqual([
      '/',
      'harvest',
      'postal-codes',
    ]);
  });

  it('holds no tab of its own for a held resource', () => {
    expect(sectionScreens(harvestSection).map((link) => link.path)).toEqual([
      '/harvest/review',
      '/harvest/runs',
      '/harvest/setup',
    ]);
  });
});

describe('sectionLink for a section that opens on one of its tabs', () => {
  /**
   * The entry in the rail points at the segment, and so stays marked on every
   * tab. Pointing at the first tab would leave it unmarked on the two others.
   */
  it('answers the section own segment, and not its first tab', () => {
    expect(sectionLink(harvestSection)).toBe('/harvest');
  });

  it('answers the first screen again once the landing is taken away', () => {
    expect(sectionLink({ ...harvestSection, landing: undefined })).toBe(
      '/harvest/review'
    );
  });

  it('answers the root for such a section with no segment', () => {
    expect(sectionLink({ ...harvestSection, segment: undefined })).toBe('/');
  });
});
