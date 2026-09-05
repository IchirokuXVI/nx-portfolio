import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  ZoneStatus,
  type CreateZoneRequest,
  type GetZoneByCodeRequest,
  type JoinZoneRequest,
  type ListMyZonesRequest,
  type MembershipActionRequest,
  type MembershipView,
  type MyZoneCounts,
  type MyZoneCountsRequest,
  type MyZoneOrder,
  type MyZoneView,
  type SetRoleRequest,
  type UpdateZoneRequest,
  type ZoneByCodeView,
  type ZoneIdRequest,
  type ZonePage,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  ConflictException,
  decodeCursor,
  encodeCursor,
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  DataSource,
  QueryFailedError,
  Repository,
  type EntityManager,
  type SelectQueryBuilder,
} from 'typeorm';
import {
  CoreAuditService,
  type AuditedWrite,
} from '../audit/core-audit.service';
import { Zone, ZoneMembership } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { generateJoinCode } from './join-code';
import { ZoneAuthzService } from './zone-authz.service';
import { ZoneCountsService } from './zone-counts.service';
import { zoneDeletionAudience } from './zone-deletion-audience';
import {
  readZoneCounts,
  readZoneListsPreview,
  readZoneOwnerUsername,
  type SummaryRow,
} from './zone-summary.reader';
import { selectZoneSummary } from './zone-summary.sql';
import { toMembershipView, toMyZoneView, toZoneView } from './zone.mappers';

/** Postgres unique-violation error code, raised on a join-code clash. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * One message for every way a join code fails to resolve (plan 0024, section
 * 1.2). A code that never existed and a code whose zone was archived must be
 * indistinguishable, or the lookup becomes a way to tell "wrong code" from "code
 * that used to work".
 */
const NO_ZONE_FOR_CODE = 'No active zone for that join code';

interface MyZoneCursor {
  order: MyZoneOrder;
  value: string;
  id: string;
}

/** The two zone fields an edit may name (plan 0077, section 4.1). */
interface ZoneChanges {
  name?: string;
  config?: Record<string, unknown>;
}

/** What a write moved, and what it changed, once its transaction has run. */
interface OwnershipTransfer {
  view: ZoneView;
  outgoing: ZoneMembership | null;
  incoming: ZoneMembership;
}

/**
 * The recording half of an {@link AuditedWrite}, or nothing.
 *
 * A write whose member facing path and operator path share one body needs the
 * trail to be something that body is handed rather than something it reaches
 * for, because only one of the two paths has one: a member changing their own
 * zone is not an operator write and records nothing (plan 0077, section 8).
 */
type Trail = Pick<AuditedWrite, 'recordUpdate'> | null;

@Injectable()
export class ZoneService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Zone) private readonly zones: Repository<Zone>,
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    private readonly authz: ZoneAuthzService,
    private readonly counts: ZoneCountsService,
    private readonly events: CoreEventsPublisher,
    // Injected rather than passed in, because it is `@Global()` and every method
    // that writes on an operator's behalf needs it (plan 0077, section 8).
    private readonly audit: CoreAuditService
  ) {}

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as { driverError?: { code?: string } }).driverError?.code ===
        PG_UNIQUE_VIOLATION
    );
  }

  /**
   * Create a zone (plan 0006, section 3). The creator becomes an APPROVED OWNER
   * member in the same transaction, so "owned zones" are just the memberships
   * where role = OWNER.
   */
  async create(req: CreateZoneRequest): Promise<ZoneView> {
    try {
      const view = await this.dataSource.transaction(async (manager) => {
        const zone = await manager.getRepository(Zone).save(
          manager.getRepository(Zone).create({
            name: req.name,
            joinCode: generateJoinCode(),
            status: ZoneStatus.ACTIVE,
            ownerUserId: req.userId,
            config: {},
          })
        );
        await manager.getRepository(ZoneMembership).save(
          manager.getRepository(ZoneMembership).create({
            zoneId: zone.id,
            userId: req.userId,
            username: req.username,
            role: ZoneRole.OWNER,
            status: MembershipStatus.APPROVED,
            approvedByUserId: req.userId,
          })
        );
        return toZoneView(zone);
      });
      // Addressed to the creator and to no zone room (plan 0030, section 4.2):
      // the room of a zone one second old contains nobody, not even the tab that
      // asked for it, so routing this there would send it nowhere. Emitted after
      // the transaction commits, so a zone that failed to be created announces
      // nothing.
      this.events.emitToUsers(RealtimeEvent.ZoneCreated, [req.userId], view);
      return view;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Could not create the zone, please retry');
      }
      throw error;
    }
  }

  /**
   * Join a zone by code (plan 0006, section 3). Lands in PENDING with no access
   * until an owner/admin approves. A prior BANNED membership blocks rejoining; a
   * KICKED one may re-request. The `username` is whatever the gateway resolved:
   * the caller's own choice, or their global username when the body omitted one
   * (plan 0018, section 9). It is not unique within the zone.
   */
  async join(req: JoinZoneRequest): Promise<MembershipView> {
    const zone = await this.zones.findOne({
      where: { joinCode: req.joinCode, status: ZoneStatus.ACTIVE },
    });
    if (!zone) {
      throw new NotFoundException(NO_ZONE_FOR_CODE);
    }

    const existing = await this.authz.resolve(zone.id, req.userId);
    if (existing) {
      if (existing.status === MembershipStatus.BANNED) {
        throw new ForbiddenException('You are banned from this zone');
      }
      if (
        existing.status === MembershipStatus.APPROVED ||
        existing.status === MembershipStatus.PENDING
      ) {
        throw new ConflictException('You are already a member of this zone');
      }
      // KICKED: allow a fresh request.
      existing.status = MembershipStatus.PENDING;
      existing.username = req.username;
      const saved = await this.memberships.save(existing);
      this.emitMember(RealtimeEvent.MemberJoined, saved);
      await this.counts.emitZoneCounts(zone.id);
      return toMembershipView(saved);
    }

    const saved = await this.memberships.save(
      this.memberships.create({
        zoneId: zone.id,
        userId: req.userId,
        username: req.username,
        role: ZoneRole.MEMBER,
        status: MembershipStatus.PENDING,
      })
    );
    this.emitMember(RealtimeEvent.MemberJoined, saved);
    await this.counts.emitZoneCounts(zone.id);
    return toMembershipView(saved);
  }

  /**
   * Resolve a join code to the group behind it (plan 0024, section 1), so a join
   * sheet can say which group somebody is about to ask to join.
   *
   * Public and read only. It performs the same lookup {@link join} opens with,
   * writes nothing, and returns two fields: naming the group is what the screen
   * needs, and a scraped code should not become a stable handle for the zone. The
   * gateway throttles it with the join code bucket, since an unauthenticated
   * lookup is a cheaper enumeration oracle than joining, which at least leaves a
   * membership row an owner can see.
   */
  async getByCode(req: GetZoneByCodeRequest): Promise<ZoneByCodeView> {
    const zone = await this.zones.findOne({
      where: { joinCode: req.joinCode, status: ZoneStatus.ACTIVE },
    });
    if (!zone) {
      throw new NotFoundException(NO_ZONE_FOR_CODE);
    }
    const memberCount = await this.memberships.count({
      where: { zoneId: zone.id, status: MembershipStatus.APPROVED },
    });
    return { name: zone.name, memberCount };
  }

  /** Edit the zone name/config (plan 0006, section 4): owner or admin. */
  async update(req: UpdateZoneRequest): Promise<ZoneView> {
    await this.authz.requireRole(req.zoneId, req.userId, [
      ZoneRole.OWNER,
      ZoneRole.ADMIN,
    ]);
    const zone = await this.zones.findOneOrFail({ where: { id: req.zoneId } });
    return this.applyZoneUpdate(zone, req, (row) => this.zones.save(row));
  }

  /**
   * Edit the zone name/config for an operator who is not in the zone (plan 0077,
   * section 4.1).
   *
   * Two fields and no third, because those two are the whole of what a zone's own
   * owner may change and an operator gets exactly the same two. Each of the other
   * four columns carries something a column write does not maintain: the join
   * code is regenerated, the owner is transferred, and the two deletion columns
   * are a pair, which is {@link setDeletionMarkAsOperator}.
   *
   * The change and its audit row commit together, and the event goes out after
   * that commit. An event for a transaction that then rolls back is a lie every
   * open client acts on.
   */
  async updateAsOperator(
    zoneId: string,
    changes: ZoneChanges,
    actorId: string
  ): Promise<ZoneView> {
    const zone = await this.loadZone(zoneId);
    const before = { ...zone };
    return this.applyZoneUpdate(zone, changes, (row) =>
      this.audit.write(actorId, (tx) => tx.update(Zone, before, row))
    );
  }

  /**
   * The fields an edit assigns and the event it announces, with the
   * authorization already decided.
   *
   * One body, so an operator's edit is the same write rather than a second one
   * that agrees for now: a field added here reaches both callers, and neither can
   * come to emit something the other does not. `persist` is the only difference
   * between them, the plain repository on one side and the audited transaction on
   * the other, and it resolves after its commit so the emit below is safe on both.
   */
  private async applyZoneUpdate(
    zone: Zone,
    changes: ZoneChanges,
    persist: (zone: Zone) => Promise<Zone>
  ): Promise<ZoneView> {
    if (changes.name !== undefined) {
      zone.name = changes.name;
    }
    if (changes.config !== undefined) {
      zone.config = changes.config;
    }
    const view = toZoneView(await persist(zone));
    this.events.emit(RealtimeEvent.ZoneUpdated, zone.id, view);
    return view;
  }

  /**
   * Mark a zone for deletion, or restore it, for an operator (plan 0077, section
   * 4.2).
   *
   * One action rather than two editable fields, because `status` and
   * `markedForDeletionAt` are written together and read together everywhere else
   * in core. `AccountDeletionService` sets both when a zone loses its owner, the
   * zone reaper reads both to decide what to remove after the grace period, and
   * `claimOwnership` clears both when an admin rescues the zone. Typing either
   * one alone produces one of two broken zones: a `MARKED_FOR_DELETION` row with
   * no marker, which the reaper never removes, or an `ACTIVE` row with one, which
   * it removes anyway. Neither state is reachable through any other code path and
   * neither has a repair.
   *
   * It deletes nothing itself. What it writes is the state an ownerless zone is
   * left in, so the grace period and the reaper's own rules decide the rest, and
   * "restore" is the same rescue an admin performs by claiming the zone.
   */
  async setDeletionMarkAsOperator(
    zoneId: string,
    marked: boolean,
    actorId: string
  ): Promise<ZoneView> {
    const zone = await this.loadZone(zoneId);
    const before = { ...zone };
    zone.status = marked ? ZoneStatus.MARKED_FOR_DELETION : ZoneStatus.ACTIVE;
    zone.markedForDeletionAt = marked ? new Date() : null;
    const view = toZoneView(
      await this.audit.write(actorId, (tx) => tx.update(Zone, before, zone))
    );
    this.events.emit(RealtimeEvent.ZoneUpdated, zoneId, view);
    return view;
  }

  /** One zone, or a 404. */
  private async loadZone(zoneId: string): Promise<Zone> {
    const zone = await this.zones.findOne({ where: { id: zoneId } });
    if (!zone) {
      throw new NotFoundException('Zone not found');
    }
    return zone;
  }

  /**
   * Delete the zone (plan 0006, section 4): owner only.
   *
   * The audience is read before the row goes, because the memberships that name
   * it cascade with the zone: the zone room for the members, and the applicants
   * by name, since a PENDING membership holds no room (see
   * {@link zoneDeletionAudience}).
   */
  async delete(req: ZoneIdRequest): Promise<{ id: string }> {
    await this.authz.requireRole(req.zoneId, req.userId, [ZoneRole.OWNER]);
    const audience = await zoneDeletionAudience(this.memberships, req.zoneId);
    await this.zones.delete({ id: req.zoneId });
    this.events.emitTo(RealtimeEvent.ZoneDeleted, audience, { id: req.zoneId });
    return { id: req.zoneId };
  }

  /** Regenerate the join code (plan 0006, section 4): owner or admin. */
  async regenerateJoinCode(req: ZoneIdRequest): Promise<ZoneView> {
    await this.authz.requireRole(req.zoneId, req.userId, [
      ZoneRole.OWNER,
      ZoneRole.ADMIN,
    ]);
    const zone = await this.loadZone(req.zoneId);
    return this.applyJoinCodeRegeneration(zone, (row) => this.zones.save(row));
  }

  /**
   * Regenerate the join code for an operator who is not in the zone (plan 0074,
   * section 1).
   *
   * The whole difference is the missing role check, and the write below is the
   * one the zone's own admins reach. It matters that this is the same write: a
   * regenerated code invalidates every invitation already handed out, and a
   * second implementation that forgot `ZoneUpdated` would leave every open client
   * showing a code that no longer works.
   *
   * It records who did it since plan 0077 section 8. This is a write by an
   * operator against somebody else's data, which is the whole category the trail
   * exists for, and the table it goes in did not exist when the action did.
   */
  async regenerateJoinCodeAsOperator(
    zoneId: string,
    actorId: string
  ): Promise<ZoneView> {
    const zone = await this.loadZone(zoneId);
    const before = { ...zone };
    return this.applyJoinCodeRegeneration(zone, (row) =>
      this.audit.write(actorId, (tx) => tx.update(Zone, before, row))
    );
  }

  private async applyJoinCodeRegeneration(
    zone: Zone,
    persist: (zone: Zone) => Promise<Zone>
  ): Promise<ZoneView> {
    zone.joinCode = generateJoinCode();
    const view = toZoneView(await persist(zone));
    this.events.emit(RealtimeEvent.ZoneUpdated, zone.id, view);
    return view;
  }

  /** Promote/demote an admin (plan 0006, section 4): owner only. */
  async setRole(req: SetRoleRequest): Promise<MembershipView> {
    await this.authz.requireRole(req.zoneId, req.userId, [ZoneRole.OWNER]);
    const target = await this.loadRoleTarget(
      req.zoneId,
      req.membershipId,
      req.role
    );
    return this.applyRoleChange(target, req.role, (row) =>
      this.memberships.save(row)
    );
  }

  /**
   * Promote or demote a member, for an operator who is not in the zone (plan
   * 0077, section 4.3).
   *
   * It keeps both refusals {@link setRole} carries, because both are facts about
   * the zone rather than about who asked. Assigning `OWNER` is refused since
   * ownership is two role changes and a column in one transaction, which is
   * {@link transferOwnershipAsOperator}; demoting the current owner is refused
   * for the same reason, and doing it by column would leave a zone whose
   * `ownerUserId` names an ordinary member.
   */
  async setRoleAsOperator(
    zoneId: string,
    membershipId: string,
    role: ZoneRole,
    actorId: string
  ): Promise<MembershipView> {
    const target = await this.loadRoleTarget(zoneId, membershipId, role);
    const before = { ...target };
    return this.applyRoleChange(target, role, (row) =>
      this.audit.write(actorId, (tx) => tx.update(ZoneMembership, before, row))
    );
  }

  /**
   * The membership a role change is about, once both refusals have been made.
   *
   * Split out rather than folded into {@link applyRoleChange} so the two checks
   * stay in the order they were written in: an attempt to assign `OWNER` is
   * refused before anything is looked up, and only then does a missing membership
   * become the answer.
   */
  private async loadRoleTarget(
    zoneId: string,
    membershipId: string,
    role: ZoneRole
  ): Promise<ZoneMembership> {
    if (role === ZoneRole.OWNER) {
      throw new ValidationException(
        'Use transfer ownership to assign an owner'
      );
    }
    const target = await this.loadTargetMembership(zoneId, membershipId);
    if (target.role === ZoneRole.OWNER) {
      throw new ForbiddenException('Cannot change the owner’s role here');
    }
    return target;
  }

  private async applyRoleChange(
    target: ZoneMembership,
    role: ZoneRole,
    persist: (membership: ZoneMembership) => Promise<ZoneMembership>
  ): Promise<MembershipView> {
    target.role = role;
    const saved = await persist(target);
    this.emitMember(RealtimeEvent.MemberRoleChanged, saved);
    return toMembershipView(saved);
  }

  /** Transfer ownership to another member (plan 0006, section 4): owner only. */
  async transferOwnership(req: MembershipActionRequest): Promise<ZoneView> {
    const owner = await this.authz.requireRole(req.zoneId, req.userId, [
      ZoneRole.OWNER,
    ]);
    const target = await this.loadTargetMembership(
      req.zoneId,
      req.membershipId
    );
    return this.applyOwnershipTransfer(req.zoneId, owner, target, (work) =>
      this.dataSource.transaction((manager) => work(manager, null))
    );
  }

  /**
   * Hand a zone to one of its members, for an operator (plan 0074, section 1).
   *
   * The outgoing owner is **found** rather than supplied, because an operator is
   * not it. It may be nobody at all: a zone whose owner deleted their account is
   * ownerless by plan 0011 section 2, and rescuing exactly that zone is the case
   * this action is most useful for. So the demotion below is conditional and the
   * promotion is not.
   */
  async transferOwnershipAsOperator(
    zoneId: string,
    membershipId: string,
    actorId: string
  ): Promise<ZoneView> {
    const target = await this.loadTargetMembership(zoneId, membershipId);
    const outgoing = await this.memberships.findOne({
      where: { zoneId, role: ZoneRole.OWNER },
    });
    return this.applyOwnershipTransfer(zoneId, outgoing, target, (work) =>
      // The audit rows land in the transaction that moves the three rows, so a
      // transfer that rolls back leaves no trail claiming it happened.
      this.audit.write(actorId, (tx) => work(tx.manager, tx))
    );
  }

  /**
   * The two role changes and the zone's `ownerUserId`, in one transaction (plan
   * 0029), with the authorization already decided.
   *
   * `outgoingOwner` is null only on the operator path, over an ownerless zone.
   * Passing the caller's own membership on the user path is what keeps the two
   * from being two transactions that agree by inspection.
   *
   * `write` is where that one transaction comes from, and it is the only thing
   * the two paths differ in: a member's is opened on the data source and records
   * nothing, an operator's is opened by the audit service and records all three
   * rows (plan 0077, section 8).
   */
  private async applyOwnershipTransfer(
    zoneId: string,
    outgoingOwner: ZoneMembership | null,
    target: ZoneMembership,
    write: (
      work: (manager: EntityManager, trail: Trail) => Promise<OwnershipTransfer>
    ) => Promise<OwnershipTransfer>
  ): Promise<ZoneView> {
    // Transferring a zone to the member who already owns it would otherwise save
    // two instances of one row with opposite roles, and which of them landed
    // would depend on the order the repository wrote them in.
    if (target.role === ZoneRole.OWNER) {
      throw new ValidationException('That member already owns this zone');
    }

    const { view, outgoing, incoming } = await write(async (manager, trail) => {
      const wasOutgoing = outgoingOwner ? { ...outgoingOwner } : null;
      const wasTarget = { ...target };
      if (outgoingOwner) {
        outgoingOwner.role = ZoneRole.ADMIN;
      }
      target.role = ZoneRole.OWNER;
      target.status = MembershipStatus.APPROVED;
      const saved = await manager
        .getRepository(ZoneMembership)
        .save(outgoingOwner ? [outgoingOwner, target] : [target]);
      const incoming = saved[saved.length - 1];
      const outgoing = outgoingOwner ? saved[0] : null;

      const zone = await manager
        .getRepository(Zone)
        .findOneOrFail({ where: { id: zoneId } });
      const wasZone = { ...zone };
      zone.ownerUserId = target.userId;
      const view = toZoneView(await manager.getRepository(Zone).save(zone));

      if (outgoing && wasOutgoing) {
        await trail?.recordUpdate(ZoneMembership, wasOutgoing, outgoing);
      }
      await trail?.recordUpdate(ZoneMembership, wasTarget, incoming);
      await trail?.recordUpdate(Zone, wasZone, zone);
      return { view, outgoing, incoming };
    });

    // A role is a permission, so a role the server changes is a role the server
    // publishes (plan 0029). Two memberships change here and neither used to be
    // announced, which left the outgoing owner holding owner only controls the
    // server would then refuse. Both role events go out before the ownership
    // event, so a client applying them in order never has a frame where
    // `ownerUserId` names somebody whose role still says otherwise. Emitted
    // after the commit, like every other emit in this service: an event for a
    // transaction that then rolls back is a lie every client acts on.
    if (outgoing) {
      this.emitMember(RealtimeEvent.MemberRoleChanged, outgoing);
    }
    this.emitMember(RealtimeEvent.MemberRoleChanged, incoming);
    this.events.emit(RealtimeEvent.ZoneOwnershipChanged, zoneId, view);
    return view;
  }

  /**
   * Claim an ownerless zone (plan 0006, section 5): an ADMIN of a zone that lost
   * its owner (MARKED_FOR_DELETION) becomes OWNER and returns it to ACTIVE.
   */
  async claimOwnership(req: ZoneIdRequest): Promise<ZoneView> {
    const membership = await this.authz.requireRole(req.zoneId, req.userId, [
      ZoneRole.ADMIN,
    ]);
    const { view, claimant } = await this.dataSource.transaction(
      async (manager) => {
        const zone = await manager
          .getRepository(Zone)
          .findOneOrFail({ where: { id: req.zoneId } });
        if (zone.ownerUserId) {
          throw new ConflictException('This zone already has an owner');
        }
        membership.role = ZoneRole.OWNER;
        const claimant = await manager
          .getRepository(ZoneMembership)
          .save(membership);
        zone.ownerUserId = req.userId;
        zone.status = ZoneStatus.ACTIVE;
        // Rescued: clear the deletion marker so the zone reaper leaves it alone.
        zone.markedForDeletionAt = null;
        const view = toZoneView(await manager.getRepository(Zone).save(zone));
        return { view, claimant };
      }
    );

    // The admin who claimed the zone changed role, so that role is published as
    // well (plan 0029), ahead of the ownership event and after the commit.
    this.emitMember(RealtimeEvent.MemberRoleChanged, claimant);
    this.events.emit(RealtimeEvent.ZoneOwnershipChanged, req.zoneId, view);
    return view;
  }

  private async loadTargetMembership(
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
   * An event about a membership goes to the zone **and** to the member it is
   * about (plan 0030, section 4.1). The zone room is how everybody else learns
   * of it; the user room is how the member learns of it when they do not hold
   * that room, which a PENDING member never does and a kicked one has just
   * stopped doing.
   */
  private emitMember(event: RealtimeEvent, membership: ZoneMembership): void {
    this.events.emitTo(
      event,
      { zoneId: membership.zoneId, userIds: [membership.userId] },
      toMembershipView(membership)
    );
  }

  /**
   * List the caller's own zones (plan 0006, section 7): every zone where they
   * hold an APPROVED or PENDING membership, annotated with their role/status,
   * cursor paginated and orderable by name, joined time, or recent activity. The
   * membership's `zone` relation is loaded so no raw reconstruction is needed.
   */
  async listMine(req: ListMyZonesRequest): Promise<ZonePage> {
    const order = this.resolveOrder(req.order);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as MyZoneCursor | undefined;

    const qb = selectZoneSummary(
      this.memberships
        .createQueryBuilder('m')
        .innerJoinAndSelect('m.zone', 'z')
        .where('m."userId" = :userId', { userId: req.userId })
        .andWhere('m.status IN (:...statuses)', {
          statuses: [MembershipStatus.APPROVED, MembershipStatus.PENDING],
        })
        .take(limit + 1)
    );

    this.applyOrder(qb, order, cursor);

    // The summary arrives as raw columns beside the entities, so this reads the
    // page with `getRawAndEntities` rather than `getMany` (plan 0017, 4.4). The
    // raw rows are keyed by membership id rather than trusted to be positional.
    const { entities: memberships, raw } = await qb.getRawAndEntities();
    const summaries = this.indexSummaries(raw);
    const hasMore = memberships.length > limit;
    const page = memberships.slice(0, limit);

    const items = page.map((m) => this.toSummaryView(m, summaries.get(m.id)));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            order,
            value: this.cursorValue(order, last),
            id: last.id,
          })
        : null;

    return { items, nextCursor };
  }

  /**
   * One zone with its summary (plan 0017, section 3.6), so a detail screen does
   * not have to page through `listMine` to find its own numbers. A PENDING
   * applicant may see the zone's name and status, and the query gives them an
   * empty preview and a `listCount` of zero because they hold no membership
   * through which to have list access.
   */
  async get(req: ZoneIdRequest): Promise<MyZoneView> {
    const qb = selectZoneSummary(
      this.memberships
        .createQueryBuilder('m')
        .innerJoinAndSelect('m.zone', 'z')
        .where('m."userId" = :userId', { userId: req.userId })
        .andWhere('m."zoneId" = :zoneId', { zoneId: req.zoneId })
        .andWhere('m.status IN (:...statuses)', {
          statuses: [MembershipStatus.APPROVED, MembershipStatus.PENDING],
        })
    );

    const { entities, raw } = await qb.getRawAndEntities();
    const membership = entities[0];
    if (!membership) {
      // Deliberately not "forbidden": a caller with no membership must not be
      // able to tell an existing zone from a missing one.
      throw new NotFoundException('Zone not found');
    }
    return this.toSummaryView(
      membership,
      this.indexSummaries(raw).get(membership.id)
    );
  }

  /**
   * How many zones the caller owns, joined, and is waiting on (plan 0017,
   * section 3.5). `total` excludes `pending` on purpose: a zone the caller has
   * merely asked to join is not one of their zones, so a header never claims a
   * zone they cannot open.
   */
  async countsMine(req: MyZoneCountsRequest): Promise<MyZoneCounts> {
    const row = await this.memberships
      .createQueryBuilder('m')
      .select(
        `count(*) FILTER (WHERE m.status = :approved AND m.role = :owner)::int`,
        'owned'
      )
      .addSelect(
        `count(*) FILTER (WHERE m.status = :approved AND m.role <> :owner)::int`,
        'joined'
      )
      .addSelect(`count(*) FILTER (WHERE m.status = :pending)::int`, 'pending')
      .where('m."userId" = :userId', { userId: req.userId })
      .setParameters({
        approved: MembershipStatus.APPROVED,
        pending: MembershipStatus.PENDING,
        owner: ZoneRole.OWNER,
      })
      .getRawOne<{ owned: number; joined: number; pending: number }>();

    const owned = row?.owned ?? 0;
    const joined = row?.joined ?? 0;
    return { owned, joined, pending: row?.pending ?? 0, total: owned + joined };
  }

  /** Keys the raw summary rows by membership id (`m_id` in the raw result). */
  private indexSummaries(raw: unknown[]): Map<string, SummaryRow> {
    const byId = new Map<string, SummaryRow>();
    for (const row of raw as Record<string, unknown>[]) {
      const id = row['m_id'];
      if (typeof id === 'string') {
        byId.set(id, row);
      }
    }
    return byId;
  }

  private toSummaryView(
    membership: ZoneMembership,
    row: SummaryRow
  ): MyZoneView {
    return toMyZoneView(
      membership.zone,
      membership,
      readZoneCounts(row),
      readZoneListsPreview(row),
      readZoneOwnerUsername(row)
    );
  }

  private resolveOrder(order?: string): MyZoneOrder {
    return order === 'name' || order === 'joined' ? order : 'recent';
  }

  private applyOrder(
    qb: SelectQueryBuilder<ZoneMembership>,
    order: MyZoneOrder,
    cursor?: MyZoneCursor
  ): void {
    // Each order pairs a stable sort column with the membership id as a
    // tiebreaker; the cursor carries both so paging stays consistent.
    if (order === 'name') {
      qb.orderBy('z.name', 'ASC').addOrderBy('m.id', 'ASC');
      if (cursor) {
        qb.andWhere('(z.name, m.id) > (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else if (order === 'joined') {
      qb.orderBy('m.createdAt', 'DESC').addOrderBy('m.id', 'DESC');
      if (cursor) {
        qb.andWhere('(m."createdAt", m.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else {
      qb.orderBy('z.updatedAt', 'DESC').addOrderBy('m.id', 'DESC');
      if (cursor) {
        qb.andWhere('(z."updatedAt", m.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    }
  }

  private cursorValue(order: MyZoneOrder, membership: ZoneMembership): string {
    if (order === 'name') {
      return membership.zone.name;
    }
    if (order === 'joined') {
      return membership.createdAt.toISOString();
    }
    return membership.zone.updatedAt.toISOString();
  }
}
