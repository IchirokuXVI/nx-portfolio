import type {
  CatalogBrowseContext,
  ProductShopPrice,
} from './catalog-browse';
import type { ProductOffer } from './domain';
import { compareGroupOffers } from './product-group';
import type { LocalizedName } from './shopping-profile';

/**
 * What the line page knows about the prices of one product (velista `0135`,
 * section 3).
 *
 * - `undefined`: not read yet.
 * - `null`: the read did not answer.
 * - a list: one row for each chain near the person, cheapest first, as
 *   `productShopPrices` builds it.
 */
export type LineProductPriceRead =
  | readonly ProductShopPrice[]
  | null
  | undefined;

/**
 * - `loading`: the prices of this product were not read yet.
 * - `priced`: a price, at {@link LineProductPrice.supermarketId}.
 * - `noPrice`: nothing near the person has a price for it, or the read failed.
 * - `notSold`: the supermarket of the line does not sell it. Only with a
 *   supermarket chosen.
 */
export type LineProductPriceKind = 'loading' | 'priced' | 'noPrice' | 'notSold';

/** The one price a product card draws. */
export interface LineProductPrice {
  readonly itemId: string;
  readonly kind: LineProductPriceKind;
  /** Set exactly when {@link kind} is `priced`. */
  readonly offer: ProductOffer | null;
  /** The chain that charges {@link offer}. Null without one. */
  readonly supermarketId: string | null;
  readonly chain: LocalizedName | null;
  /** The one card that takes the word. Never with fewer than two products. */
  readonly cheapest: boolean;
}

/**
 * The price of each product of a line, in the order given (section 3).
 *
 * With no supermarket chosen, a product shows its lowest price near the person.
 * With one chosen (section 3.2), it shows the price at that supermarket, and a
 * product the supermarket does not sell says so.
 *
 * **One card is the cheapest**: the lowest price for each kilo or litre, then the
 * lowest price, which is the comparison `similarProducts` makes. A line with one
 * product marks none, because the word compares, and a product with no price
 * never takes it. Two products at the same price leave the word on the first.
 */
export function lineProductPrices(
  itemIds: readonly string[],
  pricesOf: (itemId: string) => LineProductPriceRead,
  supermarketId: string | null
): readonly LineProductPrice[] {
  const prices = itemIds.map((itemId) =>
    priceOf(itemId, pricesOf(itemId), supermarketId)
  );

  if (prices.length < 2) {
    return prices;
  }

  let best: LineProductPrice | null = null;
  for (const price of prices) {
    if (
      price.kind === 'priced' &&
      (best === null || compareGroupOffers(price.offer, best.offer) < 0)
    ) {
      best = price;
    }
  }

  return best === null
    ? prices
    : prices.map((price) =>
        price === best ? { ...price, cheapest: true } : price
      );
}

function priceOf(
  itemId: string,
  read: LineProductPriceRead,
  supermarketId: string | null
): LineProductPrice {
  const none = (kind: LineProductPriceKind): LineProductPrice => ({
    itemId,
    kind,
    offer: null,
    supermarketId: null,
    chain: null,
    cheapest: false,
  });

  if (read === undefined) {
    return none('loading');
  }
  if (read === null) {
    return none('noPrice');
  }

  const row =
    supermarketId === null
      ? // The list is cheapest first, so the first priced row is the lowest.
        read.find((candidate) => candidate.kind === 'priced')
      : read.find((candidate) => candidate.supermarketId === supermarketId);

  if (row === undefined || row.kind === 'notSold') {
    return none(supermarketId === null ? 'noPrice' : 'notSold');
  }
  if (row.kind === 'unpriced' || row.offer === null) {
    return none('noPrice');
  }

  return {
    itemId,
    kind: 'priced',
    offer: row.offer,
    supermarketId: row.supermarketId,
    chain: row.chain,
    cheapest: false,
  };
}

/**
 * The products of a line in the order the cards draw them: the favourite first,
 * the rest as the line holds them (section 3.1).
 *
 * A favourite the line does not hold changes nothing. The server never leaves
 * one, and an optimistic frame that did is not worth a card nobody added.
 */
export function favoriteFirst(
  itemIds: readonly string[],
  favoriteItemId: string | null
): readonly string[] {
  if (favoriteItemId === null || !itemIds.includes(favoriteItemId)) {
    return itemIds;
  }
  return [
    favoriteItemId,
    ...itemIds.filter((itemId) => itemId !== favoriteItemId),
  ];
}

/** One row of the supermarket sheet of a line (section 3.2). */
export interface LineSupermarketRow {
  readonly supermarketId: string;
  /** Null for a supermarket the app cannot name. The sheet says "another". */
  readonly name: LocalizedName | null;
  readonly logoUrl: string | null;
  /**
   * How many of the products it sells, out of {@link of}. Null for a supermarket
   * that is not near the person: nothing was read about it.
   */
  readonly sells: number | null;
  /** How many products were counted, which is those whose prices were read. */
  readonly of: number;
  /** Its lowest price over those products, or null with none. */
  readonly lowest: ProductOffer | null;
  readonly selected: boolean;
}

/**
 * The supermarkets a line can name: the ones near the person, in the order of
 * the context, and the one the line already names when it is not among them.
 *
 * A product whose prices were not read, or whose read failed, is left out of both
 * numbers. Counting it as "not sold" would say something nobody checked.
 */
export function lineSupermarketRows(
  itemIds: readonly string[],
  pricesOf: (itemId: string) => LineProductPriceRead,
  context: Pick<CatalogBrowseContext, 'chains' | 'chainNames'>,
  chosenId: string | null
): readonly LineSupermarketRow[] {
  const reads = itemIds
    .map((itemId) => pricesOf(itemId))
    .filter((read): read is readonly ProductShopPrice[] => Array.isArray(read));

  const rows: LineSupermarketRow[] = context.chains.map((chain) => {
    let sells = 0;
    let lowest: ProductOffer | null = null;
    for (const read of reads) {
      const row = read.find(
        (candidate) => candidate.supermarketId === chain.supermarketId
      );
      if (row === undefined || row.kind === 'notSold') {
        continue;
      }
      sells += 1;
      const offer = row.kind === 'priced' ? row.offer : null;
      if (
        offer !== null &&
        offer.price !== null &&
        (lowest === null ||
          lowest.price === null ||
          offer.price < lowest.price)
      ) {
        lowest = offer;
      }
    }
    return {
      supermarketId: chain.supermarketId,
      name: chain.name,
      logoUrl: chain.logoUrl,
      sells,
      of: reads.length,
      lowest,
      selected: chain.supermarketId === chosenId,
    };
  });

  if (
    chosenId !== null &&
    !rows.some((row) => row.supermarketId === chosenId)
  ) {
    rows.push({
      supermarketId: chosenId,
      name: context.chainNames.get(chosenId) ?? null,
      logoUrl: null,
      sells: null,
      of: reads.length,
      lowest: null,
      selected: true,
    });
  }

  return rows;
}

/** How many products of a line the page reads prices for (section 3.2). */
export const LINE_PRICED_PRODUCTS_MAX = 20;
