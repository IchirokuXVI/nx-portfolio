import { slugFromName, uniqueSlug, walkNameKey } from './section.service';

/** The names and slugs of the sections a shown walk creates (plan 0168, section 4). */
describe('walk section names', () => {
  it('compares names trimmed and case folded', () => {
    expect(walkNameKey('  Lácteos ')).toBe(walkNameKey('LÁCTEOS'));
    expect(walkNameKey('Lácteos')).not.toBe(walkNameKey('Lacteos'));
  });

  it('writes a slug in ascii kebab case with the accents dropped', () => {
    expect(slugFromName('Frutas y Verduras')).toBe('frutas-y-verduras');
    expect(slugFromName('  Charcutería & Quesos ')).toBe('charcuteria-quesos');
    expect(slugFromName('Ñoquis')).toBe('noquis');
    expect(slugFromName('¿?')).toBe('section');
    expect(slugFromName('a'.repeat(100)).length).toBe(80);
  });

  it('numbers a slug the chain already holds', () => {
    expect(uniqueSlug('lacteos', new Set())).toBe('lacteos');
    expect(uniqueSlug('lacteos', new Set(['lacteos']))).toBe('lacteos-2');
    expect(uniqueSlug('lacteos', new Set(['lacteos', 'lacteos-2']))).toBe(
      'lacteos-3'
    );
    const long = 'b'.repeat(80);
    const numbered = uniqueSlug(long, new Set([long]));
    expect(numbered.length).toBe(80);
    expect(numbered.endsWith('-2')).toBe(true);
  });
});
