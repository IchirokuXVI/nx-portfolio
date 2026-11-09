import {
  legacyLineUnit,
  lineUnitOfProduct,
  lineUnits,
  servesLineUnit,
  shownLineUnit,
  stepAt,
  stepFrom,
  stepsFrom,
  unitsServedBy,
  type LineUnitProduct,
} from './line-unit';

/*
 * velista's mirror of backend `0246` section 1, "can also serve", row for row:
 * `libs/luna-shopper/contracts/src/lib/units/line-unit.spec.ts` holds the same
 * table for `lineUnitsOf`, with the same products under the same names.
 */
const product = (
  unit: string,
  size: number | null,
  approxWeight: number | null = null
): LineUnitProduct => ({ unit, size, approxWeight });

const RICE_500_G = product('GRAM', 500);
const HAM_1_KG_SIZED = product('KILOGRAM', 1);
const MILK_1000_ML = product('MILLILITER', 1000);
const OIL_LEGACY_1_5_L = product('LITER', 1.5);
const EGGS_6 = product('UNIT', 6);
const YOGURT_PACK = product('PACK', null);
const MELON_PIECE = product('UNIT', null, 1800);
const LOOSE_BANANAS = product('KILOGRAM', null);
const LOOSE_OLIVE_OIL = product('LITER', null);
const CHEESE_PIECE = product('KILOGRAM', null, 700);

describe('lineUnits (velista 0183, section 1; backend 0246 lineUnitsOf)', () => {
  it.each([
    ['a pack sized in grams', RICE_500_G, ['UNIT', 'GRAM']],
    [
      'a pack sized in kilograms, read as grams',
      HAM_1_KG_SIZED,
      ['UNIT', 'GRAM'],
    ],
    ['a pack sized in millilitres', MILK_1000_ML, ['UNIT', 'MILLILITER']],
    [
      'a legacy LITER size, read as millilitres',
      OIL_LEGACY_1_5_L,
      ['UNIT', 'MILLILITER'],
    ],
    ['a counted UNIT with a size', EGGS_6, ['UNIT']],
    ['a counted PACK with no size', YOGURT_PACK, ['UNIT']],
    ['a piece priced as one', MELON_PIECE, ['UNIT', 'GRAM']],
    ['a product by the kilo', LOOSE_BANANAS, ['GRAM']],
    ['a product by the litre', LOOSE_OLIVE_OIL, ['MILLILITER']],
    ['a kilo piece', CHEESE_PIECE, ['UNIT', 'GRAM']],
  ] as const)(
    '%s serves what the backend table says',
    (_name, item, served) => {
      expect(unitsServedBy(item)).toEqual(served);
      expect(lineUnits([item])).toEqual(served);
    }
  );

  it('reads a zero or missing weight as no weight', () => {
    expect(lineUnits([{ ...LOOSE_BANANAS, approxWeight: 0 }])).toEqual([
      'GRAM',
    ]);
    expect(lineUnits([{ ...YOGURT_PACK, approxWeight: 0 }])).toEqual(['UNIT']);
  });

  it('answers UNIT alone for an empty set, which is a free text line (W1)', () => {
    expect(lineUnits([])).toEqual(['UNIT']);
  });

  it('answers the union over a set of all kinds, in the order UNIT, GRAM, MILLILITER', () => {
    expect(
      lineUnits([LOOSE_OLIVE_OIL, CHEESE_PIECE, LOOSE_BANANAS, YOGURT_PACK])
    ).toEqual(['UNIT', 'GRAM', 'MILLILITER']);
  });

  it('answers only what some product serves: two loose products never offer a count', () => {
    expect(lineUnits([LOOSE_BANANAS, LOOSE_BANANAS])).toEqual(['GRAM']);
    expect(lineUnits([LOOSE_BANANAS, MILK_1000_ML])).toEqual([
      'UNIT',
      'GRAM',
      'MILLILITER',
    ]);
  });

  it('offers the chip on the walk line: a loose product and a kilo piece', () => {
    expect(lineUnits([LOOSE_BANANAS, CHEESE_PIECE])).toEqual(['UNIT', 'GRAM']);
  });

  it('says which units one product can serve', () => {
    expect(servesLineUnit(LOOSE_BANANAS, 'UNIT')).toBe(false);
    expect(servesLineUnit(LOOSE_BANANAS, 'GRAM')).toBe(true);
    expect(servesLineUnit(EGGS_6, 'GRAM')).toBe(false);
    expect(servesLineUnit(OIL_LEGACY_1_5_L, 'MILLILITER')).toBe(true);
  });
});

describe('stepAt (velista 0182, section 3)', () => {
  it('steps a count by one at any value', () => {
    expect(stepAt(0, 'UNIT')).toBe(1);
    expect(stepAt(999, 'UNIT')).toBe(1);
    expect(stepAt(5000, 'UNIT')).toBe(1);
  });

  it('steps grams by 25 below a thousand and by 250 from it', () => {
    expect(stepAt(975, 'GRAM')).toBe(25);
    expect(stepAt(1000, 'GRAM')).toBe(250);
  });

  it('steps millilitres by 50 below a thousand and by 250 from it', () => {
    expect(stepAt(950, 'MILLILITER')).toBe(50);
    expect(stepAt(1000, 'MILLILITER')).toBe(250);
  });
});

describe('stepFrom', () => {
  it('crosses a thousand in both directions on a value both steps reach', () => {
    expect(stepFrom(1000, 'GRAM', -1)).toBe(975);
    expect(stepFrom(975, 'GRAM', 1)).toBe(1000);
    expect(stepFrom(1000, 'GRAM', 1)).toBe(1250);
    expect(stepFrom(1250, 'GRAM', -1)).toBe(1000);
    expect(stepFrom(1000, 'MILLILITER', -1)).toBe(950);
    expect(stepFrom(950, 'MILLILITER', 1)).toBe(1000);
  });

  it('snaps a value off the grid onto it in the direction of the step', () => {
    expect(stepFrom(1100, 'GRAM', -1)).toBe(1000);
    expect(stepFrom(1100, 'GRAM', 1)).toBe(1250);
    expect(stepFrom(990, 'GRAM', 1)).toBe(1000);
    expect(stepFrom(10, 'GRAM', -1)).toBe(0);
  });

  it('moves a count by exactly one', () => {
    expect(stepFrom(3, 'UNIT', 1)).toBe(4);
    expect(stepFrom(3, 'UNIT', -1)).toBe(2);
    expect(stepFrom(1, 'UNIT', -1)).toBe(0);
  });
});

describe('stepsFrom', () => {
  it('changes its step where a run crosses the boundary', () => {
    expect(stepsFrom(950, 'GRAM', 4, 0, 100000)).toBe(1500);
    expect(stepsFrom(1250, 'GRAM', -3, 0, 100000)).toBe(950);
  });

  it('holds the run inside the range', () => {
    expect(stepsFrom(25, 'GRAM', -5, 0, 100000)).toBe(0);
    expect(stepsFrom(99, 'UNIT', 5, 0, 100)).toBe(100);
    expect(stepsFrom(2, 'UNIT', -5, 1, 100)).toBe(1);
  });

  it('is plain arithmetic for a count', () => {
    expect(stepsFrom(3, 'UNIT', 5, 0, 100000)).toBe(8);
    expect(stepsFrom(3, 'UNIT', -2, 0, 100000)).toBe(1);
  });
});

describe('lineUnitOfProduct', () => {
  it('weighs a loose product, counts a pack, and counts a product with no record', () => {
    expect(
      lineUnitOfProduct(null, {
        unit: 'KILOGRAM',
        size: null,
        approxWeight: null,
      })
    ).toBe('GRAM');
    expect(
      lineUnitOfProduct(null, { unit: 'LITER', size: 1, approxWeight: null })
    ).toBe('UNIT');
    expect(lineUnitOfProduct({ piecePrice: 1.39 }, null)).toBe('UNIT');
    expect(lineUnitOfProduct(null, null)).toBe('UNIT');
  });
});

describe('legacyLineUnit and shownLineUnit (backend 0246 M2, section 3.2)', () => {
  const loose = { unit: 'KILOGRAM', size: null, approxWeight: null };
  const looseLitre = { unit: 'LITER', size: null, approxWeight: null };
  const pack = { unit: 'KILOGRAM', size: 1, approxWeight: null };
  const piece = { unit: 'KILOGRAM', size: null, approxWeight: 300 };
  const at = (
    unit: 'UNIT' | 'GRAM',
    quantity: number,
    itemIds: readonly string[] = ['i1']
  ) => ({ unit, quantity, itemIds });

  it('reads only a stored UNIT on one loose product as legacy', () => {
    expect(legacyLineUnit(at('UNIT', 3), () => loose)).toBe('GRAM');
    expect(legacyLineUnit(at('UNIT', 3), () => looseLitre)).toBe('MILLILITER');
    expect(legacyLineUnit(at('UNIT', 3), () => pack)).toBeNull();
    expect(legacyLineUnit(at('UNIT', 3), () => piece)).toBeNull();
    expect(legacyLineUnit(at('UNIT', 3), () => null)).toBeNull();
    expect(legacyLineUnit(at('UNIT', 3, ['i1', 'i2']), () => loose)).toBeNull();
    expect(legacyLineUnit(at('UNIT', 3, []), () => loose)).toBeNull();
  });

  it('keeps GRAM on a line whose product a curator turned into a pack or a piece', () => {
    expect(legacyLineUnit(at('GRAM', 750), () => pack)).toBeNull();
    expect(shownLineUnit(at('GRAM', 750), () => pack)).toBe('GRAM');
    expect(shownLineUnit(at('GRAM', 750), () => piece)).toBe('GRAM');
  });

  it("draws a legacy line in its product's unit at nothing only", () => {
    expect(shownLineUnit(at('UNIT', 0), () => loose)).toBe('GRAM');
    expect(shownLineUnit(at('UNIT', 3), () => loose)).toBe('UNIT');
  });

  it('keeps the stored unit when it agrees, or the product is not read yet', () => {
    expect(shownLineUnit(at('GRAM', 0), () => loose)).toBe('GRAM');
    expect(shownLineUnit(at('UNIT', 0), () => pack)).toBe('UNIT');
    expect(shownLineUnit(at('UNIT', 0), () => null)).toBe('UNIT');
    expect(shownLineUnit(at('UNIT', 0, ['i1', 'i2']), () => loose)).toBe(
      'UNIT'
    );
  });
});
