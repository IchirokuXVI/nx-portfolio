import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  ServerReachability,
  SessionStorage,
  SessionStore,
  type ResourceGatewaysI,
  type ResourceSource,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  ResourceGateway,
  ResourceQuery,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  CategoryTree,
  PageHeader,
  PopoverSheet,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { CATEGORIES_PATH, ITEMS_PATH, PRICES_PATH } from '../catalog-sources';
import { CHAIN_RESOURCES, chainsRoutes } from '../chains/chains-routes';
import { PriceScopePicker } from './price-scope-picker';
import { PRODUCTS_INFO, ProductsPage } from './products-page';
import {
  PRODUCT_RESOURCES,
  PRODUCTS_SEGMENT,
  productsRoutes,
} from './products-routes';
import { PricesAtStore, type PriceScopeChoice } from './scope-choices';

/**
 * The product list (admin plan 0043, target 2), against the in memory
 * gateways: the category tree, "Prices at", the state, its own rows and the
 * bar for ticked rows.
 *
 * The bulk panels themselves are `product-group-bulk.spec.ts`'s and
 * `categories.spec.ts`'s claim. This file is about the list around them.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

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

const viewport = (compact: boolean, split: boolean): Provider => ({
  provide: Viewport,
  useValue: { compact: signal(compact), split: signal(split) },
});

/** 72 rem and above: the tree is a column beside the list. */
const WIDE = viewport(false, true);
/** Between 48 rem and 72 rem: a table, and the tree behind a button. */
const MIDDLE = viewport(false, false);
/** Below 48 rem: two line rows, and the tree behind a button. */
const PHONE = viewport(true, false);

/** The Córdoba warehouse of Mercadona, which prices the milk and the oil. */
const CORDOBA: PriceScopeChoice = {
  chain: {
    id: 'sm_mercadona',
    name: { en: 'Mercadona', es: 'Mercadona' },
    defaultPriceScopeId: 'ps_mercadona_national',
  },
  scope: {
    id: 'ps_mercadona_4661',
    supermarketId: 'sm_mercadona',
    kind: 'REGION',
    externalKey: '4661',
    label: { en: 'Córdoba warehouse', es: 'Almacén de Córdoba' },
  },
};

/** The memory gateways, recording every list read by the path it went to. */
function recording(reads: { path: string; query: ResourceQuery }[]) {
  const memory = new ResourceMemoryGateways();
  const gateways: ResourceGatewaysI = {
    for: <T extends ResourceRow>(source: ResourceSource<T>) => {
      const inner = memory.for(source);
      return {
        list: (query) => {
          reads.push({ path: source.path, query });
          return inner.list(query);
        },
        read: (id) => inner.read(id),
        create: (input) => inner.create(input),
        update: (id, input) => inner.update(id, input),
        remove: (id) => inner.remove(id),
      } satisfies ResourceGateway<T>;
    },
  };
  return gateways;
}

async function boot(url = '/products', providers: Provider[] = [WIDE]) {
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

  return fixture;
}

async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const page = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(ProductsPage))
    .componentInstance as ProductsPage;

const q = <T extends Element>(
  fixture: ComponentFixture<TestHost>,
  selector: string
) => fixture.nativeElement.querySelector(selector) as T | null;

const all = (fixture: ComponentFixture<TestHost>, selector: string) =>
  [...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];

const headers = (fixture: ComponentFixture<TestHost>) =>
  all(fixture, 'thead th').map((cell) => cell.textContent?.trim() ?? '');

beforeEach(() => localStorage.clear());

afterEach(() => {
  localStorage.clear();
  TestBed.resetTestingModule();
});

describe('the product list', () => {
  it('is the Products tab of its section, under one header', async () => {
    const fixture = await boot();
    const header = fixture.debugElement.query(By.directive(PageHeader))
      .componentInstance as PageHeader;

    expect(header.heading()).toBe('catalog.items.many');
    expect(header.info()).toBe(PRODUCTS_INFO);
    // The texts of target 9, as keys: tick together, and choose a scope.
    expect(PRODUCTS_INFO.points).toEqual([
      'catalog.items.info.tick',
      'catalog.items.info.scope',
    ]);
    expect(
      fixture.debugElement.queryAll(By.directive(PageHeader))
    ).toHaveLength(1);
    expect(q(fixture, 'lib-page-header button.primary')?.textContent).toContain(
      'catalog.items.add'
    );
  });

  it('draws a row as the name over the brand, the size, the barcode and the group', async () => {
    const fixture = await boot();
    const [milk] = page(fixture).products();

    expect(milk).toMatchObject({
      id: 'it_milk_1l',
      name: 'Whole milk 1 L',
      brand: 'Hacendado',
      size: '1 L',
      barcode: '8480000123459',
      price: { kind: 'none' },
    });
    expect(headers(fixture)).toEqual([
      // The tick box of every loaded row.
      '',
      'catalog.items.product',
      'catalog.items.unitSize',
      'catalog.items.ean',
      'catalog.items.group',
    ]);
    const row = all(fixture, 'tbody tr')[0];
    expect(row.querySelector('.title')?.textContent?.trim()).toBe(
      'Whole milk 1 L'
    );
    expect(row.querySelector('.brand')?.textContent).toBe('Hacendado');
    // The barcode in the mono face.
    expect(row.querySelector('.mono')?.textContent).toBe('8480000123459');
  });

  /** The group is named by a lookup, and links to the group. */
  it('names the group of a row, as a link to it', async () => {
    const fixture = await boot();
    await settle(fixture);

    const anchors = all(fixture, 'tbody td a');
    expect(anchors.map((anchor) => anchor.textContent?.trim())).toContain(
      'Olive oil'
    );
    expect(
      anchors
        .find((anchor) => anchor.textContent?.trim() === 'Olive oil')
        ?.getAttribute('href')
    ).toBe('/products/groups/pg_olive_oil');
  });

  /** Six cartons of a litre, which a size of 6 L alone would not say. */
  it('writes a pack as its count and the size of one', async () => {
    const fixture = await boot();

    expect(
      page(fixture)
        .products()
        .find((row) => row.id === 'it_milk_6pack')?.size
    ).toBe('6 x 1 L');
  });

  it('opens a product on its own page, and the form of a new one', async () => {
    const fixture = await boot();
    const router = TestBed.inject(Router);

    q<HTMLButtonElement>(fixture, '[data-row="it_dish_soap"]')?.click();
    await settle(fixture);
    await settle(fixture);
    expect(router.url).toBe('/products/it_dish_soap/details');

    await router.navigateByUrl('/products');
    await settle(fixture);
    q<HTMLButtonElement>(fixture, 'lib-page-header button.primary')?.click();
    await settle(fixture);
    expect(router.url).toBe('/products/new');
  });

  it('offers no delete on a row: a product is deleted on its page', async () => {
    const fixture = await boot();

    expect(q(fixture, 'tbody button.danger')).toBeNull();
  });
});

describe('the category tree beside the product list', () => {
  it('is a column on a wide screen, with each category and its count', async () => {
    const fixture = await boot();
    const tree = fixture.debugElement.query(By.directive(CategoryTree))
      .componentInstance as CategoryTree;

    expect(q(fixture, 'aside.tree')).not.toBeNull();
    expect(q(fixture, '[data-category-button]')).toBeNull();
    const dairy = tree
      .nodes()
      .find((node) => node.id === 'cat_eggs-milk-and-butter');
    expect(dairy?.children.map((child) => child.id)).toContain('cat_milk');
    expect(typeof dairy?.count).toBe('number');
    // Nobody counted every product, so "All products" says no number.
    expect(tree.allCount()).toBeNull();
    expect(q(fixture, '.edit-tree')?.getAttribute('href')).toBe(
      '/products/categories'
    );
  });

  it('narrows the list when a category is pressed', async () => {
    const fixture = await boot();
    const tree = fixture.debugElement.query(By.directive(CategoryTree))
      .componentInstance as CategoryTree;

    tree.choose.emit('cat_milk');
    await settle(fixture);

    expect(page(fixture).category()).toBe('cat_milk');
    expect(page(fixture).store.filters()['categoryId']).toBe('cat_milk');
    expect(
      page(fixture)
        .products()
        .map((row) => row.id)
    ).toEqual(['it_milk_1l', 'it_milk_6pack']);
  });

  /** The literal the gateway reads on the same parameter a category goes on. */
  it('asks for the products on no category by the literal none', async () => {
    const reads: { path: string; query: ResourceQuery }[] = [];
    const fixture = await boot('/products', [
      WIDE,
      { provide: RESOURCE_GATEWAYS, useValue: recording(reads) },
    ]);
    const tree = fixture.debugElement.query(By.directive(CategoryTree))
      .componentInstance as CategoryTree;

    tree.choose.emit('none');
    await settle(fixture);

    const last = reads.filter((read) => read.path === ITEMS_PATH).pop();
    expect(last?.query.filters?.['categoryId']).toBe('none');
    expect(page(fixture).category()).toBe('none');

    tree.choose.emit('');
    await settle(fixture);
    expect(page(fixture).category()).toBe('');
    expect(page(fixture).products()).toHaveLength(4);
  });

  it('opens already narrowed by the category a link names, and marks it', async () => {
    const fixture = await boot('/products?categoryId=cat_milk');
    const tree = fixture.debugElement.query(By.directive(CategoryTree))
      .componentInstance as CategoryTree;

    expect(tree.selected()).toBe('cat_milk');
    expect(page(fixture).products()).toHaveLength(2);
    // The tree draws no control for the category among the list's filters.
    expect(q(fixture, '[id="filter-categoryId"]')).toBeNull();
    expect(q(fixture, '[id="filter-query"]')).not.toBeNull();
  });

  it('is behind a button below 72 rem, and opens in a sheet', async () => {
    const fixture = await boot('/products', [MIDDLE]);

    expect(q(fixture, 'aside.tree')).toBeNull();
    const button = q<HTMLButtonElement>(fixture, '[data-category-button]');
    expect(button?.textContent).toContain('resource.filter.any');
    expect(fixture.debugElement.query(By.directive(PopoverSheet))).toBeNull();

    button?.click();
    await settle(fixture);

    const sheet = fixture.debugElement.query(By.directive(PopoverSheet));
    expect((sheet.componentInstance as PopoverSheet).sheet()).toBe(true);
    const tree = sheet.query(By.directive(CategoryTree))
      .componentInstance as CategoryTree;

    tree.choose.emit('cat_milk');
    await settle(fixture);

    // Choosing closes the sheet, narrows the list and names the choice.
    expect(fixture.debugElement.query(By.directive(PopoverSheet))).toBeNull();
    expect(page(fixture).products()).toHaveLength(2);
    expect(q(fixture, '[data-category-button]')?.textContent).toContain('Milk');
  });

  /** The tree is named in the language the catalog is read in. */
  it('reads the tree again when the content language changes', async () => {
    const reads: { path: string; query: ResourceQuery }[] = [];
    const fixture = await boot('/products', [
      WIDE,
      { provide: RESOURCE_GATEWAYS, useValue: recording(reads) },
    ]);
    const trees = () =>
      reads.filter((read) => read.path === CATEGORIES_PATH).length;
    const lists = () => reads.filter((read) => read.path === ITEMS_PATH).length;
    const before = { trees: trees(), lists: lists() };
    const tree = fixture.debugElement.query(By.directive(CategoryTree))
      .componentInstance as CategoryTree;
    const english = tree.nodes()[0].name;

    TestBed.inject(ContentLocaleStore).choose('es');
    await settle(fixture);
    await settle(fixture);

    expect(trees()).toBe(before.trees + 1);
    expect(lists()).toBe(before.lists + 1);
    // Named again at once, from the rows it holds.
    expect(tree.nodes()[0].name).not.toBe(english);
  });
});

describe('"Prices at" on the product list', () => {
  it('shows no price column until a scope is chosen', async () => {
    const fixture = await boot();

    expect(page(fixture).scope()).toBeNull();
    expect(headers(fixture)).not.toContain('catalog.prices.price');
    expect(q(fixture, '.segment')).toBeNull();
    const picker = fixture.debugElement.query(By.directive(PriceScopePicker))
      .componentInstance as PriceScopePicker;
    expect(picker.choice()).toBeNull();
  });

  it('gains a Price and a Seen column at the scope chosen', async () => {
    const fixture = await boot();

    await page(fixture).chooseScope(CORDOBA);
    await settle(fixture);

    expect(headers(fixture).slice(-2)).toEqual([
      'catalog.prices.price',
      'catalog.pricesAt.seen',
    ]);
    const rows = page(fixture).products();
    // Money through `Intl`, from the number the wire carries.
    expect(rows.find((row) => row.id === 'it_milk_1l')?.price).toEqual({
      kind: 'price',
      text: '€0.89',
    });
    expect(rows.find((row) => row.id === 'it_olive_oil_1l')?.price).toEqual({
      kind: 'price',
      text: '€8.45',
    });
    // The scope holds no row for the soap, and the list says nothing there.
    expect(rows.find((row) => row.id === 'it_dish_soap')?.price).toEqual({
      kind: 'none',
    });
  });

  /** The server's judgement, drawn where the date would be. */
  it('says "Out of date" on a row whose shown price is', async () => {
    const fixture = await boot();

    await page(fixture).chooseScope(CORDOBA);
    await settle(fixture);

    expect(
      page(fixture)
        .products()
        .find((row) => row.id === 'it_milk_1l')?.stale
    ).toBe(true);
    expect(
      all(fixture, 'tbody .chip.bad').map((chip) => chip.textContent?.trim())
    ).toEqual(['catalog.prices.stale']);
  });

  /** The constraint: one request per page, never one per row. */
  it('reads the prices of the page in one request', async () => {
    const reads: { path: string; query: ResourceQuery }[] = [];
    const fixture = await boot('/products', [
      WIDE,
      { provide: RESOURCE_GATEWAYS, useValue: recording(reads) },
    ]);
    const before = reads.filter((read) => read.path === PRICES_PATH).length;

    await page(fixture).chooseScope(CORDOBA);
    await settle(fixture);

    const priced = reads.filter((read) => read.path === PRICES_PATH);
    expect(priced).toHaveLength(before + 1);
    expect(priced[priced.length - 1].query.filters).toEqual({
      priceScopeId: 'ps_mercadona_4661',
      itemIds: [
        'it_milk_1l',
        'it_milk_6pack',
        'it_olive_oil_1l',
        'it_dish_soap',
      ],
    });
    // And the scope never reaches the product read.
    const products = reads.filter((read) => read.path === ITEMS_PATH).pop();
    expect(products?.query.filters).toEqual({});
  });

  it('keeps the choice for the operator, and opens on it the next time', async () => {
    const first = await boot();
    await page(first).chooseScope(CORDOBA);
    await settle(first);

    expect(TestBed.inject(PricesAtStore).choice()?.scope.id).toBe(
      'ps_mercadona_4661'
    );
    expect(
      JSON.parse(localStorage.getItem('luna-shopper-admin.prices-at') ?? '{}')
        .scope.id
    ).toBe('ps_mercadona_4661');

    const reads: { path: string; query: ResourceQuery }[] = [];
    const second = await boot('/products', [
      WIDE,
      { provide: RESOURCE_GATEWAYS, useValue: recording(reads) },
    ]);

    expect(page(second).scope()?.scope.id).toBe('ps_mercadona_4661');
    expect(headers(second)).toContain('catalog.prices.price');
    // One read of the products on opening, already at the scope: not one
    // without it and then one with.
    expect(reads.filter((read) => read.path === ITEMS_PATH)).toHaveLength(1);
    // The button names the choice from what was kept, before anything is read.
    const picker = second.debugElement.query(By.directive(PriceScopePicker))
      .componentInstance as PriceScopePicker;
    expect(picker.shown()).toMatchObject({
      chain: 'Mercadona',
      scope: 'Córdoba warehouse',
      level: 2,
    });
  });

  it('forgets the choice when it is cleared, and drops the columns', async () => {
    const fixture = await boot();
    await page(fixture).chooseScope(CORDOBA);
    await settle(fixture);

    await page(fixture).chooseScope(null);
    await settle(fixture);

    expect(page(fixture).scope()).toBeNull();
    expect(headers(fixture)).not.toContain('catalog.prices.price');
    expect(localStorage.getItem('luna-shopper-admin.prices-at')).toBeNull();
  });

  it('ignores a kept choice that is not one', async () => {
    localStorage.setItem('luna-shopper-admin.prices-at', '{"scope":"x"}');
    const fixture = await boot();

    expect(page(fixture).scope()).toBeNull();
  });

  /** A link wins over the kept choice, and is named once it is read. */
  it('opens at the scope a link names', async () => {
    const fixture = await boot('/products?priceScopeId=ps_consum_centro');
    await settle(fixture);
    await settle(fixture);

    expect(page(fixture).scope()).toMatchObject({
      scope: { id: 'ps_consum_centro', kind: 'STORE' },
      chain: { id: 'sm_consum' },
    });
    expect(
      page(fixture)
        .products()
        .find((row) => row.id === 'it_milk_1l')?.price
    ).toEqual({ kind: 'unavailable' });
  });

  it('keeps the scope when the filters are cleared', async () => {
    const fixture = await boot();
    await page(fixture).chooseScope(CORDOBA);
    await page(fixture).store.setFilter('query', 'no such product');
    await settle(fixture);
    expect(page(fixture).store.noMatch()).toBe(true);

    await page(fixture).clearFilters();
    await settle(fixture);

    expect(page(fixture).store.filters()['query'] ?? '').toBe('');
    expect(page(fixture).scope()?.scope.id).toBe('ps_mercadona_4661');
    expect(page(fixture).products()).toHaveLength(4);
  });
});

describe('the states of a price at the chosen scope', () => {
  /**
   * "Not sold here" is not drawn: the gateway cannot answer it today (see
   * `PRICE_STATES`).
   */
  it('offers the states the gateway can answer, and no other', async () => {
    const fixture = await boot();
    await page(fixture).chooseScope(CORDOBA);
    await settle(fixture);

    expect(
      all(fixture, '.segment button').map((button) =>
        button.getAttribute('data-state')
      )
    ).toEqual(['any', 'stale', 'noPrice']);
    // No state says a number until it is the one chosen and counted.
    expect(q(fixture, '[data-state-count]')).toBeNull();
    expect(q(fixture, '[data-state="any"]')?.getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('reads the list from the prices for "Out of date"', async () => {
    const reads: { path: string; query: ResourceQuery }[] = [];
    const fixture = await boot('/products', [
      WIDE,
      { provide: RESOURCE_GATEWAYS, useValue: recording(reads) },
    ]);
    await page(fixture).chooseScope(CORDOBA);
    await settle(fixture);
    const productReads = reads.filter(
      (read) => read.path === ITEMS_PATH
    ).length;

    q<HTMLButtonElement>(fixture, '[data-state="stale"]')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(page(fixture).state()).toBe('stale');
    expect(reads[reads.length - 1]).toMatchObject({
      path: PRICES_PATH,
      query: { filters: { priceScopeId: 'ps_mercadona_4661', stale: 'true' } },
    });
    // Not one more read of the products.
    expect(reads.filter((read) => read.path === ITEMS_PATH)).toHaveLength(
      productReads
    );
    // The one product whose price at the scope is out of date, by its name.
    expect(
      page(fixture)
        .products()
        .map((row) => [row.id, row.name, row.stale])
    ).toEqual([['it_milk_1l', 'Whole milk 1 L', true]]);
  });

  /**
   * Such a row names its product and carries nothing else of it, so the
   * search, the group and the tree's button are put away, the columns that
   * would be empty are not drawn, and the rows cannot be ticked.
   */
  it('puts the filters away and draws no tick box while a state is chosen', async () => {
    const fixture = await boot();
    await page(fixture).chooseScope(CORDOBA);
    page(fixture).pick('it_milk_1l');
    await settle(fixture);
    expect(q(fixture, '[data-bulk-bar]')).not.toBeNull();

    page(fixture).chooseState('stale');
    await settle(fixture);
    await settle(fixture);

    expect(q(fixture, 'lib-resource-filters')).toBeNull();
    expect(q(fixture, '[data-pick-row]')).toBeNull();
    expect(q(fixture, '[data-bulk-bar]')).toBeNull();
    expect(headers(fixture)).toEqual([
      'catalog.items.product',
      'catalog.prices.price',
      'catalog.pricesAt.seen',
    ]);
    expect(fixture.nativeElement.textContent).toContain(
      'catalog.pricesAt.state.note'
    );

    page(fixture).chooseState(null);
    await settle(fixture);
    await settle(fixture);
    expect(q(fixture, 'lib-resource-filters')).not.toBeNull();
    expect(page(fixture).products()).toHaveLength(4);
  });

  /**
   * The read of the prices takes the scope and the state alone. So the tree
   * leaves the wide screen as well, and a category set before is said to be
   * set aside, and is applied again with "Any price".
   */
  it('puts the tree away on a wide screen, and says a category is set aside', async () => {
    const reads: { path: string; query: ResourceQuery }[] = [];
    const fixture = await boot('/products', [
      WIDE,
      { provide: RESOURCE_GATEWAYS, useValue: recording(reads) },
    ]);
    await page(fixture).chooseScope(CORDOBA);
    await settle(fixture);
    expect(q(fixture, 'aside.tree')).not.toBeNull();

    page(fixture).chooseState('stale');
    await settle(fixture);
    await settle(fixture);

    // No category set: the tree goes, and nothing is said to be set aside.
    expect(q(fixture, 'aside.tree')).toBeNull();
    expect(q(fixture, '.layout.split')).toBeNull();
    expect(q(fixture, '[data-suspended]')).toBeNull();

    page(fixture).chooseState(null);
    await settle(fixture);
    await settle(fixture);
    page(fixture).chooseCategory('cat_dairy');
    await settle(fixture);
    page(fixture).chooseState('stale');
    await settle(fixture);
    await settle(fixture);

    expect(q(fixture, 'aside.tree')).toBeNull();
    expect(q(fixture, '[data-suspended]')?.textContent).toContain(
      'catalog.pricesAt.state.suspended'
    );
    // The read names the scope and the state, and no category.
    expect(reads[reads.length - 1].path).toBe(PRICES_PATH);
    expect(reads[reads.length - 1].query.filters).toEqual({
      priceScopeId: 'ps_mercadona_4661',
      stale: 'true',
    });

    // "Any price" brings the tree back with the category still marked.
    page(fixture).chooseState(null);
    await settle(fixture);
    await settle(fixture);
    expect(q(fixture, 'aside.tree')).not.toBeNull();
    expect(page(fixture).category()).toBe('cat_dairy');
    expect(reads[reads.length - 1]).toMatchObject({
      path: ITEMS_PATH,
      query: { filters: { categoryId: 'cat_dairy' } },
    });
  });

  /**
   * "No price" (backend plan 0187) is read from the products, so its rows are
   * whole: the scope goes to the product route, and the state says how many
   * products it holds.
   */
  it('reads the list from the products for "No price", and says how many', async () => {
    const reads: { path: string; query: ResourceQuery }[] = [];
    const fixture = await boot('/products', [
      WIDE,
      { provide: RESOURCE_GATEWAYS, useValue: recording(reads) },
    ]);
    await page(fixture).chooseScope(CORDOBA);
    await settle(fixture);
    const priceReads = reads.filter((read) => read.path === PRICES_PATH).length;

    q<HTMLButtonElement>(fixture, '[data-state="noPrice"]')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(page(fixture).state()).toBe('noPrice');
    expect(reads[reads.length - 1]).toMatchObject({
      path: ITEMS_PATH,
      query: { filters: { withoutPriceAtScopeId: 'ps_mercadona_4661' } },
    });
    // Neither name of this page for the scope reaches the product route.
    expect(reads[reads.length - 1].query.filters).not.toHaveProperty(
      'priceScopeId'
    );
    expect(reads[reads.length - 1].query.filters).not.toHaveProperty(
      'priceState'
    );
    // Not one more read of the prices: there is no price to show.
    expect(reads.filter((read) => read.path === PRICES_PATH)).toHaveLength(
      priceReads
    );

    // The seed prices the milk and the oil at this scope, and no other.
    const listed = page(fixture)
      .products()
      .map((row) => row.id);
    expect(listed).toHaveLength(2);
    expect(listed).not.toContain('it_milk_1l');
    expect(listed).not.toContain('it_olive_oil_1l');
    expect(
      page(fixture)
        .products()
        .every((row) => row.price.kind === 'none')
    ).toBe(true);

    const pressed = q(fixture, '[data-state="noPrice"]');
    expect(pressed?.getAttribute('aria-pressed')).toBe('true');
    expect(q(fixture, '[data-state-count]')?.textContent?.trim()).toBe('2');
    expect(pressed?.textContent).toContain('catalog.pricesAt.state.noPrice');
  });

  /**
   * Its rows are whole products, so nothing is put away: the search, the
   * group, the tree and the ticks stay, and each narrows the worklist.
   */
  it('keeps the filters, the tree and the ticks for "No price", and counts what they leave', async () => {
    const reads: { path: string; query: ResourceQuery }[] = [];
    const fixture = await boot('/products', [
      WIDE,
      { provide: RESOURCE_GATEWAYS, useValue: recording(reads) },
    ]);
    await page(fixture).chooseScope(CORDOBA);
    page(fixture).chooseState('noPrice');
    await settle(fixture);
    await settle(fixture);

    expect(q(fixture, 'lib-resource-filters')).not.toBeNull();
    expect(q(fixture, 'aside.tree')).not.toBeNull();
    expect(q(fixture, '[data-pick-row]')).not.toBeNull();
    expect(q(fixture, '[data-suspended]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      'catalog.pricesAt.state.note'
    );
    expect(headers(fixture)).toContain('catalog.items.ean');

    const [first] = page(fixture).products();
    const category = (
      page(fixture).rows()[0].row as unknown as {
        categories: { id: string }[];
      }
    ).categories[0].id;
    page(fixture).chooseCategory(category);
    await settle(fixture);
    await settle(fixture);

    expect(reads[reads.length - 1]).toMatchObject({
      path: ITEMS_PATH,
      query: {
        filters: {
          categoryId: category,
          withoutPriceAtScopeId: 'ps_mercadona_4661',
        },
      },
    });
    const narrowed = page(fixture).products();
    expect(narrowed.map((row) => row.id)).toContain(first.id);
    expect(q(fixture, '[data-state-count]')?.textContent?.trim()).toBe(
      String(narrowed.length)
    );
  });

  it('says no number once "No price" is not the state chosen', async () => {
    const fixture = await boot();
    await page(fixture).chooseScope(CORDOBA);
    page(fixture).chooseState('noPrice');
    await settle(fixture);
    await settle(fixture);
    expect(q(fixture, '[data-state-count]')).not.toBeNull();

    page(fixture).chooseState(null);
    await settle(fixture);
    await settle(fixture);

    expect(q(fixture, '[data-state-count]')).toBeNull();
    expect(page(fixture).products()).toHaveLength(4);
  });

  it('opens on "No price" when a link names the scope and the state', async () => {
    const fixture = await boot(
      '/products?priceScopeId=ps_mercadona_4661&priceState=noPrice'
    );

    expect(page(fixture).state()).toBe('noPrice');
    expect(page(fixture).products()).toHaveLength(2);
  });

  it('drops the state with the scope', async () => {
    const fixture = await boot();
    await page(fixture).chooseScope(CORDOBA);
    page(fixture).chooseState('stale');
    await settle(fixture);
    await settle(fixture);

    await page(fixture).chooseScope(null);
    await settle(fixture);

    expect(page(fixture).state()).toBeNull();
    expect(page(fixture).store.filters()['priceState'] ?? '').toBe('');
    expect(page(fixture).products()).toHaveLength(4);
  });
});

describe('ticking products', () => {
  it('shows a bar at the bottom with what can be done to them', async () => {
    const fixture = await boot();
    expect(q(fixture, '[data-bulk-bar]')).toBeNull();

    all(fixture, '[data-pick-row]')[0].dispatchEvent(new Event('change'));
    all(fixture, '[data-pick-row]')[2].dispatchEvent(new Event('change'));
    await settle(fixture);

    const bar = q(fixture, '[data-bulk-bar]');
    expect(bar?.textContent).toContain('catalog.items.selected');
    expect(
      [...(bar?.querySelectorAll('button') ?? [])].map((button) =>
        button.textContent?.trim()
      )
    ).toEqual([
      'catalog.items.setGroup.action',
      'catalog.items.setCategories.action',
      'catalog.items.clearSelection',
    ]);
    expect(page(fixture).selectedRows()).toHaveLength(2);
  });

  it('ticks and unticks every loaded row from the head of the table', async () => {
    const fixture = await boot();
    const head = q<HTMLInputElement>(fixture, '[data-pick-all]');

    head?.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(page(fixture).selectedRows()).toHaveLength(4);
    expect(page(fixture).allPicked()).toBe(true);

    head?.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(page(fixture).selectedRows()).toHaveLength(0);
  });

  it('opens a bulk panel above the rows, and puts the bar away meanwhile', async () => {
    const fixture = await boot();
    page(fixture).pick('it_milk_1l');
    await settle(fixture);

    q<HTMLButtonElement>(fixture, '[data-bulk="setGroup"]')?.click();
    await settle(fixture);

    expect(q(fixture, '.bulk-panel lib-set-group-panel')).not.toBeNull();
    expect(q(fixture, '[data-bulk-bar]')).toBeNull();
  });
});

describe('the product list on a phone', () => {
  it('draws a row as two lines: the name and brand, then the size and price', async () => {
    localStorage.setItem(
      'luna-shopper-admin.prices-at',
      JSON.stringify(CORDOBA)
    );
    const fixture = await boot('/products', [PHONE]);

    expect(q(fixture, 'table')).toBeNull();
    const card = all(fixture, '.card')[0];
    const lines = [...card.querySelectorAll('.line')];
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain('Whole milk 1 L');
    expect(lines[0].textContent).toContain('Hacendado');
    expect(lines[1].textContent).toContain('1 L');
    expect(lines[1].textContent).toContain('€0.89');
    // And it can be ticked, as a row of the table can.
    expect(card.querySelector('[data-pick-row]')).not.toBeNull();
  });

  /** So that the first product is not a screen down. */
  it('keeps only the search in view, and the group and the order behind a button', async () => {
    const fixture = await boot('/products', [PHONE]);

    expect(q(fixture, '[id="filter-query"]')).not.toBeNull();
    expect(q(fixture, '[id="filter-productGroupId"]')).toBeNull();

    q<HTMLButtonElement>(fixture, '[data-more-filters]')?.click();
    await settle(fixture);

    expect(q(fixture, '[id="filter-productGroupId"]')).not.toBeNull();
    expect(page(fixture).narrowedBy()).toBe(0);

    await page(fixture).store.setFilter('productGroupId', 'none');
    await settle(fixture);
    expect(page(fixture).narrowedBy()).toBe(1);
  });
});
