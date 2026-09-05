/**
 * Money, as a decimal string from end to end (plan 0004, section 2).
 *
 * `price` is `numeric(12,2)` and `unitPrice` is `numeric(12,4)`, and both arrive
 * as strings. Nothing here ever calls `Number()` on a value with a fraction: a
 * float cannot hold `0.1` exactly, and a value that is round tripped through one
 * comes back a hundredth of a cent different from what the database holds, in
 * the column whose only purpose is comparing two shops.
 *
 * The integer part *is* converted, once, to be grouped by `Intl`. That is exact:
 * a `numeric(12,4)` has at most eight integer digits and the exactly
 * representable integers run to sixteen.
 */

/** A decimal string taken apart, or `null` when it was not one. */
interface Decimal {
  readonly sign: string;
  readonly integer: string;
  readonly fraction: string;
}

/**
 * A decimal string, split.
 *
 * A comma is accepted for the point, because an operator on a Spanish keyboard
 * types one and refusing it would be pedantry rather than validation. A
 * thousands separator is not accepted, because `1,234` is then two readings of
 * the same characters and guessing between them is how money goes missing.
 */
function split(value: string): Decimal | null {
  const text = value.trim().replace(',', '.');
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(text);

  return match === null
    ? null
    : {
        sign: match[1] === '-' ? '-' : '',
        integer: match[2],
        fraction: match[3] ?? '',
      };
}

/**
 * A money value the server sent, ready to display.
 *
 * The fraction is padded to the column's scale and **never truncated**. A field
 * declared with two decimals that receives four is showing a number the server
 * really holds, and hiding two digits of it would be the same class of mistake
 * as recomputing it.
 *
 * Returns the empty string for a value that is not a decimal, including `null`,
 * so a missing price renders as nothing rather than as `NaN`.
 */
export function formatMoney(
  value: unknown,
  decimals: number,
  locale: string
): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  const parts = split(String(value));
  if (parts === null) {
    return '';
  }

  const grouped = new Intl.NumberFormat(locale).format(Number(parts.integer));
  const fraction = parts.fraction.padEnd(decimals, '0');

  return fraction === ''
    ? `${parts.sign}${grouped}`
    : `${parts.sign}${grouped}${decimalSeparator(locale)}${fraction}`;
}

/**
 * An amount with the currency it is in.
 *
 * The two leaflet screens are what this is for, and they are the only place in
 * this app that knows a currency at all. A price on a `SupermarketItem` is a
 * bare `numeric` and the column says nothing about which money it is, so
 * {@link formatMoney} draws digits and no symbol. A leaflet states its currency
 * on every offer, and a queued alias carries the one the offer was priced in,
 * so here the symbol is a fact rather than a guess.
 *
 * A number rather than a decimal string, because that is what the wire carries
 * on these two shapes: `offerPrice` is a JSON number and the document's amounts
 * are too. Nothing is recomputed from it, so the float is displayed and never
 * arithmetic.
 *
 * `''` for an absent amount, so a row with no price renders as nothing. An
 * unknown currency code falls back to the number and the code, because a
 * refusal from `Intl` must not cost the operator the number as well.
 */
export function formatCurrencyAmount(
  amount: number | null,
  currency: string | null,
  locale?: string
): string {
  if (amount === null || !Number.isFinite(amount)) {
    return '';
  }
  if (currency === null || currency === '') {
    return amount.toFixed(2);
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** What this locale puts between the units and the fraction. */
function decimalSeparator(locale: string): string {
  const part = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find((entry) => entry.type === 'decimal');

  return part?.value ?? '.';
}

/** Why a typed money value was refused. */
export type MoneyProblem = 'not-a-number' | 'too-precise';

/** A typed money value, canonical and ready to submit, or the reason it is not. */
export type MoneyResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly problem: MoneyProblem };

/**
 * What the operator typed, as the string the column holds.
 *
 * More decimals than the column has are **refused** rather than rounded. The
 * server would round them too, and quietly changing a number somebody typed is
 * the behaviour that makes an operator stop trusting the field: they would see
 * `1.239` accepted and `1.24` stored.
 */
export function parseMoney(input: string, decimals: number): MoneyResult {
  const parts = split(input);

  if (parts === null) {
    return { ok: false, problem: 'not-a-number' };
  }

  if (parts.fraction.length > decimals) {
    return { ok: false, problem: 'too-precise' };
  }

  const fraction = parts.fraction.padEnd(decimals, '0');
  const integer = parts.integer.replace(/^0+(?=\d)/, '');

  return {
    ok: true,
    value:
      decimals === 0
        ? `${parts.sign}${integer}`
        : `${parts.sign}${integer}.${fraction}`,
  };
}
