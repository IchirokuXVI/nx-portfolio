/**
 * What a join code is made of.
 *
 * A domain fact rather than a presentation one, which is why it sits beside the enums
 * rather than in the field that enforces it: the in-memory zone service mints codes
 * from it, the field filters keystrokes against it, and the two must not be able to
 * disagree about which characters are legal.
 *
 * Copied from the backend's `core/.../join-code.ts` rather than imported, for the
 * reason rule D4 gives generally: that file is server side, and the contracts package
 * types the field as a plain string, so there is nothing to import even in principle.
 * `join-code.spec.ts` in `ui` pins both halves, so a divergence is a failing test.
 *
 * No O, I, L, 0 or 1. This is a code read aloud down a phone and typed on glass, and
 * those five are the pairs that get misheard and mistyped.
 */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Eight characters, which is what `generateJoinCode` produces. */
export const JOIN_CODE_LENGTH = 8;
