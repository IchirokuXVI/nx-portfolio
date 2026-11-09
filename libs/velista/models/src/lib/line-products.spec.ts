import type { ProductShopPrice } from './catalog-browse';
import type { ProductOffer } from './domain';
import type { LineAmountProduct } from './line-amount';
import {
  cheaperForLine,
  cheaperForLineInGroup,
  favoriteFirst,
  itemShopPrices,
  LINE_PRICED_PRODUCTS_MAX,
  lineCardOrder,
  lineMemberCost,
  lineProductPrices,
  lineShownProduct,
  lineSupermarketRows,
  listCost,
  orderLineCards,
  type LineMember,
  type LineProductPriceRead,
  type LineRank,
  type ListCostLine,
} from './line-products';
import type { LineUnitProductRead } from './line-unit';

const MERCADONA = 'chain-mercadona';
const CARREFOUR = 'chain-carrefour';
const LIDL = 'chain-lidl';

function offer(
  price: number | null,
  unitPrice: number | null,
  piecePrice: number | null = null
): ProductOffer {
  return {
    price,
    unitPrice,
    // One basis for every fixture, the same figure as the unit price.
    comparablePrice: unitPrice,
    comparableBasis: unitPrice === null ? null : 'LITER',
    piecePrice,
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

/** Every product a counted pack, so a count line compares the price of one. */
const packs = (): LineUnitProductRead => ({
  unit: 'UNIT',
  size: null,
  approxWeight: null,
});

/** A count line at one, over packs: the order is the order of the price. */
const COUNT_RANK: LineRank = { quantity: 1, unit: 'UNIT', productOf: packs };

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

  it('compares the price of one on a count line, and never the unit price (velista 0183)', () => {
    const prices = lineProductPrices(
      ['small', 'large'],
      reads({
        // The small one costs less and is dearer for each litre.
        small: [row(MERCADONA, 'priced', 1.5, 7.5)],
        large: [row(MERCADONA, 'priced', 2.15, 5.38)],
      }),
      null,
      COUNT_RANK
    );

    expect(prices.map((price) => price.cheapest)).toEqual([true, false]);
  });

  it('marks nothing without a rank: nothing is compared', () => {
    const prices = lineProductPrices(
      ['small', 'large'],
      reads({
        small: [row(MERCADONA, 'priced', 1.5, 7.5)],
        large: [row(MERCADONA, 'priced', 2.15, 5.38)],
      }),
      null
    );

    expect(prices.some((price) => price.cheapest)).toBe(false);
  });

  it('leaves the word on the first of two equal prices', () => {
    const prices = lineProductPrices(
      ['a', 'b'],
      reads({
        a: [row(MERCADONA, 'priced', 2, 4)],
        b: [row(CARREFOUR, 'priced', 2, 4)],
      }),
      null,
      COUNT_RANK
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
        a: [
          row(MERCADONA, 'priced', 2.15, 5.38),
          row(CARREFOUR, 'priced', 2.6, 6.5),
        ],
        b: [
          row(MERCADONA, 'priced', 3, 9),
          row(CARREFOUR, 'priced', 3.45, 8.96),
        ],
        c: [row(MERCADONA, 'priced', 4, 11), row(CARREFOUR, 'notSold')],
      }),
      CARREFOUR,
      COUNT_RANK
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

describe('orderLineCards', () => {
  const order = (
    byItem: Record<string, LineProductPriceRead>,
    favorite: string | null,
    supermarketId: string | null = null
  ): string[] =>
    orderLineCards(
      lineProductPrices(
        Object.keys(byItem),
        reads(byItem),
        supermarketId,
        COUNT_RANK
      ),
      favorite
    ).map((price) => price.itemId);

  it('puts the cheapest first with no favourite, by the price of one on a count line', () => {
    expect(
      order(
        {
          dear: [row(MERCADONA, 'priced', 4.95, 13.75)],
          cheap: [row(MERCADONA, 'priced', 2.15, 5.38)],
          middle: [row(CARREFOUR, 'priced', 3.45, 8.96)],
        },
        null
      )
    ).toEqual(['cheap', 'middle', 'dear']);
  });

  it('puts the favourite first, whatever it costs, and the rest by price', () => {
    expect(
      order(
        {
          dear: [row(MERCADONA, 'priced', 4.95, 13.75)],
          cheap: [row(MERCADONA, 'priced', 2.15, 5.38)],
          middle: [row(CARREFOUR, 'priced', 3.45, 8.96)],
        },
        'dear'
      )
    ).toEqual(['dear', 'cheap', 'middle']);
  });

  it('keeps the order of the line for two products at one price', () => {
    expect(
      order(
        {
          first: [row(MERCADONA, 'priced', 2, 4)],
          second: [row(CARREFOUR, 'priced', 2, 4)],
        },
        null
      )
    ).toEqual(['first', 'second']);
  });

  it('puts the products with no price last, in the order of the line', () => {
    expect(
      order(
        {
          none: [row(MERCADONA, 'unpriced')],
          failed: null,
          priced: [row(MERCADONA, 'priced', 3)],
        },
        null
      )
    ).toEqual(['priced', 'none', 'failed']);
  });

  it('orders by the prices of the supermarket of the line', () => {
    expect(
      order(
        {
          a: [row(MERCADONA, 'priced', 1, 2), row(CARREFOUR, 'priced', 5, 10)],
          b: [row(MERCADONA, 'priced', 2, 4), row(CARREFOUR, 'priced', 3, 6)],
          c: [row(MERCADONA, 'priced', 3, 6), row(CARREFOUR, 'notSold')],
        },
        null,
        CARREFOUR
      )
    ).toEqual(['b', 'a', 'c']);
  });

  it('moves only the favourite while a price is still being read', () => {
    expect(
      order(
        {
          dear: [row(MERCADONA, 'priced', 4.95)],
          waiting: undefined,
          cheap: [row(MERCADONA, 'priced', 2.15)],
        },
        'cheap'
      )
    ).toEqual(['cheap', 'dear', 'waiting']);
  });

  it('leaves the products after the counted ones at the end, unranked', () => {
    const byItem: Record<string, LineProductPriceRead> = {};
    for (let index = 0; index < LINE_PRICED_PRODUCTS_MAX; index += 1) {
      byItem['p' + index] = [row(MERCADONA, 'priced', 10 + index)];
    }
    // Cheaper than all of them, and past the twentieth, where nothing ranks it.
    byItem['late'] = [row(MERCADONA, 'priced', 1)];
    byItem['later'] = undefined;

    const ordered = order(byItem, null);

    expect(ordered[0]).toBe('p0');
    expect(ordered.slice(-2)).toEqual(['late', 'later']);
  });
});

describe('lineShownProduct (velista 0145, section 2)', () => {
  const line = (
    itemIds: readonly string[],
    favoriteItemId: string | null = null,
    preferredSupermarketId: string | null = null
  ) => ({
    itemIds,
    favoriteItemId,
    preferredSupermarketId,
    quantity: 1,
    unit: 'UNIT' as const,
  });

  it('shows the favourite with a price', () => {
    const shown = lineShownProduct(
      line(['cheap', 'fav'], 'fav'),
      reads({
        cheap: [row(MERCADONA, 'priced', 1, 1)],
        fav: [row(MERCADONA, 'priced', 3, 3)],
      }),
      packs
    );

    expect(shown?.itemId).toBe('fav');
    expect(shown?.offer?.price).toBe(3);
  });

  it('shows the favourite with no price', () => {
    const shown = lineShownProduct(
      line(['cheap', 'fav'], 'fav'),
      reads({ cheap: [row(MERCADONA, 'priced', 1, 1)], fav: [] }),
      packs
    );

    expect(shown?.itemId).toBe('fav');
    expect(shown?.kind).toBe('noPrice');
  });

  it('shows the lowest price of one on a count line, not the cheapest litre (velista 0183)', () => {
    const shown = lineShownProduct(
      line(['small', 'large']),
      reads({
        small: [row(MERCADONA, 'priced', 1.5, 7.5)],
        large: [row(MERCADONA, 'priced', 2.15, 5.38)],
      }),
      packs
    );

    expect(shown?.itemId).toBe('small');
  });

  it('keeps the order of the line on a tie', () => {
    const shown = lineShownProduct(
      line(['first', 'second']),
      reads({
        first: [row(MERCADONA, 'priced', 2, 2)],
        second: [row(MERCADONA, 'priced', 2, 2)],
      }),
      packs
    );

    expect(shown?.itemId).toBe('first');
  });

  it('counts only the prices at the supermarket of the line', () => {
    const shown = lineShownProduct(
      line(['a', 'b'], null, CARREFOUR),
      reads({
        // `a` is cheaper at Mercadona, and only Carrefour prices `b`.
        a: [row(MERCADONA, 'priced', 1, 1), row(CARREFOUR, 'notSold')],
        b: [row(CARREFOUR, 'priced', 4, 4)],
      }),
      packs
    );

    expect(shown?.itemId).toBe('b');
    expect(shown?.offer?.price).toBe(4);
  });

  it('shows the first product when none has a price', () => {
    const shown = lineShownProduct(
      line(['a', 'b']),
      reads({ a: [], b: null }),
      packs
    );

    expect(shown?.itemId).toBe('a');
    expect(shown?.kind).toBe('noPrice');
  });

  it('shows the first product while a price is still read', () => {
    const shown = lineShownProduct(
      line(['a', 'b']),
      reads({ b: [row(MERCADONA, 'priced', 1, 1)] }),
      packs
    );

    expect(shown?.itemId).toBe('a');
  });

  it('ranks only the first twenty, as the line page does', () => {
    const itemIds = Array.from(
      { length: LINE_PRICED_PRODUCTS_MAX + 1 },
      (_, i) => `p${i}`
    );
    const byItem: Record<string, LineProductPriceRead> = {};
    for (const itemId of itemIds) {
      byItem[itemId] = [row(MERCADONA, 'priced', 5, 5)];
    }
    // The cheapest of all sits past the cap, where nothing ranks it.
    byItem[`p${LINE_PRICED_PRODUCTS_MAX}`] = [row(MERCADONA, 'priced', 1, 1)];

    expect(lineShownProduct(line(itemIds), reads(byItem), packs)?.itemId).toBe(
      'p0'
    );
  });

  it('is the first card of the line page', () => {
    const source = line(['a', 'b', 'c']);
    const pricesOf = reads({
      a: [row(MERCADONA, 'priced', 3, 3)],
      b: [row(MERCADONA, 'priced', 1, 1)],
      c: [],
    });

    expect(lineShownProduct(source, pricesOf, packs)).toEqual(
      lineCardOrder(source, pricesOf, packs)[0]
    );
    expect(lineShownProduct(source, pricesOf, packs)?.itemId).toBe('b');
  });

  it('shows nothing for a line with no product', () => {
    expect(lineShownProduct(line([]), reads({}), packs)).toBeNull();
  });
});

describe('listCost (velista 0145, section 6; 0182, section 3)', () => {
  const pack: LineAmountProduct = {
    kind: 'PACK',
    unit: 'LITER',
    size: 1,
    approxWeight: null,
  };
  const loose: LineAmountProduct = {
    kind: 'BY_THE_KILO',
    unit: 'KILOGRAM',
    size: null,
    approxWeight: null,
  };
  const piece: LineAmountProduct = {
    kind: 'KILO_PIECE',
    unit: 'KILOGRAM',
    size: null,
    approxWeight: 1560,
  };
  const counted = (
    quantity: number,
    price: ProductOffer | null
  ): ListCostLine => ({ quantity, unit: 'UNIT', offer: price, product: pack });

  it('sums the quantity times the price of the lines still wanted, exact for counts', () => {
    expect(
      listCost([counted(2, offer(1.5, null)), counted(1, offer(0.89, null))])
    ).toEqual({ cents: 389, currency: 'EUR', estimated: false });
  });

  it('leaves out a line at zero and a line with no price', () => {
    expect(
      listCost([
        counted(0, offer(9, null)),
        counted(3, null),
        counted(1, offer(null, null)),
        counted(1, offer(2, null)),
      ])
    ).toEqual({ cents: 200, currency: 'EUR', estimated: false });
  });

  it('prices a weight line by its amount and calls it an estimate', () => {
    expect(
      listCost([
        {
          quantity: 750,
          unit: 'GRAM',
          offer: offer(1.99, null),
          product: loose,
        },
      ])
    ).toEqual({ cents: 149, currency: 'EUR', estimated: true });
  });

  it('calls a mix of a weight and a count an estimate', () => {
    expect(
      listCost([
        counted(2, offer(1.5, null)),
        {
          quantity: 250,
          unit: 'GRAM',
          offer: offer(1.99, null),
          product: loose,
        },
      ])
    ).toEqual({ cents: 350, currency: 'EUR', estimated: true });
  });

  it('adds the piece price of a kilo piece, as an estimate (velista 0179)', () => {
    expect(
      listCost([
        {
          quantity: 2,
          unit: 'UNIT',
          offer: offer(13.42, 13.42, 20.94),
          product: piece,
        },
      ])
    ).toEqual({ cents: 4188, currency: 'EUR', estimated: true });
  });

  it('leaves out a kilo piece with a price and no piece price: it is unpriced', () => {
    expect(
      listCost([
        {
          quantity: 2,
          unit: 'UNIT',
          offer: offer(13.42, 13.42),
          product: piece,
        },
      ])
    ).toBeNull();
  });

  it('adds the price of a piece priced as one for each unit', () => {
    expect(
      listCost([
        {
          quantity: 1,
          unit: 'UNIT',
          offer: offer(6.5, 6.5),
          product: {
            kind: 'PACK',
            unit: 'UNIT',
            size: null,
            approxWeight: 580,
          },
        },
      ])
    ).toEqual({ cents: 650, currency: 'EUR', estimated: false });
  });

  it('answers nothing with no priced line', () => {
    expect(listCost([counted(2, null)])).toBeNull();
    expect(listCost([])).toBeNull();
  });
});

describe('itemShopPrices', () => {
  it('turns each chain price into a row, priced or not', () => {
    const rows = itemShopPrices({
      chainPrices: [
        {
          chain: { id: MERCADONA, name: { en: 'M', es: 'M' } },
          offer: offer(1, 1),
        },
        {
          chain: { id: LIDL, name: { en: 'L', es: 'L' } },
          offer: offer(null, null),
        },
      ],
    });

    expect(rows.map((each) => [each.supermarketId, each.kind])).toEqual([
      [MERCADONA, 'priced'],
      [LIDL, 'unpriced'],
    ]);
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
    const rows = lineSupermarketRows(
      ['a'],
      reads({ a: [] }),
      context,
      CARREFOUR
    );

    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({
      supermarketId: CARREFOUR,
      name: { en: 'Carrefour', es: 'Carrefour' },
      sells: null,
      selected: true,
    });
  });

  it('keeps a supermarket it cannot name, with no name', () => {
    const rows = lineSupermarketRows(
      ['a'],
      reads({ a: [] }),
      context,
      'unknown'
    );

    expect(rows[2].name).toBeNull();
    expect(rows[2].selected).toBe(true);
  });
});

/*
 * W3 (velista 0183, section 1; backend 0246, section 4.3): the cost of the
 * line's amount among the members that can serve its unit, the price of one at
 * 0. The scenarios and their numbers are the backend's `cheapestOf` spec in
 * `libs/luna-shopper/basket-rules/src/lib/basket-rules.spec.ts`, case for case.
 */
describe('the order of a line with several products (velista 0183, W3)', () => {
  type Fixture = {
    readonly product: LineUnitProductRead;
    readonly price: number | null;
    readonly piecePrice?: number | null;
    /** A unit price that says the opposite of W3, which is never read. */
    readonly unitPrice?: number | null;
  };
  const LOOSE = (perKilo: number): Fixture => ({
    product: { unit: 'KILOGRAM', size: null, approxWeight: null },
    price: perKilo,
    unitPrice: 99,
  });
  const PIECE_700_G: Fixture = {
    product: { unit: 'KILOGRAM', size: null, approxWeight: 700 },
    price: 1.99,
    piecePrice: 1.39,
    unitPrice: 0.01,
  };
  const MELON_AS_ONE: Fixture = {
    product: { unit: 'UNIT', size: null, approxWeight: 1800 },
    price: 2.5,
    unitPrice: 99,
  };
  const EGGS: Fixture = {
    product: { unit: 'UNIT', size: 6, approxWeight: null },
    price: 1.1,
    unitPrice: 0.01,
  };
  const PACK = (price: number, unitPrice: number): Fixture => ({
    product: { unit: 'UNIT', size: null, approxWeight: null },
    price,
    unitPrice,
  });

  const pricesOf =
    (fixtures: Record<string, Fixture>) =>
    (itemId: string): LineProductPriceRead => {
      const fixture = fixtures[itemId];
      return [
        {
          supermarketId: MERCADONA,
          chain: { en: 'Mercadona', es: 'Mercadona' },
          logoUrl: null,
          kind: 'priced',
          offer: offer(
            fixture.price,
            fixture.unitPrice ?? null,
            fixture.piecePrice ?? null
          ),
          cheapest: false,
        },
      ];
    };
  const productsOf =
    (fixtures: Record<string, Fixture>) =>
    (itemId: string): LineUnitProductRead =>
      fixtures[itemId].product;

  function cards(
    fixtures: Record<string, Fixture>,
    unit: 'UNIT' | 'GRAM',
    quantity: number,
    favoriteItemId: string | null = null
  ) {
    return lineCardOrder(
      {
        itemIds: Object.keys(fixtures),
        favoriteItemId,
        preferredSupermarketId: null,
        quantity,
        unit,
      },
      pricesOf(fixtures),
      productsOf(fixtures)
    );
  }
  const order = (...args: Parameters<typeof cards>) =>
    cards(...args).map((card) => card.itemId);
  const cheapest = (...args: Parameters<typeof cards>) =>
    cards(...args).find((card) => card.cheapest)?.itemId ?? null;

  it('orders loose at 1,99 the kilo before two 700 g pieces at 1,39 on a 1000 g line', () => {
    const fixtures = { piece: PIECE_700_G, loose: LOOSE(1.99) };
    expect(order(fixtures, 'GRAM', 1000)).toEqual(['loose', 'piece']);
    expect(cheapest(fixtures, 'GRAM', 1000)).toBe('loose');
    // Both priced, with the cost of the amount each one serves it with.
    const [loose, piece] = cards(fixtures, 'GRAM', 1000);
    expect(loose.amount).toEqual({ cents: 199, estimated: true, pieces: null });
    expect(piece.amount).toEqual({ cents: 278, estimated: true, pieces: 2 });
  });

  it('still orders the loose product first on a 500 g line', () => {
    const fixtures = { piece: PIECE_700_G, loose: LOOSE(1.99) };
    expect(order(fixtures, 'GRAM', 500)).toEqual(['loose', 'piece']);
    expect(cards(fixtures, 'GRAM', 500)[0].amount?.cents).toBe(100);
  });

  it('orders a 1,8 kg piece priced as one at 2,50 before loose at 1,49 the kilo on an 1800 g line', () => {
    const fixtures = { loose: LOOSE(1.49), melon: MELON_AS_ONE };
    expect(order(fixtures, 'GRAM', 1800)).toEqual(['melon', 'loose']);
    expect(cards(fixtures, 'GRAM', 1800).map((c) => c.cost)).toEqual([
      250, 268,
    ]);
  });

  it('orders by the price of one when the line asks for nothing', () => {
    // At zero, one kilo of loose at 1,99 against one piece at 1,39.
    const fixtures = { loose: LOOSE(1.99), piece: PIECE_700_G };
    expect(order(fixtures, 'GRAM', 0)).toEqual(['piece', 'loose']);
    expect(cheapest(fixtures, 'GRAM', 0)).toBe('piece');
    // No amount at zero, so no caption of one.
    expect(cards(fixtures, 'GRAM', 0).every((c) => c.amount === null)).toBe(
      true
    );
  });

  it('keeps a counted pack on a weight line, last and marked, and never the cheapest', () => {
    const fixtures = { eggs: EGGS, loose: LOOSE(9.95) };
    const drawn = cards(fixtures, 'GRAM', 500);
    expect(drawn.map((card) => card.itemId)).toEqual(['loose', 'eggs']);
    expect(drawn.map((card) => card.serves)).toEqual([true, false]);
    // Only one product can serve the line, so nothing is compared and nothing marked.
    expect(cheapest(fixtures, 'GRAM', 500)).toBeNull();
  });

  it('keeps the favourite first when it can serve the unit, whatever it costs', () => {
    const fixtures = { loose: LOOSE(1.99), piece: PIECE_700_G };
    expect(order(fixtures, 'GRAM', 1000, 'piece')).toEqual(['piece', 'loose']);
    // The word still goes to the one that costs least.
    expect(cheapest(fixtures, 'GRAM', 1000, 'piece')).toBe('loose');
  });

  it('does not put a favourite first that cannot serve the unit (target state 7)', () => {
    const fixtures = { loose: LOOSE(0.5), bunch: PACK(2.78, 1) };
    expect(order(fixtures, 'UNIT', 2, 'loose')).toEqual(['bunch', 'loose']);
    expect(
      lineShownProduct(
        {
          itemIds: ['loose', 'bunch'],
          favoriteItemId: 'loose',
          preferredSupermarketId: null,
          quantity: 2,
          unit: 'UNIT',
        },
        pricesOf(fixtures),
        productsOf(fixtures)
      )?.itemId
    ).toBe('bunch');
  });

  it('excludes the loose product on a count line, and orders two packs by price', () => {
    const fixtures = {
      loose: LOOSE(0.5),
      big: PACK(3, 0.5),
      small: PACK(2, 9),
    };
    const drawn = cards(fixtures, 'UNIT', 2);
    expect(drawn.map((card) => card.itemId)).toEqual(['small', 'big', 'loose']);
    expect(drawn.map((card) => card.serves)).toEqual([true, true, false]);
    expect(cheapest(fixtures, 'UNIT', 2)).toBe('small');
  });

  it('no longer reads unitPrice', () => {
    // The pack that is cheaper by the litre loses: two of the other cost less.
    const fixtures = { big: PACK(3, 0.5), small: PACK(2, 9) };
    expect(order(fixtures, 'UNIT', 2)).toEqual(['small', 'big']);
  });

  it('marks no card while a record is still being read', () => {
    // The loose product's record is out: only the piece has a cost, and marking
    // it now would move the word to the loose product once the record lands.
    const fixtures = { piece: PIECE_700_G, loose: LOOSE(1.99) };
    const drawn = lineProductPrices(
      ['piece', 'loose'],
      pricesOf(fixtures),
      null,
      {
        quantity: 1000,
        unit: 'GRAM',
        productOf: (itemId) =>
          itemId === 'loose' ? undefined : fixtures.piece.product,
      }
    );
    expect(drawn.map((card) => card.pending)).toEqual([false, true]);
    expect(drawn.some((card) => card.cheapest)).toBe(false);
  });

  it('holds the order while a record is still being read', () => {
    const fixtures = { piece: PIECE_700_G, loose: LOOSE(1.99) };
    const held = lineCardOrder(
      {
        itemIds: ['piece', 'loose'],
        favoriteItemId: null,
        preferredSupermarketId: null,
        quantity: 1000,
        unit: 'GRAM',
      },
      pricesOf(fixtures),
      (itemId) => (itemId === 'loose' ? undefined : fixtures.piece.product)
    );
    expect(held.map((card) => card.itemId)).toEqual(['piece', 'loose']);
  });
});

describe('cheaperForLine and cheaperForLineInGroup (velista 0183)', () => {
  const loose = (perKilo: number): LineMember => ({
    product: { unit: 'KILOGRAM', size: null, approxWeight: null },
    offer: { price: perKilo, piecePrice: null },
  });
  const piece: LineMember = {
    product: { unit: 'KILOGRAM', size: null, approxWeight: 700 },
    offer: { price: 1.99, piecePrice: 1.39 },
  };

  it('sorts ascending by the cost of the amount, null last, input order on a tie', () => {
    const eggs: LineMember = {
      product: { unit: 'UNIT', size: 6, approxWeight: null },
      offer: { price: 1.1, piecePrice: null },
    };
    const sorted = [eggs, piece, loose(1.99), loose(1.99)].sort(
      cheaperForLine({ quantity: 1000, unit: 'GRAM' })
    );
    expect(
      sorted.map((m) => lineMemberCost({ quantity: 1000, unit: 'GRAM' }, m))
    ).toEqual([199, 199, 278, null]);
  });

  it('compares the unrounded price of one at 0, as the server does', () => {
    // 1.231 and 1.234 both round to 1,23 €; the server orders them, so this does.
    const pack = (price: number): LineMember => ({
      product: { unit: 'UNIT', size: null, approxWeight: null },
      offer: { price, piecePrice: null },
    });
    const line = { quantity: 0, unit: 'UNIT' as const };
    const dear = pack(1.234);
    const cheap = pack(1.231);
    expect([dear, cheap].sort(cheaperForLine(line))).toEqual([cheap, dear]);
    expect(
      cheaperForLineInGroup(line, 'dear', dear, [{ id: 'cheap', ...cheap }])
    ).toBe(true);
  });

  it('marks the row only for a strictly cheaper member that can serve its unit', () => {
    const line = { quantity: 1000, unit: 'GRAM' as const };
    expect(
      cheaperForLineInGroup(line, 'piece', piece, [
        { id: 'piece', ...piece },
        { id: 'loose', ...loose(1.99) },
      ])
    ).toBe(true);
    expect(
      cheaperForLineInGroup(line, 'loose', loose(1.99), [
        { id: 'loose', ...loose(1.99) },
        { id: 'piece', ...piece },
      ])
    ).toBe(false);
  });
});
