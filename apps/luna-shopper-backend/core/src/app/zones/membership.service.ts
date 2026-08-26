import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  type MembershipActionRequest,
  type MembershipView,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { ZoneMembership } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from './zone-authz.service';
import { ZoneCountsService } from './zone-counts.service';
import { toMembershipView } from './zone.mappers';

/**
 * Membership governance (plan 0006, section 4). Every action requires the caller
 * to be an approved OWNER or ADMIN of the zone; the owner cannot be kicked or
 * banned. Each mutation emits the matching realtime event.
 */
@Injectable()
export class MembershipService {
  constructor(
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    private readonly authz: ZoneAuthzService,
    private readonly counts: ZoneCountsService,
    private readonly events: CoreEventsPublisher
  ) {}

  private async governable(
    req: MembershipActionRequest
  ): Promise<ZoneMembership> {
    await this.authz.requireRole(req.zoneId, req.userId, [
      ZoneRole.OWNER,
      ZoneRole.ADMIN,
    ]);
    const target = await this.memberships.findOne({
      where: { id: req.membershipId, zoneId: req.zoneId },
    });
    if (!target) {
      throw new NotFoundException('Membership not found in this zone');
    }
    return target;
  }

  /** Approve a PENDING member (plan 0006, section 4). */
  async approve(req: MembershipActionRequest): Promise<MembershipView> {
    const target = await this.governable(req);
    if (target.status !== MembershipStatus.PENDING) {
      throw new ValidationException('That member is not pending approval');
    }
    target.status = MembershipStatus.APPROVED;
    target.approvedByUserId = req.userId;
    const saved = await this.memberships.save(target);
    this.emit(RealtimeEvent.MemberApproved, saved);
    // Approving the first requester makes the next one the answer to
    // `firstPendingRequesterName`, and no other event carries that name.
    await this.counts.emitZoneCounts(req.zoneId);
    return toMembershipView(saved);
  }

  /** Reject a PENDING member: removes the pending membership. */
  async reject(req: MembershipActionRequest): Promise<{ id: string }> {
    const target = await this.governable(req);
    if (target.status !== MembershipStatus.PENDING) {
      throw new ValidationException('That member is not pending approval');
    }
    await this.memberships.delete({ id: target.id });
    this.events.emit(RealtimeEvent.MemberRejected, req.zoneId, {
      id: target.id,
      userId: target.userId,
    });
    await this.counts.emitZoneCounts(req.zoneId);
    return { id: target.id };
  }

  /** Kick a member: removes access, may re-request (plan 0006, section 4). */
  async kick(req: MembershipActionRequest): Promise<MembershipView> {
    return this.setStatus(
      req,
      MembershipStatus.KICKED,
      RealtimeEvent.MemberKicked
    );
  }

  /** Ban a member: removes access and blocks rejoining. */
  async ban(req: MembershipActionRequest): Promise<MembershipView> {
    return this.setStatus(
      req,
      MembershipStatus.BANNED,
      RealtimeEvent.MemberBanned
    );
  }

  private async setStatus(
    req: MembershipActionRequest,
    status: MembershipStatus,
    event: RealtimeEvent
  ): Promise<MembershipView> {
    const target = await this.governable(req);
    if (target.role === ZoneRole.OWNER) {
      throw new ForbiddenException('The owner cannot be removed');
    }
    target.status = status;
    const saved = await this.memberships.save(target);
    this.emit(event, saved);
    await this.counts.emitZoneCounts(req.zoneId);
    return toMembershipView(saved);
  }

  private emit(event: RealtimeEvent, membership: ZoneMembership): void {
    this.events.emit(event, membership.zoneId, toMembershipView(membership));
  }
}
