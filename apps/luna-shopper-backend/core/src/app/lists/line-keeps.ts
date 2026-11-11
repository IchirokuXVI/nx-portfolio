import type { EntityManager } from 'typeorm';
import type { ListLine } from '../entities';

/**
 * Whether a line holds anything a person wrote, and so stays at 0 (plan 0263,
 * section 1).
 *
 * A line that a member lowers from above 0 to 0 is deleted when this answers
 * false. The list is closed, and a line is kept when ANY of these holds:
 *
 * 1. `named`: a person typed the name. A line with no product is always named
 *    (`line-named.ts`, rule 1), so a free text line is always kept (D3).
 * 2. `preferredSupermarketId`: the chain.
 * 3. `favoriteItemId`: the product a person chose among several (D4).
 * 4. Any `line_settlements` row, of either outcome, reverted or not (D2).
 * 5. Any `line_comments` row, typed or voice.
 *
 * What the app wrote does not count (D1): the products, the group, the unit,
 * the order, the approval and the change history.
 *
 * `line` is the row the caller's write locked with `FOR UPDATE`, and `manager`
 * is that write's. Both tables carry a foreign key to `list_lines`, so an
 * insert of a buy or a comment waits for that lock and cannot land between
 * this read and the delete.
 *
 * **Only `addQuantity` and a member's `update` call it.** A settle saves the
 * lowered line before it inserts the buy, and a rule asked at that save would
 * delete a line about to hold a purchase. The settle specs pin that.
 */
export async function lineKeeps(
  manager: EntityManager,
  line: Pick<
    ListLine,
    'id' | 'named' | 'preferredSupermarketId' | 'favoriteItemId'
  >
): Promise<boolean> {
  if (
    line.named ||
    line.preferredSupermarketId !== null ||
    line.favoriteItemId !== null
  ) {
    return true;
  }
  const [row] = (await manager.query(
    `SELECT EXISTS (SELECT 1 FROM line_settlements s WHERE s."lineId" = $1)
         OR EXISTS (SELECT 1 FROM line_comments c WHERE c."lineId" = $1)
         AS "keeps"`,
    [line.id]
  )) as { keeps: boolean }[];
  return row?.keeps === true;
}
