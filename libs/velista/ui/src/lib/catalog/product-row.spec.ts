import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { CatalogProduct, ProductOffer } from '@portfolio/velista/models';
import { ProductRow, type ProductRowView } from './product-row';
import { productRowView, type ProductRowOptions } from './product-row-view';

/** Echoes the key and its arguments, so a spec can see which sentence was chosen. */
function translate(key: string, args?: Record<string, unknown>): string {
  return args === undefined ? key : `${key} ${JSON.stringify(args)}`;
}

const OFFER: ProductOffer = {
  price: 8.45,
  currency: 'EUR',
  unitPrice: 8.45,
  unitPriceLabel: 'EUR/L',
  observedAt: new Date('2026-09-20T10:00:00.000Z'),
  sourceKind: 'OFFICIAL_API',
  stale: false,
  priceScopeId: 'scope-m',
};

const OIL: CatalogProduct = {
  id: 'item-oil',
  name: { es: 'Aceite de oliva virgen extra', en: 'Extra virgin olive oil' },
  brand: 'Hacendado',
  imageUrl: null,
  size: 1,
  unit: 'LITER',
  category: 'PANTRY',
  offer: OFFER,
  unitBasis: 'LITER',
};

function options(
  overrides: Partial<ProductRowOptions> = {}
): ProductRowOptions {
  return {
    locale: 'en',
    translate,
    chainOf: (scope) => (scope === 'scope-m' ? 'Mercadona' : null),
    chainChosen: false,
    ...overrides,
  };
}

describe('productRowView', () => {
  it('draws the price with the chain that charges it', () => {
    const view = productRowView(OIL, options());

    expect(view.name).toBe('Extra virgin olive oil');
    expect(view.detail).toBe('Hacendado · list.add.size.LITER {"size":"1"}');
    expect(view.price).toBe('€8.45');
    expect(view.caption).toBe('Mercadona');
    expect(view.stale).toBe(false);
  });

  it('draws the price per litre instead of the chain while one chain is chosen', () => {
    const view = productRowView(OIL, options({ chainChosen: true }));

    expect(view.price).toBe('€8.45');
    expect(view.caption).toBe('catalog.unit.LITER {"price":"€8.45"}');
  });

  it('says no price in words, and draws neither a price nor a caption', () => {
    const view = productRowView(
      { ...OIL, offer: null, unitBasis: null },
      options()
    );

    expect(view.price).toBeNull();
    expect(view.caption).toBeNull();
    expect(view.label).toContain('catalog.row.noPrice');
  });

  it('keeps a stale price, and marks it stale', () => {
    const view = productRowView(
      { ...OIL, offer: { ...OFFER, stale: true } },
      options()
    );

    expect(view.price).toBe('€8.45');
    expect(view.stale).toBe(true);
  });

  it('names the product, then the size, then the price', () => {
    const view = productRowView(OIL, options());

    expect(view.label).toBe(
      'Extra virgin olive oil, list.add.size.LITER {"size":"1"}, €8.45'
    );
  });

  it('names a product that has only a Spanish name for an English reader', () => {
    // Harvested products carry Spanish only, and a blank name is not a row.
    const view = productRowView(
      { ...OIL, name: { es: 'Arroz redondo', en: '' } },
      options()
    );

    expect(view.name).toBe('Arroz redondo');
  });

  it('says nothing about a count of one, which every product is', () => {
    const view = productRowView(
      { ...OIL, brand: null, size: 1, unit: 'UNIT' },
      options()
    );

    expect(view.detail).toBeNull();
  });
});

describe('ProductRow', () => {
  async function render(
    row: ProductRowView
  ): Promise<ComponentFixture<ProductRow>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProductRow, RokuTranslatorTestingModule.forTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProductRow);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  function host(fixture: ComponentFixture<ProductRow>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('is one button named for the product, the size and the price', async () => {
    const fixture = await render(productRowView(OIL, options()));

    const buttons = host(fixture).querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('aria-label')).toContain('€8.45');
    expect(host(fixture).querySelector('.caption')?.textContent).toContain(
      'Mercadona'
    );
  });

  it('draws the unit price under the price with a chain chosen', async () => {
    const fixture = await render(
      productRowView(OIL, options({ chainChosen: true }))
    );

    expect(host(fixture).querySelector('.caption')?.textContent).toContain(
      'catalog.unit.LITER'
    );
  });

  it('writes no price as words rather than a dash', async () => {
    const fixture = await render(
      productRowView({ ...OIL, offer: null, unitBasis: null }, options())
    );

    expect(host(fixture).querySelector('.price')).toBeNull();
    expect(host(fixture).querySelector('.no-price')?.textContent).toContain(
      'catalog.row.noPrice'
    );
  });

  it('draws a stale price as stale, with no badge beside it', async () => {
    const fixture = await render(
      productRowView({ ...OIL, offer: { ...OFFER, stale: true } }, options())
    );

    const price = host(fixture).querySelector('.price');
    expect(price?.classList.contains('is-stale')).toBe(true);
    expect(price?.children).toHaveLength(2);
  });

  it('draws the carton when there is no picture, and the picture when there is', async () => {
    const without = await render(productRowView(OIL, options()));
    expect(host(without).querySelector('lib-product-icon')).not.toBeNull();

    const withImage = await render(
      productRowView(
        { ...OIL, imageUrl: 'https://img.test/oil.png' },
        options()
      )
    );
    expect(host(withImage).querySelector('img')?.getAttribute('src')).toBe(
      'https://img.test/oil.png'
    );
  });

  it('says which product was pressed', async () => {
    const fixture = await render(productRowView(OIL, options()));
    const opened: string[] = [];
    fixture.componentInstance.opened.subscribe((id) => opened.push(id));

    host(fixture).querySelector('button')?.click();

    expect(opened).toEqual(['item-oil']);
  });
});
