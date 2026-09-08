import { normalizeContent } from '../lists/line-content';

/**
 * When two lines of one basket are the same line (plan 0094, section 5).
 *
 * ## Why the basket cannot merge by name alone
 *
 * A zone list holds one line per normalized name (plan 0091) and that is the
 * whole of its rule. A basket cannot borrow it, because plan 0094 makes siblings
 * that **share a name on purpose**: Milk, Skimmed and Milk, Whole are two rows
 * of one shop, and folding them together would put two products on a line that
 * may hold one.
 *
 * > Two basket lines merge when their normalized content is equal and their
 * > products are equal or one of them has none.
 *
 * The "or one of them has none" half is what makes a typed "Milk" land on the
 * Milk that is already there rather than beside it, and what lets a group added
 * line (plan 0055, section 3), which carries options and no pick, be the row a
 * later choice lands on.
 *
 * ## The order matters when several rows match
 *
 * A product free line beside Milk, Skimmed and Milk both match a typed "Milk",
 * and only one of them is the right answer. Case 2 sits before case 3
 * deliberately: an incoming line naming no product lands on the row that names
 * none either, so nothing chooses a milk the shopper did not.
 */

/** The fields the rule reads. Anything with these may be handed to it. */
export interface MergeableBasketLine {
  id: string;
  content: string;
  itemId: string | null;
  position: number;
}

/**
 * The line an incoming one belongs to, or null when it belongs to none.
 *
 * `candidates` is every other line of the basket; the caller excludes the line
 * being placed, which is what stops a split's share merging back into the line
 * it came from.
 */
export function findMergeTarget<T extends MergeableBasketLine>(
  candidates: readonly T[],
  incoming: { content: string; itemId: string | null }
): T | null {
  const name = normalizeContent(incoming.content);
  const matches = candidates
    .filter((line) => normalizeContent(line.content) === name)
    .filter(
      (line) =>
        line.itemId === incoming.itemId ||
        line.itemId === null ||
        incoming.itemId === null
    )
    // Earliest first, so case 3 below is a `[0]` rather than a second sort.
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));

  if (matches.length === 0) {
    return null;
  }
  // 1. A line with the same product. An exact identity beats every fallback,
  //    including a product free row that happens to sit above it.
  const sameProduct = matches.find((line) => line.itemId === incoming.itemId);
  if (sameProduct) {
    return sameProduct;
  }
  // 2. The incoming names no product, so the row that names none is the honest
  //    home for it: choosing one of the named rows would choose a product.
  if (incoming.itemId === null) {
    const noProduct = matches.find((line) => line.itemId === null);
    if (noProduct) {
      return noProduct;
    }
  }
  // 3. Otherwise the earliest by position, which is the survivor rule of
  //    section 5.2 asked one step early.
  return matches[0];
}
