import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
} from '@portfolio/velista/models';
import { isCompleteJoinCode, normalizeJoinCode } from './join-code';

/**
 * Plan 0008, section 7 and its acceptance criteria.
 *
 * The three cases in the middle block are the ones the criterion names, and they are
 * named because each is a real thing people do: a phone keyboard starts lower case,
 * a code copied out of a message brings a space with it, and a share link is what
 * actually gets sent most of the time.
 */
describe('the join code', () => {
  describe('its shape', () => {
    it('matches what the backend mints', () => {
      // `core/.../join-code.ts` cannot be imported into a browser app, so the constant
      // is copied. This is the check that keeps the copy honest: it is the same
      // assertion that file's own spec makes.
      expect(JOIN_CODE_LENGTH).toBe(8);
      expect(JOIN_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    });

    it('leaves out every character people misread', () => {
      // O against 0, I and L against 1. The field's own hint promises this, and the
      // rejected message repeats it, so it had better be true.
      for (const character of ['O', 'I', 'L', '0', '1']) {
        expect(JOIN_CODE_ALPHABET).not.toContain(character);
      }
    });
  });

  describe('normalizing what somebody typed or pasted', () => {
    it('uppercases a code typed in lower case', () => {
      expect(normalizeJoinCode('hk7m2qpd')).toBe('HK7M2QPD');
    });

    it('drops a space read out of a message', () => {
      expect(normalizeJoinCode('HK7M 2QPD')).toBe('HK7M2QPD');
    });

    it('takes the code out of a pasted share link', () => {
      expect(
        normalizeJoinCode('https://velista.example/en/velista/join/HK7M2QPD')
      ).toBe('HK7M2QPD');
    });

    it('never refuses a paste, so the person can see what happened', () => {
      // Whatever is left is shown rather than the field silently ignoring them.
      expect(normalizeJoinCode('not a code at all')).toBe('TACDEATA');
      expect(normalizeJoinCode('***')).toBe('');
    });

    it('keeps a partial code while it is being typed', () => {
      expect(normalizeJoinCode('HK7')).toBe('HK7');
      expect(isCompleteJoinCode('HK7')).toBe(false);
      expect(isCompleteJoinCode('HK7M2QPD')).toBe(true);
    });
  });
});
