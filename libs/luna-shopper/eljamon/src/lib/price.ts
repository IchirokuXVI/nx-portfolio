import {
  toBaseUnit,
  UnitOfMeasure,
  type SourceSizeUnit,
} from '@portfolio/luna-shopper/contracts';
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

/**
 * What one unit of a printed label is, in the base unit a size is measured
 * in: `Kilo` is a thousand grams and `100gr` is a hundred. Keyed on the
 * label lower cased with its spaces removed. `Unidad` and `Lavados` are not
 * here: a count has no tenth, and a row that prints one is never judged.
 */
const LABEL_QUANTITIES: Readonly<
  Record<string, { unit: UnitOfMeasure; per: number }>
> = {
  kilo: { unit: UnitOfMeasure.GRAM, per: 1000 },
  '100gr': { unit: UnitOfMeasure.GRAM, per: 100 },
  litro: { unit: UnitOfMeasure.MILLILITER, per: 1000 },
  '100ml': { unit: UnitOfMeasure.MILLILITER, per: 100 },
};

/** A printed price is rounded to the cent, so it is true within half of one. */
const HALF_A_CENT = 0.005;

/** The room left for a size the chain rounded before it divided. */
const TENFOLD_ROOM = 0.02;

/**
 * Whether a printed unit price is ten times, or one tenth of, the figure the
 * row's own price and its own printed size give (plan 0189, decision 2A).
 *
 * The chain prints some rows with a figure that fits another label than the
 * one beside it: 2,89 € for 70 g printed as `41,29 €/100gr`, which is the
 * price of a kilo, and 1,50 € for 100 g printed as `1,50 €/Kilo`, which is
 * the price of 100 g. The defect is on the page. Such a figure makes a product
 * look ten times cheaper or dearer in a comparison, so the adapter writes no
 * unit price for the row. Nothing is computed and written in its place: the
 * division here is evidence, and the answer is only yes or no.
 *
 * False whenever the row gives nothing to judge by: no price, a label this
 * table does not name, no size, or a size in a unit of another kind than the
 * label. A row that is off by any other factor is not this defect and keeps
 * what the chain printed.
 */
export function contradictsItsSizeTenfold(
  price: number | null,
  unit: UnitPrice,
  size: { unitSize: number | null; sizeUnit: SourceSizeUnit | null }
): boolean {
  const key = unit.unitPriceLabel.replace(/\s+/g, '').toLowerCase();
  const quantity = Object.prototype.hasOwnProperty.call(LABEL_QUANTITIES, key)
    ? LABEL_QUANTITIES[key]
    : null;
  if (
    price === null ||
    price <= 0 ||
    unit.unitPrice <= 0 ||
    quantity === null ||
    size.sizeUnit === null
  ) {
    return false;
  }
  const base = toBaseUnit(size.unitSize, size.sizeUnit);
  if (
    base.unitSize === null ||
    base.unitSize <= 0 ||
    base.unit !== quantity.unit
  ) {
    return false;
  }
  const perLabel = quantity.per / base.unitSize;
  const low = (price - HALF_A_CENT) * perLabel;
  const high = (price + HALF_A_CENT) * perLabel;
  return [10, 0.1].some(
    (factor) =>
      unit.unitPrice + HALF_A_CENT >= low * factor * (1 - TENFOLD_ROOM) &&
      unit.unitPrice - HALF_A_CENT <= high * factor * (1 + TENFOLD_ROOM)
  );
}
