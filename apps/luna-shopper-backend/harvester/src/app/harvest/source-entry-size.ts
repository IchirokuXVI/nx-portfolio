import {
  toBaseUnit,
  UnitOfMeasure,
  type BaseUnitSize,
} from '@portfolio/luna-shopper/contracts';
import { mapSizeFormat } from '@portfolio/luna-shopper/mercadona';
import {
  ITEM_GRAMS_DETAIL,
  ITEM_UNIT_SIZE_DETAIL,
  ItemKilogramHasSizeException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { SourceCatalogEntry } from '../entities';

/** The size and the unit an accept or a bulk create may name. */
export interface NamedSize {
  unitSize?: number | null;
  defaultUnit?: string;
}

/**
 * The size and unit a product is created with, and the weight of one piece in
 * grams (plan 0244, section 5.6). The weight is null beside a size, and
 * whenever the operation names a size or a unit.
 */
export type CreatedSize = BaseUnitSize & { approxWeight: number | null };

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
 * **A row sold by weight creates a product by the kilo (plan 0181).** When
 * the operation names neither a size nor a unit, the product is `KILOGRAM`
 * with no size, whatever the row prints: a leaflet tile sold by the kilo can
 * print `pieza` or nothing at all, and the guess from that text is `UNIT`.
 * An operation that names a size or a unit is answered as below, because that
 * is a person saying the pack is fixed after all. A size named as null is not
 * a size: it says the same as naming none.
 *
 * **A row with a weight passes it on (plan 0244, section 5.6).** When the
 * operation names neither a size nor a unit, a row sold by weight answers
 * `KILOGRAM` with no size and the row's weight, and a row with no size and a
 * weight that is not sold by weight is a piece priced as one: `UNIT` with no
 * size and the row's weight. Any other answer carries no weight, and neither
 * does an operation that names a size or a unit.
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
 *
 * **A named `KILOGRAM` beside a size is refused, not converted** (plan 0237,
 * section 3.3). A product sold by the kilo has no size, and catalog refuses
 * the pair with `item_kilogram_has_size` on every product route. The
 * harvester asks the same question first, with the same code and the same
 * details, so the operator hears it before the row is touched, before the
 * barcode is looked up and before the chain is asked for an English name.
 * The pair is a contradiction, and nothing can tell which half the person
 * meant: 400 `KILOGRAM` is a 400 kilo product or a typo for 400 `GRAM`. A
 * conversion would decide that for them, and plan 0183 converts only what
 * the row states, never what a person names. A request that names
 * `KILOGRAM` with a null size, or over a row with no size, is a product sold
 * by weight and passes.
 */
export function createdSize(
  entry: Pick<
    SourceCatalogEntry,
    'unitSize' | 'sizeUnit' | 'sizeFormat' | 'soldByWeight' | 'approxWeight'
  > &
    Partial<Pick<SourceCatalogEntry, 'sizeDoubtImplied'>>,
  named: NamedSize
): CreatedSize {
  const doubt = sizeDoubtRefusal(entry, named);
  if (doubt !== null) {
    throw new ValidationException(doubt);
  }
  const namesNothing =
    (named.unitSize === undefined || named.unitSize === null) &&
    named.defaultUnit === undefined;
  const weight =
    entry.approxWeight === null || entry.approxWeight === undefined
      ? null
      : Number(entry.approxWeight);
  if (entry.soldByWeight === true && namesNothing) {
    return {
      unitSize: null,
      unit: UnitOfMeasure.KILOGRAM,
      approxWeight: weight,
    };
  }
  // A piece priced as one (plan 0244, section 5.6): no size, a weight, and
  // not sold by weight. Without this a row printed `kg` fell through
  // `toBaseUnit(null, KILOGRAM)` into a product sold by the kilo.
  if (
    namesNothing &&
    weight !== null &&
    (entry.unitSize === null || entry.unitSize === undefined)
  ) {
    return { unitSize: null, unit: UnitOfMeasure.UNIT, approxWeight: weight };
  }
  return { ...sizeOf(entry, named), approxWeight: null };
}

/**
 * Why a product cannot take its size from this row, or null when it can
 * (plan 0249, section 3).
 *
 * **A row whose own price and comparison price disprove its size gives no
 * size.** The ingest recorded a doubt (`sizeDoubtImplied`), and nothing can
 * tell which of the two figures is wrong: the chain prints wrong comparison
 * prices too. So the operation must name `unitSize`, and the refusal names
 * both sizes for the person who decides. A unit named alone still takes the
 * row's size, so it is refused as well, and so is a size named as null.
 *
 * An accept onto an existing product writes no size and never asks this.
 */
export function sizeDoubtRefusal(
  entry: Pick<SourceCatalogEntry, 'unitSize' | 'sizeUnit'> &
    Partial<Pick<SourceCatalogEntry, 'sizeDoubtImplied'>>,
  named: NamedSize
): string | null {
  if (
    entry.sizeDoubtImplied === null ||
    entry.sizeDoubtImplied === undefined ||
    (named.unitSize !== undefined && named.unitSize !== null)
  ) {
    return null;
  }
  const stated =
    entry.unitSize === null || entry.sizeUnit === null
      ? null
      : toBaseUnit(Number(entry.unitSize), entry.sizeUnit);
  const unit = stated?.unit ?? '';
  return (
    'The size of this row is in doubt: it states ' +
    `${stated?.unitSize ?? Number(entry.unitSize)} ${unit}, and its own ` +
    'price and comparison price imply ' +
    `${Number(entry.sizeDoubtImplied)} ${unit}. Name the product's ` +
    '`unitSize`: the size is not taken from this row.'
  );
}

/**
 * What a create request carries of the weight {@link createdSize} answered:
 * the weight with `approxWeightSetBy: 'SOURCE'`, or nothing at all. Nothing
 * rather than a null, so a product created from a row with no weight is
 * written as it was before plan 0244.
 */
export function createdWeight(size: CreatedSize): {
  approxWeight?: number;
  approxWeightSetBy?: 'SOURCE';
} {
  return size.approxWeight === null
    ? {}
    : { approxWeight: size.approxWeight, approxWeightSetBy: 'SOURCE' };
}

/** The pair a create is written with, before plan 0244 added the weight. */
function sizeOf(
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
    return requireNoSizeOnKilogram({
      unitSize:
        named.unitSize === undefined
          ? inUnit(unitSize, entry.sizeUnit, unit)
          : unitSize,
      unit,
    });
  }
  return toBaseUnit(
    unitSize,
    entry.sizeUnit ?? mapSizeFormat(entry.sizeFormat) ?? UnitOfMeasure.UNIT
  );
}

/**
 * The pair as it came, unless it is a `KILOGRAM` with a size: that one is
 * refused with `item_kilogram_has_size`, whose details name the size and the
 * grams it would be, as catalog's `requireBaseUnit` names them (plan 0237,
 * section 3.3). Only a pair a person named reaches here; the pairs the row
 * states go through `toBaseUnit`, which never answers a sized `KILOGRAM`.
 */
function requireNoSizeOnKilogram(size: BaseUnitSize): BaseUnitSize {
  if (size.unit !== UnitOfMeasure.KILOGRAM || size.unitSize === null) {
    return size;
  }
  const grams = toBaseUnit(size.unitSize, UnitOfMeasure.KILOGRAM).unitSize;
  throw new ItemKilogramHasSizeException(
    `A product sold by the kilo has no size: send a null size, or ` +
      `${grams} ${UnitOfMeasure.GRAM}.`,
    {
      details: {
        [ITEM_UNIT_SIZE_DETAIL]: size.unitSize,
        [ITEM_GRAMS_DETAIL]: grams,
      },
    }
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
