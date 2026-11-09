import {
  isMeasured,
  QUANTITY_COARSE_FROM,
  type LineUnit,
} from '@portfolio/velista/models';

/**
 * A line's quantity as a caption or a pill draws it (velista `0182`, section 3;
 * velista `0070`, section 2): "×2" for a count, "750 g" below a thousand grams,
 * "1 kg" and "1,5 kg" from a thousand, and the same for millilitres and litres.
 *
 * The one place a kilo or a litre exists in velista: the wire carries base units
 * only, so 1500 is 1500 g and this is what turns it into "1,5 kg". Through
 * `Intl.NumberFormat` with `style: 'unit'` in the reader's language, and never a
 * translation key with a number in it, for the reason {@link formatMoney} gives.
 *
 * **Two decimals at most, where the plan says one** (builder decision of velista
 * `0182`): the coarse step is 250 g, so 1250 g is a value the reel lands on, and
 * one decimal would draw it as "1,3 kg", which is not what was asked for. A value
 * that needs one decimal or none draws as the plan's examples do.
 */
export function formatQuantity(
  quantity: number,
  unit: LineUnit,
  locale: string
): string {
  return isMeasured(unit)
    ? formatAmount(quantity, unit, locale)
    : `×${formatNumber(quantity, locale)}`;
}

/**
 * A quantity as a sentence says it: the bare number for a count ("You bought
 * 3"), and the words of {@link formatQuantity} for a weight or a volume ("You
 * bought 750 g"). A sentence already says what a count counts, and "×3" inside
 * one reads as a sign.
 */
export function formatAmount(
  quantity: number,
  unit: LineUnit,
  locale: string
): string {
  if (!isMeasured(unit)) {
    return formatNumber(quantity, locale);
  }
  const coarse = quantity >= QUANTITY_COARSE_FROM;
  const name =
    unit === 'GRAM'
      ? coarse
        ? 'kilogram'
        : 'gram'
      : coarse
        ? 'liter'
        : 'milliliter';
  const value = coarse ? quantity / 1000 : quantity;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: name,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // An unrecognised locale tag, which `Intl` throws for. The English symbols
    // are ugly and correct, and a pill with no number would be worse.
    const symbol =
      unit === 'GRAM' ? (coarse ? 'kg' : 'g') : coarse ? 'l' : 'ml';
    return `${Number(value.toFixed(2))} ${symbol}`;
  }
}

/**
 * A signed change to a quantity, as a note about it says it: "+2" or "-1" for a
 * count, "+250 g" or "-1,5 kg" for a weight or a volume (velista `0182`). The
 * number after the sign is {@link formatAmount}'s, so a change reads in the unit
 * the line counts in and never as a bare number of grams.
 */
export function formatQuantityChange(
  delta: number,
  unit: LineUnit,
  locale: string
): string {
  const sign = delta < 0 ? '-' : '+';
  return `${sign}${formatAmount(Math.abs(delta), unit, locale)}`;
}

function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}
