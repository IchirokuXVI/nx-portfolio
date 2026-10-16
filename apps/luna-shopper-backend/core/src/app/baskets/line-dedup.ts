import { lineProductOf } from '@portfolio/luna-shopper/basket-rules';
import { normalizeContent } from '../lists/line-content';

/**
 * How a basket decides that two covered lines are one thing to buy (plan 0201,
 * section 2).
 *
 * The same thing appears in two zones, "Milk" in the flat list and in the
 * parents' house list, and the point of a basket is one row to buy once. Two
 * lines are one row when they **count as the same product**, and failing a
 * product, when they carry the same normalized name.
 *
 * Before plan 0201 the key was the whole product set of a line. Two lines that
 * both wanted Pascual milk were two rows when one of them also allowed Puleva,
 * and the same product stood in the basket twice.
 */

/**
 * The fold itself lives in `lists/line-content.ts`, because the add uses it too
 * (plan 0091, section 1): a list that holds one line per normalized name and a
 * basket that merges on normalized text have to agree.
 *
 * Re-exported here so the rule still reads as one module, and so the callers
 * that already read it from here need no edit.
 */
export { normalizeContent };

/** What the key of a line is decided from. */
export interface KeyedLine {
  lineId: string;
  content: string;
  /** The products of the line, in the order the line holds them. */
  itemIds: readonly string[];
  favoriteItemId: string | null;
  /** The product of its latest buy in this trip, or null. */
  tripItemId: string | null;
}

/**
 * The cheapest product of each line that needs a price, by line id.
 *
 * Only the gateway reads prices, so only a full read carries any (plan 0201,
 * section 1). Every other caller hands {@link NO_PICKS}, and a line with
 * several products and no favourite then counts as its first product.
 */
export type BasketPicks = ReadonlyMap<string, string>;

/** A caller with no prices: a card, a summary, a write answer, the back office. */
export const NO_PICKS: BasketPicks = new Map();

/** The product a line counts as in a basket, or null. */
export function productOf(line: KeyedLine, picks: BasketPicks): string | null {
  return lineProductOf(line, picks.get(line.lineId));
}

/**
 * The key two lines must share to be one basket row.
 *
 * The product wins when there is one, because it is an identity rather than a
 * spelling: two households typing "leche" and "Milk" for the same carton merge
 * on the product and would never have merged on the text. A line with no
 * product falls back to its text.
 *
 * The two are namespaced apart so a product id can never collide with a piece
 * of text somebody typed.
 */
export function rowKeyOf(content: string, productId: string | null): string {
  return productId ? `item:${productId}` : `text:${normalizeContent(content)}`;
}
