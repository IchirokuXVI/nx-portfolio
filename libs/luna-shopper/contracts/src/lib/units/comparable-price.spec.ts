import { UnitOfMeasure } from '../enums/catalog.enums';
import {
  comparablePriceOf,
  type ComparablePriceInput,
} from './comparable-price';

function row(overrides: Partial<ComparablePriceInput>): ComparablePriceInput {
  return {
    price: 2.5,
    unitSize: null,
    defaultUnit: UnitOfMeasure.UNIT,
    packCount: null,
    approxWeight: null,
    ...overrides,
  };
}

describe('comparablePriceOf (plan 0245, section 1)', () => {
  it('derives nothing for a row with no price', () => {
    expect(
      comparablePriceOf(
        row({ price: null, unitSize: 500, defaultUnit: UnitOfMeasure.GRAM })
      )
    ).toBeNull();
  });

  it('prices a pack in grams per kilo', () => {
    expect(
      comparablePriceOf(
        row({ price: 2.5, unitSize: 500, defaultUnit: UnitOfMeasure.GRAM })
      )
    ).toEqual({ price: 5, basis: 'KILOGRAM' });
  });

  it('prices a pack in millilitres per litre', () => {
    expect(
      comparablePriceOf(
        row({
          price: 0.99,
          unitSize: 330,
          defaultUnit: UnitOfMeasure.MILLILITER,
        })
      )
    ).toEqual({ price: 3, basis: 'LITER' });
  });

  it.each([UnitOfMeasure.GRAM, UnitOfMeasure.MILLILITER, UnitOfMeasure.LITER])(
    'derives nothing for a %p pack with no size',
    (defaultUnit) => {
      expect(
        comparablePriceOf(row({ unitSize: null, defaultUnit }))
      ).toBeNull();
      expect(comparablePriceOf(row({ unitSize: 0, defaultUnit }))).toBeNull();
    }
  );

  it('prices a counted product per unit of what is inside', () => {
    expect(
      comparablePriceOf(
        row({ price: 3, unitSize: 12, defaultUnit: UnitOfMeasure.UNIT })
      )
    ).toEqual({ price: 0.25, basis: 'UNIT' });
    expect(
      comparablePriceOf(
        row({ price: 3, unitSize: 6, defaultUnit: UnitOfMeasure.PACK })
      )
    ).toEqual({ price: 0.5, basis: 'UNIT' });
  });

  it('prefers unitSize over packCount for a counted product', () => {
    expect(
      comparablePriceOf(
        row({
          price: 5,
          unitSize: 10,
          packCount: 6,
          defaultUnit: UnitOfMeasure.UNIT,
        })
      )
    ).toEqual({ price: 0.5, basis: 'UNIT' });
  });

  it('divides by packCount when it is the only count', () => {
    expect(
      comparablePriceOf(
        row({ price: 3, packCount: 6, defaultUnit: UnitOfMeasure.UNIT })
      )
    ).toEqual({ price: 0.5, basis: 'UNIT' });
  });

  it('prices a product sold by the kilo per kilo as it is', () => {
    expect(
      comparablePriceOf(
        row({
          price: 13.42,
          unitSize: null,
          defaultUnit: UnitOfMeasure.KILOGRAM,
        })
      )
    ).toEqual({ price: 13.42, basis: 'KILOGRAM' });
  });

  it('prices a piece priced as one per unit, never by its weight (C4)', () => {
    expect(
      comparablePriceOf(
        row({
          price: 4.2,
          unitSize: null,
          approxWeight: 750,
          defaultUnit: UnitOfMeasure.UNIT,
        })
      )
    ).toEqual({ price: 4.2, basis: 'UNIT' });
  });

  it('reads a LITER size of 1.5 as 1500 ml', () => {
    expect(
      comparablePriceOf(
        row({ price: 1.5, unitSize: 1.5, defaultUnit: UnitOfMeasure.LITER })
      )
    ).toEqual({ price: 1, basis: 'LITER' });
  });

  it('reads a KILOGRAM size of 0.4 as 400 g', () => {
    expect(
      comparablePriceOf(
        row({ price: 2, unitSize: 0.4, defaultUnit: UnitOfMeasure.KILOGRAM })
      )
    ).toEqual({ price: 5, basis: 'KILOGRAM' });
  });

  it('rounds half up to four decimals', () => {
    expect(
      comparablePriceOf(
        row({ price: 1, unitSize: 3, defaultUnit: UnitOfMeasure.GRAM })
      )
    ).toEqual({ price: 333.3333, basis: 'KILOGRAM' });
    expect(
      comparablePriceOf(
        row({ price: 2, unitSize: 3, defaultUnit: UnitOfMeasure.UNIT })
      )
    ).toEqual({ price: 0.6667, basis: 'UNIT' });
    // 1.00005 is 1.0000499999 in binary; the decimal rounds up.
    expect(
      comparablePriceOf(
        row({ price: 1.00005, unitSize: 1, defaultUnit: UnitOfMeasure.UNIT })
      )
    ).toEqual({ price: 1.0001, basis: 'UNIT' });
  });
});
