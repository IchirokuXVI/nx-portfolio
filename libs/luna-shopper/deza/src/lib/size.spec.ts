import { splitSize } from './size';

/**
 * Real descriptions, read off the live listing on 2026-09-05, kept here rather
 * than derived from a fixture so a recapture cannot silently rewrite the table
 * this rule is judged against (plan 0085, section 11).
 */
const TABLE: Array<[string, string, string | null]> = [
  // The ordinary case: one number, one unit, at the end.
  ['Vino blanco DON SIMON brik 1 L', 'Vino blanco DON SIMON brik', '1 L'],
  ['Croissants ALTEZA 400 g', 'Croissants ALTEZA', '400 g'],
  [
    'Cava rosé CODORNIU cuvée original 75 cl',
    'Cava rosé CODORNIU cuvée original',
    '75 cl',
  ],
  // A decimal point, which the leaflet writes as a comma. `normalizeName` turns
  // both into `1 75 l`, so the difference costs nothing (section 7).
  [
    'Refresco de naranja sin gas ALTEZA 1.5 L',
    'Refresco de naranja sin gas ALTEZA',
    '1.5 L',
  ],
  // A multiplied pack.
  [
    'Vino mesa blanco VIÑA LA HIGUERA 3x187 ml',
    'Vino mesa blanco VIÑA LA HIGUERA',
    '3x187 ml',
  ],
  ['Choco wafer MILKA 5x30 g', 'Choco wafer MILKA', '5x30 g'],
  // A summed pack, kept **verbatim**. The leaflet prints 44 for this one, and
  // expanding `a+b` before comparing belongs to the matcher, not here: rewriting
  // it would destroy what the chain printed.
  [
    'Detergente en cápsulas ARIEL ORIGINAL 23+12 lavados',
    'Detergente en cápsulas ARIEL ORIGINAL',
    '23+12 lavados',
  ],
  [
    'Detergente en polvo COLON 44+6 lavados',
    'Detergente en polvo COLON',
    '44+6 lavados',
  ],
  [
    'Detergente en cápsulas MICOLOR 10 ud',
    'Detergente en cápsulas MICOLOR',
    '10 ud',
  ],
  // Only the last size is taken. The chain wrote the capacity in the middle and
  // the pack count at the end, and the end is what describes the package sold.
  [
    'Hermético takeaway CURVER 1.1 L 5 ud',
    'Hermético takeaway CURVER 1.1 L',
    '5 ud',
  ],
  [
    'Croissant relleno choco ST.PIERRE 6 ud 288 g',
    'Croissant relleno choco ST.PIERRE 6 ud',
    '288 g',
  ],
  // A size that is not at the end is not a trailing size, so nothing is split.
  [
    'Hermético azul TATAY 0.5 l ovalado',
    'Hermético azul TATAY 0.5 l ovalado',
    null,
  ],
  // The bakery rows end in a till key number. This is the whole reason the unit
  // list is closed: "a number and any short word" reads `21` as a size here.
  [
    'Croissant cacao DULCESOL  kg tecla 21',
    'Croissant cacao DULCESOL kg tecla 21',
    null,
  ],
  [
    'Rosquillo 0% azúcar EL CATETO kg tecla 36',
    'Rosquillo 0% azúcar EL CATETO kg tecla 36',
    null,
  ],
  // A unit with no number in front of it states no size either.
  ['Croissant curvo ud', 'Croissant curvo ud', null],
  ['Porta embutido TATAY fresh', 'Porta embutido TATAY fresh', null],
];

describe('splitSize', () => {
  it.each(TABLE)('splits %s', (description, name, sizeFormat) => {
    expect(splitSize(description)).toEqual({ name, sizeFormat });
  });

  it('collapses the runs of spaces the chain leaves in a description', () => {
    expect(splitSize('Boer 0% azúcar   FLORBU   400 g')).toEqual({
      name: 'Boer 0% azúcar FLORBU',
      sizeFormat: '400 g',
    });
  });

  it('keeps a description that is nothing but a size as the name', () => {
    // An empty name is not a product, and the alias key it would build joins
    // nothing at all.
    expect(splitSize('500 g')).toEqual({ name: '500 g', sizeFormat: null });
  });

  it('is case insensitive about the unit and stores it as written', () => {
    expect(splitSize('Leche ALTEZA 1 Kg')).toEqual({
      name: 'Leche ALTEZA',
      sizeFormat: '1 Kg',
    });
  });
});
