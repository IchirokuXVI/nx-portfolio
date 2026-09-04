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
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
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
    private readonly events: CoreEventsPublisher,
    // `@Global()`, so every operator write here reaches the trail without any
    // caller having to hand it one (plan 0077, section 8).
    private readonly audit: CoreAuditService
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
    return this.applyApproval(target, req.userId, (membership) =>
      this.dataSource.transaction((manager) =>
        this.writeApproval(manager, membership, (row) =>
          manager.getRepository(ZoneMembership).save(row)
        )
      )
    );
  }

  /**
   * Approve a PENDING member, for an operator who is not in the zone (plan 0077,
   * section 4.4).
   *
   * The same write {@link approve} makes, the shared list grant in the same
   * transaction included. That grant is the half a status column write would
   * silently skip, and skipping it produces the failure plan 0042 exists to
   * prevent: a member approved into a household who can see nothing at all, whose
   * only cure is somebody opening each list's settings and ticking four boxes.
   *
   * `approvedByUserId` is **null**, and the column stays nullable for exactly
   * this. An operator is not a member of the zone, so there is no membership to
   * record, and every other reader treats that column as a `users.id`, so an
   * admin's id there would be a value that resolves to nothing.
   */
  async approveAsOperator(
    zoneId: string,
    membershipId: string,
    actorId: string
  ): Promise<MembershipView> {
    const target = await this.loadTarget(zoneId, membershipId);
    const before = { ...target };
    return this.applyApproval(target, null, (membership) =>
      this.audit.write(actorId, (tx) =>
        this.writeApproval(tx.manager, membership, (row) =>
          tx.update(ZoneMembership, before, row)
        )
      )
    );
  }

  /**
   * What an approval means, with the authorization already decided.
   *
   * The refusal, the two fields, the event and the recount are here rather than
   * in each caller, so an operator's approval and an owner's are one write. Only
   * `approvedByUserId` and `persist` differ between them, and both are stated by
   * the caller rather than inferred here.
   */
  private async applyApproval(
    target: ZoneMembership,
    approvedByUserId: string | null,
    persist: (membership: ZoneMembership) => Promise<ZoneMembership>
  ): Promise<MembershipView> {
    if (target.status !== MembershipStatus.PENDING) {
      throw new ValidationException('That member is not pending approval');
    }
    target.status = MembershipStatus.APPROVED;
    target.approvedByUserId = approvedByUserId;
    const saved = await persist(target);
    this.emit(RealtimeEvent.MemberApproved, saved);
    // Approving the first requester makes the next one the answer to
    // `firstPendingRequesterName`, and no other event carries that name.
    await this.counts.emitZoneCounts(saved.zoneId);
    return toMembershipView(saved);
  }

  /**
   * The membership and the grant, in whichever transaction the caller opened.
   *
   * `save` is separate from the manager because the operator's write records the
   * row it saves and a member's does not, while the grant beside it is the same
   * call either way and has to be in the same transaction as the status change.
   */
  private async writeApproval(
    manager: EntityManager,
    target: ZoneMembership,
    save: (membership: ZoneMembership) => Promise<ZoneMembership>
  ): Promise<ZoneMembership> {
    const saved = await save(target);
    await this.sharedGrant.grantZoneSharedLists(
      manager,
      saved.zoneId,
      saved.id
    );
    return saved;
  }

  /** Reject a PENDING member: removes the pending membership. */
  async reject(req: MembershipActionRequest): Promise<{ id: string }> {
    const target = await this.governable(req);
    return this.applyRejection(target, async (membership) => {
      await this.memberships.delete({ id: membership.id });
    });
  }

  /**
   * Reject a PENDING member, for an operator (plan 0077, section 4.4).
   *
   * The row goes, as it does on the member facing path: a rejection is not a
   * status, and keeping the row would leave somebody who may re-request looking
   * like somebody who was removed.
   */
  async rejectAsOperator(
    zoneId: string,
    membershipId: string,
    actorId: string
  ): Promise<{ id: string }> {
    const target = await this.loadTarget(zoneId, membershipId);
    return this.applyRejection(target, (membership) =>
      this.audit.write(actorId, (tx) => tx.delete(ZoneMembership, membership))
    );
  }

  private async applyRejection(
    target: ZoneMembership,
    remove: (membership: ZoneMembership) => Promise<void>
  ): Promise<{ id: string }> {
    if (target.status !== MembershipStatus.PENDING) {
      throw new ValidationException('That member is not pending approval');
    }
    // Read before the removal: the trail's delete strips the primary key off the
    // object it is handed, so an id read afterwards is undefined.
    const id = target.id;
    const { zoneId, userId } = target;
    await remove(target);
    this.events.emitTo(
      RealtimeEvent.MemberRejected,
      { zoneId, userIds: [userId] },
      { id, userId }
    );
    await this.counts.emitZoneCounts(zoneId);
    return { id };
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
   * Who did it is recorded since plan 0077 section 8, which the sentence this
   * replaces said was plan 0075's question. It is answered on all of the named
   * actions at once, in the transaction each write happens in.
   */
  async kickAsOperator(
    zoneId: string,
    membershipId: string,
    actorId: string
  ): Promise<MembershipView> {
    return this.applyOperatorStatus(
      zoneId,
      membershipId,
      MembershipStatus.KICKED,
      RealtimeEvent.MemberKicked,
      actorId
    );
  }

  /** Ban, for an operator. See {@link kickAsOperator}. */
  async banAsOperator(
    zoneId: string,
    membershipId: string,
    actorId: string
  ): Promise<MembershipView> {
    return this.applyOperatorStatus(
      zoneId,
      membershipId,
      MembershipStatus.BANNED,
      RealtimeEvent.MemberBanned,
      actorId
    );
  }

  private async applyOperatorStatus(
    zoneId: string,
    membershipId: string,
    status: MembershipStatus,
    event: RealtimeEvent,
    actorId: string
  ): Promise<MembershipView> {
    const target = await this.loadTarget(zoneId, membershipId);
    const before = { ...target };
    return this.applyStatus(zoneId, target, status, event, (row) =>
      this.audit.write(actorId, (tx) => tx.update(ZoneMembership, before, row))
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
      event,
      (row) => this.memberships.save(row)
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
   *
   * `persist` is the one thing the two paths differ in, the plain repository on a
   * member's and the audited transaction on an operator's, and it resolves after
   * its commit so the event below goes out either way only once the row is
   * written (plan 0077, section 8).
   */
  private async applyStatus(
    zoneId: string,
    target: ZoneMembership,
    status: MembershipStatus,
    event: RealtimeEvent,
    persist: (membership: ZoneMembership) => Promise<ZoneMembership>
  ): Promise<MembershipView> {
    if (target.role === ZoneRole.OWNER) {
      throw new ForbiddenException('The owner cannot be removed');
    }
    target.status = status;
    const saved = await persist(target);
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
    this.assertStillInZone(target);

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

    return this.applyUsernameChange(target, username, (row) =>
      this.memberships.save(row)
    );
  }

  /**
   * Rename one membership, for an operator who is not in the zone (plan 0077,
   * section 4.3).
   *
   * The same write and the same `MemberUsernameChanged` event, without the zone
   * role branch: an operator is neither the member nor one of the zone's staff,
   * so there is nobody to compare them against, and the question their gate
   * already answered is the one that replaces it.
   *
   * The refusal on a KICKED or BANNED membership stays, because it is a fact
   * about the row rather than about who asked. Those rows are the historical
   * record admins recognise people by, and a rewritten name is a way back in
   * unrecognised.
   *
   * Nothing changes globally here either. `users.username` is auth's, and
   * renaming somebody everywhere is `IdentityService.setUsernameAsOperator`.
   */
  async setUsernameAsOperator(
    zoneId: string,
    membershipId: string,
    username: string,
    actorId: string
  ): Promise<MembershipView> {
    const validated = validateUsername(username);
    const target = await this.loadTarget(zoneId, membershipId);
    this.assertStillInZone(target);
    const before = { ...target };
    return this.applyUsernameChange(target, validated, (row) =>
      this.audit.write(actorId, (tx) => tx.update(ZoneMembership, before, row))
    );
  }

  /**
   * A membership somebody may still be renamed through, or a refusal.
   *
   * Asked at the same point on both paths rather than inside
   * {@link applyUsernameChange}, so a caller who is refused for two reasons at
   * once is told the same one they were told before.
   */
  private assertStillInZone(target: ZoneMembership): void {
    if (
      target.status !== MembershipStatus.APPROVED &&
      target.status !== MembershipStatus.PENDING
    ) {
      throw new ForbiddenException('That member is no longer in this zone');
    }
  }

  private async applyUsernameChange(
    target: ZoneMembership,
    username: string,
    persist: (membership: ZoneMembership) => Promise<ZoneMembership>
  ): Promise<MembershipView> {
    target.username = username;
    const saved = await persist(target);
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
