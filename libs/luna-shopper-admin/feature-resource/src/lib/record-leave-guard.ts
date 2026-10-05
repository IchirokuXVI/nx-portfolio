import type { CanDeactivateFn } from '@angular/router';

/** A page that can say whether it may be left. */
export interface LeaveAware {
  /** Answers `true` when the route may be left. It may ask the operator first. */
  canLeave(): boolean | Promise<boolean>;
}

/**
 * Leaving a record with changes asks first (admin plan 0053, section 2.6).
 *
 * The back link, a tab, the rail, a link in the page and the Back button of
 * the browser are all one navigation to the router, so one guard covers them.
 * The page holds the question and its answer. The guard only asks the page.
 *
 * The router also runs it when the same route is opened for another ID, so
 * going from one record to the next asks as well.
 *
 * A component that cannot answer may be left. That is a route some other
 * component was mounted at, and it has no draft this guard knows of.
 */
export const recordLeaveGuard: CanDeactivateFn<LeaveAware> = (component) =>
  typeof component?.canLeave === 'function' ? component.canLeave() : true;
