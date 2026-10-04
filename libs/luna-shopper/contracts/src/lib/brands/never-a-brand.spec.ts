import { brandKey } from './brand-key';
import { isNeverABrand, NEVER_A_BRAND } from './never-a-brand';

describe('isNeverABrand (plan 0178)', () => {
  it('holds exactly the words the plan lists', () => {
    expect(NEVER_A_BRAND).toEqual([
      'D.O.',
      'D.O',
      'DO',
      'D.O.P.',
      'DOP',
      'D.O.Ca.',
      'DOCa',
      'I.G.P.',
      'IGP',
      'V.T.',
      'VINO DE LA TIERRA',
      'HALLOWEEN',
      'NAVIDAD',
    ]);
  });

  it.each([...NEVER_A_BRAND])('refuses %s', (word) => {
    expect(isNeverABrand(word)).toBe(true);
  });

  it('refuses a listed word in another case or punctuation', () => {
    expect(isNeverABrand('d.o.')).toBe(true);
    expect(isNeverABrand('Halloween')).toBe(true);
    expect(isNeverABrand(' Vino de la Tierra ')).toBe(true);
  });

  it('leaves a brand that only contains a listed word alone', () => {
    expect(isNeverABrand('PRIMA')).toBe(false);
    expect(isNeverABrand('DON SIMON')).toBe(false);
    expect(isNeverABrand('NAVIDUL')).toBe(false);
    expect(isNeverABrand('DELICIAS DE NAVIDAD')).toBe(false);
  });

  it('answers false for no text, as a text with no key names nothing', () => {
    expect(isNeverABrand(null)).toBe(false);
    expect(isNeverABrand(undefined)).toBe(false);
    expect(isNeverABrand('---')).toBe(false);
  });

  it('gives every listed word a key, or the list would hold a dead entry', () => {
    for (const word of NEVER_A_BRAND) {
      expect(brandKey(word)).not.toBeNull();
    }
  });
});
