import type { BasketProduct } from './basket-view';
import { offerAt } from './basket-view';
import type { ProductOffer } from './domain';

function offer(priceScopeId: string, price: number): ProductOffer {
  return {
    price,
    currency: 'EUR',
    unitPrice: null,
    unitPriceLabel: null,
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB',
    stale: false,
    priceScopeId,
  };
}

function product(offers: readonly ProductOffer[]): BasketProduct {
  return {
    id: 'p-milk',
    name: { en: 'Milk', es: 'Leche' },
    brand: null,
    size: null,
    unit: null,
    offer: offers[0] ?? null,
    offers,
    categories: ['DAIRY'],
  };
}

/**
 * The one place a per shop price is looked up (velista `0078`, section 2).
 *
 * One function rather than a `find` at each call site, because the row that draws a
 * price and the pipeline that decides a line has sunk must not be able to answer
 * "does this shop list it" differently.
 */
describe('offerAt', () => {
  it('answers the offer the named scope quoted', () => {
    const milk = product([offer('s-dia', 0.79), offer('s-merca', 0.95)]);

    expect(offerAt(milk, 's-merca')?.price).toBe(0.95);
  });

  /** Absent means unlisted: the server excludes an unavailable row, per `0109`. */
  it('answers null for a scope that does not list the product', () => {
    const milk = product([offer('s-dia', 0.79)]);

    expect(offerAt(milk, 's-merca')).toBeNull();
  });

  it('answers null for a product that is not in the basket at all', () => {
    // A pick the catalog can no longer resolve: to the reader that is the same
    // "no price from here" a missing row is, and it must not throw.
    expect(offerAt(undefined, 's-merca')).toBeNull();
  });

  it('answers null for a product nobody has priced anywhere', () => {
    expect(offerAt(product([]), 's-merca')).toBeNull();
  });
});
