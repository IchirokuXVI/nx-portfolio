/**
 * One page of a person's contacts (plan 0114, section 2). `$1` is the person,
 * `$2` the membership the cursor names or null, `$3` the row limit.
 *
 * Every approved membership in every group where the person's own membership is
 * approved, their own excluded. A temporary account holds a membership like any
 * other account, so it is included without a clause saying so.
 *
 * Ordered by the membership's id and by nothing a client would draw. The order
 * exists only so the keyset cursor is exact, and the id is what the cursor
 * names, so no timestamp precision is involved (the reason
 * `member-listing.service.ts` gives for its own cursor).
 *
 * camelCase columns are quoted by hand, because TypeORM rewrites no
 * `alias.property` inside raw SQL.
 */
export const CONTACTS_SQL = `
  SELECT them.id AS "membershipId",
         them."userId" AS "userId",
         them."zoneId" AS "zoneId",
         them."username" AS "username"
  FROM "zone_memberships" me
  JOIN "zone_memberships" them
    ON them."zoneId" = me."zoneId"
   AND them."status" = 'APPROVED'
   AND them."userId" <> me."userId"
  WHERE me."userId" = $1
    AND me."status" = 'APPROVED'
    AND ($2::uuid IS NULL OR them.id > $2::uuid)
  ORDER BY them.id ASC
  LIMIT $3
`;

/** One row of {@link CONTACTS_SQL}. */
export interface ContactRow {
  membershipId: string;
  userId: string;
  zoneId: string;
  username: string;
}
