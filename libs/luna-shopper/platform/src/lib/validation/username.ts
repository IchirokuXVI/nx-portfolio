import { ValidationException } from '../errors/domain-exception';

/**
 * Username validation, shared by auth (the global name) and core (the per zone
 * name) (plan 0018, section 6).
 *
 * It lives in the platform because both services must apply exactly the same
 * rules: a rule that differs between them produces a name that is legal in one
 * place and rejected in the other, which the user experiences as the product
 * losing track of what their own name is allowed to be.
 */

/** Shortest accepted name, in Unicode code points. */
export const USERNAME_MIN_LENGTH = 2;

/**
 * Longest accepted name, in Unicode code points. 40 rather than a rounder number
 * because the zone create/join DTOs already advertise `@MaxLength(40)` for the
 * per zone username; anything shorter would retroactively invalidate stored names
 * and reject a value the API currently accepts.
 */
export const USERNAME_MAX_LENGTH = 40;

/**
 * The system's own marker for a membership whose user was deleted (plan 0011).
 * A user supplied name may not start with it, so the marker cannot be forged.
 * Core re-exports this from its `anonymize` helper, which composes the full
 * placeholder.
 */
export const ANONYMIZED_USERNAME_PREFIX = 'former member';

/**
 * Letters, marks, digits, spaces and a short punctuation set. Marks are included
 * so a combining accent survives; the `u` flag makes the classes Unicode aware,
 * which is what lets a Cyrillic or Greek name through unharmed.
 */
const ALLOWED_CHARACTERS = /^[\p{L}\p{M}\p{N} ._'-]+$/u;

/** At least one letter, mark or digit: rejects a name made only of punctuation. */
const HAS_LETTER_OR_MARK = /[\p{L}\p{M}]/u;

/**
 * Control characters, plus the zero width and bidirectional formatting
 * characters. A name is rendered next to other names, so a character that can
 * reorder or hide the text around it is a way to impersonate a neighbouring
 * member, not a legitimate spelling.
 */
const FORBIDDEN_CHARACTERS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F-\u009F\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

/**
 * Trims, collapses internal whitespace runs to a single space and normalizes to
 * NFC, so two visually identical names compare equal byte for byte (which is what
 * `MATCHING_ZONES` propagation relies on). Does not validate.
 */
export function normalizeUsername(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim().normalize('NFC');
}

/** Counts Unicode code points, so an emoji or an astral character counts once. */
function codePointLength(value: string): number {
  return [...value].length;
}

/**
 * Normalizes and validates a username, returning the value to store. Throws a
 * {@link ValidationException} carrying `messageArgs: { field: 'username' }`,
 * which is the shape the client already handles for a rejected username.
 */
export function validateUsername(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw usernameRejected('A username is required');
  }

  // Reject before normalizing: a bidi control character between two spaces would
  // otherwise be collapsed away and the name silently accepted in altered form.
  if (FORBIDDEN_CHARACTERS.test(raw)) {
    throw usernameRejected(
      'That username contains characters that are not allowed'
    );
  }

  const username = normalizeUsername(raw);
  const length = codePointLength(username);
  if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) {
    throw usernameRejected(
      `A username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters`
    );
  }
  if (!ALLOWED_CHARACTERS.test(username)) {
    throw usernameRejected(
      'That username contains characters that are not allowed'
    );
  }
  if (!HAS_LETTER_OR_MARK.test(username)) {
    throw usernameRejected('A username must contain at least one letter');
  }
  if (
    username.toLowerCase().startsWith(ANONYMIZED_USERNAME_PREFIX.toLowerCase())
  ) {
    throw usernameRejected('That username is reserved');
  }
  return username;
}

function usernameRejected(message: string): ValidationException {
  return new ValidationException(message, {
    messageArgs: { field: 'username' },
  });
}
