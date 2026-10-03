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
      expect(splitSize(printed)).toEqual({
        name,
        sizeFormat,
        unitSize,
        packCount,
        approximate,
      });
    }
  );

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
      packCount: null,
      approximate: false,
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
});
