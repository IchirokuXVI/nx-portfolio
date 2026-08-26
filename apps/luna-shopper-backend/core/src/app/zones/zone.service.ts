import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  ZoneStatus,
  type CreateZoneRequest,
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
  type SelectQueryBuilder,
} from 'typeorm';
import { Zone, ZoneMembership } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { generateJoinCode } from './join-code';
import { ZoneAuthzService } from './zone-authz.service';
import { ZoneCountsService } from './zone-counts.service';
import {
  readZoneCounts,
  readZoneListsPreview,
  type SummaryRow,
} from './zone-summary.reader';
import { selectZoneSummary } from './zone-summary.sql';
import { toMembershipView, toMyZoneView, toZoneView } from './zone.mappers';

/** Postgres unique-violation error code, raised on a join-code clash. */
const PG_UNIQUE_VIOLATION = '23505';

interface MyZoneCursor {
  order: MyZoneOrder;
  value: string;
  id: string;
}

@Injectable()
export class ZoneService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Zone) private readonly zones: Repository<Zone>,
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    private readonly authz: ZoneAuthzService,
    private readonly counts: ZoneCountsService,
    private readonly events: CoreEventsPublisher
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
      return await this.dataSource.transaction(async (manager) => {
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
      throw new NotFoundException('No active zone for that join code');
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

  /** Edit the zone name/config (plan 0006, section 4): owner or admin. */
  async update(req: UpdateZoneRequest): Promise<ZoneView> {
    await this.authz.requireRole(req.zoneId, req.userId, [
      ZoneRole.OWNER,
      ZoneRole.ADMIN,
    ]);
    const zone = await this.zones.findOneOrFail({ where: { id: req.zoneId } });
    if (req.name !== undefined) {
      zone.name = req.name;
    }
    if (req.config !== undefined) {
      zone.config = req.config;
    }
    const view = toZoneView(await this.zones.save(zone));
    this.events.emit(RealtimeEvent.ZoneUpdated, req.zoneId, view);
    return view;
  }

  /** Delete the zone (plan 0006, section 4): owner only. */
  async delete(req: ZoneIdRequest): Promise<{ id: string }> {
    await this.authz.requireRole(req.zoneId, req.userId, [ZoneRole.OWNER]);
    await this.zones.delete({ id: req.zoneId });
    this.events.emit(RealtimeEvent.ZoneDeleted, req.zoneId, { id: req.zoneId });
    return { id: req.zoneId };
  }

  /** Regenerate the join code (plan 0006, section 4): owner or admin. */
  async regenerateJoinCode(req: ZoneIdRequest): Promise<ZoneView> {
    await this.authz.requireRole(req.zoneId, req.userId, [
      ZoneRole.OWNER,
      ZoneRole.ADMIN,
    ]);
    const zone = await this.zones.findOneOrFail({ where: { id: req.zoneId } });
    zone.joinCode = generateJoinCode();
    const view = toZoneView(await this.zones.save(zone));
    this.events.emit(RealtimeEvent.ZoneUpdated, req.zoneId, view);
    return view;
  }

  /** Promote/demote an admin (plan 0006, section 4): owner only. */
  async setRole(req: SetRoleRequest): Promise<MembershipView> {
    await this.authz.requireRole(req.zoneId, req.userId, [ZoneRole.OWNER]);
    if (req.role === ZoneRole.OWNER) {
      throw new ValidationException(
        'Use transfer ownership to assign an owner'
      );
    }
    const target = await this.loadTargetMembership(
      req.zoneId,
      req.membershipId
    );
    if (target.role === ZoneRole.OWNER) {
      throw new ForbiddenException('Cannot change the owner’s role here');
    }
    target.role = req.role;
    const saved = await this.memberships.save(target);
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

    return this.dataSource.transaction(async (manager) => {
      owner.role = ZoneRole.ADMIN;
      target.role = ZoneRole.OWNER;
      target.status = MembershipStatus.APPROVED;
      await manager.getRepository(ZoneMembership).save([owner, target]);

      const zone = await manager
        .getRepository(Zone)
        .findOneOrFail({ where: { id: req.zoneId } });
      zone.ownerUserId = target.userId;
      const view = toZoneView(await manager.getRepository(Zone).save(zone));
      this.events.emit(RealtimeEvent.ZoneOwnershipChanged, req.zoneId, view);
      return view;
    });
  }

  /**
   * Claim an ownerless zone (plan 0006, section 5): an ADMIN of a zone that lost
   * its owner (MARKED_FOR_DELETION) becomes OWNER and returns it to ACTIVE.
   */
  async claimOwnership(req: ZoneIdRequest): Promise<ZoneView> {
    const membership = await this.authz.requireRole(req.zoneId, req.userId, [
      ZoneRole.ADMIN,
    ]);
    return this.dataSource.transaction(async (manager) => {
      const zone = await manager
        .getRepository(Zone)
        .findOneOrFail({ where: { id: req.zoneId } });
      if (zone.ownerUserId) {
        throw new ConflictException('This zone already has an owner');
      }
      membership.role = ZoneRole.OWNER;
      await manager.getRepository(ZoneMembership).save(membership);
      zone.ownerUserId = req.userId;
      zone.status = ZoneStatus.ACTIVE;
      // Rescued: clear the deletion marker so the zone reaper leaves it alone.
      zone.markedForDeletionAt = null;
      const view = toZoneView(await manager.getRepository(Zone).save(zone));
      this.events.emit(RealtimeEvent.ZoneOwnershipChanged, req.zoneId, view);
      return view;
    });
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

  private emitMember(event: RealtimeEvent, membership: ZoneMembership): void {
    this.events.emit(event, membership.zoneId, toMembershipView(membership));
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
      readZoneListsPreview(row)
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
