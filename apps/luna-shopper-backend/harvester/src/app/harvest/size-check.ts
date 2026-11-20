import {
  toBaseUnit,
  UnitOfMeasure,
  type SourceSizeUnit,
} from '@portfolio/luna-shopper/contracts';

/**
 * Whether a source row's stated size is the size its own price and
 * comparison price imply (plan 0249).
 *
 * Every priced chain prints a comparison price beside the price: a price per
 * kilo, per litre or per unit. The price divided by it is the size the chain
 * itself is pricing. When that and the stated size disagree, one of the two
 * figures is wrong, and nothing here can tell which: the chain prints wrong
 * comparison prices too. So the answer is evidence and nothing more. The
 * ingest records it as a doubt on the row, and a person decides.
 *
 * Pure: no request, no repository, no framework. The check costs nothing.
 */

/** What a comparison figure is measured in. */
export type SizeDimension = 'mass' | 'volume' | 'count';

/** What a label says its figure is the price of, in base units. */
export interface LabelAmount {
  dimension: SizeDimension;
  /** Grams, millilitres or units. */
  per: number;
}

/**
 * The labels the chains print, keyed by {@link labelKey} (plan 0249, section
 * 1). A label that is not here answers no check, never a guess: `lv`,
 * `lavado`, `m`, `metro` and a blank label among them.
 *
 * `100 ml` is read as per 100 ml, which is what it says. `unitBasisOf` maps it
 * to `LITER`, and this table does not follow it, because this one states the
 * amount the figure is per and not a basis. After plan 0189 the Mercadona
 * normalizer writes `L` or `kg` for a figure it proved to be per litre or per
 * kilo, so a stored Mercadona `100 ml` is a figure it could not prove.
 *
 * El Jamón's `LABEL_QUANTITIES` (`libs/luna-shopper/eljamon/src/lib/price.ts`)
 * reads four of these keys for the same purpose. A shared table would live in
 * the contracts units module beside `toBaseUnit`.
 */
const LABEL_AMOUNTS: Readonly<Record<string, LabelAmount>> = {
  kg: { dimension: 'mass', per: 1000 },
  kilo: { dimension: 'mass', per: 1000 },
  '100 g': { dimension: 'mass', per: 100 },
  '100g': { dimension: 'mass', per: 100 },
  '100gr': { dimension: 'mass', per: 100 },
  '100 gr': { dimension: 'mass', per: 100 },
  g: { dimension: 'mass', per: 1 },
  l: { dimension: 'volume', per: 1000 },
  litro: { dimension: 'volume', per: 1000 },
  '100 ml': { dimension: 'volume', per: 100 },
  '100ml': { dimension: 'volume', per: 100 },
  ud: { dimension: 'count', per: 1 },
  unidad: { dimension: 'count', per: 1 },
  docena: { dimension: 'count', per: 12 },
};

/**
 * The tolerance of plan 0249, D3: about 15% either way, wide enough for a
 * chain's rounding on a small pack (0.16 kg at two decimals).
 */
export const SIZE_AGREES_WITHIN = { low: 0.85, high: 1.18 } as const;

/**
 * A ratio this close to a whole number, relative to that number, is a
 * probable pack count (plan 0249, section 2): the Carrefour beer pack of 28
 * cans stated at the size of one.
 */
const PACK_COUNT_ROOM = 0.02;
const PACK_COUNT_MIN = 2;
const PACK_COUNT_MAX = 48;

/**
 * A label as the table keys it: lower cased and trimmed, a leading `€/` and a
 * trailing full stop removed, inner spaces collapsed. `€/100ml` is `100ml`,
 * `100 ML.` is `100 ml`, `KILO` is `kilo`.
 */
export function labelKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/^€\s*\/\s*/, '')
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What a printed label's figure is the price of, or null for a label not known. */
export function labelAmount(
  label: string | null | undefined
): LabelAmount | null {
  if (label === null || label === undefined) {
    return null;
  }
  const key = labelKey(label);
  return Object.prototype.hasOwnProperty.call(LABEL_AMOUNTS, key)
    ? LABEL_AMOUNTS[key]
    : null;
}

/** One price as the check reads it. Numbers may come as numeric column text. */
export interface SizeCheckPrice {
  price: number | string | null;
  unitPrice: number | string | null;
  unitPriceLabel: string | null;
}

/** What the check reads of a row or an observation. */
export interface SizeCheckInput {
  unitSize: number | string | null;
  sizeUnit: SourceSizeUnit | null;
  packCount?: number | null;
  soldByWeight?: boolean | null;
  approxWeight?: number | string | null;
  prices: readonly SizeCheckPrice[];
}

/** The answer for one row that could be checked. */
export interface SizeVerdict {
  agrees: boolean;
  /** The stated size in base units, for the whole pack (plan 0162). */
  stated: number;
  /** `price / unitPrice × per`, in the same base unit. */
  implied: number;
  /** `implied / stated`. */
  ratio: number;
  /** The label as the chain printed it. */
  label: string;
  /**
   * The whole number the ratio is within 2% of, from 2 to 48, on a row that
   * disagrees and states no pack count. Null otherwise.
   */
  probablePackCount: number | null;
}

/**
 * The verdict on a row's size, or null when there is nothing to judge by.
 *
 * Null for a row sold by weight and for a piece with an approximate weight
 * (plan 0244): their comparison price is the price itself or per piece. Null
 * as well for no size, no unit, and when no price has a price and a
 * comparison price above zero under a known label of the size's dimension. A
 * count label compares only with a size in `UNIT`.
 *
 * **A row agrees when any of its prices agrees.** A chain that prints one
 * product at several scopes prints one comparison figure for each, and one
 * figure that fits the size is enough to keep the size out of doubt. A
 * disagreeing row answers its first disagreeing price.
 */
export function checkSize(input: SizeCheckInput): SizeVerdict | null {
  if (input.soldByWeight === true || present(input.approxWeight)) {
    return null;
  }
  if (input.sizeUnit === null || !present(input.unitSize)) {
    return null;
  }
  const base = toBaseUnit(Number(input.unitSize), input.sizeUnit);
  const dimension = dimensionOf(base.unit);
  if (base.unitSize === null || base.unitSize <= 0 || dimension === null) {
    return null;
  }
  const stated = base.unitSize;

  let firstDisagreeing: SizeVerdict | null = null;
  for (const price of input.prices) {
    const amount = labelAmount(price.unitPriceLabel);
    const till = toPositive(price.price);
    const perLabel = toPositive(price.unitPrice);
    if (
      amount === null ||
      amount.dimension !== dimension ||
      till === null ||
      perLabel === null
    ) {
      continue;
    }
    const implied = (till / perLabel) * amount.per;
    const ratio = implied / stated;
    const agrees =
      ratio >= SIZE_AGREES_WITHIN.low && ratio <= SIZE_AGREES_WITHIN.high;
    const verdict: SizeVerdict = {
      agrees,
      stated,
      implied: round(implied, 4),
      ratio: Number(ratio.toPrecision(6)),
      label: price.unitPriceLabel as string,
      probablePackCount:
        agrees || present(input.packCount) ? null : packCountNear(ratio),
    };
    if (agrees) {
      return verdict;
    }
    firstDisagreeing ??= verdict;
  }
  return firstDisagreeing;
}

/** The whole number from 2 to 48 a ratio is within 2% of, or null. */
function packCountNear(ratio: number): number | null {
  const whole = Math.round(ratio);
  if (whole < PACK_COUNT_MIN || whole > PACK_COUNT_MAX) {
    return null;
  }
  return Math.abs(ratio - whole) <= whole * PACK_COUNT_ROOM ? whole : null;
}

/**
 * The dimension a base unit measures, or null for a unit the check does not
 * compare (`KILOGRAM` with no size, `PACK` before `toBaseUnit`).
 */
export function dimensionOf(unit: UnitOfMeasure): SizeDimension | null {
  switch (unit) {
    case UnitOfMeasure.GRAM:
      return 'mass';
    case UnitOfMeasure.MILLILITER:
      return 'volume';
    case UnitOfMeasure.UNIT:
      return 'count';
    default:
      return null;
  }
}

function present(value: number | string | null | undefined): boolean {
  return value !== null && value !== undefined;
}

function toPositive(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
