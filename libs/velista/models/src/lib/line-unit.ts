import type { ProductOffer } from './domain';
import { soldAsOf, type SoldAs } from './sold-as';

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

/** A product's record, as far as reading what it is sold as needs it. */
interface UnitRecord {
  readonly unit: string | null;
  readonly size: number | null;
  readonly approxWeight: number | null;
}

/**
 * The unit a legacy line is corrected to, or null for a line that is not one
 * (backend `0246` M2).
 *
 * The migration left exactly one kind of row behind: a line for one product
 * sold by the kilo or the litre, stored in `UNIT`. That is the only case. Any
 * other disagreement between a line and its product (a loose product a curator
 * turned into a pack or a kilo piece, a line with several products) is the
 * server's to keep, so the line stays in its stored unit on screen and on the
 * wire. A product not read yet is no evidence either way.
 */
export function legacyLineUnit(
  line: { readonly unit: LineUnit; readonly itemIds: readonly string[] },
  productOf: (itemId: string) => UnitRecord | null
): LineUnit | null {
  if (line.unit !== 'UNIT' || line.itemIds.length !== 1) {
    return null;
  }
  const product = productOf(line.itemIds[0]);
  if (product === null) {
    return null;
  }
  const unit = lineUnitOfProduct(null, product);
  return isMeasured(unit) ? unit : null;
}

/**
 * The unit a line is drawn and stepped in (backend `0246` M2 and section 3.2).
 *
 * The stored unit, except on a {@link legacyLineUnit legacy line} at nothing,
 * which is drawn in its product's unit ("0 g"): zero is zero in every unit.
 * Above zero the stored number counts pieces, so it is drawn as stored ("×3"),
 * and its first write sends {@link defaultQuantity} in the product's unit
 * rather than read the old number in a new unit.
 */
export function shownLineUnit(
  line: {
    readonly unit: LineUnit;
    readonly quantity: number;
    readonly itemIds: readonly string[];
  },
  productOf: (itemId: string) => UnitRecord | null
): LineUnit {
  const legacy = legacyLineUnit(line, productOf);
  return legacy !== null && line.quantity === 0 ? legacy : line.unit;
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
