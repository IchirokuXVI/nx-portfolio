import type { LineUnit, ProductKind, ProductSizing } from './line-unit';
import { packBridgeOf } from './line-unit';

/**
 * What a line's amount costs with one product (plan 0246, section 2).
 *
 * Framework free and taking plain values, so velista mirrors it row for row
 * (velista `0182` and `0183`, by its rule D4). The spec beside this file is
 * the normative table.
 */
export interface LineAmount {
  /** Integer cents, rounded half up once at the end. */
  cents: number;
  /** False only for a count of pieces or packs at a piece or pack price. */
  estimated: boolean;
  /** Set when a weight or volume was served by whole pieces or packs: "2 × ~700 g". */
  pieces: number | null;
}

/** A product as {@link lineAmountOf} reads it: its kind and its size fields. */
export type LineAmountProduct = ProductSizing & { kind: ProductKind };

/** The two figures of an offer the amount reads, in euros (plan 0244). */
export interface LineAmountOffer {
  price: number | null;
  piecePrice: number | null;
}

/**
 * The cost of `quantity` of a line in `unit` with this product at this offer
 * (plan 0246 W3, section 2), or null when the product cannot serve the unit or
 * a figure the amount needs is missing.
 *
 * - **A count at a piece or pack price is the only exact amount.** Everything
 *   else is `estimated`, a weight the scale has not weighed and a kilo piece
 *   whose weight is the chain's "about" alike.
 * - **A missing figure is a missing amount**, never zero. A `KILO_PIECE` whose
 *   offer has a price and no `piecePrice` answers null: nothing here derives a
 *   piece price.
 * - **A weight served by pieces rounds up to whole pieces.** 1000 g of a 700 g
 *   piece is two pieces, and {@link LineAmount.pieces} carries the 2.
 *
 * The product is `{ kind, unitSize, approxWeight }` as the plan states it,
 * plus `defaultUnit`: a pack's size can be grams or millilitres, and only the
 * unit it was created in says which (read through `toBaseUnit`).
 */
export function lineAmountOf(
  quantity: number,
  unit: LineUnit,
  product: LineAmountProduct,
  offer: LineAmountOffer
): LineAmount | null {
  if (!Number.isFinite(quantity) || quantity < 0) {
    return null;
  }
  const { kind } = product;
  if (unit === 'UNIT') {
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
    const bySize = product.unitSize !== null;
    return bySize
      ? withPieces(exact(offer.price, pieces), pieces)
      : estimate(offer.price, pieces, pieces);
  }
  return null;
}

/**
 * What one of this product costs, in euros (plan 0246 W3): what a member
 * shows, and the order of a line at quantity 0.
 *
 * `piecePrice` for a `KILO_PIECE` and `price` for every other kind, or null.
 * For a product sold by the kilo or the litre that is the price of one kilo or
 * one litre. Velista `0179`'s `amountOfOne`, stated once on the server side.
 */
export function priceOfOne(
  product: { kind: ProductKind },
  offer: LineAmountOffer
): number | null {
  const figure = product.kind === 'KILO_PIECE' ? offer.piecePrice : offer.price;
  return figure === null || !Number.isFinite(figure) ? null : figure;
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

/**
 * How many whole pieces or packs serve `quantity`, rounded up. The tolerance
 * keeps a quotient that is whole on paper (1500 / 500) from reading as a hair
 * above it after floating point division.
 */
function wholePieces(quantity: number, each: number): number {
  return quantity === 0 ? 0 : Math.ceil(quantity / each - 1e-9);
}

/**
 * Half up to a whole number, once. The product is fixed to six decimals first,
 * so 9.95 × 100 × 0.5, which floating point holds as 497.49999999999994, rounds
 * to 498 as it does on paper.
 */
function roundHalfUp(value: number): number {
  return Math.floor(Number(value.toFixed(6)) + 0.5);
}
