import { provideLocationMocks } from '@angular/common/testing';
import { Component, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  ServerReachability,
  SessionStorage,
  SessionStore,
  type HarvestServiceI,
  type ResourceGatewaysI,
  type ResourceSource,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  RecordPage,
  RecordView,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  ResourceGateway,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { PageHeader } from '@portfolio/luna-shopper-admin/ui';
import { ITEMS_PATH } from '../catalog-sources';
import { CHAIN_RESOURCES, chainsRoutes } from '../chains/chains-routes';
import { toItemSourceEntryRow } from '../item-source-entries';
import {
  PRODUCT_RESOURCES,
  PRODUCTS_SEGMENT,
  productsRoutes,
} from './products-routes';

/**
 * A product on the record page, against the in memory gateways (admin plan
 * 0055): the header, the four tabs with their counts, the three sections of
 * Details, what the server refuses about the categories, the delete, and a
 * new product. The Where and Sources tabs are here as well, as parts of the
 * record.
 *
 * The Prices tab and the form that adds a price are in
 * `product-prices-tab.spec.ts`.
 *
 * Assertions are on view models and on keys wherever a string is
 * interpolated, because the testing translator answers with the key.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

/** The Chains section and the Products section, each as the app declares it. */
const SECTIONS: readonly AdminSection[] = [
  { key: 'chains', label: '', held: CHAIN_RESOURCES, screens: chainsRoutes() },
  {
    key: 'products',
    label: '',
    segment: PRODUCTS_SEGMENT,
    held: PRODUCT_RESOURCES,
    heldTabs: true,
    screens: productsRoutes(),
  },
];

/** A 503, which is what a service that is not answering reads as. */
function unavailable(): GatewayError {
  return new GatewayError({
    status: 503,
    code: 'service_unavailable',
    correlationId: 'cid',
  });
}

/** The memory gateways, with every change of a product refused with a code. */
function refusingProducts(code: string): ResourceGatewaysI {
  const memory = new ResourceMemoryGateways();
  return {
    for: <T extends ResourceRow>(source: ResourceSource<T>) => {
      const inner = memory.for(source);
      if (source.path !== ITEMS_PATH) {
        return inner;
      }
      return {
        list: (query) => inner.list(query),
        read: (id) => inner.read(id),
        create: (input) => inner.create(input),
        update: async () => {
          throw new GatewayError({ status: 409, code, correlationId: 'cid' });
        },
        remove: (id) => inner.remove(id),
      } satisfies ResourceGateway<T>;
    },
  };
}

/**
 * The memory gateways, with the read of a product bent: `answer` gets the
 * row the memory holds, and what it answers or throws is the read.
 */
function readingProducts(
  answer: (row: ResourceRow) => ResourceRow
): ResourceGatewaysI {
  const memory = new ResourceMemoryGateways();
  return {
    for: <T extends ResourceRow>(source: ResourceSource<T>) => {
      const inner = memory.for(source);
      if (source.path !== ITEMS_PATH) {
        return inner;
      }
      return {
        list: (query) => inner.list(query),
        read: async (id) => answer(await inner.read(id)) as T,
        create: (input) => inner.create(input),
        update: (id, input) => inner.update(id, input),
        remove: (id) => inner.remove(id),
      } satisfies ResourceGateway<T>;
    },
  };
}

async function boot(url: string, providers: Provider[] = []) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes(SECTIONS)),
      provideLocationMocks(),
      provideSections(...SECTIONS),
      SessionStorage,
      SessionStore,
      DeploymentStore,
      ...providers,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);
  await settle(fixture);
  await settle(fixture);

  return fixture;
}

async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

const page = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(RecordPage))
    .componentInstance as RecordPage;

const view = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(RecordView))
    .componentInstance as RecordView;

/** The tabs of the page. A product that is read always has them. */
const tabs = (fixture: ComponentFixture<TestHost>) =>
  page(fixture).tabs() ?? [];

const url = () => TestBed.inject(Router).url;

afterEach(() => TestBed.resetTestingModule());

describe('a product, on the record page', () => {
  it('opens on its details, reading, under a header that names it', async () => {
    const fixture = await boot('/products/it_milk_1l');

    expect(url()).toBe('/products/it_milk_1l/details');
    const header = fixture.debugElement.query(By.directive(PageHeader))
      .componentInstance as PageHeader;
    expect(header.heading()).toBe('Whole milk 1 L');
    expect(header.backLink()).toBe('/products');
    expect(page(fixture).store().mode()).toBe('read');
    // One header: the page's.
    expect(
      fixture.debugElement.queryAll(By.directive(PageHeader))
    ).toHaveLength(1);
  });

  it('has four tabs, each at an address under the product', async () => {
    const fixture = await boot('/products/it_milk_1l');

    expect(tabs(fixture).map((tab) => tab.label)).toEqual([
      'record.tab.details',
      'catalog.products.tabs.prices',
      'catalog.products.tabs.where',
      'catalog.products.tabs.sources',
    ]);
    expect(tabs(fixture).map((tab) => tab.path)).toEqual([
      '/products/it_milk_1l/details',
      '/products/it_milk_1l/prices',
      '/products/it_milk_1l/where',
      '/products/it_milk_1l/sources',
    ]);
  });

  /** Every address a product had before this plan opens the same thing. */
  it.each([
    ['/products/it_milk_1l/details', 'lib-record-view'],
    ['/products/it_milk_1l/prices', 'lib-product-prices-tab'],
    ['/products/it_milk_1l/prices/new', 'lib-price-form-page'],
    ['/products/it_milk_1l/where', 'lib-item-sections-panel'],
    ['/products/it_milk_1l/sources', 'lib-item-source-entries'],
  ])('keeps the address %s', async (address, selector) => {
    const fixture = await boot(address);

    expect(url()).toBe(address);
    expect(fixture.nativeElement.querySelector(selector)).not.toBeNull();
    expect(page(fixture).heading()).toBe('Whole milk 1 L');
  });

  /** A count is shown only when the gateway gave it: here, both did. */
  it('counts the scopes that price it and the source rows that name it', async () => {
    const fixture = await boot('/products/it_milk_1l');
    const [details, prices, where, sources] = tabs(fixture);

    expect(prices.count?.()).toBe(2);
    expect(sources.count?.()).toBe(3);
    // Nothing is counted for the other two.
    expect(details.count).toBeUndefined();
    expect(where.count?.()).toBeNull();
  });

  it('draws Details in three sections, and no tab of the others under it', async () => {
    const fixture = await boot('/products/it_milk_1l/details');

    expect(
      view(fixture)
        .layout()
        .sections.map((section) => [
          section.title,
          section.fields.map((field) => field.name),
        ])
    ).toEqual([
      ['catalog.items.section.name', ['name', 'brand', 'ean', 'sku']],
      ['catalog.items.section.where', ['categoryIds', 'productGroupId']],
      ['catalog.items.section.sold', ['defaultUnit', 'unitSize', 'imageUrl']],
    ]);
    // The brand is the text the product holds, and no picker.
    expect(text(fixture)).toContain('Hacendado');
    // What the old summary column showed is here, so nothing draws it twice.
    expect(fixture.nativeElement.querySelector('aside dl .chip')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('lib-item-source-entries')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('lib-item-sections-panel')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('lib-product-prices-tab')
    ).toBeNull();
  });

  it('keeps the product on Details after a save, reading again, under its new name', async () => {
    const fixture = await boot('/products/it_dish_soap/details');
    const store = page(fixture).store();

    page(fixture).edit();
    await settle(fixture);
    await settle(fixture);
    expect(store.mode()).toBe('edit');

    store.set('brand', 'Bosque Verde Eco');
    store.set('name', { en: 'Dish soap 750 ml', es: 'Lavavajillas 750 ml' });
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/products/it_dish_soap/details');
    expect(store.mode()).toBe('read');
    expect(store.row()?.['brand']).toBe('Bosque Verde Eco');
    // The header is renamed, and not only the row under it.
    expect(page(fixture).heading()).toBe('Dish soap 750 ml');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toBe(
      'Dish soap 750 ml'
    );
  });

  /** The three codes of `errorFields`, each said under "Categories". */
  it.each([
    'category_not_a_leaf',
    'item_needs_a_category',
    'category_not_found',
  ])('says %s under the categories', async (code) => {
    const fixture = await boot('/products/it_dish_soap/details', [
      { provide: RESOURCE_GATEWAYS, useValue: refusingProducts(code) },
    ]);
    const store = page(fixture).store();

    page(fixture).edit();
    await settle(fixture);
    await settle(fixture);
    store.set('brand', 'Another');
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);

    // Still the form, and the sentence is the field's.
    expect(store.mode()).toBe('edit');
    expect(view(fixture).messages()['categoryIds']?.length).toBeGreaterThan(0);
    expect(view(fixture).messages()['brand'] ?? []).toEqual([]);
  });

  it('opens the form from a link that asks for it', async () => {
    const fixture = await boot('/products/it_dish_soap?edit=1');
    await settle(fixture);
    await settle(fixture);

    // On Details, which is where the form is, and with the parameter taken
    // out: a reload reads.
    expect(url()).toBe('/products/it_dish_soap/details');
    expect(page(fixture).store().mode()).toBe('edit');
  });

  /** A name in no language. The header still says what the record is. */
  it('calls a product with no name "Product with no name"', async () => {
    const fixture = await boot('/products/it_dish_soap/details', [
      {
        provide: RESOURCE_GATEWAYS,
        useValue: readingProducts((row) => ({ ...row, name: {} })),
      },
    ]);

    // The testing translator answers the key.
    expect(page(fixture).title()).toBe('record.unnamed');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toBe(
      'record.unnamed'
    );
  });

  it('says in the delete question that the prices go with the product', async () => {
    const fixture = await boot('/products/it_dish_soap/details');

    page(fixture).deleting.set(true);
    await settle(fixture);

    const question = fixture.nativeElement.querySelector(
      '[data-delete-question]'
    ) as HTMLElement;
    expect(question.textContent).toContain('catalog.products.deleteBody');
    expect(question.textContent).not.toContain('record.delete.body');
  });

  it('draws another product when the address names one', async () => {
    const fixture = await boot('/products/it_milk_1l/details');

    await TestBed.inject(Router).navigateByUrl(
      '/products/it_olive_oil_1l/details'
    );
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(page(fixture).heading()).toBe('Extra virgin olive oil 1 L');
    // The counts are the new product's.
    expect(tabs(fixture)[1].count?.()).toBe(1);
  });

  it('deletes the product after asking, and goes back to the list', async () => {
    const fixture = await boot('/products/it_dish_soap/details');

    expect(page(fixture).canDelete()).toBe(true);
    page(fixture).deleting.set(true);
    await page(fixture).confirmDelete();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/products');
  });

  it('says so when the product is not there, and draws no tab', async () => {
    const fixture = await boot('/products/it_nowhere/details');

    // A 404 is a product that is gone, and not a gateway that is silent.
    expect(
      fixture.nativeElement.querySelector('[data-missing]')
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-no-answer]')).toBeNull();
    expect(page(fixture).tabs()).toBeNull();
  });

  it('says the gateway did not answer when the read fails, and draws no tab', async () => {
    const fixture = await boot('/products/it_milk_1l/details', [
      {
        provide: RESOURCE_GATEWAYS,
        useValue: readingProducts(() => {
          throw unavailable();
        }),
      },
    ]);

    // Nothing here can be taken for the product, or for one that is gone.
    expect(
      fixture.nativeElement.querySelector('[data-no-answer]')
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-missing]')).toBeNull();
    expect(page(fixture).tabs()).toBeNull();
  });
});

describe('a new product', () => {
  it('is the record page, with "Sold by" at "Unit" and no tab', async () => {
    const fixture = await boot('/products/new');
    const store = page(fixture).store();

    expect(store.mode()).toBe('create');
    expect(store.draft()['defaultUnit']).toBe('UNIT');
    expect(page(fixture).tabs()).toBeNull();
    // The name and one category are still to be given.
    expect(store.missing()).toEqual(['name', 'categoryIds']);
    expect(
      view(fixture)
        .layout()
        .sections.map((section) => section.title)
    ).toEqual([
      'catalog.items.section.name',
      'catalog.items.section.where',
      'catalog.items.section.sold',
    ]);
  });

  it('opens the product it made, on Details, and offers another', async () => {
    const fixture = await boot('/products/new');
    const store = page(fixture).store();

    store.set('name', { en: 'Oat drink 1 L', es: 'Bebida de avena 1 L' });
    store.set('categoryIds', ['cat_milk']);
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(url()).toMatch(/^\/products\/[^/]+\/details$/);
    expect(url()).not.toContain('/new');
    expect(page(fixture).heading()).toBe('Oat drink 1 L');
    expect(page(fixture).added()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-added]')).not.toBeNull();

    page(fixture).addAnother();
    await settle(fixture);
    await settle(fixture);
    expect(url()).toBe('/products/new');
  });
});

describe('the Sources tab of a product', () => {
  it('lists the chain rows that name it', async () => {
    const fixture = await boot('/products/it_milk_1l/sources');

    expect(text(fixture)).toContain('catalog.items.sources.heading');
    expect(text(fixture)).toContain('Leche entera Hacendado');
  });

  it('warns on a barcode more than one row of the chain lists', async () => {
    const fixture = await boot('/products/it_milk_1l/sources');

    const chips = [
      ...fixture.nativeElement.querySelectorAll('.chip.shared'),
    ] as HTMLElement[];
    // The two Mercadona rows share one barcode. The DEZA row has none.
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain('catalog.items.sources.sharedEan');
  });

  it('says so for a product nothing names', async () => {
    const fixture = await boot('/products/it_dish_soap/sources');

    expect(text(fixture)).toContain('catalog.items.sources.empty');
    expect(tabs(fixture)[3].count?.()).toBe(0);
  });

  it('keeps the page when the harvester does not answer', async () => {
    const harvest = Object.assign(new HarvestMemory(), {
      listItemEntries: async () => {
        throw unavailable();
      },
    }) as HarvestServiceI;
    const fixture = await boot('/products/it_milk_1l/sources', [
      { provide: HARVEST_SERVICE, useValue: harvest },
    ]);

    // The panel's own failure, with its own retry.
    expect(
      fixture.nativeElement.querySelector(
        'lib-item-source-entries [role="alert"]'
      )
    ).not.toBeNull();
    // The header still names the product, and the tab shows no number.
    expect(page(fixture).heading()).toBe('Whole milk 1 L');
    expect(tabs(fixture)[3].count?.()).toBeNull();
  });

  it('maps a source row from the wire and drops one with no id', () => {
    expect(toItemSourceEntryRow({ name: 'x' })).toBeNull();
    expect(
      toItemSourceEntryRow({
        id: 'e1',
        status: 'SOMETHING',
        matchedBy: 'SHARED_EAN',
        eanSharedBy: 1,
      })
    ).toMatchObject({
      status: 'UNRESOLVED',
      matchKey: 'catalog.items.sources.matchSharedEan',
      // One row is its own barcode, not a shared one.
      sharedBy: 0,
    });
  });
});

describe('the Where it is tab of a product', () => {
  it('draws where the product is in each chain', async () => {
    const fixture = await boot('/products/it_milk_1l/where');

    expect(
      fixture.nativeElement.querySelector('lib-item-sections-panel')
    ).not.toBeNull();
  });
});
