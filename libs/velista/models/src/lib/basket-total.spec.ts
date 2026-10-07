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

function offer(price: number | null, currency = 'EUR'): ProductOffer {
  return {
    price,
    currency,
    unitPrice: null,
    unitPriceLabel: null,
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
    offer: cheapest,
    offers: cheapest === null ? [] : [cheapest],
    atShop,
    categories: [],
    sectionIds: null,
  };
}

/**
 * One row with one option unless a test says otherwise, asking for one.
 *
 * The three quantities are written the way the server writes them: `asked` is
 * `bought + left`, and `boughtElsewhere` is in neither.
 */
function row(
  optionIds: readonly string[],
  numbers: Partial<
    Pick<BasketRow, 'left' | 'bought' | 'boughtElsewhere' | 'state'>
  > = {}
): BasketRow {
  const left = numbers.left ?? 1;
  const bought = numbers.bought ?? 0;
  return {
    rowKey: `l-${optionIds.join('-') || 'text'}`,
    content: 'Something',
    left,
    bought,
    asked: bought + left,
    boughtElsewhere: numbers.boughtElsewhere ?? 0,
    state: numbers.state ?? 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds,
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
    pricedAtShop: atShop,
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
    });
  });

  it('counts a free text row as a line and nothing else', () => {
    expect(basketTotal([row([])], context([milk]))).toEqual({
      ...EMPTY_BASKET_TOTAL,
      lines: 1,
    });
  });

  /** Quoting the first option would price something nobody has picked up. */
  it('counts a row with several options and no choice as a line and nothing else', () => {
    const oat = product('p-oat', offer(2.1));

    expect(
      basketTotal([row(['p-milk', 'p-oat'])], context([milk, oat]))
    ).toEqual({ ...EMPTY_BASKET_TOTAL, lines: 1 });
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
   * `boughtElsewhere` is in neither `bought` nor `asked` (backend `0188`), so a
   * row somebody else closed asks for nothing here and still cost what it cost.
   */
  it('puts what was bought through another basket on the bought side', () => {
    const closed = row(['p-milk'], {
      left: 0,
      boughtElsewhere: 2,
      state: 'DONE',
    });
    const total = basketTotal([closed], context([milk]));

    expect(closed.asked).toBe(0);
    expect(total.boughtCents).toBe(270);
    expect(total.leftCents).toBe(0);
    expect(total.totalCents).toBe(270);
  });

  /**
   * The case `asked` is short in: one unit went through another basket and two
   * are still wanted, so the row is three units and `asked` says two.
   */
  it('counts the units bought elsewhere beside the ones still left', () => {
    const total = basketTotal(
      [row(['p-milk'], { left: 2, boughtElsewhere: 1 })],
      context([milk])
    );

    expect(total.boughtCents).toBe(135);
    expect(total.leftCents).toBe(270);
    expect(total.totalCents).toBe(405);
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

  /** The row draws the option it offers in place of its default, so the sum prices that one. */
  it('prices the option a row offers instead of a missing default', () => {
    const gone = product('p-milk', offer(1.35), here(1.49, false));
    const oat = product('p-oat', offer(2.1), here(2.25, true));
    const total = basketTotal(
      [row(['p-milk', 'p-oat'])],
      context([gone, oat], true)
    );

    expect(total.withProduct).toBe(1);
    expect(total.withPrice).toBe(1);
    expect(total.totalCents).toBe(225);
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
