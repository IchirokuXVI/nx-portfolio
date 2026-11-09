import { isMeasured, type LineUnit } from './line-unit';
import { soldAs, type SoldAs } from './sold-as';

/**
 * What a line's amount costs with one product (velista `0182`, section 1;
 * backend `0246`, section 2).
 *
 * velista's mirror of `lineAmountOf` in the contracts, row for row, kept by
 * rule D4 as its own copy rather than an import. `line-amount.spec.ts` beside
 * this file is the same table as the backend's spec.
 */
export interface LineAmount {
  /** Integer cents, rounded half up once at the end. */
  readonly cents: number;
  /** False only for a count of pieces or packs at a piece or pack price. */
  readonly estimated: boolean;
  /** Set when a weight or volume was served by whole pieces or packs. */
  readonly pieces: number | null;
}

/**
 * A product as {@link lineAmount} reads it: how it is sold, and its size fields
 * as velista's catalog models carry them (`unit` is the unit it was created
 * in, `size` its size in that unit, `approxWeight` one piece in grams).
 */
export interface LineAmountProduct {
  readonly kind: SoldAs;
  readonly unit: string | null;
  readonly size: number | null;
  readonly approxWeight: number | null;
}

/** The two figures of an offer the amount reads, in the offer's currency. */
export interface LineAmountOffer {
  readonly price: number | null;
  readonly piecePrice: number | null;
}

/** A catalog product with its kind named, for {@link lineAmount}. */
export function lineAmountProductOf(product: {
  readonly unit: string | null;
  readonly size: number | null;
  readonly approxWeight: number | null;
}): LineAmountProduct {
  return {
    kind: soldAs(product.unit, product.size, product.approxWeight),
    unit: product.unit,
    size: product.size,
    approxWeight: product.approxWeight,
  };
}

/**
 * The cost of `quantity` of a line in `unit` with this product at this offer,
 * or null when the product cannot serve the unit or a figure the amount needs
 * is missing.
 *
 * - **A count at a piece or pack price is the only exact amount.** Everything
 *   else is `estimated`.
 * - **A missing figure is a missing amount**, never zero. velista never
 *   derives a piece price: a kilo piece with no `piecePrice` answers null.
 * - **A weight served by pieces rounds up to whole pieces.**
 */
export function lineAmount(
  quantity: number,
  unit: LineUnit,
  product: LineAmountProduct,
  offer: LineAmountOffer
): LineAmount | null {
  if (!Number.isFinite(quantity) || quantity < 0) {
    return null;
  }
  const { kind } = product;
  if (!isMeasured(unit)) {
    if (kind === 'PACK') {
      return exact(offer.price, quantity);
    }
    if (kind === 'KILO_PIECE') {
      return estimate(offer.piecePrice, quantity, null);
    }
    return null;
  }
  if (unit === 'GRAM' && kind === 'BY_THE_KILO') {
    return estimate(offer.price, quantity / 1000, null);
  }
  if (unit === 'MILLILITER' && kind === 'BY_THE_LITRE') {
    return estimate(offer.price, quantity / 1000, null);
  }
  if (unit === 'GRAM' && kind === 'KILO_PIECE') {
    const weight = product.approxWeight;
    if (weight === null || !(weight > 0)) {
      return null;
    }
    const pieces = wholePieces(quantity, weight);
    return estimate(offer.piecePrice, pieces, pieces);
  }
  if (kind === 'PACK') {
    const bridge = packBridgeOf(product);
    if (bridge === null || bridge.unit !== unit) {
      return null;
    }
    const pieces = wholePieces(quantity, bridge.amount);
    // A pack sized in grams or millilitres holds what it says, so its count is
    // exact. A piece priced as one weighs about what the chain prints.
    return product.size !== null
      ? withPieces(exact(offer.price, pieces), pieces)
      : estimate(offer.price, pieces, pieces);
  }
  return null;
}

/**
 * What one pack or one piece of a `PACK` weighs or holds in a line unit, or
 * null when it bridges to none: a size in grams or millilitres bridges through
 * the size, a counted product with no size through its weight.
 */
function packBridgeOf(
  product: LineAmountProduct
): { unit: 'GRAM' | 'MILLILITER'; amount: number } | null {
  const base = toBaseUnit(product.size, product.unit);
  if (base.size !== null && base.size > 0) {
    if (base.unit === 'GRAM') {
      return { unit: 'GRAM', amount: base.size };
    }
    if (base.unit === 'MILLILITER') {
      return { unit: 'MILLILITER', amount: base.size };
    }
  }
  const weight = product.approxWeight;
  if (
    base.size === null &&
    base.unit === 'UNIT' &&
    weight !== null &&
    Number.isFinite(weight) &&
    weight > 0
  ) {
    return { unit: 'GRAM', amount: weight };
  }
  return null;
}

/** A size in its base unit, as the contracts' `toBaseUnit` reads it. */
function toBaseUnit(
  size: number | null,
  unit: string | null
): { size: number | null; unit: string | null } {
  const known = size === null || !Number.isFinite(size) ? null : size;
  switch (unit) {
    case 'KILOGRAM':
      return known === null
        ? { size: null, unit: 'KILOGRAM' }
        : { size: round(known * 1000), unit: 'GRAM' };
    case 'LITER':
      return {
        size: known === null ? null : round(known * 1000),
        unit: 'MILLILITER',
      };
    case 'PACK':
      return { size: known, unit: 'UNIT' };
    default:
      return { size: known, unit };
  }
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function exact(price: number | null, count: number): LineAmount | null {
  return amount(price, count, false, null);
}

function estimate(
  price: number | null,
  count: number,
  pieces: number | null
): LineAmount | null {
  return amount(price, count, true, pieces);
}

function withPieces(
  value: LineAmount | null,
  pieces: number
): LineAmount | null {
  return value === null ? null : { ...value, pieces };
}

function amount(
  price: number | null,
  count: number,
  estimated: boolean,
  pieces: number | null
): LineAmount | null {
  if (price === null || !Number.isFinite(price)) {
    return null;
  }
  return { cents: roundHalfUp(price * 100 * count), estimated, pieces };
}

/** Whole pieces or packs that serve `quantity`, rounded up. */
function wholePieces(quantity: number, each: number): number {
  return quantity === 0 ? 0 : Math.ceil(quantity / each - 1e-9);
}

/**
 * Half up to a whole number, once, after fixing the product to six decimals:
 * 9.95 × 100 × 0.5 is 497.49999999999994 in floating point and 498 on paper.
 */
function roundHalfUp(value: number): number {
  return Math.floor(Number(value.toFixed(6)) + 0.5);
}
