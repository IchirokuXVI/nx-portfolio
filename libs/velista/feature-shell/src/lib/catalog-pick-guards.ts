import type { CanDeactivateFn } from '@angular/router';

/** A page that may hold a choice nobody saved, and asks before it is left. */
export interface AsksBeforeLeaving {
  /**
   * Whether the navigation to `nextUrl` may go. A promise holds it while the page
   * asks ("Leave without saving?", velista `0146`, section 4).
   */
  canLeave(nextUrl: string): boolean | Promise<boolean>;
}

/**
 * Leaving the catalog that chooses the products of a line with a change in the
 * set asks first (velista `0146`, section 4).
 *
 * A guard, because the back of the browser is a navigation that is already going
 * by the time the page could hear of it. The close and Escape ask before they
 * walk back, so the guard finds the set ended and lets them through. The page
 * judges the URL, because its own pickers are pages under its path and going to
 * one is not a leaving.
 */
export const catalogPickLeaveGuard: CanDeactivateFn<AsksBeforeLeaving> = (
  component,
  _route,
  _state,
  next
) =>
  component !== null && typeof component.canLeave === 'function'
    ? component.canLeave(next.url)
    : true;
