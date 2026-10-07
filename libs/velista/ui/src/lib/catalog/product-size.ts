/** A translator call, so this stays a plain function a spec can run. */
export type SizeTranslate = (
  key: string,
  args?: Record<string, unknown>
) => string;

/**
 * How big the packet is, as words, or null when there is nothing worth saying.
 *
 * The composer's rule (`SuggestionList.sizeOf`), for its reason: the catalog holds
 * one record per size, so the size is what tells two rows of one name apart, and a
 * count of one is what every product is and says nothing.
 *
 * One function for the rows that name a product outside the composer: the catalog
 * row, a zone list line and a shopping list row. A unit this build has no words
 * for answers null, so a key never reaches the screen.
 */
export function productSizeText(
  size: number | null,
  unit: string | null,
  locale: string,
  translate: SizeTranslate
): string | null {
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

/**
 * What tells one product from another of the same name: its format, then its
 * brand, joined by the separator a row already uses. Null when the catalog knows
 * neither.
 */
export function productDetailText(
  product: {
    readonly size: number | null;
    readonly unit: string | null;
    readonly brand: string | null;
  },
  locale: string,
  translate: SizeTranslate
): string | null {
  const parts = [
    productSizeText(product.size, product.unit, locale, translate),
    product.brand,
  ].filter((part): part is string => part !== null && part.trim() !== '');
  return parts.length === 0 ? null : parts.join(' · ');
}
