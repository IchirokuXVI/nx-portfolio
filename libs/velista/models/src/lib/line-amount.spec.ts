// The mirror of `libs/luna-shopper/contracts/src/lib/units/line-amount.spec.ts`,
// the normative table of backend plan 0246 section 2 (velista plan 0182,
// criterion 2). A row changed there is changed here in the same series.
import {
  lineAmount,
  lineAmountProductOf,
  type LineAmountProduct,
} from './line-amount';
import { defaultQuantity, lineUnitOf } from './line-unit';

const RICE_500_G: LineAmountProduct = {
  kind: 'PACK',
  unit: 'GRAM',
  size: 500,
  approxWeight: null,
};
const MILK_1000_ML: LineAmountProduct = {
  kind: 'PACK',
  unit: 'MILLILITER',
  size: 1000,
  approxWeight: null,
};
const OIL_LEGACY_1_5_L: LineAmountProduct = {
  kind: 'PACK',
  unit: 'LITER',
  size: 1.5,
  approxWeight: null,
};
const EGGS_6: LineAmountProduct = {
  kind: 'PACK',
  unit: 'UNIT',
  size: 6,
  approxWeight: null,
};
const MELON_PIECE: LineAmountProduct = {
  kind: 'PACK',
  unit: 'UNIT',
  size: null,
  approxWeight: 1800,
};
const LOOSE_BANANAS: LineAmountProduct = {
  kind: 'BY_THE_KILO',
  unit: 'KILOGRAM',
  size: null,
  approxWeight: null,
};
const LOOSE_OLIVE_OIL: LineAmountProduct = {
  kind: 'BY_THE_LITRE',
  unit: 'LITER',
  size: null,
  approxWeight: null,
};
const BANANA_BUNCH: LineAmountProduct = {
  kind: 'KILO_PIECE',
  unit: 'KILOGRAM',
  size: null,
  approxWeight: 700,
};

const priced = (price: number | null, piecePrice: number | null = null) => ({
  price,
  piecePrice,
});

describe('lineAmount, the table of plan 0246 section 2', () => {
  it('UNIT, PACK: price × q, exact', () => {
    expect(lineAmount(3, 'UNIT', EGGS_6, priced(1.25))).toEqual({
      cents: 375,
      estimated: false,
      pieces: null,
    });
    // A pack sized in grams counted in packs is a count too.
    expect(lineAmount(2, 'UNIT', RICE_500_G, priced(1.2))).toEqual({
      cents: 240,
      estimated: false,
      pieces: null,
    });
    // A piece priced as one counted in pieces is the price of the piece.
    expect(lineAmount(1, 'UNIT', MELON_PIECE, priced(2.5))).toEqual({
      cents: 250,
      estimated: false,
      pieces: null,
    });
  });

  it('UNIT, KILO_PIECE: piecePrice × q, estimated', () => {
    expect(lineAmount(2, 'UNIT', BANANA_BUNCH, priced(1.99, 1.39))).toEqual({
      cents: 278,
      estimated: true,
      pieces: null,
    });
  });

  it('UNIT, BY_THE_KILO and BY_THE_LITRE: none', () => {
    expect(lineAmount(1, 'UNIT', LOOSE_BANANAS, priced(1.99))).toBeNull();
    expect(lineAmount(1, 'UNIT', LOOSE_OLIVE_OIL, priced(4))).toBeNull();
  });

  it('GRAM, BY_THE_KILO: price × q / 1000, estimated', () => {
    expect(lineAmount(750, 'GRAM', LOOSE_BANANAS, priced(1.99))).toEqual({
      cents: 149,
      estimated: true,
      pieces: null,
    });
  });

  it('GRAM, KILO_PIECE of weight w: piecePrice × ⌈q / w⌉, estimated, with the pieces', () => {
    expect(lineAmount(1000, 'GRAM', BANANA_BUNCH, priced(1.99, 1.39))).toEqual({
      cents: 278,
      estimated: true,
      pieces: 2,
    });
    expect(lineAmount(700, 'GRAM', BANANA_BUNCH, priced(1.99, 1.39))).toEqual({
      cents: 139,
      estimated: true,
      pieces: 1,
    });
  });

  it('GRAM, a PACK priced as one piece of weight w: price × ⌈q / w⌉, estimated, with the pieces', () => {
    expect(lineAmount(2000, 'GRAM', MELON_PIECE, priced(2.5))).toEqual({
      cents: 500,
      estimated: true,
      pieces: 2,
    });
  });

  it('GRAM, a PACK of base size s in grams: price × ⌈q / s⌉, exact, with the packs', () => {
    expect(lineAmount(1200, 'GRAM', RICE_500_G, priced(1.2))).toEqual({
      cents: 360,
      estimated: false,
      pieces: 3,
    });
  });

  it('MILLILITER, BY_THE_LITRE: price × q / 1000, estimated', () => {
    expect(lineAmount(750, 'MILLILITER', LOOSE_OLIVE_OIL, priced(4))).toEqual({
      cents: 300,
      estimated: true,
      pieces: null,
    });
  });

  it('MILLILITER, a PACK of base size s in millilitres: price × ⌈q / s⌉, exact, with the packs', () => {
    expect(lineAmount(1500, 'MILLILITER', MILK_1000_ML, priced(0.89))).toEqual({
      cents: 178,
      estimated: false,
      pieces: 2,
    });
    // A legacy LITER size is read in millilitres: 1.5 l is 1500 ml.
    expect(
      lineAmount(3000, 'MILLILITER', OIL_LEGACY_1_5_L, priced(6.5))
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
    expect(lineAmount(1000, unit, product, priced(1, 1))).toBeNull();
  });

  describe('a missing figure is a missing amount, never zero', () => {
    it('a kilo piece with a price and no piecePrice answers null', () => {
      expect(
        lineAmount(1, 'UNIT', BANANA_BUNCH, priced(1.99, null))
      ).toBeNull();
      expect(
        lineAmount(1000, 'GRAM', BANANA_BUNCH, priced(1.99, null))
      ).toBeNull();
    });

    it('no price answers null for every other kind', () => {
      expect(lineAmount(1, 'UNIT', EGGS_6, priced(null))).toBeNull();
      expect(lineAmount(500, 'GRAM', LOOSE_BANANAS, priced(null))).toBeNull();
      expect(lineAmount(500, 'GRAM', RICE_500_G, priced(null))).toBeNull();
    });

    it('a kilo piece with no weight cannot serve a weight', () => {
      expect(
        lineAmount(
          1000,
          'GRAM',
          { ...BANANA_BUNCH, approxWeight: null },
          priced(1.99, 1.39)
        )
      ).toBeNull();
    });

    it('a quantity that is not a number from zero answers null', () => {
      expect(lineAmount(-1, 'UNIT', EGGS_6, priced(1))).toBeNull();
      expect(lineAmount(Number.NaN, 'UNIT', EGGS_6, priced(1))).toBeNull();
    });
  });

  it('a stocked line, at zero, costs zero and serves no piece', () => {
    expect(lineAmount(0, 'GRAM', BANANA_BUNCH, priced(1.99, 1.39))).toEqual({
      cents: 0,
      estimated: true,
      pieces: 0,
    });
    expect(lineAmount(0, 'UNIT', EGGS_6, priced(1.25))).toEqual({
      cents: 0,
      estimated: false,
      pieces: null,
    });
  });

  describe('rounding', () => {
    it('rounds a weight up to whole pieces: 1000 g of a 700 g piece is 2', () => {
      expect(
        lineAmount(1000, 'GRAM', BANANA_BUNCH, priced(1.99, 1.39))?.pieces
      ).toBe(2);
      expect(
        lineAmount(701, 'GRAM', BANANA_BUNCH, priced(1.99, 1.39))?.pieces
      ).toBe(2);
      // A whole quotient stays whole.
      expect(lineAmount(1500, 'GRAM', RICE_500_G, priced(1))?.pieces).toBe(3);
    });

    it('rounds cents half up once, at the end: 9.95 per kilo × 500 g is 498, not 497', () => {
      expect(lineAmount(500, 'GRAM', LOOSE_BANANAS, priced(9.95))?.cents).toBe(
        498
      );
    });

    it('a settle of 750 g at 9.95 per kilo reads 746 (plan 0246 section 8, criterion 6)', () => {
      expect(lineAmount(750, 'GRAM', LOOSE_BANANAS, priced(9.95))?.cents).toBe(
        746
      );
    });
  });

  describe('the scenarios of W3: the cost of the amount orders the members', () => {
    const BUNCH_AT_1_39 = priced(1.99, 1.39);

    it('a 1000 g line: loose bananas at 1.99 come before two 700 g bunches at 2.78', () => {
      expect(lineAmount(1000, 'GRAM', LOOSE_BANANAS, priced(1.99))?.cents).toBe(
        199
      );
      expect(lineAmount(1000, 'GRAM', BANANA_BUNCH, BUNCH_AT_1_39)?.cents).toBe(
        278
      );
    });

    it('a 500 g line: loose at 1.00 still comes before one bunch at 1.39', () => {
      expect(lineAmount(500, 'GRAM', LOOSE_BANANAS, priced(1.99))?.cents).toBe(
        100
      );
      expect(lineAmount(500, 'GRAM', BANANA_BUNCH, BUNCH_AT_1_39)?.cents).toBe(
        139
      );
    });

    it('an 1800 g line: a 1.8 kg piece at 2.50 comes before loose at 1.49 per kilo (2.68)', () => {
      expect(lineAmount(1800, 'GRAM', MELON_PIECE, priced(2.5))?.cents).toBe(
        250
      );
      expect(lineAmount(1800, 'GRAM', LOOSE_BANANAS, priced(1.49))?.cents).toBe(
        268
      );
    });
  });
});

describe('lineUnitOf (velista 0182, criterion 2)', () => {
  it('weighs a product sold by the kilo and measures one sold by the litre', () => {
    expect(lineUnitOf('BY_THE_KILO')).toBe('GRAM');
    expect(lineUnitOf('BY_THE_LITRE')).toBe('MILLILITER');
  });

  it('counts a pack and a kilo piece', () => {
    expect(lineUnitOf('PACK')).toBe('UNIT');
    expect(lineUnitOf('KILO_PIECE')).toBe('UNIT');
  });
});

describe('defaultQuantity', () => {
  it('starts a count at one, a weight at a kilo and a volume at a litre', () => {
    expect(defaultQuantity('UNIT')).toBe(1);
    expect(defaultQuantity('GRAM')).toBe(1000);
    expect(defaultQuantity('MILLILITER')).toBe(1000);
  });
});

describe('lineAmountProductOf', () => {
  it('names the kind the way soldAs does', () => {
    expect(
      lineAmountProductOf({ unit: 'KILOGRAM', size: null, approxWeight: null })
    ).toEqual(LOOSE_BANANAS);
    expect(
      lineAmountProductOf({ unit: 'LITER', size: null, approxWeight: null })
    ).toEqual(LOOSE_OLIVE_OIL);
    expect(
      lineAmountProductOf({ unit: 'KILOGRAM', size: null, approxWeight: 700 })
    ).toEqual(BANANA_BUNCH);
    expect(
      lineAmountProductOf({ unit: 'GRAM', size: 500, approxWeight: null })
    ).toEqual(RICE_500_G);
  });
});
