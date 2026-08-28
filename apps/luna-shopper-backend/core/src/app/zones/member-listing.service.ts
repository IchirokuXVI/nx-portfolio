import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MembershipStatus,
  type ListMembersRequest,
  type MemberOrder,
  type MembershipPage,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  ForbiddenException,
} from '@portfolio/luna-shopper/platform';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { ZoneMembership } from '../entities';
import { ZoneAuthzService } from './zone-authz.service';
import { managesZone, toMembershipView } from './zone.mappers';

/**
 * The cursor carries only the order and the id of the last row on the page.
 *
 * Every other cursor in this codebase also encodes the sort value, which reads
 * as the obvious thing to do and is subtly wrong for a timestamp: Postgres keeps
 * `timestamptz` to microseconds, a JavaScript `Date` only to milliseconds, and
 * `toISOString()` therefore hands back a value slightly BELOW the row's real
 * one. On an ascending keyset that makes the boundary row compare as still
 * ahead of the cursor, so it comes back a second time at the top of the next
 * page. Naming the row instead and letting Postgres read its own sort key back
 * is exact by construction, and costs one primary key lookup per page.
 */
interface MemberCursor {
  order: MemberOrder;
  id: string;
}

/** The sort key of the row a cursor names, read back at full precision. */
function boundary(columns: string): string {
  return `(SELECT ${columns} FROM "zone_memberships" b WHERE b.id = :cid)`;
}

/**
 * Reading a zone's members (plan 0017, section 5).
 *
 * The endpoint the zone surface never had: before this, a `MembershipView` only
 * ever reached a client as the result of an action the client itself performed,
 * or as a realtime event it happened to be connected for. Without it there is no
 * members screen and no join request screen.
 */
@Injectable()
export class MemberListingService {
  constructor(
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    private readonly authz: ZoneAuthzService
  ) {}

  async list(req: ListMembersRequest): Promise<MembershipPage> {
    const viewer = await this.authz.requireApproved(req.zoneId, req.userId);
    const statuses = this.resolveStatuses(req.statuses);

    // Anything beyond the approved roster is governance data (section 6). A
    // silent empty page would read as "nobody is waiting", which is the worse
    // failure, so this is a refusal rather than a filter.
    const wantsGovernance = statuses.some(
      (status) => status !== MembershipStatus.APPROVED
    );
    if (wantsGovernance && !managesZone(viewer)) {
      throw new ForbiddenException(
        'Only an owner or admin can see who is waiting to join'
      );
    }

    const order = this.resolveOrder(req.order);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as MemberCursor | undefined;

    const qb = this.memberships
      .createQueryBuilder('m')
      .where('m."zoneId" = :zoneId', { zoneId: req.zoneId })
      .andWhere('m.status IN (:...statuses)', { statuses })
      .take(limit + 1);

    this.applyOrder(qb, order, cursor);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
      items: page.map(toMembershipView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ order, id: last.id })
          : null,
    };
  }

  /** Defaults to the approved roster, which is what a members screen shows. */
  private resolveStatuses(requested?: MembershipStatus[]): MembershipStatus[] {
    const valid = (requested ?? []).filter((status) =>
      Object.values(MembershipStatus).includes(status)
    );
    return valid.length > 0 ? valid : [MembershipStatus.APPROVED];
  }

  private resolveOrder(order?: string): MemberOrder {
    return order === 'name' || order === 'role' ? order : 'joined';
  }

  private applyOrder(
    qb: SelectQueryBuilder<ZoneMembership>,
    order: MemberOrder,
    cursor?: MemberCursor
  ): void {
    if (order === 'name') {
      qb.orderBy('m.username', 'ASC').addOrderBy('m.id', 'ASC');
      if (cursor) {
        qb.andWhere(`(m.username, m.id) > ${boundary('b.username, b.id')}`, {
          cid: cursor.id,
        });
      }
      return;
    }
    if (order === 'role') {
      // OWNER, then ADMIN, then MEMBER: Postgres orders a native enum by its
      // declaration order, and ZoneRole is declared in exactly that order, so
      // this is a plain ORDER BY. The spec that asserts it is what catches
      // someone reordering the enum. Comparing the cursor as text would be a
      // different order again, since alphabetically ADMIN precedes OWNER;
      // reading the enum back from the row sidesteps that entirely.
      qb.orderBy('m.role', 'ASC')
        .addOrderBy('m.createdAt', 'ASC')
        .addOrderBy('m.id', 'ASC');
      if (cursor) {
        qb.andWhere(
          `(m.role, m."createdAt", m.id) > ${boundary(
            'b.role, b."createdAt", b.id'
          )}`,
          { cid: cursor.id }
        );
      }
      return;
    }
    // `joined` ascending, so the PENDING filter opens with the same person
    // `firstPendingRequesterName` names rather than burying them mid page.
    qb.orderBy('m.createdAt', 'ASC').addOrderBy('m.id', 'ASC');
    if (cursor) {
      qb.andWhere(
        `(m."createdAt", m.id) > ${boundary('b."createdAt", b.id')}`,
        { cid: cursor.id }
      );
    }
  }
}
