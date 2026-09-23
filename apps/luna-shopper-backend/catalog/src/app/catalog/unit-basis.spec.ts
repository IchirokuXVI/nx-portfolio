import { UNIT_BASES, type UnitBasis } from '@portfolio/luna-shopper/contracts';
import { unitBasisOf } from './unit-basis';

/**
 * The label table (plan 0157, section 1).
 *
 * The first table is every distinct `unitPriceLabel` found in the plan 0150
 * catalog, across `supermarket_items` and `item_prices`, written exactly as
 * stored, with its row count there. A label that appears in a real catalog and
 * is missing here is a gap in this spec.
 */
describe('unitBasisOf', () => {
  it.each<[label: string, rows: number, basis: UnitBasis | null]>([
    ['kg', 2767, 'KILOGRAM'],
    ['ud', 1615, 'UNIT'],
    ['L', 1182, 'LITER'],
    ['100 ml', 633, 'LITER'],
    ['el litro le sale a', 164, 'LITER'],
    ['el kilo le sale a', 92, 'KILOGRAM'],
    ['lv', 72, 'WASH'],
    ['100 g', 60, 'KILOGRAM'],
    ['dc', 18, 'DOZEN'],
    // Metres of foil or film: no basis names a metre, so nothing is guessed.
    ['m', 6, null],
    ['dz', 3, 'DOZEN'],
    ['', 49, null],
  ])('reads %p (%i rows) as %p', (label, _rows, basis) => {
    expect(unitBasisOf(label)).toBe(basis);
  });

  it.each<[label: string, basis: UnitBasis]>([
    ['kilo', 'KILOGRAM'],
    ['litro', 'LITER'],
    ['unidad', 'UNIT'],
    ['docena', 'DOZEN'],
    ['lavado', 'WASH'],
  ])('reads the plan own spelling %p as %p', (label, basis) => {
    expect(unitBasisOf(label)).toBe(basis);
  });

  it('lowercases and trims before it looks', () => {
    expect(unitBasisOf('  El Litro Le Sale A ')).toBe('LITER');
    expect(unitBasisOf('KG')).toBe('KILOGRAM');
  });

  it('answers null for no label, and for a label it does not know', () => {
    expect(unitBasisOf(null)).toBeNull();
    expect(unitBasisOf(undefined)).toBeNull();
    expect(unitBasisOf('per 100 g drained')).toBeNull();
    // Not a function off the prototype.
    expect(unitBasisOf('constructor')).toBeNull();
    expect(unitBasisOf('toString')).toBeNull();
  });

  it('only ever answers a basis the contract names', () => {
    const labels = ['kg', 'l', 'ud', 'dz', 'lv', '100 ml', '100 g'];
    for (const label of labels) {
      expect(UNIT_BASES).toContain(unitBasisOf(label));
    }
  });
});
