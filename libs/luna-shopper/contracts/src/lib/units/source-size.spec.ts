import { UnitOfMeasure } from '../enums/catalog.enums';
import {
  printedSizeUnit,
  SOURCE_SIZE_UNITS,
  sourceSizeOf,
  sourceSizeUnitOf,
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

  it('keeps the number and states no unit for a length', () => {
    expect(sourceSizeOf(30, 'm')).toEqual({ unitSize: 30, sizeUnit: null });
    expect(sourceSizeOf(157, 'cm')).toEqual({ unitSize: 157, sizeUnit: null });
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
