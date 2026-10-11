import type { ProductShopPrice } from './catalog-browse';
import type { ProductOffer } from './domain';
import {
  favoriteFirst,
  lineProductPrices,
  lineSupermarketRows,
  type LineProductPriceRead,
} from './line-products';

const MERCADONA = 'chain-mercadona';
const CARREFOUR = 'chain-carrefour';
const LIDL = 'chain-lidl';

function offer(price: number | null, unitPrice: number | null): ProductOffer {
  return {
    price,
    unitPrice,
    currency: 'EUR',
    priceScopeId: 'scope',
  } as unknown as ProductOffer;
}

function row(
  supermarketId: string,
  kind: ProductShopPrice['kind'],
  price: number | null = null,
  unitPrice: number | null = null
): ProductShopPrice {
  return {
    supermarketId,
    chain: { en: supermarketId, es: supermarketId },
    logoUrl: null,
    kind,
    offer: kind === 'notSold' ? null : offer(price, unitPrice),
    cheapest: false,
  };
}

function reads(
  byItem: Record<string, LineProductPriceRead>
): (itemId: string) => LineProductPriceRead {
  return (itemId) => byItem[itemId];
}

describe('lineProductPrices', () => {
  it('shows the lowest price near the person with no supermarket chosen', () => {
    const [price] = lineProductPrices(
      ['a'],
      reads({
        a: [row(MERCADONA, 'priced', 2.15, 5.38), row(CARREFOUR, 'priced', 3)],
      }),
      null
    );

    expect(price.kind).toBe('priced');
    expect(price.offer?.price).toBe(2.15);
    expect(price.supermarketId).toBe(MERCADONA);
  });

  it('marks no card on a line with one product', () => {
    const [price] = lineProductPrices(
      ['a'],
      reads({ a: [row(MERCADONA, 'priced', 2.15, 5.38)] }),
      null
    );

    expect(price.cheapest).toBe(false);
  });

  it('compares the unit price before the price', () => {
    const prices = lineProductPrices(
      ['small', 'large'],
      reads({
        // The small one costs less and is dearer for each litre.
        small: [row(MERCADONA, 'priced', 1.5, 7.5)],
        large: [row(MERCADONA, 'priced', 2.15, 5.38)],
      }),
      null
    );

    expect(prices.map((price) => price.cheapest)).toEqual([false, true]);
  });

  it('leaves the word on the first of two equal prices', () => {
    const prices = lineProductPrices(
      ['a', 'b'],
      reads({
        a: [row(MERCADONA, 'priced', 2, 4)],
        b: [row(CARREFOUR, 'priced', 2, 4)],
      }),
      null
    );

    expect(prices.map((price) => price.cheapest)).toEqual([true, false]);
  });

  it('never marks a product with no price', () => {
    const prices = lineProductPrices(
      ['a', 'b'],
      reads({
        a: [row(MERCADONA, 'unpriced')],
        b: [row(MERCADONA, 'notSold')],
      }),
      null
    );

    expect(prices.map((price) => price.kind)).toEqual(['noPrice', 'noPrice']);
    expect(prices.some((price) => price.cheapest)).toBe(false);
  });

  it('says loading before a read and no price after a failed one', () => {
    const prices = lineProductPrices(
      ['waiting', 'failed'],
      reads({ waiting: undefined, failed: null }),
      null
    );

    expect(prices.map((price) => price.kind)).toEqual(['loading', 'noPrice']);
  });

  it('shows the price at the supermarket of the line', () => {
    const prices = lineProductPrices(
      ['a', 'b', 'c'],
      reads({
        a: [row(MERCADONA, 'priced', 2.15, 5.38), row(CARREFOUR, 'priced', 2.6, 6.5)],
        b: [row(MERCADONA, 'priced', 3, 9), row(CARREFOUR, 'priced', 3.45, 8.96)],
        c: [row(MERCADONA, 'priced', 4, 11), row(CARREFOUR, 'notSold')],
      }),
      CARREFOUR
    );

    expect(prices.map((price) => price.kind)).toEqual([
      'priced',
      'priced',
      'notSold',
    ]);
    expect(prices[0].offer?.price).toBe(2.6);
    // The word compares the prices at that supermarket only.
    expect(prices.map((price) => price.cheapest)).toEqual([true, false, false]);
  });

  it('says no price for a product the supermarket stocks with no price', () => {
    const [price] = lineProductPrices(
      ['a'],
      reads({ a: [row(CARREFOUR, 'unpriced')] }),
      CARREFOUR
    );

    expect(price.kind).toBe('noPrice');
  });
});

describe('favoriteFirst', () => {
  it('moves the favourite to the front and keeps the rest in order', () => {
    expect(favoriteFirst(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('changes nothing with no favourite, or one the line does not hold', () => {
    expect(favoriteFirst(['a', 'b'], null)).toEqual(['a', 'b']);
    expect(favoriteFirst(['a', 'b'], 'gone')).toEqual(['a', 'b']);
  });
});

describe('lineSupermarketRows', () => {
  const context = {
    chains: [
      {
        supermarketId: MERCADONA,
        name: { en: 'Mercadona', es: 'Mercadona' },
        locations: 2,
        logoUrl: null,
      },
      {
        supermarketId: LIDL,
        name: { en: 'Lidl', es: 'Lidl' },
        locations: 1,
        logoUrl: null,
      },
    ],
    chainNames: new Map([[CARREFOUR, { en: 'Carrefour', es: 'Carrefour' }]]),
  };

  it('counts what each supermarket sells and finds its lowest price', () => {
    const rows = lineSupermarketRows(
      ['a', 'b', 'c'],
      reads({
        a: [row(MERCADONA, 'priced', 2.15), row(LIDL, 'notSold')],
        b: [row(MERCADONA, 'priced', 3), row(LIDL, 'notSold')],
        c: [row(MERCADONA, 'unpriced'), row(LIDL, 'notSold')],
      }),
      context,
      MERCADONA
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      supermarketId: MERCADONA,
      sells: 3,
      of: 3,
      selected: true,
    });
    expect(rows[0].lowest?.price).toBe(2.15);
    expect(rows[1]).toMatchObject({ sells: 0, of: 3, selected: false });
    expect(rows[1].lowest).toBeNull();
  });

  it('counts only the products whose prices were read', () => {
    const rows = lineSupermarketRows(
      ['a', 'b', 'c'],
      reads({ a: [row(MERCADONA, 'priced', 2)], b: undefined, c: null }),
      context,
      null
    );

    expect(rows[0]).toMatchObject({ sells: 1, of: 1 });
  });

  it('adds the supermarket of the line when it is not near the person', () => {
    const rows = lineSupermarketRows(['a'], reads({ a: [] }), context, CARREFOUR);

    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({
      supermarketId: CARREFOUR,
      name: { en: 'Carrefour', es: 'Carrefour' },
      sells: null,
      selected: true,
    });
  });

  it('keeps a supermarket it cannot name, with no name', () => {
    const rows = lineSupermarketRows(['a'], reads({ a: [] }), context, 'unknown');

    expect(rows[2].name).toBeNull();
    expect(rows[2].selected).toBe(true);
  });
});
