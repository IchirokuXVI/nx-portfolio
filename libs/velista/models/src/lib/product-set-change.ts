/**
 * What a set of products gained and lost (velista `0146`, section 3): the bar of
 * the catalog that chooses the products of a line says "2 products added" and
 * "1 product removed" from it, and Save sends nothing when both are empty.
 */
export interface ProductSetChange {
  /** In the set now and not before, in the order of the set now. */
  readonly added: readonly string[];
  /** In the set before and not now, in the order of the set before. */
  readonly removed: readonly string[];
}

/**
 * The difference between the products a line arrived with and the ticked set.
 *
 * Compared as sets: the order of either side is not a change, and a product
 * removed and ticked again is in neither half.
 */
export function productSetChange(
  before: readonly string[],
  after: readonly string[]
): ProductSetChange {
  const had = new Set(before);
  const has = new Set(after);
  return {
    added: [...has].filter((itemId) => !had.has(itemId)),
    removed: [...had].filter((itemId) => !has.has(itemId)),
  };
}

/** Whether {@link productSetChange} found anything. */
export function productSetChanged(change: ProductSetChange): boolean {
  return change.added.length > 0 || change.removed.length > 0;
}
