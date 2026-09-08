import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ADMIN_DASHBOARD_ACTIVITY_LIMIT,
  GeneratedListStatus,
  MembershipStatus,
  ZoneStatus,
  type AdminCoreDashboard,
  type AdminDashboardRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  fillDailyWindow,
  type DailyRow,
} from '@portfolio/luna-shopper/platform';
import { Repository, type ObjectLiteral } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import { GeneratedList, ShoppingList, Zone, ZoneMembership } from '../entities';
import { CorePlatformAdminService } from './platform-admin.service';

/**
 * Core's block of the back office dashboard (plan 0088, section 3.2).
 *
 * One aggregate per table, plus two daily series filled into the window the
 * gateway stated. Nothing is joined across a service boundary and nothing is
 * written: the households, their lists and their baskets are counted where they
 * live.
 *
 * The gate runs before any of it, in the service rather than at the controller,
 * so a future caller that reaches this class another way still cannot count
 * without an operator token.
 */
@Injectable()
export class CoreDashboardService {
  constructor(
    @InjectRepository(Zone) private readonly zones: Repository<Zone>,
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    @InjectRepository(ShoppingList)
    private readonly lists: Repository<ShoppingList>,
    @InjectRepository(GeneratedList)
    private readonly baskets: Repository<GeneratedList>,
    private readonly gate: CorePlatformAdminService,
    private readonly audit: CoreAuditService
  ) {}

  async dashboard(req: AdminDashboardRequest): Promise<AdminCoreDashboard> {
    await this.gate.requireAdmin(req);

    const [
      zones,
      pending,
      listTotal,
      basketCounts,
      zonesCreated,
      listsCreated,
      activity,
    ] = await Promise.all([
      this.countZones(),
      this.countPendingMemberships(),
      this.lists.count(),
      this.countBaskets(),
      this.createdPerDay(this.zones, 'z', req),
      this.createdPerDay(this.lists, 'l', req),
      this.audit.recent(ADMIN_DASHBOARD_ACTIVITY_LIMIT),
    ]);

    return {
      zones,
      memberships: { pending },
      lists: { total: listTotal },
      baskets: basketCounts,
      zonesCreated,
      listsCreated,
      activity,
    };
  }

  private async countZones(): Promise<AdminCoreDashboard['zones']> {
    const row = await this.zones
      .createQueryBuilder('z')
      .select('count(*)::int', 'total')
      .addSelect(`count(*) FILTER (WHERE z.status = :active)::int`, 'active')
      .addSelect(`count(*) FILTER (WHERE z.status = :marked)::int`, 'marked')
      .setParameters({
        active: ZoneStatus.ACTIVE,
        marked: ZoneStatus.MARKED_FOR_DELETION,
      })
      .getRawOne<{ total: number; active: number; marked: number }>();

    return {
      total: row?.total ?? 0,
      active: row?.active ?? 0,
      markedForDeletion: row?.marked ?? 0,
    };
  }

  /**
   * Join requests nobody has answered.
   *
   * The one number in this block that is work waiting rather than a total, which
   * is why it is reported on its own rather than as one bucket of a membership
   * breakdown: the screen links it to the memberships list filtered to pending.
   */
  private countPendingMemberships(): Promise<number> {
    return this.memberships.count({
      where: { status: MembershipStatus.PENDING },
    });
  }

  /**
   * Baskets by status.
   *
   * `total` is sent rather than derived from the two. `ACTIVE` is never written,
   * so the live basket is `DRAFT`, and the two reported statuses fall short of
   * the total exactly when an `ARCHIVED` row exists.
   */
  private async countBaskets(): Promise<AdminCoreDashboard['baskets']> {
    const row = await this.baskets
      .createQueryBuilder('g')
      .select('count(*)::int', 'total')
      .addSelect(`count(*) FILTER (WHERE g.status = :draft)::int`, 'draft')
      .addSelect(
        `count(*) FILTER (WHERE g.status = :completed)::int`,
        'completed'
      )
      .setParameters({
        draft: GeneratedListStatus.DRAFT,
        completed: GeneratedListStatus.COMPLETED,
      })
      .getRawOne<{ total: number; draft: number; completed: number }>();

    return {
      total: row?.total ?? 0,
      draft: row?.draft ?? 0,
      completed: row?.completed ?? 0,
    };
  }

  /**
   * Rows created per day over the window, for any table with a `createdAt`.
   *
   * Only a lower bound is applied. The window ends today, so there is no upper
   * one to get wrong, and `fillDailyWindow` drops a row past the last day if a
   * clock ever puts one there.
   */
  private async createdPerDay<T extends ObjectLiteral>(
    repository: Repository<T>,
    alias: string,
    req: AdminDashboardRequest
  ) {
    const rows = await repository
      .createQueryBuilder(alias)
      .select(
        `to_char(date_trunc('day', ${alias}."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
        'day'
      )
      .addSelect('count(*)', 'count')
      .where(`${alias}."createdAt" >= :from::timestamptz`, {
        from: `${req.window.from}T00:00:00Z`,
      })
      .groupBy('1')
      .getRawMany<DailyRow>();

    return fillDailyWindow(req.window, rows);
  }
}
