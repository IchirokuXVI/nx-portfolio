import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import { parseSize } from './size';

/**
 * Every string here was printed by the live assortment on 2026-09-06 (plan
 * 0089, section 12). The irregular ones are the reason this parser is a file of
 * its own.
 */
describe('parseSize', () => {
  it('reads a number and a unit', () => {
    expect(parseSize('500 g')).toEqual({
      unitSize: 500,
      unit: UnitOfMeasure.GRAM,
      count: 1,
      approximate: false,
    });
    expect(parseSize('1 kg')?.unit).toBe(UnitOfMeasure.KILOGRAM);
    expect(parseSize('1kg')?.unitSize).toBe(1);
    expect(parseSize('250 ml')?.unit).toBe(UnitOfMeasure.MILLILITER);
    expect(parseSize('1,3 l')).toMatchObject({
      unitSize: 1.3,
      unit: UnitOfMeasure.LITER,
    });
  });

  it('converts centilitres to the unit the enum holds', () => {
    expect(parseSize('33cl')).toMatchObject({
      unitSize: 330,
      unit: UnitOfMeasure.MILLILITER,
    });
  });

  it('states a multipack as one pack, and keeps the count', () => {
    // `6x200ml` is 1200 millilitres, because that is what the price on it buys.
    expect(parseSize('6x200ml')).toEqual({
      unitSize: 1200,
      unit: UnitOfMeasure.MILLILITER,
      count: 6,
      approximate: false,
    });
    expect(parseSize('4x 300 g')).toMatchObject({ unitSize: 1200, count: 4 });
    expect(parseSize('4x1 / l')).toMatchObject({
      unitSize: 4,
      unit: UnitOfMeasure.LITER,
      count: 4,
    });
  });

  it('reads the separator the chain prints between number and unit', () => {
    expect(parseSize('350 / g')).toMatchObject({
      unitSize: 350,
      unit: UnitOfMeasure.GRAM,
    });
  });

  it('marks a weight the chain does not promise exactly', () => {
    expect(parseSize('Aprox. 950g')).toEqual({
      unitSize: 950,
      unit: UnitOfMeasure.GRAM,
      count: 1,
      approximate: true,
    });
    expect(parseSize('Aprox. 700 g')?.approximate).toBe(true);
  });

  it('reads a bare unit as one of it', () => {
    expect(parseSize('Ud')).toMatchObject({
      unitSize: 1,
      unit: UnitOfMeasure.UNIT,
    });
    expect(parseSize('3 uds')?.unitSize).toBe(3);
  });

  it('states no size rather than a wrong one', () => {
    // `Paquete` is a word and not a size, and a range names two numbers of
    // which neither is the size of the pack.
    expect(parseSize('Paquete')).toBeNull();
    expect(parseSize('Aprox. 0,8-1,2kg')).toBeNull();
    expect(parseSize('ca. 400-600g')).toBeNull();
    expect(parseSize('1stueck')).toBeNull();
    expect(parseSize('')).toBeNull();
    expect(parseSize(null)).toBeNull();
  });
});
