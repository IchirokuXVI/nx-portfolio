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
import { DataSource, Repository } from 'typeorm';
import { ZoneMembership } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { SharedListGrantService } from '../lists/shared-list-grant.service';
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
    private readonly dataSource: DataSource,
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    private readonly authz: ZoneAuthzService,
    private readonly sharedGrant: SharedListGrantService,
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
    return this.loadTarget(req.zoneId, req.membershipId);
  }

  /**
   * Approve a PENDING member (plan 0006, section 4), and hand them the lists
   * their new group shares (plan 0042, section 2.3).
   *
   * The grant is here because approval is the only door: `join` always writes a
   * `PENDING` membership regardless of who is joining, so there is no second path
   * by which somebody becomes an approved member. Without it, the ordinary way a
   * household uses this product, one person sets it up, makes the lists, and then
   * invites everybody else, produced a member who could see nothing at all, and
   * the only cure was somebody opening each list's settings and ticking four
   * boxes per person.
   *
   * `ZoneService.transferOwnership` also sets a target to `APPROVED`, and needs
   * no branch of its own: that target is by definition about to be `OWNER`, and
   * staff hold every permission on every list in the zone by derivation. The
   * absence is written down here so it does not read as an oversight.
   *
   * One transaction, so a member is never approved into a zone whose shared lists
   * they were not granted.
   *
   * **No burst of events.** A member approved into a zone with nine shared lists
   * does not produce nine `list.my_access_changed` events. Their client is
   * transitioning from pending to a member and fetches the zone's lists as a
   * matter of course; the approval event below is the signal, and the list query
   * that follows returns the lists.
   */
  async approve(req: MembershipActionRequest): Promise<MembershipView> {
    const target = await this.governable(req);
    if (target.status !== MembershipStatus.PENDING) {
      throw new ValidationException('That member is not pending approval');
    }
    target.status = MembershipStatus.APPROVED;
    target.approvedByUserId = req.userId;
    const saved = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(ZoneMembership).save(target);
      await this.sharedGrant.grantZoneSharedLists(
        manager,
        saved.zoneId,
        saved.id
      );
      return saved;
    });
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
    this.events.emitTo(
      RealtimeEvent.MemberRejected,
      { zoneId: req.zoneId, userIds: [target.userId] },
      { id: target.id, userId: target.userId }
    );
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

  /**
   * Kick or ban, for an operator who is not in the zone (plan 0074, section 1).
   *
   * The **only** difference from {@link kick} and {@link ban} is that the caller
   * is not asked for a role in a zone they are not in. Everything after that is
   * `applyStatus`, the identical code path: the same refusal to remove an owner,
   * the same row, the same two events, the same recount. A named action reuses
   * the code that maintains the invariant; that is what makes it a named action
   * rather than a second implementation that agrees with the first for now.
   *
   * The operator's own id is not written anywhere by this. Who did it is plan
   * 0075's question, and answering half of it here would leave an actor recorded
   * on two of the seven actions and nowhere else.
   */
  async kickAsOperator(
    zoneId: string,
    membershipId: string
  ): Promise<MembershipView> {
    return this.applyStatus(
      zoneId,
      await this.loadTarget(zoneId, membershipId),
      MembershipStatus.KICKED,
      RealtimeEvent.MemberKicked
    );
  }

  /** Ban, for an operator. See {@link kickAsOperator}. */
  async banAsOperator(
    zoneId: string,
    membershipId: string
  ): Promise<MembershipView> {
    return this.applyStatus(
      zoneId,
      await this.loadTarget(zoneId, membershipId),
      MembershipStatus.BANNED,
      RealtimeEvent.MemberBanned
    );
  }

  private async setStatus(
    req: MembershipActionRequest,
    status: MembershipStatus,
    event: RealtimeEvent
  ): Promise<MembershipView> {
    return this.applyStatus(
      req.zoneId,
      await this.governable(req),
      status,
      event
    );
  }

  /**
   * The effect of a kick or a ban, with the authorization already decided.
   *
   * Split from {@link setStatus} so an operator's kick and a zone admin's kick
   * are the same write rather than two that look alike. The owner rule lives
   * here rather than in the caller for the same reason: it is a fact about the
   * zone, not about who asked, and an operator removing the owner would leave a
   * zone whose `ownerUserId` names somebody with no membership.
   */
  private async applyStatus(
    zoneId: string,
    target: ZoneMembership,
    status: MembershipStatus,
    event: RealtimeEvent
  ): Promise<MembershipView> {
    if (target.role === ZoneRole.OWNER) {
      throw new ForbiddenException('The owner cannot be removed');
    }
    target.status = status;
    const saved = await this.memberships.save(target);
    this.emit(event, saved);
    await this.counts.emitZoneCounts(zoneId);
    return toMembershipView(saved);
  }

  /** One membership in one zone, or a 404. The half of `governable` that reads. */
  private async loadTarget(
    zoneId: string,
    membershipId: string
  ): Promise<ZoneMembership> {
    const target = await this.memberships.findOne({
      where: { id: membershipId, zoneId },
    });
    if (!target) {
      throw new NotFoundException('Membership not found in this zone');
    }
    return target;
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

  /**
   * The zone hears it, and so does the member it is about (plan 0030, section
   * 4.1). Approval is the case that needs it: `checkZone` refuses a PENDING
   * member the zone room, so the person being approved is the one participant
   * not in the room where their own approval is announced. Kick and ban gain the
   * same guarantee against a race they win today only by timing, since the
   * realtime service invalidates its access cache before fanning out.
   */
  private emit(event: RealtimeEvent, membership: ZoneMembership): void {
    this.events.emitTo(
      event,
      { zoneId: membership.zoneId, userIds: [membership.userId] },
      toMembershipView(membership)
    );
  }
}
