import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  GatewayError,
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
  RecordPage,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  ResourceGateway,
  ResourceRow,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  InfoButton,
  PopoverSheet,
  SaveBar,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import type { ItemScopePrices } from '../catalog-seed';
import { ITEM_PRICES_PATH, ITEM_SCOPE_PRICES_PATH } from '../catalog-sources';
import { CHAIN_RESOURCES, chainsRoutes } from '../chains/chains-routes';
import { PriceFormPage } from '../price-form-page';
import {
  priceRowState,
  ProductPricesTab,
  toShownBecause,
} from './product-prices-tab';
import {
  PRODUCT_RESOURCES,
  PRODUCTS_SEGMENT,
  productsRoutes,
} from './products-routes';

/**
 * The Prices tab of a product, against the in memory gateways (admin plan
 * 0043, target 3): its prices by chain and scope, and the form that adds a
 * price. The tab is a part of the product's record page (admin plan 0055),
 * so every case mounts it through the routes of the app.
 *
 * The page around it, its tabs and its other two parts are in
 * `product-record.spec.ts`.
 *
 * Each read is also made to fail on its own, because that is the rule admin
 * plan 0033 set and this page keeps: an error in one read never blanks the
 * screen around it.
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

/** A wide screen, where the form that adds a price is a panel. */
const WIDE: Provider = {
  provide: Viewport,
  useValue: { compact: signal(false), split: signal(true) },
};

/** A phone, where the form that adds a price is a sheet. */
const PHONE: Provider = {
  provide: Viewport,
  useValue: { compact: signal(true), split: signal(false) },
};

/** A 503, which is what a service that is not answering reads as. */
function unavailable(): GatewayError {
  return new GatewayError({
    status: 503,
    code: 'service_unavailable',
    correlationId: 'cid',
  });
}

/** The memory gateways, with one source's list failing. */
function failing(path: string): ResourceGatewaysI {
  const memory = new ResourceMemoryGateways();
  return {
    for: <T extends ResourceRow>(source: ResourceSource<T>) => {
      if (source.path !== path) {
        return memory.for(source);
      }
      const broken = {
        list: async () => {
          throw unavailable();
        },
      };
      return broken as unknown as ResourceGateway<T>;
    },
  };
}

/** The memory gateways, with one product's scopes answered from a list. */
function scopesAnswering(
  pages: readonly (readonly ItemScopePrices[])[]
): ResourceGatewaysI {
  const memory = new ResourceMemoryGateways();
  return {
    for: <T extends ResourceRow>(source: ResourceSource<T>) => {
      if (source.path !== ITEM_SCOPE_PRICES_PATH) {
        return memory.for(source);
      }
      const answering = {
        list: async (query: { cursor?: string }) => {
          const at = query.cursor === undefined ? 0 : Number(query.cursor);
          return {
            items: pages[at] ?? [],
            nextCursor: at + 1 < pages.length ? String(at + 1) : null,
          };
        },
      };
      return answering as unknown as ResourceGateway<T>;
    },
  };
}

/** One price row, written at the scope named. */
function priceRow(id: string, priceScopeId: string): Wire.CatalogItemPriceView {
  return {
    id,
    itemId: 'it_dish_soap',
    priceScopeId,
    sourceKind: 'OFFICIAL_API',
    price: 1.5,
    currency: 'EUR',
    unitPrice: 2,
    unitPriceLabel: '1 L',
    observedAt: '2026-10-01T06:00:00.000Z',
    lastObservedAt: '2026-10-03T06:00:00.000Z',
    validFrom: null,
    validUntil: null,
    sourceRunId: 'run_1',
    lastObservedRunId: 'run_1',
    overrides: null,
    protectedUntil: null,
    details: null,
  };
}

/** One scope of Mercadona, showing the rows named. */
function scopeOf(
  priceScopeId: string,
  scopeKind: Wire.CatalogItemScopePricesView['scopeKind'],
  scopePriority: number,
  rows: readonly Wire.CatalogItemPriceView[]
): ItemScopePrices {
  return {
    itemId: 'it_dish_soap',
    priceScopeId,
    supermarketId: 'sm_mercadona',
    scopeKind,
    scopeExternalKey: null,
    scopeLabel: null,
    scopePriority,
    rows: [...rows],
    shownItemPriceId: rows[0]?.id ?? null,
    shownBecause: rows.length === 0 ? null : 'ONLY_ROW',
    stale: false,
    protectedUntil: null,
    overrides: null,
  };
}

/** The memory gateways, recording every price that is removed. */
function recordingRemovals(removed: string[]): ResourceGatewaysI {
  const memory = new ResourceMemoryGateways();
  return {
    for: <T extends ResourceRow>(source: ResourceSource<T>) => {
      const inner = memory.for(source);
      if (source.path !== ITEM_PRICES_PATH) {
        return inner;
      }
      return {
        ...inner,
        list: (query) => inner.list(query),
        read: (id) => inner.read(id),
        create: (input) => inner.create(input),
        update: (id, input) => inner.update(id, input),
        remove: async (id: string) => {
          removed.push(id);
          await inner.remove(id);
        },
      } satisfies ResourceGateway<T>;
    },
  };
}

/**
 * The memory gateways, recording every price that is added, as the body the
 * item prices gateway is handed. With `hold`, an add waits for it first.
 */
function recordingAdds(
  added: unknown[],
  hold?: Promise<void>
): ResourceGatewaysI {
  const memory = new ResourceMemoryGateways();
  return {
    for: <T extends ResourceRow>(source: ResourceSource<T>) => {
      const inner = memory.for(source);
      if (source.path !== ITEM_PRICES_PATH) {
        return inner;
      }
      return {
        list: (query) => inner.list(query),
        read: (id) => inner.read(id),
        create: async (input) => {
          added.push(input);
          await hold;
          return inner.create(input);
        },
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

/** The tabs of the page. A product that is read always has them. */
const tabs = (fixture: ComponentFixture<TestHost>) =>
  page(fixture).tabs() ?? [];

const pricesTab = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(ProductPricesTab))
    .componentInstance as ProductPricesTab;

const buttonSaying = (
  fixture: ComponentFixture<TestHost>,
  label: string
): HTMLButtonElement | undefined =>
  [...fixture.nativeElement.querySelectorAll('button')].find(
    (button) => (button as HTMLButtonElement).textContent?.trim() === label
  ) as HTMLButtonElement | undefined;

afterEach(() => TestBed.resetTestingModule());

describe('the prices of a product', () => {
  it('draws one panel for each chain, with the scopes that price it', async () => {
    const fixture = await boot('/products/it_milk_1l/prices');
    const chains = pricesTab(fixture).chains();

    // Mercadona and Consum price it. Mercadona is also the one chain of the
    // seed with a default scope, and it is not drawn a second time.
    expect(chains.map((chain) => chain.id).sort()).toEqual([
      'sm_consum',
      'sm_mercadona',
    ]);
    const mercadona = chains.find((chain) => chain.id === 'sm_mercadona');
    expect(mercadona?.name).toBe('Mercadona');
    expect(mercadona?.scopes.map((scope) => scope.name)).toEqual([
      'Córdoba warehouse',
    ]);
  });

  it('says on a row what the shown price is, where it came from and how far it reaches', async () => {
    const fixture = await boot('/products/it_milk_1l/prices');
    const [scope] =
      pricesTab(fixture)
        .chains()
        .find((chain) => chain.id === 'sm_mercadona')?.scopes ?? [];

    expect(scope).toMatchObject({
      id: 'ps_mercadona_4661',
      kind: 'catalog.priceScopeKind.REGION',
      // A chain region: two of the four bars.
      level: 2,
      key: '4661',
      priced: true,
      source: 'catalog.priceSourceKind.OFFICIAL_API',
      // The server's judgement, drawn as given.
      stale: true,
      heldUntil: '',
    });
    // Money through `Intl`, from the number the wire carries.
    expect(scope.price).toBe('€0.89');
    expect(scope.unitPrice).toBe('€0.89 / 1 L');
    expect(
      fixture.nativeElement.querySelector(
        '[data-scope="ps_mercadona_4661"] lib-scope-mark'
      )
    ).not.toBeNull();
    expect(text(fixture)).toContain('catalog.prices.stale');
  });

  it('opens a row on every price behind it, the shown one marked, and why', async () => {
    const fixture = await boot('/products/it_olive_oil_1l/prices');
    const tab = pricesTab(fixture);
    const [scope] = tab.chains()[0].scopes;

    // Closed until it is pressed.
    expect(fixture.nativeElement.querySelector('[data-price]')).toBeNull();

    (
      fixture.nativeElement.querySelector(
        '[data-scope="ps_mercadona_4661"]'
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(scope.rows.map((row) => row.id)).toEqual([
      'ip_oil_4661_admin',
      'ip_oil_4661_api',
    ]);
    // Which one is shown is the gateway's answer, and so is the reason.
    expect(scope.rows.map((row) => row.state === 'shown')).toEqual([
      true,
      false,
    ]);
    expect(scope.because).toBe('PROTECTED_ADMIN');
    expect(text(fixture)).toContain(
      'catalog.productPrices.because.PROTECTED_ADMIN'
    );
    expect(text(fixture)).toContain('catalog.productPrices.state.shown');
    expect(fixture.nativeElement.querySelectorAll('[data-price]')).toHaveLength(
      2
    );
    // What the typed price recorded it was overriding.
    expect(scope.rows[0].overriding).toHaveLength(1);
    // A row a run wrote says so. A typed one does not.
    expect(scope.rows[0].run).toBe('');
    expect(scope.rows[1].run).not.toBe('');
  });

  /**
   * 2026-09-10, which the seed fixed and which is behind any clock this spec
   * runs on. A hold that has ended is not drawn as one.
   */
  it('draws "Held until" only while the hold is still ahead', async () => {
    const fixture = await boot('/products/it_olive_oil_1l/prices');
    const [scope] = pricesTab(fixture).chains()[0].scopes;

    expect(scope.heldUntil).toBe('');
    expect(text(fixture)).not.toContain('catalog.productPrices.heldUntil');
  });

  /** Target 7: the address of one product at one scope. */
  it('opens with the scope the address names already open', async () => {
    const fixture = await boot(
      '/products/it_olive_oil_1l/prices?scope=ps_mercadona_4661'
    );

    expect(pricesTab(fixture).isOpen('ps_mercadona_4661')).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('[data-price]')).toHaveLength(
      2
    );
  });

  /**
   * A chain with a scope and no price for the product is still a panel, so
   * that a price can be added there, at the scope the chain's shops fall back
   * to.
   */
  it('offers the default scope of a chain that holds no price for it', async () => {
    const fixture = await boot('/products/it_dish_soap/prices');
    const chains = pricesTab(fixture).chains();

    expect(chains).toEqual([
      {
        id: 'sm_mercadona',
        name: 'Mercadona',
        scopes: [],
        defaultScopeId: 'ps_mercadona_national',
      },
    ]);
    expect(text(fixture)).toContain('catalog.productPrices.noneYet');

    (
      fixture.nativeElement.querySelector('[data-add-here]') as HTMLElement
    ).click();
    await settle(fixture);
    await settle(fixture);

    expect(TestBed.inject(Router).url).toBe(
      '/products/it_dish_soap/prices/new?priceScopeId=ps_mercadona_national'
    );
  });

  /**
   * The gateway also answers every shop that only inherits the price of a
   * wider scope, and it answers the most specific scopes first. Those shops
   * are not rows: the scope whose price they show says how many they are.
   */
  it('folds the scopes that only inherit a price into the scope it was written at', async () => {
    const national = priceRow('ip_national', 'ps_mercadona_national');
    const fixture = await boot('/products/it_dish_soap/prices', [
      {
        provide: RESOURCE_GATEWAYS,
        useValue: scopesAnswering([
          [
            scopeOf('ps_shop_a', 'STORE', 100, [national]),
            scopeOf('ps_shop_b', 'STORE', 100, [national]),
            scopeOf('ps_mercadona_national', 'NATIONAL', 1000, [national]),
          ],
        ]),
      },
    ]);
    const [mercadona] = pricesTab(fixture).chains();

    expect(mercadona.scopes.map((scope) => scope.id)).toEqual([
      'ps_mercadona_national',
    ]);
    expect(mercadona.scopes[0].followers).toBe(2);
    expect(mercadona.scopes[0].rows[0].inherited).toBe(false);
    expect(text(fixture)).toContain('catalog.productPrices.followers');
    // The tab counts the scopes a price was written at.
    expect(tabs(fixture)[1].count?.()).toBe(1);
  });

  it('draws a price written at a wider scope, with no Remove at the narrower one', async () => {
    const national = priceRow('ip_national', 'ps_mercadona_national');
    const own = priceRow('ip_own', 'ps_shop_a');
    const fixture = await boot(
      '/products/it_dish_soap/prices?scope=ps_shop_a',
      [
        {
          provide: RESOURCE_GATEWAYS,
          useValue: scopesAnswering([
            [
              scopeOf('ps_shop_a', 'STORE', 100, [own, national]),
              scopeOf('ps_mercadona_national', 'NATIONAL', 1000, [national]),
            ],
          ]),
        },
      ]
    );
    const [mercadona] = pricesTab(fixture).chains();
    // Most general first.
    const [wide, shop] = mercadona.scopes;

    expect(wide.id).toBe('ps_mercadona_national');
    expect(wide.followers).toBe(0);
    expect(shop.rows.map((row) => [row.id, row.inherited])).toEqual([
      ['ip_own', false],
      ['ip_national', true],
    ]);
    // One Remove: the price written at the shop. The other is removed at the
    // scope it was written at.
    expect(
      fixture.nativeElement.querySelectorAll('[data-remove-price]')
    ).toHaveLength(1);
    expect(text(fixture)).toContain('catalog.productPrices.fromWider');
  });

  /** Only stock was said there, so the scope holds no price and says so. */
  it('says "No price shown" at a scope that holds a row and no price', async () => {
    const fixture = await boot('/products/it_dish_soap/prices', [
      {
        provide: RESOURCE_GATEWAYS,
        useValue: scopesAnswering([
          [scopeOf('ps_mercadona_national', 'NATIONAL', 1000, [])],
        ]),
      },
    ]);
    const [scope] = pricesTab(fixture).chains()[0].scopes;

    expect(scope).toMatchObject({ priced: false, because: null, rows: [] });
    expect(text(fixture)).toContain('catalog.productPrices.none');
  });

  it('prints the basis the catalog read, and not the label of the source (backend plan 0189)', async () => {
    // The price of a litre, which the chain sent under `100 ml`.
    const oil: Wire.CatalogItemPriceView = {
      ...priceRow('ip_oil', 'ps_mercadona_national'),
      price: 3.4,
      unitPrice: 17,
      unitPriceLabel: '100 ml',
      unitBasis: 'LITER',
    };
    const fixture = await boot('/products/it_dish_soap/prices', [
      {
        provide: RESOURCE_GATEWAYS,
        useValue: scopesAnswering([
          [scopeOf('ps_mercadona_national', 'NATIONAL', 1000, [oil])],
        ]),
      },
    ]);
    const [scope] = pricesTab(fixture).chains()[0].scopes;

    expect(scope.unitPrice).toBe('€17.00 / L');
    expect(scope.unitPrice).not.toContain('100 ml');
  });

  /**
   * More pages than are read on opening: the tab offers the next one, and
   * says no number that it did not read.
   */
  it('reads several pages on opening, and counts nothing while there are more', async () => {
    const pages = Array.from({ length: 7 }, (_, index) => [
      scopeOf(`ps_shop_${index}`, 'STORE', 100, [
        priceRow(`ip_${index}`, `ps_shop_${index}`),
      ]),
    ]);
    const fixture = await boot('/products/it_dish_soap/prices', [
      { provide: RESOURCE_GATEWAYS, useValue: scopesAnswering(pages) },
    ]);
    await settle(fixture);
    await settle(fixture);
    const tab = pricesTab(fixture);

    expect(tab.product.scopes()).toHaveLength(5);
    expect(tab.product.moreScopes()).toBe(true);
    expect(tabs(fixture)[1].count?.()).toBeNull();
    expect(tab.chains()[0].scopes[0].followers).toBeNull();
    // A chain that has shown no price yet may still hold one further on, so
    // no chain is drawn as holding none.
    expect(tab.chains().every((chain) => chain.scopes.length > 0)).toBe(true);

    await tab.product.moreScopePrices();
    await tab.product.moreScopePrices();
    await settle(fixture);

    expect(tab.product.scopes()).toHaveLength(7);
    expect(tabs(fixture)[1].count?.()).toBe(7);
  });

  it('removes a price after asking, and reads the scopes again', async () => {
    const removed: string[] = [];
    const fixture = await boot('/products/it_olive_oil_1l/prices', [
      { provide: RESOURCE_GATEWAYS, useValue: recordingRemovals(removed) },
    ]);
    const tab = pricesTab(fixture);
    const [scope] = tab.chains()[0].scopes;
    const reads = jest.spyOn(tab.product, 'reloadPrices');

    tab.askRemove(scope, scope.rows[1]);
    await settle(fixture);
    // Nothing is sent until the operator says yes.
    expect(removed).toEqual([]);
    expect(
      fixture.nativeElement.querySelector('lib-confirm-dialog')
    ).not.toBeNull();

    await tab.confirmRemove();
    await settle(fixture);
    await settle(fixture);

    expect(removed).toEqual(['ip_oil_4661_api']);
    // The shown price is the server's to work out, so the scopes are read.
    // The tab follows the write itself: nothing above it reads for it.
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('keeps the header when the scopes cannot be read, and offers the read again', async () => {
    const fixture = await boot('/products/it_olive_oil_1l/prices', [
      { provide: RESOURCE_GATEWAYS, useValue: failing(ITEM_SCOPE_PRICES_PATH) },
    ]);

    expect(
      fixture.nativeElement.querySelector(
        'lib-product-prices-tab [role="alert"]'
      )
    ).not.toBeNull();
    expect(page(fixture).heading()).toBe('Extra virgin olive oil 1 L');
    expect(buttonSaying(fixture, 'resource.action.retry')).toBeDefined();
    // No number that nobody read.
    expect(tabs(fixture)[1].count?.()).toBeNull();
  });

  /** The header is the record's, so the tab holds the button itself. */
  it('has the info button, which says three things about a row', async () => {
    const fixture = await boot('/products/it_milk_1l/prices');
    const info = fixture.debugElement.query(By.directive(InfoButton))
      .componentInstance as InfoButton;

    expect(info.info().points).toHaveLength(3);
  });

  it('draws the prices of another product when the address names one', async () => {
    const fixture = await boot('/products/it_milk_1l/prices');

    await TestBed.inject(Router).navigateByUrl(
      '/products/it_olive_oil_1l/prices'
    );
    await settle(fixture);
    await settle(fixture);

    expect(page(fixture).heading()).toBe('Extra virgin olive oil 1 L');
    expect(
      pricesTab(fixture)
        .chains()
        .flatMap((chain) => chain.scopes.map((scope) => scope.id))
    ).toEqual(['ps_mercadona_4661']);
  });

  it('reads an unknown reason as unknown rather than as one of the four', () => {
    expect(toShownBecause('SOMETHING_NEW')).toBe('UNKNOWN');
    expect(toShownBecause(null)).toBeNull();
    expect(toShownBecause('NEWEST')).toBe('NEWEST');
  });
});

describe('the state of one price behind a scope', () => {
  const NOW = Date.parse('2026-10-04T12:00:00.000Z');
  const limits = new Map<string, number | null>([
    ['OFFICIAL_API', 7],
    ['ADMIN', null],
  ]);
  const row = (
    over: Partial<{
      id: string;
      sourceKind: string;
      validUntil: string | null;
      lastObservedAt: string;
    }> = {}
  ) =>
    ({
      id: 'p1',
      sourceKind: 'OFFICIAL_API',
      validUntil: null,
      lastObservedAt: '2026-10-03T12:00:00.000Z',
      ...over,
    }) as Parameters<typeof priceRowState>[0];

  it('is shown for the row the gateway named, whatever its age', () => {
    expect(
      priceRowState(
        row({ lastObservedAt: '2026-01-01T00:00:00.000Z' }),
        'p1',
        limits,
        NOW
      )
    ).toBe('shown');
  });

  it('is ended for a window that closed', () => {
    expect(
      priceRowState(
        row({ validUntil: '2026-09-19T00:00:00.000Z' }),
        'other',
        limits,
        NOW
      )
    ).toBe('ended');
  });

  it('is too old past the limit of its source, and never for a source with none', () => {
    const old = '2026-08-03T12:00:00.000Z';

    expect(
      priceRowState(row({ lastObservedAt: old }), 'other', limits, NOW)
    ).toBe('tooOld');
    expect(
      priceRowState(
        row({ sourceKind: 'ADMIN', lastObservedAt: old }),
        'other',
        limits,
        NOW
      )
    ).toBeNull();
  });

  it('is nothing for a current price that another one outranks', () => {
    expect(priceRowState(row(), 'other', limits, NOW)).toBeNull();
    // With no rule read there is no limit to be past.
    expect(
      priceRowState(
        row({ lastObservedAt: '2026-01-01T00:00:00.000Z' }),
        'other',
        new Map(),
        NOW
      )
    ).toBeNull();
  });
});

describe('the add a price form', () => {
  async function form(
    url = '/products/it_dish_soap/prices/new',
    with_: Provider[] = []
  ) {
    const fixture = await boot(url, with_);
    const priceForm = fixture.debugElement.query(By.directive(PriceFormPage))
      .componentInstance as PriceFormPage;
    return { fixture, page: priceForm };
  }

  it('is drawn inside the Prices tab, in a panel on a wide screen', async () => {
    const { fixture } = await form(undefined, [WIDE]);

    expect(
      fixture.nativeElement.querySelector(
        'lib-product-prices-tab [data-price-form] lib-price-form-page'
      )
    ).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(PopoverSheet))).toBeNull();
    // The chains are still under it: the form does not replace the tab.
    expect(fixture.nativeElement.querySelector('[data-chain]')).not.toBeNull();
  });

  it('is drawn in a sheet on a phone', async () => {
    const { fixture } = await form(undefined, [PHONE]);
    const sheet = fixture.debugElement.query(By.directive(PopoverSheet));

    expect(sheet).not.toBeNull();
    expect((sheet.componentInstance as PopoverSheet).sheet()).toBe(true);
    expect(
      fixture.nativeElement.querySelector(
        'lib-popover-sheet lib-price-form-page'
      )
    ).not.toBeNull();
  });

  /** The product is the page the form was opened from. */
  it('asks for no product and for no field a typed price cannot set', async () => {
    const { page } = await form();
    const names = page.formFields.map((field) => field.name);

    expect(page.store.draft()['itemId']).toBe('it_dish_soap');
    expect(names).not.toContain('itemId');
    // The scope is the picker's, above the form.
    expect(names).not.toContain('priceScopeId');
    expect(names).not.toContain('sourceKind');
    expect(names).not.toContain('stale');
    expect(names).toEqual(
      expect.arrayContaining(['price', 'unitPrice', 'observedAt'])
    );
  });

  it('opens at the scope the address names, and names it with its chain', async () => {
    const { fixture, page } = await form(
      '/products/it_dish_soap/prices/new?priceScopeId=ps_mercadona_national'
    );
    await settle(fixture);

    expect(page.store.draft()['priceScopeId']).toBe('ps_mercadona_national');
    expect(page.scopeChoice()).toMatchObject({
      scope: { id: 'ps_mercadona_national', kind: 'NATIONAL' },
      chain: { id: 'sm_mercadona' },
    });
    // The notice says how many shops the price reaches, as it always did.
    expect(page.scopeName()).toBe('Nationwide');
  });

  it('takes the scope the picker chose into the draft', async () => {
    const { fixture, page } = await form();

    page.chooseScope({
      chain: {
        id: 'sm_consum',
        name: { en: 'Consum' },
        defaultPriceScopeId: null,
      },
      scope: {
        id: 'ps_consum_centro',
        supermarketId: 'sm_consum',
        kind: 'STORE',
        externalKey: 'loc_consum_centro',
        label: null,
      },
    });
    await settle(fixture);

    expect(page.store.draft()['priceScopeId']).toBe('ps_consum_centro');
    expect(page.scopeChoice()?.scope.id).toBe('ps_consum_centro');
  });

  it('says under the picker that a scope is needed', async () => {
    const { fixture, page } = await form();

    await page.submit();
    await settle(fixture);

    expect(page.scopeMessages().length).toBeGreaterThan(0);
    // Where every other form says it: a line under the control, in its row.
    expect(
      fixture.nativeElement.querySelector('[data-scope-row] [data-error]')
    ).not.toBeNull();
  });

  /**
   * The picker is a button, and the row around it is a row like the others:
   * its label points at the button, and the button names the lines that
   * refuse the scope.
   */
  it('ties the label of the scope and its refusals to the button of the picker', async () => {
    const { fixture, page } = await form();
    const row = fixture.nativeElement.querySelector(
      '[data-scope-row]'
    ) as HTMLElement;
    const trigger = row.querySelector('[data-scope-picker]') as HTMLElement;

    expect(trigger.id).toBe('price-field-priceScopeId');
    expect(row.querySelector('label')?.getAttribute('for')).toBe(trigger.id);
    // Nothing refused yet: the attribute is left off.
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);

    await page.submit();
    await settle(fixture);

    const errors = [...row.querySelectorAll('[data-error]')].map(
      (line) => line.id
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBe('price-field-priceScopeId-error-0');
    expect(trigger.getAttribute('aria-describedby')).toBe(errors.join(' '));
  });

  /**
   * Admin plan 0060, target 2: the form is built from the parts of the
   * record page. A row for each field, the control of the field inside it,
   * and one bar that holds Save and Cancel.
   */
  it('draws each field as a row of the record page, with its control', async () => {
    const { fixture, page } = await form();
    const host = fixture.nativeElement.querySelector(
      'lib-price-form-page'
    ) as HTMLElement;
    const rows = [...host.querySelectorAll('lib-field-row')] as HTMLElement[];

    // The scope first, then what an added price can state.
    expect(rows).toHaveLength(page.formFields.length + 1);
    expect(rows[0].querySelector('lib-price-scope-picker')).not.toBeNull();
    expect(rows[0].querySelector('lib-price-scope-notice')).not.toBeNull();
    // The star of a field that has to be filled in, where every form has it.
    expect(rows[0].querySelector('.star')).not.toBeNull();
    for (const field of page.formFields) {
      const row = host.querySelector(`[data-field="${field.name}"]`);
      expect(row?.querySelector('lib-field-control')).not.toBeNull();
      expect(row?.querySelector('label')?.getAttribute('for')).toBe(
        `price-field-${field.name}`
      );
    }
    expect(host.querySelector('form')).toBeNull();
  });

  it('holds Save and Cancel in one bar, inside the panel, and says "Add price"', async () => {
    const { fixture, page } = await form(
      '/products/it_dish_soap/prices/new?priceScopeId=ps_mercadona_national'
    );
    const bar = fixture.debugElement.query(By.directive(SaveBar))
      .componentInstance as SaveBar;

    expect(bar.sticky()).toBe(false);
    expect(page.saveLabel()).toBe('record.action.add');
    // A price whose scope came with the address is complete as it opened.
    expect(bar.state()).toEqual({ kind: 'clean', canSave: true });

    page.store.set('price', '1.50');
    fixture.detectChanges();
    expect(bar.state()).toEqual({ kind: 'dirty', changes: 1 });
  });

  it('counts the scope as a required field that is still empty', async () => {
    const { fixture } = await form();
    const bar = fixture.debugElement.query(By.directive(SaveBar))
      .componentInstance as SaveBar;

    expect(bar.state()).toEqual({ kind: 'missing', required: 1 });
  });

  it('closes on Cancel with nothing typed, and asks nothing', async () => {
    const { fixture } = await form();

    fixture.nativeElement
      .querySelector('lib-price-form-page [data-cancel]')
      .click();
    await settle(fixture);

    expect(TestBed.inject(Router).url).toBe('/products/it_dish_soap/prices');
    expect(fixture.debugElement.query(By.directive(PriceFormPage))).toBeNull();
  });

  it('asks before a typed price is lost, and stays on "Stay here"', async () => {
    const { fixture, page } = await form();
    const router = TestBed.inject(Router);

    page.store.set('price', '1.50');
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('lib-price-form-page [data-cancel]')
      .click();
    await settle(fixture);

    const dialog = fixture.debugElement
      .query(By.directive(PriceFormPage))
      .query(By.directive(ConfirmDialog)).componentInstance as ConfirmDialog;
    expect(dialog.bodyKey()).toBe('record.leave.bodyNew');
    expect(dialog.bodyArgs()).toEqual({ count: 1, name: 'catalog.prices.one' });
    dialog.dismiss.emit();
    await settle(fixture);

    expect(router.url).toBe('/products/it_dish_soap/prices/new');
    expect(page.store.draft()['price']).toBe('1.50');

    // The same question from the tab itself, which closes the form too.
    pricesTab(fixture).closeForm();
    await settle(fixture);
    (
      fixture.debugElement
        .query(By.directive(PriceFormPage))
        .query(By.directive(ConfirmDialog)).componentInstance as ConfirmDialog
    ).confirm.emit();
    await settle(fixture);
    await settle(fixture);

    expect(router.url).toBe('/products/it_dish_soap/prices');
  });

  it('saves, closes, and has the tab read the scopes again', async () => {
    const { fixture, page } = await form(
      '/products/it_dish_soap/prices/new?priceScopeId=ps_mercadona_national'
    );
    const reads = jest.spyOn(pricesTab(fixture).product, 'reloadPrices');

    page.store.set('price', '1.50');
    await page.submit();
    await settle(fixture);
    await settle(fixture);

    expect(TestBed.inject(Router).url).toBe('/products/it_dish_soap/prices');
    expect(reads).toHaveBeenCalled();
  });

  /**
   * The exact body of "add a price", for one filled draft. What the operator
   * typed, the product of the address, and nothing the form worked out: the
   * proposal was on screen and was not pressed, so no unit price is sent.
   *
   * A field that takes null and was left empty goes as null, which is the
   * operator saying "no answer", and never as a number the form derived.
   */
  it('sends what was typed, and no unit price that was only proposed', async () => {
    const added: unknown[] = [];
    const { fixture, page } = await form(
      '/products/it_dish_soap/prices/new?priceScopeId=ps_mercadona_national',
      [{ provide: RESOURCE_GATEWAYS, useValue: recordingAdds(added) }]
    );
    const observedAt = new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000
    ).toISOString();

    page.store.set('price', '1.50');
    page.store.set('observedAt', observedAt);
    await settle(fixture);
    // The proposal is offered, and nobody pressed it.
    expect(page.proposal()).toEqual({ unitPrice: '2.00', label: '1 L' });

    await page.submit();
    await settle(fixture);

    expect(added).toEqual([
      {
        itemId: 'it_dish_soap',
        priceScopeId: 'ps_mercadona_national',
        price: 1.5,
        currency: null,
        unitPrice: null,
        unitPriceLabel: null,
        validFrom: null,
        validUntil: null,
        observedAt,
      },
    ]);
  });

  /** The same draft with the proposal pressed: now the two fields are sent. */
  it('sends the unit price and its label once the proposal was used', async () => {
    const added: unknown[] = [];
    const { fixture, page } = await form(
      '/products/it_dish_soap/prices/new?priceScopeId=ps_mercadona_national',
      [{ provide: RESOURCE_GATEWAYS, useValue: recordingAdds(added) }]
    );

    page.store.set('price', '1.50');
    await settle(fixture);
    buttonSaying(fixture, 'catalog.prices.proposal.use')?.click();
    await settle(fixture);
    await page.submit();
    await settle(fixture);

    expect(added).toEqual([
      {
        itemId: 'it_dish_soap',
        priceScopeId: 'ps_mercadona_national',
        price: 1.5,
        currency: null,
        unitPrice: 2,
        unitPriceLabel: '1 L',
        validFrom: null,
        validUntil: null,
      },
    ]);
  });

  /**
   * A save can answer after the operator left. The panel is gone, so there
   * is nothing to close, and "one route up" from a route that is no longer
   * drawn would pull them back to the Prices tab.
   */
  it('goes nowhere when the save answers after the form was left', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const added: unknown[] = [];
    const { fixture, page } = await form(
      '/products/it_dish_soap/prices/new?priceScopeId=ps_mercadona_national',
      [{ provide: RESOURCE_GATEWAYS, useValue: recordingAdds(added, hold) }]
    );
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate');

    page.store.set('price', '1.50');
    const saving = page.submit();
    await settle(fixture);
    expect(added).toHaveLength(1);

    // The operator leaves while the save is on its way, and says yes to the
    // question about what was typed.
    const leaving = router.navigateByUrl('/products/it_dish_soap/where');
    await settle(fixture);
    page.leave.answer(true);
    await leaving;
    await settle(fixture);
    expect(router.url).toBe('/products/it_dish_soap/where');
    expect(fixture.debugElement.query(By.directive(PriceFormPage))).toBeNull();
    navigate.mockClear();

    release();
    await saving;
    await settle(fixture);
    await settle(fixture);

    expect(navigate).not.toHaveBeenCalled();
    expect(router.url).toBe('/products/it_dish_soap/where');
  });

  /**
   * What is said about the price is directly under its control: the refusal,
   * then the help. The proposal is worked out from the price and comes after
   * them, in the same row.
   */
  it('draws the proposal after the refusal and the help of the price', async () => {
    const { fixture, page } = await form();

    page.store.set('price', '1.50');
    await settle(fixture);

    const row = fixture.nativeElement.querySelector(
      '[data-field="price"]'
    ) as HTMLElement;
    const help = row.querySelector('[data-help]') as HTMLElement;
    const proposal = row.querySelector('.proposal') as HTMLElement;

    expect(help.textContent?.trim()).toBe('catalog.prices.priceHelp');
    expect(proposal).not.toBeNull();
    expect(
      help.compareDocumentPosition(proposal) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // And the control is still the first thing in the row.
    const control = row.querySelector('lib-field-control') as HTMLElement;
    expect(
      control.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('proposes a unit price in the base unit, and fills nothing in', async () => {
    const { fixture, page } = await form();

    page.store.set('price', '1.50');
    await settle(fixture);

    // 750 ml at 1.50 is 2.00 a litre.
    expect(page.proposal()).toEqual({ unitPrice: '2.00', label: '1 L' });
    expect(page.store.draft()['unitPrice']).toBe('');
    expect(text(fixture)).toContain('catalog.prices.proposal.heading');
  });

  it('puts the proposal in the fields only when asked', async () => {
    const { fixture, page } = await form();

    page.store.set('price', '1.50');
    await settle(fixture);
    buttonSaying(fixture, 'catalog.prices.proposal.use')?.click();
    await settle(fixture);

    expect(page.store.draft()['unitPrice']).toBe('2.00');
    expect(page.store.draft()['unitPriceLabel']).toBe('1 L');
    expect(page.proposalInUse()).toBe(true);
  });

  it('proposes nothing without a price', async () => {
    const { page } = await form();

    expect(page.proposal()).toBeNull();
  });

  it('refuses an observed date in the future, under the field', async () => {
    const { fixture, page } = await form();
    const create = jest.spyOn(page.store, 'submit');

    page.store.set(
      'observedAt',
      new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    );
    await settle(fixture);
    await page.submit();

    expect(page.priceMessages()['observedAt']).toEqual([
      { kind: 'key', key: 'catalog.prices.observedAtFuture' },
    ]);
    expect(create).not.toHaveBeenCalled();
    // The bar says that nothing was saved, though the store never saw it.
    expect(page.bar()).toEqual({ kind: 'invalid', fields: 1 });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-field="observedAt"] [data-error]'
      )
    ).not.toBeNull();
  });

  it('refuses one more than 30 days back', async () => {
    const { page } = await form();

    page.store.set(
      'observedAt',
      new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    );

    expect(page.observedAtProblem()).toEqual({
      kind: 'key',
      key: 'catalog.prices.observedAtTooOld',
    });
  });

  it('takes one inside the window', async () => {
    const { page } = await form();

    page.store.set(
      'observedAt',
      new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    );

    expect(page.observedAtProblem()).toBeNull();
  });
});
