import { decodeText } from './html';

/**
 * Prices as the listing prints them (plan 0169, section 2.2): Spanish decimals,
 * a non breaking space, then `€`, and for the unit price a slash and the unit
 * the chain prices it by.
 */

/** `3,49 €`, `1.234,50 €`, `12 €`. Anything else is not a price. */
const SPANISH_AMOUNT = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*€/;

/**
 * The amount in a printed price, or null when the text states none.
 *
 * Null rather than zero: a blank price element read as zero is a free product.
 */
export function parseSpanishPrice(
  printed: string | null | undefined
): number | null {
  if (!printed) {
    return null;
  }
  const match = SPANISH_AMOUNT.exec(decodeText(printed));
  if (!match) {
    return null;
  }
  const whole = match[1].replace(/\./g, '');
  const cents = (match[2] ?? '0').padEnd(2, '0');
  return Number(`${whole}.${cents}`);
}

export interface UnitPrice {
  unitPrice: number;
  /** What the chain prices it by, verbatim: `Kilo`, `Litro`, `Unidad`, `100gr`. */
  unitPriceLabel: string;
}

/**
 * `15,31 €/Kilo` split into the amount and the unit, or null.
 *
 * The label is stored verbatim, like `bulk_price` is: it is the chain's own
 * comparison figure, and a label rewritten here would stop matching it.
 */
export function parseUnitPrice(
  printed: string | null | undefined
): UnitPrice | null {
  if (!printed) {
    return null;
  }
  const text = decodeText(printed);
  const slash = text.lastIndexOf('/');
  if (slash === -1) {
    return null;
  }
  const unitPrice = parseSpanishPrice(text.slice(0, slash));
  const unitPriceLabel = text.slice(slash + 1).trim();
  if (unitPrice === null || unitPriceLabel === '') {
    return null;
  }
  return { unitPrice, unitPriceLabel };
}
