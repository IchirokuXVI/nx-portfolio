import { QueryFailedError } from 'typeorm';
import type { ItemEanStore } from './item-ean.store';

/** What {@link fakeItemEans} hands back: the double, and the rows it holds. */
export interface FakeItemEans {
  store: ItemEanStore;
  /** Barcode to product, in the order the rows were written. */
  rows: Map<string, string>;
}

/**
 * An {@link ItemEanStore} for the item service specs, which build their
 * subject by hand with fake repositories (plan 0185).
 *
 * One map from barcode to product, which is what the table is. A barcode
 * another product holds is refused by {@link ItemEanStore.insert} the way
 * Postgres refuses it, with a unique violation, because that is the error the
 * service recognizes. What the database really holds, the primary key, the
 * cascade and the check, is proven against real Postgres in
 * `item-eans.integration.spec.ts`.
 *
 * `held` seeds rows a spec did not write through the service: barcode, then
 * the product that holds it.
 */
export function fakeItemEans(
  held: readonly (readonly [ean: string, itemId: string])[] = []
): FakeItemEans {
  const rows = new Map<string, string>(held.map(([ean, id]) => [ean, id]));

  const store = {
    eansOf: async (itemIds: readonly string[]) => {
      const wanted = new Set(itemIds);
      const byItem = new Map<string, string[]>();
      for (const [ean, itemId] of rows) {
        if (wanted.has(itemId)) {
          byItem.set(itemId, [...(byItem.get(itemId) ?? []), ean]);
        }
      }
      return byItem;
    },
    holdersOf: async (eans: readonly string[]) =>
      new Map(
        eans
          .filter((ean) => rows.has(ean))
          .map((ean) => [ean, rows.get(ean) as string])
      ),
    holder: async (_manager: unknown, ean: string) => rows.get(ean) ?? null,
    insert: async (_manager: unknown, itemId: string, ean: string) => {
      if (rows.has(ean)) {
        throw new QueryFailedError('INSERT INTO "item_eans"', [], {
          code: '23505',
          detail: `Key (ean)=(${ean}) already exists.`,
        } as unknown as Error);
      }
      rows.set(ean, itemId);
    },
    remove: async (_manager: unknown, itemId: string, ean: string) => {
      if (rows.get(ean) !== itemId) {
        return false;
      }
      rows.delete(ean);
      return true;
    },
  } as unknown as ItemEanStore;

  return { store, rows };
}
