import { provideLocationMocks } from '@angular/common/testing';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  RouterOutlet,
  type Route,
} from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  RESOURCE_GATEWAYS,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  defineResource,
  HARVEST_REVIEW_TAB,
  HARVEST_SETUP_TAB,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { oldHarvestAddresses } from './old-addresses';
import { POSTAL_CODES } from './postal-codes';
import { HARVEST_SEGMENT, harvestRoutes } from './routes';

/**
 * The addresses the harvester's ten screens had (admin plan 0044, target 8).
 *
 * Ten screens sat in one flat row under `/harvest`. A bookmark, a link in a
 * chat and the browser's own history still hold those addresses, so each one
 * is a redirect to where the same rows are now. One test per address, against
 * the section as the app declares it.
 *
 * **What is asserted is where the router comes to rest**, and that the query
 * parameters came along: a queue that was linked to narrowed opens narrowed.
 *
 * The brands live in a library that imports this one, so the spec stands in
 * for them: a queue with nothing in it, and a resource with one field.
 */
@Component({ selector: 'lib-test-brands-queue', template: '' })
class BrandsQueue {}

@Component({ selector: 'lib-test-brand', template: '' })
class BrandPage {}

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
  // A detail page and an edit form, as the real brands have, so that the
  // three addresses under the list each have somewhere to land.
  actions: { create: true, edit: true },
  detail: BrandPage,
  editor: BrandPage,
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Brand>({
      path: '/v1/admin/catalog/brands',
      seed: [{ id: 'b1', label: 'Mahou' }],
    }),
});

const SECTIONS: readonly AdminSection[] = [
  {
    key: 'harvest',
    label: '',
    segment: HARVEST_SEGMENT,
    landing: HARVEST_REVIEW_TAB,
    held: [BRANDS, POSTAL_CODES],
    heldUnder: HARVEST_SETUP_TAB,
    screens: harvestRoutes({
      brandsQueue: BrandsQueue,
      setup: [BRANDS, POSTAL_CODES],
    }),
  },
];

/**
 * Only where the router lands is under test, so every screen is swapped for
 * one that draws nothing. The real ones read the gateway on construction, and
 * a redirect spec that waited on four queues would be testing them instead.
 */
@Component({ selector: 'lib-test-screen', template: '' })
class Screen {}

@Component({
  selector: 'lib-test-page',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class Page {}

function hollow(routes: readonly Route[]): Route[] {
  return routes.map((route) => ({
    ...route,
    ...(route.component === undefined
      ? {}
      : { component: route.children === undefined ? Screen : Page }),
    ...(route.children === undefined
      ? {}
      : { children: hollow(route.children) }),
  }));
}

async function landOn(url: string): Promise<string> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(hollow(adminRoutes(SECTIONS))),
      provideLocationMocks(),
      provideSections(...SECTIONS),
      SessionStorage,
      SessionStore,
      {
        provide: DEPLOYMENT_SERVICE,
        useValue: {
          read: async () => ({
            deployment: 'development',
            devAutologin: false,
          }),
        },
      },
      DeploymentStore,
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  return router.url;
}

afterEach(() => TestBed.resetTestingModule());

const CHAIN = '11111111-1111-4111-8111-111111111111';

describe('the address of the section', () => {
  /** Target 1: `/harvest` goes to Review, which opens on the products. */
  it('sends the section itself to Review', async () => {
    expect(await landOn('/harvest')).toBe('/harvest/review/products');
  });

  it('sends Review with no queue to the products', async () => {
    expect(await landOn('/harvest/review')).toBe('/harvest/review/products');
  });

  it('keeps the chain when Review is opened with no queue', async () => {
    expect(await landOn(`/harvest/review?chain=${CHAIN}`)).toBe(
      `/harvest/review/products?chain=${CHAIN}`
    );
  });

  it('sends Setup with no part to the chain sources', async () => {
    expect(await landOn('/harvest/setup')).toBe('/harvest/setup/sources');
  });
});

describe('the addresses the four queues had', () => {
  it('sends the source products to the products queue', async () => {
    expect(await landOn('/harvest/entries')).toBe('/harvest/review/products');
  });

  /**
   * The products queue named its chain `supermarketId`. The four queues share
   * `chain` now, so that one parameter is renamed and the others are kept.
   */
  it('renames the chain of the source products, and keeps the brand', async () => {
    expect(
      await landOn(`/harvest/entries?supermarketId=${CHAIN}&brandKey=mahou`)
    ).toBe(`/harvest/review/products?brandKey=mahou&chain=${CHAIN}`);
  });

  it('keeps a query of the source products that names no chain', async () => {
    expect(await landOn('/harvest/entries?brandKey=mahou&view=list')).toBe(
      '/harvest/review/products?brandKey=mahou&view=list'
    );
  });

  it('sends the source shops to the shops queue, and keeps its query', async () => {
    expect(await landOn('/harvest/shops')).toBe('/harvest/review/shops');
    expect(await landOn('/harvest/shops?view=review')).toBe(
      '/harvest/review/shops?view=review'
    );
  });

  /** The postal code detail page links here narrowed to one code. */
  it('sends the discovered places to the places queue, and keeps its query', async () => {
    expect(await landOn('/harvest/places')).toBe('/harvest/review/places');
    expect(await landOn('/harvest/places?postalCode=14001&country=ES')).toBe(
      '/harvest/review/places?postalCode=14001&country=ES'
    );
  });

  /** "Grouped by chain" is a view of the places queue, and no page. */
  it('sends the places by chain to the places queue, with the grouped view', async () => {
    expect(await landOn('/harvest/places/groups')).toBe(
      '/harvest/review/places?view=groups'
    );
  });

  it('keeps the query of the places by chain beside the view', async () => {
    expect(await landOn('/harvest/places/groups?country=ES')).toBe(
      '/harvest/review/places?country=ES&view=groups'
    );
  });

  it('sends the suggested brands to the brands queue, and keeps its query', async () => {
    expect(await landOn('/harvest/suggested-brands')).toBe(
      '/harvest/review/brands'
    );
    expect(await landOn('/harvest/suggested-brands?query=mah')).toBe(
      '/harvest/review/brands?query=mah'
    );
  });
});

describe('the addresses the three run screens had', () => {
  it('leaves the runs and one run where they were', async () => {
    expect(await landOn('/harvest/runs')).toBe('/harvest/runs');
    expect(await landOn('/harvest/runs?run=run-1')).toBe(
      '/harvest/runs?run=run-1'
    );
    expect(await landOn('/harvest/runs/run-1')).toBe('/harvest/runs/run-1');
  });

  /** The presets are a panel of Runs, which opens on the chain a link named. */
  it('sends the presets to Runs, with the chain and the preset kept', async () => {
    expect(await landOn('/harvest/presets')).toBe('/harvest/runs');
    expect(await landOn(`/harvest/presets?chain=${CHAIN}&preset=p1`)).toBe(
      `/harvest/runs?chain=${CHAIN}&preset=p1`
    );
  });

  it('sends the upload to the file import, under Runs', async () => {
    expect(await landOn('/harvest/imports/upload')).toBe(
      '/harvest/runs/import'
    );
    expect(await landOn('/harvest/imports/upload?from=run')).toBe(
      '/harvest/runs/import?from=run'
    );
  });
});

describe('the addresses the three setup screens had', () => {
  it('sends the chain sources to their part of Setup', async () => {
    expect(await landOn('/harvest/sources')).toBe('/harvest/setup/sources');
    expect(await landOn('/harvest/sources?open=x')).toBe(
      '/harvest/setup/sources?open=x'
    );
  });

  it('sends the registered brands to their part of Setup', async () => {
    expect(await landOn('/harvest/brands')).toBe('/harvest/setup/brands');
    expect(await landOn('/harvest/brands?query=mah')).toBe(
      '/harvest/setup/brands?query=mah'
    );
  });

  it('sends the form of a new brand to its new place', async () => {
    expect(await landOn('/harvest/brands/new')).toBe(
      '/harvest/setup/brands/new'
    );
  });

  it('sends one brand to that brand', async () => {
    expect(await landOn('/harvest/brands/b1')).toBe('/harvest/setup/brands/b1');
  });

  it('sends the edit form of one brand to that form', async () => {
    expect(await landOn('/harvest/brands/b1/edit')).toBe(
      '/harvest/setup/brands/b1/edit'
    );
  });

  it('keeps the query of an address under the brands', async () => {
    expect(await landOn('/harvest/brands/b1?tab=spellings')).toBe(
      '/harvest/setup/brands/b1?tab=spellings'
    );
  });

  it('sends the postal codes to their part of Setup', async () => {
    expect(await landOn('/harvest/postal-codes')).toBe(
      '/harvest/setup/postal-codes'
    );
    expect(await landOn('/harvest/postal-codes?postalCode=140')).toBe(
      '/harvest/setup/postal-codes?postalCode=140'
    );
  });

  it('sends the add page of the postal codes to its new place', async () => {
    expect(await landOn('/harvest/postal-codes/new')).toBe(
      '/harvest/setup/postal-codes/new'
    );
  });

  it('sends one postal code to that code, with its country kept', async () => {
    expect(await landOn('/harvest/postal-codes/14001')).toBe(
      '/harvest/setup/postal-codes/14001'
    );
    expect(await landOn('/harvest/postal-codes/14001?country=ES')).toBe(
      '/harvest/setup/postal-codes/14001?country=ES'
    );
  });
});

describe('the old addresses, as routes', () => {
  const routes = oldHarvestAddresses();

  it('names every address a screen had', () => {
    expect(routes.map((route) => route.path)).toEqual([
      'entries',
      'shops',
      'places/groups',
      'places',
      'suggested-brands',
      'presets',
      'imports/upload',
      'sources',
      'brands',
      'brands',
      'postal-codes',
      'postal-codes',
    ]);
  });

  /**
   * Every one is a route with no component, so none of them can draw a screen
   * at an old address by accident.
   */
  it('is redirects and nothing else', () => {
    const leaves = (list: readonly Route[]): Route[] =>
      list.flatMap((route) =>
        route.children === undefined ? [route] : leaves(route.children)
      );

    for (const route of routes) {
      expect(route.component).toBeUndefined();
    }
    for (const leaf of leaves(routes)) {
      expect(leaf.redirectTo).toBeDefined();
      expect(leaf.component).toBeUndefined();
    }
  });

  /**
   * A list is matched in full, so that `brands` does not swallow `brands/b1`
   * before the branch that carries the rest of the address is tried.
   */
  it('matches each list in full, and everything under it in a branch of its own', () => {
    for (const name of ['brands', 'postal-codes']) {
      const [list, under] = routes.filter((route) => route.path === name);

      expect(list.pathMatch).toBe('full');
      expect(list.redirectTo).toBeDefined();
      expect((under.children ?? []).map((child) => child.path)).toEqual(['**']);
    }
  });

  it('holds no address that is still a screen', () => {
    const paths = routes.map((route) => route.path);

    expect(paths).not.toContain('runs');
    expect(paths).not.toContain('review');
    expect(paths).not.toContain('setup');
  });
});
