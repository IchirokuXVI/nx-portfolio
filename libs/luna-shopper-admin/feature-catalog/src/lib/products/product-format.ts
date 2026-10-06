/**
 * How the product screens write a price, a size and a date (admin plan 0043).
 *
 * Pure functions, so a spec holds them to their output and a template is
 * handed a string. Every one of them goes through `Intl`: money stays a number
 * on the wire and is put into words only here.
 */

/** The short word for each unit a product is measured in. */
const UNIT_WORDS: Readonly<Record<string, string>> = {
  GRAM: 'g',
  KILOGRAM: 'kg',
  MILLILITER: 'ml',
  LITER: 'L',
};

/**
 * A price as money: `0,98 €` in Spanish, `€0.98` in English.
 *
 * `''` for no price. A currency `Intl` does not know is written after the
 * number, which is still the number the gateway gave.
 */
export function formatPrice(
  value: number | null | undefined,
  currency: string | null | undefined,
  locale: string
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '';
  }
  if (currency === null || currency === undefined || currency === '') {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/**
 * A unit price with what it is per: `0,98 € / L`.
 *
 * `label` is written as it is given. A caller passes `unitPriceUnit` of the
 * row, which is the basis the catalog read and the source's own words only
 * when it read none (backend plan 0189). Up to four decimals, since a price
 * per capsule is `0,13` and one per sheet is less.
 */
export function formatUnitPrice(
  value: number | null | undefined,
  label: string | null | undefined,
  currency: string | null | undefined,
  locale: string
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '';
  }
  let money: string;
  try {
    money =
      currency === null || currency === undefined || currency === ''
        ? new Intl.NumberFormat(locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
          }).format(value)
        : new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
          }).format(value);
  } catch {
    money = `${value} ${currency}`;
  }
  return label === null || label === undefined || label === ''
    ? money
    : `${money} / ${label}`;
}

/**
 * The size of a product: `1 L`, `450 g`, `6 x 1 L` for a pack of six.
 *
 * `''` when the product has no size. A unit with no short word (a unit, a
 * pack) is left out, since "6" beside a product name already reads as a count.
 *
 * **The size of a pack is the size of the whole pack.** Six cartons of a
 * litre carry `unitSize` 6 and `packCount` 6, which is what tells them from a
 * six litre jug. So a pack is written as its count and the size of one.
 */
export function formatSize(
  product: {
    readonly unitSize?: number | null;
    readonly defaultUnit?: string | null;
    readonly packCount?: number | null;
  },
  locale: string
): string {
  const size = product.unitSize;
  if (size === null || size === undefined || !Number.isFinite(size)) {
    return '';
  }
  const pack = product.packCount;
  const packed = typeof pack === 'number' && pack > 1;
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 3,
  }).format(packed ? size / pack : size);
  const word = UNIT_WORDS[product.defaultUnit ?? ''] ?? '';
  const one = word === '' ? number : `${number} ${word}`;

  return packed ? `${pack} x ${one}` : one;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long ago a price was seen: "today", "2 days ago", "5 weeks ago".
 *
 * Days up to two weeks and weeks after that, because a price is fresh or out
 * of date by days and nobody reads "37 days ago" without dividing. `''` for no
 * date and for one that is ahead of `now`.
 */
export function formatSeen(
  value: string | null | undefined,
  now: number,
  locale: string
): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const then = new Date(value).getTime();
  if (Number.isNaN(then) || then > now) {
    return '';
  }

  const days = Math.floor((now - then) / DAY_MS);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  return days < 14
    ? format.format(-days, 'day')
    : format.format(-Math.round(days / 7), 'week');
}

/** A date as a day: `9 Oct 2026`. `''` for none, the text itself when unreadable. */
export function formatDay(
  value: string | null | undefined,
  locale: string
): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
