import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
} from '@portfolio/velista/models';

/**
 * What the code field does to whatever a person puts in it.
 *
 * The alphabet and the length are domain facts and live in `models`, beside the enums,
 * so the field and the service that mints codes cannot disagree about them. What is
 * here is the behaviour of the **field** rather than of the transport: by the time a
 * value leaves this function it is already a legal code, or the beginning of one,
 * which is what makes "the primary enables at exactly eight characters" a length check
 * and nothing more.
 */

const NOT_IN_ALPHABET = new RegExp(`[^${JOIN_CODE_ALPHABET}]`, 'g');

/**
 * Turns anything a person can put in the field into a legal code, or the start of one.
 *
 * Three cases, all real, and all from the same behaviour rather than from three
 * branches:
 *
 * - `hk7m2qpd` typed in lower case becomes `HK7M2QPD`, because a phone keyboard is
 *   lower case by default and nobody should have to notice.
 * - `HK7M 2QPD` read off a message with a space in it loses the space.
 * - a pasted `https://velista.example/en/velista/join/HK7M2QPD` becomes the code,
 *   because the **last** eight legal characters of a share link are the code. Taking
 *   the last eight rather than the first is what makes that true, and it costs nothing
 *   for a person typing, who never has more than eight.
 *
 * It never refuses a paste. Whatever is left is shown in the field, so somebody who
 * pasted the wrong thing sees what happened rather than a field that ignored them.
 */
export function normalizeJoinCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(NOT_IN_ALPHABET, '')
    .slice(-JOIN_CODE_LENGTH);
}

/** Whether a normalized code is long enough to send. */
export function isCompleteJoinCode(code: string): boolean {
  return code.length === JOIN_CODE_LENGTH;
}
