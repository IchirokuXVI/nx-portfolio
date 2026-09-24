/**
 * The two checks the add a price form makes on its own (admin plan 0033).
 *
 * Pure functions, so a spec can hold them to their numbers without drawing a
 * form.
 */

/** How far back a hand typed `observedAt` may go (backend plan 0160). */
export const OBSERVED_AT_MAX_AGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A unit price the form offers, with the label it would carry. */
export interface UnitPriceProposal {
  /** The number, as the form's four decimal field holds it. */
  readonly unitPrice: string;
  /** What it is per, in the words the sources use: `1 kg`, `1 L`, `1 ud`. */
  readonly label: string;
}

/**
 * How one unit of measure turns into the base a unit price is quoted in.
 *
 * Prices are compared per kilogram, per litre and per unit, never per gram or
 * per millilitre, so a 500 g product priced 1.20 is 2.40 per kilogram.
 */
const BASES: Readonly<Record<string, { divisor: number; label: string }>> = {
  GRAM: { divisor: 1000, label: '1 kg' },
  KILOGRAM: { divisor: 1, label: '1 kg' },
  MILLILITER: { divisor: 1000, label: '1 L' },
  LITER: { divisor: 1, label: '1 L' },
  UNIT: { divisor: 1, label: '1 ud' },
  PACK: { divisor: 1, label: '1 ud' },
};

/**
 * The price divided by the size in the product's base unit, or `null` when
 * that cannot be worked out: no price, no size, or a unit this build does not
 * know.
 *
 * Rounded to the four decimals the column holds, and never below two, so it
 * reads as money.
 */
export function proposeUnitPrice(
  price: number,
  unitSize: number | null,
  unit: string
): UnitPriceProposal | null {
  const base = BASES[unit];
  if (
    base === undefined ||
    unitSize === null ||
    !Number.isFinite(unitSize) ||
    unitSize <= 0 ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }

  const perBase = price / (unitSize / base.divisor);
  const fixed = perBase.toFixed(4).replace(/0{1,2}$/, '');

  return { unitPrice: fixed, label: base.label };
}

/**
 * Why a typed `observedAt` cannot be sent, as a translation key, or `null`.
 *
 * Empty is fine: the server then records now. A date ahead of `now` or more
 * than {@link OBSERVED_AT_MAX_AGE_DAYS} days behind it is refused, which is the
 * window the gateway enforces. An unreadable date is left to the form's own
 * date check, which already says so.
 */
export function checkObservedAt(value: unknown, now: number): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const at = new Date(value).getTime();
  if (Number.isNaN(at)) {
    return null;
  }
  if (at > now) {
    return 'catalog.prices.observedAtFuture';
  }
  if (at < now - OBSERVED_AT_MAX_AGE_DAYS * DAY_MS) {
    return 'catalog.prices.observedAtTooOld';
  }
  return null;
}
