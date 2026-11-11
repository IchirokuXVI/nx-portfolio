import {
  basketTotal,
  EMPTY_BASKET_TOTAL,
  type BasketTotalContext,
} from './basket-total';
import type {
  BasketProduct,
  BasketProductAtShop,
  BasketRow,
} from './basket-view';
import type { ProductOffer } from './domain';

function offer(
  price: number | null,
  currency = 'EUR',
  piecePrice: number | null = null
): ProductOffer {
  return {
    price,
    currency,
    unitPrice: null,
    unitPriceLabel: null,
    comparablePrice: null,
    comparableBasis: null,
    piecePrice,
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB',
    stale: false,
    priceScopeId: 's-dia',
  };
}

/** What one shop says about a product: its price there, and its shelf. */
function here(
  price: number | null,
  available: boolean | null = null
): BasketProductAtShop {
  return {
    priceScopeId: price === null ? null : 's-merca-store',
    price,
    currency: price === null ? null : 'EUR',
    available,
  };
}

function product(
  id: string,
  cheapest: ProductOffer | null,
  atShop: BasketProductAtShop | null = null
): BasketProduct {
  return {
    id,
    name: { en: id, es: id },
    brand: null,
    imageUrl: null,
    productGroupId: null,
    size: null,
    unit: null,
    approxWeight: null,
    offer: cheapest,
    offers: cheapest === null ? [] : [cheapest],
    atShop,
    categories: [],
    sectionIds: null,
  };
}

/** A piece of the given weight, by the kilo or priced as one (velista `0179`). */
function piece(
  id: string,
  unit: 'KILOGRAM' | 'UNIT',
  approxWeight: number,
  cheapest: ProductOffer | null,
  atShop: BasketProductAtShop | null = null
): BasketProduct {
  return { ...product(id, cheapest, atShop), unit, approxWeight };
}

/**
 * One row of one product, or of none for an empty list, asking for one.
 *
 * The three quantities are written the way the server writes them: `asked` is
 * `bought + left`, and `boughtElsewhere` is in neither.
 */
function row(
  productIds: readonly string[],
  numbers: Partial<
    Pick<BasketRow, 'left' | 'bought' | 'boughtElsewhere' | 'state' | 'unit'>
  > = {}
): BasketRow {
  const left = numbers.left ?? 1;
  const bought = numbers.bought ?? 0;
  return {
    rowKey: `l-${productIds.join('-') || 'text'}`,
    productId: productIds[0] ?? null,
    content: 'Something',
    unit: numbers.unit ?? 'UNIT',
    left,
    bought,
    asked: bought + left,
    boughtElsewhere: numbers.boughtElsewhere ?? 0,
    state: numbers.state ?? 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    touchedBy: null,
    touchedAt: null,
    entries: [],
    usual: null,
  };
}

function context(
  products: readonly BasketProduct[],
  atShop = false
): BasketTotalContext {
  return {
    products: new Map(products.map((held) => [held.id, held])),
    readAtShop: atShop,
  };
}

/**
 * What the lines on the screen come to (velista `0132`, section 2).
 *
 * The one idea every case below serves: **the total reads the price the row
 * draws.** The same product, the same shop flag, the same blank where the row
 * draws none.
 */
describe('basketTotal', () => {
  const milk = product('p-milk', offer(1.35));

  it('gives zeros and a null currency for an empty set', () => {
    expect(basketTotal([], context([]))).toEqual(EMPTY_BASKET_TOTAL);
    expect(EMPTY_BASKET_TOTAL).toEqual({
      lines: 0,
      withProduct: 0,
      withPrice: 0,
      boughtCents: 0,
      leftCents: 0,
      totalCents: 0,
      currency: null,
      estimated: false,
    });
  });

  it('counts a free text row as a line and nothing else', () => {
    expect(basketTotal([row([])], context([milk]))).toEqual({
      ...EMPTY_BASKET_TOTAL,
      lines: 1,
    });
  });

  /** A row adds what the catalog can name, and the read could not name this one. */
  it('counts a row whose product the read did not name as a line and nothing else', () => {
    expect(basketTotal([row(['p-gone'])], context([milk]))).toEqual({
      ...EMPTY_BASKET_TOTAL,
      lines: 1,
    });
  });

  /** A buy made outside this shopping list counts toward nothing in it (velista `0142`). */
  it('leaves a row bought outside this shopping list out of the lines and the sums', () => {
    const total = basketTotal(
      [
        row(['p-milk'], {
          left: 0,
          boughtElsewhere: 2,
          state: 'BOUGHT_ELSEWHERE',
        }),
      ],
      context([milk])
    );

    expect(total).toEqual(EMPTY_BASKET_TOTAL);
  });

  it('counts a row whose product has no price as a line with a product', () => {
    const unpriced = product('p-salt', null);
    const blank = product('p-rice', offer(null));

    expect(
      basketTotal(
        [row(['p-salt']), row(['p-rice'])],
        context([unpriced, blank])
      )
    ).toEqual({ ...EMPTY_BASKET_TOTAL, lines: 2, withProduct: 2 });
  });

  it('adds a wanted row of 2 at 1.35 to the total and to the left side', () => {
    expect(
      basketTotal([row(['p-milk'], { left: 2 })], context([milk]))
    ).toEqual({
      lines: 1,
      withProduct: 1,
      withPrice: 1,
      boughtCents: 0,
      leftCents: 270,
      totalCents: 270,
      currency: 'EUR',
      estimated: false,
    });
  });

  it('adds the whole amount of a done row to the bought side', () => {
    const total = basketTotal(
      [row(['p-milk'], { left: 0, bought: 2, state: 'DONE' })],
      context([milk])
    );

    expect(total.boughtCents).toBe(270);
    expect(total.leftCents).toBe(0);
    expect(total.totalCents).toBe(270);
  });

  /**
   * The server computes `asked` as `bought + left`, so on a row partly bought
   * here it is the whole of the row: three asked, one bought, two left.
   */
  it('splits a partly bought row between the two sides, which add up to the total', () => {
    const partly = row(['p-milk'], { left: 2, bought: 1, state: 'PARTLY' });
    const total = basketTotal([partly], context([milk]));

    expect(partly.asked).toBe(3);
    expect(total.boughtCents).toBe(135);
    expect(total.leftCents).toBe(270);
    expect(total.totalCents).toBe(405);
    expect(total.boughtCents + total.leftCents).toBe(total.totalCents);
  });

  /**
   * One unit went through another shopping list and two are still wanted. Only
   * the two are priced: `boughtElsewhere` is not a part of this shopping list.
   */
  it('prices what is left and nothing that was bought outside this shopping list', () => {
    const total = basketTotal(
      [row(['p-milk'], { left: 2, boughtElsewhere: 1 })],
      context([milk])
    );

    expect(total.boughtCents).toBe(0);
    expect(total.leftCents).toBe(270);
    expect(total.totalCents).toBe(270);
  });

  /**
   * Three asked: this shopping list bought two and somebody else the last. The
   * row is done and is two units, both bought here (velista `0142`, section 2).
   */
  it('prices a row finished by somebody else as what this shopping list bought', () => {
    const mixed = row(['p-milk'], {
      left: 0,
      bought: 2,
      boughtElsewhere: 1,
      state: 'DONE',
    });
    const total = basketTotal([mixed], context([milk]));

    expect(mixed.asked).toBe(2);
    expect(total.boughtCents).toBe(270);
    expect(total.leftCents).toBe(0);
    expect(total.totalCents).toBe(270);
  });

  it('counts a NOT_AVAILABLE row and a SKIPPED row with a price, on the left side', () => {
    const total = basketTotal(
      [
        row(['p-milk'], { left: 1, state: 'NOT_AVAILABLE' }),
        { ...row(['p-milk'], { left: 2, state: 'SKIPPED' }), rowKey: 'l-2' },
      ],
      context([milk])
    );

    expect(total.withPrice).toBe(2);
    expect(total.boughtCents).toBe(0);
    expect(total.leftCents).toBe(405);
    expect(total.totalCents).toBe(405);
  });

  it('counts a REMOVED row nowhere', () => {
    expect(
      basketTotal(
        [row(['p-milk'], { left: 2, state: 'REMOVED' })],
        context([milk])
      )
    ).toEqual(EMPTY_BASKET_TOTAL);
  });

  /** Rule T4: the row keeps its mark, and its price stays out of the sum. */
  it('adds no price for a row the chosen shop is known not to have', () => {
    const gone = product('p-milk', offer(1.35), here(1.49, false));

    expect(basketTotal([row(['p-milk'])], context([gone], true))).toEqual({
      ...EMPTY_BASKET_TOTAL,
      lines: 1,
      withProduct: 1,
    });
  });

  describe('a row the chosen shop does not list', () => {
    const unlisted = product('p-milk', offer(1.35), here(null));

    /** The cheapest price elsewhere is not a fallback, on the row or here. */
    it('adds no price with a shop chosen, although another shop has one', () => {
      expect(basketTotal([row(['p-milk'])], context([unlisted], true))).toEqual(
        {
          ...EMPTY_BASKET_TOTAL,
          lines: 1,
          withProduct: 1,
        }
      );
    });

    /**
     * Velista `0153`: a shop that prices no row of the basket (Deza) totals zero.
     * Every row is counted as a row with a product and no price, and the cheapest
     * price at another chain never enters the sum under this shop's chip.
     */
    it('totals zero at a shop that prices no row, with every row counted as unpriced', () => {
      const bread = product('p-bread', offer(1.2), here(null));
      const total = basketTotal(
        [row(['p-milk'], { left: 2 }), row(['p-bread'])],
        context([unlisted, bread], true)
      );

      expect(total).toEqual({
        ...EMPTY_BASKET_TOTAL,
        lines: 2,
        withProduct: 2,
      });
    });

    it('adds the cheapest price with no shop chosen', () => {
      const total = basketTotal([row(['p-milk'])], context([unlisted], false));

      expect(total.withPrice).toBe(1);
      expect(total.totalCents).toBe(135);
      expect(total.currency).toBe('EUR');
    });
  });

  it('counts a row in a second currency as a row with no price', () => {
    const pounds = product('p-tea', offer(3, 'GBP'));
    const total = basketTotal(
      [row(['p-milk']), row(['p-tea'])],
      context([milk, pounds])
    );

    expect(total).toEqual({
      lines: 2,
      withProduct: 2,
      withPrice: 1,
      boughtCents: 0,
      leftCents: 135,
      totalCents: 135,
      currency: 'EUR',
      estimated: false,
    });
  });

  describe('a line asked for by weight (velista 0182, criterion 6)', () => {
    const bananas: BasketProduct = {
      ...product('p-bananas', offer(1.99)),
      unit: 'KILOGRAM',
    };

    it('prices a weight row by its grams and calls the total an estimate', () => {
      const total = basketTotal(
        [row(['p-bananas'], { unit: 'GRAM', left: 500, bought: 250 })],
        context([bananas])
      );

      expect(total.withPrice).toBe(1);
      expect(total.boughtCents).toBe(50);
      expect(total.totalCents).toBe(149);
      expect(total.leftCents).toBe(99);
      expect(total.estimated).toBe(true);
    });

    it('keeps a total of counts exact', () => {
      expect(
        basketTotal([row(['p-milk'], { left: 2 })], context([milk])).estimated
      ).toBe(false);
    });

    it('calls a mix of a count and a weight an estimate', () => {
      const total = basketTotal(
        [
          row(['p-milk'], { left: 2 }),
          row(['p-bananas'], { unit: 'GRAM', left: 1000 }),
        ],
        context([milk, bananas])
      );

      expect(total.totalCents).toBe(270 + 199);
      expect(total.estimated).toBe(true);
    });

    it('counts a weight row of a product it cannot weigh as unpriced', () => {
      expect(
        basketTotal(
          [row(['p-milk'], { unit: 'GRAM', left: 500 })],
          context([milk])
        )
      ).toEqual({ ...EMPTY_BASKET_TOTAL, lines: 1, withProduct: 1 });
    });
  });

  describe('a piece whose weight varies (velista 0179)', () => {
    it('adds the piece price of two kilo pieces of cheese', () => {
      const cheese = piece(
        'p-cheese',
        'KILOGRAM',
        1560,
        offer(13.42, 'EUR', 20.94)
      );
      expect(
        basketTotal([row(['p-cheese'], { left: 2 })], context([cheese]))
      ).toEqual({
        lines: 1,
        withProduct: 1,
        withPrice: 1,
        boughtCents: 0,
        leftCents: 4188,
        totalCents: 4188,
        currency: 'EUR',
        estimated: true,
      });
    });

    it('counts a kilo piece with a price and no piece price as unpriced', () => {
      const cheese = piece('p-cheese', 'KILOGRAM', 1560, offer(13.42));
      expect(
        basketTotal([row(['p-cheese'], { left: 2 })], context([cheese]))
      ).toEqual({ ...EMPTY_BASKET_TOTAL, lines: 1, withProduct: 1 });
    });

    it('adds the price of a piece priced as one for each unit', () => {
      const salad = piece('p-salad', 'UNIT', 580, offer(6.5));
      const total = basketTotal(
        [row(['p-salad'], { left: 3 })],
        context([salad])
      );
      expect(total.totalCents).toBe(1950);
      expect(total.withPrice).toBe(1);
    });

    it('reads the piece price at a shop from the offer of the scope it names', () => {
      const atStore = {
        ...offer(13.9, 'EUR', 21.68),
        priceScopeId: 's-merca-store',
      };
      const cheese: BasketProduct = {
        ...piece('p-cheese', 'KILOGRAM', 1560, offer(13.42, 'EUR', 20.94)),
        offers: [offer(13.42, 'EUR', 20.94), atStore],
        atShop: here(13.9),
      };
      expect(
        basketTotal([row(['p-cheese'])], context([cheese], true)).totalCents
      ).toBe(2168);
    });
  });

  /** In floating point 0.1 + 0.2 is 0.30000000000000004, and 1.15 * 100 is 114.99999999999999. */
  it('sums prices such as 0.1 and 0.2 to exact cents', () => {
    const total = basketTotal(
      [row(['p-a']), row(['p-b']), row(['p-c'], { left: 3 })],
      context([
        product('p-a', offer(0.1)),
        product('p-b', offer(0.2)),
        product('p-c', offer(1.15)),
      ])
    );

    expect(total.totalCents).toBe(375);
    expect(total.leftCents).toBe(375);
  });
});
