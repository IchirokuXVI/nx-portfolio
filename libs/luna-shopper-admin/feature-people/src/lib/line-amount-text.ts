/**
 * What a line's quantity counts, in this app's own words (backend plan 0246).
 *
 * The wire carries `UNIT`, `GRAM` or `MILLILITER`; anything else, and a row
 * from before the field, reads as pieces.
 */
export type LineAmountUnit = 'UNIT' | 'GRAM' | 'MILLILITER';

/** The unit of a row off the wire, as {@link lineAmountText} reads it. */
export function toLineAmountUnit(value: unknown): LineAmountUnit {
  return value === 'GRAM' || value === 'MILLILITER' ? value : 'UNIT';
}

/**
 * A line's amount as the back office draws it (backend plan 0246, section 6),
 * by the formatting rule velista `0182` gives: "2" for a count, "750 g" below
 * a thousand, "1 kg", "1,25 kg" and "12,5 kg" from a thousand with at most
 * two decimals, because the steps there are 250 g, and the same for
 * millilitres and litres.
 *
 * Through `Intl.NumberFormat` with `style: 'unit'`, so the decimal mark and
 * the symbol follow the locale. The wire never carries a kilo: 1500 is grams.
 */
export function lineAmountText(
  quantity: number,
  unit: unknown,
  locale: string
): string {
  const counted = toLineAmountUnit(unit);
  if (counted === 'UNIT') {
    return new Intl.NumberFormat(locale).format(quantity);
  }
  const large = quantity >= 1000;
  const symbol =
    counted === 'GRAM'
      ? large
        ? 'kilogram'
        : 'gram'
      : large
        ? 'liter'
        : 'milliliter';
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: symbol,
    unitDisplay: 'short',
    maximumFractionDigits: large ? 2 : 0,
  }).format(large ? quantity / 1000 : quantity);
}
