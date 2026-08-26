import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  type MembershipActionRequest,
  type MembershipView,
  type SetMembershipUsernameRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
  validateUsername,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { ZoneMembership } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from './zone-authz.service';
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
    return toMembershipView(saved);
  }

  /**
   * Rename one membership (plan 0018, section 5). One operation covers both the
   * member renaming themselves in a single zone and an owner or admin renaming
   * someone, because they are the same write with two authorization branches:
   *
   * - the caller may always rename their own membership, needing no role beyond
   *   being APPROVED or PENDING in the zone;
   * - an OWNER or ADMIN may rename any membership;
   * - an ADMIN may not rename the OWNER, mirroring `ZoneService.setRole`;
   * - the owner may rename anyone, themselves included;
   * - a KICKED or BANNED membership is renamed by nobody: those rows are the
   *   historical record admins recognise by name, and letting a banned user
   *   rewrite theirs is a way back in unrecognised.
   *
   * Nothing changes globally: `users.username` is untouched, and a later global
   * rename with MATCHING_ZONES will not match this zone unless the new name
   * happens to equal the old global one.
   */
  async setUsername(
    req: SetMembershipUsernameRequest
  ): Promise<MembershipView> {
    const username = validateUsername(req.username);
    const caller = await this.authz.requireMember(req.zoneId, req.userId);
    const target = await this.memberships.findOne({
      where: { id: req.membershipId, zoneId: req.zoneId },
    });
    if (!target) {
      throw new NotFoundException('Membership not found in this zone');
    }
    if (
      target.status !== MembershipStatus.APPROVED &&
      target.status !== MembershipStatus.PENDING
    ) {
      throw new ForbiddenException('That member is no longer in this zone');
    }

    const isSelf = target.id === caller.id;
    const governs =
      caller.role === ZoneRole.OWNER || caller.role === ZoneRole.ADMIN;
    if (!isSelf && !governs) {
      throw new ForbiddenException(
        'You do not have permission for this operation'
      );
    }
    if (
      !isSelf &&
      caller.role === ZoneRole.ADMIN &&
      target.role === ZoneRole.OWNER
    ) {
      throw new ForbiddenException('Cannot rename the owner');
    }

    target.username = username;
    const saved = await this.memberships.save(target);
    this.emit(RealtimeEvent.MemberUsernameChanged, saved);
    return toMembershipView(saved);
  }

  private emit(event: RealtimeEvent, membership: ZoneMembership): void {
    this.events.emit(event, membership.zoneId, toMembershipView(membership));
  }
}
