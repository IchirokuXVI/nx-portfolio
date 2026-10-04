import {
  toBaseUnit,
  UnitOfMeasure,
  type BaseUnitSize,
} from '@portfolio/luna-shopper/contracts';
import { mapSizeFormat } from '@portfolio/luna-shopper/mercadona';
import type { SourceCatalogEntry } from '../entities';

/** The size and the unit an accept or a bulk create may name. */
export interface NamedSize {
  unitSize?: number | null;
  defaultUnit?: string;
}

/**
 * The size and the unit a product created from a source row is written with
 * (plan 0183). Both item creation paths call this, so they cannot disagree.
 *
 * **A size read from the row is written in a base unit.** The row states its
 * size in the unit its chain printed, so a Mercadona row is 0.25 `KILOGRAM`
 * and a LIDL row is 1.5 `LITER`. Written as they stand, one product on two
 * chains is 0.25 `KILOGRAM` here and 250 `GRAM` there, and the same product
 * in two units never matches itself. So the pair goes through `toBaseUnit`:
 * 250 `GRAM`, 1500 `MILLILITER`. A row with a kilogram and no size is a
 * product sold by weight, and that one stays `KILOGRAM`.
 *
 * The row's unit is the one it states (`sizeUnit`, plan 0177), then the guess
 * from the printed text for a row written before that plan, then `UNIT`.
 *
 * **A size the operation names is in the row's unit unless it names a unit
 * too.** A request that names a size and no unit is converted with the row's
 * unit, the same way. A request that names the unit gets that unit, whatever
 * it is: that is a person, or a tool whose answer the curation gate already
 * held to the base units, and an admin can still write any unit by hand.
 *
 * **A unit named alone takes the row's size with it.** The queue form sends
 * the unit by itself when the operator picks one and leaves the size as read,
 * so the number is still the row's and still in the row's unit. Written
 * beside the named unit as it stands, a row of 0.25 `KILOGRAM` and a request
 * for `GRAM` made a product of 0.25 grams. The row's size is therefore
 * expressed in the named unit when both measure the same kind of thing: 250
 * `GRAM`. When the row states no unit, or the two are of different kinds (a
 * weight row and a named `UNIT`), nothing can convert one into the other and
 * the row's number is written as it stands.
 */
export function createdSize(
  entry: Pick<SourceCatalogEntry, 'unitSize' | 'sizeUnit' | 'sizeFormat'>,
  named: NamedSize
): BaseUnitSize {
  const unitSize =
    named.unitSize === undefined
      ? entry.unitSize === null
        ? null
        : Number(entry.unitSize)
      : named.unitSize;
  if (named.defaultUnit !== undefined) {
    const unit = named.defaultUnit as UnitOfMeasure;
    return {
      unitSize:
        named.unitSize === undefined
          ? inUnit(unitSize, entry.sizeUnit, unit)
          : unitSize,
      unit,
    };
  }
  return toBaseUnit(
    unitSize,
    entry.sizeUnit ?? mapSizeFormat(entry.sizeFormat) ?? UnitOfMeasure.UNIT
  );
}

/** What one of each unit is worth in the smallest unit of its own kind. */
const MEASURES: Readonly<
  Partial<
    Record<
      UnitOfMeasure,
      { kind: 'weight' | 'volume' | 'count'; factor: number }
    >
  >
> = {
  [UnitOfMeasure.GRAM]: { kind: 'weight', factor: 1 },
  [UnitOfMeasure.KILOGRAM]: { kind: 'weight', factor: 1000 },
  [UnitOfMeasure.MILLILITER]: { kind: 'volume', factor: 1 },
  [UnitOfMeasure.LITER]: { kind: 'volume', factor: 1000 },
  [UnitOfMeasure.UNIT]: { kind: 'count', factor: 1 },
  [UnitOfMeasure.PACK]: { kind: 'count', factor: 1 },
};

/**
 * A size stated in `from`, expressed in `to`, when both are the same kind of
 * measure. Anything else answers the number as it came: a row with no unit,
 * a unit this table does not hold, or a weight against a count. Rounded to
 * four decimals, which is what the column stores.
 */
function inUnit(
  size: number | null,
  from: UnitOfMeasure | null,
  to: UnitOfMeasure
): number | null {
  const source = from === null ? undefined : MEASURES[from];
  const target = MEASURES[to];
  if (size === null || !source || !target || source.kind !== target.kind) {
    return size;
  }
  return Math.round(((size * source.factor) / target.factor) * 10_000) / 10_000;
}
