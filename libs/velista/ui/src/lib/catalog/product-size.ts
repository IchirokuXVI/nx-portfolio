/** A translator call, so this stays a plain function a spec can run. */
export type SizeTranslate = (
  key: string,
  args?: Record<string, unknown>
) => string;

/**
 * How big the packet is, as words, or null when there is nothing worth saying.
 *
 * **This is what stops a list drawing the same product three times.** The catalog
 * holds one record per size, so "Leche entera Hacendado" at 1 L, at 1.5 L and at
 * 6 L are three products with the same name and the same brand, and the size is
 * what tells them apart.
 *
 * A mass or a volume is always said when the catalog has one: most sizes are below
 * one (0.35 kg, 0.75 L), which is exactly where two records differ. `UNIT` and
 * `PACK` are counts, and a count of one is what every product is and says nothing,
 * so they are said only from two. A count is also where
 * `UNIT_OF_MEASURE_FALLBACK` lands, so a unit this build has never heard of is
 * suppressed by the same rule. Zero and below are not sizes.
 *
 * One function for every card and row that names a product: the product card of
 * the catalog and the search, a zone list line and a shopping list row. A unit
 * this build has no words for answers null, so a key never reaches the screen.
 *
 * **A weight answers before a size, whatever the unit** (velista `0179`, target
 * state 2): a piece whose weight varies says "~1,56 kg", or "~395 g" under a
 * kilo, for a kilo piece and for a piece priced as one alike. The tilde is in
 * the translation, so a language can move it. The server refuses a weight beside
 * a size, so the two never meet.
 */
export function productSizeText(
  size: number | null,
  unit: string | null,
  locale: string,
  translate: SizeTranslate,
  approxWeight: number | null
): string | null {
  if (approxWeight !== null && approxWeight > 0) {
    return weightText(approxWeight, locale, translate);
  }
  if (size === null || size <= 0 || unit === null) {
    return null;
  }
  if ((unit === 'UNIT' || unit === 'PACK') && size < 2) {
    return null;
  }

  let number: string;
  try {
    number = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 3,
    }).format(size);
  } catch {
    number = String(size);
  }
  const key = `list.add.size.${unit}`;
  const text = translate(key, { size: number });
  return text === key ? null : text;
}

/** The approximate weight in grams as words: kilos from 1000, grams below. */
function weightText(
  grams: number,
  locale: string,
  translate: SizeTranslate
): string | null {
  const inKilos = grams >= 1000;
  const value = inKilos ? grams / 1000 : grams;
  let number: string;
  try {
    number = new Intl.NumberFormat(locale, {
      maximumFractionDigits: inKilos ? 2 : 0,
    }).format(value);
  } catch {
    number = String(
      inKilos ? Math.round(value * 100) / 100 : Math.round(value)
    );
  }
  const key = `list.add.weight.${inKilos ? 'KILOGRAM' : 'GRAM'}`;
  const text = translate(key, { size: number });
  return text === key ? null : text;
}

/**
 * What tells one product from another of the same name: its format, then its
 * brand, joined by the separator a row already uses. Null when the catalog knows
 * neither.
 */
export function productDetailText(
  product: {
    readonly size: number | null;
    readonly unit: string | null;
    readonly approxWeight: number | null;
    readonly brand: string | null;
  },
  locale: string,
  translate: SizeTranslate
): string | null {
  const parts = [
    productSizeText(
      product.size,
      product.unit,
      locale,
      translate,
      product.approxWeight
    ),
    product.brand,
  ].filter((part): part is string => part !== null && part.trim() !== '');
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * The brand, then the size: "Hacendado · 1 L", as the second line of a row of a
 * list draws them after the product's name (velista `0145`, section 3). Either
 * alone when the catalog knows only one, null with neither.
 */
export function productBrandSizeText(
  product: {
    readonly size: number | null;
    readonly unit: string | null;
    readonly approxWeight: number | null;
    readonly brand: string | null;
  },
  locale: string,
  translate: SizeTranslate
): string | null {
  const parts = [
    product.brand,
    productSizeText(
      product.size,
      product.unit,
      locale,
      translate,
      product.approxWeight
    ),
  ].filter((part): part is string => part !== null && part.trim() !== '');
  return parts.length === 0 ? null : parts.join(' · ');
}
