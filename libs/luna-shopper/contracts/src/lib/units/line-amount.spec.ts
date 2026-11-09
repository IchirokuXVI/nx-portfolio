// The normative table of plan 0246 section 2. Velista mirrors it row for row
// in `libs/velista/models/src/lib/line-amount.spec.ts` (velista plan 0182), and
// a row changed here is changed there in the same series.
import { UnitOfMeasure } from '../enums/catalog.enums';
import {
  lineAmountOf,
  type LineAmountProduct,
  priceOfOne,
} from './line-amount';

const RICE_500_G: LineAmountProduct = {
  kind: 'PACK',
  defaultUnit: UnitOfMeasure.GRAM,
  unitSize: 500,
  approxWeight: null,
};
const MILK_1000_ML: LineAmountProduct = {
  kind: 'PACK',
  defaultUnit: UnitOfMeasure.MILLILITER,
  unitSize: 1000,
  approxWeight: null,
};
const OIL_LEGACY_1_5_L: LineAmountProduct = {
  kind: 'PACK',
  defaultUnit: UnitOfMeasure.LITER,
  unitSize: 1.5,
  approxWeight: null,
};
const EGGS_6: LineAmountProduct = {
  kind: 'PACK',
  defaultUnit: UnitOfMeasure.UNIT,
  unitSize: 6,
  approxWeight: null,
};
const MELON_PIECE: LineAmountProduct = {
  kind: 'PACK',
  defaultUnit: UnitOfMeasure.UNIT,
  unitSize: null,
  approxWeight: 1800,
};
const LOOSE_BANANAS: LineAmountProduct = {
  kind: 'BY_THE_KILO',
  defaultUnit: UnitOfMeasure.KILOGRAM,
  unitSize: null,
  approxWeight: null,
};
const LOOSE_OLIVE_OIL: LineAmountProduct = {
  kind: 'BY_THE_LITRE',
  defaultUnit: UnitOfMeasure.LITER,
  unitSize: null,
  approxWeight: null,
};
const BANANA_BUNCH: LineAmountProduct = {
  kind: 'KILO_PIECE',
  defaultUnit: UnitOfMeasure.KILOGRAM,
  unitSize: null,
  approxWeight: 700,
};

const priced = (price: number | null, piecePrice: number | null = null) => ({
  price,
  piecePrice,
});

describe('lineAmountOf, the table of plan 0246 section 2', () => {
  it('UNIT, PACK: price × q, exact', () => {
    expect(lineAmountOf(3, 'UNIT', EGGS_6, priced(1.25))).toEqual({
      cents: 375,
      estimated: false,
      pieces: null,
    });
    // A pack sized in grams counted in packs is a count too.
    expect(lineAmountOf(2, 'UNIT', RICE_500_G, priced(1.2))).toEqual({
      cents: 240,
      estimated: false,
      pieces: null,
    });
    // A piece priced as one counted in pieces is the price of the piece.
    expect(lineAmountOf(1, 'UNIT', MELON_PIECE, priced(2.5))).toEqual({
      cents: 250,
      estimated: false,
      pieces: null,
    });
  });

  it('UNIT, KILO_PIECE: piecePrice × q, estimated', () => {
    expect(lineAmountOf(2, 'UNIT', BANANA_BUNCH, priced(1.99, 1.39))).toEqual({
      cents: 278,
      estimated: true,
      pieces: null,
    });
  });

  it('UNIT, BY_THE_KILO and BY_THE_LITRE: none', () => {
    expect(lineAmountOf(1, 'UNIT', LOOSE_BANANAS, priced(1.99))).toBeNull();
    expect(lineAmountOf(1, 'UNIT', LOOSE_OLIVE_OIL, priced(4))).toBeNull();
  });

  it('GRAM, BY_THE_KILO: price × q / 1000, estimated', () => {
    expect(lineAmountOf(750, 'GRAM', LOOSE_BANANAS, priced(1.99))).toEqual({
      cents: 149,
      estimated: true,
      pieces: null,
    });
  });

  it('GRAM, KILO_PIECE of weight w: piecePrice × ⌈q / w⌉, estimated, with the pieces', () => {
    expect(
      lineAmountOf(1000, 'GRAM', BANANA_BUNCH, priced(1.99, 1.39))
    ).toEqual({ cents: 278, estimated: true, pieces: 2 });
    expect(lineAmountOf(700, 'GRAM', BANANA_BUNCH, priced(1.99, 1.39))).toEqual(
      { cents: 139, estimated: true, pieces: 1 }
    );
  });

  it('GRAM, a PACK priced as one piece of weight w: price × ⌈q / w⌉, estimated, with the pieces', () => {
    expect(lineAmountOf(2000, 'GRAM', MELON_PIECE, priced(2.5))).toEqual({
      cents: 500,
      estimated: true,
      pieces: 2,
    });
  });

  it('GRAM, a PACK of base size s in grams: price × ⌈q / s⌉, exact, with the packs', () => {
    expect(lineAmountOf(1200, 'GRAM', RICE_500_G, priced(1.2))).toEqual({
      cents: 360,
      estimated: false,
      pieces: 3,
    });
  });

  it('MILLILITER, BY_THE_LITRE: price × q / 1000, estimated', () => {
    expect(lineAmountOf(750, 'MILLILITER', LOOSE_OLIVE_OIL, priced(4))).toEqual(
      { cents: 300, estimated: true, pieces: null }
    );
  });

  it('MILLILITER, a PACK of base size s in millilitres: price × ⌈q / s⌉, exact, with the packs', () => {
    expect(
      lineAmountOf(1500, 'MILLILITER', MILK_1000_ML, priced(0.89))
    ).toEqual({ cents: 178, estimated: false, pieces: 2 });
    // A legacy LITER size is read in millilitres: 1.5 l is 1500 ml.
    expect(
      lineAmountOf(3000, 'MILLILITER', OIL_LEGACY_1_5_L, priced(6.5))
    ).toEqual({ cents: 1300, estimated: false, pieces: 2 });
  });

  it.each([
    ['GRAM', 'a product by the litre', LOOSE_OLIVE_OIL],
    ['GRAM', 'a counted pack', EGGS_6],
    ['GRAM', 'a pack in millilitres', MILK_1000_ML],
    ['MILLILITER', 'a product by the kilo', LOOSE_BANANAS],
    ['MILLILITER', 'a kilo piece', BANANA_BUNCH],
    ['MILLILITER', 'a piece priced as one', MELON_PIECE],
    ['MILLILITER', 'a pack in grams', RICE_500_G],
  ] as const)('%s with %s: none, any other pairing', (unit, _name, product) => {
    expect(lineAmountOf(1000, unit, product, priced(1, 1))).toBeNull();
  });

  describe('a missing figure is a missing amount, never zero', () => {
    it('a kilo piece with a price and no piecePrice answers null', () => {
      expect(
        lineAmountOf(1, 'UNIT', BANANA_BUNCH, priced(1.99, null))
      ).toBeNull();
      expect(
        lineAmountOf(1000, 'GRAM', BANANA_BUNCH, priced(1.99, null))
      ).toBeNull();
    });

    it('no price answers null for every other kind', () => {
      expect(lineAmountOf(1, 'UNIT', EGGS_6, priced(null))).toBeNull();
      expect(lineAmountOf(500, 'GRAM', LOOSE_BANANAS, priced(null))).toBeNull();
      expect(lineAmountOf(500, 'GRAM', RICE_500_G, priced(null))).toBeNull();
    });

    it('a kilo piece with no weight cannot serve a weight', () => {
      expect(
        lineAmountOf(
          1000,
          'GRAM',
          { ...BANANA_BUNCH, approxWeight: null },
          priced(1.99, 1.39)
        )
      ).toBeNull();
    });

    it('a quantity that is not a number from zero answers null', () => {
      expect(lineAmountOf(-1, 'UNIT', EGGS_6, priced(1))).toBeNull();
      expect(lineAmountOf(Number.NaN, 'UNIT', EGGS_6, priced(1))).toBeNull();
    });
  });

  it('a stocked line, at zero, costs zero and serves no piece', () => {
    expect(lineAmountOf(0, 'GRAM', BANANA_BUNCH, priced(1.99, 1.39))).toEqual({
      cents: 0,
      estimated: true,
      pieces: 0,
    });
    expect(lineAmountOf(0, 'UNIT', EGGS_6, priced(1.25))).toEqual({
      cents: 0,
      estimated: false,
      pieces: null,
    });
  });

  describe('rounding', () => {
    it('rounds a weight up to whole pieces: 1000 g of a 700 g piece is 2', () => {
      expect(
        lineAmountOf(1000, 'GRAM', BANANA_BUNCH, priced(1.99, 1.39))?.pieces
      ).toBe(2);
      expect(
        lineAmountOf(701, 'GRAM', BANANA_BUNCH, priced(1.99, 1.39))?.pieces
      ).toBe(2);
      // A whole quotient stays whole.
      expect(lineAmountOf(1500, 'GRAM', RICE_500_G, priced(1))?.pieces).toBe(3);
    });

    it('rounds cents half up once, at the end: 9.95 per kilo × 500 g is 498, not 497', () => {
      expect(
        lineAmountOf(500, 'GRAM', LOOSE_BANANAS, priced(9.95))?.cents
      ).toBe(498);
    });

    it('a settle of 750 g at 9.95 per kilo reads 746 (plan 0246 section 8, criterion 6)', () => {
      expect(
        lineAmountOf(750, 'GRAM', LOOSE_BANANAS, priced(9.95))?.cents
      ).toBe(746);
    });
  });

  describe('the scenarios of W3: the cost of the amount orders the members', () => {
    const BUNCH_AT_1_39 = priced(1.99, 1.39);

    it('a 1000 g line: loose bananas at 1.99 come before two 700 g bunches at 2.78', () => {
      expect(
        lineAmountOf(1000, 'GRAM', LOOSE_BANANAS, priced(1.99))?.cents
      ).toBe(199);
      expect(
        lineAmountOf(1000, 'GRAM', BANANA_BUNCH, BUNCH_AT_1_39)?.cents
      ).toBe(278);
    });

    it('a 500 g line: loose at 1.00 still comes before one bunch at 1.39', () => {
      expect(
        lineAmountOf(500, 'GRAM', LOOSE_BANANAS, priced(1.99))?.cents
      ).toBe(100);
      expect(
        lineAmountOf(500, 'GRAM', BANANA_BUNCH, BUNCH_AT_1_39)?.cents
      ).toBe(139);
    });

    it('an 1800 g line: a 1.8 kg piece at 2.50 comes before loose at 1.49 per kilo (2.68)', () => {
      expect(lineAmountOf(1800, 'GRAM', MELON_PIECE, priced(2.5))?.cents).toBe(
        250
      );
      expect(
        lineAmountOf(1800, 'GRAM', LOOSE_BANANAS, priced(1.49))?.cents
      ).toBe(268);
    });
  });
});

describe('priceOfOne (plan 0246 W3)', () => {
  it('is the price of the pack for a PACK', () => {
    expect(priceOfOne({ kind: 'PACK' }, priced(1.25))).toBe(1.25);
  });

  it('is the price of one kilo for BY_THE_KILO', () => {
    expect(priceOfOne({ kind: 'BY_THE_KILO' }, priced(1.99))).toBe(1.99);
  });

  it('is the price of one litre for BY_THE_LITRE', () => {
    expect(priceOfOne({ kind: 'BY_THE_LITRE' }, priced(4))).toBe(4);
  });

  it('is the piece price for a KILO_PIECE, and never the price of a kilo', () => {
    expect(priceOfOne({ kind: 'KILO_PIECE' }, priced(1.99, 1.39))).toBe(1.39);
    expect(priceOfOne({ kind: 'KILO_PIECE' }, priced(1.99, null))).toBeNull();
  });

  it('is null when the offer has no price', () => {
    expect(priceOfOne({ kind: 'PACK' }, priced(null))).toBeNull();
  });
});
