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
 * unit, the same way. A request that names the unit is written exactly as it
 * was sent: that is a person, or a tool whose answer the curation gate already
 * held to the base units, and an admin can still write any unit by hand.
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
    return { unitSize, unit: named.defaultUnit as UnitOfMeasure };
  }
  return toBaseUnit(
    unitSize,
    entry.sizeUnit ?? mapSizeFormat(entry.sizeFormat) ?? UnitOfMeasure.UNIT
  );
}
