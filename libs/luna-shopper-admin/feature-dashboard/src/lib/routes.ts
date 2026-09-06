import type { ShellLink } from '@portfolio/luna-shopper-admin/ui';

/**
 * The navigation entry for the screen the app opens to (admin plan 0016).
 *
 * Beside the screen it points at, the way `HARVEST_LINKS` sits beside
 * `harvestRoutes`, so a screen cannot end up reachable without a link or linked
 * without a route.
 *
 * There is no `dashboardRoutes()` to sit beside it, and that is the difference
 * from the harvester: this screen is not a branch of the route table, it is the
 * empty path itself. `adminRoutes` takes it as its `home` argument, which is
 * also what stops the redirect to the first resource being emitted.
 *
 * `leading`, so it is drawn in front of the resources rather than after them
 * with the bespoke screens. Those are a section at the end; this is the screen
 * above everything it summarises.
 */
export const DASHBOARD_LINK: ShellLink = {
  path: '/',
  label: 'dashboard.nav',
  leading: true,
};
