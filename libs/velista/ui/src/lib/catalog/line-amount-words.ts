import {
  soldAs,
  type LineAmount,
  type LineUnit,
  type LineUnitProduct,
} from '@portfolio/velista/models';
import { formatMoney, formatQuantity } from '@portfolio/velista/platform';
import { productSizeText, type SizeTranslate } from './product-size';

/**
 * What a line's amount costs with one product, as the caption under a member's
 * price draws it (velista `0183`, target state 6): "1 kg · 1,99 €" on a loose
 * product, "2 × ~700 g · ≈ 2,78 €" on a piece, "2 × 500 g · 3,98 €" on a bag,
 * for a line at 1000 g.
 *
 * The amount is what the product serves the line with: the line's own amount
 * for a product sold by the kilo or the litre, and whole pieces or packs times
 * one of them for the rest. The sign "≈" stands where the number of pieces
 * decides the cost and the pieces vary, which is a kilo piece and a piece
 * priced as one. A loose product is charged for what is weighed, so its cost is
 * drawn without it, and so is a pack whose size is printed on it.
 *
 * Null for no amount: the line at 0, or a product with no price for it. The
 * caller draws {@link lineUnitCannotWords} for a product that cannot serve the
 * unit at all.
 */
export function lineAmountWords(
  amount: LineAmount | null,
  line: { readonly quantity: number; readonly unit: LineUnit },
  product: LineUnitProduct,
  currency: string | null,
  locale: string,
  translate: SizeTranslate
): string | null {
  if (amount === null || line.quantity <= 0) {
    return null;
  }
  const kind = soldAs(product.unit, product.size, product.approxWeight);
  const price = formatMoney(amount.cents / 100, currency, locale);
  const words = amountOf(amount, line, product, locale, translate);
  const about =
    amount.estimated && kind !== 'BY_THE_KILO' && kind !== 'BY_THE_LITRE';
  return translate(about ? 'line.unit.costAbout' : 'line.unit.cost', {
    amount: words,
    price,
  });
}

/**
 * "not sold by the piece", "not sold by weight" or "not sold by volume": the
 * caption of a member that cannot serve the line's unit (target state 4).
 */
export function lineUnitCannotWords(
  unit: LineUnit,
  translate: SizeTranslate
): string {
  return translate(`line.unit.cannot.${unit}`);
}

/** The amount half of the caption: "1 kg", "2 × ~700 g", "×2". */
function amountOf(
  amount: LineAmount,
  line: { readonly quantity: number; readonly unit: LineUnit },
  product: LineUnitProduct,
  locale: string,
  translate: SizeTranslate
): string {
  const count = amount.pieces ?? (line.unit === 'UNIT' ? line.quantity : null);
  const size = productSizeText(
    product.size,
    product.unit,
    locale,
    translate,
    product.approxWeight
  );
  if (count === null) {
    return formatQuantity(line.quantity, line.unit, locale);
  }
  if (size === null) {
    return formatQuantity(count, 'UNIT', locale);
  }
  return translate('line.unit.pieces', {
    count: formatCount(count, locale),
    size,
  });
}

function formatCount(count: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(count);
  } catch {
    return String(count);
  }
}
