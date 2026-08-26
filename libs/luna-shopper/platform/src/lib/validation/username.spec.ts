import { ValidationException } from '../errors/domain-exception';
import {
  ANONYMIZED_USERNAME_PREFIX,
  normalizeUsername,
  validateUsername,
} from './username';

/** Every rejection rule from plan 0018, section 6, has a case here. */
describe('validateUsername', () => {
  it('accepts an ordinary name unchanged', () => {
    expect(validateUsername('Swift Sail')).toBe('Swift Sail');
  });

  it('trims and collapses internal whitespace', () => {
    expect(validateUsername('  Vela   Rápida  ')).toBe('Vela Rápida');
  });

  it('accepts accents and non-Latin scripts', () => {
    expect(validateUsername('Mamá')).toBe('Mamá');
    expect(validateUsername('Ελένη')).toBe('Ελένη');
    expect(validateUsername('Морской Волк')).toBe('Морской Волк');
  });

  it("accepts the punctuation set: . _ - '", () => {
    expect(validateUsername("O'Brien-Smith_2.0")).toBe("O'Brien-Smith_2.0");
  });

  it('normalizes to NFC, so two spellings of the same name compare equal', () => {
    // "Mamá" with a combining acute vs. the precomposed character.
    const decomposed = 'Mama\u0301';
    expect(validateUsername(decomposed)).toBe('Mamá');
    expect(validateUsername(decomposed)).toBe(validateUsername('Mamá'));
  });

  it('counts length in code points, not UTF-16 units', () => {
    // 20 astral characters: 20 code points, but 40 UTF-16 units.
    expect(() => validateUsername('𝔄'.repeat(20))).not.toThrow();
  });

  it.each([
    ['too short', 'V'],
    ['too long', 'a'.repeat(41)],
    ['only whitespace', '   '],
    ['only digits', '12345'],
    ['only punctuation', '..--__'],
    ['a control character', 'Vela\u0007'],
    ['a zero width space', 'Ve\u200Bla'],
    ['a bidirectional override', 'Vela\u202EadiV'],
    ['a right-to-left mark', 'Vela\u200F'],
    ['an emoji', 'Vela 🐬'],
    ['not a string', 42],
  ])('rejects %s', (_case, value) => {
    expect(() => validateUsername(value)).toThrow(ValidationException);
  });

  it('rejects the deleted-account marker, whatever its casing', () => {
    expect(() =>
      validateUsername(`${ANONYMIZED_USERNAME_PREFIX} 1a2b3c4d`)
    ).toThrow(ValidationException);
    expect(() => validateUsername('FORMER MEMBER 1a2b3c4d')).toThrow(
      ValidationException
    );
    // Only the prefix is reserved; the words elsewhere in a name are fine.
    expect(validateUsername('The former mermaid')).toBe('The former mermaid');
  });

  it('reports the field, matching the shape the client already handles', () => {
    expect.assertions(1);
    try {
      validateUsername('');
    } catch (error) {
      expect((error as ValidationException).messageArgs).toEqual({
        field: 'username',
      });
    }
  });
});

describe('normalizeUsername', () => {
  it('collapses newlines and tabs like any other whitespace run', () => {
    expect(normalizeUsername('Vela\t\n  Rápida')).toBe('Vela Rápida');
  });
});
