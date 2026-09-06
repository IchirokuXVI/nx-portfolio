import { Injectable } from '@angular/core';
import { DASHBOARD_SEED } from './dashboard-seed';
import type { DashboardDocument, DashboardServiceI } from './dashboard-service';

/**
 * The dashboard with nothing listening (admin plan 0016, section 1).
 *
 * Deterministic, and that is the requirement rather than a nicety: a screenshot
 * of this dashboard is what the pull request shows, and specs assert counts
 * against it. A seed built from `Date.now()` would produce a different screen
 * every run and a spec that could only say a number was a number.
 *
 * `measuredAt` is the seed's own instant and not now, for the same reason. What
 * the header then says is "taken a long time ago", which is the honest thing for
 * a document nothing measured.
 */
@Injectable({ providedIn: 'root' })
export class DashboardMemory implements DashboardServiceI {
  async read(): Promise<DashboardDocument> {
    return DASHBOARD_SEED;
  }
}
