import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  ITEM_GRAMS_DETAIL,
  ITEM_UNIT_SIZE_DETAIL,
  ItemKilogramHasSizeException,
} from '@portfolio/luna-shopper/platform';
import type { SourceCatalogEntry } from '../entities';
import { createdSize } from './source-entry-size';

/**
 * The size a product created from a row is written with (plan 0183), and the
 * one pair it refuses (plan 0237, section 3.3). The service specs hold the
 * same rules through the two creation paths; this one holds them on the
 * function both paths call, where a case costs one line.
 */

type Row = Pick<
  SourceCatalogEntry,
  'unitSize' | 'sizeUnit' | 'sizeFormat' | 'soldByWeight'
>;

const QUARTER_KILO: Row = {
  unitSize: 0.25,
  sizeUnit: UnitOfMeasure.KILOGRAM,
  sizeFormat: 'kg',
  soldByWeight: false,
};

const BY_WEIGHT: Row = {
  unitSize: null,
  sizeUnit: null,
  sizeFormat: 'kg',
  soldByWeight: true,
};

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
      });
    });

    it('converts a size the request names with the row unit', () => {
      expect(createdSize(QUARTER_KILO, { unitSize: 0.5 })).toEqual({
        unitSize: 500,
        unit: UnitOfMeasure.GRAM,
      });
    });

    it('keeps KILOGRAM with no size for a row sold by weight', () => {
      expect(createdSize(BY_WEIGHT, {})).toEqual({
        unitSize: null,
        unit: UnitOfMeasure.KILOGRAM,
      });
    });

    it('expresses the row size in a named unit of the same kind', () => {
      expect(
        createdSize(QUARTER_KILO, { defaultUnit: UnitOfMeasure.GRAM })
      ).toEqual({ unitSize: 250, unit: UnitOfMeasure.GRAM });
    });

    it('writes a named size and unit as they were sent', () => {
      expect(
        createdSize(QUARTER_KILO, {
          unitSize: 1,
          defaultUnit: UnitOfMeasure.LITER,
        })
      ).toEqual({ unitSize: 1, unit: UnitOfMeasure.LITER });
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
      ).toEqual({ unitSize: null, unit: UnitOfMeasure.KILOGRAM });
    });

    it('passes KILOGRAM named alone over a row with no size', () => {
      expect(
        createdSize(
          { ...QUARTER_KILO, unitSize: null },
          { defaultUnit: UnitOfMeasure.KILOGRAM }
        )
      ).toEqual({ unitSize: null, unit: UnitOfMeasure.KILOGRAM });
    });

    it('still converts a named GRAM over the same row', () => {
      expect(
        createdSize(QUARTER_KILO, { defaultUnit: UnitOfMeasure.GRAM })
      ).toEqual({ unitSize: 250, unit: UnitOfMeasure.GRAM });
    });
  });
});
