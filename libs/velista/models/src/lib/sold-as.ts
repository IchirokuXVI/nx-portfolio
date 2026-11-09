import type { ProductOffer } from './domain';

/**
 * How a product is priced (velista `0179`, section 1; backend `0244`).
 *
 * - `PACK`: `price` is one of what the row names. A fixed pack, and a piece
 *   priced as one (a `UNIT` product with a weight), whose price is the piece.
 * - `BY_THE_KILO`: `KILOGRAM` with no size and no weight. `price` is a kilo.
 * - `KILO_PIECE`: `KILOGRAM` with no size and a weight. `price` is a kilo, and
 *   the offer's `piecePrice` is one piece.
 * - `BY_THE_LITRE`: `LITER` with no size (velista `0182`, backend `0246`
 *   section 1). `price` is a litre.
 *
 * The weight line is not a kind: it is drawn whenever a weight is set.
 */
export type SoldAs = 'PACK' | 'BY_THE_KILO' | 'BY_THE_LITRE' | 'KILO_PIECE';

/** Name how a product is priced, so no view tests the fields by hand. */
export function soldAs(
  unit: string | null,
  size: number | null,
  approxWeight: number | null
): SoldAs {
  if (size !== null) {
    return 'PACK';
  }
  if (unit === 'LITER') {
    return 'BY_THE_LITRE';
  }
  if (unit !== 'KILOGRAM') {
    return 'PACK';
  }
  return approxWeight !== null && approxWeight > 0
    ? 'KILO_PIECE'
    : 'BY_THE_KILO';
}

/**
 * How a product is priced when the product may not be known yet: while the
 * catalog's read of it is pending, after it failed, or where only an offer is at
 * hand (velista `0179`).
 *
 * With a product it answers {@link soldAs}. With none it reads the offer: the
 * server sets `piecePrice` on a kilo piece only, so a set piece price proves the
 * kind, and the answer is `KILO_PIECE`. Every other offer answers `PACK`. A
 * product sold by the kilo cannot be told apart from a pack by its offer alone,
 * so a loose product with no record draws a bare price.
 */
export function soldAsOf(
  offer: Pick<ProductOffer, 'piecePrice'> | null,
  product: {
    readonly unit: string | null;
    readonly size: number | null;
    readonly approxWeight: number | null;
  } | null
): SoldAs {
  if (product !== null) {
    return soldAs(product.unit, product.size, product.approxWeight);
  }
  return typeof offer?.piecePrice === 'number' ? 'KILO_PIECE' : 'PACK';
}

/**
 * What one unit of quantity costs: the piece price for a `KILO_PIECE`, the
 * price for every other kind, or null for none.
 *
 * **velista never derives a piece price.** A kilo piece whose offer has a price
 * and no piece price answers null, so a total counts it as unpriced rather than
 * adding the price of a kilo for a piece.
 */
export function amountOfOne(
  offer: Pick<ProductOffer, 'price' | 'piecePrice'> | null,
  kind: SoldAs
): number | null {
  if (offer === null) {
    return null;
  }
  return kind === 'KILO_PIECE' ? offer.piecePrice : offer.price;
}

/**
 * A price as a view draws it (velista `0179`, section 2): the number, and what
 * it is per ("/ kg", "/ L"), or null. The template draws `per` smaller and muted
 * close after the number.
 */
export interface PriceWords {
  readonly amount: string;
  readonly per: string | null;
}

/**
 * A price as text, for an accessible name or a sentence: the two words joined
 * with a space, or the amount alone.
 */
export function priceWordsText(words: PriceWords): string {
  return words.per === null ? words.amount : `${words.amount} ${words.per}`;
}
