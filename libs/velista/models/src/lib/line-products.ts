import type { CatalogBrowseContext, ProductShopPrice } from './catalog-browse';
import type { CatalogItem, Line, ProductOffer } from './domain';
import {
  lineAmount,
  lineAmountProductOf,
  type LineAmount,
  type LineAmountProduct,
} from './line-amount';
import {
  LINE_UNIT_FALLBACK,
  servesLineUnit,
  type LineUnit,
  type LineUnitProduct,
  type LineUnitProductRead,
} from './line-unit';
import type { LocalizedName } from './shopping-profile';
import { amountOfOne } from './sold-as';

/** What a line asks for, as {@link cheaperForLine} compares its products by. */
export type LineAsk = Pick<Line, 'quantity' | 'unit'>;

/** One product of a line, as {@link cheaperForLine} compares it. */
export interface LineMember {
  /** Its size fields, or null when nothing is known about them. */
  readonly product: LineUnitProduct | null;
  /** The offer the comparison is made at, or null for none. */
  readonly offer: Pick<ProductOffer, 'price' | 'piecePrice'> | null;
}

/**
 * What one product costs for this line under W3 (backend `0246`, section 4.3;
 * velista `0183`, section 1), in the figure {@link cheaperForLine} orders by,
 * or null when it is not a candidate.
 *
 * A candidate can serve the line's unit at all: `lineAmount(max(quantity, 1),
 * …)` is not null, so a loose product never serves a count line, a counted pack
 * never serves a weight line, and a missing figure is a missing amount. Its
 * figure is the cents of `lineAmount(quantity, …)` when the line asks for
 * something, and the price of one (`amountOfOne`) in euros, unrounded, when it
 * is at 0. Only figures of one line are ever compared with each other, so the
 * two never meet. Nothing draws this figure: a caption draws `lineAmount`.
 */
export function lineMemberCost(
  line: LineAsk,
  member: LineMember
): number | null {
  if (member.product === null || member.offer === null) {
    return null;
  }
  const product = lineAmountProductOf(member.product);
  const serves = lineAmount(
    Math.max(line.quantity, 1),
    line.unit,
    product,
    member.offer
  );
  if (serves === null) {
    return null;
  }
  if (line.quantity > 0) {
    return (
      lineAmount(line.quantity, line.unit, product, member.offer)?.cents ?? null
    );
  }
  const one = amountOfOne(
    { price: member.offer.price, piecePrice: member.offer.piecePrice },
    product.kind
  );
  // The raw euros, unrounded, as the server's `priceOfOne` compares them: 1.231
  // and 1.234 would both round to 123 cents and tie here and not there.
  return one === null || !Number.isFinite(one) ? null : one;
}

/**
 * W3 (backend 0246): the cost of the line's amount, among the members that can
 * serve the unit; the price of one when the line is at 0. Ascending, null last,
 * input order on a tie (with a stable sort).
 *
 * **What the line costs with each product, not the cheapest kilo.** The price
 * per kilo or litre (`unitPrice`, and the comparable price of backend `0245`)
 * answers which product is cheapest by weight, which the catalog tab answers.
 * A line asks for an amount, and 500 g of bananas is cheapest loose while a
 * whole melon is cheapest as the piece, so neither figure is read here. The
 * server's `cheapestOf` (`basket-rules.spec.ts`) is the same rule, and
 * `line-products.spec.ts` shares its scenario numbers.
 */
export function cheaperForLine(
  line: LineAsk
): (a: LineMember, b: LineMember) => number {
  return (a, b) => nullsLast(lineMemberCost(line, a), lineMemberCost(line, b));
}

/**
 * Whether another member is cheaper for this line than the product it counts
 * as now, strictly, under W3 (velista `0183`, section 3; the basket row's
 * cheaper mark).
 *
 * Only members that can serve the line's unit compare, so a loose product never
 * earns the mark on a count line and a counted pack never on a weight line. A
 * product with no cost of its own is never marked, because nothing says it is
 * dearer, and a tie is not a better price.
 */
export function cheaperForLineInGroup(
  line: LineAsk,
  productId: string,
  current: LineMember,
  members: readonly (LineMember & { readonly id: string })[]
): boolean {
  const cost = lineMemberCost(line, current);
  if (cost === null) {
    return false;
  }
  return members.some((member) => {
    if (member.id === productId) {
      return false;
    }
    const other = lineMemberCost(line, member);
    return other !== null && other < cost;
  });
}

/** A catalog record as {@link cheaperForLine} compares it: its sizes and offer. */
export function lineMemberOf(product: {
  readonly unit: string | null;
  readonly size: number | null;
  readonly approxWeight: number | null;
  readonly offer: Pick<ProductOffer, 'price' | 'piecePrice'> | null;
}): LineMember {
  return {
    product: {
      unit: product.unit,
      size: product.size,
      approxWeight: product.approxWeight,
    },
    offer: product.offer,
  };
}

function nullsLast(a: number | null, b: number | null): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  return a - b;
}

/**
 * How a screen ranks the products of one line (velista `0183`): what the line
 * asks for, and the size fields of each product.
 */
export interface LineRank extends LineAsk {
  readonly productOf: (itemId: string) => LineUnitProductRead;
}

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
  /**
   * Whether the product can serve the line's unit (velista `0183`, target
   * state 4), by its size fields alone. Null while they are not known, and
   * without a {@link LineRank}.
   */
  readonly serves: boolean | null;
  /**
   * What the line's amount costs with this product at {@link offer}, for the
   * caption under the price (target state 6). Null with no amount or no price,
   * and at 0.
   */
  readonly amount: LineAmount | null;
  /** The figure the order compares ({@link lineMemberCost}), or null. */
  readonly cost: number | null;
  /**
   * Whether this card waits on its record before the order can rank it: its
   * price is in and its size fields are not.
   */
  readonly pending: boolean;
}

/**
 * The price of each product of a line, in the order given (section 3).
 *
 * With no supermarket chosen, a product shows its lowest price near the person.
 * With one chosen (section 3.2), it shows the price at that supermarket, and a
 * product the supermarket does not sell says so.
 *
 * **One card is the cheapest** (velista `0183`, target state 5): the lowest
 * cost of the line's amount among the products that can serve its unit, which
 * is {@link cheaperForLine}, the price of one at 0. A line with one product
 * marks none, because the word compares, and so does a line where only one
 * product can serve its unit: the others are not in the comparison. A product
 * with no price never takes it. Two products at the same cost leave the word on
 * the first. Without a `rank` nothing is compared, so nothing is marked, and
 * nothing is marked either while a record among the first
 * {@link LINE_PRICED_PRODUCTS_MAX} is still being read.
 */
export function lineProductPrices(
  itemIds: readonly string[],
  pricesOf: (itemId: string) => LineProductPriceRead,
  supermarketId: string | null,
  rank?: LineRank
): readonly LineProductPrice[] {
  const prices = itemIds.map((itemId) =>
    ranked(priceOf(itemId, pricesOf(itemId), supermarketId), rank)
  );

  if (prices.filter((price) => price.serves !== false).length < 2) {
    return prices;
  }
  // A card whose record is still being read may yet serve the unit, or not, so
  // the word waits for it as the order does (`orderLineCards`): marking the only
  // costed card now would move the word once the record lands.
  if (
    prices.slice(0, LINE_PRICED_PRODUCTS_MAX).some((price) => price.pending)
  ) {
    return prices;
  }

  let best: LineProductPrice | null = null;
  for (const price of prices) {
    if (
      price.cost !== null &&
      (best === null || best.cost === null || price.cost < best.cost)
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

/** A price with what the line's unit and amount say about it. */
function ranked(
  price: LineProductPrice,
  rank: LineRank | undefined
): LineProductPrice {
  if (rank === undefined) {
    return price;
  }
  const product = rank.productOf(price.itemId);
  if (product === undefined || product === null) {
    return {
      ...price,
      pending: product === undefined && price.kind === 'priced',
    };
  }
  const offer =
    price.offer === null
      ? null
      : { price: price.offer.price, piecePrice: price.offer.piecePrice };
  const cost = lineMemberCost(rank, { product, offer });
  return {
    ...price,
    serves: servesLineUnit(product, rank.unit),
    cost,
    amount:
      cost === null || rank.quantity <= 0 || offer === null
        ? null
        : lineAmount(
            rank.quantity,
            rank.unit,
            lineAmountProductOf(product),
            offer
          ),
  };
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
    serves: null,
    amount: null,
    cost: null,
    pending: false,
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
    serves: null,
    amount: null,
    cost: null,
    pending: false,
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

/**
 * The cards of a line in the order the page draws them (velista `0137`,
 * section 2; velista `0183`, target states 4, 5 and 7): the favourite when it
 * can serve the line's unit, then the products with a cost for the line's
 * amount from the cheapest up ({@link cheaperForLine}), then the ones that can
 * serve the unit with no price, then the ones that cannot serve it at all.
 *
 * It is the order the basket is meant to choose in, so the first card is the
 * product a shopper will be shown. The comparison is the one that gives the word
 * CHEAPEST, and two products at one cost keep the order the line holds them in.
 * A product that cannot serve the unit is kept and drawn last, marked by its
 * card: the shopper may still want to see it, and nothing ranks it.
 *
 * **The cards move once.** While a price or a record among the first
 * {@link LINE_PRICED_PRODUCTS_MAX} is still being read, only the favourite moves
 * and the rest keep the order of the line. Sorting as each price lands would move
 * a card under a thumb several times in a second. Products after those keep their
 * place at the end: nobody read all their prices, so nothing ranks them.
 */
export function orderLineCards(
  prices: readonly LineProductPrice[],
  favoriteItemId: string | null
): readonly LineProductPrice[] {
  const favorite =
    favoriteItemId === null
      ? undefined
      : prices.find(
          (price) => price.itemId === favoriteItemId && price.serves !== false
        );
  const others = prices.filter((price) => price !== favorite);
  const head = favorite === undefined ? [] : [favorite];

  const counted = prices.slice(0, LINE_PRICED_PRODUCTS_MAX);
  if (counted.some((price) => price.kind === 'loading' || price.pending)) {
    return [...head, ...others];
  }

  const ranked = new Set(counted);
  const inRange = others.filter((price) => ranked.has(price));
  const costed = inRange
    .filter((price) => price.cost !== null)
    // `sort` is stable, so equal costs keep the order of the line.
    .sort((a, b) => nullsLast(a.cost, b.cost));
  const uncosted = inRange.filter(
    (price) => price.cost === null && price.serves !== false
  );
  const cannot = inRange.filter((price) => price.serves === false);
  const beyond = others.filter((price) => !ranked.has(price));

  return [...head, ...costed, ...uncosted, ...cannot, ...beyond];
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
        (lowest === null || lowest.price === null || offer.price < lowest.price)
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

/** The fields of a line the order of its products reads. */
export type LineShowSource = Pick<
  Line,
  'itemIds' | 'favoriteItemId' | 'preferredSupermarketId' | 'quantity' | 'unit'
>;

/**
 * The products of a line in the order the line page draws its cards (velista
 * `0137`, section 2; velista `0183`), each with its price and what the line's
 * amount costs with it.
 *
 * {@link lineProductPrices} and then {@link orderLineCards}, over `itemIds` only:
 * `groupItemIds` is the part of that set a group put there, not a second set.
 * `productOf` answers each product's size fields, which say whether it can
 * serve the line's unit.
 */
export function lineCardOrder(
  line: LineShowSource,
  pricesOf: (itemId: string) => LineProductPriceRead,
  productOf: (itemId: string) => LineUnitProductRead
): readonly LineProductPrice[] {
  return orderLineCards(
    lineProductPrices(line.itemIds, pricesOf, line.preferredSupermarketId, {
      quantity: line.quantity,
      // A line read before velista `0182` carries no unit, and counts pieces.
      unit: line.unit ?? LINE_UNIT_FALLBACK,
      productOf,
    }),
    line.favoriteItemId
  );
}

/**
 * **The one product a line shows** (velista `0145`, section 2), or null for a line
 * with no product.
 *
 * It is the first card of the line page by definition, so the row of a list and
 * the line page never show two products for one line. That gives the rule:
 *
 * 1. The favourite, when the line holds it and it can serve the line's unit
 *    (velista `0183`, target state 7), with or without a price.
 * 2. The cheapest product for the line's amount among the first
 *    {@link LINE_PRICED_PRODUCTS_MAX} that can serve its unit: at the supermarket
 *    of the line when it has one, else the lowest price near the reader. The cost
 *    of the line's amount decides ({@link cheaperForLine}), the price of one at 0,
 *    and a tie keeps the order of the line.
 * 3. The first product of the line that can serve its unit when none has a
 *    price, and the favourite or the first product while a price or a record
 *    among those is still being read.
 *
 * The price that comes back is the price that made the choice.
 */
export function lineShownProduct(
  line: LineShowSource,
  pricesOf: (itemId: string) => LineProductPriceRead,
  productOf: (itemId: string) => LineUnitProductRead
): LineProductPrice | null {
  return lineCardOrder(line, pricesOf, productOf)[0] ?? null;
}

/** One line, as {@link listCost} counts it. */
export interface ListCostLine {
  readonly quantity: number;
  /** What {@link quantity} counts (velista `0182`). */
  readonly unit: LineUnit;
  /** The price of the product the line shows, or null for none. */
  readonly offer: ProductOffer | null;
  /**
   * The shown product as {@link lineAmount} reads it: how it is sold and its
   * size fields (velista `0179` and `0182`).
   */
  readonly product: LineAmountProduct;
}

/** What the pending lines of a list cost, in integer cents. */
export interface ListCost {
  readonly cents: number;
  readonly currency: string | null;
  /** Whether any line added an estimate: a weight, a volume or a kilo piece. */
  readonly estimated: boolean;
}

/**
 * What the pending lines of a list cost (velista `0145`, section 6; `0182`,
 * section 3), or null with no priced line.
 *
 * The sum, over the lines with a quantity above zero, of {@link lineAmount} of
 * the line's quantity in its unit with the product the line shows, in integer
 * cents, each line rounded once by that table. A line with no product or no
 * amount adds nothing, so a kilo piece with a price and no piece price adds
 * nothing. The total is `estimated` when any line that added to it is. The first
 * currency counted is the currency of the sum, and a price in another is left
 * out rather than added to it.
 */
export function listCost(lines: readonly ListCostLine[]): ListCost | null {
  let cents = 0;
  let estimated = false;
  let currency: string | null | undefined;
  for (const line of lines) {
    if (line.quantity <= 0 || line.offer === null) {
      continue;
    }
    const amount = lineAmount(line.quantity, line.unit, line.product, {
      price: line.offer.price,
      piecePrice: line.offer.piecePrice,
    });
    if (amount === null) {
      continue;
    }
    if (currency === undefined) {
      currency = line.offer.currency;
    } else if (line.offer.currency !== currency) {
      continue;
    }
    cents += amount.cents;
    estimated ||= amount.estimated;
  }
  return currency === undefined ? null : { cents, currency, estimated };
}

/**
 * The prices one catalog record carries, as the rows {@link lineProductPrices}
 * reads (velista `0145`, section 7).
 *
 * The lookup with `prices: true` answers every chain's offer at the reader's own
 * scopes, one for each chain and cheapest first (`CatalogItem.chainPrices`). A
 * chain near the reader that is not in it does not sell the product, which is
 * what a missing row already means to {@link lineProductPrices}.
 */
export function itemShopPrices(
  item: Pick<CatalogItem, 'chainPrices'>
): readonly ProductShopPrice[] {
  return item.chainPrices.map((price) => ({
    supermarketId: price.chain.id,
    chain: price.chain.name,
    logoUrl: null,
    kind: price.offer.price === null ? 'unpriced' : 'priced',
    offer: price.offer,
    cheapest: false,
  }));
}
