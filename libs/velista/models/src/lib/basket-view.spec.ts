import type {
  BasketListRef,
  BasketProduct,
  BasketRowEntry,
} from './basket-view';
import {
  basketDrawnDone,
  basketElsewhere,
  basketRowLists,
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
    productGroupId: null,
    categories: [
      {
        id: 'cat-milk',
        parentId: 'cat-eggs-milk-and-butter',
        slug: 'milk',
        name: { en: 'Milk', es: 'Leche' },
      },
    ],
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
    ['p-there', { ...product([], at(true)), id: 'p-there' }],
    ['p-unknown', { ...product([], at(null)), id: 'p-unknown' }],
  ]);

  it('says nothing while the products do not describe the chosen shop', () => {
    expect(
      basketShelfMark({ productId: 'p-gone' }, products, false)
    ).toBeNull();
  });

  it('marks a row whose product is known missing', () => {
    expect(basketShelfMark({ productId: 'p-gone' }, products, true)).toEqual({
      kind: 'unavailable',
    });
  });

  it('says nothing for a product there, one nobody spoke of, or no product', () => {
    expect(
      basketShelfMark({ productId: 'p-there' }, products, true)
    ).toBeNull();
    expect(
      basketShelfMark({ productId: 'p-unknown' }, products, true)
    ).toBeNull();
    expect(basketShelfMark({ productId: null }, products, true)).toBeNull();
  });
});

describe('basketRowProduct', () => {
  const milk = product([offer('s-dia', 0.79)]);
  const products = new Map([['p-milk', milk]]);

  it("answers the row's one product, or nothing", () => {
    expect(basketRowProduct({ productId: 'p-milk' }, products)?.id).toBe(
      'p-milk'
    );
    expect(basketRowProduct({ productId: null }, products)).toBeNull();
    expect(basketRowProduct({ productId: 'p-gone' }, products)).toBeNull();
  });
});

describe('basketRowLists', () => {
  const lists = new Map<string, BasketListRef>(
    [
      ['l-weekly', 'Compra semanal'],
      ['l-basics', 'Básicos'],
      ['l-kitchen', 'Cocina'],
      ['l-pantry', 'Despensa'],
    ].map(([listId, name]) => [
      listId,
      { listId, name, zoneId: 'z-home', zoneName: 'Casa' },
    ])
  );
  const entries = (...listIds: (string | null)[]) => ({
    entries: listIds.map(
      (listId, at) => ({ lineId: `line-${at}`, listId }) as BasketRowEntry
    ),
  });

  it('names one list', () => {
    expect(basketRowLists(entries('l-weekly'), lists)).toEqual({
      names: ['Compra semanal'],
      others: 0,
    });
  });

  it('names two lists in the order of the entries', () => {
    expect(basketRowLists(entries('l-basics', 'l-weekly'), lists)).toEqual({
      names: ['Básicos', 'Compra semanal'],
      others: 0,
    });
  });

  it('names four lists, each once', () => {
    expect(
      basketRowLists(
        entries('l-weekly', 'l-basics', 'l-kitchen', 'l-weekly', 'l-pantry'),
        lists
      )
    ).toEqual({
      names: ['Compra semanal', 'Básicos', 'Cocina', 'Despensa'],
      others: 0,
    });
  });

  it('counts a list the reader was not served and never names it', () => {
    expect(basketRowLists(entries('l-weekly', null), lists)).toEqual({
      names: ['Compra semanal'],
      others: 1,
    });
    expect(basketRowLists(entries(null, null), lists)).toEqual({
      names: [],
      others: 2,
    });
  });
});

describe('basketElsewhere', () => {
  it('is closed for a row of backend 0203 that only another basket bought', () => {
    expect(
      basketElsewhere({
        state: 'BOUGHT_ELSEWHERE',
        bought: 0,
        boughtElsewhere: 2,
      })
    ).toEqual({ count: 2, closed: true });
  });

  it('is closed for the done row an older server sent, and open while some is left', () => {
    expect(
      basketElsewhere({ state: 'DONE', bought: 0, boughtElsewhere: 1 })
    ).toEqual({ count: 1, closed: true });
    expect(
      basketElsewhere({ state: 'WANTED', bought: 0, boughtElsewhere: 1 })
    ).toEqual({ count: 1, closed: false });
  });

  it('draws a row bought elsewhere as done, until velista 0142', () => {
    expect(basketDrawnDone({ state: 'BOUGHT_ELSEWHERE' })).toBe(true);
    expect(basketDrawnDone({ state: 'DONE' })).toBe(true);
    expect(basketDrawnDone({ state: 'PARTLY' })).toBe(false);
  });
});
