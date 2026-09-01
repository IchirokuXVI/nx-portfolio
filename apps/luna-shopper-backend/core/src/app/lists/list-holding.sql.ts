import { READABLE_LIST } from '../zones/zone-summary.sql';

/**
 * Which lists still want a given product, for one caller (plan 0053, section 3).
 *
 * Raw for the same reason `ITEM_SETTLEMENTS_SQL` beside it is raw:
 * {@link READABLE_LIST} quotes every camelCase column by hand, and TypeORM
 * rewrites neither those nor an alias this query declares itself.
 *
 * **What counts as "holding" it.** The same two predicates a generation run uses
 * to decide a line is worth taking (`CANDIDATE_LINES_SQL`, plan 0050 section 3):
 * `approvalStatus = 'APPROVED'` and `quantity > 0`. A `PENDING` line is a request
 * nobody has agreed to and a `REJECTED` one is a decision, and a line at zero is
 * something the household knows about and does not currently need. Sharing the
 * definition is the point: a sheet saying "also on Weekly shop" about a list a
 * composer would draw nothing from is two answers to one question.
 *
 * The access test is the same `EXISTS` per candidate row, evaluated only for the
 * lists the item index already reached, rather than materialising every list the
 * caller can read. A person can hold thousands.
 *
 * `DISTINCT ON` because a list may carry the product on several lines, and the
 * answer is a set of lists: the quantity reported is that list's largest single
 * outstanding line rather than a sum, since two lines wanting two each is not a
 * household wanting four of one thing.
 *
 * `$1` is the item, `$2` the caller, `$3` the list to leave out or null, `$4` the
 * cap plus one, so the caller can tell whether the cap bit without a second read.
 */
export const LISTS_HOLDING_ITEM_SQL = `
  SELECT * FROM (
    SELECT DISTINCT ON (sl.id)
           sl.id AS "listId",
           sl."name" AS "name",
           sl."zoneId" AS "zoneId",
           z."name" AS "zoneName",
           ll.quantity AS "quantity",
           sl."updatedAt" AS "updatedAt"
    FROM "list_line_items" lli
    JOIN "list_lines" ll ON ll.id = lli."lineId"
    JOIN "shopping_lists" sl ON sl.id = ll."listId"
    JOIN "zones" z ON z.id = sl."zoneId"
    JOIN "zone_memberships" m
      ON m."zoneId" = sl."zoneId" AND m."userId" = $2
    WHERE lli."itemId" = $1
      AND ll."approvalStatus" = 'APPROVED'
      AND ll.quantity > 0
      AND ($3::uuid IS NULL OR sl.id <> $3::uuid)
      AND (${READABLE_LIST})
    ORDER BY sl.id, ll.quantity DESC, ll.id
  ) holding
  ORDER BY holding."updatedAt" DESC, holding."listId"
  LIMIT $4
`;

/** One row of {@link LISTS_HOLDING_ITEM_SQL}. */
export interface ListHoldingItemRow {
  listId: string;
  name: string;
  zoneId: string;
  zoneName: string;
  quantity: number;
}
