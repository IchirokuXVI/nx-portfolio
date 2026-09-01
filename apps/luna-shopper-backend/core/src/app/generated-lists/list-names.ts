import { In, type Repository } from 'typeorm';
import type { ShoppingList } from '../entities';

/**
 * One list, named for a caption: "from Weekly shop, in Flat 3B".
 *
 * Structural rather than a contract type, because two contracts want the same
 * three fields under different names. `GeneratedListSourceName` calls the list's
 * own name `name`; `GeneratedListSettleSkip` calls it `listName`, since it sits
 * beside a `listId` and a reason. The shape they share is this one, and the
 * callers spread it into whichever they answer with.
 */
export interface NamedList {
  listId: string;
  name: string;
  zoneName: string | null;
}

/**
 * Name a set of lists, for a reader who has already been found entitled to the
 * names (plan 0053, section 4).
 *
 * **It does no access check and must not be called without one.** Both callers
 * resolve `seesZoneData` first and skip this entirely when it is false, which is
 * the difference between a rule and a filter: a reader who may not have the names
 * costs no query rather than costing one and having the answer discarded.
 *
 * A list that cannot be read back simply drops out of the map, so a caller
 * defaults it to null rather than to an invented name. That is the ordinary case
 * rather than an error: a basket outlives the lists it drew from, and an origin
 * reported as `ORIGIN_DELETED` is frequently one whose list has gone with it.
 */
export async function namesOfLists(
  lists: Repository<ShoppingList>,
  listIds: readonly string[]
): Promise<Map<string, NamedList>> {
  const unique = [...new Set(listIds)];
  if (unique.length === 0) {
    return new Map();
  }

  const rows = await lists.find({
    where: { id: In(unique) },
    relations: { zone: true },
  });

  return new Map(
    rows.map((row) => [
      row.id,
      {
        listId: row.id,
        name: row.name,
        // Null rather than absent: the list is nameable and its zone was simply
        // not loaded, which is a different thing from "you may not see this".
        zoneName: row.zone?.name ?? null,
      },
    ])
  );
}
