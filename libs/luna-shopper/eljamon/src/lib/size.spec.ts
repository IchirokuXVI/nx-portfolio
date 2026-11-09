import { splitSize } from './size';

/**
 * One case per form the chain prints (plan 0169, section 6), plus the two the
 * capture of 2026-09-29 added: `pk-2` and `pza`. Literals, so a recapture of
 * the fixtures cannot rewrite them.
 */
describe('splitSize', () => {
  it.each([
    ['arroz bomba, 1kg', 'arroz bomba', '1kg', 1, null, false],
    [
      'crema fresca de calabaza, 330ml',
      'crema fresca de calabaza',
      '330ml',
      330,
      null,
      false,
    ],
    [
      'queso curado, 500g aprox.',
      'queso curado',
      '500g aprox.',
      500,
      null,
      false,
    ],
    ['aceite de oliva, 1,5l', 'aceite de oliva', '1,5l', 1.5, null, false],
    // Centilitres are written as millilitres (plan 0177): six cans of 33 cl.
    ['cerveza rubia, pk 6x33cl', 'cerveza rubia', 'pk 6x33cl', 1980, 6, false],
    ['yogur natural, pk 3', 'yogur natural', 'pk 3', null, 3, false],
    // The size of one unit is in the name, and the size is the pack's (plan
    // 0250, section 2.4). This read no size before.
    [
      'burger vacuno alta proteínas 130g, pk-2',
      'burger vacuno alta proteínas',
      '130g pk-2',
      260,
      2,
      false,
    ],
    ['lechuga iceberg, ud', 'lechuga iceberg', 'ud', null, null, false],
    ['bacon original, kg', 'bacon original', 'kg', null, null, true],
    [
      'jamón serrano gran reserva, pza',
      'jamón serrano gran reserva',
      'pza',
      null,
      null,
      false,
    ],
  ])('%s', (printed, name, sizeFormat, unitSize, packCount, soldByWeight) => {
    expect(splitSize(printed)).toMatchObject({
      name,
      sizeFormat,
      unitSize,
      packCount,
      soldByWeight,
    });
  });

  describe('the unit the number is in (plan 0177)', () => {
    it.each([
      ['vino tinto crianza, 75cl', '75cl', 750, 'MILLILITER'],
      ['cerveza rubia, pk 6x33cl', 'pk 6x33cl', 1980, 'MILLILITER'],
      ['aceite de oliva, 1,5l', '1,5l', 1.5, 'LITER'],
      ['arroz bomba, 1kg', '1kg', 1, 'KILOGRAM'],
      ['queso curado, 500g aprox.', '500g aprox.', 500, 'GRAM'],
      ['crema fresca de calabaza, 330ml', '330ml', 330, 'MILLILITER'],
      ['café en cápsulas, 16ud', '16ud', 16, 'UNIT'],
      ['detergente líquido, 40 lavados', '40 lavados', 40, 'UNIT'],
    ])('%s', (printed, sizeFormat, unitSize, sizeUnit) => {
      // The printed text is the key, and it is exactly what the chain wrote.
      expect(splitSize(printed)).toMatchObject({
        sizeFormat,
        unitSize,
        sizeUnit,
      });
    });

    describe('a length is a dimension, not a size (plan 0183)', () => {
      it('keeps the printed text and states no size for a roll', () => {
        expect(splitSize('papel de aluminio, 30m')).toMatchObject({
          sizeFormat: '30m',
          unitSize: null,
          sizeUnit: null,
          packCount: null,
        });
      });

      it.each([
        ['mantel rectangular, 125x157 cm', '125x157 cm'],
        ['sábana ajustable, 5x1.2 m', '5x1.2 m'],
        ['mantel rectangular, 125x157cm', '125x157cm'],
      ])('%p states no count and no size', (printed, sizeFormat) => {
        expect(splitSize(printed)).toMatchObject({
          sizeFormat,
          unitSize: null,
          sizeUnit: null,
          packCount: null,
          soldByWeight: false,
        });
      });

      it('still reads the count of a pack of cans', () => {
        expect(splitSize('cerveza rubia, 6x33 cl')).toMatchObject({
          sizeFormat: '6x33 cl',
          unitSize: 1980,
          sizeUnit: 'MILLILITER',
          packCount: 6,
        });
      });
    });

    it('states no unit where there is no number', () => {
      for (const printed of [
        'yogur natural, pk 3',
        'lechuga iceberg, ud',
        'bacon original, kg',
      ]) {
        expect(splitSize(printed)).toMatchObject({
          unitSize: null,
          sizeUnit: null,
        });
      }
    });
  });

  describe('a count field takes the size of one unit from the name (plan 0250, section 2.4)', () => {
    it('reads the paté as two tins of 75 g', () => {
      expect(splitSize('paté clásico 75g, pk-2')).toEqual({
        name: 'paté clásico',
        sizeFormat: '75g pk-2',
        unitSize: 150,
        sizeUnit: 'GRAM',
        packCount: 2,
        soldByWeight: false,
      });
    });

    it('reads the popcorn as three bags of 100 g', () => {
      expect(splitSize('palomitas mantequilla 100g, pk-3')).toEqual({
        name: 'palomitas mantequilla',
        sizeFormat: '100g pk-3',
        unitSize: 300,
        sizeUnit: 'GRAM',
        packCount: 3,
        soldByWeight: false,
      });
    });

    it.each([
      [
        'natillas de chocolate 125 g, pk 4',
        'natillas de chocolate',
        '125 g pk 4',
        500,
        'GRAM',
      ],
      [
        'zumo de naranja 200ml, pk-3',
        'zumo de naranja',
        '200ml pk-3',
        600,
        'MILLILITER',
      ],
      [
        'cerveza rubia 33cl, pk 6',
        'cerveza rubia',
        '33cl pk 6',
        1980,
        'MILLILITER',
      ],
      ['agua mineral 1,5l, pk-6', 'agua mineral', '1,5l pk-6', 9, 'LITER'],
    ])('%s', (printed, name, sizeFormat, unitSize, sizeUnit) => {
      expect(splitSize(printed)).toMatchObject({
        name,
        sizeFormat,
        unitSize,
        sizeUnit,
      });
    });

    it.each([
      // No size in the name: today's answer.
      ['yogur natural, pk 3', 'yogur natural', 'pk 3', 3],
      // The name states its count already, so which count the field's is
      // cannot be read.
      [
        'bacon en tiras family 2x100g, pk-2',
        'bacon en tiras family 2x100g',
        'pk-2',
        2,
      ],
      [
        'bacon en tiras family 2 x 100g, pk-2',
        'bacon en tiras family 2 x 100g',
        'pk-2',
        2,
      ],
      // A count is not a weight or a volume.
      ['tiritas infantiles 10ud, pk-2', 'tiritas infantiles 10ud', 'pk-2', 2],
      // A count of 1 is no pack, so nothing multiplies.
      ['paté clásico 75g, pk-1', 'paté clásico 75g', 'pk-1', null],
    ])(
      '%s keeps the count and states no size',
      (printed, name, sizeFormat, packCount) => {
        expect(splitSize(printed)).toMatchObject({
          name,
          sizeFormat,
          unitSize: null,
          sizeUnit: null,
          packCount,
        });
      }
    );
  });

  it('splits at the last comma, leaving earlier ones in the name', () => {
    expect(splitSize('patatas, fritas, 120g')).toMatchObject({
      name: 'patatas, fritas',
      sizeFormat: '120g',
    });
  });

  it('states no size for a name with no comma', () => {
    expect(splitSize('salmón ahumado suave 80g')).toEqual({
      name: 'salmón ahumado suave 80g',
      sizeFormat: null,
      unitSize: null,
      sizeUnit: null,
      packCount: null,
      soldByWeight: false,
    });
  });
});
