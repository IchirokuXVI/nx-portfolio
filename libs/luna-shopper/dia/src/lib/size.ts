import {
  sourceSizeOf,
  type SourceSizeUnit,
} from '@portfolio/luna-shopper/contracts';

/**
 * The format printed at the end of a DIA product name (plan 0174, section
 * 6.4).
 *
 * DIA has no size field. It prints the format as the last words of
 * `display_name`: `Coca-Cola 2 L`, `Agua mineral Bezoya pack 6 x 1,5 L`,
 * `Coca-Cola 12 x 330 ml`, `Manzana roja granel 800 g aprox.`. So the split is
 * at that trailing format and nowhere else, and a word such as `bandeja` or
 * `granel` before it stays in the name, because it says how the product is
 * sold and not how much of it there is.
 *
 * The removed text is `sizeFormat`, verbatim. The number read from it is
 * `unitSize`, and `sizeUnit` is the catalog unit that number is in (plan
 * 0177), the way the El Jamón adapter reads one: `6 x 1,5 L` is 9 `LITER` and
 * `75 cl` is 750 `MILLILITER`, because the catalog holds no centilitre. A name
 * whose end the parser cannot read keeps the whole name and states no size.
 */
export interface DiaSize {
  /** The printed name without its format. Never empty. */
  name: string;
  /** The trailing format, verbatim, or null. */
  sizeFormat: string | null;
  /** The quantity the format states, in {@link sizeUnit}, or null. */
  unitSize: number | null;
  /**
   * The catalog unit {@link unitSize} is in (plan 0177). Null when there is
   * no size, and for a length (`m`, `cm`), which the catalog has no unit for:
   * that number stays as it was printed.
   */
  sizeUnit: SourceSizeUnit | null;
  /**
   * How many units the name prints before an `x`, or null. The raw count: the
   * caller applies the bounds every source shares (plan 0162).
   */
  packCount: number | null;
  /** `aprox.`: the pack has no fixed weight and the price is per kilogram. */
  approximate: boolean;
}

/** The units a format may be printed in, lower cased. A closed list. */
const UNITS = new Set([
  'g',
  'gr',
  'kg',
  'mg',
  'ml',
  'cl',
  'l',
  'm',
  'cm',
  'ud',
  'uds',
  'unidad',
  'unidades',
  'lavados',
  'dosis',
  'rollos',
  'capsulas',
  'cápsulas',
  'sobres',
  'pastillas',
  'servicios',
]);

/**
 * `2 L`, `1,5 L`, `1.3 Kg aprox.`, `12 x 330 ml`, `pack 6 x 1,5 L`. The format
 * starts at a word boundary, so `Zumo B12 1 L` splits before `1 L`.
 */
const FORMAT =
  /(?:^|\s)((?:pack\s+)?(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*([a-zá-úñ]+)\.?(\s+aprox\.?)?)$/i;

export function splitSize(printed: string): DiaSize {
  const text = printed.replace(/\s+/g, ' ').trim();
  const match = FORMAT.exec(text);
  if (!match || !UNITS.has(match[4].toLowerCase())) {
    return unsized(text);
  }
  const name = text.slice(0, match.index).trim();
  if (!name) {
    return unsized(text);
  }
  const count = match[2] ? Number(match[2]) : null;
  const amount = Number(match[3].replace(',', '.'));
  return {
    name,
    sizeFormat: match[1],
    ...sourceSizeOf(round(count ? count * amount : amount), match[4]),
    packCount: count,
    approximate: match[5] !== undefined,
  };
}

function unsized(text: string): DiaSize {
  return {
    name: text,
    sizeFormat: null,
    unitSize: null,
    sizeUnit: null,
    packCount: null,
    approximate: false,
  };
}

/** Three decimals, so `3 x 0,33` is 0.99 and not 0.9900000000000001. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
