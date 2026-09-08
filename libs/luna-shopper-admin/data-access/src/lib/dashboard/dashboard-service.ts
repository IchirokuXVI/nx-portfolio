import { inject } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { DashboardMemory } from './dashboard-memory';

/**
 * Everything the dashboard reads, which is one document (backend plan 0088).
 *
 * The wire type is the view model, exactly as it is for a run: `0004` section 2
 * records that exception to rule D4 for this app, and it is what lets the run in
 * flight on this screen be drawn by the component the run screen draws it with,
 * with nothing mapped in between.
 *
 * A block is `null` when its service did not answer, and the response is still
 * 200. That is the case the screen is shaped around, so the type says it and no
 * caller may treat a missing block as an empty one.
 */
export type DashboardDocument = Wire.AdminAdminDashboardResponse;

/**
 * The one read (admin plan 0016, section 1).
 *
 * One method, because there is one route and it answers the whole screen. There
 * is no per block request and no per chart request: a block that did not answer
 * arrives as `null` in the same document, so asking four times would turn one
 * partial answer into four separate failures the screen would have to reconcile.
 */
export interface DashboardServiceI {
  read(): Promise<DashboardDocument>;
}

/**
 * Inject THIS token, never a concrete class.
 *
 * The default is the in-memory implementation, so every spec and a run with
 * nothing listening both draw a populated dashboard with no configuration.
 * `app-providers.ts` binds the HTTP one beside the `HttpClient` it depends on,
 * exactly as the harvester's is bound.
 */
export const DASHBOARD_SERVICE = serviceToken<DashboardServiceI>(
  'DASHBOARD_SERVICE',
  () => inject(DashboardMemory)
);
