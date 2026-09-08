import { TestBed } from '@angular/core/testing';
import {
  provideSections,
  ResourceRegistry,
  sectionScreens,
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
  it('is the five sections the plan names, in order', () => {
    expect(ADMIN_SECTIONS.map((section) => section.key)).toEqual([
      'overview',
      'catalog',
      'shoppers',
      'harvest',
      'admins',
    ]);
  });

  /** Five is the number the first row holds at a glance. */
  it('holds five, which is what one row holds', () => {
    expect(ADMIN_SECTIONS).toHaveLength(5);
  });

  /** Eight is the widest second row, and it fits on one line at 1280 pixels. */
  it('gives no section more than eight screens', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(sectionScreens(section).length).toBeLessThanOrEqual(8);
    }
  });

  it('gives every section at least one screen, counting its home', () => {
    for (const section of ADMIN_SECTIONS) {
      const screens = sectionScreens(section).length;
      const home = section.home === undefined ? 0 : 1;

      expect(screens + home).toBeGreaterThan(0);
    }
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
        .flatMap((section) => section.resources ?? [])
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
      (section.resources ?? []).map((descriptor) => descriptor.name)
    );

    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * The sixteen screens of the plan's table, at the paths it gives them. The
   * whole list rather than a sample, because the point of the plan is that every
   * screen reachable before it is reachable after it.
   */
  it('mounts every resource where the plan says', () => {
    TestBed.configureTestingModule({
      providers: [provideSections(...ADMIN_SECTIONS)],
    });
    const registry = TestBed.inject(ResourceRegistry);
    const at = (name: string) => registry.pathOf(name)?.slice(1).join('/');

    expect(at('supermarkets')).toBe('catalog/supermarkets');
    expect(at('locations')).toBe('catalog/locations');
    expect(at('price-scopes')).toBe('catalog/price-scopes');
    expect(at('items')).toBe('catalog/items');
    expect(at('product-groups')).toBe('catalog/product-groups');
    expect(at('prices')).toBe('catalog/prices');
    expect(at('price-policies')).toBe('catalog/price-policies');
    expect(at('location-items')).toBe('catalog/location-items');
    expect(at('users')).toBe('shoppers/users');
    expect(at('zones')).toBe('shoppers/zones');
    expect(at('memberships')).toBe('shoppers/memberships');
    expect(at('lists')).toBe('shoppers/lists');
    expect(at('list-lines')).toBe('shoppers/list-lines');
    // `shopping-lists` is the baskets screen's segment, which is the gateway's
    // own name for a generated list.
    expect(at('baskets')).toBe('shoppers/shopping-lists');
    expect(at('postal-codes')).toBe('harvest/postal-codes');
    // The one section that keeps the root, because it has one screen.
    expect(at('admins')).toBe('admins');
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
    const resources = ADMIN_SECTIONS.flatMap(
      (section) => section.resources ?? []
    );
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

  /** A tab draws a key, never words, so a section can be renamed in `en.json`. */
  it('labels every section with a translation key', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(section.label).toMatch(/^shell\.sections\./);
    }
  });
});
