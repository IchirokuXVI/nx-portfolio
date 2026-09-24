import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
  CATALOG_SERVICE,
  CatalogBrowseMemory,
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
      { provide: CATALOG_BROWSE_SERVICE, useValue: memory },
      {
        provide: CATALOG_SERVICE,
        useValue: {
          itemsByIds: async () => (item === null ? [] : [item]),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: convertToParamMap({ itemId: 'item-oil' }) },
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
});
