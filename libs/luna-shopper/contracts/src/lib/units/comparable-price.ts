import { UnitOfMeasure } from '../enums/catalog.enums';
import { toBaseUnit } from './source-size';

/**
 * What a `comparablePrice` is a price per (plan 0245, decision C2).
 *
 * Three values, read from the product's base unit alone: grams give a price
 * per kilo, millilitres a price per litre, a count a price per unit. The
 * chain's own `DOZEN` describes its `unitPrice` and is never a comparable
 * basis. Browser reachable: it names no `process`.
 */
export const COMPARABLE_BASES = ['KILOGRAM', 'LITER', 'UNIT'] as const;
export type ComparableBasis = (typeof COMPARABLE_BASES)[number];

/** The row's till price and the four size fields of its item. */
export interface ComparablePriceInput {
  price: number | null;
  unitSize: number | null;
  defaultUnit: UnitOfMeasure;
  packCount: number | null;
  /**
   * Read by nothing yet. A piece priced as one is compared per unit, not by
   * its approximate weight (decision C4); the field is here for a later plan
   * that may want a per kilo figure for such a piece.
   */
  approxWeight: number | null;
}

export interface ComparablePrice {
  price: number;
  basis: ComparableBasis;
}

/**
 * The price of a kilo, a litre or one unit of a product, derived from the
 * till price and the item's size (plan 0245, section 1).
 *
 * The size is first put in its base unit, so a legacy `LITER` or `KILOGRAM`
 * size reads as millilitres or grams. A counted product divides by its
 * `unitSize` when set, else its `packCount`, else 1. A `KILOGRAM` product with
 * no size is priced per kilo already. A weighed pack with no size derives
 * nothing. The answer is rounded half up to four decimals, the scale of the
 * column.
 *
 * `recomputeComparablePrices` in catalog runs the SQL translation of this
 * function, and `comparable-price.integration.spec.ts` there proves both equal.
 */
export function comparablePriceOf(
  input: ComparablePriceInput
): ComparablePrice | null {
  const { price } = input;
  if (price === null || !Number.isFinite(price)) {
    return null;
  }
  if (
    input.defaultUnit === UnitOfMeasure.KILOGRAM &&
    !isPositive(input.unitSize)
  ) {
    return { price: round4(price), basis: 'KILOGRAM' };
  }
  const base = toBaseUnit(input.unitSize, input.defaultUnit);
  switch (base.unit) {
    case UnitOfMeasure.GRAM:
    case UnitOfMeasure.MILLILITER: {
      const size = base.unitSize;
      if (!isPositive(size)) {
        return null;
      }
      return {
        price: round4((price * 1000) / size),
        basis: base.unit === UnitOfMeasure.GRAM ? 'KILOGRAM' : 'LITER',
      };
    }
    default: {
      const count = isPositive(input.unitSize)
        ? input.unitSize
        : isPositive(input.packCount)
          ? input.packCount
          : 1;
      return { price: round4(price / count), basis: 'UNIT' };
    }
  }
}

function isPositive(value: number | null | undefined): value is number {
  return (
    value !== null && value !== undefined && Number.isFinite(value) && value > 0
  );
}

/**
 * Half up to four decimals, like Postgres `round(numeric, 4)`. The value is
 * first cut to fifteen significant digits, so a binary artifact such as
 * 1.23454999999 for 1.23455 rounds the way the decimal does.
 */
function round4(value: number): number {
  const clean = Number.parseFloat(value.toPrecision(15));
  const sign = clean < 0 ? -1 : 1;
  const scaled = Number.parseFloat((Math.abs(clean) * 10_000).toPrecision(15));
  return (sign * Math.round(scaled)) / 10_000;
}
