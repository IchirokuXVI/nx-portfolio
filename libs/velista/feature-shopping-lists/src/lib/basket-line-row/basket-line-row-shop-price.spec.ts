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
  BasketRowMark,
  ProductOffer,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { BasketLineRow } from './basket-line-row';

/**
 * What a row says once the prices come from one shop (velista `0078`, section 5).
 *
 * The assertions are on the **key**, never on the sentence: the testing translator
 * returns a key without interpolating it, so "1.99 € at Dia" would pass whatever the
 * template did with its arguments.
 *
 * The mark is an **input** here, because the pipeline composes it and this component
 * draws it: what these tests are about is that the row draws the chosen shop's number
 * rather than the cheapest, and that a mark reaches the caption and the accessible
 * name both.
 */

function line(overrides: Partial<BasketLine> = {}): BasketLine {
  return {
    id: 'line-1',
    content: 'Milk',
    quantity: 3,
    settled: 0,
    pickId: 'i-milk',
    optionIds: ['i-milk'],
    position: 0,
    createdBy: null,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    kind: 'DERIVED',
    ...overrides,
  } as BasketLine;
}

const offer = (priceScopeId: string, price: number): ProductOffer => ({
  price,
  currency: 'EUR',
  unitPrice: null,
  unitPriceLabel: null,
  observedAt: null,
  sourceKind: 'OFFICIAL_WEB',
  stale: false,
  priceScopeId,
});

/** Milk, listed at Mercadona for 0.95 and at Dia for 0.79. */
const MILK: BasketProduct = {
  id: 'i-milk',
  name: { en: 'Milk', es: 'Leche' },
  brand: null,
  size: null,
  unit: null,
  offer: offer('s-dia', 0.79),
  offers: [offer('s-dia', 0.79), offer('s-merca', 0.95)],
  categories: ['DAIRY'],
};

/** The same product, listed at Dia alone: what an "unlisted" mark is about. */
const DIA_ONLY: BasketProduct = { ...MILK, offers: [offer('s-dia', 0.79)] };

async function render(options: {
  readonly shop?: string | null;
  readonly mark?: BasketRowMark | null;
  readonly product?: BasketProduct;
}) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BasketLineRow, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketLineRow);
  fixture.componentRef.setInput('line', line());
  fixture.componentRef.setInput('people', new Map<string, BasketParticipant>());
  fixture.componentRef.setInput(
    'products',
    new Map([['i-milk', options.product ?? MILK]])
  );
  fixture.componentRef.setInput('listNames', new Map());
  fixture.componentRef.setInput('shop', options.shop ?? null);
  fixture.componentRef.setInput('mark', options.mark ?? null);
  fixture.detectChanges();

  return fixture;
}

const caption = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement)
    .querySelector('.product')
    ?.textContent?.trim() ?? '';

const rowLabel = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement)
    .querySelector('.body')
    ?.getAttribute('aria-label') ?? '';

describe('BasketLineRow: prices from one shop', () => {
  it('draws the cheapest anywhere when no shop is in use', async () => {
    const fixture = await render({ shop: null });

    expect(caption(fixture)).toBe('Milk · €0.79');
  });

  it('draws the chosen shop’s own price instead', async () => {
    const fixture = await render({ shop: 's-merca' });

    // Not 0.79. Quoting Dia's number under a heading that says Mercadona is the
    // defect this whole plan exists to remove.
    expect(caption(fixture)).toBe('Milk · €0.95');
  });

  it('says where it is cheaper, after the price', async () => {
    const fixture = await render({
      shop: 's-merca',
      mark: { kind: 'cheaper', price: 0.79, currency: 'EUR', chain: 'Dia' },
    });

    expect(caption(fixture)).toBe('Milk · €0.95 · basket.price.cheaperAt');
    // The colour is never the only carrier: the sentence is in the accessible
    // name too (section 7).
    expect(rowLabel(fixture)).toContain('basket.price.cheaperAt');
  });

  it('says the shop does not list it, and where it is sold', async () => {
    const fixture = await render({
      shop: 's-merca',
      // The product the mark is about: unlisted at Mercadona means there is no
      // Mercadona offer to draw, which is why the caption carries no number here.
      product: DIA_ONLY,
      mark: {
        kind: 'unlisted',
        chain: 'Mercadona',
        elsewhere: { price: 0.79, currency: 'EUR', chain: 'Dia' },
      },
    });

    // No price of its own, because there is none here: the two clauses are one
    // string, so a line break cannot fall between a price and its shop.
    expect(caption(fixture)).toBe(
      'Milk · basket.price.notListedAt · basket.price.cheaperAt'
    );
  });

  it('says only that it is unlisted when nobody else sells it either', async () => {
    const fixture = await render({
      shop: 's-merca',
      product: DIA_ONLY,
      mark: { kind: 'unlisted', chain: 'Mercadona', elsewhere: null },
    });

    expect(caption(fixture)).toBe('Milk · basket.price.notListedAt');
  });

  /**
   * A shop that carries the product with no number on it is listed and unpriced,
   * which reads as the same blank a product nobody has priced leaves: the row has no
   * room to say "listed, price unknown", and the pick sheet is where that
   * distinction is drawn (`0062`, section 5.3).
   */
  it('draws no price for a scope that carries the product without one', async () => {
    const fixture = await render({
      shop: 's-merca',
      product: {
        ...MILK,
        offers: [{ ...offer('s-merca', 0), price: null }],
      },
    });

    expect(caption(fixture)).toBe('Milk');
  });

  /** The settle controls never leave a row, listed or not (section 5). */
  it('keeps the status control and the reel on a line the shop does not list', async () => {
    const fixture = await render({
      shop: 's-merca',
      mark: { kind: 'unlisted', chain: 'Mercadona', elsewhere: null },
    });

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('button.status')).not.toBeNull();
    expect(element.querySelector('lib-quantity-reel')).not.toBeNull();
  });
});
