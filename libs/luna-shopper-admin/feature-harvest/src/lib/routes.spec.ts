import { Component, inject } from '@angular/core';
import type { Route } from '@angular/router';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  RecordPage,
  RESOURCE_DESCRIPTOR,
  RESOURCE_FORM_MODE,
  RESOURCE_LIST_EMBED,
  ResourceListPage,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  defineResource,
  REVIEW_QUEUES,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { EntriesQueuePage } from './entries-queue-page';
import { ImportUploadPage } from './import-upload-page';
import { NewRunPage } from './new-run-page';
import { PlacesQueuePage } from './places-queue-page';
import { PostalCodeAddPage } from './postal-code-add-page';
import { PostalCodeDetailPage } from './postal-code-detail-page';
import { POSTAL_CODES } from './postal-codes';
import { HarvestReviewPage } from './review-page';
import { HARVEST_SEGMENT, HARVEST_TABS, harvestRoutes } from './routes';
import { RunPage } from './run-page';
import { RunsPage } from './runs-page';
import { HarvestSetupPage } from './setup-page';
import { ShopsQueuePage } from './shops-queue-page';
import { SOURCES } from './sources';
import { SourcesPage } from './sources-page';

/**
 * The harvester in three tabs (admin plan 0044, target 1).
 *
 * The suggested brands and the registered brands live in a library that
 * imports this one, so the app hands them to the route table. A spec here
 * cannot import them either, and stands in for both: a component with nothing
 * in it for the queue, and a resource with one field for the registry.
 */
@Component({ selector: 'lib-test-brands-queue', template: '' })
class BrandsQueue {}

interface Brand extends ResourceRow {
  id: string;
  label: string;
}

const BRANDS = defineResource<Brand>({
  name: 'brands',
  segment: 'brands',
  labels: { one: 'brands.one', many: 'brands.many' },
  title: (row) => row.label,
  fields: [{ kind: 'text', name: 'label', label: 'label' }],
  list: { columns: ['label'], compact: ['label'] },
  actions: { create: true },
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Brand>({
      path: '/v1/admin/catalog/brands',
      seed: [{ id: 'b1', label: 'Mahou' }],
    }),
});

const routes = harvestRoutes({
  brandsQueue: BrandsQueue,
  setup: [BRANDS, POSTAL_CODES],
});

const pathsOf = () => routes.map((route) => route.path);
const childPaths = (route: Route | undefined) =>
  (route?.children ?? []).map((child) => child.path);

/** Every address the table answers with a screen, from the section's root. */
function declared(): Set<string> {
  const found = new Set<string>();

  const walk = (list: readonly Route[], prefix: string) => {
    for (const route of list) {
      const path = [prefix, route.path].filter((part) => part).join('/');
      found.add(`/${HARVEST_SEGMENT}/${path}`);
      walk(route.children ?? [], path);
    }
  };

  walk(routes, '');
  return found;
}

describe('harvestRoutes', () => {
  /**
   * The segment belongs to the section (admin plan 0022), so these are the
   * children of that branch rather than a branch of their own.
   */
  it('is relative to the section, and names its segment nowhere', () => {
    for (const path of pathsOf()) {
      expect(path?.startsWith(HARVEST_SEGMENT)).toBe(false);
    }
  });

  it('has a page for each tab, and the screens under Runs', () => {
    expect(routes.map((route) => [route.path, route.component])).toEqual([
      ['review', HarvestReviewPage],
      ['runs', RunsPage],
      ['runs/new', NewRunPage],
      ['runs/import', ImportUploadPage],
      ['runs/:id', RunPage],
      ['setup', HarvestSetupPage],
      // The forms of the Setup resources, beside the page and with no
      // component of their own.
      ['setup', undefined],
    ]);
  });

  /**
   * The section's own address goes to Review, and the section says so with
   * its `landing`. A redirect here would be a second answer to the same
   * question.
   */
  it('claims the empty path for nothing', () => {
    expect(pathsOf()).not.toContain('');
  });

  it('carries no locale segment, like the rest of this app', () => {
    for (const path of declared()) {
      expect(path).not.toContain(':locale');
    }
  });
});

describe('harvestRoutes, Review', () => {
  const review = routes.find((route) => route.path === 'review');

  /** Target 4: one page, and each of the four queues is a child of it. */
  it('is a page with the four queues as its children', () => {
    expect(review?.component).toBe(HarvestReviewPage);
    expect(
      (review?.children ?? [])
        .filter((child) => child.redirectTo === undefined)
        .map((child) => [child.path, child.component])
    ).toEqual([
      ['products', EntriesQueuePage],
      ['shops', ShopsQueuePage],
      ['places', PlacesQueuePage],
      ['brands', BrandsQueue],
    ]);
    expect(childPaths(review).filter((path) => path !== '')).toEqual([
      ...REVIEW_QUEUES,
    ]);
  });

  it('opens on the products when the address names no queue', () => {
    const empty = review?.children?.find((child) => child.path === '');

    expect(empty?.redirectTo).toBe('products');
    expect(empty?.pathMatch).toBe('full');
  });

  /** The queue the app hands in is the one mounted, and no stand in of ours. */
  it('mounts the brands queue it was given', () => {
    @Component({ selector: 'lib-test-other-queue', template: '' })
    class Other {}

    const other = harvestRoutes({ brandsQueue: Other, setup: [] });
    const brands = other
      .find((route) => route.path === 'review')
      ?.children?.find((child) => child.path === 'brands');

    expect(brands?.component).toBe(Other);
  });
});

describe('harvestRoutes, Runs', () => {
  /**
   * A parameter matches anything, so `runs/:id` declared before `runs/new`
   * would read a run called "new".
   */
  it('declares the fixed words before the parameter', () => {
    const paths = pathsOf();

    expect(paths.indexOf('runs')).toBeLessThan(paths.indexOf('runs/:id'));
    expect(paths.indexOf('runs/new')).toBeLessThan(paths.indexOf('runs/:id'));
    expect(paths.indexOf('runs/import')).toBeLessThan(
      paths.indexOf('runs/:id')
    );
  });

  /**
   * A run is read on a screen of its own rather than in `0004`'s edit form,
   * because there is nothing on a run to edit.
   */
  it('sends a run id to the run screen and not to a form', () => {
    expect(routes.find((route) => route.path === 'runs/:id')?.component).toBe(
      RunPage
    );
  });
});

describe('harvestRoutes, Setup', () => {
  const [page, forms] = routes.filter((route) => route.path === 'setup');

  /** Target 6: one page, and each part is a child of it. */
  it('is a page with the three parts as its children', () => {
    expect(page.component).toBe(HarvestSetupPage);
    expect(childPaths(page)).toEqual(['', 'sources', 'brands', 'postal-codes']);
    expect(
      page.children?.find((child) => child.path === 'sources')?.component
    ).toBe(SourcesPage);
  });

  it('opens on the chain sources when the address names no part', () => {
    const empty = page.children?.find((child) => child.path === '');

    expect(empty?.redirectTo).toBe('sources');
    expect(empty?.pathMatch).toBe('full');
  });

  /**
   * The list of a Setup resource is the generic list drawn as a tab: the page
   * above it already drew the header.
   */
  it('mounts each resource it was given as a tab of the page', () => {
    for (const descriptor of [BRANDS, POSTAL_CODES]) {
      const tab = page.children?.find(
        (child) => child.path === descriptor.segment
      );

      expect(tab?.component).toBe(ResourceListPage);
      expect(tab?.data?.[RESOURCE_DESCRIPTOR]).toBe(descriptor);
      expect(tab?.data?.[RESOURCE_LIST_EMBED]).toBe('tab');
      expect(tab?.children).toBeUndefined();
    }
  });

  /**
   * A form is a page of its own, with its own header and its own way back. So
   * the forms are a second branch at the same segment, with no component, and
   * the router tries it when no part of the page matched.
   */
  it('mounts the forms of each resource beside the page, and not inside it', () => {
    expect(forms.component).toBeUndefined();
    expect(routes.indexOf(page)).toBeLessThan(routes.indexOf(forms));
    expect(childPaths(forms)).toEqual(['sources', 'brands', 'postal-codes']);

    const codes = forms.children?.find(
      (child) => child.path === 'postal-codes'
    );
    expect(
      (codes?.children ?? []).map((child) => [child.path, child.component])
    ).toEqual([
      ['new', PostalCodeAddPage],
      [':id', PostalCodeDetailPage],
    ]);
    // Before the parameter, which would otherwise read a row called "new".
    expect(childPaths(codes).indexOf('new')).toBeLessThan(
      childPaths(codes).indexOf(':id')
    );
  });

  /**
   * A source is a record page (admin plan 0059): one page adds it, and one
   * reads it and changes it. The chain sources are this library's own, so
   * they are mounted whatever the app hands in.
   */
  it('opens a source, and adds one, on the record page', () => {
    const sources = forms.children?.find((child) => child.path === 'sources');

    expect(
      (sources?.children ?? []).map((child) => [child.path, child.component])
    ).toEqual([
      ['new', RecordPage],
      [':id', RecordPage],
    ]);
    for (const child of sources?.children ?? []) {
      expect(child.data?.[RESOURCE_DESCRIPTOR]).toBe(SOURCES);
      // The page asks before a draft is left.
      expect(child.canDeactivate?.length).toBe(1);
    }
    expect(sources?.children?.[0].data?.[RESOURCE_FORM_MODE]).toBe('create');
    expect(sources?.children?.[1].data?.[RESOURCE_FORM_MODE]).toBeUndefined();
  });

  it('holds no resource the app did not hand it', () => {
    const bare = harvestRoutes({ brandsQueue: BrandsQueue, setup: [] });
    const [bareByItself, bareForms] = bare.filter(
      (route) => route.path === 'setup'
    );

    expect(childPaths(bareByItself)).toEqual(['', 'sources']);
    expect(childPaths(bareForms)).toEqual(['sources']);
  });
});

/**
 * A tab cannot end up without a route or a route without a tab. A hand
 * written screen has to be checked, because its link and its route are two
 * lists rather than one.
 */
describe('HARVEST_TABS', () => {
  it('is the three tabs, in the order the work is met', () => {
    expect(HARVEST_TABS.map((tab) => tab.path)).toEqual([
      '/harvest/review',
      '/harvest/runs',
      '/harvest/setup',
    ]);
  });

  it('points every tab at a route that exists', () => {
    for (const tab of HARVEST_TABS) {
      expect(declared().has(tab.path)).toBe(true);
    }
  });

  /**
   * Prefix matching is what keeps Review marked on each of its four queues,
   * so no tab asks to be matched exactly.
   */
  it('stays marked on the screens under it', () => {
    for (const tab of HARVEST_TABS) {
      expect(tab.exact).not.toBe(true);
    }
  });

  /**
   * The count on Review is the section counter's, which the frame asks by the
   * tab's path. A badge written here would be a second count.
   */
  it('states no count of its own', () => {
    for (const tab of HARVEST_TABS) {
      expect(tab.badge).toBeUndefined();
    }
  });

  it('gives every tab a translation key rather than words', () => {
    expect(HARVEST_TABS.map((tab) => tab.label)).toEqual([
      'harvest.tab.review',
      'harvest.tab.runs',
      'harvest.tab.setup',
    ]);
  });
});
