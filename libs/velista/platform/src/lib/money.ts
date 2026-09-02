/**
 * An amount of money, in the reader's language (velista `0062`, section 3.1).
 *
 * `Intl` and never `CurrencyPipe`, for the reason every date in velista is
 * formatted with `Intl` and never `DatePipe`: the pipe resolves a locale from
 * Angular's `LOCALE_ID`, which this app does not set because its language is
 * runtime state held by `RokuLocaleStore`, and every remote would carry its own
 * copy of the formatting data. `Intl` reads the tag it is handed.
 *
 * **Called in a selector, never in a template.** It returns a string, the view
 * model carries the string, and a row that has already decided what it says
 * cannot say it differently on a re render.
 *
 * A **null currency with a price present** formats as the bare number. A price
 * with no currency is still a number worth showing to somebody who knows what
 * country they are in, and inventing EUR would be a guess written into the one
 * field people trust literally. Zero is a real price and formats as one; only
 * an absent price is nothing, and that is the caller's `null` to keep.
 */
export function formatMoney(
  amount: number,
  currency: string | null,
  locale: string
): string {
  try {
    return currency === null
      ? new Intl.NumberFormat(locale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(amount)
      : new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
        }).format(amount);
  } catch {
    // An unrecognised locale tag or currency code, which `Intl` throws a
    // `RangeError` for. Two decimals and the code is ugly and correct, and a
    // row with no price where the server sent one would be worse.
    const digits = amount.toFixed(2);
    return currency === null ? digits : `${digits} ${currency}`;
  }
}
