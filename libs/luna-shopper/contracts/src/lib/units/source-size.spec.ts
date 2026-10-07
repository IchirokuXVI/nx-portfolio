import { UnitOfMeasure } from '../enums/catalog.enums';
import {
  isPrintedLength,
  measuresContent,
  printedSizeUnit,
  SOURCE_SIZE_UNITS,
  sourceSizeOf,
  sourceSizeUnitOf,
  toBaseUnit,
} from './source-size';

describe('sourceSizeOf (plan 0177)', () => {
  it.each([
    [75, 'cl', 750, UnitOfMeasure.MILLILITER],
    [33, 'CL', 330, UnitOfMeasure.MILLILITER],
    [1.5, 'l', 1.5, UnitOfMeasure.LITER],
    [1.28, 'L', 1.28, UnitOfMeasure.LITER],
    [0.4636, 'kg', 0.4636, UnitOfMeasure.KILOGRAM],
    [500, 'g', 500, UnitOfMeasure.GRAM],
    [330, 'ml', 330, UnitOfMeasure.MILLILITER],
    [16, 'ud', 16, UnitOfMeasure.UNIT],
    [44, 'lavados', 44, UnitOfMeasure.UNIT],
    [1, 'docena', 12, UnitOfMeasure.UNIT],
    [2, 'dl', 200, UnitOfMeasure.MILLILITER],
    [500, 'mg', 0.5, UnitOfMeasure.GRAM],
  ])('reads %p %p as %p %p', (amount, word, unitSize, sizeUnit) => {
    expect(sourceSizeOf(amount, word)).toEqual({ unitSize, sizeUnit });
  });

  it('states no size at all for a length, which is a dimension (plan 0183)', () => {
    expect(sourceSizeOf(30, 'm')).toEqual({ unitSize: null, sizeUnit: null });
    expect(sourceSizeOf(157, 'cm')).toEqual({ unitSize: null, sizeUnit: null });
    expect(sourceSizeOf(5, 'metros')).toEqual({
      unitSize: null,
      sizeUnit: null,
    });
  });

  it('keeps the number of a word that is neither a unit nor a length', () => {
    expect(sourceSizeOf(3, 'paquete')).toEqual({ unitSize: 3, sizeUnit: null });
    expect(sourceSizeOf(750, null)).toEqual({ unitSize: 750, sizeUnit: null });
  });

  it('states no unit when there is no size', () => {
    expect(sourceSizeOf(null, 'kg')).toEqual({
      unitSize: null,
      sizeUnit: null,
    });
  });

  it('does not print a float the multiplication made', () => {
    expect(sourceSizeOf(37.5, 'cl')).toEqual({
      unitSize: 375,
      sizeUnit: UnitOfMeasure.MILLILITER,
    });
  });
});

describe('printedSizeUnit', () => {
  it('reads a catalog unit written out as itself', () => {
    expect(printedSizeUnit('MILLILITER')).toEqual({
      unit: UnitOfMeasure.MILLILITER,
      factor: 1,
    });
    expect(printedSizeUnit('milliliter')).toEqual({
      unit: UnitOfMeasure.MILLILITER,
      factor: 1,
    });
  });

  it('drops a trailing full stop', () => {
    expect(printedSizeUnit('l.')).toEqual({
      unit: UnitOfMeasure.LITER,
      factor: 1,
    });
  });

  it('answers null for a word that names no unit', () => {
    expect(printedSizeUnit('Paquete')).toBeNull();
    expect(printedSizeUnit('')).toBeNull();
    expect(printedSizeUnit(null)).toBeNull();
  });
});

describe('sourceSizeUnitOf', () => {
  it('accepts the five units a size is measured in and nothing else', () => {
    for (const unit of SOURCE_SIZE_UNITS) {
      expect(sourceSizeUnitOf(unit)).toBe(unit);
    }
    // A pack is counted by `packCount`, never measured in.
    expect(sourceSizeUnitOf(UnitOfMeasure.PACK)).toBeNull();
    expect(sourceSizeUnitOf('cl')).toBeNull();
    expect(sourceSizeUnitOf(null)).toBeNull();
  });
});

describe('what a printed unit word measures (plan 0183)', () => {
  it.each(['m', 'cm', 'mm', 'M', 'metros', 'm.'])('%p is a length', (word) => {
    expect(isPrintedLength(word)).toBe(true);
    expect(measuresContent(word)).toBe(false);
  });

  it.each(['cl', 'ml', 'l', 'g', 'kg', 'ud', 'lavados', 'rollos'])(
    '%p measures what is inside',
    (word) => {
      expect(measuresContent(word)).toBe(true);
      expect(isPrintedLength(word)).toBe(false);
    }
  );

  it('answers false twice for a word that is neither, and for none', () => {
    expect(measuresContent('tecla')).toBe(false);
    expect(isPrintedLength('tecla')).toBe(false);
    expect(measuresContent(null)).toBe(false);
    expect(isPrintedLength(undefined)).toBe(false);
  });
});

describe('toBaseUnit (plan 0183)', () => {
  it.each([
    [0.25, UnitOfMeasure.KILOGRAM, 250, UnitOfMeasure.GRAM],
    [1.5, UnitOfMeasure.LITER, 1500, UnitOfMeasure.MILLILITER],
    [0.4636, UnitOfMeasure.KILOGRAM, 463.6, UnitOfMeasure.GRAM],
    [500, UnitOfMeasure.GRAM, 500, UnitOfMeasure.GRAM],
    [330, UnitOfMeasure.MILLILITER, 330, UnitOfMeasure.MILLILITER],
    [16, UnitOfMeasure.UNIT, 16, UnitOfMeasure.UNIT],
    [6, UnitOfMeasure.PACK, 6, UnitOfMeasure.UNIT],
  ])('states %p %p as %p %p', (size, unit, unitSize, base) => {
    expect(toBaseUnit(size, unit)).toEqual({ unitSize, unit: base });
  });

  it('keeps a kilogram with no size, which is a product sold by weight', () => {
    expect(toBaseUnit(null, UnitOfMeasure.KILOGRAM)).toEqual({
      unitSize: null,
      unit: UnitOfMeasure.KILOGRAM,
    });
  });

  it('never answers a litre or a pack, sized or not', () => {
    expect(toBaseUnit(null, UnitOfMeasure.LITER)).toEqual({
      unitSize: null,
      unit: UnitOfMeasure.MILLILITER,
    });
    expect(toBaseUnit(undefined, UnitOfMeasure.PACK)).toEqual({
      unitSize: null,
      unit: UnitOfMeasure.UNIT,
    });
  });
});
