import { Injectable } from '@nestjs/common';
import {
  GENERATED_LIST_SHARING_LIMITS,
  ParticipantKind,
  RealtimeEvent,
  type GeneratedListAccessEvent,
  type UserUsernameView,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, EntityManager } from 'typeorm';
import { GeneratedListParticipant } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import {
  COMMON_GROUPS_SQL,
  type CommonGroupsRow,
} from './generated-list-members.sql';
import { toParticipantView } from './generated-list-sharing.mappers';
import { hasEnded, liveParticipantWhere } from './live-participant';

/** What two people have in common, for the contact check and the name rule. */
export interface CommonGroups {
  /** How many approved groups the two people share. Never zero in an answer. */
  groupCount: number;
  /** The other person's membership name, meaningful only for one group. */
  username: string;
}

/** What adding a person did to their row (section 4's table). */
export interface InviteOutcome {
  participant: GeneratedListParticipant;
  /** True when the row was not live before, so the announcements are due. */
  becameLive: boolean;
}

/** The refusal a full basket gives, whichever door the person came through. */
export const BASKET_FULL = 'This basket already has as many people as it takes';

/**
 * The people an owner shares a basket with on purpose (plan 0114, sections 4, 9
 * and 10).
 *
 * Plan 0051 let people in through a link and nothing else. This is the other
 * door: the owner names a person from their own groups, at creation or later,
 * and that person's row is written at once, with no link behind it. The run and
 * the share sheet both open it, which is why it is a provider of its own rather
 * than a method on either: the contact check, the name rule and the row table
 * must mean the same thing from both.
 *
 * It also owns the announcements every change of access makes, so that a row
 * becoming live, or ending, is told to the basket room and to the person in one
 * place, whichever path caused it.
 */
@Injectable()
export class GeneratedListMembersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * For each of `userIds`, how many approved groups they share with `userId`,
   * and their name when that is exactly one (sections 2 and 9).
   *
   * A person absent from the answer shares no approved group, which is what
   * "not a contact" means. `userId` is never in it.
   */
  async commonGroups(
    userId: string,
    userIds: readonly string[]
  ): Promise<Map<string, CommonGroups>> {
    const byUser = new Map<string, CommonGroups>();
    const others = [...new Set(userIds)].filter((id) => id !== userId);
    if (others.length === 0) {
      return byUser;
    }
    const rows = await this.dataSource.query<CommonGroupsRow[]>(
      COMMON_GROUPS_SQL,
      [userId, others]
    );
    for (const row of rows) {
      byUser.set(row.userId, {
        groupCount: Number(row.groupCount),
        username: row.username,
      });
    }
    return byUser;
  }

  /**
   * Refuse any id that is not one of the owner's contacts at this moment, or
   * that is the owner (section 12), naming every refused id.
   *
   * At this moment and never from a stored list: somebody who left the group
   * this morning is not a contact this afternoon.
   */
  async requireContacts(
    ownerUserId: string,
    userIds: readonly string[],
    field: string
  ): Promise<Map<string, CommonGroups>> {
    const common = await this.commonGroups(ownerUserId, userIds);
    const refused = [
      ...new Set(userIds.filter((id) => id === ownerUserId || !common.has(id))),
    ];
    if (refused.length > 0) {
      throw new ValidationException(
        `not one of your contacts: ${refused.join(', ')}`,
        { messageArgs: { field } }
      );
    }
    return common;
  }

  /**
   * The name an added person's row carries (section 9): their membership name in
   * the one group the two people share, and otherwise the global username the
   * gateway resolved from auth. Null when neither is known, which a client
   * already draws a fallback for.
   */
  nameFor(
    common: CommonGroups | undefined,
    globalUsername: string | null | undefined
  ): string | null {
    const name = common?.groupCount === 1 ? common.username : globalUsername;
    const trimmed = name?.trim();
    return trimmed
      ? trimmed.slice(0, GENERATED_LIST_SHARING_LIMITS.displayNameMaxLength)
      : null;
  }

  /** The global username the gateway resolved for one id, if it resolved one. */
  globalUsernameOf(
    names: readonly UserUsernameView[] | undefined,
    userId: string
  ): string | null {
    return names?.find((row) => row.userId === userId)?.username ?? null;
  }

  /**
   * Serialize every change of who is on a basket, so a count and the write it
   * guards cannot interleave with another join or another add.
   */
  async lock(manager: EntityManager, generatedListId: string): Promise<void> {
    await manager.query(
      `SELECT id FROM "generated_lists" WHERE id = $1 FOR UPDATE`,
      [generatedListId]
    );
  }

  /**
   * Refuse a row becoming live on a basket that is already full.
   *
   * It counts live rows by plan 0140 section 3's rule, so an expired visitor
   * stops counting toward `maxParticipants` at their expiry rather than at the
   * next sweep: the seat is free when the access is, not when a timer says so.
   */
  async checkRoom(
    manager: EntityManager,
    generatedListId: string
  ): Promise<void> {
    const total = await manager.count(GeneratedListParticipant, {
      where: { generatedListId, ...liveParticipantWhere() },
    });
    if (total >= GENERATED_LIST_SHARING_LIMITS.maxParticipants) {
      throw new ConflictException(BASKET_FULL);
    }
  }

  /**
   * Add one person to a basket, as section 4's table says, inside the caller's
   * transaction and under its lock.
   *
   * | The person's row      | Result                                                        |
   * | --------------------- | ------------------------------------------------------------- |
   * | none                  | a `REGISTERED` row, invited, joined now, `expiresAt` null     |
   * | live, joined by link  | becomes invited, the link releases it, **the expiry is gone** |
   * | live, already invited | unchanged                                                     |
   * | ended, any reason     | brought back, invited, joined now, `expiresAt` null           |
   *
   * **This is how somebody is kept** (plan 0140, section 6). A link visitor's
   * access ends by itself twelve hours after they arrived, and the owner adding
   * them by name is the one gesture that makes it stay: the row keeps its id, so
   * every purchase already attributed to them stays attributed, and it loses the
   * expiry, so nothing ends it but a person.
   *
   * The contact check and the owner check are the caller's, because the run
   * checks every id before it writes anything. Plan 0140 section 6 waives the
   * contact rule for the second row of this table, and the caller is where that
   * is decided: a row that is live and carries a `userId` is somebody the owner
   * already handed a link to, not a stranger whose id was guessed.
   *
   * An expiry the sweep has not reached yet reads as ended, so such a person
   * goes down the fourth row and comes back invited, which is the same answer
   * by a different path.
   */
  async invite(
    manager: EntityManager,
    args: {
      generatedListId: string;
      userId: string;
      invitedByUserId: string;
      username: string | null;
    }
  ): Promise<InviteOutcome> {
    // One `now`, from the database, because whether a row has ended is a
    // question about its expiry as much as about its `revokedAt` (plan 0140).
    const now = await this.now(manager);
    const existing = await manager.findOne(GeneratedListParticipant, {
      where: { generatedListId: args.generatedListId, userId: args.userId },
    });

    if (existing && !hasEnded(existing, now)) {
      if (existing.shareLinkId === null && existing.expiresAt === null) {
        return { participant: existing, becameLive: false };
      }
      // Joined by link, and now added on purpose. Clearing the link is what
      // keeps a later revoke with the cascade from reaching them (section 5),
      // and clearing the expiry is what keeps the clock from reaching them
      // (plan 0140, section 6). The id does not move, so nothing they already
      // bought is re-attributed.
      existing.shareLinkId = null;
      existing.expiresAt = null;
      existing.invitedAt = now;
      existing.invitedByUserId = args.invitedByUserId;
      // A name already on the row is a snapshot taken when they joined, and it
      // stays (plan 0054, section 2.4). Only a missing one is filled.
      existing.username ??= args.username;
      return { participant: await manager.save(existing), becameLive: false };
    }

    await this.checkRoom(manager, args.generatedListId);

    if (existing) {
      // Removed, revoked with the link, left, or simply out of time: the owner
      // adding them again is the one gesture that outranks every reason
      // (section 4, and plan 0140 section 6's last row).
      existing.revokedAt = null;
      existing.endedReason = null;
      existing.shareLinkId = null;
      existing.expiresAt = null;
      existing.invitedAt = now;
      existing.invitedByUserId = args.invitedByUserId;
      existing.joinedAt = now;
      existing.lastSeenAt = now;
      existing.username = args.username ?? existing.username;
      return { participant: await manager.save(existing), becameLive: true };
    }

    const created = await manager.save(
      manager.create(GeneratedListParticipant, {
        generatedListId: args.generatedListId,
        shareLinkId: null,
        kind: ParticipantKind.REGISTERED,
        userId: args.userId,
        displayName: null,
        username: args.username,
        guestNumber: null,
        sessionSecretHash: null,
        userAgent: null,
        joinedAt: now,
        lastSeenAt: now,
        revokedAt: null,
        endedReason: null,
        invitedAt: now,
        invitedByUserId: args.invitedByUserId,
        // A named person never expires (plan 0140, section 2), which
        // `ck_generated_list_participants_expiry` holds against `invitedAt`.
        expiresAt: null,
      })
    );
    return { participant: created, becameLive: true };
  }

  /** Every live `REGISTERED` row of a basket, for the deletion's announcements. */
  liveRegistered(generatedListId: string): Promise<GeneratedListParticipant[]> {
    return this.dataSource.getRepository(GeneratedListParticipant).find({
      where: {
        generatedListId,
        kind: ParticipantKind.REGISTERED,
        ...liveParticipantWhere(),
      },
    });
  }

  /** The database's clock, which is the only one that decides an expiry. */
  private async now(manager: EntityManager): Promise<Date> {
    const [row] = await manager.query<{ now: Date }[]>(
      `SELECT now() AS "now"`
    );
    return row.now;
  }

  /**
   * A row became live (section 10): the basket room hears who joined, and a
   * registered person hears on their own sessions that a basket is theirs to
   * open.
   *
   * The room hears the least privileged reader's view, because a guest is in it,
   * and the person hears ids only, because nothing about the basket may travel
   * to a room its reader is not yet in.
   */
  announceLive(
    generatedListId: string,
    participant: GeneratedListParticipant
  ): void {
    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListParticipantJoined,
      generatedListId,
      toParticipantView(participant, false)
    );
    if (participant.kind === ParticipantKind.REGISTERED && participant.userId) {
      this.announceAccess(
        RealtimeEvent.GeneratedListShared,
        generatedListId,
        participant.userId
      );
    }
  }

  /**
   * A row ended, for any reason (section 10): the basket room hears who left,
   * which also asks realtime to sweep both basket rooms, and a registered person
   * hears that the basket is no longer theirs.
   */
  announceEnded(
    generatedListId: string,
    participant: GeneratedListParticipant
  ): void {
    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListParticipantLeft,
      generatedListId,
      toParticipantView(participant, false)
    );
    if (participant.kind === ParticipantKind.REGISTERED && participant.userId) {
      this.announceUnshared(generatedListId, participant.userId);
    }
  }

  /** One person is no longer on a basket, told to their own sessions. */
  announceUnshared(generatedListId: string, userId: string): void {
    this.announceAccess(
      RealtimeEvent.GeneratedListUnshared,
      generatedListId,
      userId
    );
  }

  private announceAccess(
    event: RealtimeEvent,
    generatedListId: string,
    userId: string
  ): void {
    const payload: GeneratedListAccessEvent = { generatedListId };
    this.events.emitToUsers(event, [userId], payload);
  }
}
