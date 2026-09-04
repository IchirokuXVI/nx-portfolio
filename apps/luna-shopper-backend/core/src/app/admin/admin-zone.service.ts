import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MembershipStatus,
  type AdminMembershipActionRequest,
  type AdminMembershipActionResult,
  type AdminZoneDetailView,
  type AdminZoneIdRequest,
  type AdminZoneListView,
  type AdminZoneMemberView,
  type AdminZonePage,
  type AdminZoneView,
  type GetAdminZoneRequest,
  type ListAdminZonesRequest,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
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
 * Zones, for the back office (plan 0074).
 *
 * **Every read here is unscoped and every one of them is gated.** That pair is
 * the whole design: `ZoneAuthzService` answers "is this caller in this zone",
 * which for an operator is always no and always beside the point, so these reads
 * do not ask it and {@link CorePlatformAdminService} answers a different question
 * first instead.
 *
 * The five named actions delegate, and none of them writes a row. Each one calls
 * the service that owns the invariant: `MembershipService` for a kick or a ban,
 * `ZoneService` for the join code and for ownership, `ZoneReaperService` for a
 * deletion. Section 9 puts a generic row editor over core permanently out of
 * scope, and the reason is visible in what those services do that a row write
 * does not: emit the events other clients have already applied.
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
    await this.gate.requireAdmin(req);
    await this.requireZone(req.zoneId);
    return this.reaper.deleteZone(req.zoneId);
  }

  /** Regenerate the join code, through `ZoneService` (plan 0074, section 1). */
  async regenerateJoinCode(req: AdminZoneIdRequest): Promise<ZoneView> {
    await this.gate.requireAdmin(req);
    return this.zoneService.regenerateJoinCodeAsOperator(req.zoneId);
  }

  /**
   * Hand a zone to one of its members, through `ZoneService` (plan 0074,
   * section 1), which plan 0029 defines as two role changes and the zone's owner
   * in one transaction.
   */
  async transferOwnership(
    req: AdminMembershipActionRequest
  ): Promise<ZoneView> {
    await this.gate.requireAdmin(req);
    await this.requireZone(req.zoneId);
    return this.zoneService.transferOwnershipAsOperator(
      req.zoneId,
      req.membershipId
    );
  }

  /** Kick a member, through `MembershipService` (plan 0074, section 1). */
  async kick(
    req: AdminMembershipActionRequest
  ): Promise<AdminMembershipActionResult> {
    await this.gate.requireAdmin(req);
    await this.requireZone(req.zoneId);
    return this.membershipService.kickAsOperator(req.zoneId, req.membershipId);
  }

  /** Ban a member, through `MembershipService` (plan 0074, section 1). */
  async ban(
    req: AdminMembershipActionRequest
  ): Promise<AdminMembershipActionResult> {
    await this.gate.requireAdmin(req);
    await this.requireZone(req.zoneId);
    return this.membershipService.banAsOperator(req.zoneId, req.membershipId);
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
