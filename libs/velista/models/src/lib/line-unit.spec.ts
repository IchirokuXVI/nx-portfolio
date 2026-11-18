import {
  addAmount,
  canStepUp,
  legacyLineUnit,
  lineUnitOfProduct,
  lineUnits,
  QUANTITY_STEP,
  servesLineUnit,
  shortHundredths,
  shownLineUnit,
  stepAt,
  stepFrom,
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

describe('stepAt (velista 0188, S7b: a press always changes what the row reads)', () => {
  it('steps a count by one below a thousand and by ten from it', () => {
    expect(stepAt(0, 'UNIT')).toBe(1);
    expect(stepAt(999, 'UNIT')).toBe(1);
    expect(stepAt(1000, 'UNIT')).toBe(10);
    expect(stepAt(5000, 'UNIT')).toBe(10);
  });

  it('steps grams and millilitres by 25 at every amount', () => {
    for (const unit of ['GRAM', 'MILLILITER'] as const) {
      expect(stepAt(0, unit)).toBe(25);
      expect(stepAt(975, unit)).toBe(25);
      expect(stepAt(1000, unit)).toBe(25);
      expect(stepAt(999_975, unit)).toBe(25);
    }
  });

  it('keeps the base steps of the owner', () => {
    expect(QUANTITY_STEP).toEqual({ UNIT: 1, GRAM: 25, MILLILITER: 25 });
  });
});

describe('stepFrom (velista 0188, S7b and decision B: no grid)', () => {
  it('moves a count across a thousand', () => {
    expect(stepFrom(999, 'UNIT', 1)).toBe(1000);
    expect(stepFrom(1000, 'UNIT', 1)).toBe(1010);
    expect(stepFrom(1000, 'UNIT', -1)).toBe(999);
    expect(stepFrom(1010, 'UNIT', -1)).toBe(1000);
  });

  it('does not return from minus then plus for a typed count of 1001 to 1009', () => {
    expect(stepFrom(1005, 'UNIT', -1)).toBe(995);
    expect(stepFrom(995, 'UNIT', 1)).toBe(996);
  });

  it('never goes under zero', () => {
    expect(stepFrom(0, 'UNIT', -1)).toBe(0);
    expect(stepFrom(10, 'GRAM', -1)).toBe(0);
    expect(stepFrom(0, 'GRAM', -1)).toBe(0);
  });

  it('adds and takes away 25 g with no snapping', () => {
    expect(stepFrom(1000, 'GRAM', -1)).toBe(975);
    expect(stepFrom(1010, 'GRAM', 1)).toBe(1035);
    expect(stepFrom(1035, 'GRAM', -1)).toBe(1010);
    expect(stepFrom(750, 'GRAM', 1)).toBe(775);
  });

  it('returns after plus then minus from every amount, for all three units (the loop)', () => {
    const amounts: number[] = [];
    for (let value = 0; value <= 1100; value++) {
      amounts.push(value);
    }
    for (let value = 999_900; value <= 999_999; value++) {
      amounts.push(value);
    }
    for (const unit of ['UNIT', 'GRAM', 'MILLILITER'] as const) {
      const broken = amounts.filter(
        (value) => stepFrom(stepFrom(value, unit, 1), unit, -1) !== value
      );
      expect(broken).toEqual([]);
    }
  });
});

describe('canStepUp (velista 0188, S8)', () => {
  it('is off from 999 985 to 999 999 for a count, where the reading stays "999,99"', () => {
    expect(canStepUp(999_980, 'UNIT', 999_999)).toBe(true);
    for (let value = 999_985; value <= 999_999; value++) {
      expect(canStepUp(value, 'UNIT', 999_999)).toBe(false);
    }
  });

  it('is off from 999 975 for grams, one step before the most, and never clamps', () => {
    expect(canStepUp(999_950, 'GRAM', 999_999)).toBe(true);
    expect(canStepUp(999_975, 'GRAM', 999_999)).toBe(false);
    expect(canStepUp(999_999, 'GRAM', 999_999)).toBe(false);
  });

  it('follows the max it is given', () => {
    expect(canStepUp(99_999, 'UNIT', 100_000)).toBe(false);
    expect(canStepUp(99_990, 'UNIT', 100_000)).toBe(true);
    expect(canStepUp(99_975, 'GRAM', 100_000)).toBe(true);
    expect(canStepUp(99_980, 'GRAM', 100_000)).toBe(false);
  });
});

describe('shortHundredths', () => {
  it('rounds half up on the integer and never reads 1000 of the top name', () => {
    expect(shortHundredths(1250)).toBe(125);
    expect(shortHundredths(1275)).toBe(128);
    expect(shortHundredths(2010)).toBe(201);
    expect(shortHundredths(999_994)).toBe(99_999);
    expect(shortHundredths(999_999)).toBe(99_999);
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

describe('addAmount (velista 0185)', () => {
  it('starts a line at one step of its unit: one piece, 25 g, 25 ml', () => {
    expect(addAmount('UNIT')).toBe(1);
    expect(addAmount('GRAM')).toBe(25);
    expect(addAmount('MILLILITER')).toBe(25);
  });
});
