import type { BasketProduct } from './basket-view';
import {
  basketRowProduct,
  basketSettleShop,
  basketShelfMark,
  offerAt,
  shownOffer,
  shownPriceScope,
  type BasketProductAtShop,
} from './basket-view';
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

function product(
  offers: readonly ProductOffer[],
  atShop: BasketProductAtShop | null = null
): BasketProduct {
  return {
    id: 'p-milk',
    name: { en: 'Milk', es: 'Leche' },
    brand: null,
    size: null,
    unit: null,
    offer: offers[0] ?? null,
    offers,
    atShop,
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

/**
 * The scope a settle names is the scope of the price the row drew (velista `0095`,
 * section 6, test 9).
 */
describe('shownPriceScope', () => {
  // The shop's own stack prices it at its store scope, which the server decided
  // (velista `0102`): not the Mercadona offer, and not the cheapest.
  const milk = product([offer('s-dia', 0.79), offer('s-merca', 0.95)], {
    priceScopeId: 's-merca-store',
    price: 0.89,
    currency: 'EUR',
    available: null,
  });

  it('names the scope of the shop price when the rows are priced at a shop', () => {
    expect(shownPriceScope(milk, true)).toBe('s-merca-store');
    expect(shownOffer(milk, true)?.price).toBe(0.89);
  });

  it('names the cheapest offer when no shop is chosen', () => {
    expect(shownPriceScope(milk, false)).toBe('s-dia');
  });

  it('is absent when the row drew no price', () => {
    expect(shownPriceScope(null, false)).toBeUndefined();
    expect(
      shownPriceScope(
        product([offer('s-dia', 0.79)], {
          priceScopeId: null,
          price: null,
          currency: null,
          available: null,
        }),
        true
      )
    ).toBeUndefined();
    expect(shownPriceScope(product([]), true)).toBeUndefined();
    expect(shownPriceScope(product([]), false)).toBeUndefined();
    expect(
      shownPriceScope(product([{ ...offer('s-dia', 0), price: null }]), false)
    ).toBeUndefined();
  });
});

/**
 * Where a settle says it happened (velista `0102`). The one place every settle
 * body learns about a shop, so these are the settle's rules.
 */
describe('basketSettleShop', () => {
  const milk = product([offer('s-dia', 0.79), offer('s-merca', 0.95)], {
    priceScopeId: 's-merca-store',
    price: 0.89,
    currency: 'EUR',
    available: true,
  });

  it('carries the shop and the atShop scope when a shop is chosen', () => {
    expect(basketSettleShop(milk, 'loc-merca', true)).toEqual({
      priceScopeId: 's-merca-store',
      supermarketLocationId: 'loc-merca',
    });
  });

  it('carries no shop in "any of your shops" mode, only the scope shown', () => {
    expect(basketSettleShop(milk, null, false)).toEqual({
      priceScopeId: 's-dia',
    });
    expect(basketSettleShop(milk, null, true)).toEqual({
      priceScopeId: 's-dia',
    });
  });

  it('carries the shop and no scope for a product with no price shown', () => {
    expect(basketSettleShop(null, 'loc-merca', true)).toEqual({
      supermarketLocationId: 'loc-merca',
    });
  });
});

describe('basketShelfMark', () => {
  const at = (available: boolean | null): BasketProductAtShop => ({
    priceScopeId: null,
    price: null,
    currency: null,
    available,
  });
  const products = new Map<string, BasketProduct>([
    ['p-gone', { ...product([], at(false)), id: 'p-gone' }],
    ['p-also-gone', { ...product([], at(false)), id: 'p-also-gone' }],
    ['p-there', { ...product([], at(true)), id: 'p-there' }],
  ]);

  it('says nothing while the products do not describe the chosen shop', () => {
    expect(
      basketShelfMark({ optionIds: ['p-gone'] }, products, false)
    ).toBeNull();
  });

  it('marks a row whose every option is known missing', () => {
    expect(
      basketShelfMark({ optionIds: ['p-gone', 'p-also-gone'] }, products, true)
    ).toEqual({ kind: 'unavailable' });
  });

  it('offers the option known there in place of a missing default', () => {
    expect(
      basketShelfMark({ optionIds: ['p-gone', 'p-there'] }, products, true)
    ).toEqual({ kind: 'instead', optionId: 'p-there', replacedId: 'p-gone' });
  });

  it('says nothing when the default is there, whatever the others are', () => {
    expect(
      basketShelfMark({ optionIds: ['p-there', 'p-gone'] }, products, true)
    ).toBeNull();
  });
});

describe('basketRowProduct', () => {
  const milk = product([offer('s-dia', 0.79)]);
  const products = new Map([
    ['p-milk', milk],
    ['p-oat', { ...milk, id: 'p-oat' }],
  ]);

  it('answers a choice still among the options, the only option, or nothing', () => {
    expect(
      basketRowProduct({ optionIds: ['p-milk', 'p-oat'] }, products, 'p-oat')
        ?.id
    ).toBe('p-oat');
    expect(
      basketRowProduct({ optionIds: ['p-milk'] }, products, null)?.id
    ).toBe('p-milk');
    expect(
      basketRowProduct({ optionIds: ['p-milk', 'p-oat'] }, products, null)
    ).toBeNull();
    expect(
      basketRowProduct({ optionIds: ['p-milk'] }, products, 'p-gone')?.id
    ).toBe('p-milk');
  });
});
