import { READABLE_LIST } from '../zones/zone-summary.sql';

/**
 * One product's settlements, across every list the caller may read **at request
 * time** (plan 0047, section 6.2).
 *
 * Raw rather than a query builder, for the reason `ZONE_READABLE_LIST_IDS_SQL` is
 * raw: {@link READABLE_LIST} is written with every camelCase column quoted by
 * hand, because TypeORM does not rewrite `alias.property` inside a raw select
 * expression, and moving it into a `where` would put it somewhere TypeORM does
 * rewrite, against aliases this query does not declare.
 *
 * The access test is an `EXISTS` per settlement row rather than a list of ids
 * computed first. A person can hold thousands of readable lists across every zone
 * they are in, and the id list would be built in full to answer a page of twenty;
 * the `EXISTS` is a primary key lookup on `shopping_lists` and an index lookup on
 * the membership, evaluated only for the rows the item index already found.
 *
 * The cursor is the boundary row's **own** sort key, read back by id rather than
 * carried in the token. An ISO timestamp in a cursor is milliseconds and a
 * `timestamptz` is microseconds, so a token carrying the value skips or repeats
 * the boundary row; this shape cannot, and it costs one primary key lookup.
 *
 * `$1` is the item, `$2` the caller, `$3` the cursor row's id or null, `$4` the
 * limit.
 */
export const ITEM_SETTLEMENTS_SQL = `
  SELECT s."id",
         s."lineId",
         s."listId",
         s."itemId",
         s."outcome",
         s."quantity",
         s."settledByUserId",
         s."settledAt"
  FROM "line_settlements" s
  WHERE s."itemId" = $1
    AND EXISTS (
      SELECT 1
      FROM "shopping_lists" sl
      JOIN "zone_memberships" m
        ON m."zoneId" = sl."zoneId" AND m."userId" = $2
      WHERE sl.id = s."listId" AND (${READABLE_LIST})
    )
    AND (
      $3::uuid IS NULL
      OR (s."settledAt", s."id") <
         (SELECT b."settledAt", b."id" FROM "line_settlements" b WHERE b."id" = $3::uuid)
    )
  ORDER BY s."settledAt" DESC, s."id" DESC
  LIMIT $4
`;
