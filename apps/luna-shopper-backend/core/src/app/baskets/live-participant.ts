import { IsNull, Raw, type FindOptionsWhere } from 'typeorm';
import type {
  BasketParticipant,
  BasketShareLink,
} from '../entities';

/**
 * What it means for somebody to be on a basket right now (plan 0140,
 * section 3).
 *
 * **One definition, in one file, read by every site.** Before this plan the
 * predicate was `revokedAt IS NULL` written out in fourteen places, which was
 * survivable while it was one column. Plan 0140 adds a second clause, and a
 * predicate left behind is an expired person who can still do one thing.
 * `live-participant.spec.ts` greps the folder and fails on any `revokedAt`
 * comparison outside this file.
 *
 * ## The clock is the database's, always
 *
 * `Raw` rather than `MoreThan(new Date())`, so the application's clock and the
 * database's never disagree about the last second of somebody's access, and the
 * sweep of section 7 reads the same clock as the reads it is writing down.
 *
 * ## Why an expiry can be read here at all
 *
 * It is a column of the participant row, copied on at join, and not a lookup of
 * the link. That is what keeps the hot path one indexed lookup that never reads
 * the link (plan 0051, section 3.3), which is the property section 3.4 depends
 * on: a revoked link evicts nobody.
 */

/**
 * The SQL of a live participant, over the alias `p`.
 *
 * For raw statements, which quote every camelCase column by hand because
 * TypeORM rewrites nothing inside them.
 */
export const LIVE_PARTICIPANT = `
  p."revokedAt" IS NULL AND (p."expiresAt" IS NULL OR p."expiresAt" > now())
`;

/**
 * The same rule as a TypeORM `where`, decided by the database's clock.
 *
 * Spread into the `where` of every read that used to write `revokedAt: IsNull()`
 * on its own.
 */
export function liveParticipantWhere(): FindOptionsWhere<BasketParticipant> {
  return {
    revokedAt: IsNull(),
    expiresAt: Raw((alias) => `(${alias} IS NULL OR ${alias} > now())`),
  };
}

/**
 * Whether a row the caller already holds has stopped being live, against a
 * `now` the caller read from the database.
 *
 * For the two places that hold the row rather than querying for one: the rejoin
 * and the promotion both have to tell a live row from an ended one, and both
 * treat an expiry the sweep has not reached yet exactly as they treat an ended
 * row. Reading `revokedAt` alone there would let an expired visitor look live
 * for up to one sweep interval.
 */
export function hasEnded(
  row: Pick<BasketParticipant, 'revokedAt' | 'expiresAt'>,
  now: Date
): boolean {
  if (row.revokedAt) {
    return true;
  }
  return row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();
}

/**
 * A link that may still let somebody in: not revoked, and not past its twelve
 * hours (plan 0140, section 4).
 *
 * Here beside the participant's rule rather than in the service, because the
 * grep spec that guards that rule fails on a `revokedAt: IsNull()` anywhere
 * else in the folder, and a live link is the same kind of statement about the
 * same feature. Two rules, one file, one place to read them both.
 *
 * `liveLink` reads it, so a link whose expiry passed is handed back to nobody:
 * the share sheet sees no link and draws "Share" again, and `ensureLink` mints.
 */
export function liveLinkWhere(): FindOptionsWhere<BasketShareLink> {
  return {
    revokedAt: IsNull(),
    expiresAt: Raw((alias) => `${alias} > now()`),
  };
}
