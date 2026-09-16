/**
 * One page of a person's contacts (plan 0114, section 2). `$1` is the person,
 * `$2` and `$3` the group and membership the cursor names, both or neither null,
 * `$4` the row limit.
 *
 * Every approved membership in every group where the person's own membership is
 * approved, their own excluded. A temporary account holds a membership like any
 * other account, so it is included without a clause saying so.
 *
 * **Ordered by group, then by membership id**, so every member of one group
 * arrives before any member of the next. A client that draws a page as it lands
 * never receives a member of a group it has already drawn and scrolled past,
 * which ordering by membership id alone did: one page could hold five people of
 * one group and three of another, and the next page a sixth of the first. The
 * cursor names both ids, and both are uuids, so the keyset comparison is exact
 * with no timestamp precision involved (the reason `member-listing.service.ts`
 * gives for its own cursor) and holds when the membership it names is gone.
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
    AND ($2::uuid IS NULL OR (them."zoneId", them.id) > ($2::uuid, $3::uuid))
  ORDER BY them."zoneId" ASC, them.id ASC
  LIMIT $4
`;

/** One row of {@link CONTACTS_SQL}. */
export interface ContactRow {
  membershipId: string;
  userId: string;
  zoneId: string;
  username: string;
}
