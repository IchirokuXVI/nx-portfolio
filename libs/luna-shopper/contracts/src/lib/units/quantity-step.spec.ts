import { UnitOfMeasure } from '../enums/catalog.enums';
import type { ProductSizing } from './line-unit';
import {
  carriesQuantityStep,
  isQuantityStep,
  QUANTITY_STEPS,
} from './quantity-step';

const sized = (
  defaultUnit: UnitOfMeasure,
  unitSize: number | null,
  approxWeight: number | null = null
): ProductSizing => ({ defaultUnit, unitSize, approxWeight });

describe('the steps a curator may give a product (plan 0261, section 1)', () => {
  it('lists ten divisors of 1000, smallest first (S2)', () => {
    expect(QUANTITY_STEPS).toEqual([
      1, 5, 10, 25, 50, 100, 200, 250, 500, 1000,
    ]);
    for (const step of QUANTITY_STEPS) {
      expect(1000 % step).toBe(0);
    }
  });

  it.each(QUANTITY_STEPS.map((step) => [step]))('%s is a step', (step) => {
    expect(isQuantityStep(step)).toBe(true);
  });

  it.each([[0], [30], [1500], [-25], [25.5], ['25'], [null], [undefined]])(
    '%p is not a step',
    (value) => {
      expect(isQuantityStep(value)).toBe(false);
    }
  );

  // The table of plan 0246 section 1, one row per case (S3).
  it.each([
    ['a pack sized in grams', sized(UnitOfMeasure.GRAM, 500), false],
    ['a pack sized in kilograms', sized(UnitOfMeasure.KILOGRAM, 1), false],
    [
      'a pack sized in millilitres',
      sized(UnitOfMeasure.MILLILITER, 1000),
      false,
    ],
    ['a legacy LITER size', sized(UnitOfMeasure.LITER, 1.5), false],
    ['a counted UNIT with a size', sized(UnitOfMeasure.UNIT, 6), false],
    ['a counted PACK with no size', sized(UnitOfMeasure.PACK, null), false],
    ['a piece priced as one', sized(UnitOfMeasure.UNIT, null, 1800), false],
    ['a product by the kilo', sized(UnitOfMeasure.KILOGRAM, null), true],
    ['a product by the litre', sized(UnitOfMeasure.LITER, null), true],
    ['a kilo piece', sized(UnitOfMeasure.KILOGRAM, null, 700), false],
    ['a counted UNIT with no size', sized(UnitOfMeasure.UNIT, null), false],
    ['a GRAM product with no size', sized(UnitOfMeasure.GRAM, null), false],
  ] as const)('%s carries a step: %s', (_name, product, carries) => {
    expect(carriesQuantityStep(product)).toBe(carries);
  });

  it('refuses a weight on a product by the litre, as the column check does', () => {
    expect(carriesQuantityStep(sized(UnitOfMeasure.LITER, null, 900))).toBe(
      false
    );
    expect(carriesQuantityStep(sized(UnitOfMeasure.KILOGRAM, null, 0))).toBe(
      false
    );
  });
});
