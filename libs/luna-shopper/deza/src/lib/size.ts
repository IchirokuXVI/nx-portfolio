import { packCountOf } from '@portfolio/luna-shopper/contracts';

/**
 * Splitting the trailing size off a description (plan 0085, section 7).
 *
 * **Why this exists at all.** A leaflet offer arrives with `product.name` and
 * `product.format.raw` already separate, and plan 0081 section 2.1 keys an alias
 * on `normalizeName(name) + '|' + normalizeName(format)`. A crawl that left the
 * whole description in `name` could never meet a leaflet: `refresco pepsi 1 75 l|`
 * and `pepsi regular o zero|1 75 l` do not collide, and no amount of fuzzy
 * matching fixes a key that was built wrong. So both sources have to produce keys
 * of one shape, and this is the half that does it for the web listing.
 *
 * **The size is stored verbatim.** `28+16 lavados` stays `28+16 lavados` and is
 * not rewritten into its sum, even though the leaflet prints `44 lavados` for the
 * same product. Expanding `a+b` before comparing belongs to the matcher, and
 * rewriting here would destroy what the chain printed, which is the thing plan
 * 0081 section 2 is built to preserve.
 */

/**
 * The units a trailing size may end in, lower cased.
 *
 * **It is a closed list on purpose.** The alternative, "a number followed by any
 * short word", reads `Croissant cacao DULCESOL kg tecla 21` as a size of `21` and
 * `Rosquillo 0% azúcar EL CATETO kg tecla 36` as one of `36`, because the bakery
 * rows end in a till key number. An unrecognised trailing token therefore leaves
 * the whole description in the name and states no size, which is the honest
 * answer: a missing size is a weaker key, an invented one is a wrong key.
 *
 * Every entry here was seen in the listing on 2026-09-04 or is the obvious
 * spelling variant of one that was.
 */
export const DEZA_SIZE_UNITS: readonly string[] = [
  // Volume
  'l',
  'ml',
  'cl',
  'dl',
  'cc',
  'litro',
  'litros',
  // Weight
  'g',
  'gr',
  'grs',
  'gramos',
  'k',
  'kg',
  'kgs',
  'kilo',
  'kilos',
  'mg',
  // Count
  'ud',
  'uds',
  'unid',
  'unids',
  'unidad',
  'unidades',
  'piezas',
  'docena',
  // Length
  'm',
  'cm',
  'mm',
  'metros',
  // What the chain counts a household product in
  'lavado',
  'lavados',
  'dosis',
  'capsulas',
  'cápsulas',
  'sobres',
  'rollos',
  'bolsas',
  'pastillas',
  'hojas',
  'platos',
  'raciones',
];

const UNIT_SET = new Set(DEZA_SIZE_UNITS);

/**
 * A quantity: one number, or several joined by `x` or `+`.
 *
 * `3x187`, `5x30`, `28+16`, `330+165`, `1.75`, `1,5`. The separators are kept
 * because the size is stored verbatim; only the split point is decided here.
 */
const QUANTITY = String.raw`\d+(?:[.,]\d+)?(?:\s*[x+]\s*\d+(?:[.,]\d+)?)*`;

/** A quantity, optional space, then one word, anchored at the end. */
const TRAILING_SIZE = new RegExp(
  String.raw`(^|\s)(${QUANTITY})\s*([A-Za-zÀ-ſ]{1,10})\s*$`
);

export interface SplitDescription {
  /** The description without its trailing size. Never empty. */
  name: string;
  /** The trailing size, exactly as printed, or null. */
  sizeFormat: string | null;
}

/**
 * Split `Vino blanco DON SIMON brik 1 L` into `Vino blanco DON SIMON brik` and
 * `1 L`.
 *
 * Only the **last** size is taken, because that is where the chain puts the one
 * that describes the package: `Hermético takeaway CURVER 1.1 L 5 ud` splits to
 * `5 ud`, leaving the `1.1 L` in the name where the chain wrote it. A size in
 * the middle of a description (`Hermético azul TATAY 0.5 l ovalado`) is not a
 * trailing size and is left alone.
 */
export function splitSize(description: string): SplitDescription {
  const trimmed = description.replace(/\s+/g, ' ').trim();
  const match = TRAILING_SIZE.exec(trimmed);
  if (!match) {
    return { name: trimmed, sizeFormat: null };
  }
  const unit = match[3].toLowerCase();
  if (!UNIT_SET.has(unit)) {
    return { name: trimmed, sizeFormat: null };
  }
  const start = match.index + match[1].length;
  const name = trimmed.slice(0, start).trim();
  // A description that is nothing but a size keeps its description as the name:
  // an empty name is not a product, and the key it would build joins nothing.
  if (!name) {
    return { name: trimmed, sizeFormat: null };
  }
  return { name, sizeFormat: trimmed.slice(start).trim() };
}

/** One count times one quantity and a unit, `3x187 ml`, and nothing else. */
const COUNT_TIMES_QUANTITY =
  /^(\d+)\s*x\s*\d+(?:[.,]\d+)?\s*[A-Za-zÀ-ſ]{1,10}$/i;

/**
 * A pack phrase at the end of what is left once the size is split off:
 * `pack de 8`, `pack 6`, `pack de 8 latas de`. The counted noun is optional and
 * so is the `de` that joins the phrase to the size.
 */
const TRAILING_PACK =
  /(?:^|\s)pack\s+(?:de\s+)?(\d+)(?:\s+[A-Za-zÀ-ÿ]{2,12})?(?:\s+de)?$/i;

/**
 * How many units the pack holds (plan 0162, section 1).
 *
 * Two shapes state it: the `N` of a trailing `NxQ` size, `3x187 ml`, and the
 * count of a `pack de N ...` phrase just before the trailing size, or at the
 * very end when the description states no size. A description that states both
 * is null, because it prints a pack of packs and neither number alone is the
 * count. Everything else is null, a summed `23+12 lavados` and a bare `6 ud`
 * included: the first is a sum and the second is a size, and reading either as
 * a pack is the guess the plan refuses. Proved by the `3x187 ml` row of
 * `landing-page.html` and by the literals in `size.spec.ts`.
 */
export function packCountIn(description: string): number | null {
  const { name, sizeFormat } = splitSize(description);
  const multiplied = sizeFormat ? COUNT_TIMES_QUANTITY.exec(sizeFormat) : null;
  const phrase = TRAILING_PACK.exec(name);
  if (multiplied && phrase) {
    return null;
  }
  return packCountOf(multiplied?.[1] ?? phrase?.[1] ?? null);
}
