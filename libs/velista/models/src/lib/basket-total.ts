import {
  basketRowProduct,
  basketShelfMark,
  countableBasketRows,
  shownOffer,
  type BasketProduct,
  type BasketRow,
} from './basket-view';

/**
 * What the visible lines of a basket come to (velista `0132`, section 2).
 *
 * An estimate and never a bill: every amount is the price a row draws times a
 * quantity, in integer cents, and a row that draws no price adds none.
 */
export interface BasketTotal {
  /** Visible rows that can be counted (no `REMOVED` row). */
  readonly lines: number;
  /** Of those, rows whose product is known. */
  readonly withProduct: number;
  /** Of those, rows that add a price to the total. */
  readonly withPrice: number;
  /** What the units somebody already bought come to, here or through another basket. */
  readonly boughtCents: number;
  /** `totalCents - boughtCents`: the units nobody has bought yet. */
  readonly leftCents: number;
  readonly totalCents: number;
  /**
   * The currency of every amount above, or null when no priced row named one,
   * which draws as `formatMoney` draws any amount with no currency.
   */
  readonly currency: string | null;
}

/** What the sum reads beside the rows, which is what the page hands each row. */
export interface BasketTotalContext {
  readonly products: ReadonlyMap<string, BasketProduct>;
  /** Whether the rows quote the chosen shop's price (`basketPricedAtShop`). */
  readonly pricedAtShop: boolean;
  /** Whether the products describe the chosen shop (`basketReadAtShop`). */
  readonly readAtShop: boolean;
}

export const EMPTY_BASKET_TOTAL: BasketTotal = {
  lines: 0,
  withProduct: 0,
  withPrice: 0,
  boughtCents: 0,
  leftCents: 0,
  totalCents: 0,
  currency: null,
};

/**
 * Add up the rows on the screen (velista `0132`, section 2).
 *
 * ## It asks what the row asks
 *
 * **The product and the price are resolved by the row's own functions, with the
 * row's own arguments**, so the number cannot disagree with the rows under it.
 * The page hands a row `atShop` from `pricedAtShop`, and so does this:
 * {@link basketRowProduct} resolves the row's one product, {@link basketShelfMark}
 * says whether the shop is known not to have it, and {@link shownOffer} reads its
 * price.
 *
 * A row can therefore add nothing in three ways, and each one is counted:
 *
 * - **No product**: a row whose lines hold none, or a product the catalog could
 *   not name. It adds to `lines` alone (velista `0139`, section 2).
 * - **Known missing at the chosen shop** (rule T4): the mark is `unavailable`.
 *   It adds to `withProduct` when its one product is known, and never a price,
 *   although the row still prints the shop's number beside "Not available".
 * - **No price**: nobody priced the product, or the chosen shop does not list
 *   it. With a shop chosen the cheapest price elsewhere is not a fallback,
 *   because that is the row's rule too.
 *
 * ## The quantity
 *
 * The bought side is `bought`, what this shopping list bought, and what is left
 * is the server's `left`. A unit somebody bought through another shopping list or
 * on the list page is in neither (backend `0203`, section 4), and **this sum does
 * not add `boughtElsewhere`** (velista `0142`, section 3): the owner's rule is
 * that a buy from another basket counts toward nothing here, and a price is a
 * count. A row nothing is left of that this shopping list bought none of is
 * crossed out, and {@link countableBasketRows} leaves it out before it is priced.
 *
 * This is the one place this scope adds a row's numbers together, and it does
 * so to price them, never to say how far a row has got: `state` and `left` are
 * still the server's. A `NOT_AVAILABLE` or `SKIPPED` row is summed the same way,
 * so what nobody bought of it falls on the left side (rule T2).
 *
 * ## Money
 *
 * Every price becomes integer cents before it is multiplied, so 0.1 and 0.2 come
 * to 30 and never to 30.000000000000004. **The first priced row that names a
 * currency names the total's.** A row priced in another currency adds no price,
 * because two currencies have no sum. A price with no currency is counted under
 * whichever one the others name.
 */
export function basketTotal(
  rows: readonly BasketRow[],
  context: BasketTotalContext
): BasketTotal {
  const { products, pricedAtShop, readAtShop } = context;

  let lines = 0;
  let withProduct = 0;
  let withPrice = 0;
  let boughtCents = 0;
  let totalCents = 0;
  let currency: string | null = null;

  for (const row of countableBasketRows(rows)) {
    lines += 1;

    const shelf = basketShelfMark(row, products, readAtShop);
    const product = basketRowProduct(row, products);
    if (product === null) {
      continue;
    }
    withProduct += 1;

    if (shelf?.kind === 'unavailable') {
      continue;
    }

    const offer = shownOffer(product, pricedAtShop);
    if (offer === null) {
      continue;
    }
    if (offer.currency !== null) {
      if (currency !== null && offer.currency !== currency) {
        continue;
      }
      currency = offer.currency;
    }
    withPrice += 1;

    const cents = Math.round(offer.price * 100);
    boughtCents += cents * row.bought;
    totalCents += cents * (row.bought + row.left);
  }

  return lines === 0
    ? EMPTY_BASKET_TOTAL
    : {
        lines,
        withProduct,
        withPrice,
        boughtCents,
        leftCents: totalCents - boughtCents,
        totalCents,
        currency,
      };
}
