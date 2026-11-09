import { lineUnitOfProduct, stepAt, stepFrom, stepsFrom } from './line-unit';

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
