/**
 * What a string is, read as a barcode (plan 0184).
 *
 * One function for every service that writes or compares a product's EAN:
 * catalog, the harvester and the gateway. Nothing validated an EAN before it,
 * so 211 codes of one shop's scales were stored as products' barcodes, six of
 * them stubs with no valid check digit, and five more had 11 or 12 digits.
 *
 * Browser reachable, like `brandKey`: it names no `process` and no `Buffer`.
 *
 * **The tests live beside it in `gtin.cases.json`**, because the curation tool
 * is plain `.mjs` and keeps its own copy of this function
 * (`libs/luna-shopper/tools/curation/suggestions/src/rules.mjs`). Both copies
 * are asserted against that one file, so they cannot drift apart silently.
 */

/** Why a string is not a barcode. */
export type GtinInvalidReason =
  /** Nothing but whitespace, or no string at all. */
  | 'EMPTY'
  /** A character that is not a digit, a space inside the code included. */
  | 'NOT_DIGITS'
  /** Not 8, 12, 13 or 14 digits. An 11 digit code lands here. */
  | 'LENGTH'
  /** The last digit is not the one the others add up to. */
  | 'CHECK_DIGIT';

export type GtinReading =
  /** A real barcode, as it was written: a 12 digit code is not padded. */
  | { kind: 'GTIN'; gtin: string }
  /**
   * A code a shop prints on its own scales and labels: 13 digits, the first
   * one a 2. GS1 reserves that range for use inside one company, so the same
   * number names another product in another chain and joins nothing. Its
   * check digit is not looked at, because a stub such as `2204500000000` is
   * the same kind of code as one that happens to add up.
   */
  | { kind: 'IN_STORE'; code: string }
  | { kind: 'INVALID'; reason: GtinInvalidReason };

/** The lengths a barcode comes in: EAN-8, UPC-A, EAN-13 and GTIN-14. */
const GTIN_LENGTHS: ReadonlySet<number> = new Set([8, 12, 13, 14]);

const IN_STORE_LENGTH = 13;
const IN_STORE_PREFIX = '2';

/**
 * Read `text` as a barcode.
 *
 * - The text is trimmed, and after that it holds digits only. A space or a
 *   dash inside the code is refused and not removed: a code somebody had to
 *   repair is a code somebody may have repaired wrongly.
 * - 13 digits starting with 2 is an in-store code.
 * - Anything else is 8, 12, 13 or 14 digits with a valid check digit.
 */
export function readGtin(text: string | null | undefined): GtinReading {
  const code = typeof text === 'string' ? text.trim() : '';
  if (code === '') {
    return { kind: 'INVALID', reason: 'EMPTY' };
  }
  if (!/^[0-9]+$/.test(code)) {
    return { kind: 'INVALID', reason: 'NOT_DIGITS' };
  }
  if (code.length === IN_STORE_LENGTH && code.startsWith(IN_STORE_PREFIX)) {
    return { kind: 'IN_STORE', code };
  }
  if (!GTIN_LENGTHS.has(code.length)) {
    return { kind: 'INVALID', reason: 'LENGTH' };
  }
  if (!hasValidCheckDigit(code)) {
    return { kind: 'INVALID', reason: 'CHECK_DIGIT' };
  }
  return { kind: 'GTIN', gtin: code };
}

/**
 * The barcode a product may hold: the real one `text` is, or null.
 *
 * An in-store code and an invalid code both answer null, which is the rule
 * for a product created from a queue row: it holds a real barcode or none.
 */
export function productGtin(text: string | null | undefined): string | null {
  const reading = readGtin(text);
  return reading.kind === 'GTIN' ? reading.gtin : null;
}

/**
 * The GS1 check: from the right, the digits before the last one weigh 3, 1,
 * 3, 1 and so on, and the last digit brings the sum to a multiple of ten.
 */
function hasValidCheckDigit(code: string): boolean {
  let sum = 0;
  let weight = 3;
  for (let index = code.length - 2; index >= 0; index--) {
    sum += Number(code[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}
