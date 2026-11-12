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

/**
 * The amount a line moves to when its unit changes: one piece, one kilo, one
 * litre. An add no longer uses it (velista `0185`): see {@link addAmount}.
 */
export function defaultQuantity(unit: LineUnit): number {
  return isMeasured(unit) ? 1000 : 1;
}

/**
 * The amount an add asks for (velista `0185`, the owner's A2): one step of the
 * unit at the first add, 25 g, 25 ml or one piece. It is the server's own
 * default since backend `0260`, so an add that states it and one that does not
 * make the same line.
 *
 * Not the stepper's step: a count steps by ten from a thousand, which a first
 * add never reaches.
 */
export function addAmount(unit: LineUnit): number {
  return isMeasured(unit) ? 25 : 1;
}

/**
 * Whether the unit is a weight or a volume, which is drawn as an amount. Anything
 * else is a count, so a view model built before velista `0182` reads as one.
 */
export function isMeasured(unit: LineUnit | undefined): boolean {
  return unit === 'GRAM' || unit === 'MILLILITER';
}

/**
 * Where the words of an amount move up one name: grams to kilos, millilitres to
 * litres, a count to thousands (backend `0096`, section 4; velista `0188`, S4).
 * It is no longer where the step changes for a weight or a volume: from here the
 * short form reads hundredths of the top name, so {@link stepAt} keeps a count's
 * step at one of those hundredths.
 */
export const QUANTITY_COARSE_FROM = 1000;

/** The base step of each unit (the owner, 2026-11-11): 25 g, 25 ml, one piece. */
export const QUANTITY_STEP: Readonly<Record<LineUnit, number>> = {
  UNIT: 1,
  GRAM: 25,
  MILLILITER: 25,
};

/**
 * The steps a curator can give a product sold by the kilo or the litre, in base
 * units (backend `0261` S2): each divides 1000, so a kilo or a litre is a whole
 * number of steps. velista's own copy by rule D4; a served step off this list is
 * read as none.
 */
export const QUANTITY_STEPS: readonly number[] = [
  1, 5, 10, 25, 50, 100, 200, 250, 500, 1000,
];

/** Whether `value` is one of {@link QUANTITY_STEPS}. */
export function isQuantityStep(value: unknown): value is number {
  return typeof value === 'number' && QUANTITY_STEPS.includes(value);
}

/**
 * The base step at any amount: the product's step for a weight or a volume when
 * it has one (backend `0261` S1 and S4), else {@link QUANTITY_STEP}. A step passed
 * for a count is ignored: a count never reads a product's step.
 */
function baseStep(unit: LineUnit, step: number | null | undefined): number {
  if (isMeasured(unit) && typeof step === 'number' && step > 0) {
    return step;
  }
  return QUANTITY_STEP[unit] ?? 1;
}

/**
 * The most hundredths the short form reads of its top name (velista `0188`, S4):
 * "999,99", never "1000" of the top name.
 */
export const QUANTITY_SHORT_HUNDREDTHS_MAX = 99_999;

/**
 * The hundredths of the top name the short form reads at `quantity`, from
 * {@link QUANTITY_COARSE_FROM} on: half up on the integer, held under 1000 of the top
 * name (velista `0188`, section 2). In integers, so no floating point rounding can
 * move a digit. `shortAmount` draws this number and {@link canStepUp} compares it.
 */
export function shortHundredths(quantity: number): number {
  return Math.min(
    QUANTITY_SHORT_HUNDREDTHS_MAX,
    Math.floor((Math.round(quantity) + 5) / 10)
  );
}

/**
 * How far plus moves an amount at `value` (velista `0188`, S7b): the base step, but
 * never less than one hundredth of the name the short form shows there, so a press
 * always changes what a row reads. A count: 1 below 1000, 10 from 1000. A weight or
 * a volume: 25 everywhere, already more than the 10 that "1,25 kg" needs.
 *
 * `step` is the product's step (velista `0186`): it replaces the base for a weight
 * or a volume, and the hundredth rule still holds over it (decision F), so a step of
 * 1 or 5 is used below 1000 and becomes 10 from 1000.
 */
export function stepAt(
  value: number,
  unit: LineUnit,
  step?: number | null
): number {
  const base = baseStep(unit, step);
  return value >= QUANTITY_COARSE_FROM ? Math.max(base, 10) : base;
}

/**
 * One press from `value` (velista `0188`, S7b and decision B). Up adds the step at
 * `value`. Down takes away the step that plus uses one base step lower, so 1000
 * minus is 999 for a count and plus then minus always returns. No grid and no
 * snapping: a typed 1010 g goes to 1035 and back to 1010, and on a product step of
 * 100 a 975 goes to 1075 and to 875 (velista `0186`, decision D). Never under 0.
 */
export function stepFrom(
  value: number,
  unit: LineUnit,
  direction: 1 | -1,
  step?: number | null
): number {
  if (direction === 1) {
    return value + stepAt(value, unit, step);
  }
  const base = baseStep(unit, step);
  return Math.max(0, value - stepAt(Math.max(0, value - base), unit, step));
}

/**
 * Whether a plus at `value` stays within `max` and changes the short reading
 * (velista `0188`, S8). A plus that would pass the most is off and never clamps to
 * it; a count's plus is also off where the reading would not move (999 985 to
 * 999 989 read "999,99" before and after).
 */
export function canStepUp(
  value: number,
  unit: LineUnit,
  max: number,
  step?: number | null
): boolean {
  const next = stepFrom(value, unit, 1, step);
  if (next > max) {
    return false;
  }
  if (isMeasured(unit) || value < QUANTITY_COARSE_FROM) {
    return true;
  }
  return shortHundredths(next) !== shortHundredths(value);
}

/** One press or one repeat of a stepper, as the stepper drew it (velista `0188`). */
export interface QuantityStep {
  readonly from: number;
  readonly to: number;
  /** True for a step the hold made, false for a press, a key or a typed amount. */
  readonly repeat: boolean;
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
  /**
   * The curator's step, in base units (backend `0261`), or null for the default.
   * Optional so a record built before velista `0186` reads as one with no step.
   */
  readonly quantityStep?: number | null;
}

/**
 * The step a line is pressed by (backend `0261` section 5, velista `0186`), or
 * null for the default of its unit.
 *
 * Null for a count. Otherwise the members are the line's products that are read,
 * that serve the line's unit and that carry a step, and the answer is the
 * smallest of their steps (S5): the product a line counts as follows the cost of
 * the amount, so its step could change under a finger while stepping, and the
 * smallest does not. A product not read yet says nothing (decision B).
 */
export function lineStepOf(
  line: { readonly unit: LineUnit; readonly itemIds: readonly string[] },
  productOf: (itemId: string) => LineUnitProduct | null | undefined
): number | null {
  if (!isMeasured(line.unit)) {
    return null;
  }
  let smallest: number | null = null;
  for (const itemId of line.itemIds) {
    const product = productOf(itemId);
    const step = product?.quantityStep;
    if (!product || !isQuantityStep(step)) {
      continue;
    }
    if (!carriesStepFor(product, line.unit)) {
      continue;
    }
    if (smallest === null || step < smallest) {
      smallest = step;
    }
  }
  return smallest;
}

/**
 * True when a product's step can count on a line of this unit: the product is
 * sold by the kilo for a gram line or by the litre for a millilitre line
 * (backend `0261` S3). A pack and a kilo piece also serve grams, through their
 * size or weight, but count pieces, so a step left on one says nothing.
 */
function carriesStepFor(product: LineUnitProduct, unit: LineUnit): boolean {
  const kind = soldAs(product.unit, product.size, product.approxWeight);
  return (
    (kind === 'BY_THE_KILO' && unit === 'GRAM') ||
    (kind === 'BY_THE_LITRE' && unit === 'MILLILITER')
  );
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
