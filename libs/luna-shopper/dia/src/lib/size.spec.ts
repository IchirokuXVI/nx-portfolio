import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseListing } from './listing';
import { splitSize } from './size';

/**
 * Real names, read from the fixtures on 2026-10-02 and written here so that a
 * recapture cannot rewrite the table (plan 0174, section 11).
 *
 * `[printed, name, sizeFormat, unitSize, packCount, approximate]`
 */
const NAMES: ReadonlyArray<
  [string, string, string, number, number | null, boolean]
> = [
  ['Coca-Cola 2 L', 'Coca-Cola', '2 L', 2, null, false],
  ['Coca-Cola 330 ml', 'Coca-Cola', '330 ml', 330, null, false],
  ['Coca-Cola 2 x 2 L', 'Coca-Cola', '2 x 2 L', 4, 2, false],
  ['Coca-Cola 12 x 330 ml', 'Coca-Cola', '12 x 330 ml', 3960, 12, false],
  ['Coca-Cola 1,25 L', 'Coca-Cola', '1,25 L', 1.25, null, false],
  ['Coca-Cola 2 x 1,25 L', 'Coca-Cola', '2 x 1,25 L', 2.5, 2, false],
  ['Coca-Cola mini 6 x 200 ml', 'Coca-Cola mini', '6 x 200 ml', 1200, 6, false],
  ['Coca-Cola light 2 L', 'Coca-Cola light', '2 L', 2, null, false],
  ['Coca-Cola 500 ml', 'Coca-Cola', '500 ml', 500, null, false],
  [
    'Coca-Cola zero azúcar zero cafeína 12 x 330 ml',
    'Coca-Cola zero azúcar zero cafeína',
    '12 x 330 ml',
    3960,
    12,
    false,
  ],
  ['Pepsi 1,75 L', 'Pepsi', '1,75 L', 1.75, null, false],
  ['Pepsi 2 x 1,75 L', 'Pepsi', '2 x 1,75 L', 3.5, 2, false],
  ['Pepsi 1 L', 'Pepsi', '1 L', 1, null, false],
  ['Green cola zero 330 ml', 'Green cola zero', '330 ml', 330, null, false],
  [
    'Refresco de cola zero Dia Hola Cola pack 4 x 2 L',
    'Refresco de cola zero Dia Hola Cola',
    'pack 4 x 2 L',
    8,
    4,
    false,
  ],
  [
    'Refresco de cola zero sin cafeína Dia Hola Cola 6 x 330 ml',
    'Refresco de cola zero sin cafeína Dia Hola Cola',
    '6 x 330 ml',
    1980,
    6,
    false,
  ],
  [
    'Refresco de cola zero Dia Hola Cola 6 x 500 ml',
    'Refresco de cola zero Dia Hola Cola',
    '6 x 500 ml',
    3000,
    6,
    false,
  ],
  ['Agua mineral Dia 1,5 L', 'Agua mineral Dia', '1,5 L', 1.5, null, false],
  ['Agua mineral Dia 5 L', 'Agua mineral Dia', '5 L', 5, null, false],
  [
    'Agua mineral muy débil Dia pack 6 x 1,5 L',
    'Agua mineral muy débil Dia',
    'pack 6 x 1,5 L',
    9,
    6,
    false,
  ],
  [
    'Agua mineral con gas Dia pack 6 x 500 ml',
    'Agua mineral con gas Dia',
    'pack 6 x 500 ml',
    3000,
    6,
    false,
  ],
  [
    'Agua mineral Font Vella 6,25 L',
    'Agua mineral Font Vella',
    '6,25 L',
    6.25,
    null,
    false,
  ],
  [
    'Agua mineral Fuente Primavera pack 6 x 1 L',
    'Agua mineral Fuente Primavera',
    'pack 6 x 1 L',
    6,
    6,
    false,
  ],
  ['Manzana roja dulce 1 Kg', 'Manzana roja dulce', '1 Kg', 1, null, false],
  [
    'Pera conferencia bandeja 700 g',
    'Pera conferencia bandeja',
    '700 g',
    700,
    null,
    false,
  ],
  [
    'Manzana Golden granel 500 g aprox.',
    'Manzana Golden granel',
    '500 g aprox.',
    500,
    null,
    true,
  ],
  [
    'Manzana reineta granel 1 Kg aprox.',
    'Manzana reineta granel',
    '1 Kg aprox.',
    1,
    null,
    true,
  ],
  [
    'Pera D.O.P. Rincon de soto granel 800 g aprox.',
    'Pera D.O.P. Rincon de soto granel',
    '800 g aprox.',
    800,
    null,
    true,
  ],
  [
    'Pechuga de pollo entera formato familiar Selección de Dia 1.3 Kg aprox.',
    'Pechuga de pollo entera formato familiar Selección de Dia',
    '1.3 Kg aprox.',
    1.3,
    null,
    true,
  ],
  [
    'Pollo entero Selección de Dia 2.1 Kg aprox.',
    'Pollo entero Selección de Dia',
    '2.1 Kg aprox.',
    2.1,
    null,
    true,
  ],
  [
    'Pollo para asar 2 unidades Selección de Dia 2 Kg',
    'Pollo para asar 2 unidades Selección de Dia',
    '2 Kg',
    2,
    null,
    false,
  ],
  [
    'Longaniza de pollo Selección de Dia 400 g',
    'Longaniza de pollo Selección de Dia',
    '400 g',
    400,
    null,
    false,
  ],
  [
    'Pechugas fileteadas Selección de Dia bandeja 650 g aprox.',
    'Pechugas fileteadas Selección de Dia bandeja',
    '650 g aprox.',
    650,
    null,
    true,
  ],
];

describe('splitSize', () => {
  it('holds at least thirty real names', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(30);
  });

  it.each(NAMES)(
    'splits %s',
    (printed, name, sizeFormat, unitSize, packCount, approximate) => {
      expect(splitSize(printed)).toMatchObject({
        name,
        sizeFormat,
        unitSize,
        packCount,
        approximate,
      });
    }
  );

  describe('the unit the number is in (plan 0177)', () => {
    it.each([
      // DIA prints no centilitre in the captured fixtures, and the parser reads
      // one the way every adapter does: as ten millilitres.
      ['Vino tinto crianza 75 cl', '75 cl', 750, 'MILLILITER'],
      ['Cerveza especial 6 x 33 cl', '6 x 33 cl', 1980, 'MILLILITER'],
      ['Coca-Cola 2 L', '2 L', 2, 'LITER'],
      ['Agua mineral Dia pack 6 x 1,5 L', 'pack 6 x 1,5 L', 9, 'LITER'],
      ['Coca-Cola 330 ml', '330 ml', 330, 'MILLILITER'],
      ['Manzana roja dulce 1 Kg', '1 Kg', 1, 'KILOGRAM'],
      ['Pera conferencia bandeja 700 g', '700 g', 700, 'GRAM'],
      ['Café en cápsulas Dia 16 ud', '16 ud', 16, 'UNIT'],
    ])('%s', (printed, sizeFormat, unitSize, sizeUnit) => {
      // The printed text is the key, and it is exactly what the chain wrote.
      expect(splitSize(printed)).toMatchObject({
        sizeFormat,
        unitSize,
        sizeUnit,
      });
    });

    it('keeps a length as printed and states no size for it (plan 0183)', () => {
      expect(splitSize('Papel de aluminio Dia 30 m')).toMatchObject({
        sizeFormat: '30 m',
        unitSize: null,
        sizeUnit: null,
      });
    });
  });

  describe('a pack count needs a unit of content (plan 0183)', () => {
    // No captured fixture prints a dimension, so these are written from the
    // shapes the format allows.
    it.each([
      ['Papel de horno Dia 2 x 30 m', 'Papel de horno Dia', '2 x 30 m'],
      ['Mantel de papel Dia 60 x 40 cm', 'Mantel de papel Dia', '60 x 40 cm'],
      ['Papel film Dia pack 2 x 30 m', 'Papel film Dia', 'pack 2 x 30 m'],
    ])('%s is one object and no pack', (printed, name, sizeFormat) => {
      expect(splitSize(printed)).toEqual({
        name,
        // The printed text is the key, and it is exactly what the chain wrote.
        sizeFormat,
        unitSize: null,
        sizeUnit: null,
        packCount: null,
        approximate: false,
        approxWeight: null,
      });
    });

    it.each([
      ['Cerveza especial 6 x 33 cl', 6, 1980, 'MILLILITER'],
      ['Coca-Cola 2 x 2 L', 2, 4, 'LITER'],
      ['Yogur natural Dia 4 x 125 g', 4, 500, 'GRAM'],
      ['Pañuelos Dia 2 x 10 ud', 2, 20, 'UNIT'],
    ])('%s still reads a pack', (printed, packCount, unitSize, sizeUnit) => {
      expect(splitSize(printed)).toMatchObject({
        packCount,
        unitSize,
        sizeUnit,
      });
    });
  });

  it('still finds every name of the table in the fixtures', () => {
    // A name that left the fixtures is still a real name, but a table that
    // shares nothing with them is no longer evidence about the source.
    const printed = new Set(
      [
        'listing-page-1.json',
        'listing-page-2.json',
        'listing-last-page.json',
        'listing-weight.json',
        'listing-club.json',
        'listing-promotion.json',
      ].flatMap((file) =>
        parseListing(
          JSON.parse(
            readFileSync(join(__dirname, '__fixtures__', file), 'utf8')
          )
        ).rows.map((row) => row.displayName)
      )
    );
    const found = NAMES.filter(([name]) => printed.has(name));
    expect(found.length).toBeGreaterThanOrEqual(10);
  });

  it('keeps the whole name when the end is not a format', () => {
    expect(splitSize('Sandía entera')).toEqual({
      name: 'Sandía entera',
      sizeFormat: null,
      unitSize: null,
      sizeUnit: null,
      packCount: null,
      approximate: false,
      approxWeight: null,
    });
  });

  it('does not read a number with an unknown unit as a size', () => {
    expect(splitSize('Bolsa de basura 30 litrazos').sizeFormat).toBeNull();
  });

  it('does not split inside a word that ends in a digit and a unit', () => {
    expect(splitSize('Vitamina B12 1 L')).toMatchObject({
      name: 'Vitamina B12',
      sizeFormat: '1 L',
    });
  });

  it('keeps a name that is only a format whole', () => {
    expect(splitSize('500 g')).toMatchObject({
      name: '500 g',
      sizeFormat: null,
    });
  });

  it('collapses the whitespace of the printed name', () => {
    expect(splitSize('  Coca-Cola   2  L ')).toMatchObject({
      name: 'Coca-Cola',
      sizeFormat: '2 L',
    });
  });

  describe('the approximate weight of a piece (plan 0244)', () => {
    it.each([
      ['Manzana roja granel 800 g aprox.', 800],
      ['Manzana reineta granel 1 Kg aprox.', 1000],
      [
        'Pechuga de pollo entera formato familiar Selección de Dia 1.3 Kg aprox.',
        1300,
      ],
      ['Pollo entero Selección de Dia 2.1 Kg aprox.', 2100],
      ['Pechugas fileteadas Selección de Dia bandeja 650 g aprox.', 650],
    ])('%s weighs %d g', (printed, grams) => {
      expect(splitSize(printed)).toMatchObject({
        approximate: true,
        approxWeight: grams,
      });
    });

    it.each([
      // A size the chain promises is a size and no weight.
      'Pera conferencia bandeja 700 g',
      'Manzana roja dulce 1 Kg',
      'Coca-Cola 2 L',
      // An approximate volume is not a weight.
      'Sopa casera 1 L aprox.',
    ])('%s states no weight', (printed) => {
      expect(splitSize(printed).approxWeight).toBeNull();
    });
  });

  describe('count words, a wash and a capital X (plan 0270)', () => {
    it.each([
      [
        'Calcetines deportivos Dia 3 pares',
        'Calcetines deportivos Dia',
        '3 pares',
        3,
      ],
      ['Manzanilla Dia 20 bolsitas', 'Manzanilla Dia', '20 bolsitas', 20],
      [
        'Queso en porciones Dia 8 porciones',
        'Queso en porciones Dia',
        '8 porciones',
        8,
      ],
    ])('%s states a count', (printed, name, sizeFormat, unitSize) => {
      expect(splitSize(printed)).toMatchObject({
        name,
        sizeFormat,
        unitSize,
        sizeUnit: 'UNIT',
        packCount: null,
      });
    });

    it('reads 2 x 3 pares as six pairs in a pack of two', () => {
      expect(splitSize('Calcetines Dia 2 x 3 pares')).toMatchObject({
        sizeFormat: '2 x 3 pares',
        unitSize: 6,
        sizeUnit: 'UNIT',
        packCount: 2,
      });
    });

    it.each([
      ['Detergente líquido Dia 40 lavados', '40 lavados'],
      ['Detergente líquido Dia 2 x 40 lavados', '2 x 40 lavados'],
    ])(
      '%s keeps the wash split off and states no size and no pack',
      (printed, sizeFormat) => {
        expect(splitSize(printed)).toEqual({
          name: 'Detergente líquido Dia',
          sizeFormat,
          unitSize: null,
          sizeUnit: null,
          packCount: null,
          approximate: false,
          approxWeight: null,
        });
      }
    );

    it('reads a capital X as a small one', () => {
      expect(splitSize('Yogur natural Dia 2X125 g')).toMatchObject({
        name: 'Yogur natural Dia',
        sizeFormat: '2X125 g',
        unitSize: 250,
        sizeUnit: 'GRAM',
        packCount: 2,
      });
    });

    describe('hostile names', () => {
      const unsplit = (name: string) => ({
        name,
        sizeFormat: null,
        unitSize: null,
        sizeUnit: null,
        packCount: null,
        approximate: false,
        approxWeight: null,
      });

      it.each([
        'Pañales Dodot talla 6 XL',
        'Camiseta térmica hombre 2XL',
        'Maquinilla Gillette Mach3 MAX',
        'Pilas alcalinas Dia AA X2',
        'Bombilla halógena 2X60 w',
      ])('does not split %p, whose capital X multiplies nothing', (printed) => {
        expect(splitSize(printed)).toEqual(unsplit(printed));
      });

      it('splits a length with a capital X and states no size and no pack', () => {
        expect(splitSize('Mantel Dia 55X60 cm')).toEqual({
          name: 'Mantel Dia',
          sizeFormat: '55X60 cm',
          unitSize: null,
          sizeUnit: null,
          packCount: null,
          approximate: false,
          approxWeight: null,
        });
      });

      it('does not split a decimal length with a capital X', () => {
        expect(splitSize('Toalla de playa 1.2X1.8 m')).toEqual(
          unsplit('Toalla de playa 1.2X1.8 m')
        );
      });

      it.each([
        [
          'Detergente líquido Dia 40 lavados 2 L',
          'Detergente líquido Dia 40 lavados',
          '2 L',
          2,
          'LITER',
        ],
        [
          'Calcetines Dia 3 pares 40 g',
          'Calcetines Dia 3 pares',
          '40 g',
          40,
          'GRAM',
        ],
        [
          'Té verde Dia 10 bolsitas 1,5 g',
          'Té verde Dia 10 bolsitas',
          '1,5 g',
          1.5,
          'GRAM',
        ],
      ])(
        'takes the last size of %p and leaves the count or the wash in the name',
        (printed, name, sizeFormat, unitSize, sizeUnit) => {
          expect(splitSize(printed)).toMatchObject({
            name,
            sizeFormat,
            unitSize,
            sizeUnit,
            packCount: null,
          });
        }
      );

      it.each([
        ['Queso fundido Dia 1 PORCIÓN', 'Queso fundido Dia', '1 PORCIÓN', 1],
        ['Calcetines Dia 3 Pares.', 'Calcetines Dia', '3 Pares.', 3],
      ])(
        'reads the count word of %p in capitals or with a stop',
        (printed, name, sizeFormat, unitSize) => {
          expect(splitSize(printed)).toMatchObject({
            name,
            sizeFormat,
            unitSize,
            sizeUnit: 'UNIT',
            packCount: null,
          });
        }
      );

      it.each([
        'Detergente para lavado a mano Dia',
        'Par de calcetines Dia',
        'Calcetines 1 par de deporte',
      ])('does not split %p, where lavado or par ends no size', (printed) => {
        expect(splitSize(printed)).toEqual(unsplit(printed));
      });
    });
  });
});
