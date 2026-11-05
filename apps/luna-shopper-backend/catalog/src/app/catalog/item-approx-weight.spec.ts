import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  ITEM_APPROX_WEIGHT_DETAIL,
  ITEM_UNIT_SIZE_DETAIL,
  ItemApproxWeightBesideSizeException,
  ItemKilogramHasSizeException,
} from '@portfolio/luna-shopper/platform';
import type { Item, SupermarketItem } from '../entities';
import { piecePriceOf, toItemOfferView, toItemView } from './catalog.mappers';
import {
  expectationMismatches,
  requireBaseUnit,
  requireWeightBesideNoSize,
} from './item.service';

/**
 * The weight of a piece (plan 0244), as the rules that need no database read
 * it: the piece price every offer view derives, and the write rule that keeps a
 * weight away from a size. What only Postgres can say (the checks, the fill's
 * statement, a merge) is in `item-approx-weight.integration.spec.ts`.
 */
const kiloPiece = (approxWeight: number | string | null) => ({
  defaultUnit: UnitOfMeasure.KILOGRAM,
  approxWeight: approxWeight as number | null,
});

describe('piecePriceOf (plan 0244, section 3.3)', () => {
  it('prices the cheese piece: 1560 g at 13.42 a kilo is 20.94', () => {
    expect(piecePriceOf(kiloPiece(1560), 13.42)).toBe(20.94);
  });

  it('reads the weight as Postgres answers a numeric, as a string', () => {
    expect(piecePriceOf(kiloPiece('1560.0000'), 13.42)).toBe(20.94);
  });

  it('rounds half up to the cent', () => {
    // 500 g at 0.01 is half a cent exactly, and 1005 g at 1.00 is 1.005.
    expect(piecePriceOf(kiloPiece(500), 0.01)).toBe(0.01);
    expect(piecePriceOf(kiloPiece(1005), 1)).toBe(1.01);
    expect(piecePriceOf(kiloPiece(1004), 1)).toBe(1);
  });

  it('answers null for a UNIT product with a weight, whose price is the piece', () => {
    expect(
      piecePriceOf({ defaultUnit: UnitOfMeasure.UNIT, approxWeight: 580 }, 6.5)
    ).toBeNull();
  });

  it('answers null for a product sold by the kilo with no weight', () => {
    expect(piecePriceOf(kiloPiece(null), 13.42)).toBeNull();
  });

  it('answers null for an offer with no price', () => {
    expect(piecePriceOf(kiloPiece(1560), null)).toBeNull();
  });

  it('answers null with no product to read', () => {
    expect(piecePriceOf(null, 13.42)).toBeNull();
  });
});

describe('toItemOfferView with the product it prices', () => {
  const row = {
    itemId: 'cheese',
    priceScopeId: 'scope',
    price: '13.42',
    currency: 'EUR',
    unitPrice: '13.42',
    unitPriceLabel: 'kg',
    priceObservedAt: null,
    priceSourceKind: null,
    priceCopiedFromScopeId: null,
    stale: false,
    outOfStockAt: null,
  } as unknown as SupermarketItem;

  it('derives the piece price of a kilo piece, and leaves price the kilo', () => {
    expect(toItemOfferView(row, kiloPiece(1560))).toMatchObject({
      price: 13.42,
      piecePrice: 20.94,
    });
  });

  it('derives none for a UNIT product, for no weight and for no product', () => {
    expect(
      toItemOfferView(row, {
        defaultUnit: UnitOfMeasure.UNIT,
        approxWeight: 580,
      }).piecePrice
    ).toBeNull();
    expect(toItemOfferView(row, kiloPiece(null)).piecePrice).toBeNull();
    expect(toItemOfferView(row, null).piecePrice).toBeNull();
  });

  it('derives none for a null price', () => {
    expect(
      toItemOfferView(
        { ...row, price: null } as SupermarketItem,
        kiloPiece(1560)
      ).piecePrice
    ).toBeNull();
  });
});

describe('toItemView carries the weight and its writer', () => {
  it('answers the weight as a number and names who wrote it', () => {
    const view = toItemView(
      {
        id: 'cheese',
        name: { es: 'Queso viejo' },
        brand: null,
        imageUrl: null,
        sku: null,
        ean: null,
        unitSize: null,
        approxWeight: '1560.0000',
        approxWeightSetBy: 'SOURCE',
        packCount: null,
        defaultUnit: UnitOfMeasure.KILOGRAM,
        productGroupId: null,
        mergedIntoId: null,
      } as unknown as Item,
      [],
      []
    );
    expect(view.approxWeight).toBe(1560);
    expect(view.approxWeightSetBy).toBe('SOURCE');
  });
});

describe('requireWeightBesideNoSize (plan 0244, section 3.2)', () => {
  const refusal = (
    row: Parameters<typeof requireWeightBesideNoSize>[0],
    where: { itemId?: string; index?: number } = {}
  ) => {
    try {
      requireWeightBesideNoSize(row, where);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('lets a KILOGRAM piece of 1560 g and no size through', () => {
    expect(
      refusal({
        defaultUnit: UnitOfMeasure.KILOGRAM,
        unitSize: null,
        approxWeight: 1560,
      })
    ).toBeUndefined();
  });

  it('lets a UNIT piece of 580 g and no size through', () => {
    expect(
      refusal({
        defaultUnit: UnitOfMeasure.UNIT,
        unitSize: null,
        approxWeight: 580,
      })
    ).toBeUndefined();
  });

  it('refuses GRAM 1560 with a weight, and names the weight, the size and the unit', () => {
    const error = refusal(
      { defaultUnit: UnitOfMeasure.GRAM, unitSize: 1560, approxWeight: 1560 },
      { index: 3 }
    );
    expect(error).toBeInstanceOf(ItemApproxWeightBesideSizeException);
    expect((error as ItemApproxWeightBesideSizeException).details).toEqual({
      index: 3,
      [ITEM_APPROX_WEIGHT_DETAIL]: 1560,
      [ITEM_UNIT_SIZE_DETAIL]: 1560,
      defaultUnit: UnitOfMeasure.GRAM,
    });
  });

  it('refuses a weight at zero or below with the same code', () => {
    for (const approxWeight of [0, -5]) {
      expect(
        refusal({
          defaultUnit: UnitOfMeasure.KILOGRAM,
          unitSize: null,
          approxWeight,
        })
      ).toBeInstanceOf(ItemApproxWeightBesideSizeException);
    }
  });

  it('leaves a KILOGRAM with a size to the unit rule, which runs first', () => {
    const row = {
      defaultUnit: UnitOfMeasure.KILOGRAM,
      unitSize: 1.56,
      approxWeight: 1560,
    };
    expect(() => requireBaseUnit(row, {})).toThrow(
      ItemKilogramHasSizeException
    );
  });
});

describe('expectationMismatches compares the weight (plan 0244, section 3.3)', () => {
  const row = {
    name: { es: 'Queso' },
    brand: null,
    unitSize: null,
    approxWeight: '1560.0000' as unknown as number,
    defaultUnit: UnitOfMeasure.KILOGRAM,
    packCount: null,
  };

  it('agrees on the same weight, read as a number', () => {
    expect(expectationMismatches(row, [], { approxWeight: 1560 })).toEqual([]);
  });

  it('names a weight that moved', () => {
    expect(expectationMismatches(row, [], { approxWeight: 395 })).toEqual([
      { field: 'approxWeight', expected: 395, actual: 1560 },
    ]);
    expect(expectationMismatches(row, [], { approxWeight: null })).toEqual([
      { field: 'approxWeight', expected: null, actual: 1560 },
    ]);
  });
});
