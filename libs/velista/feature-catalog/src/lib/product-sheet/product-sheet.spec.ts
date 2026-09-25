import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  Router,
  UrlSegment,
} from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
  CATALOG_SERVICE,
  CatalogBrowseMemory,
  GroupMembers,
  ItemNames,
} from '@portfolio/velista/data-access';
import type {
  CatalogItem,
  CatalogPriceState,
  CatalogScopeOffer,
} from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { ProductSheet } from './product-sheet';

const OIL: CatalogItem = {
  id: 'item-oil',
  name: { es: 'Aceite de oliva virgen extra', en: 'Extra virgin olive oil' },
  brand: 'Hacendado',
  size: 1,
  unit: 'LITER',
  productGroupId: null,
  category: 'PANTRY',
  offer: null,
};

interface Options {
  readonly state?: CatalogPriceState;
  /** Replaces the double's source rows. */
  readonly rows?: readonly CatalogScopeOffer[] | null;
  readonly item?: CatalogItem | null;
  /**
   * The URL of the page the sheet covers, one route per entry, as the router would
   * hand it over. The catalog under the portfolio's mount unless a test says otherwise.
   */
  readonly covered?: readonly (readonly string[])[];
  /** What the catalog answers for the product's group. */
  readonly similar?: readonly CatalogItem[];
}

/** A route snapshot's chain from the root, reduced to what the sheet reads. */
function routeChain(covered: readonly (readonly string[])[]): {
  pathFromRoot: { url: UrlSegment[] }[];
} {
  return {
    pathFromRoot: [
      { url: [] },
      ...covered.map((paths) => ({
        url: paths.map((path) => new UrlSegment(path, {})),
      })),
    ],
  };
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<ProductSheet>;
  sheets: { dismiss: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const memory = new CatalogBrowseMemory();
  memory.state = options.state ?? 'priced';
  if (options.rows !== undefined) {
    const rows = options.rows;
    jest.spyOn(memory, 'scopeOffers').mockResolvedValue(rows);
  }
  const item = options.item === undefined ? OIL : options.item;
  const sheets = { dismiss: jest.fn().mockResolvedValue(undefined) };

  await TestBed.configureTestingModule({
    imports: [ProductSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      GroupMembers,
      ItemNames,
      { provide: CATALOG_BROWSE_SERVICE, useValue: memory },
      {
        provide: CATALOG_SERVICE,
        useValue: {
          itemsByIds: async () => (item === null ? [] : [item]),
          groupMembers: async () => options.similar ?? [],
        },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({ itemId: 'item-oil' })),
          snapshot: {
            paramMap: convertToParamMap({ itemId: 'item-oil' }),
            parent: routeChain(
              options.covered ?? [['velista'], ['en'], ['catalog']]
            ),
          },
        },
      },
      { provide: SheetNavigation, useValue: sheets },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProductSheet);
  fixture.detectChanges();
  // The sheet loads in its constructor, which `whenStable` does not wait for.
  for (let tick = 0; tick < 10; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();

  return { fixture, sheets };
}

function text(fixture: ComponentFixture<ProductSheet>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function lines(fixture: ComponentFixture<ProductSheet>): string[] {
  return [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll('.line'),
  ].map((line) =>
    [...line.querySelectorAll('span')]
      .map((part) => (part.textContent ?? '').trim())
      .join(' ')
  );
}

describe('ProductSheet', () => {
  it('names the product and its size', async () => {
    const { fixture } = await render();

    expect(text(fixture)).toContain('Extra virgin olive oil');
    expect(text(fixture)).toContain('Hacendado');
  });

  it('lists every shop near the person, cheapest first, and marks the cheapest', async () => {
    const { fixture } = await render();

    expect(lines(fixture)).toEqual([
      'Mercadona catalog.product.cheapest €8.45',
      'Deza €8.95',
      'Carrefour catalog.product.notSold',
    ]);
  });

  it('says a shop does not sell it rather than leaving the line blank', async () => {
    const { fixture } = await render();

    const absent = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll(
        '.line.is-absent'
      ),
    ];
    expect(absent).toHaveLength(1);
    expect(absent[0]?.textContent).toContain('Carrefour');
  });

  it('counts a row that is not available as not sold', async () => {
    const memory = new CatalogBrowseMemory();
    const real = (await memory.scopeOffers('item-oil')) ?? [];
    const { fixture } = await render({
      rows: real.map((row) =>
        row.offer.priceScopeId === 'scope-chain-mercadona'
          ? { ...row, available: false }
          : row
      ),
    });

    expect(lines(fixture)).toEqual([
      'Deza catalog.product.cheapest €8.95',
      'Mercadona catalog.product.notSold',
      'Carrefour catalog.product.notSold',
    ]);
  });

  it('says when the prices were seen', async () => {
    const { fixture } = await render();

    expect(text(fixture)).toContain('catalog.product.seen');
  });

  it('draws no shop list for somebody with no postal code, and says why', async () => {
    const { fixture } = await render({ state: 'noPlace' });

    expect(lines(fixture)).toEqual([]);
    expect(text(fixture)).toContain('catalog.product.noShops');
  });

  it('says the prices did not load rather than drawing an empty sheet', async () => {
    const { fixture } = await render({ rows: null });

    expect(text(fixture)).toContain('catalog.product.failed');
    expect(lines(fixture)).toEqual([]);
  });

  it('offers nothing but Close: no way to add the product to a list', async () => {
    const { fixture } = await render();

    const buttons = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ].map((button) => button.textContent?.trim());
    expect(buttons.filter((label) => label !== '')).toEqual([
      'catalog.product.close',
    ]);
  });

  it('dismisses back to the catalog', async () => {
    const { fixture, sheets } = await render();

    await fixture.componentInstance.dismiss();

    expect(sheets.dismiss).toHaveBeenCalledWith('/velista/en/catalog');
  });

  it('dismisses back to the zone list it covers (velista 0107)', async () => {
    const { fixture, sheets } = await render({
      covered: [['velista'], ['en'], ['zones', 'z-1', 'lists', 'l-1']],
    });

    await fixture.componentInstance.dismiss();

    expect(sheets.dismiss).toHaveBeenCalledWith(
      '/velista/en/zones/z-1/lists/l-1'
    );
  });

  it('dismisses back to the basket it covers, on a standalone build', async () => {
    const { fixture, sheets } = await render({
      covered: [['en'], ['shopping-lists', 'live']],
    });

    await fixture.componentInstance.dismiss();

    expect(sheets.dismiss).toHaveBeenCalledWith('/en/shopping-lists/live');
  });
});

describe('ProductSheet similar products', () => {
  const OTHER: CatalogItem = {
    ...OIL,
    id: 'item-oil-other',
    name: { es: 'Aceite de oliva Carbonell', en: 'Carbonell olive oil' },
    brand: 'Carbonell',
    productGroupId: 'group-oil',
    chainPrices: [],
    imageUrl: null,
    packCount: null,
    unitBasis: null,
  };

  it('lists the other products of the group and opens one in the sheet', async () => {
    const { fixture } = await render({
      item: { ...OIL, productGroupId: 'group-oil' },
      similar: [{ ...OIL, productGroupId: 'group-oil' }, OTHER],
    });
    for (let tick = 0; tick < 10; tick++) {
      await Promise.resolve();
    }
    fixture.detectChanges();

    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'lib-similar-products .row'
    );
    // The product itself is never its own sibling.
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Carbonell olive oil');

    const router = TestBed.inject(Router);
    const navigate = jest
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);
    (rows[0] as HTMLButtonElement).click();

    expect(navigate).toHaveBeenCalledWith(
      '/velista/en/catalog/sheet/products/item-oil-other',
      { replaceUrl: true }
    );
  });

  it('draws nothing for a product with no group', async () => {
    const { fixture } = await render();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        'lib-similar-products'
      )
    ).toBeNull();
  });
});
