import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  BasketParticipant,
  BasketProduct,
  BasketRow,
  ProductOffer,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { BasketRow as BasketRowComponent } from './basket-row';

/**
 * The price on a row (velista `0062`, section 4).
 *
 * Three cases and they are section 8's three: a priced pick renders the caption
 * with the money string after the separator, an unpriced one renders exactly
 * the caption it rendered before, and a line with options and no pick renders
 * no price at all, because quoting the cheapest option there would put a number
 * on a product nobody has chosen.
 */

function line(overrides: Partial<BasketRow> = {}): BasketRow {
  return {
    rowKey: 'zl-1',
    content: 'Milk',
    left: 3,
    bought: 0,
    asked: 3,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [],
    touchedBy: null,
    touchedAt: null,
    entries: [
      {
        lineId: 'zl-1',
        listId: null,
        left: 3,
        bought: 0,
        asked: 3,
        state: 'WANTED',
        awaitingApproval: false,
        demandEditable: true,
      },
    ],
    ...overrides,
  };
}

const offer = (price: number | null): ProductOffer => ({
  price,
  currency: 'EUR',
  unitPrice: price,
  unitPriceLabel: 'EUR/L',
  observedAt: new Date('2026-09-01T06:00:00.000Z'),
  sourceKind: 'OFFICIAL_WEB',
  stale: false,
  priceScopeId: 'scope-a',
});

const product = (
  id: string,
  offerOf: ProductOffer | null
): [string, BasketProduct] => [
  id,
  {
    id,
    name: { en: 'Hacendado whole milk 1 L', es: 'Leche entera Hacendado 1 L' },
    brand: 'Hacendado',
    size: 1,
    unit: 'LITER',
    offer: offerOf,
  },
];

async function render(
  row: BasketRow,
  products: ReadonlyMap<string, BasketProduct>
) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BasketRowComponent, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketRowComponent);
  fixture.componentRef.setInput('row', row);
  fixture.componentRef.setInput('people', new Map<string, BasketParticipant>());
  fixture.componentRef.setInput('products', products);
  fixture.componentRef.setInput('lists', new Map());
  fixture.componentRef.setInput('busy', false);
  fixture.componentRef.setInput('notice', null);
  fixture.detectChanges();

  return fixture;
}

const caption = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement)
    .querySelector('.product')
    ?.textContent?.trim() ?? null;

describe('BasketRowComponent: the price on the caption line', () => {
  it('renders the pick with its price after the separator', async () => {
    const fixture = await render(
      line({ optionIds: ['i-milk'] }),
      new Map([product('i-milk', offer(0.95))])
    );

    // The name, the separator the app already uses, and the money string. One
    // string on one line, in the same muted treatment the name already has.
    expect(caption(fixture)).toBe('Hacendado whole milk 1 L · €0.95');
  });

  it('renders exactly the caption it rendered before when there is no price', async () => {
    const unpriced = await render(
      line({ optionIds: ['i-milk'] }),
      new Map([product('i-milk', null)])
    );
    const priceless = await render(
      line({ optionIds: ['i-milk'] }),
      new Map([product('i-milk', offer(null))])
    );

    // No placeholder, no dash, no "price unknown": a product with no price says
    // nothing about price (section 2). A scope that carries the product with no
    // price on it reads the same way.
    expect(caption(unpriced)).toBe('Hacendado whole milk 1 L');
    expect(caption(priceless)).toBe('Hacendado whole milk 1 L');
  });

  /**
   * A row has no unchosen product to draw around any more.
   *
   * `pickId` was a column on the line the basket stored, and backend `0136`
   * deleted that table: what a row names is the union of its entries' product
   * sets, anchor first, so `optionIds[0]` **is** the product it means. "Options
   * and no pick" is not a state the model can hold.
   *
   * What is left is a row that names no product at all, which is free text
   * somebody typed and a row whose product the catalog can no longer resolve.
   */
  it('renders no caption at all for a row that names no product', async () => {
    // Free text somebody typed in an aisle. There is no product entry, so the
    // node the caption lives in is not drawn.
    const fixture = await render(line({ optionIds: [] }), new Map());

    expect(caption(fixture)).toBeNull();
  });

  it('says the product is unknown when the catalog cannot resolve it', async () => {
    // A basket outlives the catalog it was read against, and a row with an
    // unnameable product is still a thing to buy: the row names an option, so
    // the entry is drawn, and it says the product could not be named.
    const fixture = await render(line({ optionIds: ['i-gone'] }), new Map());

    expect(caption(fixture)).toBe('basket.product.none');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      '0.95'
    );
  });
});
