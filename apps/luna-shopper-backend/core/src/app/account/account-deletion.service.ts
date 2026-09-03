import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MembershipStatus,
  RealtimeEvent,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import { runOnce } from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { Zone, ZoneMembership } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { GeneratedListService } from '../generated-lists/generated-list.service';
import { ZoneCountsService } from '../zones/zone-counts.service';
import { toMembershipView, toZoneView } from '../zones/zone.mappers';
import { anonymizedUsername } from './anonymize';
import { ProcessedEventStore } from '../events/idempotency.store';

/**
 * Core's reaction to a user being deleted (plan 0011, section 2). Auth removes the
 * identity and emits `user.deleted`; core then, for each zone the user touched:
 * marks a zone they owned for deletion (the ownerless flow from plan 0006 section
 * 5, rescuable by an admin claim) and retires their membership, scrubbing the only
 * personal field it holds (the per-zone username) while keeping authored content
 * intact. Idempotent via the processed-events inbox and via state guards.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    @InjectRepository(Zone) private readonly zones: Repository<Zone>,
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    private readonly events: CoreEventsPublisher,
    private readonly zoneCounts: ZoneCountsService,
    private readonly store: ProcessedEventStore,
    private readonly generatedLists: GeneratedListService
  ) {}

  /** Handle `user.deleted`, at most once per user (plan 0011, section 2). */
  async handleUserDeleted(userId: string): Promise<void> {
    await runOnce(this.store, `user.deleted:${userId}`, () =>
      this.apply(userId)
    );
  }

  private async apply(userId: string): Promise<void> {
    // Their baskets go first, and outside the loop below, because a generated
    // list belongs to a person rather than to a zone: somebody who left every
    // group still has their shopping history, and the membership loop would
    // never reach it (plan 0050, section 7).
    //
    // The `LineSettlement` rows those baskets wrote are **not** deleted with
    // them. A settlement is a zone fact and the purchase is the household's
    // (plan 0047, section 3.1); only the basket it came from was ever private.
    await this.generatedLists.deleteForUser(userId);

    const memberships = await this.memberships.find({ where: { userId } });
    for (const membership of memberships) {
      const zone = await this.zones.findOne({
        where: { id: membership.zoneId },
      });
      // Ownerless fallback (plan 0006, section 5): the deleted user owned it.
      if (zone && zone.ownerUserId === userId) {
        zone.ownerUserId = null;
        zone.status = ZoneStatus.MARKED_FOR_DELETION;
        zone.markedForDeletionAt = new Date();
        await this.zones.save(zone);
        this.events.emit(
          RealtimeEvent.ZoneMarkedForDeletion,
          zone.id,
          toZoneView(zone)
        );
      }
      // Retire the membership: scrub the only personal field and drop access.
      // Content the user authored (lists/lines/comments) references an opaque
      // userId and is retained; the KICKED tombstone keeps it resolving to the
      // neutral "former member" label.
      membership.username = anonymizedUsername(membership.id);
      membership.status = MembershipStatus.KICKED;
      const saved = await this.memberships.save(membership);
      this.events.emitTo(
        RealtimeEvent.MemberKicked,
        { zoneId: membership.zoneId, userIds: [membership.userId] },
        toMembershipView(saved)
      );
      // The member count drops with no user action at all, so the zone's open
      // screens need telling (plan 0017, section 9).
      await this.zoneCounts.emitZoneCounts(membership.zoneId);
    }
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
