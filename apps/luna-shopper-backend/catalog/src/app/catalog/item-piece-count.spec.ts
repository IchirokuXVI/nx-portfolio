import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import { ItemPieceCountNotAllowedException } from '@portfolio/luna-shopper/platform';
import type { Item } from '../entities';
import { toItemView } from './catalog.mappers';
import {
  expectationMismatches,
  requirePiecesOnSizedProduct,
} from './item.service';

/**
 * The piece count of a product (plan 0278), as the rules that need no
 * database read it: the view, the write rule and the expectation. What only
 * Postgres can say (the checks, the audit row, the comparable price) is in
 * `item-piece-count.integration.spec.ts`.
 */
const ROW = {
  id: 'candies',
  name: { es: 'Caramelos' },
  brand: null,
  imageUrl: null,
  sku: null,
  ean: null,
  unitSize: '35.0000',
  approxWeight: null,
  approxWeightSetBy: null,
  quantityStep: null,
  packCount: null,
  defaultUnit: UnitOfMeasure.GRAM,
  productGroupId: null,
  mergedIntoId: null,
};

describe('toItemView carries the piece count (plan 0278, section 3)', () => {
  it('answers the column', () => {
    const view = toItemView(
      { ...ROW, pieceCount: 50 } as unknown as Item,
      [],
      []
    );
    expect(view.pieceCount).toBe(50);
  });

  it('answers null by default, and for a row read without the column', () => {
    expect(
      toItemView({ ...ROW, pieceCount: null } as unknown as Item, [], [])
        .pieceCount
    ).toBeNull();
    expect(toItemView(ROW as unknown as Item, [], []).pieceCount).toBeNull();
  });
});

describe('requirePiecesOnSizedProduct (plan 0278, section 2)', () => {
  const refusal = (
    row: Parameters<typeof requirePiecesOnSizedProduct>[0],
    where: { itemId?: string; index?: number } = {}
  ) => {
    try {
      requirePiecesOnSizedProduct(row, where);
    } catch (error) {
      return error as ItemPieceCountNotAllowedException;
    }
    return undefined;
  };
  const bag = {
    defaultUnit: UnitOfMeasure.GRAM,
    unitSize: 35,
    approxWeight: null,
    packCount: null,
  };

  it('lets the rows of section 1 through', () => {
    expect(refusal({ ...bag, pieceCount: 50 })).toBeUndefined();
    expect(
      refusal({ ...bag, unitSize: 70, packCount: 2, pieceCount: 100 })
    ).toBeUndefined();
    expect(
      refusal({
        ...bag,
        defaultUnit: UnitOfMeasure.MILLILITER,
        unitSize: 250,
        pieceCount: 20,
      })
    ).toBeUndefined();
    // A tray of 4 burgers holds a pack count and no piece count.
    expect(
      refusal({ ...bag, unitSize: 360, packCount: 4, pieceCount: null })
    ).toBeUndefined();
  });

  it('lets no piece count through on any product', () => {
    for (const defaultUnit of Object.values(UnitOfMeasure)) {
      expect(
        refusal({
          defaultUnit,
          unitSize: null,
          approxWeight: 580,
          packCount: null,
          pieceCount: null,
        })
      ).toBeUndefined();
    }
  });

  it('accepts both bounds and refuses a count beyond them or not whole', () => {
    expect(refusal({ ...bag, pieceCount: 2 })).toBeUndefined();
    expect(refusal({ ...bag, pieceCount: 10000 })).toBeUndefined();
    for (const pieceCount of [1, 0, -3, 10001, 2.5]) {
      const error = refusal({ ...bag, pieceCount });
      expect(error).toBeInstanceOf(ItemPieceCountNotAllowedException);
      expect(error?.message).toContain('from 2 to 10000');
    }
  });

  it('refuses a count without a fixed size, naming the entry and the fields', () => {
    const error = refusal(
      {
        ...bag,
        defaultUnit: UnitOfMeasure.KILOGRAM,
        unitSize: null,
        pieceCount: 50,
      },
      { index: 3 }
    );
    expect(error).toBeInstanceOf(ItemPieceCountNotAllowedException);
    expect(error?.code).toBe('item_piece_count_not_allowed');
    expect(error?.message).toContain('fixed size');
    expect(error?.details).toEqual({
      index: 3,
      pieceCount: 50,
      packCount: null,
      unitSize: null,
      defaultUnit: UnitOfMeasure.KILOGRAM,
    });
  });

  it('refuses a count beside a weight', () => {
    const error = refusal({
      ...bag,
      defaultUnit: UnitOfMeasure.UNIT,
      unitSize: null,
      approxWeight: '580.0000' as unknown as number,
      pieceCount: 7,
    });
    expect(error?.message).toContain('fixed size');
  });

  it.each([[UnitOfMeasure.UNIT], [UnitOfMeasure.PACK]])(
    'refuses a count beside a %s size, which is already a count',
    (defaultUnit) => {
      const error = refusal(
        { ...bag, defaultUnit, unitSize: 6, pieceCount: 50 },
        { itemId: 'eggs' }
      );
      expect(error?.message).toContain('already a count');
      expect(error?.details).toMatchObject({
        itemId: 'eggs',
        defaultUnit,
        unitSize: 6,
      });
    }
  );

  it('refuses a count not above the pack count, reading the columns as Postgres answers them', () => {
    for (const pieceCount of [2, 1]) {
      const error = refusal({
        ...bag,
        unitSize: '70.0000' as unknown as number,
        packCount: 2,
        pieceCount,
      });
      expect(error).toBeInstanceOf(ItemPieceCountNotAllowedException);
    }
    const error = refusal({
      ...bag,
      unitSize: 70,
      packCount: 2,
      pieceCount: 2,
    });
    expect(error?.message).toContain('above the pack count');
    expect(error?.details).toMatchObject({
      pieceCount: 2,
      packCount: 2,
      unitSize: 70,
    });
    expect(refusal({ ...bag, packCount: 2, pieceCount: 3 })).toBeUndefined();
  });
});

describe('expectationMismatches compares the piece count (plan 0278, section 3)', () => {
  const row = { ...ROW, pieceCount: 50 } as unknown as Item;

  it('agrees on the same count, and names a count that moved', () => {
    expect(expectationMismatches(row, [], { pieceCount: 50 })).toEqual([]);
    expect(expectationMismatches(row, [], { pieceCount: null })).toEqual([
      { field: 'pieceCount', expected: null, actual: 50 },
    ]);
    expect(
      expectationMismatches({ ...row, pieceCount: null }, [], {
        pieceCount: 50,
      })
    ).toEqual([{ field: 'pieceCount', expected: 50, actual: null }]);
  });

  it('compares nothing when the expectation names no piece count', () => {
    expect(expectationMismatches(row, [], { packCount: null })).toEqual([]);
  });
});
