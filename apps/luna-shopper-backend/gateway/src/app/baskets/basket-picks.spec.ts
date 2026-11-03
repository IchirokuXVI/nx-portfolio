import type {
  BasketPriceChoice,
  ItemOfferView,
  ItemView,
} from '@portfolio/luna-shopper/contracts';
import { picksOf } from './basket-picks';

/**
 * Which product a line counts as when only a price can say (plan 0201,
 * section 1, step 3).
 *
 * The comparison itself is `cheapestOf` and is proven in the basket rules.
 * What is proven here is what reaches it: the offers at the scopes that count
 * and no others, in the order of the line.
 */

const HOME = 'scope-home';
const OTHER = 'scope-other';
const SHOP = 'scope-shop';

const offer = (
  priceScopeId: string,
  price: number | null,
  unitPrice: number | null = price
): ItemOfferView => ({ priceScopeId, price, unitPrice }) as ItemOfferView;

/** An offer a chain marks out of stock (plan 0220, section 15). */
const outOfStock = (priceScopeId: string, price: number): ItemOfferView =>
  ({
    ...offer(priceScopeId, price),
    outOfStockAt: '2026-11-01T00:00:00.000Z',
  }) as ItemOfferView;

const item = (id: string, offers: ItemOfferView[]): ItemView =>
  ({ id, offers }) as ItemView;

const line = (lineId: string, ...itemIds: string[]): BasketPriceChoice => ({
  lineId,
  itemIds,
});

describe('picksOf prefers a product in stock (plan 0220, section 15.5)', () => {
  it('picks a dearer product in stock over a cheaper one out of stock', () => {
    const picks = picksOf(
      [line('l1', 'cheap', 'dear')],
      [
        item('cheap', [outOfStock(HOME, 0.8)]),
        item('dear', [offer(HOME, 1.4)]),
      ],
      [HOME]
    );

    expect(picks).toEqual([{ lineId: 'l1', itemId: 'dear' }]);
  });

  it('picks the cheapest when every product is out of stock', () => {
    const picks = picksOf(
      [line('l1', 'dear', 'cheap')],
      [
        item('dear', [outOfStock(HOME, 1.4)]),
        item('cheap', [outOfStock(HOME, 0.8)]),
      ],
      [HOME]
    );

    expect(picks).toEqual([{ lineId: 'l1', itemId: 'cheap' }]);
  });

  it('still needs a price: an unpriced product in stock is no candidate', () => {
    const picks = picksOf(
      [line('l1', 'unpriced', 'gone')],
      [
        item('unpriced', [offer(HOME, null)]),
        item('gone', [outOfStock(HOME, 2)]),
      ],
      [HOME]
    );

    expect(picks).toEqual([{ lineId: 'l1', itemId: 'gone' }]);
  });

  it('reads a product in stock by its offer at a scope that counts', () => {
    const picks = picksOf(
      [line('l1', 'a', 'b')],
      [
        // In stock only at a scope that does not count.
        item('a', [outOfStock(HOME, 0.5), offer(OTHER, 0.4)]),
        item('b', [offer(HOME, 0.9)]),
      ],
      [HOME]
    );

    expect(picks).toEqual([{ lineId: 'l1', itemId: 'b' }]);
  });
});

describe('picksOf (plan 0201, section 1)', () => {
  it('picks the cheapest product of each line', () => {
    const picks = picksOf(
      [line('l1', 'a', 'b'), line('l2', 'c', 'a')],
      [
        item('a', [offer(HOME, 1.2)]),
        item('b', [offer(HOME, 0.9)]),
        item('c', [offer(HOME, 2)]),
      ],
      [HOME]
    );

    expect(picks).toEqual([
      { lineId: 'l1', itemId: 'b' },
      { lineId: 'l2', itemId: 'a' },
    ]);
  });

  it('compares the price for each kilo or litre before the price', () => {
    const picks = picksOf(
      [line('l1', 'small', 'large')],
      [
        // Cheaper to pay for, dearer for each litre.
        item('small', [offer(HOME, 0.6, 1.2)]),
        item('large', [offer(HOME, 1.5, 0.75)]),
      ],
      [HOME]
    );

    expect(picks).toEqual([{ lineId: 'l1', itemId: 'large' }]);
  });

  it('keeps the product the line holds first on a tie', () => {
    const items = [item('a', [offer(HOME, 1)]), item('b', [offer(HOME, 1)])];

    expect(picksOf([line('l1', 'a', 'b')], items, [HOME])).toEqual([
      { lineId: 'l1', itemId: 'a' },
    ]);
    expect(picksOf([line('l1', 'b', 'a')], items, [HOME])).toEqual([
      { lineId: 'l1', itemId: 'b' },
    ]);
  });

  it('takes the cheapest offer of a product over the scopes that count', () => {
    const picks = picksOf(
      [line('l1', 'a', 'b')],
      [
        item('a', [offer(HOME, 1.4), offer(OTHER, 0.8)]),
        item('b', [offer(HOME, 1), offer(OTHER, 1.1)]),
      ],
      [HOME, OTHER]
    );

    expect(picks).toEqual([{ lineId: 'l1', itemId: 'a' }]);
  });

  it('counts only the prices of the shop when the read has one', () => {
    const items = [
      // The cheapest anywhere, and dearer at the shop.
      item('a', [offer(HOME, 0.5), offer(SHOP, 1.3)]),
      item('b', [offer(HOME, 0.9), offer(SHOP, 1.1)]),
      // Cheapest of all, and the shop has no price for it.
      item('c', [offer(HOME, 0.1)]),
    ];

    expect(picksOf([line('l1', 'a', 'b', 'c')], items, [SHOP])).toEqual([
      { lineId: 'l1', itemId: 'b' },
    ]);
  });

  it('leaves out a product whose price is null', () => {
    const picks = picksOf(
      [line('l1', 'a', 'b')],
      [item('a', [offer(HOME, null, null)]), item('b', [offer(HOME, 3)])],
      [HOME]
    );

    expect(picks).toEqual([{ lineId: 'l1', itemId: 'b' }]);
  });

  it('emits no pick for a line with no priced product', () => {
    const picks = picksOf(
      [line('l1', 'a', 'b'), line('l2', 'gone', 'a')],
      [item('a', [offer(OTHER, 1)]), item('b', [])],
      [HOME]
    );

    // Core then counts each line as its first product.
    expect(picks).toEqual([]);
  });

  it('emits no pick when no scope counts', () => {
    expect(
      picksOf([line('l1', 'a', 'b')], [item('a', [offer(HOME, 1)])], [])
    ).toEqual([]);
  });

  it('reads bestOffer when catalog answered the cheapest alone', () => {
    const cheapestAlone = (id: string, price: number): ItemView =>
      ({ id, bestOffer: offer(HOME, price) }) as ItemView;

    expect(
      picksOf(
        [line('l1', 'a', 'b')],
        [cheapestAlone('a', 2), cheapestAlone('b', 1)],
        [HOME]
      )
    ).toEqual([{ lineId: 'l1', itemId: 'b' }]);
  });
});
