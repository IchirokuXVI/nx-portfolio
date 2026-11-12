import { UnitOfMeasure } from '../enums/catalog.enums';
import {
  defaultQuantityOf,
  isLineUnit,
  LINE_UNITS,
  lineUnitOf,
  lineUnitsOf,
  productKindOf,
  type ProductSizing,
} from './line-unit';

// The table of plan 0246 section 1, one row per case.
const RICE_500_G: ProductSizing = {
  defaultUnit: UnitOfMeasure.GRAM,
  unitSize: 500,
  approxWeight: null,
};
const HAM_1_KG_SIZED: ProductSizing = {
  defaultUnit: UnitOfMeasure.KILOGRAM,
  unitSize: 1,
  approxWeight: null,
};
const MILK_1000_ML: ProductSizing = {
  defaultUnit: UnitOfMeasure.MILLILITER,
  unitSize: 1000,
  approxWeight: null,
};
const OIL_LEGACY_1_5_L: ProductSizing = {
  defaultUnit: UnitOfMeasure.LITER,
  unitSize: 1.5,
  approxWeight: null,
};
const EGGS_6: ProductSizing = {
  defaultUnit: UnitOfMeasure.UNIT,
  unitSize: 6,
  approxWeight: null,
};
const YOGURT_PACK: ProductSizing = {
  defaultUnit: UnitOfMeasure.PACK,
  unitSize: null,
  approxWeight: null,
};
const MELON_PIECE: ProductSizing = {
  defaultUnit: UnitOfMeasure.UNIT,
  unitSize: null,
  approxWeight: 1800,
};
const LOOSE_BANANAS: ProductSizing = {
  defaultUnit: UnitOfMeasure.KILOGRAM,
  unitSize: null,
  approxWeight: null,
};
const LOOSE_OLIVE_OIL: ProductSizing = {
  defaultUnit: UnitOfMeasure.LITER,
  unitSize: null,
  approxWeight: null,
};
const CHEESE_PIECE: ProductSizing = {
  defaultUnit: UnitOfMeasure.KILOGRAM,
  unitSize: null,
  approxWeight: 700,
};

describe('the line unit vocabulary (plan 0246, section 1)', () => {
  it('names three units, in picker order', () => {
    expect(LINE_UNITS).toEqual(['UNIT', 'GRAM', 'MILLILITER']);
    expect(isLineUnit('GRAM')).toBe(true);
    expect(isLineUnit('KILOGRAM')).toBe(false);
    expect(isLineUnit(undefined)).toBe(false);
  });

  it.each([
    ['a pack sized in grams', RICE_500_G, 'PACK', 'UNIT', ['UNIT', 'GRAM']],
    [
      'a pack sized in kilograms, read as grams',
      HAM_1_KG_SIZED,
      'PACK',
      'UNIT',
      ['UNIT', 'GRAM'],
    ],
    [
      'a pack sized in millilitres',
      MILK_1000_ML,
      'PACK',
      'UNIT',
      ['UNIT', 'MILLILITER'],
    ],
    [
      'a legacy LITER size, read as millilitres',
      OIL_LEGACY_1_5_L,
      'PACK',
      'UNIT',
      ['UNIT', 'MILLILITER'],
    ],
    ['a counted UNIT with a size', EGGS_6, 'PACK', 'UNIT', ['UNIT']],
    ['a counted PACK with no size', YOGURT_PACK, 'PACK', 'UNIT', ['UNIT']],
    ['a piece priced as one', MELON_PIECE, 'PACK', 'UNIT', ['UNIT', 'GRAM']],
    ['a product by the kilo', LOOSE_BANANAS, 'BY_THE_KILO', 'GRAM', ['GRAM']],
    [
      'a product by the litre',
      LOOSE_OLIVE_OIL,
      'BY_THE_LITRE',
      'MILLILITER',
      ['MILLILITER'],
    ],
    ['a kilo piece', CHEESE_PIECE, 'KILO_PIECE', 'UNIT', ['UNIT', 'GRAM']],
  ] as const)(
    '%s: kind, line unit and what it can serve',
    (_name, product, kind, unit, served) => {
      expect(productKindOf(product)).toBe(kind);
      expect(lineUnitOf(kind)).toBe(unit);
      expect(lineUnitsOf([product])).toEqual(served);
    }
  );

  it('reads a zero or missing weight as no weight', () => {
    expect(productKindOf({ ...LOOSE_BANANAS, approxWeight: 0 })).toBe(
      'BY_THE_KILO'
    );
    expect(lineUnitsOf([{ ...YOGURT_PACK, approxWeight: 0 }])).toEqual([
      'UNIT',
    ]);
  });

  it('answers UNIT alone for an empty set, which is a free text line (W1)', () => {
    expect(lineUnitsOf([])).toEqual(['UNIT']);
  });

  it('answers the union over a set of all kinds, in the order UNIT, GRAM, MILLILITER', () => {
    expect(
      lineUnitsOf([LOOSE_OLIVE_OIL, CHEESE_PIECE, LOOSE_BANANAS, YOGURT_PACK])
    ).toEqual(['UNIT', 'GRAM', 'MILLILITER']);
  });

  it('answers only what some product serves: two loose products never offer a count', () => {
    expect(lineUnitsOf([LOOSE_BANANAS, LOOSE_BANANAS])).toEqual(['GRAM']);
    expect(lineUnitsOf([LOOSE_BANANAS, MILK_1000_ML])).toEqual([
      'UNIT',
      'GRAM',
      'MILLILITER',
    ]);
  });

  it('starts a new line at one step: one piece, 25 g or 25 ml (plan 0260 A2)', () => {
    expect(defaultQuantityOf('UNIT')).toBe(1);
    expect(defaultQuantityOf('GRAM')).toBe(25);
    expect(defaultQuantityOf('MILLILITER')).toBe(25);
  });
});
