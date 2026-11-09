import {
  isPrintedLength,
  measuresContent,
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
 *
 * **A length is a dimension, not a size (plan 0183).** `30m` is how long the
 * roll is and `125x157cm` is the two sides of one tablecloth, so a size
 * printed in `m`, `cm` or `mm` answers no `unitSize` and no `packCount`. Only
 * a weight, a volume or a count is multiplied, and only its `N` is a pack.
 *
 * **A size field that states only a count takes the size of one unit from the
 * name (plan 0250, section 2.4).** `paté clásico 75g, pk-2` is two tins of
 * 75 g: 150 g, a pack of 2, the name `paté clásico`, and `sizeFormat` `75g
 * pk-2`, both printed texts with the name's first, so nothing the chain
 * printed is lost and the key is the same on every walk.
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
   * no size, which a length (`m`, `cm`, `mm`) is one case of.
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

/**
 * The size of one unit at the end of a name, `paté clásico 75g`: one quantity
 * and a weight or volume word (plan 0250, section 2.4).
 *
 * **One quantity and not `NxQ`.** `bacon en tiras family 2x100g, pk-2` states
 * its count twice, and which of the two the field's count is cannot be read,
 * so that name keeps today's answer, as a pack of packs does on Carrefour.
 */
const NAME_UNIT_SIZE =
  /(?:^|\s)(\d+(?:[.,]\d+)?\s*(?:g|gr|grs|kg|kgs|ml|cl|l|lt)\.?)$/i;

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
    const count = packCountOf(packOnly[1]);
    const ofOne = count === null ? null : unitSizeInName(name);
    if (count !== null && ofOne !== null) {
      return {
        name: ofOne.name,
        sizeFormat: `${ofOne.printed} ${sizeFormat}`,
        ...sourceSizeOf(round(count * ofOne.amount), ofOne.word),
        packCount: count,
        soldByWeight: false,
      };
    }
    return {
      name,
      sizeFormat,
      unitSize: null,
      sizeUnit: null,
      packCount: count,
      soldByWeight: false,
    };
  }

  const quantity = QUANTITY.exec(lower);
  if (quantity && UNITS.has(quantity[3]) && isPrintedLength(quantity[3])) {
    // The printed text is kept, because it is half of the row's key. The
    // number is not: it measures the object and not what is inside it.
    return {
      name,
      sizeFormat,
      unitSize: null,
      sizeUnit: null,
      packCount: null,
      soldByWeight: false,
    };
  }
  if (quantity && UNITS.has(quantity[3])) {
    const count = quantity[1] ? Number(quantity[1]) : null;
    const amount = Number(quantity[2].replace(',', '.'));
    return {
      name,
      sizeFormat,
      // The amount through the one conversion every adapter shares, so a
      // centilitre is written as ten millilitres here as it is everywhere.
      ...sourceSizeOf(round(count ? count * amount : amount), quantity[3]),
      packCount: measuresContent(quantity[3]) ? packCountOf(count) : null,
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
 * The size of one unit printed at the end of a name, or null when the name
 * ends in none or would be left empty.
 */
function unitSizeInName(
  name: string
): { name: string; printed: string; amount: number; word: string } | null {
  const match = NAME_UNIT_SIZE.exec(name);
  if (!match) {
    return null;
  }
  const rest = name.slice(0, name.length - match[0].length).trim();
  const quantity = QUANTITY.exec(match[1].toLowerCase());
  // `2 x 100g` is an `NxQ` printed with spaces, so it is refused as one.
  if (!rest || /\d\s*[x×]$/i.test(rest) || !quantity || quantity[1]) {
    return null;
  }
  return {
    name: rest,
    printed: match[1],
    amount: Number(quantity[2].replace(',', '.')),
    word: quantity[3],
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
