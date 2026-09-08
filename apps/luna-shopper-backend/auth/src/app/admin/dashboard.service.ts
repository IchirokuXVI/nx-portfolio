import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ADMIN_DASHBOARD_ACTIVITY_LIMIT,
  ADMIN_DASHBOARD_LOGIN_FAILURE_LIMIT,
  UserKind,
  type AdminDashboardRequest,
  type AdminIdentityDashboard,
  type AdminLoginFailureView,
} from '@portfolio/luna-shopper/contracts';
import { fillDailyWindow } from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { AuthAuditService } from '../audit/auth-audit.service';
import { AdminLoginFailure, AdminUser, User } from '../entities';
import { AuthPlatformAdminService } from './platform-admin.service';

/** A day of sign ups, as the grouped query answers it. */
interface SignUpRow {
  day: string;
  count: string;
}

/**
 * Auth's block of the back office dashboard (plan 0088, section 3.1).
 *
 * Counts over auth's own tables and nothing else: no cross database join and no
 * write. The window comes from the gateway rather than being decided here, so
 * four services bucketing "the last thirty days" cannot disagree about where a
 * day starts, and the fill is `fillDailyWindow`, which all four import.
 *
 * The gate runs first, every time. Auth's directory is the one thing on this
 * dashboard that would be worth reading without a token, so this handler
 * verifies the forwarded operator token before it counts anything.
 */
@Injectable()
export class AuthDashboardService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AdminUser) private readonly admins: Repository<AdminUser>,
    @InjectRepository(AdminLoginFailure)
    private readonly failures: Repository<AdminLoginFailure>,
    private readonly gate: AuthPlatformAdminService,
    private readonly audit: AuthAuditService
  ) {}

  async dashboard(req: AdminDashboardRequest): Promise<AdminIdentityDashboard> {
    await this.gate.requireAdmin(req);

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [users, signUps, admins, failureCounts, recentFailures, activity] =
      await Promise.all([
        this.countUsers(),
        this.countSignUps(req),
        this.countAdmins(),
        this.countFailures(dayAgo, weekAgo),
        this.recentFailures(),
        this.audit.recent(ADMIN_DASHBOARD_ACTIVITY_LIMIT),
      ]);

    return {
      users,
      signUps,
      admins,
      loginFailures: { ...failureCounts, recent: recentFailures },
      activity,
    };
  }

  /**
   * Every user row, split four ways.
   *
   * `verified` is registered **and** confirmed rather than confirmed alone: a
   * temporary user has no address to confirm, so counting the column on its own
   * would answer the same number by a different question.
   */
  private async countUsers(): Promise<AdminIdentityDashboard['users']> {
    const row = await this.users
      .createQueryBuilder('u')
      .select('count(*)::int', 'total')
      .addSelect(
        `count(*) FILTER (WHERE u.kind = :registered)::int`,
        'registered'
      )
      .addSelect(
        `count(*) FILTER (WHERE u.kind = :temporary)::int`,
        'temporary'
      )
      .addSelect(
        `count(*) FILTER (WHERE u.kind = :registered AND u."emailVerifiedAt" IS NOT NULL)::int`,
        'verified'
      )
      .setParameters({
        registered: UserKind.REGISTERED,
        temporary: UserKind.TEMPORARY,
      })
      .getRawOne<{
        total: number;
        registered: number;
        temporary: number;
        verified: number;
      }>();

    return {
      total: row?.total ?? 0,
      registered: row?.registered ?? 0,
      temporary: row?.temporary ?? 0,
      verified: row?.verified ?? 0,
    };
  }

  /**
   * Registered users created per day, over the window.
   *
   * Registered only, because a temporary user is a guest a zone link created and
   * counting them as sign ups would draw a chart of link clicks.
   */
  private async countSignUps(req: AdminDashboardRequest) {
    const rows = await this.users
      .createQueryBuilder('u')
      .select(
        `to_char(date_trunc('day', u."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
        'day'
      )
      .addSelect('count(*)', 'count')
      .where('u.kind = :registered', { registered: UserKind.REGISTERED })
      .andWhere(`u."createdAt" >= :from::timestamptz`, {
        from: `${req.window.from}T00:00:00Z`,
      })
      .groupBy('1')
      .getRawMany<SignUpRow>();

    // Only a lower bound. The window ends today, so there is no upper one to
    // get wrong, and `fillDailyWindow` drops a row past the last day anyway if a
    // clock ever puts one there.
    return fillDailyWindow(req.window, rows);
  }

  private async countAdmins(): Promise<AdminIdentityDashboard['admins']> {
    const row = await this.admins
      .createQueryBuilder('a')
      .select('count(*)::int', 'total')
      .addSelect(
        `count(*) FILTER (WHERE a."disabledAt" IS NOT NULL)::int`,
        'disabled'
      )
      .getRawOne<{ total: number; disabled: number }>();

    return { total: row?.total ?? 0, disabled: row?.disabled ?? 0 };
  }

  /**
   * Failed operator logins over two spans, measured from now.
   *
   * Plan 0071 section 7 asked for these by name and left them without a screen.
   * They are counts and a short list rather than a chart, because the
   * interesting number is almost always zero and a chart of zeros says less than
   * the word.
   */
  private async countFailures(dayAgo: Date, weekAgo: Date) {
    const row = await this.failures
      .createQueryBuilder('f')
      .select(
        `count(*) FILTER (WHERE f."createdAt" >= :dayAgo)::int`,
        'last24h'
      )
      .addSelect(
        `count(*) FILTER (WHERE f."createdAt" >= :weekAgo)::int`,
        'last7d'
      )
      .setParameters({ dayAgo, weekAgo })
      .getRawOne<{ last24h: number; last7d: number }>();

    return { last24h: row?.last24h ?? 0, last7d: row?.last7d ?? 0 };
  }

  /**
   * The newest attempts, newest first.
   *
   * `userAgent` is on the row and is not sent: it is 512 characters that tell an
   * operator reading a tile nothing, and the row that needs it is read from the
   * database by whoever is investigating it.
   */
  private async recentFailures(): Promise<AdminLoginFailureView[]> {
    const rows = await this.failures.find({
      order: { createdAt: 'DESC', id: 'DESC' },
      take: ADMIN_DASHBOARD_LOGIN_FAILURE_LIMIT,
    });

    return rows.map((row) => ({
      at: row.createdAt.toISOString(),
      username: row.username,
      ip: row.ip,
    }));
  }
}
