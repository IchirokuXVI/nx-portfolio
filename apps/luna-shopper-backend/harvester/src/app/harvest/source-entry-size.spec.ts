import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import type { SourceCatalogEntry } from '../entities';
import { createdSize, createdWeight } from './source-entry-size';

/**
 * The size, the unit and the weight a product created from a row is written
 * with (plans 0183, 0181 and 0244, section 5.6). Both creation paths call it.
 */

type Row = Pick<
  SourceCatalogEntry,
  'unitSize' | 'sizeUnit' | 'sizeFormat' | 'soldByWeight' | 'approxWeight'
>;

const row = (over: Partial<Row> = {}): Row => ({
  unitSize: null,
  sizeUnit: null,
  sizeFormat: null,
  soldByWeight: false,
  approxWeight: null,
  ...over,
});

describe('createdSize', () => {
  it('answers KILOGRAM and the weight for a row sold by weight', () => {
    const size = createdSize(
      row({
        sizeFormat: 'kg',
        soldByWeight: true,
        approxWeight: '1540.0000' as unknown as number,
      }),
      {}
    );

    expect(size).toEqual({
      unitSize: null,
      unit: UnitOfMeasure.KILOGRAM,
      approxWeight: 1540,
    });
    expect(createdWeight(size)).toEqual({
      approxWeight: 1540,
      approxWeightSetBy: 'SOURCE',
    });
  });

  it('answers UNIT and the weight for a row with a weight that is not sold by weight', () => {
    // 60226, the ensaladilla priced as one piece. Printed `kg`, it used to
    // become a product sold by the kilo through `toBaseUnit(null, KILOGRAM)`.
    const size = createdSize(row({ sizeFormat: 'kg', approxWeight: 580 }), {});

    expect(size).toEqual({
      unitSize: null,
      unit: UnitOfMeasure.UNIT,
      approxWeight: 580,
    });
    expect(createdWeight(size)).toEqual({
      approxWeight: 580,
      approxWeightSetBy: 'SOURCE',
    });
  });

  it('treats a size named as null as naming none', () => {
    expect(
      createdSize(row({ sizeFormat: 'kg', approxWeight: 580 }), {
        unitSize: null,
      })
    ).toEqual({ unitSize: null, unit: UnitOfMeasure.UNIT, approxWeight: 580 });
  });

  it('sends no weight when the operation names a size or a unit', () => {
    const piece = row({ sizeFormat: 'kg', approxWeight: 580 });

    const named = createdSize(piece, {
      unitSize: 580,
      defaultUnit: UnitOfMeasure.GRAM,
    });
    expect(named).toEqual({
      unitSize: 580,
      unit: UnitOfMeasure.GRAM,
      approxWeight: null,
    });
    expect(createdWeight(named)).toEqual({});

    const unit = createdSize(
      row({ sizeFormat: 'kg', soldByWeight: true, approxWeight: 1540 }),
      { defaultUnit: UnitOfMeasure.UNIT }
    );
    expect(unit.approxWeight).toBeNull();
  });

  it('answers a sized row as before, with no weight', () => {
    const size = createdSize(
      row({
        unitSize: 0.25,
        sizeUnit: UnitOfMeasure.KILOGRAM,
        sizeFormat: 'kg',
      }),
      {}
    );

    expect(size).toEqual({
      unitSize: 250,
      unit: UnitOfMeasure.GRAM,
      approxWeight: null,
    });
    expect(createdWeight(size)).toEqual({});
  });

  it('answers a row sold by weight with no weight as KILOGRAM and no weight', () => {
    const size = createdSize(row({ soldByWeight: true }), {});

    expect(size).toEqual({
      unitSize: null,
      unit: UnitOfMeasure.KILOGRAM,
      approxWeight: null,
    });
    expect(createdWeight(size)).toEqual({});
  });
});
