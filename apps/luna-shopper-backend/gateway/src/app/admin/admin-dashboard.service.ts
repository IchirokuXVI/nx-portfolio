import { Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_AUTH_PATTERNS,
  ADMIN_DASHBOARD_FEED_LIMIT,
  ADMIN_DASHBOARD_PATTERNS,
  ADMIN_DASHBOARD_WINDOW_DAYS,
  type AdminActivityEntry,
  type AdminCatalogDashboard,
  type AdminCoreDashboard,
  type AdminDashboardActivityEntry,
  type AdminDashboardRequest,
  type AdminDashboardResponse,
  type AdminDashboardWindow,
  type AdminHarvestDashboard,
  type AdminIdentityDashboard,
  type AdminIdentityListView,
} from '@portfolio/luna-shopper/contracts';
import { NatsClient } from '../messaging/nats-client';
import { adminCredential } from './admin-credential';
import type { CurrentAdmin } from './admin-jwt.strategy';

/**
 * What the back office opens to (plan 0088).
 *
 * The fan out, and nothing else: the controller is one method, and this is what
 * the spec drives with a fake {@link NatsClient}. Four subjects are asked in
 * parallel, each verifies the forwarded operator token for itself, and each
 * answers about its own database.
 *
 * **A block that did not answer is `null`, and the response is still 200.** That
 * is `GatewayStatsService.ask` applied four times, for the same reason: a
 * harvester that is not deployed, a catalog that is restarting or a subject that
 * timed out costs its own block and nothing else. A screen that can say which
 * block it did not get is a better answer than a 502 for the whole page. It also
 * means no handler may ever answer `null` for a count, because `null` is how the
 * screen tells "did not answer" from "answered zero".
 *
 * **Not cached**, unlike the public `GET /v1/stats`. That route caches because it
 * is unauthenticated and a thousand visitors can hit it; this one has one
 * operator behind a bearer token asking once a minute while the tab is visible.
 * `measuredAt` rides along anyway, so an operator reading a tab they opened
 * yesterday is not reading it as now.
 */
@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);

  constructor(private readonly nats: NatsClient) {}

  async dashboard(admin: CurrentAdmin): Promise<AdminDashboardResponse> {
    const now = new Date();
    const window = dashboardWindow(now);
    const request: AdminDashboardRequest = {
      ...adminCredential(admin),
      window,
    };

    const [identity, core, catalog, harvest] = await Promise.all([
      this.ask<AdminIdentityDashboard>(
        ADMIN_DASHBOARD_PATTERNS.identity,
        request
      ),
      this.ask<AdminCoreDashboard>(ADMIN_DASHBOARD_PATTERNS.core, request),
      this.ask<AdminCatalogDashboard>(
        ADMIN_DASHBOARD_PATTERNS.catalog,
        request
      ),
      this.ask<AdminHarvestDashboard>(
        ADMIN_DASHBOARD_PATTERNS.harvest,
        request
      ),
    ]);

    const activity = await this.nameActors(
      admin,
      mergeActivity([
        identity?.activity ?? [],
        core?.activity ?? [],
        catalog?.activity ?? [],
      ])
    );

    return {
      window,
      identity,
      core,
      catalog,
      harvest,
      activity,
      measuredAt: now.toISOString(),
    };
  }

  /** One downstream block, or `null` when that service did not answer. */
  private async ask<T>(
    subject: string,
    request: AdminDashboardRequest
  ): Promise<T | null> {
    try {
      return await this.nats.send<T, AdminDashboardRequest>(subject, request);
    } catch (error) {
      // Logged rather than swallowed silently: the screen says a block is
      // missing, and the reason it is missing belongs in the gateway's log.
      this.logger.warn(
        `${subject} did not answer the dashboard: ${(error as Error).message}`
      );
      return null;
    }
  }

  /**
   * The merged feed with every actor named (plan 0088, section 4).
   *
   * One call to `adminAuth.listAdmins`, which answers the whole roster: there
   * are a handful of rows and no page, so resolving twenty feed entries costs
   * one request rather than twenty. A name the directory cannot resolve renders
   * as the id itself, which is plan 0074 section 3's rule, and a `SERVICE` actor
   * is never looked up at all because its id is provisioned per cluster and the
   * screen names the service from it.
   *
   * A failed lookup leaves every row named by its id rather than failing the
   * page, for the reason `AdminUserNamesService` gives: the feed has already
   * been fetched, and "we could not label the rows" is not "the page is
   * unavailable".
   */
  private async nameActors(
    admin: CurrentAdmin,
    entries: AdminActivityEntry[]
  ): Promise<AdminDashboardActivityEntry[]> {
    const names = entries.some((entry) => entry.actorKind === 'ADMIN')
      ? await this.adminNames(admin)
      : new Map<string, string>();

    return entries.map((entry) => ({
      ...entry,
      actorName:
        entry.actorKind === 'ADMIN'
          ? (names.get(entry.actorId) ?? entry.actorId)
          : entry.actorId,
    }));
  }

  private async adminNames(admin: CurrentAdmin): Promise<Map<string, string>> {
    try {
      const roster = await this.nats.send<AdminIdentityListView>(
        ADMIN_AUTH_PATTERNS.listAdmins,
        adminCredential(admin)
      );
      return new Map(
        (roster?.admins ?? []).map((row) => [
          row.adminId,
          // Display name, else username, else the id, per plan 0074 section 3.
          row.displayName || row.username || row.adminId,
        ])
      );
    } catch (error) {
      this.logger.warn(
        `Could not name the dashboard's actors: ${(error as Error).message}`
      );
      return new Map();
    }
  }
}

/**
 * The thirty days the series cover, ending today in UTC (plan 0088, section 2).
 *
 * Stated once here rather than by each service, so four clocks a second apart
 * cannot disagree about where a day starts. It is not a query parameter: a
 * screen that wants ninety days is a screen that wants a different chart, and
 * the plan that adds it adds the parameter with the range check it needs.
 */
export function dashboardWindow(now: Date): AdminDashboardWindow {
  const to = now.toISOString().slice(0, 10);
  const first = new Date(
    Date.parse(`${to}T00:00:00.000Z`) -
      (ADMIN_DASHBOARD_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000
  );
  return { from: first.toISOString().slice(0, 10), to };
}

/**
 * The three trails as one feed: newest first, capped at twenty.
 *
 * Sorted here rather than by any one service, because none of them can see the
 * other two. Ties break on the entity and the row id, so two changes stamped at
 * the same millisecond come back in the same order on every request rather than
 * shuffling between polls.
 */
export function mergeActivity(
  trails: readonly AdminActivityEntry[][]
): AdminActivityEntry[] {
  return trails
    .flat()
    .sort(
      (left, right) =>
        right.at.localeCompare(left.at) ||
        left.entity.localeCompare(right.entity) ||
        left.entityId.localeCompare(right.entityId)
    )
    .slice(0, ADMIN_DASHBOARD_FEED_LIMIT);
}
