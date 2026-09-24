import type { CatalogSynonyms, LocalizedName } from '@portfolio/velista/models';
import { catalogNorm, matchedSynonym } from './matched-synonym';

/**
 * Which synonym made a group match (velista `0108`, target 4), decided with the
 * catalog's own literal rule. The fixture is the reference group that started it.
 */
const PADS: LocalizedName = {
  es: 'Discos desmaquillantes',
  en: 'Cotton Pads',
};
const PAD_WORDS: CatalogSynonyms = {
  en: ['cotton pads', 'makeup remover pads'],
  es: ['discos desmaquillantes', 'algodón'],
};

describe('matchedSynonym', () => {
  it('names the synonym a prefix matched when the name did not', () => {
    expect(matchedSynonym(PADS, PAD_WORDS, 'alg', 'es')).toBe('algodón');
  });

  it('folds accents and case on both sides, as catalog_norm does', () => {
    expect(matchedSynonym(PADS, PAD_WORDS, 'ALGODON', 'es')).toBe('algodón');
    expect(catalogNorm("L'Oréal Ñu")).toBe('loreal nu');
  });

  it('says nothing when the name matched, in either language', () => {
    expect(matchedSynonym(PADS, PAD_WORDS, 'disc', 'es')).toBeNull();
    expect(matchedSynonym(PADS, PAD_WORDS, 'cotton', 'es')).toBeNull();
  });

  it('matches at the start of a word only', () => {
    // "godon" is inside "algodón", not at the start of a word of it.
    expect(matchedSynonym(PADS, PAD_WORDS, 'godon', 'es')).toBeNull();
  });

  it('prefers a synonym in the reader’s language', () => {
    const words: CatalogSynonyms = { en: ['remover'], es: ['removedor'] };
    expect(matchedSynonym(PADS, words, 'remo', 'es')).toBe('removedor');
    expect(matchedSynonym(PADS, words, 'remo', 'en')).toBe('remover');
  });

  it('names the synonym holding every word the name left over', () => {
    expect(matchedSynonym(PADS, PAD_WORDS, 'discos algo', 'es')).toBe(
      'algodón'
    );
    expect(matchedSynonym(PADS, PAD_WORDS, 'makeup pads', 'en')).toBe(
      'makeup remover pads'
    );
  });

  it('accepts a gender or number variant as a whole word, from five letters', () => {
    const name: LocalizedName = { es: 'Pan', en: 'Bread' };
    const words: CatalogSynonyms = { en: [], es: ['barra rústica'] };
    expect(matchedSynonym(name, words, 'rustico', 'es')).toBe('barra rústica');
    expect(matchedSynonym(name, words, 'rustica', 'es')).toBe('barra rústica');
  });

  it('says nothing for a match it cannot explain, such as a misspelling', () => {
    expect(matchedSynonym(PADS, PAD_WORDS, 'algdon', 'es')).toBeNull();
    expect(matchedSynonym(PADS, { en: [], es: [] }, 'alg', 'es')).toBeNull();
    expect(matchedSynonym(PADS, PAD_WORDS, '  ', 'es')).toBeNull();
  });
});
