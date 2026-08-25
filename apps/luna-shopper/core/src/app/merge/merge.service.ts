import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MembershipStatus,
  MergeRequestStatus,
  RealtimeEvent,
  ZoneRole,
  type ListMergeRequestsRequest,
  type MergeIdRequest,
  type MergeRequestPage,
  type MergeRequestView,
  type RequestMergeRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, Repository } from 'typeorm';
import {
  LineComment,
  ListAccess,
  ListLine,
  MergeRequest,
  ShoppingList,
  ZoneMembership,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { toMembershipView } from '../zones/zone.mappers';
import { toMergeRequestView } from './merge.mappers';

interface MergeCursor {
  value: string;
  id: string;
}

/**
 * Per zone account merge (plan 0008). A member requests that another account's
 * zone data be reassigned to a target account; the zone owner approves. Approval
 * runs as one local transaction: it moves every zone scoped reference from the
 * source to the target, kicks the source membership, and resolves the request.
 * Because all of this lives in core's own database and is scoped to a single
 * zone, no distributed coordination is needed (section 3).
 */
@Injectable()
export class MergeService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MergeRequest)
    private readonly merges: Repository<MergeRequest>,
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    private readonly authz: ZoneAuthzService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Request a merge (plan 0008, section 3): any approved member, naming the
   * source (data taken from) and target (data moved into). Both must have a
   * membership in the zone; the request lands PENDING until the owner resolves it.
   */
  async request(req: RequestMergeRequest): Promise<MergeRequestView> {
    await this.authz.requireApproved(req.zoneId, req.userId);
    if (req.sourceUserId === req.targetUserId) {
      throw new ValidationException('Source and target must be different');
    }
    await this.requireMembership(req.zoneId, req.sourceUserId, 'source');
    await this.requireMembership(req.zoneId, req.targetUserId, 'target');

    const saved = await this.merges.save(
      this.merges.create({
        zoneId: req.zoneId,
        sourceUserId: req.sourceUserId,
        targetUserId: req.targetUserId,
        requestedByUserId: req.userId,
        status: MergeRequestStatus.PENDING,
        resolvedByUserId: null,
      })
    );

    const view = toMergeRequestView(saved);
    this.events.emit(RealtimeEvent.MergeRequested, req.zoneId, view);
    return view;
  }

  /**
   * Approve a merge (plan 0008, section 3): owner only. In one transaction,
   * reassigns the source member's zone scoped data to the target, sets the source
   * membership to KICKED, and marks the request APPROVED.
   */
  async approve(req: MergeIdRequest): Promise<MergeRequestView> {
    const merge = await this.loadPending(req.mergeId);
    await this.authz.requireRole(merge.zoneId, req.userId, [ZoneRole.OWNER]);

    const source = await this.requireMembership(
      merge.zoneId,
      merge.sourceUserId,
      'source'
    );
    const target = await this.requireMembership(
      merge.zoneId,
      merge.targetUserId,
      'target'
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      const zoneId = merge.zoneId;
      const src = merge.sourceUserId;
      const tgt = merge.targetUserId;

      // Lists created by the source in this zone become the target's.
      await manager
        .createQueryBuilder()
        .update(ShoppingList)
        .set({ createdByUserId: tgt })
        .where('"zoneId" = :zoneId', { zoneId })
        .andWhere('"createdByUserId" = :src', { src })
        .execute();

      // List access: drop source grants for lists the target can already reach
      // (dedupe against the unique (listId, membershipId)), then move the rest.
      await manager
        .createQueryBuilder()
        .delete()
        .from(ListAccess)
        .where('"membershipId" = :src', { src: source.id })
        .andWhere(
          '"listId" IN (SELECT "listId" FROM "list_access" WHERE "membershipId" = :tgt)',
          { tgt: target.id }
        )
        .execute();
      await manager
        .createQueryBuilder()
        .update(ListAccess)
        .set({ membershipId: target.id })
        .where('"membershipId" = :src', { src: source.id })
        .execute();

      // Lines the source authored or approved, scoped to this zone's lists.
      const inZoneLines =
        '"listId" IN (SELECT "id" FROM "shopping_lists" WHERE "zoneId" = :zoneId)';
      await manager
        .createQueryBuilder()
        .update(ListLine)
        .set({ createdByUserId: tgt })
        .where('"createdByUserId" = :src', { src })
        .andWhere(inZoneLines, { zoneId })
        .execute();
      await manager
        .createQueryBuilder()
        .update(ListLine)
        .set({ approvedByUserId: tgt })
        .where('"approvedByUserId" = :src', { src })
        .andWhere(inZoneLines, { zoneId })
        .execute();

      // Comments the source authored, scoped to this zone's lines.
      await manager
        .createQueryBuilder()
        .update(LineComment)
        .set({ authorUserId: tgt })
        .where('"authorUserId" = :src', { src })
        .andWhere(
          `"lineId" IN (
             SELECT ll."id" FROM "list_lines" ll
             JOIN "shopping_lists" sl ON sl."id" = ll."listId"
             WHERE sl."zoneId" = :zoneId)`,
          { zoneId }
        )
        .execute();

      // Kick the source from the zone (its account is left intact).
      source.status = MembershipStatus.KICKED;
      await manager.getRepository(ZoneMembership).save(source);

      merge.status = MergeRequestStatus.APPROVED;
      merge.resolvedByUserId = req.userId;
      return manager.getRepository(MergeRequest).save(merge);
    });

    const view = toMergeRequestView(saved);
    // Approval implies the source was removed from the zone (section 5).
    this.events.emit(RealtimeEvent.MergeApproved, merge.zoneId, view);
    this.events.emit(
      RealtimeEvent.MemberKicked,
      merge.zoneId,
      toMembershipView(source)
    );
    return view;
  }

  /** Reject a merge (plan 0008, section 3): owner only. No data changes. */
  async reject(req: MergeIdRequest): Promise<MergeRequestView> {
    const merge = await this.loadPending(req.mergeId);
    await this.authz.requireRole(merge.zoneId, req.userId, [ZoneRole.OWNER]);
    merge.status = MergeRequestStatus.REJECTED;
    merge.resolvedByUserId = req.userId;
    const view = toMergeRequestView(await this.merges.save(merge));
    this.events.emit(RealtimeEvent.MergeRejected, merge.zoneId, view);
    return view;
  }

  /**
   * Cancel a merge (plan 0008, section 3): the requester withdraws their own
   * pending request. No data changes and no realtime event.
   */
  async cancel(req: MergeIdRequest): Promise<MergeRequestView> {
    const merge = await this.loadPending(req.mergeId);
    // Confirm the caller is still a member of the zone before acting.
    await this.authz.requireApproved(merge.zoneId, req.userId);
    if (merge.requestedByUserId !== req.userId) {
      throw new ForbiddenException('Only the requester can cancel this merge');
    }
    merge.status = MergeRequestStatus.CANCELLED;
    merge.resolvedByUserId = req.userId;
    return toMergeRequestView(await this.merges.save(merge));
  }

  /**
   * List a zone's pending merge requests (owner or admin), newest first, cursor
   * paginated. The governance view an owner uses to find requests to resolve.
   */
  async list(req: ListMergeRequestsRequest): Promise<MergeRequestPage> {
    await this.authz.requireRole(req.zoneId, req.userId, [
      ZoneRole.OWNER,
      ZoneRole.ADMIN,
    ]);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as MergeCursor | undefined;

    const qb = this.merges
      .createQueryBuilder('m')
      .where('m."zoneId" = :zoneId', { zoneId: req.zoneId })
      .andWhere('m.status = :status', { status: MergeRequestStatus.PENDING })
      .orderBy('m.createdAt', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(limit + 1);
    if (cursor) {
      qb.andWhere('(m."createdAt", m.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = page.map(toMergeRequestView);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items, nextCursor };
  }

  /** Load a merge request that is still PENDING, or fail. */
  private async loadPending(mergeId: string): Promise<MergeRequest> {
    const merge = await this.merges.findOne({ where: { id: mergeId } });
    if (!merge) {
      throw new NotFoundException('Merge request not found');
    }
    if (merge.status !== MergeRequestStatus.PENDING) {
      throw new ValidationException('This merge request is already resolved');
    }
    return merge;
  }

  private async requireMembership(
    zoneId: string,
    userId: string,
    which: 'source' | 'target'
  ): Promise<ZoneMembership> {
    const membership = await this.memberships.findOne({
      where: { zoneId, userId },
    });
    if (!membership) {
      throw new ValidationException(
        `The ${which} account is not a member of this zone`
      );
    }
    return membership;
  }
}
