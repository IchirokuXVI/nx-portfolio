import {
  isMeasured,
  lineStepOf,
  type BasketProduct,
  type BasketRow,
  type BasketRowEntry,
  type LineUnitProduct,
} from '@portfolio/velista/models';

/**
 * The step an entry's line is pressed by in the basket: `lineStepOf` over every
 * product the line holds (velista `0186`, decision A, as the owner ruled on
 * 2026-11-12), so a line steps here as it steps on its list, its line page and
 * the lists table.
 *
 * A product comes from the basket read when the read named it (a row's own
 * product always is), else from the app's `ItemNames` records. A product neither
 * names says nothing (decision B), so a line whose records are not read yet steps
 * by the products that are, and by the unit's default while none is.
 */
export function basketLineStep(
  entry: Pick<BasketRowEntry, 'unit' | 'itemIds'>,
  products: ReadonlyMap<string, BasketProduct>,
  recordOf: (itemId: string) => LineUnitProduct | null
): number | null {
  return lineStepOf(
    entry,
    (itemId) => products.get(itemId) ?? recordOf(itemId)
  );
}

/**
 * The products of the basket's measured lines that the basket read did not name,
 * for `ItemNames` to read (velista `0186`). The read names the product each row
 * counts as and no other, so a line of one product asks for nothing, and a count
 * never does, since its step is always 1.
 */
export function unreadLineProducts(
  rows: readonly BasketRow[],
  products: ReadonlyMap<string, BasketProduct>
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const entry of row.entries) {
      if (!isMeasured(entry.unit)) {
        continue;
      }
      for (const itemId of entry.itemIds) {
        if (!products.has(itemId)) {
          ids.add(itemId);
        }
      }
    }
  }
  return [...ids].sort();
}
