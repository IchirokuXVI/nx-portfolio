import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  ITEM_GRAMS_DETAIL,
  ITEM_UNIT_SIZE_DETAIL,
  ItemKilogramHasSizeException,
} from '@portfolio/luna-shopper/platform';
import type { SourceCatalogEntry } from '../entities';
import { createdSize, createdWeight } from './source-entry-size';

/**
 * The size a product created from a row is written with (plan 0183), the
 * weight it carries (plan 0244, section 5.6), and the one pair it refuses
 * (plan 0237, section 3.3). The service specs hold the
 * same rules through the two creation paths; this one holds them on the
 * function both paths call, where a case costs one line.
 */

type Row = Pick<
  SourceCatalogEntry,
  'unitSize' | 'sizeUnit' | 'sizeFormat' | 'soldByWeight' | 'approxWeight'
>;

const QUARTER_KILO: Row = {
  unitSize: 0.25,
  sizeUnit: UnitOfMeasure.KILOGRAM,
  sizeFormat: 'kg',
  soldByWeight: false,
  approxWeight: null,
};

const BY_WEIGHT: Row = {
  unitSize: null,
  sizeUnit: null,
  sizeFormat: 'kg',
  soldByWeight: true,
  approxWeight: null,
};

const row = (over: Partial<Row> = {}): Row => ({
  unitSize: null,
  sizeUnit: null,
  sizeFormat: null,
  soldByWeight: false,
  approxWeight: null,
  ...over,
});

function refusal(work: () => unknown): ItemKilogramHasSizeException {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(ItemKilogramHasSizeException);
    return error as ItemKilogramHasSizeException;
  }
  throw new Error('expected the pair to be refused');
}

describe('createdSize', () => {
  describe('the row decides, in a base unit (plan 0183)', () => {
    it('writes a row of 0.25 kg as 250 GRAM', () => {
      expect(createdSize(QUARTER_KILO, {})).toEqual({
        unitSize: 250,
        unit: UnitOfMeasure.GRAM,
        approxWeight: null,
      });
    });

    it('converts a size the request names with the row unit', () => {
      expect(createdSize(QUARTER_KILO, { unitSize: 0.5 })).toEqual({
        unitSize: 500,
        unit: UnitOfMeasure.GRAM,
        approxWeight: null,
      });
    });

    it('keeps KILOGRAM with no size for a row sold by weight', () => {
      expect(createdSize(BY_WEIGHT, {})).toEqual({
        unitSize: null,
        unit: UnitOfMeasure.KILOGRAM,
        approxWeight: null,
      });
    });

    it('expresses the row size in a named unit of the same kind', () => {
      expect(
        createdSize(QUARTER_KILO, { defaultUnit: UnitOfMeasure.GRAM })
      ).toEqual({
        unitSize: 250,
        unit: UnitOfMeasure.GRAM,
        approxWeight: null,
      });
    });

    it('writes a named size and unit as they were sent', () => {
      expect(
        createdSize(QUARTER_KILO, {
          unitSize: 1,
          defaultUnit: UnitOfMeasure.LITER,
        })
      ).toEqual({ unitSize: 1, unit: UnitOfMeasure.LITER, approxWeight: null });
    });
  });

  describe('a named KILOGRAM beside a size (plan 0237, section 3.3)', () => {
    it('refuses the pair with item_kilogram_has_size, naming the size and the grams', () => {
      const error = refusal(() =>
        createdSize(QUARTER_KILO, {
          unitSize: 400,
          defaultUnit: UnitOfMeasure.KILOGRAM,
        })
      );

      expect(error.code).toBe('item_kilogram_has_size');
      expect(error.details).toEqual({
        [ITEM_UNIT_SIZE_DETAIL]: 400,
        [ITEM_GRAMS_DETAIL]: 400_000,
      });
      expect(error.message).toContain('400000 GRAM');
    });

    it('refuses KILOGRAM named alone over a row that states a size', () => {
      // Before this rule the row's 0.25 kg was expressed in the named unit,
      // which made a sized KILOGRAM that catalog refused one hop later.
      const error = refusal(() =>
        createdSize(QUARTER_KILO, { defaultUnit: UnitOfMeasure.KILOGRAM })
      );

      expect(error.details).toEqual({
        [ITEM_UNIT_SIZE_DETAIL]: 0.25,
        [ITEM_GRAMS_DETAIL]: 250,
      });
    });

    it('refuses the pair over a row sold by weight too', () => {
      refusal(() =>
        createdSize(BY_WEIGHT, {
          unitSize: 2,
          defaultUnit: UnitOfMeasure.KILOGRAM,
        })
      );
    });

    it('passes KILOGRAM with a null size, which is a product sold by weight', () => {
      expect(
        createdSize(QUARTER_KILO, {
          unitSize: null,
          defaultUnit: UnitOfMeasure.KILOGRAM,
        })
      ).toEqual({
        unitSize: null,
        unit: UnitOfMeasure.KILOGRAM,
        approxWeight: null,
      });
    });

    it('passes KILOGRAM named alone over a row with no size', () => {
      expect(
        createdSize(
          { ...QUARTER_KILO, unitSize: null },
          { defaultUnit: UnitOfMeasure.KILOGRAM }
        )
      ).toEqual({
        unitSize: null,
        unit: UnitOfMeasure.KILOGRAM,
        approxWeight: null,
      });
    });

    it('still converts a named GRAM over the same row', () => {
      expect(
        createdSize(QUARTER_KILO, { defaultUnit: UnitOfMeasure.GRAM })
      ).toEqual({
        unitSize: 250,
        unit: UnitOfMeasure.GRAM,
        approxWeight: null,
      });
    });
  });

  describe('the weight of one piece (plan 0244, section 5.6)', () => {
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
      const size = createdSize(
        row({ sizeFormat: 'kg', approxWeight: 580 }),
        {}
      );

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
      ).toEqual({
        unitSize: null,
        unit: UnitOfMeasure.UNIT,
        approxWeight: 580,
      });
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
});
