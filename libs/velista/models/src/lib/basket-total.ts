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
 * The page hands a row `chosenId` from the shelf mark read with `readAtShop`,
 * and `atShop` from `pricedAtShop`. So does this: {@link basketShelfMark} names
 * the option a row offers in place of a missing default, {@link basketRowProduct}
 * resolves the product, and {@link shownOffer} reads its price.
 *
 * A row can therefore add nothing in three ways, and each one is counted:
 *
 * - **No product**: free text, or several options and no choice. It adds to
 *   `lines` alone.
 * - **Known missing at the chosen shop** (rule T4): the mark is `unavailable`.
 *   It adds to `withProduct` when its one product is known, and never a price,
 *   although the row still prints the shop's number beside "Not available".
 * - **No price**: nobody priced the product, or the chosen shop does not list
 *   it. With a shop chosen the cheapest price elsewhere is not a fallback,
 *   because that is the row's rule too.
 *
 * ## The quantity
 *
 * The whole of a row is `bought + boughtElsewhere + left`. The server computes
 * `asked` as `bought + left` over this basket alone, and `boughtElsewhere` is in
 * neither (backend `0188`): those units left the line before this basket looked.
 * So `asked` is the whole of a row that is partly bought here, and it is short
 * by exactly `boughtElsewhere` on a row somebody else bought part of. The bought
 * side is `bought + boughtElsewhere`, and what is left is the server's `left`.
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

    // Exactly what the page computes for the row's `chosenId` (`insteadOf`).
    const shelf = basketShelfMark(row, products, readAtShop);
    const product = basketRowProduct(
      row,
      products,
      shelf?.kind === 'instead' ? shelf.optionId : null
    );
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
    const done = row.bought + row.boughtElsewhere;
    boughtCents += cents * done;
    totalCents += cents * (done + row.left);
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
