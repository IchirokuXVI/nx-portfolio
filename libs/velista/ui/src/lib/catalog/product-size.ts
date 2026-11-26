/** A translator call, so this stays a plain function a spec can run. */
export type SizeTranslate = (
  key: string,
  args?: Record<string, unknown>
) => string;

/**
 * The two counts a size prints with (velista `0209`, section 2): how many units
 * the pack holds and how many pieces the whole product holds, each a whole
 * number from 2 or null.
 */
export interface SizeCounts {
  readonly packCount: number | null;
  readonly pieceCount: number | null;
}

/**
 * No counts: for the places that print the total alone (velista `0209`, O3 A),
 * the default list view's first fact and the cost caption.
 */
export const NO_COUNTS: SizeCounts = { packCount: null, pieceCount: null };

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
 *
 * **Then the counts** (velista `0209`, section 2), from {@link SizeCounts}: the
 * total first, then the units of the pack, then the pieces, "70 g (2 × 35 g),
 * 100 piezas". One unit is the total divided by the pack, in the same unit word,
 * derived here and never stored. A unit that is not whole at the precision its
 * unit prints is rounded with a tilde, "185 g (7 × ~26 g)" (O1 A). A counted size
 * prints its units only when the division is whole. Where the size cannot carry
 * the pack (beside a weight, with no size, or a counted size that does not
 * divide), the pack prints as its own words, "Pack de 4", as it did before. A
 * caller that prints the total alone passes {@link NO_COUNTS}.
 */
export function productSizeText(
  size: number | null,
  unit: string | null,
  locale: string,
  translate: SizeTranslate,
  approxWeight: number | null,
  counts: SizeCounts
): string | null {
  const pack =
    counts.packCount !== null && counts.packCount >= 2
      ? counts.packCount
      : null;
  const pieces =
    counts.pieceCount !== null && counts.pieceCount >= 2
      ? counts.pieceCount
      : null;
  if (approxWeight !== null && approxWeight > 0) {
    return withPackWord(
      weightText(approxWeight, locale, translate),
      pack,
      translate
    );
  }
  const total = totalText(size, unit, locale, translate);
  if (total === null || size === null || unit === null) {
    return withPackWord(null, pack, translate);
  }
  const counted = unit === 'UNIT' || unit === 'PACK';
  let text = total;
  if (pack !== null) {
    const each = unitText(size / pack, unit, counted, locale, translate);
    if (each === null) {
      return withPackWord(total, pack, translate);
    }
    text = translate('list.add.size.packOf', {
      total,
      count: countText(pack, locale),
      each,
    });
  }
  if (pieces !== null && !counted) {
    text = translate('list.add.size.pieces', {
      size: text,
      count: countText(pieces, locale),
    });
  }
  return text;
}

/** The total as the server holds it: "360 g", "1000 ml", "12 uds", or null. */
function totalText(
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
  const key = `list.add.size.${unit}`;
  const text = translate(key, { size: numberText(size, 3, locale) });
  return text === key ? null : text;
}

/**
 * One unit of a pack in the total's unit word: plain when it is whole at the
 * precision the unit prints (no decimals for g and ml, up to three for kg and
 * L), else rounded to it with a tilde. A counted unit that does not divide
 * answers null, so the pack prints as its own words.
 */
function unitText(
  each: number,
  unit: string,
  counted: boolean,
  locale: string,
  translate: SizeTranslate
): string | null {
  if (counted && !Number.isInteger(each)) {
    return null;
  }
  const digits = unit === 'GRAM' || unit === 'MILLILITER' || counted ? 0 : 3;
  const scale = 10 ** digits;
  const rounded = Math.round(each * scale) / scale;
  if (rounded <= 0) {
    return null;
  }
  const key = `list.add.size.${unit}`;
  const text = translate(key, { size: numberText(rounded, digits, locale) });
  if (text === key) {
    return null;
  }
  return Math.abs(rounded - each) < 1e-9
    ? text
    : translate('list.add.size.about', { size: text });
}

/** The size, then the pack as its own words, or either alone. */
function withPackWord(
  size: string | null,
  pack: number | null,
  translate: SizeTranslate
): string | null {
  if (pack === null) {
    return size;
  }
  const word = translate('list.add.card.pack', { count: pack });
  return size === null
    ? word
    : translate('list.add.size.andPack', { size, pack: word });
}

function numberText(value: number, digits: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return String(value);
  }
}

function countText(count: number, locale: string): string {
  return numberText(count, 0, locale);
}

/**
 * The approximate weight in grams as words: kilos from 1000, grams below.
 * Decided on the grams as they are printed, so 999.6 g reads "~1 kg" and never
 * "~1.000 g".
 */
function weightText(
  grams: number,
  locale: string,
  translate: SizeTranslate
): string | null {
  const inKilos = Math.round(grams) >= 1000;
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

/** What the joined texts read of a product: its size, its counts and its brand. */
export interface SizedProduct extends SizeCounts {
  readonly size: number | null;
  readonly unit: string | null;
  readonly approxWeight: number | null;
  readonly brand: string | null;
}

/**
 * What tells one product from another of the same name: its format, then its
 * brand, joined by the separator a row already uses. Null when the catalog knows
 * neither.
 */
export function productDetailText(
  product: SizedProduct,
  locale: string,
  translate: SizeTranslate
): string | null {
  const parts = [
    productSizeText(
      product.size,
      product.unit,
      locale,
      translate,
      product.approxWeight,
      product
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
  product: SizedProduct,
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
      product.approxWeight,
      product
    ),
  ].filter((part): part is string => part !== null && part.trim() !== '');
  return parts.length === 0 ? null : parts.join(' · ');
}
