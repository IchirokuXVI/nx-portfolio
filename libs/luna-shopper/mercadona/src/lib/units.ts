import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';

/**
 * `size_format` mapped onto `UnitOfMeasure` (plan 0038, section 2.4). Four values
 * were observed across the whole assortment: `kg` (2,369), `l` (1,317), `ud`
 * (544) and `m` (2).
 *
 * **`m` maps to nothing on purpose.** It is metres, and it appears on two
 * products: foil and cling film. Adding a METER value to a wire enum every
 * service shares, for two products, costs more than not importing them; section
 * 5.6 recommends skipping them, and a null unit is how a caller sees that.
 */
const SIZE_FORMATS: Record<string, UnitOfMeasure> = {
  kg: UnitOfMeasure.KILOGRAM,
  g: UnitOfMeasure.GRAM,
  l: UnitOfMeasure.LITER,
  ml: UnitOfMeasure.MILLILITER,
  ud: UnitOfMeasure.UNIT,
};

export function mapSizeFormat(sizeFormat: string | null): UnitOfMeasure | null {
  if (!sizeFormat) {
    return null;
  }
  return SIZE_FORMATS[sizeFormat.trim().toLowerCase()] ?? null;
}

/** Whether this product can be represented at all. See the `m` note above. */
export function isImportableSizeFormat(sizeFormat: string | null): boolean {
  return sizeFormat === null || mapSizeFormat(sizeFormat) !== null;
}
