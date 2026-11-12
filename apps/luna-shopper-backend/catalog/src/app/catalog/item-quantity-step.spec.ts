import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  ItemApproxWeightBesideSizeException,
  ItemQuantityStepNotAllowedException,
} from '@portfolio/luna-shopper/platform';
import type { Item } from '../entities';
import { toItemView } from './catalog.mappers';
import {
  expectationMismatches,
  requireStepOnLooseProduct,
  requireWeightBesideNoSize,
} from './item.service';

/**
 * The step of a product (plan 0261), as the rules that need no database read
 * it: the view and the write rule. What only Postgres can say (the checks,
 * the fill's statement, the audit row) is in
 * `item-quantity-step.integration.spec.ts`.
 */
const ROW = {
  id: 'chicken',
  name: { es: 'Pollo entero' },
  brand: null,
  imageUrl: null,
  sku: null,
  ean: null,
  unitSize: null,
  approxWeight: null,
  approxWeightSetBy: null,
  packCount: null,
  defaultUnit: UnitOfMeasure.KILOGRAM,
  productGroupId: null,
  mergedIntoId: null,
};

describe('toItemView carries the step (plan 0261, section 2.4)', () => {
  it('answers the column', () => {
    const view = toItemView(
      { ...ROW, quantityStep: 100 } as unknown as Item,
      [],
      []
    );
    expect(view.quantityStep).toBe(100);
  });

  it('answers null by default, and for a row read without the column', () => {
    expect(
      toItemView({ ...ROW, quantityStep: null } as unknown as Item, [], [])
        .quantityStep
    ).toBeNull();
    expect(toItemView(ROW as unknown as Item, [], []).quantityStep).toBeNull();
  });
});

describe('requireStepOnLooseProduct (plan 0261, section 2.2)', () => {
  const refusal = (
    row: Parameters<typeof requireStepOnLooseProduct>[0],
    where: { itemId?: string; index?: number } = {}
  ) => {
    try {
      requireStepOnLooseProduct(row, where);
    } catch (error) {
      return error as ItemQuantityStepNotAllowedException;
    }
    return undefined;
  };
  const loose = {
    defaultUnit: UnitOfMeasure.KILOGRAM,
    unitSize: null,
    approxWeight: null,
  };

  it('lets every listed step through on a product by the kilo and by the litre', () => {
    for (const quantityStep of [1, 5, 10, 25, 50, 100, 200, 250, 500, 1000]) {
      expect(refusal({ ...loose, quantityStep })).toBeUndefined();
      expect(
        refusal({ ...loose, defaultUnit: UnitOfMeasure.LITER, quantityStep })
      ).toBeUndefined();
    }
  });

  it('lets no step through on any product', () => {
    expect(
      refusal({
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 500,
        approxWeight: null,
        quantityStep: null,
      })
    ).toBeUndefined();
  });

  it('refuses a step off the list, naming the allowed steps and the entry', () => {
    const error = refusal({ ...loose, quantityStep: 30 }, { index: 2 });
    expect(error).toBeInstanceOf(ItemQuantityStepNotAllowedException);
    expect(error?.details).toEqual({
      index: 2,
      quantityStep: 30,
      allowed: [1, 5, 10, 25, 50, 100, 200, 250, 500, 1000],
      defaultUnit: UnitOfMeasure.KILOGRAM,
      unitSize: null,
      approxWeight: null,
    });
  });

  it('reads the size and the weight as Postgres answers a numeric, as strings', () => {
    const error = refusal(
      {
        defaultUnit: UnitOfMeasure.KILOGRAM,
        unitSize: null,
        approxWeight: '1560.0000' as unknown as number,
        quantityStep: 100,
      },
      { itemId: 'cheese' }
    );
    expect(error?.details).toMatchObject({
      itemId: 'cheese',
      approxWeight: 1560,
    });
  });

  it('leaves a weight beside a size to the weight rule, which runs first', () => {
    const row = {
      defaultUnit: UnitOfMeasure.GRAM,
      unitSize: 1000,
      approxWeight: 1000,
      quantityStep: 100,
    };
    expect(() => requireWeightBesideNoSize(row, {})).toThrow(
      ItemApproxWeightBesideSizeException
    );
  });
});

describe('expectationMismatches compares the step (plan 0261, section 2.4)', () => {
  const row = { ...ROW, quantityStep: 100 } as unknown as Item;

  it('agrees on the same step, and names a step that moved', () => {
    expect(expectationMismatches(row, [], { quantityStep: 100 })).toEqual([]);
    expect(expectationMismatches(row, [], { quantityStep: null })).toEqual([
      { field: 'quantityStep', expected: null, actual: 100 },
    ]);
  });
});
