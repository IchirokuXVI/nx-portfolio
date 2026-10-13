import type { BasketLinePick } from '@portfolio/luna-shopper/contracts';
import {
  NO_PICKS,
  productOf,
  rowKeyOf,
  type BasketPicks,
  type KeyedLine,
} from './line-dedup';

/**
 * The key of every line one read knows about (plan 0201, section 2).
 *
 * A row is the group of lines that count as one product, and what a line
 * counts as needs its products, its favourite, its purchases in the trip and,
 * for a full read, the pick of the gateway. The read works that out once for
 * each line and every later question asks here: the grouping, the marks, the
 * removed rows and the changes view. So two of them cannot put one line in two
 * rows inside one request.
 *
 * It holds the lines that are covered and the lines that left the coverage
 * alike. A line that left is keyed with no purchases, so it counts as its
 * favourite or its first product.
 */
export class BasketLineKeys {
  private readonly keys = new Map<string, string>();
  private readonly products = new Map<string, string | null>();

  constructor(private readonly picks: BasketPicks = NO_PICKS) {}

  /** Work out the product and the key of each of these lines. */
  add(lines: readonly KeyedLine[]): this {
    for (const line of lines) {
      const productId = productOf(line, this.picks);
      this.products.set(line.lineId, productId);
      this.keys.set(line.lineId, rowKeyOf(line.content, productId));
    }
    return this;
  }

  /**
   * The key of a line.
   *
   * A line that was never added falls to its text. That is a line nothing in
   * the request read the products of, and guessing a product for it would put
   * it in a row it may not belong to.
   */
  readonly keyOf = (line: { id: string; content: string }): string =>
    this.keys.get(line.id) ?? rowKeyOf(line.content, null);

  /** The product a line counts as, or null. */
  productOf(lineId: string): string | null {
    return this.products.get(lineId) ?? null;
  }
}

/**
 * The picks of a request, by line.
 *
 * The gateway sends one for each line it priced. A second pick for one line is
 * a caller bug, and the first is kept so the answer does not depend on the
 * order of a retry.
 */
export function picksOf(
  picks: readonly BasketLinePick[] | undefined
): BasketPicks {
  if (!picks || picks.length === 0) {
    return NO_PICKS;
  }
  const byLine = new Map<string, string>();
  for (const pick of picks) {
    if (!byLine.has(pick.lineId)) {
      byLine.set(pick.lineId, pick.itemId);
    }
  }
  return byLine;
}
