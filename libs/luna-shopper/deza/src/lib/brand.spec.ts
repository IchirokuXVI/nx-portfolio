import { extractBrand } from './brand';

describe('extractBrand', () => {
  it.each<[string, string | null]>([
    ['Vino blanco DON SIMON brik', 'DON SIMON'],
    ['Galletas boer coco CORAL', 'CORAL'],
    ['Limón&Nada MINUTE MAID clásico', 'MINUTE MAID'],
    ['Detergente cápsulas 3en1 PLUS MAX blancocolor', 'PLUS MAX'],
    ['Croissant relleno choco ST.PIERRE 6 ud', 'ST.PIERRE'],
    ['Detergente en polvo COLON', 'COLON'],
    ['Wafers cacao LAGO Party bolsa', 'LAGO'],
    // Nothing shouted, nothing claimed.
    ['Croissant curvo', null],
  ])('reads %s as %s', (name, brand) => {
    expect(extractBrand(name)).toBe(brand);
  });

  it('ignores a single capital, which is a unit rather than a brand', () => {
    expect(extractBrand('Vino tinto de Córdoba LA UNION 5 L')).toBe('LA UNION');
  });

  it('ignores a number, however it is punctuated', () => {
    expect(extractBrand('Refresco ALTEZA 16% zumo 1.5')).toBe('ALTEZA');
    expect(extractBrand('Choco wafer MILKA 5x30')).toBe('MILKA');
  });

  it('takes the longest run, and the first of two equal ones', () => {
    expect(extractBrand('Vino tinto GRAN DUQUE SELECCION')).toBe(
      'GRAN DUQUE SELECCION'
    );
    // `de` breaks the run, so this is EXTREM against BONAVAL and the first wins.
    // The extractor is stored with no pretence of certainty: the brand is for a
    // person to read in the queue, and no matcher joins on it.
    expect(extractBrand('Cava brut extremeño EXTREM de BONAVAL reserva')).toBe(
      'EXTREM'
    );
  });
});
