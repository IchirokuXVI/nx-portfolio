import type { GroupMembersScope } from '@portfolio/velista/data-access';
import type { BasketPriceScope } from '@portfolio/velista/models';

/**
 * Where a basket prices a group's members: the basket's own scopes, sorted so the
 * same basket always asks the same question. Empty when the basket has none, and
 * then the server prices at the caller's profile.
 */
export function basketGroupScope(
  scopes: ReadonlyMap<string, BasketPriceScope> | undefined
): GroupMembersScope {
  return { priceScopeIds: [...(scopes?.keys() ?? [])].sort() };
}

/**
 * A line's products with one replaced by another, in place, with no repeats.
 *
 * The rest of the set is kept as it is: a change of product is not a reason to
 * drop the line's other products.
 */
export function swappedItemIds(
  itemIds: readonly string[],
  from: string,
  to: string
): readonly string[] {
  return [...new Set(itemIds.map((itemId) => (itemId === from ? to : itemId)))];
}
