import { UnitOfMeasure } from '../enums/catalog.enums';
import { toBaseUnit } from './source-size';

/**
 * What a line's `quantity` counts (plan 0246, section 1). Base units only: a
 * weight is grams and a volume is millilitres, so 750 g is 750 and 1.5 l is
 * 1500, and every amount is an integer. Kilos and litres never reach the wire
 * or a column.
 *
 * Its own vocabulary (plan 0246 M1). `UnitOfMeasure` says what a size is
 * measured in and `ComparableBasis` (plan 0245) what a price is per. What a
 * line counts in is a third thing.
 *
 * Browser reachable, as the rest of `units/` is: it names no `process`.
 */
export const LINE_UNITS = ['UNIT', 'GRAM', 'MILLILITER'] as const;
export type LineUnit = (typeof LINE_UNITS)[number];

/**
 * How a product is sold, from its size fields (plan 0244 section 1, plus
 * volume; plan 0246 section 1).
 *
 * - `PACK`: a fixed pack, a counted product, or a piece priced as one (a `UNIT`
 *   product with a weight). `price` is one of what the row names.
 * - `BY_THE_KILO`: `KILOGRAM`, no size, no weight. `price` is a kilo.
 * - `BY_THE_LITRE`: `LITER`, no size. `price` is a litre.
 * - `KILO_PIECE`: `KILOGRAM`, no size, a weight. `price` is a kilo, and the
 *   offer's `piecePrice` is one piece.
 *
 * The server's twin of velista's `soldAs` (velista `0179`), with
 * `BY_THE_LITRE` added for symmetry.
 */
export type ProductKind =
  | 'PACK'
  | 'BY_THE_KILO'
  | 'BY_THE_LITRE'
  | 'KILO_PIECE';

/**
 * The size fields of a product, as catalog serves them: the unit it was
 * created in, its size in that unit, and the weight of one piece in grams.
 */
export interface ProductSizing {
  defaultUnit: UnitOfMeasure;
  unitSize: number | null;
  approxWeight: number | null;
}

/** How a product is sold (plan 0246, section 1). */
export function productKindOf(p: ProductSizing): ProductKind {
  if (p.unitSize !== null) {
    return 'PACK';
  }
  if (p.defaultUnit === UnitOfMeasure.KILOGRAM) {
    return hasWeight(p.approxWeight) ? 'KILO_PIECE' : 'BY_THE_KILO';
  }
  if (p.defaultUnit === UnitOfMeasure.LITER) {
    return 'BY_THE_LITRE';
  }
  return 'PACK';
}

/**
 * The unit a line for this one product counts in (plan 0246 W2). Its kind
 * decides: only a product with no weight of its own is asked for by weight or
 * volume, and a kilo piece counts pieces.
 */
export function lineUnitOf(kind: ProductKind): LineUnit {
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
 * The units one product can serve a line in: its own unit, and the units its
 * weight or its size bridges to (plan 0246 section 1, "can also serve"; W4).
 *
 * The size is read in its base unit through {@link toBaseUnit}, as plan 0245
 * does, so a legacy `LITER` size is millilitres and a `KILOGRAM` size grams.
 */
export function unitsServedBy(product: ProductSizing): LineUnit[] {
  const kind = productKindOf(product);
  switch (kind) {
    case 'BY_THE_KILO':
      return ['GRAM'];
    case 'BY_THE_LITRE':
      return ['MILLILITER'];
    case 'KILO_PIECE':
      return ['UNIT', 'GRAM'];
    case 'PACK': {
      const bridge = packBridgeOf(product);
      return bridge === null ? ['UNIT'] : ['UNIT', bridge.unit];
    }
  }
}

/**
 * The units a line can count in, in picker order (`UNIT`, `GRAM`,
 * `MILLILITER`), for the products it holds (plan 0246 W1, section 1).
 *
 * The union of what each product serves. A line with no product is a free
 * text line and counts pieces, so an empty set answers `UNIT` alone.
 *
 * **It takes the products, not their kinds.** The plan's sketch names
 * `kinds`, and its table needs the size: a pack of 500 g serves a weight line
 * and a pack of six eggs does not, and both are a `PACK`.
 */
export function lineUnitsOf(products: readonly ProductSizing[]): LineUnit[] {
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

/**
 * The amount a new line starts at in a unit (plan 0246 M4): one piece, one
 * kilo, one litre.
 */
export function defaultQuantityOf(unit: LineUnit): number {
  return unit === 'UNIT' ? 1 : 1000;
}

/** Whether the value is a {@link LineUnit}. */
export function isLineUnit(value: unknown): value is LineUnit {
  return (LINE_UNITS as readonly unknown[]).includes(value);
}

/**
 * What one pack or one piece of a `PACK` weighs or holds in a line unit, or
 * null when it bridges to none.
 *
 * A size in grams or millilitres bridges through the size. A counted product
 * with no size bridges through its weight when it has one, which is a piece
 * priced as one. A counted pack with a size bridges to nothing.
 * Internal to `units/`: {@link lineAmountOf} reads the same bridge.
 */
export function packBridgeOf(
  product: ProductSizing
): { unit: 'GRAM' | 'MILLILITER'; amount: number } | null {
  const base = toBaseUnit(product.unitSize, product.defaultUnit);
  if (base.unitSize !== null && base.unitSize > 0) {
    if (base.unit === UnitOfMeasure.GRAM) {
      return { unit: 'GRAM', amount: base.unitSize };
    }
    if (base.unit === UnitOfMeasure.MILLILITER) {
      return { unit: 'MILLILITER', amount: base.unitSize };
    }
  }
  if (
    base.unitSize === null &&
    base.unit === UnitOfMeasure.UNIT &&
    hasWeight(product.approxWeight)
  ) {
    return { unit: 'GRAM', amount: product.approxWeight };
  }
  return null;
}

function hasWeight(weight: number | null): weight is number {
  return weight !== null && Number.isFinite(weight) && weight > 0;
}
