import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MembershipStatus,
  type AdminMembershipActionRequest,
  type AdminMembershipActionResult,
  type AdminMembershipPage,
  type AdminZoneDetailView,
  type AdminZoneIdRequest,
  type AdminZoneListView,
  type AdminZoneMemberView,
  type AdminZonePage,
  type AdminZoneView,
  type GetAdminMembershipRequest,
  type GetAdminZoneRequest,
  type ListAdminMembershipsRequest,
  type ListAdminZonesRequest,
  type MembershipView,
  type SetAdminZoneDeletionMarkRequest,
  type UpdateAdminMembershipRequest,
  type UpdateAdminZoneRequest,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { ZoneReaperService } from '../account/zone-reaper.service';
import { ShoppingList, Zone, ZoneMembership } from '../entities';
import { MembershipService } from '../zones/membership.service';
import { ZoneService } from '../zones/zone.service';
import { CorePlatformAdminService } from './platform-admin.service';

/** Where a page of zones left off: newest first, ties broken by id. */
interface ZoneCursor {
  value: string;
  id: string;
}

/**
 * Where a page of memberships left off: **oldest** first, ties broken by id.
 *
 * The opposite direction from a zone page, and deliberately: the zone detail read
 * already lists its membership oldest first, so paging it the other way would put
 * one membership in two places depending on which screen fetched it.
 */
interface MembershipCursor {
  value: string;
  id: string;
}

/**
 * Zones, for the back office (plan 0074).
 *
 * **Every read here is unscoped and every one of them is gated.** That pair is
 * the whole design: `ZoneAuthzService` answers "is this caller in this zone",
 * which for an operator is always no and always beside the point, so these reads
 * do not ask it and {@link CorePlatformAdminService} answers a different question
 * first instead.
 *
 * **Every write delegates, and none of them writes a row.** Each one calls the
 * service that owns the invariant: `MembershipService` for the four membership
 * status verbs and the per zone name, `ZoneService` for the name, the config, the
 * deletion mark, the role, the join code and ownership, `ZoneReaperService` for a
 * deletion. What those services do that a row write does not is emit the events
 * other clients have already applied.
 *
 * Plan 0074 read that same fact as a reason to offer no editing at all. Plan 0077
 * reverses the conclusion and keeps the reason: what was ruled out was the
 * **generic row editor**, and an update that calls `ZoneService.update` is not
 * one. So a field with no service behind it is still not editable, and section 6
 * of that plan lists every one of them with the reason.
 *
 * The actor threaded into each write is the id `requireAdmin` returns from the
 * verified token, not a value the caller supplied. Nothing here can record an
 * actor the gate did not verify (plan 0077, section 8).
 */
@Injectable()
export class AdminZoneService {
  constructor(
    @InjectRepository(Zone) private readonly zones: Repository<Zone>,
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    @InjectRepository(ShoppingList)
    private readonly lists: Repository<ShoppingList>,
    private readonly gate: CorePlatformAdminService,
    private readonly zoneService: ZoneService,
    private readonly membershipService: MembershipService,
    private readonly reaper: ZoneReaperService
  ) {}

  /**
   * A page of zones, newest first, optionally filtered to one user (plan 0074,
   * section 2).
   *
   * **The id is not validated and cannot be**: users live in auth's database and
   * zones live in this one, so `targetUserId` is an opaque value core filters on
   * and never resolves (section 3). An id belonging to nobody returns an empty
   * page rather than a 404, which is the honest answer: core does not know
   * whether that person exists.
   *
   * A **member** counts, not only an owner, and of any status. Somebody asking
   * which zones a person is in wants the household they joined as well as the one
   * they made, and they want a banned membership to show up too, since "why can
   * this person not see their zone" is one of the questions this screen exists to
   * answer.
   */
  async list(req: ListAdminZonesRequest): Promise<AdminZonePage> {
    await this.gate.requireAdmin(req);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ZoneCursor | undefined;
    const qb = this.zones
      .createQueryBuilder('z')
      .orderBy('z."createdAt"', 'DESC')
      .addOrderBy('z.id', 'DESC')
      .take(limit + 1);

    if (req.targetUserId) {
      qb.andWhere(
        `(z."ownerUserId" = :uid OR EXISTS (
            SELECT 1 FROM zone_memberships m
            WHERE m."zoneId" = z.id AND m."userId" = :uid))`,
        { uid: req.targetUserId }
      );
    }
    if (req.ownerUserId) {
      qb.andWhere('z."ownerUserId" = :owner', { owner: req.ownerUserId });
    }
    if (req.withoutOwner) {
      // Admin plan 0012, section 3: what an owner's deletion leaves behind.
      // Applied beside the owner filter rather than instead of it, so asking
      // for both answers with nothing, which is what the two clauses together
      // mean.
      qb.andWhere('z."ownerUserId" IS NULL');
    }
    if (req.createdAfter) {
      qb.andWhere('z."createdAt" >= :after', { after: req.createdAfter });
    }
    if (req.createdBefore) {
      qb.andWhere('z."createdAt" < :before', { before: req.createdBefore });
    }
    if (cursor) {
      qb.andWhere('(z."createdAt", z.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    // Two grouped queries over the page's ids rather than two per row: a listing
    // of twenty zones costs three queries however many rows it has, and the
    // obvious per row version is the read that would eventually need fixing.
    const ids = page.map((zone) => zone.id);
    const [members, lists] = await Promise.all([
      this.countApprovedMembers(ids),
      this.countLists(ids),
    ]);

    return {
      items: page.map((zone) =>
        toZoneRow(zone, members.get(zone.id) ?? 0, lists.get(zone.id) ?? 0)
      ),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * One zone, with its membership and the names of its lists (plan 0074,
   * section 4).
   *
   * **Names and counts, never contents.** A list's lines are the household's
   * shopping and reading them is a deliberate click on the list itself, which is
   * `adminList.get`. Browsing zones must not be a way to end up having read one
   * by accident, which is the redaction by omission of section 4: the lines are
   * not fetched here, rather than fetched and left unrendered.
   *
   * Every membership is listed, kicked and banned rows included. Those rows are
   * the historical record an operator is usually looking at this screen to
   * understand.
   */
  async get(req: GetAdminZoneRequest): Promise<AdminZoneDetailView> {
    await this.gate.requireAdmin(req);

    const zone = await this.zones.findOne({ where: { id: req.zoneId } });
    if (!zone) {
      throw new NotFoundException('Zone not found');
    }

    const members = await this.memberships.find({
      where: { zoneId: zone.id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const lists = await this.lists
      .createQueryBuilder('l')
      .select('l.id', 'id')
      .addSelect('l.name', 'name')
      .addSelect(
        '(SELECT COUNT(*) FROM list_lines n WHERE n."listId" = l.id)',
        'lineCount'
      )
      .where('l."zoneId" = :zoneId', { zoneId: zone.id })
      .orderBy('l."updatedAt"', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .getRawMany<{ id: string; name: string; lineCount: string }>();

    const approved = members.filter(
      (member) => member.status === MembershipStatus.APPROVED
    ).length;

    return {
      ...toZoneRow(zone, approved, lists.length),
      joinCode: zone.joinCode,
      config: zone.config ?? {},
      members: members.map(toMemberView),
      lists: lists.map(toZoneListView),
    };
  }

  /**
   * Delete a zone, through the reaper (plan 0074, section 1).
   *
   * `ZoneReaperService.deleteZone` is where what deleting a zone means lives, so
   * an operator delete and a reaped abandoned zone leave every client in the same
   * state. The row is read first only so a delete of nothing is a 404 rather than
   * a cheerful success: the underlying write is idempotent, and an operator who
   * typed the wrong id should be told.
   */
  async remove(req: AdminZoneIdRequest): Promise<{ id: string }> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireZone(req.zoneId);
    return this.reaper.deleteZoneAsOperator(req.zoneId, actorId);
  }

  /** Regenerate the join code, through `ZoneService` (plan 0074, section 1). */
  async regenerateJoinCode(req: AdminZoneIdRequest): Promise<ZoneView> {
    const actorId = await this.gate.requireAdmin(req);
    return this.zoneService.regenerateJoinCodeAsOperator(req.zoneId, actorId);
  }

  /**
   * Change a zone's name or its config, through `ZoneService` (plan 0077,
   * section 4.1).
   *
   * Those two columns are the whole of what a zone's own owner may change, and an
   * operator gets exactly the same two. The other four are not fields, and each
   * is excluded for a reason rather than an oversight: `joinCode` is unique and
   * random on purpose, so regenerating it is the action that exists;
   * `ownerUserId` is two role changes and a column in one transaction, so
   * transfer is the action; and `status` and `markedForDeletionAt` are one state
   * machine, which is {@link setDeletionMark}.
   */
  async update(req: UpdateAdminZoneRequest): Promise<ZoneView> {
    const actorId = await this.gate.requireAdmin(req);
    return this.zoneService.updateAsOperator(
      req.zoneId,
      { name: req.name, config: req.config },
      actorId
    );
  }

  /**
   * Mark a zone for deletion, or restore it (plan 0077, section 4.2).
   *
   * One action rather than two fields, because `status` and `markedForDeletionAt`
   * are written together and read together everywhere else: `AccountDeletionService`
   * sets both when a zone loses its owner, the reaper reads both to decide what to
   * remove after the grace period, and `claimOwnership` clears both when an admin
   * rescues the zone. Typing either alone produces a zone the reaper never removes
   * or one it removes anyway, and neither state has a repair.
   */
  async setDeletionMark(
    req: SetAdminZoneDeletionMarkRequest
  ): Promise<ZoneView> {
    const actorId = await this.gate.requireAdmin(req);
    return this.zoneService.setDeletionMarkAsOperator(
      req.zoneId,
      req.marked,
      actorId
    );
  }

  /**
   * A page of one zone's memberships (plan 0077, section 9).
   *
   * The zone detail read keeps its embedded `members` array, unchanged: the zone
   * screen renders its membership without a second call. This collection exists
   * for the screens that edit one membership, which address a row directly rather
   * than through its parent.
   *
   * Ordered oldest first, which is the order the detail read already uses, so a
   * membership does not move between the two views of it.
   */
  async listMemberships(
    req: ListAdminMembershipsRequest
  ): Promise<AdminMembershipPage> {
    await this.gate.requireAdmin(req);
    await this.requireZone(req.zoneId);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as MembershipCursor | undefined;
    const qb = this.memberships
      .createQueryBuilder('m')
      .where('m."zoneId" = :zoneId', { zoneId: req.zoneId })
      .orderBy('m."createdAt"', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .take(limit + 1);
    if (cursor) {
      qb.andWhere('(m."createdAt", m.id) > (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
      items: page.map(toMemberView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** One membership, read through its own address (plan 0077, section 9). */
  async getMembership(
    req: GetAdminMembershipRequest
  ): Promise<AdminZoneMemberView> {
    await this.gate.requireAdmin(req);
    return toMemberView(
      await this.requireMembership(req.zoneId, req.membershipId)
    );
  }

  /**
   * A membership's role and its per zone name (plan 0077, section 4.3).
   *
   * Two writes rather than one, because they are two services: the role goes
   * through `ZoneService.setRoleAsOperator`, which keeps `setRole`'s refusals,
   * and the name through `MembershipService.setUsernameAsOperator`. A request
   * carrying both applies both and answers with the row after the second.
   *
   * `status` is not a field here, and section 4.4 is why: it moves along a state
   * machine with a service method per edge, and each edge does more than write
   * the enum. A `PATCH` carrying it would dispatch to four methods by inspecting
   * the value, which is a switch statement whose branches drift.
   */
  async updateMembership(
    req: UpdateAdminMembershipRequest
  ): Promise<MembershipView> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireMembership(req.zoneId, req.membershipId);

    if (req.role === undefined && req.username === undefined) {
      throw new ValidationException('Name a field to change');
    }

    let view: MembershipView | undefined;
    if (req.role !== undefined) {
      view = await this.zoneService.setRoleAsOperator(
        req.zoneId,
        req.membershipId,
        req.role,
        actorId
      );
    }
    if (req.username !== undefined) {
      view = await this.membershipService.setUsernameAsOperator(
        req.zoneId,
        req.membershipId,
        req.username,
        actorId
      );
    }
    // One of the two branches ran, because the refusal above is the only way
    // neither does.
    return view as MembershipView;
  }

  /**
   * Approve a pending member, through `MembershipService` (plan 0077, section
   * 4.4).
   *
   * The same write the zone's own owner makes, which is more than the enum: it
   * hands the new member the lists their group shares, in the same transaction,
   * and emits `MemberApproved`. `approvedByUserId` is null on this path, because
   * an operator holds no membership in the zone to record there.
   */
  async approve(
    req: AdminMembershipActionRequest
  ): Promise<AdminMembershipActionResult> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireZone(req.zoneId);
    return this.membershipService.approveAsOperator(
      req.zoneId,
      req.membershipId,
      actorId
    );
  }

  /** Reject a pending member, which removes the row (plan 0077, section 4.4). */
  async reject(req: AdminMembershipActionRequest): Promise<{ id: string }> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireZone(req.zoneId);
    return this.membershipService.rejectAsOperator(
      req.zoneId,
      req.membershipId,
      actorId
    );
  }

  /**
   * Hand a zone to one of its members, through `ZoneService` (plan 0074,
   * section 1), which plan 0029 defines as two role changes and the zone's owner
   * in one transaction.
   */
  async transferOwnership(
    req: AdminMembershipActionRequest
  ): Promise<ZoneView> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireZone(req.zoneId);
    return this.zoneService.transferOwnershipAsOperator(
      req.zoneId,
      req.membershipId,
      actorId
    );
  }

  /** Kick a member, through `MembershipService` (plan 0074, section 1). */
  async kick(
    req: AdminMembershipActionRequest
  ): Promise<AdminMembershipActionResult> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireZone(req.zoneId);
    return this.membershipService.kickAsOperator(
      req.zoneId,
      req.membershipId,
      actorId
    );
  }

  /** Ban a member, through `MembershipService` (plan 0074, section 1). */
  async ban(
    req: AdminMembershipActionRequest
  ): Promise<AdminMembershipActionResult> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireZone(req.zoneId);
    return this.membershipService.banAsOperator(
      req.zoneId,
      req.membershipId,
      actorId
    );
  }

  /**
   * A zone that exists, or a 404.
   *
   * The user facing routes get this for free from `requireApproved`, which
   * answers "zone not found" for a caller with no membership and therefore also
   * for a zone with no rows. The operator paths skip that check by design, so the
   * 404 has to be asked for explicitly or an action on a mistyped id would report
   * whatever the membership lookup happened to say.
   */
  private async requireZone(zoneId: string): Promise<Zone> {
    const zone = await this.zones.findOne({ where: { id: zoneId } });
    if (!zone) {
      throw new NotFoundException('Zone not found');
    }
    return zone;
  }

  /**
   * One membership in one zone, or a 404, for the same reason {@link requireZone}
   * exists.
   *
   * Scoped to the zone rather than looked up by id alone, so a membership id from
   * another zone is not found here. An operator reaches a membership through the
   * zone it is in, and a route that answered for any id would let a mistyped zone
   * silently address somebody else's household.
   */
  private async requireMembership(
    zoneId: string,
    membershipId: string
  ): Promise<ZoneMembership> {
    const membership = await this.memberships.findOne({
      where: { id: membershipId, zoneId },
    });
    if (!membership) {
      throw new NotFoundException('Membership not found in this zone');
    }
    return membership;
  }

  private async countApprovedMembers(
    zoneIds: string[]
  ): Promise<Map<string, number>> {
    if (!zoneIds.length) {
      return new Map();
    }
    const rows = await this.memberships
      .createQueryBuilder('m')
      .select('m."zoneId"', 'zoneId')
      .addSelect('COUNT(*)', 'count')
      .where('m."zoneId" IN (:...ids)', { ids: zoneIds })
      .andWhere('m.status = :status', { status: MembershipStatus.APPROVED })
      .groupBy('m."zoneId"')
      .getRawMany<{ zoneId: string; count: string }>();
    return new Map(rows.map((row) => [row.zoneId, Number(row.count)]));
  }

  private async countLists(zoneIds: string[]): Promise<Map<string, number>> {
    if (!zoneIds.length) {
      return new Map();
    }
    const rows = await this.lists
      .createQueryBuilder('l')
      .select('l."zoneId"', 'zoneId')
      .addSelect('COUNT(*)', 'count')
      .where('l."zoneId" IN (:...ids)', { ids: zoneIds })
      .groupBy('l."zoneId"')
      .getRawMany<{ zoneId: string; count: string }>();
    return new Map(rows.map((row) => [row.zoneId, Number(row.count)]));
  }
}

function toZoneRow(
  zone: Zone,
  memberCount: number,
  listCount: number
): AdminZoneView {
  return {
    id: zone.id,
    name: zone.name,
    status: zone.status,
    ownerUserId: zone.ownerUserId,
    memberCount,
    listCount,
    markedForDeletionAt: zone.markedForDeletionAt?.toISOString() ?? null,
    createdAt: zone.createdAt.toISOString(),
    updatedAt: zone.updatedAt.toISOString(),
  };
}

function toMemberView(membership: ZoneMembership): AdminZoneMemberView {
  return {
    membershipId: membership.id,
    userId: membership.userId,
    username: membership.username,
    role: membership.role,
    status: membership.status,
    createdAt: membership.createdAt.toISOString(),
  };
}

function toZoneListView(row: {
  id: string;
  name: string;
  lineCount: string;
}): AdminZoneListView {
  return { id: row.id, name: row.name, lineCount: Number(row.lineCount) };
}
