import type { ProductOffer } from './domain';
import { soldAs, soldAsOf, type SoldAs } from './sold-as';

/**
 * What a line's quantity counts (velista `0182`, backend `0246` section 1).
 *
 * Base units only: 750 g is 750 and 1,5 l is 1500, so every amount is an
 * integer and a kilo or a litre never reaches the wire. velista's own union,
 * mapped from `unknown` with `UNIT` as the fallback (rule D4).
 */
export type LineUnit = 'UNIT' | 'GRAM' | 'MILLILITER';

export const LINE_UNITS: readonly LineUnit[] = ['UNIT', 'GRAM', 'MILLILITER'];

/** What a line counts when nothing says otherwise: a free text line, an old row. */
export const LINE_UNIT_FALLBACK: LineUnit = 'UNIT';

/**
 * The unit a line for one product counts in (backend `0246` W2). Only a
 * product with no weight of its own is asked for by weight or volume: a kilo
 * piece counts pieces.
 */
export function lineUnitOf(kind: SoldAs): LineUnit {
  switch (kind) {
    case 'BY_THE_KILO':
      return 'GRAM';
    case 'BY_THE_LITRE':
      return 'MILLILITER';
    default:
      return 'UNIT';
  }
}

/**
 * {@link lineUnitOf} for a product that may not be known yet, read the way
 * {@link soldAsOf} reads it. A product with no record answers `UNIT`, which is
 * also what a free text add sends.
 */
export function lineUnitOfProduct(
  offer: Pick<ProductOffer, 'piecePrice'> | null,
  product: {
    readonly unit: string | null;
    readonly size: number | null;
    readonly approxWeight: number | null;
  } | null
): LineUnit {
  return lineUnitOf(soldAsOf(offer, product));
}

/** The amount a new line starts at in a unit: one piece, one kilo, one litre. */
export function defaultQuantity(unit: LineUnit): number {
  return isMeasured(unit) ? 1000 : 1;
}

/**
 * Whether the unit is a weight or a volume, which is drawn as an amount. Anything
 * else is a count, so a view model built before velista `0182` reads as one.
 */
export function isMeasured(unit: LineUnit | undefined): boolean {
  return unit === 'GRAM' || unit === 'MILLILITER';
}

/**
 * Where a weight or a volume moves from its fine step to its coarse one, and
 * where its words switch from grams to kilos (backend `0096`, section 4).
 */
export const QUANTITY_COARSE_FROM = 1000;

/** The fine step of each measured unit, below {@link QUANTITY_COARSE_FROM}. Each divides 1000. */
export const QUANTITY_FINE_STEP: Readonly<Record<LineUnit, number>> = {
  UNIT: 1,
  GRAM: 25,
  MILLILITER: 50,
};

/** The coarse step, from {@link QUANTITY_COARSE_FROM} on. A multiple of each fine step. */
export const QUANTITY_COARSE_STEP: Readonly<Record<LineUnit, number>> = {
  UNIT: 1,
  GRAM: 250,
  MILLILITER: 250,
};

/**
 * How far one step moves a quantity at `value` (velista `0182`, section 3): 1
 * for a count; the fine step below a thousand and the coarse step from it for a
 * weight or a volume.
 */
export function stepAt(value: number, unit: LineUnit): number {
  if (!isMeasured(unit)) {
    return 1;
  }
  return value >= QUANTITY_COARSE_FROM
    ? QUANTITY_COARSE_STEP[unit]
    : QUANTITY_FINE_STEP[unit];
}

/**
 * The value one step up or down from `value`, on the grid of the step that
 * applies there.
 *
 * Going up reads the step at `value`, going down the step just below it, so
 * down from 1000 lands on 975 (grams) and up from 975 on 1000: the boundary is
 * a value both steps reach, by the divisibility rule of backend `0096` section
 * 4. A value off the grid (a typed 1100) snaps onto it in the direction of the
 * step rather than carrying its offset. For a count the grid is every integer,
 * so a step is exactly ±1.
 */
export function stepFrom(
  value: number,
  unit: LineUnit,
  direction: 1 | -1
): number {
  if (direction === 1) {
    const step = stepAt(value, unit);
    return Math.floor(value / step) * step + step;
  }
  const step = stepAt(value - 1, unit);
  return Math.ceil(value / step) * step - step;
}

/**
 * `steps` whole steps from `value`, one at a time so a run that crosses the
 * boundary changes its step there, held inside `[min, max]`.
 */
export function stepsFrom(
  value: number,
  unit: LineUnit,
  steps: number,
  min: number,
  max: number
): number {
  let at = value;
  const direction = steps < 0 ? -1 : 1;
  for (let taken = 0; taken < Math.abs(steps); taken++) {
    const next = stepFrom(at, unit, direction);
    if (next > max) {
      return max;
    }
    if (next < min) {
      return min;
    }
    at = next;
  }
  return Math.min(max, Math.max(min, at));
}

/**
 * A product as {@link lineUnits} reads it (velista `0183`, section 1): the
 * fields `soldAs` reads, plus the size. `unit` is the unit the product was
 * created in, `size` its size in that unit, `approxWeight` one piece in grams.
 */
export interface LineUnitProduct {
  readonly unit: string | null;
  readonly size: number | null;
  readonly approxWeight: number | null;
}

/**
 * What a screen knows about the size fields of one product of a line:
 * `undefined` while its record is not read, `null` when the read answered
 * nothing (gone, or failed), the fields when it answered.
 */
export type LineUnitProductRead = LineUnitProduct | null | undefined;

/**
 * The units one product can serve a line in: its own unit, and the units its
 * weight or its size bridges to (backend `0246` section 1, "can also serve").
 *
 * velista's mirror of the contracts' `unitsServedBy`, kept by rule D4 as its
 * own copy. A sized pack serves grams or millilitres through its size, and a
 * piece with a weight serves grams. A legacy `LITER` or `KILOGRAM` size is read
 * in its base unit, as `lineAmount` reads it.
 */
export function unitsServedBy(product: LineUnitProduct): LineUnit[] {
  switch (soldAs(product.unit, product.size, product.approxWeight)) {
    case 'BY_THE_KILO':
      return ['GRAM'];
    case 'BY_THE_LITRE':
      return ['MILLILITER'];
    case 'KILO_PIECE':
      return ['UNIT', 'GRAM'];
    case 'PACK': {
      const bridge = packBridgeUnit(product);
      return bridge === null ? ['UNIT'] : ['UNIT', bridge];
    }
  }
}

/**
 * The units a line can count in, in the chip's order (`UNIT`, `GRAM`,
 * `MILLILITER`), for the products it holds (velista `0183`, target state 1;
 * backend `0246` W1, `lineUnitsOf`).
 *
 * The union of what each product serves. An empty set is a free text line,
 * which counts pieces, so it answers `UNIT` alone. Two entries or more is what
 * draws the chip.
 */
export function lineUnits(products: readonly LineUnitProduct[]): LineUnit[] {
  if (products.length === 0) {
    return ['UNIT'];
  }
  const served = new Set<LineUnit>();
  for (const product of products) {
    for (const unit of unitsServedBy(product)) {
      served.add(unit);
    }
  }
  return LINE_UNITS.filter((unit) => served.has(unit));
}

/** Whether this product can serve a line counted in `unit`. */
export function servesLineUnit(
  product: LineUnitProduct,
  unit: LineUnit
): boolean {
  return unitsServedBy(product).includes(unit);
}

/**
 * The line unit a `PACK` bridges to, or null: a size in grams or millilitres
 * (a `KILOGRAM` or `LITER` size read in its base unit), or a weight on a
 * counted product with no size. The same bridge `lineAmount` reads.
 */
function packBridgeUnit(
  product: LineUnitProduct
): 'GRAM' | 'MILLILITER' | null {
  const { size, unit, approxWeight } = product;
  if (size !== null) {
    if (!Number.isFinite(size) || size <= 0) {
      return null;
    }
    if (unit === 'GRAM' || unit === 'KILOGRAM') {
      return 'GRAM';
    }
    if (unit === 'MILLILITER' || unit === 'LITER') {
      return 'MILLILITER';
    }
    return null;
  }
  const counted = unit === 'UNIT' || unit === 'PACK';
  return counted &&
    approxWeight !== null &&
    Number.isFinite(approxWeight) &&
    approxWeight > 0
    ? 'GRAM'
    : null;
}
