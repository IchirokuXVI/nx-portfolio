import { LINE_QUANTITY_MAX } from './limits';
import {
  addAmount,
  canStepUp,
  legacyLineUnit,
  lineUnitOfProduct,
  lineUnits,
  QUANTITY_COARSE_STEP,
  QUANTITY_SNAP_POINTS,
  QUANTITY_STEP,
  QUANTITY_STEPS,
  servesLineUnit,
  shortHundredths,
  shownLineUnit,
  snapPointsWithin,
  stepAt,
  stepFrom,
  unitsServedBy,
  type LineUnit,
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

describe('stepAt (velista 0188, S7b; velista 0195: at least 50 from 1000)', () => {
  it('steps a count by one below a thousand and by fifty from it', () => {
    expect(stepAt(0, 'UNIT')).toBe(1);
    expect(stepAt(999, 'UNIT')).toBe(1);
    expect(stepAt(1000, 'UNIT')).toBe(50);
    expect(stepAt(5000, 'UNIT')).toBe(50);
  });

  it('steps grams and millilitres by 25 below a thousand and by 50 from it', () => {
    for (const unit of ['GRAM', 'MILLILITER'] as const) {
      expect(stepAt(0, unit)).toBe(25);
      expect(stepAt(975, unit)).toBe(25);
      expect(stepAt(1000, unit)).toBe(50);
      expect(stepAt(99_975, unit)).toBe(50);
    }
  });

  it('keeps a product step above 50 from a thousand', () => {
    expect(stepAt(1000, 'GRAM', 100)).toBe(100);
    expect(stepAt(1000, 'GRAM', 5)).toBe(50);
    expect(stepAt(995, 'GRAM', 5)).toBe(5);
  });

  it('keeps the base steps of the owner and 5% of 1000 from 1000', () => {
    expect(QUANTITY_STEP).toEqual({ UNIT: 1, GRAM: 25, MILLILITER: 25 });
    expect(QUANTITY_COARSE_STEP).toBe(50);
    expect(QUANTITY_SNAP_POINTS).toEqual([1000]);
  });
});

describe('stepFrom (velista 0188, S7b and decision B; velista 0195 snap points)', () => {
  it('steps grams across a kilo with no product step (spec 1)', () => {
    expect(stepFrom(975, 'GRAM', 1)).toBe(1000);
    expect(stepFrom(1000, 'GRAM', 1)).toBe(1050);
    expect(stepFrom(1050, 'GRAM', -1)).toBe(1000);
    expect(stepFrom(1000, 'GRAM', -1)).toBe(975);
  });

  it('stops a typed amount on 1000 in both directions (spec 2)', () => {
    expect(stepFrom(990, 'GRAM', 1)).toBe(1000);
    expect(stepFrom(1025, 'GRAM', -1)).toBe(1000);
    expect(stepFrom(1010, 'GRAM', 1)).toBe(1060);
    expect(stepFrom(1060, 'GRAM', -1)).toBe(1010);
  });

  it('stops on 1000 on a product step of 100 (spec 3, velista 0186 decision D)', () => {
    expect(stepFrom(900, 'GRAM', 1, 100)).toBe(1000);
    expect(stepFrom(1000, 'GRAM', 1, 100)).toBe(1100);
    expect(stepFrom(975, 'GRAM', 1, 100)).toBe(1000);
  });

  it('moves a product step of 5 by 50 from 1000 (spec 4)', () => {
    expect(stepFrom(995, 'GRAM', 1, 5)).toBe(1000);
    expect(stepFrom(1000, 'GRAM', 1, 5)).toBe(1050);
  });

  it('steps millilitres as grams (spec 5)', () => {
    for (const value of [975, 990, 1000, 1010, 1025, 1050]) {
      for (const direction of [1, -1] as const) {
        expect(stepFrom(value, 'MILLILITER', direction)).toBe(
          stepFrom(value, 'GRAM', direction)
        );
      }
    }
  });

  it('moves a count across a thousand (spec 6)', () => {
    expect(stepFrom(999, 'UNIT', 1)).toBe(1000);
    expect(stepFrom(1000, 'UNIT', 1)).toBe(1050);
    expect(stepFrom(1050, 'UNIT', -1)).toBe(1000);
    expect(stepFrom(1000, 'UNIT', -1)).toBe(999);
  });

  it('stops a typed count of 1001 to 1049 on 1000 going down', () => {
    expect(stepFrom(1005, 'UNIT', -1)).toBe(1000);
    expect(stepFrom(1049, 'UNIT', -1)).toBe(1000);
  });

  it('never goes under zero', () => {
    expect(stepFrom(0, 'UNIT', -1)).toBe(0);
    expect(stepFrom(10, 'GRAM', -1)).toBe(0);
    expect(stepFrom(0, 'GRAM', -1)).toBe(0);
  });

  it('returns after plus then minus from every amount on the grid of each base step, 0 to 3000 (spec 8)', () => {
    const cases: { unit: LineUnit; step: number | null }[] = [
      { unit: 'UNIT', step: null },
      { unit: 'GRAM', step: null },
      { unit: 'MILLILITER', step: null },
      ...QUANTITY_STEPS.map((step) => ({ unit: 'GRAM' as const, step })),
    ];
    for (const { unit, step } of cases) {
      const base = step ?? QUANTITY_STEP[unit];
      const broken: number[] = [];
      for (let value = 0; value <= 3000; value += base) {
        const up = stepFrom(value, unit, 1, step);
        if (stepFrom(up, unit, -1, step) !== value) {
          broken.push(value);
        }
      }
      expect({ unit, step, broken }).toEqual({ unit, step, broken: [] });
    }
  });

  it('returns after plus then minus for every count near the most', () => {
    const broken: number[] = [];
    for (let value = 99_900; value <= 99_999; value++) {
      if (stepFrom(stepFrom(value, 'UNIT', 1), 'UNIT', -1) !== value) {
        broken.push(value);
      }
    }
    expect(broken).toEqual([]);
  });

  it('reads the default points when snaps is left out (spec 9)', () => {
    for (let value = 0; value <= 3000; value += 5) {
      for (const direction of [1, -1] as const) {
        for (const step of [null, 5, 100]) {
          expect(stepFrom(value, 'GRAM', direction, step)).toBe(
            stepFrom(value, 'GRAM', direction, step, [1000])
          );
        }
      }
    }
  });
});

describe('stepFrom with snap points of the caller (velista 0195)', () => {
  const ask990 = [1000, 990];

  it('lands on the nearest point in the direction of travel (spec 10)', () => {
    const points = [990, 1000];
    expect(stepFrom(975, 'GRAM', 1, null, points)).toBe(990);
    expect(stepFrom(990, 'GRAM', 1, null, points)).toBe(1000);
    expect(stepFrom(1010, 'GRAM', -1, null, points)).toBe(1000);
    expect(stepFrom(1000, 'GRAM', -1, null, points)).toBe(990);
  });

  it('moves on from a point equal to the value (spec 11)', () => {
    const points = [990, 1000];
    expect(stepFrom(990, 'GRAM', -1, null, points)).toBe(975);
    expect(stepFrom(990, 'GRAM', 1, null, points)).toBe(1000);
  });

  it('goes back to the grid from a snap point off it (spec 12)', () => {
    expect(stepFrom(975, 'GRAM', 1, null, ask990)).toBe(990);
    expect(stepFrom(990, 'GRAM', -1, null, ask990)).toBe(975);
    expect(stepFrom(990, 'GRAM', 1, null, ask990)).toBe(1000);
    expect(stepFrom(1000, 'GRAM', -1, null, ask990)).toBe(990);
    expect(stepFrom(975, 'GRAM', -1, null, ask990)).toBe(950);
  });

  it('goes back to the grid of 50 above 1000 (spec 13)', () => {
    const points = [1000, 1030];
    expect(stepFrom(1000, 'GRAM', 1, null, points)).toBe(1030);
    expect(stepFrom(1030, 'GRAM', 1, null, points)).toBe(1050);
    expect(stepFrom(1050, 'GRAM', -1, null, points)).toBe(1030);
    expect(stepFrom(1030, 'GRAM', -1, null, points)).toBe(1000);
  });

  it('steps from a point on the grid as from any amount (spec 14)', () => {
    const points = [1000, 975];
    expect(stepFrom(975, 'GRAM', 1, null, points)).toBe(1000);
    expect(stepFrom(975, 'GRAM', -1, null, points)).toBe(950);
  });

  it('goes back to the grid of a product step of 100 (spec 15)', () => {
    expect(stepFrom(990, 'GRAM', 1, 100, ask990)).toBe(1000);
    expect(stepFrom(990, 'GRAM', -1, 100, ask990)).toBe(900);
  });

  it('keeps the rule of today for a typed amount that is not a point (spec 16)', () => {
    expect(stepFrom(1010, 'GRAM', 1, null, ask990)).toBe(1060);
    expect(stepFrom(1060, 'GRAM', -1, null, ask990)).toBe(1010);
    // The case target state 7 accepts: a typed 980 does not come back.
    expect(stepFrom(980, 'GRAM', 1, null, ask990)).toBe(990);
    expect(stepFrom(990, 'GRAM', -1, null, ask990)).toBe(975);
  });

  it('needs no memory of the amount before (spec 17)', () => {
    stepFrom(975, 'GRAM', 1, null, ask990);
    expect(stepFrom(990, 'GRAM', -1, null, ask990)).toBe(975);
    stepFrom(1000, 'GRAM', -1, null, ask990);
    expect(stepFrom(990, 'GRAM', -1, null, ask990)).toBe(975);
    expect(stepFrom(990, 'GRAM', -1, null, ask990)).toBe(975);
  });

  it('ignores a point at or below 0 or above the most (spec 18)', () => {
    expect(stepFrom(25, 'GRAM', -1, null, [0, -10])).toBe(0);
    expect(stepFrom(10, 'GRAM', -1, null, [-5])).toBe(0);
    expect(stepFrom(99_990, 'GRAM', 1, null, [100_000])).toBe(100_040);
  });

  it('snaps nowhere on an empty list passed on purpose (spec 19)', () => {
    expect(stepFrom(990, 'GRAM', 1, null, [])).toBe(1015);
    expect(stepFrom(1025, 'GRAM', -1, null, [])).toBe(975);
  });
});

describe('snapPointsWithin (velista 0195, target state 5)', () => {
  it('drops the points at or under the floor and over the ceiling (spec 18)', () => {
    expect(snapPointsWithin([1, 1000], 1, 99_999)).toEqual([1000]);
    expect(snapPointsWithin([990, 1000], 0, 995)).toEqual([990]);
    expect(snapPointsWithin([], 0, 99_999)).toEqual([]);
  });

  it('never gives a point under the floor as a result', () => {
    expect(stepFrom(110, 'GRAM', -1, null, [90, 1000])).toBe(90);
    const points = snapPointsWithin([90, 1000], 100, LINE_QUANTITY_MAX);
    // 85, which the control's own floor then holds at 100.
    expect(stepFrom(110, 'GRAM', -1, null, points)).toBe(85);
  });
});

describe('canStepUp (velista 0188, S8)', () => {
  it('is off for a count where the next step of 50 passes 99 999', () => {
    expect(canStepUp(99_949, 'UNIT', LINE_QUANTITY_MAX)).toBe(true);
    for (let value = 99_950; value <= 100_000; value++) {
      expect(canStepUp(value, 'UNIT', LINE_QUANTITY_MAX)).toBe(false);
    }
  });

  it('is off from 99 950 for grams and millilitres, one step before the most, and never clamps (spec 7)', () => {
    expect(canStepUp(99_900, 'GRAM', LINE_QUANTITY_MAX)).toBe(true);
    expect(canStepUp(99_949, 'GRAM', LINE_QUANTITY_MAX)).toBe(true);
    expect(canStepUp(99_950, 'GRAM', LINE_QUANTITY_MAX)).toBe(false);
    expect(canStepUp(99_999, 'MILLILITER', LINE_QUANTITY_MAX)).toBe(false);
    // A line stored above the ceiling, from before the ruling.
    expect(canStepUp(100_000, 'GRAM', LINE_QUANTITY_MAX)).toBe(false);
  });

  it('is off for a count from 999 950 under a larger max', () => {
    expect(canStepUp(999_949, 'UNIT', 999_999)).toBe(true);
    for (let value = 999_950; value <= 999_999; value++) {
      expect(canStepUp(value, 'UNIT', 999_999)).toBe(false);
    }
  });

  it('follows the max it is given', () => {
    expect(canStepUp(99_999, 'UNIT', 100_000)).toBe(false);
    expect(canStepUp(99_950, 'UNIT', 100_000)).toBe(true);
    expect(canStepUp(99_950, 'GRAM', 100_000)).toBe(true);
    expect(canStepUp(99_951, 'GRAM', 100_000)).toBe(false);
  });

  it('reads the snap points of the press', () => {
    // A plus at 99 990 g would pass the most, unless a point stops it below.
    expect(canStepUp(99_990, 'GRAM', LINE_QUANTITY_MAX)).toBe(false);
    expect(canStepUp(99_990, 'GRAM', LINE_QUANTITY_MAX, null, [99_995])).toBe(
      true
    );
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

  it('starts a stepped product at one step of its own (velista 0186, ruling 43)', () => {
    // A whole chicken stepped at 1000 is added at 1 kg, and plus then gives 2 kg.
    expect(addAmount('GRAM', 1000)).toBe(1000);
    expect(stepFrom(addAmount('GRAM', 1000), 'GRAM', 1, 1000)).toBe(2000);
    expect(addAmount('GRAM', 100)).toBe(100);
    expect(addAmount('MILLILITER', 250)).toBe(250);
    expect(addAmount('GRAM', 5)).toBe(5);
  });

  it('keeps the default for no step, and a count ignores a step', () => {
    expect(addAmount('GRAM', null)).toBe(25);
    expect(addAmount('GRAM', undefined)).toBe(25);
    expect(addAmount('UNIT', 1000)).toBe(1);
  });
});

describe('stepping from an amount off the step (velista 0186, ruling 44)', () => {
  it('takes 10 g on a step of 50 down to 0 and up to 60', () => {
    expect(stepFrom(10, 'GRAM', -1, 50)).toBe(0);
    expect(stepFrom(10, 'GRAM', 1, 50)).toBe(60);
  });
});

describe('LINE_QUANTITY_MAX (the owner, 2026-11-17, velista 0188 S6)', () => {
  it('is one ceiling of 99 999 base units for every unit', () => {
    expect(LINE_QUANTITY_MAX).toBe(99_999);
  });
});
