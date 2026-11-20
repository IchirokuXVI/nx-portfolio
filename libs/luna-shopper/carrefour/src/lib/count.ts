/**
 * A count as an English sentence prints it: 1,100 and not 1100 (owner
 * decision 139b).
 *
 * Every sentence the Carrefour walk writes for a person, a run warning, a
 * stage or what a page cost, prints its counts of products, listings, rows,
 * pages and offsets through this one function, so no two sentences of one run
 * group a number differently. It is for counts only: a category id, a status
 * code or a run id is never a count and is printed as it is.
 */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}
