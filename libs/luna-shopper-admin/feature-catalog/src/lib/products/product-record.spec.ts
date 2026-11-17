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
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import { PageHeader } from '@portfolio/luna-shopper-admin/ui';
import { ITEMS_PATH } from '../catalog-sources';
import { CHAIN_RESOURCES, chainsRoutes } from '../chains/chains-routes';
import { ItemLinkedImages, toItemSourcePhotos } from '../item-linked-images';
import { toItemSourceEntryRow } from '../item-source-entries';
import { ITEMS } from '../items';
import {
  PRODUCT_RESOURCES,
  PRODUCTS_SEGMENT,
  productsRoutes,
} from './products-routes';

/**
 * A product on the record page, against the in memory gateways (admin plan
 * 0055): the header, the three tabs with their counts, the three sections of
 * Details, what the server refuses about the categories, the delete, and a
 * new product. The Sources tab is here as well, as a part of the record.
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
  return refusingProductsWith(
    new GatewayError({ status: 409, code, correlationId: 'cid' })
  );
}

/** The memory gateways, with every change of a product refused with `error`. */
function refusingProductsWith(error: GatewayError): ResourceGatewaysI {
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
          throw error;
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

/**
 * The memory gateways, with every change of a product written down as it
 * was sent, before the memory applies it.
 */
function recordingProducts(sent: ResourceRow[]): {
  gateways: ResourceGatewaysI;
  memory: ResourceMemoryGateways;
} {
  const memory = new ResourceMemoryGateways();
  return {
    memory,
    gateways: {
      for: <T extends ResourceRow>(source: ResourceSource<T>) => {
        const inner = memory.for(source);
        if (source.path !== ITEMS_PATH) {
          return inner;
        }
        return {
          list: (query) => inner.list(query),
          read: (id) => inner.read(id),
          create: (input) => inner.create(input),
          update: (id, input) => {
            sent.push(input);
            return inner.update(id, input);
          },
          remove: (id) => inner.remove(id),
        } satisfies ResourceGateway<T>;
      },
    },
  };
}

/** A field of `ITEMS`, by name. */
const itemField = (name: string) => {
  const field = ITEMS.fields.find((each) => each.name === name);
  if (field === undefined) {
    throw new Error(`ITEMS has no field ${name}.`);
  }
  return field;
};

/** The product row the memory holds, as the gateway answers it. */
const heldProduct = (memory: ResourceMemoryGateways, id: string) =>
  memory.for<Wire.CatalogItemView>({ path: ITEMS_PATH }).read(id);

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

  /** A product has no section panel since admin plan 0063. */
  it('has three tabs, each at an address under the product', async () => {
    const fixture = await boot('/products/it_milk_1l');

    expect(tabs(fixture).map((tab) => tab.label)).toEqual([
      'record.tab.details',
      'catalog.products.tabs.prices',
      'catalog.products.tabs.sources',
    ]);
    expect(tabs(fixture).map((tab) => tab.path)).toEqual([
      '/products/it_milk_1l/details',
      '/products/it_milk_1l/prices',
      '/products/it_milk_1l/sources',
    ]);
  });

  it('draws no section panel at the address the Where tab had', async () => {
    const fixture = await boot('/products/it_milk_1l/where');

    expect(
      fixture.nativeElement.querySelector('lib-item-sections-panel')
    ).toBeNull();
  });

  /** Every address a product had before this plan opens the same thing. */
  it.each([
    ['/products/it_milk_1l/details', 'lib-record-view'],
    ['/products/it_milk_1l/prices', 'lib-product-prices-tab'],
    ['/products/it_milk_1l/prices/new', 'lib-price-form-page'],
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
    const [details, prices, sources] = tabs(fixture);

    expect(prices.count?.()).toBe(2);
    expect(sources.count?.()).toBe(3);
    // Nothing is counted for Details.
    expect(details.count).toBeUndefined();
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
      [
        'catalog.items.section.sold',
        [
          'defaultUnit',
          'unitSize',
          'approxWeight',
          'quantityStep',
          'imageUrl',
          'shownPhoto',
        ],
      ],
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

  /**
   * The two refusals about a size (backend plan 0244, admin plan 0068), and
   * the one about a step (backend plan 0261, admin plan 0070), each said under
   * the field it names, with its own sentence. The milk shows no step field,
   * and a field with something said under it is drawn anyway.
   */
  it.each([
    [
      'item_kilogram_has_size',
      'unitSize',
      'resource.error.itemKilogramHasSize',
    ],
    [
      'item_approx_weight_beside_size',
      'approxWeight',
      'resource.error.itemApproxWeightBesideSize',
    ],
    [
      'item_quantity_step_not_allowed',
      'quantityStep',
      'resource.error.itemQuantityStepNotAllowed',
    ],
  ])('says %s under %s', async (code, field, key) => {
    const fixture = await boot('/products/it_milk_1l/details', [
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

    expect(store.mode()).toBe('edit');
    expect(view(fixture).messages()[field]).toEqual([{ kind: 'key', key }]);
    expect(view(fixture).shownRefusal()).toBeNull();
    expect(view(fixture).isShown(itemField(field))).toBe(true);
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

  /** Admin plan 0068, criterion 1: a size or a weight, never both. */
  describe('the size and the weight of a product', () => {
    async function editing(id: string, providers: Provider[] = []) {
      const fixture = await boot(`/products/${id}/details`, providers);
      page(fixture).edit();
      await settle(fixture);
      await settle(fixture);
      return { fixture, store: page(fixture).store() };
    }

    /** The names of the rows the Sold section draws, in order. */
    const soldRows = (fixture: ComponentFixture<TestHost>) =>
      view(fixture)
        .layout()
        .sections[2].fields.filter((field) => view(fixture).isShown(field))
        .map((field) => field.name);

    it('clears and disables the weight once a size is typed, and the other way round', async () => {
      const { fixture, store } = await editing('it_milk_1l');

      // The milk has a size, so the weight is shut out from the start.
      expect(view(fixture).isExcluded(itemField('approxWeight'))).toBe(true);
      expect(view(fixture).isExcluded(itemField('unitSize'))).toBe(false);

      store.set('approxWeight', '1560');
      await settle(fixture);
      expect(store.draft()['unitSize']).toBe('');
      expect(view(fixture).isExcluded(itemField('unitSize'))).toBe(true);
      expect(view(fixture).isExcluded(itemField('approxWeight'))).toBe(false);

      store.set('unitSize', '2');
      await settle(fixture);
      expect(store.draft()['approxWeight']).toBe('');
      expect(view(fixture).isExcluded(itemField('approxWeight'))).toBe(true);
    });

    it('offers no size for the kilo, and offers it again for grams', async () => {
      const { fixture, store } = await editing('it_milk_1l');
      expect(soldRows(fixture)).toEqual([
        'defaultUnit',
        'unitSize',
        'approxWeight',
        'imageUrl',
        'shownPhoto',
      ]);

      store.set('defaultUnit', 'KILOGRAM');
      await settle(fixture);
      // Sold by the kilo with no size and no weight: it may carry a step
      // (admin plan 0070).
      expect(soldRows(fixture)).toEqual([
        'defaultUnit',
        'approxWeight',
        'quantityStep',
        'imageUrl',
        'shownPhoto',
      ]);
      expect(store.draft()['unitSize']).toBe('');
      // The weight is empty by default, and open to a value.
      expect(store.draft()['approxWeight']).toBe('');
      expect(view(fixture).isExcluded(itemField('approxWeight'))).toBe(false);
      expect(view(fixture).noteOf(itemField('defaultUnit'))?.text).toEqual({
        kind: 'key',
        key: 'catalog.items.pricesPerKilo',
      });

      store.set('approxWeight', '1560');
      store.set('defaultUnit', 'GRAM');
      await settle(fixture);
      expect(soldRows(fixture)).toContain('unitSize');
      expect(view(fixture).noteOf(itemField('defaultUnit'))).toBeNull();
      // The weight stays while the size is empty, and goes once one is typed.
      expect(store.draft()['approxWeight']).toBe('1560');
      store.set('unitSize', '500');
      expect(store.draft()['approxWeight']).toBe('');
    });

    it('saves a kilo piece with its weight and no size', async () => {
      const sent: ResourceRow[] = [];
      const { gateways } = recordingProducts(sent);
      const { fixture, store } = await editing('it_milk_1l', [
        { provide: RESOURCE_GATEWAYS, useValue: gateways },
      ]);

      store.set('defaultUnit', 'KILOGRAM');
      store.set('approxWeight', '1560');
      await view(fixture).save();
      await settle(fixture);

      expect(sent).toEqual([
        { defaultUnit: 'KILOGRAM', unitSize: null, approxWeight: 1560 },
      ]);
    });

    it('saves a piece priced as one with its weight and no size', async () => {
      const sent: ResourceRow[] = [];
      const { gateways } = recordingProducts(sent);
      const { fixture, store } = await editing('it_dish_soap', [
        { provide: RESOURCE_GATEWAYS, useValue: gateways },
      ]);

      store.set('defaultUnit', 'UNIT');
      store.set('approxWeight', '580');
      await view(fixture).save();
      await settle(fixture);

      expect(sent).toEqual([
        { defaultUnit: 'UNIT', unitSize: null, approxWeight: 580 },
      ]);
    });

    it('says who set the weight, and hands a typed one back to the chain', async () => {
      const sent: ResourceRow[] = [];
      const { gateways } = recordingProducts(sent);
      const typed = readingProducts((row) => ({
        ...row,
        unitSize: null,
        defaultUnit: 'KILOGRAM',
        approxWeight: 1500,
        approxWeightSetBy: 'ADMIN',
      }));
      const both: ResourceGatewaysI = {
        for: <T extends ResourceRow>(source: ResourceSource<T>) => ({
          ...typed.for(source),
          update: gateways.for(source).update,
        }),
      };
      const fixture = await boot('/products/it_milk_1l/details', [
        { provide: RESOURCE_GATEWAYS, useValue: both },
      ]);

      expect(view(fixture).noteOf(itemField('approxWeight'))).toEqual({
        text: { kind: 'key', key: 'catalog.items.approxWeightFrom.admin' },
        action: { label: 'catalog.items.approxWeightFrom.useChain', value: '' },
      });

      page(fixture).edit();
      await settle(fixture);
      await settle(fixture);
      const press = fixture.nativeElement.querySelector(
        '[data-note-action]'
      ) as HTMLButtonElement;
      expect(press.textContent?.trim()).toBe(
        'catalog.items.approxWeightFrom.useChain'
      );
      press.click();
      await settle(fixture);
      await view(fixture).save();
      await settle(fixture);

      expect(sent).toEqual([{ approxWeight: null }]);
    });

    it('says a weight from the chain is rewritten by each run, and a person holds one typed over it', async () => {
      const fixture = await boot('/products/it_milk_1l/details', [
        {
          provide: RESOURCE_GATEWAYS,
          useValue: readingProducts((row) => ({
            ...row,
            unitSize: null,
            approxWeight: 395,
            approxWeightSetBy: 'SOURCE',
          })),
        },
      ]);

      expect(view(fixture).noteOf(itemField('approxWeight'))).toEqual({
        text: { kind: 'key', key: 'catalog.items.approxWeightFrom.source' },
      });
      expect(
        fixture.nativeElement.querySelector('[data-note-action]')
      ).toBeNull();

      // A weight typed over the chain's is the person's from the save on,
      // and there is nothing yet to hand back.
      page(fixture).edit();
      await settle(fixture);
      const store = page(fixture).store();
      store.set('approxWeight', '1500');
      await settle(fixture);
      expect(view(fixture).noteOf(itemField('approxWeight'))).toEqual({
        text: { kind: 'key', key: 'catalog.items.approxWeightFrom.admin' },
      });
      expect(
        fixture.nativeElement.querySelector('[data-note-action]')
      ).toBeNull();

      // The chain's weight typed back is the chain's again.
      store.set('approxWeight', '395');
      expect(view(fixture).noteOf(itemField('approxWeight'))).toEqual({
        text: { kind: 'key', key: 'catalog.items.approxWeightFrom.source' },
      });
      store.set('approxWeight', '');
      expect(view(fixture).noteOf(itemField('approxWeight'))).toBeNull();
    });
  });

  /**
   * The step of a product (backend plan 0261, admin plan 0070): shown only
   * for a product sold by the kilo or the litre, a select of the ten steps,
   * and emptied with the kind that took it away.
   */
  describe('the step of a product', () => {
    const step = () => itemField('quantityStep');

    /** The milk read with these fields over it. */
    const milkAs = (over: Partial<Wire.CatalogItemView>) =>
      readingProducts((row) => ({ ...row, ...over }));

    async function editing(id: string, providers: Provider[] = []) {
      const fixture = await boot(`/products/${id}/details`, providers);
      page(fixture).edit();
      await settle(fixture);
      await settle(fixture);
      return { fixture, store: page(fixture).store() };
    }

    /** The select the step is drawn as, while the page is a form. */
    const select = (fixture: ComponentFixture<TestHost>) =>
      fixture.nativeElement.querySelector(
        'select[data-choices]'
      ) as HTMLSelectElement | null;

    it.each([
      ['sold by the kilo', { defaultUnit: 'KILOGRAM', unitSize: null }, true],
      ['sold by the litre', { defaultUnit: 'LITER', unitSize: null }, true],
      [
        'a kilo piece',
        { defaultUnit: 'KILOGRAM', unitSize: null, approxWeight: 1560 },
        false,
      ],
      ['a pack', {}, false],
      ['sold by the unit', { defaultUnit: 'UNIT', unitSize: null }, false],
    ] as const)('is shown for a product %s: %s', async (_, over, shown) => {
      const fixture = await boot('/products/it_milk_1l/details', [
        { provide: RESOURCE_GATEWAYS, useValue: milkAs(over) },
      ]);
      expect(view(fixture).isShown(step())).toBe(shown);

      page(fixture).edit();
      await settle(fixture);
      await settle(fixture);
      expect(view(fixture).isShown(step())).toBe(shown);
      expect(select(fixture) !== null).toBe(shown);
    });

    it.each([
      ['KILOGRAM', 250, '250 g'],
      ['KILOGRAM', 1000, '1 kg'],
      ['LITER', 50, '50 ml'],
      ['LITER', 1000, '1 L'],
    ] as const)('reads a step of %s %s as "%s"', async (unit, value, read) => {
      const fixture = await boot('/products/it_milk_1l/details', [
        {
          provide: RESOURCE_GATEWAYS,
          useValue: milkAs({
            defaultUnit: unit,
            unitSize: null,
            quantityStep: value,
          }),
        },
      ]);

      expect(view(fixture).valueOf(step())).toMatchObject({
        kind: 'text',
        text: read,
      });
      expect(text(fixture)).toContain(read);
      // The line under a set step says what a run does with it.
      expect(view(fixture).noteOf(step())).toEqual({
        text: { kind: 'key', key: 'catalog.items.quantityStepSet' },
      });
    });

    it.each([
      ['KILOGRAM', 'catalog.items.quantityStepDefault.gram'],
      ['LITER', 'catalog.items.quantityStepDefault.milliliter'],
    ] as const)(
      'reads no step of %s as its default line, greyed',
      async (unit, key) => {
        const fixture = await boot('/products/it_milk_1l/details', [
          {
            provide: RESOURCE_GATEWAYS,
            useValue: milkAs({ defaultUnit: unit, unitSize: null }),
          },
        ]);

        expect(view(fixture).valueOf(step())).toMatchObject({
          kind: 'none',
          said: { kind: 'key', key },
        });
        const greyed = Array.from(
          fixture.nativeElement.querySelectorAll(
            '[data-none]'
          ) as NodeListOf<HTMLElement>
        ).map((none) => none.textContent?.trim());
        expect(greyed).toContain(key);
        expect(view(fixture).noteOf(step())).toBeNull();
      }
    );

    it('offers the default first, then the ten steps in grams, on the step it holds', async () => {
      const { fixture } = await editing('it_tomato_loose');
      const options = Array.from(select(fixture)?.options ?? []);

      expect(options.map((option) => option.textContent?.trim())).toEqual([
        'catalog.items.quantityStepDefault.gram',
        '1 g',
        '5 g',
        '10 g',
        '25 g',
        '50 g',
        '100 g',
        '200 g',
        '250 g',
        '500 g',
        '1 kg',
      ]);
      expect(options[0].value).toBe('');
      expect(select(fixture)?.value).toBe('100');
    });

    it('redraws the steps in millilitres for the litre, and keeps the value', async () => {
      const { fixture, store } = await editing('it_tomato_loose');

      store.set('defaultUnit', 'LITER');
      await settle(fixture);

      const options = Array.from(select(fixture)?.options ?? []);
      expect(options[0].textContent?.trim()).toBe(
        'catalog.items.quantityStepDefault.milliliter'
      );
      expect(options[options.length - 1].textContent?.trim()).toBe('1 L');
      expect(store.draft()['quantityStep']).toBe('100');
      expect(select(fixture)?.value).toBe('100');
    });

    it('sends the step chosen in the select', async () => {
      const sent: ResourceRow[] = [];
      const { gateways } = recordingProducts(sent);
      const { fixture } = await editing('it_tomato_loose', [
        { provide: RESOURCE_GATEWAYS, useValue: gateways },
      ]);

      const box = select(fixture);
      if (box !== null) {
        box.value = '1000';
        box.dispatchEvent(new Event('change'));
      }
      await settle(fixture);
      await view(fixture).save();
      await settle(fixture);

      expect(sent).toEqual([{ quantityStep: 1000 }]);
    });

    it('sends null for the default', async () => {
      const sent: ResourceRow[] = [];
      const { gateways } = recordingProducts(sent);
      const { fixture } = await editing('it_tomato_loose', [
        { provide: RESOURCE_GATEWAYS, useValue: gateways },
      ]);

      const box = select(fixture);
      if (box !== null) {
        box.value = '';
        box.dispatchEvent(new Event('change'));
      }
      await settle(fixture);
      await view(fixture).save();
      await settle(fixture);

      expect(sent).toEqual([{ quantityStep: null }]);
    });

    /** Backend plan 0261 section 2.2 refuses the weight without the null. */
    it('hides the step once a weight is typed, and sends the weight with a null step', async () => {
      const sent: ResourceRow[] = [];
      const { gateways } = recordingProducts(sent);
      const { fixture, store } = await editing('it_tomato_loose', [
        { provide: RESOURCE_GATEWAYS, useValue: gateways },
      ]);
      expect(view(fixture).isShown(step())).toBe(true);

      store.set('approxWeight', '1500');
      await settle(fixture);
      expect(view(fixture).isShown(step())).toBe(false);
      expect(select(fixture)).toBeNull();

      await view(fixture).save();
      await settle(fixture);

      expect(sent).toEqual([{ approxWeight: 1500, quantityStep: null }]);
    });

    it('sends a null step beside a new unit that carries none', async () => {
      const sent: ResourceRow[] = [];
      const { gateways } = recordingProducts(sent);
      const { fixture, store } = await editing('it_tomato_loose', [
        { provide: RESOURCE_GATEWAYS, useValue: gateways },
      ]);

      store.set('defaultUnit', 'UNIT');
      await settle(fixture);
      expect(view(fixture).isShown(step())).toBe(false);
      await view(fixture).save();
      await settle(fixture);

      expect(sent).toEqual([{ defaultUnit: 'UNIT', quantityStep: null }]);
    });

    it('draws the sentence of the server under the step for a step off the list', async () => {
      const fixture = await boot('/products/it_tomato_loose/details', [
        {
          provide: RESOURCE_GATEWAYS,
          useValue: refusingProductsWith(
            new GatewayError({
              status: 400,
              code: 'validation_failed',
              correlationId: 'cid',
              fieldErrors: {
                quantityStep: ['quantityStep must be one of the steps'],
              },
            })
          ),
        },
      ]);
      const store = page(fixture).store();
      page(fixture).edit();
      await settle(fixture);
      await settle(fixture);
      store.set('brand', 'Another');
      await view(fixture).save();
      await settle(fixture);
      await settle(fixture);

      expect(view(fixture).messages()['quantityStep']).toEqual([
        { kind: 'text', text: 'quantityStep must be one of the steps' },
      ]);
      expect(text(fixture)).toContain('quantityStep must be one of the steps');
    });
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
    expect(tabs(fixture)[2].count?.()).toBe(0);
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
    expect(tabs(fixture)[2].count?.()).toBeNull();
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

/**
 * The photo field edits our photo, and what a shopper sees is a fact beside
 * it (admin plan 0065). The whole milk has no photo of its own and shows
 * Mercadona's; the olive oil has ours.
 */
describe('the photo of a product', () => {
  it('opens our photo empty when a shopper sees a chain photo, and saves another field without it', async () => {
    const sent: ResourceRow[] = [];
    const { gateways, memory } = recordingProducts(sent);
    const fixture = await boot('/products/it_milk_1l/details', [
      { provide: RESOURCE_GATEWAYS, useValue: gateways },
    ]);
    const store = page(fixture).store();

    // The view answers the chain photo as `imageUrl`, and ours is null.
    const wire = await heldProduct(memory, 'it_milk_1l');
    expect(wire.imageUrl).toContain('mercadona');
    expect(wire.ownImageUrl).toBeNull();

    // Reading: our photo is none, and "Shoppers see" names the chain.
    expect(view(fixture).valueOf(itemField('imageUrl'))).toEqual({
      kind: 'none',
    });
    expect(view(fixture).valueOf(itemField('shownPhoto'))).toEqual({
      kind: 'image',
      src: wire.imageUrl,
      caption: {
        kind: 'reference',
        resource: 'supermarkets',
        id: 'sm_mercadona',
      },
    });

    page(fixture).edit();
    await settle(fixture);
    await settle(fixture);
    // The form opens our photo empty, and holds no draft of the fact.
    expect(store.draft()['imageUrl']).toBe('');
    expect('shownPhoto' in store.draft()).toBe(false);
    // The fact is locked for its own reason, not "Set by the system".
    expect(view(fixture).lockReason(itemField('shownPhoto'))).toBe(
      'catalog.items.shownSetBy'
    );

    store.set('unitSize', '2');
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);

    expect(store.mode()).toBe('read');
    expect(sent).toEqual([{ unitSize: 2 }]);
    const saved = await heldProduct(memory, 'it_milk_1l');
    expect(saved.ownImageUrl).toBeNull();
    expect(saved.imageSource).toBe('CHAIN');
  });

  it('sends our photo as imageUrl, and then a shopper sees ours', async () => {
    const sent: ResourceRow[] = [];
    const { gateways, memory } = recordingProducts(sent);
    const fixture = await boot('/products/it_milk_1l/details', [
      { provide: RESOURCE_GATEWAYS, useValue: gateways },
    ]);
    const store = page(fixture).store();
    const ours = 'https://images.example.org/products/milk.jpg';

    page(fixture).edit();
    await settle(fixture);
    await settle(fixture);
    store.set('imageUrl', ours);
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);

    expect(sent).toEqual([{ imageUrl: ours }]);
    const saved = await heldProduct(memory, 'it_milk_1l');
    expect(saved.ownImageUrl).toBe(ours);
    expect(saved.imageUrl).toBe(ours);
    // Ours comes first, and the chain photo is still behind it.
    expect(saved.images.map((image) => image.source)).toEqual([
      'OWNER',
      'CHAIN',
    ]);
    expect(view(fixture).valueOf(itemField('shownPhoto'))).toEqual({
      kind: 'image',
      src: ours,
      caption: { kind: 'word', key: 'catalog.items.shownFrom.owner' },
    });
  });

  it('says "Ours" for a product with its own photo, and "No photo" for one with none', async () => {
    const oil = await boot('/products/it_olive_oil_1l/details');
    expect(view(oil).valueOf(itemField('shownPhoto'))).toMatchObject({
      caption: { kind: 'word', key: 'catalog.items.shownFrom.owner' },
    });
    expect(view(oil).valueOf(itemField('imageUrl'))).toMatchObject({
      kind: 'image',
    });

    const soap = await boot('/products/it_dish_soap/details');
    expect(view(soap).valueOf(itemField('shownPhoto'))).toEqual({
      kind: 'word',
      key: 'catalog.items.shownFrom.none',
    });
  });

  it('draws every picture with no referrer', async () => {
    const fixture = await boot('/products/it_olive_oil_1l/details');
    const pictures = [
      ...fixture.nativeElement.querySelectorAll('lib-record-view img'),
    ] as HTMLImageElement[];

    // Our photo, and the same photo as what a shopper sees.
    expect(pictures).toHaveLength(2);
    for (const picture of pictures) {
      expect(picture.getAttribute('referrerpolicy')).toBe('no-referrer');
    }
  });
});

describe('the photos on the Sources tab', () => {
  it('shows the saved photo of each row that has one, and whether it is shown', async () => {
    const fixture = await boot('/products/it_milk_1l/sources');
    const host = fixture.nativeElement as HTMLElement;

    const shown = host.querySelector('[data-photo="entry-bound-milk"]');
    expect(shown?.textContent).toContain('catalog.items.sources.photoShown');
    expect(shown?.querySelector('img')?.getAttribute('referrerpolicy')).toBe(
      'no-referrer'
    );
    expect(
      host.querySelector('[data-photo="entry-bound-milk-deza"]')?.textContent
    ).toContain('catalog.items.sources.photoSaved');
    // The candidate row has no link, and draws nothing new.
    expect(
      host.querySelector('[data-photo="entry-bound-milk-promo"]')
    ).toBeNull();
    expect(host.querySelectorAll('[data-photo]')).toHaveLength(2);
  });

  it('draws the grey square for a photo that does not load', async () => {
    const fixture = await boot('/products/it_milk_1l/sources');
    const host = fixture.nativeElement as HTMLElement;

    host
      .querySelector('[data-photo="entry-bound-milk"] img')
      ?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    const row = host.querySelector('[data-photo="entry-bound-milk"]');
    expect(row?.querySelector('img')).toBeNull();
    expect(row?.querySelector('.thumb')).not.toBeNull();
  });

  it('draws no photo column for a product with no saved photo', async () => {
    const fixture = await boot('/products/it_olive_oil_1l/sources');

    expect(text(fixture)).not.toContain('catalog.items.sources.photo');
  });

  it('keeps the rows when the photos cannot be read', async () => {
    const fixture = await boot('/products/it_milk_1l/sources', [
      {
        provide: ItemLinkedImages,
        useValue: {
          read: async () => {
            throw unavailable();
          },
        },
      },
    ]);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-photos-failed]')).not.toBeNull();
    expect(text(fixture)).toContain('Leche entera Hacendado');
    expect(host.querySelector('[data-photo]')).toBeNull();
  });

  it('maps the links from the wire, by source row', () => {
    expect(toItemSourcePhotos(null).size).toBe(0);
    expect(toItemSourcePhotos({ images: 'no' }).size).toBe(0);
    const photos = toItemSourcePhotos({
      images: [
        { sourceEntryId: 'e1', url: 'https://a.example/1.jpg', enabled: true },
        { sourceEntryId: 'e2', url: 'https://a.example/2.jpg', enabled: 'yes' },
        { sourceEntryId: 'e3', url: '' },
        { url: 'https://a.example/4.jpg', enabled: true },
      ],
    });
    expect([...photos]).toEqual([
      ['e1', { url: 'https://a.example/1.jpg', enabled: true }],
      // Only a JSON true is on.
      ['e2', { url: 'https://a.example/2.jpg', enabled: false }],
    ]);
  });
});
