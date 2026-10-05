import { TestBed } from '@angular/core/testing';
import {
  provideSections,
  ResourceRegistry,
  sectionLink,
  sectionScreens,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { ADMIN_SECTIONS } from './sections';

/**
 * The app's own list of sections (admin plan 0022, section 2).
 *
 * It is what the route table is built from **and** what the registry is read
 * from, so a resource cannot end up reachable without a link, linked without a
 * route, or mounted without being registered. None of the four properties below
 * fails loudly: a repeated segment would shadow a branch, a section with nothing
 * in it would draw a tab that goes nowhere, and a resource registered twice
 * would give the reference picker two answers to the same question.
 */
describe('ADMIN_SECTIONS', () => {
  /**
   * The chains are second, after the overview (admin plan 0042, target 1),
   * and the products third (admin plan 0043, target 1). There is no Catalog
   * section: its ten screens are those two.
   *
   * The harvester is fourth (admin plan 0044; admin plan 0041, section 4).
   * A phone shows the first four and "More", and the harvester is where work
   * waits for a person, so it is one of the four.
   */
  it('is the six sections the plans name, in order', () => {
    expect(ADMIN_SECTIONS.map((section) => section.key)).toEqual([
      'overview',
      'chains',
      'products',
      'harvest',
      'shoppers',
      'admins',
    ]);
  });

  /**
   * The harvester in three tabs (admin plan 0044, target 1). No home: its own
   * address goes to Review, where a person has work. The brands and the postal
   * codes are held under Setup and are no tab of the section.
   */
  it('opens the harvester on Review, with three tabs', () => {
    const harvest = ADMIN_SECTIONS.find((section) => section.key === 'harvest');

    expect(harvest).toBeDefined();
    if (harvest === undefined) {
      return;
    }
    expect(harvest.segment).toBe('harvest');
    expect(harvest.home).toBeUndefined();
    expect(harvest.landing).toBe('review');
    // The entry in the rail is the segment, so it stays marked on every tab.
    expect(sectionLink(harvest)).toBe('/harvest');
    expect(sectionScreens(harvest)).toEqual([
      { path: '/harvest/review', label: 'harvest.tab.review' },
      { path: '/harvest/runs', label: 'harvest.tab.runs' },
      { path: '/harvest/setup', label: 'harvest.tab.setup' },
    ]);
    expect(harvest.resources).toBeUndefined();
    expect((harvest.held ?? []).map((descriptor) => descriptor.name)).toEqual([
      'brands',
      'postal-codes',
    ]);
    expect(harvest.heldUnder).toBe('setup');
    // Somebody counts what waits behind Review, for the tab and for the rail.
    expect(harvest.counts).toBeDefined();
  });

  /**
   * The tab the section opens on is one of its tabs.
   *
   * A section that hands its tabs to the frame names them as links. The
   * Admins section draws its own two (admin plan 0046), so its landing is
   * looked for among the routes of its page.
   */
  it('opens every section that has a landing on one of its own tabs', () => {
    for (const section of ADMIN_SECTIONS) {
      if (section.landing === undefined) {
        continue;
      }
      expect(section.home).toBeUndefined();

      const links = sectionScreens(section).map((screen) => screen.path);
      if (links.length > 0) {
        expect(links).toContain(`/${section.segment}/${section.landing}`);
        continue;
      }

      expect(
        (section.screens ?? [])
          .flatMap((route) => route.children ?? [])
          .map((route) => route.path)
      ).toContain(section.landing);
    }
  });

  /**
   * Admins is a section of its own, with two tabs (admin plan 0046, targets 5
   * and 6): the accounts, and the failed sign ins that left the Overview.
   * Its own address goes to the accounts. It holds no resource, because an
   * admin is never opened, created, changed or removed from here.
   */
  it('opens Admins on its accounts, with the failed sign ins beside them', () => {
    const admins = ADMIN_SECTIONS.find((section) => section.key === 'admins');
    const tabs = (admins?.screens ?? [])
      .flatMap((route) => route.children ?? [])
      .filter((route) => route.redirectTo === undefined)
      .map((route) => route.path);

    expect(admins?.segment).toBe('admins');
    expect(admins?.landing).toBe('accounts');
    expect(tabs).toEqual(['accounts', 'failed-sign-ins']);
    expect(admins?.resources).toBeUndefined();
    expect(admins?.held).toBeUndefined();
    // No count is handed to the frame: a failed sign in is not work that
    // waits for a decision, and the rail would count it as such.
    expect(admins?.counts).toBeUndefined();
    expect(sectionLink(admins as AdminSection)).toBe('/admins');
  });

  /**
   * Around half a dozen is what the first row holds at a glance.
   *
   * Admin plan 0027 added a sixth, Brands, and it went again: one tab for two
   * screens was a click for nothing, and the tab went unmarked on the
   * registered list. Both brand screens are in the harvester now.
   *
   * Admin plan 0042 added the chains, which took five screens out of the
   * catalog's row with them. Six is still half a dozen.
   */
  it('holds six, which is what one row holds', () => {
    expect(ADMIN_SECTIONS).toHaveLength(6);
  });

  /**
   * Ten is the widest row of tabs. The harvester had ten in one flat row, and
   * has three since admin plan 0044. A section that needs more than ten is
   * two sections.
   */
  it('gives no section more than ten screens', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(sectionScreens(section).length).toBeLessThanOrEqual(10);
    }
  });

  /**
   * A home, a tab it lands on, a screen with a link, or a resource it holds
   * and mounts itself: the chains have no home and no second row, and open on
   * the list of chains, and the harvester opens on Review. A section with none
   * of these would draw an entry that goes nowhere.
   */
  it('gives every section somewhere to open', () => {
    for (const section of ADMIN_SECTIONS) {
      expect([section.key, sectionLink(section) !== null]).toEqual([
        section.key,
        true,
      ]);
    }
  });

  it('opens the chains on the list of chains, with no second row', () => {
    const chains = ADMIN_SECTIONS.find((section) => section.key === 'chains');

    expect(chains).toBeDefined();
    if (chains === undefined) {
      return;
    }
    expect(sectionLink(chains)).toBe('/chains');
    expect(chains.segment).toBeUndefined();
    expect(chains.home).toBeUndefined();
    // Held and not mounted: a chain's own page draws the tabs.
    expect(sectionScreens(chains)).toEqual([]);
    expect((chains.held ?? []).map((descriptor) => descriptor.name)).toEqual([
      'supermarkets',
      'locations',
      'sections',
      'price-scopes',
      'location-items',
    ]);
  });

  /**
   * The products open on the product list, and their four lists are the tabs
   * of the section (admin plan 0043, target 1). A price is held as well, under
   * one product, and is no tab.
   */
  it('opens the products on the product list, with four tabs', () => {
    const products = ADMIN_SECTIONS.find(
      (section) => section.key === 'products'
    );

    expect(products).toBeDefined();
    if (products === undefined) {
      return;
    }
    expect(sectionLink(products)).toBe('/products');
    expect(products.home).toBeUndefined();
    expect(sectionScreens(products)).toEqual([
      { path: '/products', label: 'catalog.items.many', exact: true },
      { path: '/products/groups', label: 'catalog.productGroups.many' },
      { path: '/products/categories', label: 'catalog.categories.many' },
      { path: '/products/price-rules', label: 'catalog.pricePolicies.many' },
    ]);
    expect((products.held ?? []).map((descriptor) => descriptor.name)).toEqual([
      'items',
      'product-groups',
      'categories',
      'price-policies',
      'prices',
    ]);
  });

  /**
   * The shoppers open on People, and the two lists that have no parent are
   * the tabs of the section (admin plan 0045, target 1). The other five are
   * held as well, each under a zone or a person, and are no tab.
   */
  it('opens the shoppers on People, with two tabs', () => {
    const shoppers = ADMIN_SECTIONS.find(
      (section) => section.key === 'shoppers'
    );

    expect(shoppers).toBeDefined();
    if (shoppers === undefined) {
      return;
    }
    expect(sectionLink(shoppers)).toBe('/shoppers');
    expect(shoppers.home).toBeUndefined();
    expect(shoppers.landing).toBe('people');
    expect(shoppers.resources).toBeUndefined();
    expect(sectionScreens(shoppers)).toEqual([
      { path: '/shoppers/people', label: 'people.users.many' },
      { path: '/shoppers/zones', label: 'people.zones.many' },
    ]);
    expect((shoppers.held ?? []).map((descriptor) => descriptor.name)).toEqual([
      'users',
      'zones',
      'memberships',
      'lists',
      'list-lines',
      'baskets',
      'zone-baskets',
    ]);
    // Somebody counts the join requests, for the Zones tab and for the rail.
    expect(shoppers.counts).toBeDefined();
  });

  /** The Catalog section is gone, and nothing is mounted under its segment. */
  it('has no catalog section', () => {
    expect(ADMIN_SECTIONS.map((section) => section.segment)).not.toContain(
      'catalog'
    );
    expect(ADMIN_SECTIONS.map((section) => section.label)).not.toContain(
      'shell.sections.catalog'
    );
  });

  /**
   * **A section with one screen has no segment.** Its tab points straight at
   * that screen, because a dashboard summarising one list is a click between the
   * operator and the list.
   */
  it('gives a section with one screen and no home no segment of its own', () => {
    for (const section of ADMIN_SECTIONS) {
      if (section.home === undefined && sectionScreens(section).length === 1) {
        expect(section.segment).toBeUndefined();
      }
    }
  });

  it('gives no two sections the same segment', () => {
    const segments = ADMIN_SECTIONS.map((section) => section.segment).filter(
      (segment): segment is string => segment !== undefined
    );

    expect(new Set(segments).size).toBe(segments.length);
  });

  /**
   * A section segment that collided with a resource mounted at the root would
   * shadow one of the two, and which one depends on declaration order.
   */
  it('gives no section the segment of a resource mounted at the root', () => {
    const rooted = new Set(
      ADMIN_SECTIONS.filter((section) => section.segment === undefined)
        // A held resource with no parent is at the root as well: `/chains`.
        .flatMap((section) => [
          ...(section.resources ?? []),
          ...(section.held ?? []).filter(
            (descriptor) => descriptor.parent === undefined
          ),
        ])
        .map((descriptor) => descriptor.segment)
    );

    for (const section of ADMIN_SECTIONS) {
      if (section.segment !== undefined) {
        expect(rooted.has(section.segment)).toBe(false);
      }
    }
  });

  it('mounts every resource in exactly one section', () => {
    const names = ADMIN_SECTIONS.flatMap((section) =>
      [...(section.resources ?? []), ...(section.held ?? [])].map(
        (descriptor) => descriptor.name
      )
    );

    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * Every resource, at the path its section mounts it under. The whole list
   * rather than a sample, because the point of admin plan 0022 is that every
   * screen reachable before it is reachable after it.
   */
  it('mounts every resource where the plan says', () => {
    TestBed.configureTestingModule({
      providers: [provideSections(...ADMIN_SECTIONS)],
    });
    const registry = TestBed.inject(ResourceRegistry);
    const at = (name: string, known: Record<string, string> = {}) =>
      registry.pathOf(name, known)?.slice(1).join('/');
    const chain = { supermarketId: 'c1' };
    const shop = { ...chain, supermarketLocationId: 's1' };

    // A chain holds its shops (admin plan 0042): the chains at the root, and
    // everything a chain holds under one of them.
    expect(at('supermarkets')).toBe('chains');
    expect(at('locations', chain)).toBe('chains/c1/shops');
    expect(at('sections', chain)).toBe('chains/c1/sections');
    expect(at('price-scopes', chain)).toBe('chains/c1/scopes');
    expect(at('location-items', shop)).toBe('chains/c1/shops/s1/products');
    // With no chain named, each answers the place a chain is picked, so a
    // dashboard tile that counts every shop still leads somewhere.
    expect(at('locations')).toBe('chains');
    expect(at('sections')).toBe('chains');
    expect(at('price-scopes')).toBe('chains');
    expect(at('location-items')).toBe('chains');
    // A shop named without its chain: the chain is still what is missing.
    expect(at('location-items', { supermarketLocationId: 's1' })).toBe(
      'chains'
    );
    // One row, which has an address only when everything above it is known.
    expect(registry.rowPath('supermarkets', 'c1')).toEqual([
      '/',
      'chains',
      'c1',
    ]);
    expect(registry.rowPath('locations', 's1', chain)).toEqual([
      '/',
      'chains',
      'c1',
      'shops',
      's1',
    ]);
    expect(registry.rowPath('locations', 's1')).toBeNull();

    // A product and its prices (admin plan 0043): the products at the
    // section's own address, and the other three lists one segment under it.
    expect(at('items')).toBe('products');
    expect(at('product-groups')).toBe('products/groups');
    expect(at('categories')).toBe('products/categories');
    expect(at('price-policies')).toBe('products/price-rules');
    expect(registry.rowPath('items', 'i1')).toEqual(['/', 'products', 'i1']);
    expect(registry.rowPath('product-groups', 'g1')).toEqual([
      '/',
      'products',
      'groups',
      'g1',
    ]);
    // A price is read on its product, so its list is that product's Prices
    // tab. With no product named, it is the products.
    expect(at('prices', { itemId: 'i1' })).toBe('products/i1/prices');
    expect(at('prices')).toBe('products');
    // A zone holds its members and its lists (admin plan 0045): the people
    // and the zones are the two tabs, and everything else is under one row of
    // one of them.
    const zone = { zoneId: 'z1' };
    const list = { ...zone, listId: 'l1' };
    const owner = { ownerUserId: 'u1' };
    expect(at('users')).toBe('shoppers/people');
    expect(at('zones')).toBe('shoppers/zones');
    expect(at('memberships', zone)).toBe('shoppers/zones/z1/members');
    expect(at('lists', zone)).toBe('shoppers/zones/z1/lists');
    expect(at('list-lines', list)).toBe('shoppers/zones/z1/lists/l1/lines');
    // `shopping-lists` is the baskets' segment, which is the gateway's own
    // name for a basket. A basket belongs to a person, and a zone has a tab
    // of the ones drawn from it.
    expect(at('baskets', owner)).toBe('shoppers/people/u1/shopping-lists');
    expect(at('zone-baskets', zone)).toBe('shoppers/zones/z1/shopping-lists');
    // With no parent named, each answers the closest list that has an
    // address, so a tile that counts every list still leads somewhere.
    expect(at('memberships')).toBe('shoppers/zones');
    expect(at('lists')).toBe('shoppers/zones');
    expect(at('list-lines')).toBe('shoppers/zones');
    expect(at('list-lines', { listId: 'l1' })).toBe('shoppers/zones');
    expect(at('baskets')).toBe('shoppers/people');
    expect(registry.rowPath('users', 'u1')).toEqual([
      '/',
      'shoppers',
      'people',
      'u1',
    ]);
    expect(registry.rowPath('lists', 'l1', zone)).toEqual([
      '/',
      'shoppers',
      'zones',
      'z1',
      'lists',
      'l1',
    ]);
    expect(registry.rowPath('lists', 'l1')).toBeNull();
    expect(registry.rowPath('baskets', 'b1', owner)).toEqual([
      '/',
      'shoppers',
      'people',
      'u1',
      'shopping-lists',
      'b1',
    ]);
    // Parts of the harvester's Setup tab (admin plan 0044, target 6): set up
    // once and then left alone, beside the chain sources.
    expect(at('postal-codes')).toBe('harvest/setup/postal-codes');
    expect(at('brands')).toBe('harvest/setup/brands');
    expect(registry.rowPath('brands', 'br_1')).toEqual([
      '/',
      'harvest',
      'setup',
      'brands',
      'br_1',
    ]);
    expect(registry.rowPath('postal-codes', '14001')).toEqual([
      '/',
      'harvest',
      'setup',
      'postal-codes',
      '14001',
    ]);
    // An admin is no resource any more (admin plan 0046): its rows do not
    // open, so nothing asks the registry where one is.
    expect(registry.pathOf('admins')).toBeNull();
  });

  /**
   * Every reference that draws a **picker** names a resource this app mounted.
   * One that did not would be a control that finds nothing, with nothing to say
   * about why. `POSTAL_CODES` is the case this used to miss: `0021` mounted it
   * and registered it nowhere, so a picker pointing at it would have been silent.
   *
   * A reference the form cannot change is deliberately not in this check. It is
   * drawn as the uuid it is and never opens a picker.
   */
  it('points every reference picker at a resource that exists', () => {
    const resources = ADMIN_SECTIONS.flatMap((section) => [
      ...(section.resources ?? []),
      ...(section.held ?? []),
    ]);
    const names = new Set(resources.map((resource) => resource.name));
    const targets = resources.flatMap((resource) => [
      ...resource.fields
        .filter(
          (field) => field.kind === 'reference' && field.editable !== false
        )
        .map((field) => (field.kind === 'reference' ? field.resource : '')),
      ...(resource.filters ?? [])
        .filter((filter) => filter.kind === 'reference')
        .map((filter) => (filter.kind === 'reference' ? filter.resource : '')),
    ]);

    expect(targets.filter((target) => !names.has(target))).toEqual([]);
  });

  /**
   * A resource under a parent is addressed through it, so the parent has to be
   * a resource the registry can find. One that could not would have no
   * address at all, and every link to it would fall back to nothing.
   */
  it('points every parent at a resource that exists', () => {
    const resources = ADMIN_SECTIONS.flatMap((section) => [
      ...(section.resources ?? []),
      ...(section.held ?? []),
    ]);
    const names = new Set(resources.map((resource) => resource.name));
    const parents = resources.flatMap((resource) =>
      resource.parent === undefined ? [] : [resource.parent.resource]
    );

    expect(parents.length).toBeGreaterThan(0);
    expect(parents.filter((parent) => !names.has(parent))).toEqual([]);
  });

  /** A tab draws a key, never words, so a section can be renamed in `en.json`. */
  it('labels every section with a translation key', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(section.label).toMatch(/^shell\.sections\./);
    }
  });
});
