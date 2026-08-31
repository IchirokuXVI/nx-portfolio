import { createHash } from 'node:crypto';

/**
 * The identity of a line's product set (plan 0048, section 1.1).
 *
 * **Sorted, then de-duplicated, then joined with commas, then SHA-256 as lower
 * case hex.** Every one of those four steps is load bearing, because the property
 * the hash exists for is that two lines holding the same products carry the same
 * hash *however the products got there*: one shopper picked the Milk group, the
 * other typed a line and added two cartons by hand in the other order, and the
 * dedup rule in `0050`, the cross list indicator in velista `0043` and any future
 * count of how many households hold one set all have to see one value.
 *
 * An **empty set hashes to null**, not to the digest of the empty string. A free
 * text line has no product identity, and giving every one of them the same hash
 * would make the busiest kind of line in the product look like one enormous
 * duplicate group.
 *
 * The core migration computes the same digest in SQL when it carries the retired
 * `list_lines."itemId"` across. The two have to agree, which is what the spec
 * beside this file pins with a value written out by hand.
 */
export function itemSetHash(itemIds: readonly string[]): string | null {
  const distinct = [...new Set(itemIds)].sort();
  if (distinct.length === 0) {
    return null;
  }
  return createHash('sha256').update(distinct.join(','), 'utf8').digest('hex');
}
