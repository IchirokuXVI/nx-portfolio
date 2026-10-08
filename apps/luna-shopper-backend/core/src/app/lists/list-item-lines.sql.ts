import { READABLE_LIST } from '../zones/zone-summary.sql';

/**
 * Every list one caller can read, in every zone, with what the caller holds on
 * each (plan 0196, section 3).
 *
 * The first of two statements. `LISTS_HOLDING_ITEM_SQL` beside this file starts
 * at the product and reaches only the lists that want it. This one starts at
 * the caller, because a list that does not hold the product is in the answer
 * too: the sheet draws one stepper for each list.
 *
 * {@link READABLE_LIST} is the access test, as in every read of a list. A
 * pending membership fails it, so a zone that has not let the caller in yet
 * gives no list.
 *
 * **It says whether the row is staff and does not write out what staff hold**,
 * for the reason `LIST_PERMISSIONS_AMONG_SQL` gives: the grant of staff is
 * `ALL_LIST_PERMISSIONS`, and the service spreads that constant. The stored
 * set is joined as `held`, because {@link READABLE_LIST} names its own
 * `list_access` row `la`.
 *
 * The order is the zone name, the zone id, the list name, the list id. The
 * two ids make it total, so the cap cuts the same lists on each read.
 *
 * `$1` is the caller. `$2` is the cap plus one, so the service can tell that
 * the cap cut the answer with no second read.
 */
export const READABLE_LISTS_WITH_PERMISSIONS_SQL = `
  SELECT sl.id AS "listId",
         sl."name" AS "name",
         sl."zoneId" AS "zoneId",
         z."name" AS "zoneName",
         sl."autoApproveLines" AS "autoApproveLines",
         (m.role IN ('OWNER', 'ADMIN')) AS "staff",
         COALESCE(held."permissions"::text[], ARRAY[]::text[]) AS "permissions"
  FROM "shopping_lists" sl
  JOIN "zones" z ON z.id = sl."zoneId"
  JOIN "zone_memberships" m
    ON m."zoneId" = sl."zoneId" AND m."userId" = $1
  LEFT JOIN "list_access" held
    ON held."listId" = sl.id AND held."membershipId" = m.id
  WHERE (${READABLE_LIST})
  ORDER BY z."name", z.id, sl."name", sl.id
  LIMIT $2
`;

/** One row of {@link READABLE_LISTS_WITH_PERMISSIONS_SQL}. */
export interface ReadableListRow {
  listId: string;
  name: string;
  zoneId: string;
  zoneName: string;
  autoApproveLines: boolean;
  /** Whether this membership carries the derived grant of all four. */
  staff: boolean;
  /** The stored set, empty for a member with no `list_access` row. */
  permissions: string[];
}

/**
 * The lines of these lists that hold one product (plan 0196, section 3).
 *
 * The second statement. It has no access test of its own: the list ids are
 * the ones the first statement answered for this caller, and nothing else is
 * ever passed.
 *
 * **What "holds" means here.** A `list_line_items` row joins the line and the
 * product, the line is not deleted, and it is not `REJECTED`. A merge on add
 * skips a rejected line, so a plus on the sheet would never raise it.
 * `PENDING` lines and lines at quantity zero are in the answer, which is where
 * this differs from `LISTS_HOLDING_ITEM_SQL`: that read asks what a household
 * still wants, and this one asks which line a stepper changes.
 *
 * The cap is applied in the database with a window function, so a list with
 * hundreds of lines of one product hands over the first few and no more.
 * `uq_list_line_item` makes the join answer a line one time.
 *
 * `$1` is the product, `$2` the list ids, `$3` the cap for each list.
 */
export const LINES_HOLDING_ITEM_SQL = `
  SELECT held."id", held."listId", held."content", held."quantity",
         held."approvalStatus"
  FROM (
    SELECT ll.id AS "id",
           ll."listId" AS "listId",
           ll."content" AS "content",
           ll.quantity AS "quantity",
           ll."approvalStatus" AS "approvalStatus",
           row_number() OVER (
             PARTITION BY ll."listId"
             ORDER BY ll."position" ASC, ll.id ASC
           ) AS rn
    FROM "list_line_items" lli
    JOIN "list_lines" ll ON ll.id = lli."lineId"
    WHERE lli."itemId" = $1
      AND ll."listId" = ANY($2::uuid[])
      AND ll."deletedAt" IS NULL
      AND ll."approvalStatus" <> 'REJECTED'
  ) held
  WHERE held.rn <= $3
  ORDER BY held."listId", held.rn
`;

/** One row of {@link LINES_HOLDING_ITEM_SQL}. */
export interface LineHoldingItemRow {
  id: string;
  listId: string;
  content: string;
  quantity: number;
  approvalStatus: string;
}
