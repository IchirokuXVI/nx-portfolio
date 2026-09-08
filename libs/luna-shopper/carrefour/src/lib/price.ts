/**
 * Reading the prices Carrefour prints (plan 0090, section 12).
 *
 * The storefront prints display strings, `"7,65 €"` and `"2,20 €"`, in Spanish
 * conventions: comma for the decimal, dot for the thousands. A run needs a
 * number, so this converts one, and it converts **only** what the chain printed.
 *
 * **Nothing here recomputes a price from another price.** The comparison figure
 * is stored as the chain stated it, for the same reason Mercadona's
 * `bulk_price` is: the field exists so a shopper can compare, and a derivation
 * that disagrees with the chain in the last cent is worse than useless.
 */

/**
 * A Spanish money figure: optional thousands groups, then a comma and two
 * decimals. `"3 €"` also occurs, so the decimals are optional.
 */
const FIGURE = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/;

/**
 * Turn a displayed price into cents. `"7,65 €"` becomes 765.
 *
 * **A card with no figure gives null, never zero** (plan 0090, section 12).
 * Some products are priced by weight and print nothing, and a zero there is a
 * lie about a real product that a shopper would read as free.
 */
export function priceToCents(
  display: string | null | undefined
): number | null {
  if (typeof display !== 'string') {
    return null;
  }
  const match = FIGURE.exec(display.replace(/\s/g, ''));
  if (!match) {
    return null;
  }
  const whole = Number(match[1].replace(/\./g, ''));
  // One printed decimal means tenths, so `"3,5 €"` is 350 cents and not 305.
  const fraction = match[2] ? Number(match[2].padEnd(2, '0')) : 0;
  if (!Number.isFinite(whole) || !Number.isFinite(fraction)) {
    return null;
  }
  return whole * 100 + fraction;
}

/**
 * What the comparison price is per, as a label a person reads: `€/l`, `€/kg`.
 *
 * The card states the unit and the figure in two fields and never the label, so
 * this builds the one the storefront shows beside the figure. It is null when
 * the card stated no unit, because a label with nothing after the slash says
 * less than no label at all.
 */
export function unitPriceLabel(measureUnit: string | null): string | null {
  const unit = measureUnit?.trim();
  return unit ? `€/${unit}` : null;
}
