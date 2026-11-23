import {
  QUANTITY_HOLD_DELAY_MS,
  QUANTITY_HOLD_FIRST_MS,
  QUANTITY_STEP_QUIET_MS,
  usernameProblem,
} from './limits';

/**
 * The quiet beat outlasts the hold's wait and its slowest interval (velista `0188`
 * decision F, `0194` section 1), so a hold and a run of taps stay one run.
 */
describe('the quiet beat of a stepper', () => {
  it('is longer than the wait of a hold and than its first interval', () => {
    expect(QUANTITY_STEP_QUIET_MS).toBeGreaterThan(QUANTITY_HOLD_DELAY_MS);
    expect(QUANTITY_STEP_QUIET_MS).toBeGreaterThan(QUANTITY_HOLD_FIRST_MS);
  });
});

/**
 * The client's mirror of the server's name rule (velista `0160`, item 1).
 *
 * The cases are the server's own, from `libs/luna-shopper/platform/src/lib/validation/
 * username.spec.ts`, so a rule that changes on one side and not the other is a red spec
 * here rather than a person typing a name the screen accepts and the server refuses.
 */
describe('usernameProblem', () => {
  it.each([
    ['an ordinary name', 'Swift Sail'],
    ['spaces around it and inside it', '  Vela   Rápida  '],
    ['an accent', 'Ana Núñez'],
    ['Greek', 'Ελένη'],
    ['Cyrillic', 'Морской Волк'],
    ['the punctuation set', "O'Brien-Smith_2.0"],
    ['a combining accent', 'Mama\u0301'],
    ['twenty astral letters, forty UTF-16 units', '𝔄'.repeat(20)],
    ['the reserved words away from the start', 'The former mermaid'],
  ])('accepts %s', (_case, value) => {
    expect(usernameProblem(value)).toBeNull();
  });

  it.each([
    ['one character', 'a', 'length'],
    ['one letter after trimming', ' V ', 'length'],
    ['nothing but spaces', '   ', 'length'],
    ['forty one characters', 'a'.repeat(41), 'length'],
    ['an emoji', 'Bruno 🍋 Peña', 'characters'],
    ['the emoji of the server spec', 'Vela 🐬', 'characters'],
    ['a control character', 'Vela\u0007', 'characters'],
    ['a tab, refused before the spaces collapse', 'Vela\tRápida', 'characters'],
    ['a zero width space', 'Ve\u200Bla', 'characters'],
    ['a bidirectional override', 'Vela\u202EadiV', 'characters'],
    ['a right to left mark', 'Vela\u200F', 'characters'],
    ['only digits', '123', 'letter'],
    ['only punctuation', '..--__', 'letter'],
    ['the reserved prefix', 'former member x', 'reserved'],
    ['the reserved prefix in capitals', 'FORMER MEMBER 1a2b3c4d', 'reserved'],
  ])('refuses %s', (_case, value, problem) => {
    expect(usernameProblem(value)).toBe(problem);
  });

  it('checks the length before the characters, as the server does', () => {
    // One emoji is one code point, so the server answers the length first.
    expect(usernameProblem('🍋')).toBe('length');
  });
});
