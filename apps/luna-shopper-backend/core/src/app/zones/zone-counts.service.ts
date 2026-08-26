import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MembershipStatus,
  RealtimeEvent,
  type BroadcastZoneCounts,
  type ZoneCountsUpdatedPayload,
} from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import { ZoneMembership } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';

/**
 * Keeps a zone's summary live (plan 0017, section 9).
 *
 * Most of these numbers a client could derive from events it already receives:
 * `member.joined` raises the pending count, `member.approved` moves one across.
 * One value cannot be derived, which is why this event exists at all. When the
 * first requester is approved or rejected the correct new
 * `firstPendingRequesterName` is the second requester's name, and that string
 * appears in no other event's payload. Refetching the whole zone to recover one
 * string is the wrong shape, so core sends the block.
 *
 * The payload carries only what does not depend on who is asking. `listCount`
 * is access filtered per caller and the preview is an array, and a room
 * broadcast has no single asker; a client derives `listCount` from the
 * `list.created` / `list.deleted` events it receives, which it only receives for
 * lists it can see, so the derivation stays consistent with the filter.
 *
 * The governance fields are published **filled**. Splitting them is the realtime
 * service's job, because that is where room routing lives: it sends the filled
 * payload to `zone:{id}:staff` and a `null`ed copy to the plain zone room
 * (section 9). Core never decides which socket is in which room.
 */
@Injectable()
export class ZoneCountsService {
  constructor(
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    private readonly events: CoreEventsPublisher
  ) {}

  /** The zone's member and join request numbers, ungated. */
  async countsFor(zoneId: string): Promise<BroadcastZoneCounts> {
    const row = await this.memberships
      .createQueryBuilder('m')
      .select(`count(*) FILTER (WHERE m.status = :approved)::int`, 'members')
      .addSelect(`count(*) FILTER (WHERE m.status = :pending)::int`, 'pending')
      .addSelect(
        `(SELECT m2.username FROM "zone_memberships" m2
            WHERE m2."zoneId" = :zoneId AND m2.status = :pending
            ORDER BY m2."createdAt" ASC, m2.id ASC
            LIMIT 1)`,
        'firstPending'
      )
      .where('m."zoneId" = :zoneId')
      .setParameters({
        zoneId,
        approved: MembershipStatus.APPROVED,
        pending: MembershipStatus.PENDING,
      })
      .getRawOne<{
        members: number;
        pending: number;
        firstPending: string | null;
      }>();

    return {
      memberCount: row?.members ?? 0,
      pendingRequestCount: row?.pending ?? 0,
      firstPendingRequesterName: row?.firstPending ?? null,
    };
  }

  /**
   * Recompute and publish a zone's counts. Called from every mutation that moves
   * one of them: join, approve, reject, kick, ban, list create, list delete, and
   * the `user.deleted` saga, which retires memberships so the member count drops
   * with no user action at all.
   */
  async emitZoneCounts(zoneId: string): Promise<void> {
    const payload: ZoneCountsUpdatedPayload = {
      zoneId,
      counts: await this.countsFor(zoneId),
    };
    this.events.emit(RealtimeEvent.ZoneCountsUpdated, zoneId, payload);
  }
}
