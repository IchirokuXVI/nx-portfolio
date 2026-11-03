import { isUuid } from '@portfolio/luna-shopper/platform';
import type { EntityManager } from 'typeorm';

/**
 * How many times {@link survivorsOf} follows a merged row. The one level rule
 * (plan 0239) makes one step the whole chain. A merge that commits while the
 * read runs can add one more step, and a third is room for that.
 */
const MAX_STEPS = 3;

/**
 * The survivor of each merged product among these ids (plan 0239).
 *
 * **Every write that names a product by id resolves it here first**, so a
 * write that names a merged product lands on its survivor. The harvester and
 * core hear of a merge by an event that is fire and forget, and a running
 * harvest keeps the id it read for each batch, so writes to a merged id go on
 * arriving after the merge. A row written to the merged product would sit on a
 * row that no shopper read shows.
 *
 * The answer names only the ids that are merged. An id that is live, unknown
 * or not a uuid is absent, and {@link toSurvivor} answers it unchanged, so a
 * write keeps the refusal it already gives for a product that does not exist.
 *
 * With `lock`, each row read is held `FOR KEY SHARE` until the caller's
 * transaction ends. A merge locks both of its rows `FOR UPDATE` first, so a
 * merge that is running makes this read wait and then see it, and a merge that
 * starts after this read waits for the write. Without a transaction the lock
 * ends with the statement, and a merge that commits between this read and the
 * write can still receive it: the next write of the same product resolves it.
 */
export async function survivorsOf(
  manager: EntityManager,
  itemIds: readonly string[],
  options: { lock?: boolean } = {}
): Promise<Map<string, string>> {
  const asked = [...new Set(itemIds.filter((id) => isUuid(id)))];
  /** Where each asked id points now, itself until a merged row moves it. */
  const target = new Map(asked.map((id) => [id, id]));
  let pending = asked;
  for (let step = 0; step < MAX_STEPS && pending.length > 0; step++) {
    const rows = (await manager.query(
      `SELECT i."id", i."mergedIntoId"
         FROM "items" i
        WHERE i."id" = ANY($1::uuid[])
        ORDER BY i."id"${options.lock ? '\n          FOR KEY SHARE' : ''}`,
      [pending]
    )) as { id: string; mergedIntoId: string | null }[];
    const next = new Set<string>();
    for (const row of rows) {
      if (!row.mergedIntoId) {
        continue;
      }
      next.add(row.mergedIntoId);
      for (const [id, at] of target) {
        if (at === row.id) {
          target.set(id, row.mergedIntoId);
        }
      }
    }
    pending = [...next];
  }
  return new Map([...target].filter(([id, at]) => id !== at));
}

/** The id a write lands on: the survivor of a merged product, or the id. */
export function toSurvivor(
  survivors: ReadonlyMap<string, string>,
  itemId: string
): string {
  return survivors.get(itemId) ?? itemId;
}

/**
 * A batch of per product values moved onto the survivors, one value per
 * product (plan 0239).
 *
 * Two entries that land on one product are one entry. **An entry that names
 * the survivor itself outranks one that was moved onto it**, because it is
 * what the writer said about that product. Between two entries of the same
 * rank the last one wins, which is the rule each writer already had for a
 * product named twice.
 */
export function ontoSurvivors<T>(
  entries: readonly { itemId: string; value: T }[],
  survivors: ReadonlyMap<string, string>
): Map<string, T> {
  const named = new Map<string, T>();
  const moved = new Map<string, T>();
  for (const entry of entries) {
    const survivor = survivors.get(entry.itemId);
    if (survivor === undefined) {
      named.set(entry.itemId, entry.value);
    } else {
      moved.set(survivor, entry.value);
    }
  }
  for (const [itemId, value] of moved) {
    if (!named.has(itemId)) {
      named.set(itemId, value);
    }
  }
  return named;
}
