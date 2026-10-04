import {
  packCountOf,
  sourceSizeOf,
  type SourceSizeUnit,
} from '@portfolio/luna-shopper/contracts';

/**
 * The size after the last comma of a printed name (plan 0169, section 6).
 *
 * The chain prints every product as `name, size`: `arroz bomba, 1kg`,
 * `cerveza rubia, pk 6x33cl`, `plátano de canarias, kg`. The comma is the
 * chain's own separator, so the split is at the **last** comma and nothing is
 * guessed about where a size starts. A name with no comma states no size.
 *
 * The size is stored verbatim as `sizeFormat`. The number read from it is
 * `unitSize`, and `sizeUnit` is the catalog unit that number is in (plan
 * 0177), the way the LIDL adapter reads one: `6x33cl` is 1980 `MILLILITER`,
 * because the catalog holds no centilitre, and `1,5l` is 1.5 `LITER`. A form
 * that states no quantity (`ud`, `kg`, `pk 3`) answers null, because a sold by
 * weight row has no pack to measure and `ud` is a count, not a size.
 */
export interface ElJamonSize {
  /** The printed name without its size. Never empty. */
  name: string;
  /** Everything after the last comma, verbatim, or null. */
  sizeFormat: string | null;
  /** The quantity the size states, in {@link sizeUnit}, or null. */
  unitSize: number | null;
  /**
   * The catalog unit {@link unitSize} is in (plan 0177). Null when there is
   * no size, and for a length (`m`, `cm`, `mm`), which the catalog has no
   * unit for: that number stays as it was printed.
   */
  sizeUnit: SourceSizeUnit | null;
  /** How many units the pack holds (plan 0162), or null. */
  packCount: number | null;
  /** `kg` alone: the price is per kilogram and the pack has no fixed weight. */
  soldByWeight: boolean;
}

/** The units a size may be printed in, lower cased. A closed list, as DEZA's is. */
const UNITS = new Set([
  'g',
  'gr',
  'grs',
  'kg',
  'kgs',
  'ml',
  'cl',
  'l',
  'lt',
  'ud',
  'uds',
  'u',
  'm',
  'cm',
  'mm',
  'lavados',
  'dosis',
  'rollos',
  'bolsas',
  'capsulas',
  'cápsulas',
  'pastillas',
  'sobres',
  'hojas',
]);

/** `1kg`, `330ml`, `500g aprox.`, `1,5l`, `6x33cl`, `pk 6x33cl`, `2 x 1l`. */
const QUANTITY =
  /^(?:pk[\s-]*)?(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*([a-zá-ú]+)\.?(?:\s+aprox\.?)?$/i;

/** `pk 3`, `pk-2`, `pack 6`: a count and no size. */
const PACK_ONLY = /^(?:pk|pack)[\s-]*(\d+)$/i;

export function splitSize(printed: string): ElJamonSize {
  const text = printed.replace(/\s+/g, ' ').trim();
  const comma = lastSeparator(text);
  const name = comma === -1 ? text : text.slice(0, comma).trim();
  const sizeFormat = comma === -1 ? '' : text.slice(comma + 1).trim();
  if (!name || !sizeFormat) {
    return {
      name: name || text,
      sizeFormat: null,
      unitSize: null,
      sizeUnit: null,
      packCount: null,
      soldByWeight: false,
    };
  }

  const lower = sizeFormat.toLowerCase();
  const packOnly = PACK_ONLY.exec(lower);
  if (packOnly) {
    return {
      name,
      sizeFormat,
      unitSize: null,
      sizeUnit: null,
      packCount: packCountOf(packOnly[1]),
      soldByWeight: false,
    };
  }

  const quantity = QUANTITY.exec(lower);
  if (quantity && UNITS.has(quantity[3])) {
    const count = quantity[1] ? Number(quantity[1]) : null;
    const amount = Number(quantity[2].replace(',', '.'));
    return {
      name,
      sizeFormat,
      // The amount through the one conversion every adapter shares, so a
      // centilitre is written as ten millilitres here as it is everywhere.
      ...sourceSizeOf(round(count ? count * amount : amount), quantity[3]),
      packCount: packCountOf(count),
      soldByWeight: false,
    };
  }

  return {
    name,
    sizeFormat,
    unitSize: null,
    sizeUnit: null,
    packCount: null,
    // `kg` with no number: the row is priced per kilogram and weighed at the
    // till, which is what the unit price label `Kilo` says beside it.
    soldByWeight: lower === 'kg',
  };
}

/**
 * The last comma that separates the name from the size, or -1.
 *
 * A comma between two digits is a decimal one (`aceite, 1,5l`) and is skipped,
 * so the split lands before the size rather than inside it.
 */
function lastSeparator(text: string): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (
      text[index] === ',' &&
      !(/\d/.test(text[index - 1] ?? '') && /\d/.test(text[index + 1] ?? ''))
    ) {
      return index;
    }
  }
  return -1;
}

/** Three decimals, so `3x0,33` is 0.99 and not 0.9900000000000001. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
