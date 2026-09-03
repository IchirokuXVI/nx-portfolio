import { LineItemSource } from '@portfolio/luna-shopper/contracts';
import type { ListLineItem } from '../entities';

/**
 * A line's product set, and the part of it the group is still responsible for
 * (plan 0070, section 9).
 *
 * The two halves travel together because they are read from the same rows and
 * because {@link toLineView} needs both: `groupItemIds` is a **subset** of
 * `itemIds`, so a caller that carried only the first and defaulted the second
 * would report every product on a subscribed line as one a person chose. That is
 * the mistake the mapper's other arguments exist to prevent, in a new field, so
 * it takes the pair rather than the array it used to.
 */
export interface LineItemSet {
  /** Every product on the line, in the order they were attached. */
  itemIds: string[];
  /** The subset the group put there and nobody has adopted. */
  groupItemIds: string[];
}

/**
 * A line with no products at all, which is what a free text line is.
 *
 * Written out at the call sites where it is the truth rather than defaulted, on
 * the same terms as {@link NO_LINE_SETTLEMENTS}: a default would let a call site
 * that forgot the set report a line with two products as free text.
 */
export const EMPTY_LINE_ITEM_SET: LineItemSet = {
  itemIds: [],
  groupItemIds: [],
};

/** The pair, read off the membership rows in the order they were attached. */
export function toLineItemSet(
  rows: readonly Pick<ListLineItem, 'itemId' | 'source'>[]
): LineItemSet {
  return {
    itemIds: rows.map((row) => row.itemId),
    groupItemIds: rows
      .filter((row) => row.source === LineItemSource.GROUP)
      .map((row) => row.itemId),
  };
}

/** The same, for a set whose provenance the caller states rather than reads. */
export function lineItemSetOf(
  itemIds: readonly string[],
  groupItemIds: readonly string[] = []
): LineItemSet {
  return { itemIds: [...itemIds], groupItemIds: [...groupItemIds] };
}
