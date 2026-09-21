import { LIVE_PARTICIPANT } from './live-participant';

/**
 * The reads sharing with people you know makes (plan 0114, sections 2, 8 and 9).
 *
 * Raw SQL for the reason `generated-list-sharing.sql.ts` gives, and every
 * camelCase column is quoted by hand for the same reason: TypeORM rewrites no
 * `alias.property` inside raw SQL.
 */

/**
 * Which of these people share an approved group with the given person, in how
 * many groups, and under which name. `$1` is the person, `$2` the ids to test.
 *
 * **A row is a contact** (section 2): both memberships are `APPROVED` in one
 * group. A person with no row shares none, which is what the contact check
 * refuses.
 *
 * `username` is the other person's membership name, and it is the answer only
 * when `groupCount` is one (section 9). `MIN` picks it without a second query:
 * over a single group there is a single name to pick. Over several it is some
 * name, and the caller does not read it.
 *
 * The person themselves is excluded here rather than by every caller, so the
 * owner can never come back as their own contact.
 */
export const COMMON_GROUPS_SQL = `
  SELECT them."userId" AS "userId",
         COUNT(*)::int AS "groupCount",
         MIN(them."username") AS "username"
  FROM "zone_memberships" me
  JOIN "zone_memberships" them
    ON them."zoneId" = me."zoneId"
   AND them."status" = 'APPROVED'
  WHERE me."userId" = $1
    AND me."status" = 'APPROVED'
    AND them."userId" = ANY($2::uuid[])
    AND them."userId" <> $1
  GROUP BY them."userId"
`;

/**
 * One page of the baskets shared with a person (section 8). `$1` is the person,
 * `$2` the basket the cursor names or null, `$3` the row limit.
 *
 * The caller's live `REGISTERED` rows, on baskets that are not `ARCHIVED`,
 * newest share first. `sharedAt` is when the owner added them, and when they
 * joined by the link otherwise.
 *
 * "Live" is {@link LIVE_PARTICIPANT} rather than a `revokedAt` written out here
 * (plan 0140, section 3), so a basket leaves somebody's shared listing at the
 * instant their twelve hours run out and not at the next sweep.
 *
 * ## The cursor names a basket, and Postgres reads its own key back
 *
 * The same reasoning `member-listing.service.ts` gives: a `timestamptz` keeps
 * microseconds and a JavaScript `Date` keeps milliseconds, so a cursor carrying
 * the timestamp itself would compare the boundary row as still ahead of it and
 * repeat it at the top of the next page. The subquery reads the exact key of
 * the row the cursor names. It reads that row whether or not it is still live,
 * because revoked rows are kept, so a person who left the basket at the bottom
 * of one page does not break the next.
 */
export const SHARED_BASKETS_SQL = `
  SELECT p."generatedListId" AS "generatedListId",
         COALESCE(p."invitedAt", p."joinedAt") AS "sharedAt"
  FROM "generated_list_participants" p
  JOIN "generated_lists" gl ON gl.id = p."generatedListId"
  WHERE p."userId" = $1
    AND p."kind" = 'REGISTERED'
    AND ${LIVE_PARTICIPANT}
    AND gl."status" <> 'ARCHIVED'
    AND (
      $2::uuid IS NULL
      OR (COALESCE(p."invitedAt", p."joinedAt"), p."generatedListId") < (
        SELECT COALESCE(b."invitedAt", b."joinedAt"), b."generatedListId"
        FROM "generated_list_participants" b
        WHERE b."generatedListId" = $2 AND b."userId" = $1
      )
    )
  ORDER BY "sharedAt" DESC, p."generatedListId" DESC
  LIMIT $3
`;

/** One row of {@link COMMON_GROUPS_SQL}. */
export interface CommonGroupsRow {
  userId: string;
  groupCount: number;
  username: string;
}

/** One row of {@link SHARED_BASKETS_SQL}. */
export interface SharedBasketRow {
  generatedListId: string;
  sharedAt: Date;
}
