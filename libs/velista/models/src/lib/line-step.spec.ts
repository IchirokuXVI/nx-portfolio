import {
  canStepUp,
  isQuantityStep,
  lineStepOf,
  QUANTITY_STEPS,
  stepAt,
  stepFrom,
  type LineUnitProduct,
} from './line-unit';

/*
 * velista `0186`: the step a curator sets on a product (backend `0261`), read into
 * the rule of velista `0188` section 1. Backend `0261` section 5 is the table that
 * `lineStepOf` mirrors, row for row.
 */
const product = (
  unit: string,
  size: number | null,
  quantityStep: number | null = null
): LineUnitProduct => ({ unit, size, approxWeight: null, quantityStep });

describe('QUANTITY_STEPS (backend 0261, S2)', () => {
  it('holds the ten steps, each a divisor of 1000', () => {
    expect(QUANTITY_STEPS).toEqual([
      1, 5, 10, 25, 50, 100, 200, 250, 500, 1000,
    ]);
    for (const step of QUANTITY_STEPS) {
      expect(1000 % step).toBe(0);
    }
  });

  it('reads anything off the list as no step', () => {
    expect(isQuantityStep(100)).toBe(true);
    expect(isQuantityStep(30)).toBe(false);
    expect(isQuantityStep(0)).toBe(false);
    expect(isQuantityStep('100')).toBe(false);
    expect(isQuantityStep(null)).toBe(false);
  });
});

describe('lineStepOf (backend 0261, section 5)', () => {
  const records = new Map<string, LineUnitProduct>([
    ['bananas-100', product('KILOGRAM', null, 100)],
    ['chicken-250', product('KILOGRAM', null, 250)],
    ['saffron-25', product('KILOGRAM', null, 25)],
    ['bananas-plain', product('KILOGRAM', null)],
    ['rice-500', product('GRAM', 500)],
    ['oil-50', product('LITER', null, 50)],
    ['odd-30', product('KILOGRAM', null, 30)],
  ]);
  const productOf = (itemId: string) => records.get(itemId) ?? null;

  it('answers null for a count, whatever its products say', () => {
    expect(
      lineStepOf({ unit: 'UNIT', itemIds: ['bananas-100'] }, productOf)
    ).toBeNull();
  });

  it('answers the step of the one product', () => {
    expect(
      lineStepOf({ unit: 'GRAM', itemIds: ['bananas-100'] }, productOf)
    ).toBe(100);
  });

  it('answers the smallest step among the members with one (S5): 250 and 25 answer 25', () => {
    expect(
      lineStepOf(
        { unit: 'GRAM', itemIds: ['chicken-250', 'saffron-25'] },
        productOf
      )
    ).toBe(25);
  });

  it('skips a member that serves the unit with no step: beside 100 it answers 100', () => {
    expect(
      lineStepOf(
        { unit: 'GRAM', itemIds: ['bananas-plain', 'bananas-100'] },
        productOf
      )
    ).toBe(100);
  });

  it('reads a member not read yet as saying nothing (decision B)', () => {
    expect(
      lineStepOf(
        { unit: 'GRAM', itemIds: ['unread', 'bananas-100'] },
        productOf
      )
    ).toBe(100);
    expect(
      lineStepOf({ unit: 'GRAM', itemIds: ['unread'] }, () => undefined)
    ).toBeNull();
  });

  it('answers null when no member serving the unit carries a step', () => {
    expect(
      lineStepOf(
        { unit: 'GRAM', itemIds: ['bananas-plain', 'rice-500'] },
        productOf
      )
    ).toBeNull();
    // A step on a member that does not serve the line's unit is not the line's.
    expect(
      lineStepOf({ unit: 'GRAM', itemIds: ['oil-50'] }, productOf)
    ).toBeNull();
    expect(
      lineStepOf({ unit: 'MILLILITER', itemIds: ['oil-50'] }, productOf)
    ).toBe(50);
  });

  it('ignores a step on a product not sold by the kilo or the litre (backend 0261 S3)', () => {
    const stepped = new Map<string, LineUnitProduct>([
      ['rice-pack-100', product('GRAM', 500, 100)],
      [
        'chicken-piece-100',
        { unit: 'KILOGRAM', size: null, approxWeight: 1800, quantityStep: 100 },
      ],
    ]);
    const of = (itemId: string) => stepped.get(itemId) ?? null;
    // A sized pack serves grams through its size, but counts pieces.
    expect(
      lineStepOf({ unit: 'GRAM', itemIds: ['rice-pack-100'] }, of)
    ).toBeNull();
    // A loose chicken given a weight later is a kilo piece: its old step is not the line's.
    expect(
      lineStepOf({ unit: 'GRAM', itemIds: ['chicken-piece-100'] }, of)
    ).toBeNull();
  });

  it('ignores a step off the list of ten', () => {
    expect(
      lineStepOf({ unit: 'GRAM', itemIds: ['odd-30'] }, productOf)
    ).toBeNull();
  });
});

describe('a product step in stepAt, stepFrom and canStepUp (velista 0186, sections 2 and 4)', () => {
  it('keeps the cases of velista 0188 with no step', () => {
    expect(stepAt(975, 'GRAM', null)).toBe(25);
    expect(stepFrom(1000, 'MILLILITER', -1, null)).toBe(975);
    expect(stepFrom(1000, 'UNIT', -1, null)).toBe(999);
    expect(stepFrom(1000, 'UNIT', 1)).toBe(1010);
  });

  it('on a step of 100: 1000 goes down to 900 and back up to 1000', () => {
    expect(stepFrom(1000, 'GRAM', -1, 100)).toBe(900);
    expect(stepFrom(900, 'GRAM', 1, 100)).toBe(1000);
    expect(stepAt(1000, 'GRAM', 100)).toBe(100);
  });

  it('on a step of 100 never snaps: 975 goes up to 1075 and down to 875 (decision D)', () => {
    expect(stepFrom(975, 'GRAM', 1, 100)).toBe(1075);
    expect(stepFrom(975, 'GRAM', -1, 100)).toBe(875);
    expect(stepFrom(1075, 'GRAM', -1, 100)).toBe(975);
  });

  it('uses a step under 10 below 1000 and 10 from 1000 (S7b, decision F)', () => {
    expect(stepAt(500, 'GRAM', 5)).toBe(5);
    expect(stepAt(995, 'GRAM', 5)).toBe(5);
    expect(stepAt(1000, 'GRAM', 5)).toBe(10);
    expect(stepAt(999, 'GRAM', 1)).toBe(1);
    expect(stepAt(1000, 'GRAM', 1)).toBe(10);
    expect(stepFrom(995, 'GRAM', 1, 5)).toBe(1000);
    expect(stepFrom(1000, 'GRAM', 1, 5)).toBe(1010);
    expect(stepFrom(1010, 'GRAM', -1, 5)).toBe(1000);
    expect(stepFrom(1000, 'GRAM', -1, 5)).toBe(995);
  });

  it('uses a step of 1000 unchanged at every amount', () => {
    expect(stepFrom(0, 'GRAM', 1, 1000)).toBe(1000);
    expect(stepFrom(1000, 'GRAM', 1, 1000)).toBe(2000);
    expect(stepFrom(2000, 'GRAM', -1, 1000)).toBe(1000);
  });

  it.each([1, 5, 100, 1000])(
    'returns on plus then minus on a step of %s, from 0, 995, 1000 and 1010',
    (step) => {
      for (const start of [0, 995, 1000, 1010]) {
        const up = stepFrom(start, 'GRAM', 1, step);
        expect(up).toBeGreaterThan(start);
        expect(stepFrom(up, 'GRAM', -1, step)).toBe(start);
      }
    }
  );

  it('ignores a step passed for a count', () => {
    expect(stepAt(5, 'UNIT', 100)).toBe(1);
    expect(stepAt(1000, 'UNIT', 100)).toBe(10);
    expect(stepFrom(5, 'UNIT', 1, 100)).toBe(6);
    expect(stepFrom(5, 'UNIT', -1, 100)).toBe(4);
  });

  it('turns plus off where one step of the product would pass the most', () => {
    expect(canStepUp(99_900, 'GRAM', 100_000, 100)).toBe(true);
    expect(canStepUp(99_950, 'GRAM', 100_000, 100)).toBe(false);
    expect(canStepUp(99_950, 'GRAM', 100_000)).toBe(true);
  });
});
