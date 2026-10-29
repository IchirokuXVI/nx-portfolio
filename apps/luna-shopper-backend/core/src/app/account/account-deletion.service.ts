import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  CommentTranscription,
  MembershipStatus,
  RealtimeEvent,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import { runOnce } from '@portfolio/luna-shopper/platform';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { deleteAllowanceRowsOf } from '../assistant-allowance/assistant-allowance.sql';
import { CoreAuditService } from '../audit/core-audit.service';
import { BasketAnnouncer } from '../baskets/basket-announcer.service';
import { BasketService } from '../baskets/basket.service';
import { Zone, ZoneMembership } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ProcessedEventStore } from '../events/idempotency.store';
import { announceTripsChanged } from '../lists/trips/trips.announce';
import { ZoneCountsService } from '../zones/zone-counts.service';
import { toMembershipView, toZoneView } from '../zones/zone.mappers';
import { anonymizedUsername } from './anonymize';

/**
 * The dedupe key of one deletion (plan 0232, section 5): the sha256 of the user
 * id, so `processed_events` no longer holds the id of a person who is gone.
 */
export function deletionKey(userId: string): string {
  const hash = createHash('sha256').update(userId.toLowerCase()).digest('hex');
  return `user.deleted:${hash}`;
}

/**
 * What every tombstone starts with: eight zeros, then 96 random bits of a v4
 * uuid. A random id, as plan 0232 section 1 asks, derived from nothing and
 * stored nowhere else, and still one a reader can tell from a user id. That
 * is what lets the reconcile command of section 7 leave tombstones alone, so a
 * second run of its release task finds nothing to do. A user id is a random
 * v4 uuid, which starts with eight zeros once in four billion.
 */
export const TOMBSTONE_PREFIX = '00000000-';

/** A fresh tombstone (plan 0232, section 1). */
export function tombstoneId(): string {
  return `${TOMBSTONE_PREFIX}${randomUUID().slice(TOMBSTONE_PREFIX.length)}`;
}

/**
 * The key plan 0011 wrote, with the user id in it. A deletion removes the one of
 * its own person, so the release task of plan 0232 section 7 leaves none behind.
 */
function legacyDeletionKey(userId: string): string {
  return `user.deleted:${userId}`;
}

/** What the transaction did that open screens must hear, sent after it commits. */
interface Announcements {
  tripLists: string[];
  markedZones: Zone[];
  /** Each retired membership, with the id its own sessions still answer to. */
  kicked: { membership: ZoneMembership; userId: string }[];
}

interface ZoneRow {
  zoneId: string;
}

interface ParticipantZoneRow {
  id: string;
  zoneId: string | null;
}

interface CommentIdRow {
  id: string;
}

/**
 * Core's reaction to a user being deleted (plan 0011, section 2; plan 0232).
 *
 * Auth removes the identity and publishes `user.deleted` on a JetStream stream;
 * {@link AccountDeletionConsumer} hands it here. The owner's rule decides every
 * table (plan 0232, section 2): what is personal is deleted, and what others
 * still use is kept with the user id replaced by a **tombstone**, a random uuid
 * generated here, one per zone, and stored nowhere else. Within a zone the
 * person's lines, comments and membership keep pointing at one another, so the
 * zone keeps saying "former member" for all of them; across zones nothing links
 * them.
 *
 * ## One transaction
 *
 * The whole deletion, the idempotency key included, is one transaction (section
 * 3). A failure anywhere rolls everything back, the key with it, so the
 * redelivery that the consumer's nak asks for does the whole thing again. The
 * events go out after the commit, from what the transaction collected.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    private readonly events: CoreEventsPublisher,
    private readonly zoneCounts: ZoneCountsService,
    private readonly store: ProcessedEventStore,
    private readonly baskets: BasketService,
    // A retired membership moves what the household's open baskets cover (plan
    // 0139, section 5).
    private readonly announcer: BasketAnnouncer,
    // The trail is scrubbed in the same transaction (plan 0232, section 4).
    private readonly audit: CoreAuditService
  ) {}

  /**
   * Handle `user.deleted`, once per user (plan 0232, section 5). Answers
   * whether this call did the deletion; false is a redelivery of one already
   * done.
   */
  async handleUserDeleted(userId: string): Promise<boolean> {
    const announcements = await this.dataSource.transaction((manager) =>
      runOnce(
        // The key is written through the deletion's manager, so a rollback
        // takes it back. Written first, so a second delivery of the same id
        // running at the same moment waits on the unique key and then finds
        // it, instead of rewriting the same rows beside this one.
        { firstSeen: (key) => this.store.firstSeenIn(manager, key) },
        deletionKey(userId),
        () => this.apply(manager, userId)
      )
    );
    if (!announcements) {
      return false;
    }
    // The deletion is committed. A failure to tell open screens is logged and
    // swallowed: thrown, it would make the consumer nak a deletion that is
    // done, whose redelivery finds the key and does nothing, under a log line
    // that says it rolled back.
    try {
      await this.announce(announcements);
    } catch (err) {
      this.logger.error(
        { err },
        'account deletion committed, but announcing it to open screens failed'
      );
    }
    return true;
  }

  /**
   * A seam for the integration spec, which throws here to prove that a failure
   * after the zone rewrites leaves nothing changed (plan 0232, section 8).
   */
  protected async afterZoneRewrites(_manager: EntityManager): Promise<void> {
    // Nothing in production.
  }

  /** Sections 3 and 4, in the order section 3 gives. */
  private async apply(
    manager: EntityManager,
    userId: string
  ): Promise<Announcements> {
    await manager.query(`DELETE FROM "processed_events" WHERE "key" = $1`, [
      legacyDeletionKey(userId),
    ]);

    // Step 1. Their baskets go first, because a basket belongs to a person
    // rather than to a zone (plan 0050, section 7). The settlements those
    // baskets wrote stay: a settlement is a zone fact (plan 0047, section 3.1).
    const tripLists = await this.baskets.deleteForUserIn(manager, userId);

    // Read before step 2 rewrites the author and the membership: the comments
    // whose voice step 3 deletes, the memberships, and the zone each of the
    // person's rows on somebody else's basket belongs to.
    const voiced = (await manager.query(
      `SELECT c."id" FROM "line_comments" c WHERE c."authorUserId" = $1::uuid`,
      [userId]
    )) as CommentIdRow[];
    const memberships = await manager
      .getRepository(ZoneMembership)
      .find({ where: { userId } });
    const participants = (await manager.query(PARTICIPANT_ZONES_SQL, [
      userId,
    ])) as ParticipantZoneRow[];

    // Every zone that holds a row naming the person, and not only the zones
    // they hold a membership in (plan 0232, section 3, the last paragraph).
    // Leaving keeps the row, but rejecting a pending member deletes it
    // (`MembershipService.reject`), and a merge request names them before any
    // approval.
    const zoneIds = (
      (await manager.query(TOUCHED_ZONES_SQL, [userId])) as ZoneRow[]
    ).map((row) => row.zoneId);
    for (const membership of memberships) {
      if (!zoneIds.includes(membership.zoneId)) {
        zoneIds.push(membership.zoneId);
      }
    }

    const tombstoneOfZone = new Map<string, string>();
    const anonymizedNameOfZone = new Map<string, string>();
    for (const zoneId of zoneIds) {
      tombstoneOfZone.set(zoneId, tombstoneId());
    }
    for (const membership of memberships) {
      anonymizedNameOfZone.set(
        membership.zoneId,
        anonymizedUsername(membership.id)
      );
    }

    // Step 2, zone by zone.
    const kicked: Announcements['kicked'] = [];
    for (const zoneId of zoneIds) {
      const tombstone = tombstoneOfZone.get(zoneId) as string;
      await this.rewriteZone(manager, userId, zoneId, tombstone);

      const name = anonymizedNameOfZone.get(zoneId);
      const theirs = participants
        .filter((row) => row.zoneId === zoneId)
        .map((row) => row.id);
      if (name && theirs.length > 0) {
        await scrubParticipants(manager, theirs, name);
      }

      // Retire the membership: the anonymized name, no access, and the
      // tombstone in place of the user id. What they wrote resolves to it, and
      // the KICKED row keeps it drawing as "former member".
      const membership = memberships.find((m) => m.zoneId === zoneId);
      if (membership) {
        membership.username = anonymizedUsername(membership.id);
        membership.status = MembershipStatus.KICKED;
        membership.userId = tombstone;
        kicked.push({
          membership: await manager
            .getRepository(ZoneMembership)
            .save(membership),
          userId,
        });
      }
    }
    // A row on a basket that draws from no zone they shared with its owner
    // gets a name of its own, from the row's id, so nothing ties it to a zone.
    for (const row of participants) {
      if (!row.zoneId || !anonymizedNameOfZone.has(row.zoneId)) {
        await scrubParticipants(manager, [row.id], anonymizedUsername(row.id));
      }
    }

    // The ownerless fallback (plan 0006, section 5): a zone they owned is
    // marked for deletion and rescuable by an admin claim.
    const zones = manager.getRepository(Zone);
    const markedZones: Zone[] = [];
    for (const zone of await zones.find({ where: { ownerUserId: userId } })) {
      zone.ownerUserId = null;
      zone.status = ZoneStatus.MARKED_FOR_DELETION;
      zone.markedForDeletionAt = new Date();
      markedZones.push(await zones.save(zone));
    }

    await this.afterZoneRewrites(manager);

    // Step 3, outside any zone.
    const commentIds = voiced.map((row) => row.id);
    if (commentIds.length > 0) {
      await manager.query(
        `DELETE FROM "comment_audio" WHERE "commentId" = ANY($1::uuid[])`,
        [commentIds]
      );
      // So it reads as a comment with no recording. `transcription` stays: it
      // is the transcript's state, and the owner keeps transcripts. A pending
      // one becomes FAILED: the recording it would be made from is gone, and
      // `setTranscription` refuses once the author is a tombstone, so PENDING
      // would never end.
      await manager.query(
        `UPDATE "line_comments"
            SET "audioContentType" = NULL,
                "audioByteLength" = NULL,
                "audioDurationSeconds" = NULL,
                "transcription" = CASE WHEN "transcription" = $2
                                       THEN $3 ELSE "transcription" END
          WHERE "id" = ANY($1::uuid[])`,
        [commentIds, CommentTranscription.PENDING, CommentTranscription.FAILED]
      );
    }
    // A settlement whose list names no zone above, which a line always has, is
    // the defensive case: it still must not keep the id.
    const deletionTombstone = tombstoneId();
    await manager.query(
      `UPDATE "line_settlements" SET "settledByUserId" = $2::uuid
        WHERE "settledByUserId" = $1::uuid`,
      [userId, deletionTombstone]
    );
    await manager.query(
      `UPDATE "basket_participants" SET "invitedByUserId" = NULL
        WHERE "invitedByUserId" = $1::uuid`,
      [userId]
    );
    // The postal codes, preferences and generation sources cascade with it.
    await manager.query(
      `DELETE FROM "shopping_profiles" WHERE "userId" = $1::uuid`,
      [userId]
    );
    await manager.query(
      `DELETE FROM "user_app_state" WHERE "userId" = $1::uuid`,
      [userId]
    );
    // Their assistant allowance (plan 0234, section 9): the usage rows and the
    // open reservations. They hold no zone. The deployment's rows hold no
    // person and stay, with what the reservations held taken back out.
    await deleteAllowanceRowsOf(manager, userId);

    // Step 4.
    await this.audit.scrubUser(
      manager,
      userId,
      tombstoneOfZone,
      anonymizedNameOfZone,
      {
        tombstone: deletionTombstone,
        membershipIds: memberships.map((m) => m.id),
      }
    );

    // Step 5, the key, was written first by `runOnce` on this manager.
    return { tripLists, markedZones, kicked };
  }

  /**
   * Every user column of section 2 in one zone, from the user id to the zone's
   * tombstone: the statements of `merge.service.ts` scoped by zone, plus the
   * change log, the approvals and the merge requests.
   *
   * Raw SQL, so the soft deleted lines are reached too: a deleted line must not
   * keep its author when everything else forgot them (plan 0132).
   */
  private async rewriteZone(
    manager: EntityManager,
    userId: string,
    zoneId: string,
    tombstone: string
  ): Promise<void> {
    const parameters = [userId, tombstone, zoneId];
    await manager.query(
      `UPDATE "shopping_lists" SET "createdByUserId" = $2::uuid
        WHERE "zoneId" = $3::uuid AND "createdByUserId" = $1::uuid`,
      parameters
    );
    await manager.query(
      `UPDATE "list_lines" SET
         "createdByUserId" = CASE WHEN "createdByUserId" = $1::uuid
                                  THEN $2::uuid ELSE "createdByUserId" END,
         "approvedByUserId" = CASE WHEN "approvedByUserId" = $1::uuid
                                   THEN $2::uuid ELSE "approvedByUserId" END,
         "deletedByUserId" = CASE WHEN "deletedByUserId" = $1::uuid
                                  THEN $2::uuid ELSE "deletedByUserId" END
        WHERE $1::uuid IN ("createdByUserId", "approvedByUserId", "deletedByUserId")
          AND "listId" IN (SELECT "id" FROM "shopping_lists" WHERE "zoneId" = $3::uuid)`,
      parameters
    );
    await manager.query(
      `UPDATE "line_comments" SET "authorUserId" = $2::uuid
        WHERE "authorUserId" = $1::uuid
          AND "lineId" IN (
                SELECT ll."id" FROM "list_lines" ll
                  JOIN "shopping_lists" sl ON sl."id" = ll."listId"
                 WHERE sl."zoneId" = $3::uuid)`,
      parameters
    );
    await manager.query(
      `UPDATE "list_line_changes" SET "actorUserId" = $2::uuid
        WHERE "zoneId" = $3::uuid AND "actorUserId" = $1::uuid`,
      parameters
    );
    await manager.query(
      `UPDATE "zone_memberships" SET "approvedByUserId" = $2::uuid
        WHERE "zoneId" = $3::uuid AND "approvedByUserId" = $1::uuid`,
      parameters
    );
    await manager.query(
      `UPDATE "merge_requests" SET
         "sourceUserId" = CASE WHEN "sourceUserId" = $1::uuid
                               THEN $2::uuid ELSE "sourceUserId" END,
         "targetUserId" = CASE WHEN "targetUserId" = $1::uuid
                               THEN $2::uuid ELSE "targetUserId" END,
         "requestedByUserId" = CASE WHEN "requestedByUserId" = $1::uuid
                                    THEN $2::uuid ELSE "requestedByUserId" END,
         "resolvedByUserId" = CASE WHEN "resolvedByUserId" = $1::uuid
                                   THEN $2::uuid ELSE "resolvedByUserId" END
        WHERE "zoneId" = $3::uuid
          AND $1::uuid IN ("sourceUserId", "targetUserId",
                           "requestedByUserId", "resolvedByUserId")`,
      parameters
    );
    // Not null, as section 2 says: `ck_line_settlements_actor` holds exactly
    // one of the user and the participant, and a row the person settled from
    // the list page has no participant. The purchase stays the household's,
    // and the tombstone also empties the person's recent shops.
    await manager.query(
      `UPDATE "line_settlements" SET "settledByUserId" = $2::uuid
        WHERE "settledByUserId" = $1::uuid
          AND "listId" IN (SELECT "id" FROM "shopping_lists" WHERE "zoneId" = $3::uuid)`,
      parameters
    );
  }

  /** The events of the loop, now that the deletion is committed. */
  private async announce(done: Announcements): Promise<void> {
    for (const zone of done.markedZones) {
      this.events.emit(
        RealtimeEvent.ZoneMarkedForDeletion,
        zone.id,
        toZoneView(zone)
      );
    }
    for (const { membership, userId } of done.kicked) {
      this.events.emitTo(
        RealtimeEvent.MemberKicked,
        // The person's own id and not the tombstone, which reaches no session:
        // a socket of theirs still open must leave the zone room. The id is
        // only an address here, and nothing stores it.
        { zoneId: membership.zoneId, userIds: [userId] },
        toMembershipView(membership)
      );
      // A retired membership is a member leaving the household, so what the
      // remaining members' open baskets cover moved (plan 0139, section 5).
      await this.announcer.coverageMoved(membership.zoneId);
      // The member count drops with no user action at all, so the zone's open
      // screens need telling (plan 0017, section 9).
      await this.zoneCounts.emitZoneCounts(membership.zoneId);
    }
    // The basket trips the deleted baskets were (plan 0122, section 6).
    announceTripsChanged(this.events, done.tripLists);
  }

  /**
   * The subset of `userIds` that hold NO zone membership (plan 0011, section 3).
   * Answers the auth orphan-user reaper's reconciliation query: core is the
   * authority on membership, so it decides which aged temporary users are truly
   * abandoned before auth deletes them.
   */
  async usersWithoutMemberships(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) {
      return [];
    }
    const rows = await this.memberships
      .createQueryBuilder('m')
      .select('DISTINCT m."userId"', 'userId')
      .where('m."userId" IN (:...ids)', { ids: userIds })
      .getRawMany<{ userId: string }>();
    const withMembership = new Set(rows.map((r) => r.userId));
    return userIds.filter((id) => !withMembership.has(id));
  }
}

/**
 * The zones that hold a row naming the person in a column of section 2.
 * `processed_events`, the baskets, the profiles and the app state name no zone.
 */
const TOUCHED_ZONES_SQL = `
  SELECT DISTINCT t."zoneId"::text AS "zoneId" FROM (
    SELECT m."zoneId" FROM "zone_memberships" m
     WHERE m."userId" = $1::uuid OR m."approvedByUserId" = $1::uuid
    UNION
    SELECT l."zoneId" FROM "shopping_lists" l WHERE l."createdByUserId" = $1::uuid
    UNION
    SELECT l."zoneId" FROM "list_lines" ll
      JOIN "shopping_lists" l ON l."id" = ll."listId"
     WHERE $1::uuid IN (ll."createdByUserId", ll."approvedByUserId", ll."deletedByUserId")
    UNION
    SELECT l."zoneId" FROM "line_comments" c
      JOIN "list_lines" ll ON ll."id" = c."lineId"
      JOIN "shopping_lists" l ON l."id" = ll."listId"
     WHERE c."authorUserId" = $1::uuid
    UNION
    SELECT ch."zoneId" FROM "list_line_changes" ch WHERE ch."actorUserId" = $1::uuid
    UNION
    SELECT r."zoneId" FROM "merge_requests" r
     WHERE $1::uuid IN (r."sourceUserId", r."targetUserId",
                        r."requestedByUserId", r."resolvedByUserId")
    UNION
    SELECT l."zoneId" FROM "line_settlements" s
      JOIN "shopping_lists" l ON l."id" = s."listId"
     WHERE s."settledByUserId" = $1::uuid
  ) t`;

/**
 * The person's rows on other people's baskets, each with the zone whose
 * anonymized name it takes: a zone the basket draws from where the person was
 * a member, else a zone they shared with the basket's owner. A `LIVE` basket
 * names no source (plan 0136), which is why the second exists. Their own
 * baskets are gone by step 1, so every row here is on somebody else's.
 */
const PARTICIPANT_ZONES_SQL = `
  SELECT p."id",
         COALESCE(
           (SELECT m."zoneId"::text FROM "basket_sources" s
              JOIN "zone_memberships" m
                ON m."zoneId" = s."zoneId" AND m."userId" = $1::uuid
             WHERE s."basketId" = p."basketId"
             ORDER BY m."createdAt", m."id" LIMIT 1),
           (SELECT m."zoneId"::text FROM "baskets" b
              JOIN "zone_memberships" o ON o."userId" = b."ownerUserId"
              JOIN "zone_memberships" m
                ON m."zoneId" = o."zoneId" AND m."userId" = $1::uuid
             WHERE b."id" = p."basketId"
             ORDER BY m."createdAt", m."id" LIMIT 1)
         ) AS "zoneId"
    FROM "basket_participants" p
   WHERE p."userId" = $1::uuid`;

/**
 * Keep the rows, because that basket's settlements, skips and trip rows point
 * at them (plan 0232, section 2), and take the person out of them.
 */
async function scrubParticipants(
  manager: EntityManager,
  ids: string[],
  name: string
): Promise<void> {
  await manager.query(
    `UPDATE "basket_participants"
        SET "userId" = NULL,
            "userAgent" = NULL,
            "sessionSecretHash" = NULL,
            "username" = $2,
            "displayName" = $2
      WHERE "id" = ANY($1::uuid[])`,
    [ids, name]
  );
}
