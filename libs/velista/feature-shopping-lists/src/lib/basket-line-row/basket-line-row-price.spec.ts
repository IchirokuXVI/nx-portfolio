import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  BasketLine,
  BasketParticipant,
  BasketProduct,
  ProductOffer,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { BasketLineRow } from './basket-line-row';

/**
 * The price on a row (velista `0062`, section 4).
 *
 * Three cases and they are section 8's three: a priced pick renders the caption
 * with the money string after the separator, an unpriced one renders exactly
 * the caption it rendered before, and a line with options and no pick renders
 * no price at all, because quoting the cheapest option there would put a number
 * on a product nobody has chosen.
 */

function line(overrides: Partial<BasketLine> = {}): BasketLine {
  return {
    id: 'line-1',
    content: 'Milk',
    quantity: 3,
    settled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    createdBy: null,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    kind: 'DERIVED',
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
  row: BasketLine,
  products: ReadonlyMap<string, BasketProduct>
) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BasketLineRow, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketLineRow);
  fixture.componentRef.setInput('line', row);
  fixture.componentRef.setInput('people', new Map<string, BasketParticipant>());
  fixture.componentRef.setInput('products', products);
  fixture.componentRef.setInput('listNames', new Map());
  fixture.componentRef.setInput('canReopen', false);
  fixture.componentRef.setInput('busy', false);
  fixture.componentRef.setInput('notice', null);
  fixture.detectChanges();

  return fixture;
}

const caption = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement)
    .querySelector('.product')
    ?.textContent?.trim() ?? null;

describe('BasketLineRow: the price on the caption line', () => {
  it('renders the pick with its price after the separator', async () => {
    const fixture = await render(
      line({ pickId: 'i-milk', optionIds: ['i-milk'] }),
      new Map([product('i-milk', offer(0.95))])
    );

    // The name, the separator the app already uses, and the money string. One
    // string on one line, in the same muted treatment the name already has.
    expect(caption(fixture)).toBe('Hacendado whole milk 1 L · €0.95');
  });

  it('renders exactly the caption it rendered before when there is no price', async () => {
    const unpriced = await render(
      line({ pickId: 'i-milk', optionIds: ['i-milk'] }),
      new Map([product('i-milk', null)])
    );
    const priceless = await render(
      line({ pickId: 'i-milk', optionIds: ['i-milk'] }),
      new Map([product('i-milk', offer(null))])
    );

    // No placeholder, no dash, no "price unknown": a product with no price says
    // nothing about price (section 2). A scope that carries the product with no
    // price on it reads the same way.
    expect(caption(unpriced)).toBe('Hacendado whole milk 1 L');
    expect(caption(priceless)).toBe('Hacendado whole milk 1 L');
  });

  it('renders no price on a line with options and no pick', async () => {
    const fixture = await render(
      line({ pickId: null, optionIds: ['i-milk'] }),
      new Map([product('i-milk', offer(0.95))])
    );

    // The row already says the choice has not been made, and the tap that
    // resolves it is right there (section 4.1).
    expect(caption(fixture)).toBe('basket.product.none');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      '0.95'
    );
  });
});
