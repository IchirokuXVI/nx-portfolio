import { InjectionToken, type Provider } from '@angular/core';
import type { ShellLink } from '@portfolio/luna-shopper-admin/ui';

/**
 * Navigation entries for screens that are not a resource.
 *
 * `AdminShellPage` reads the resource registry, which gives resources a property
 * worth keeping: a resource cannot be reachable without a link or linked without
 * a route, because both come from one list. A hand written screen has no
 * descriptor to be read from, so it needs somewhere to say it exists, and this
 * is that somewhere.
 *
 * The default is empty, so an app that has only resources needs no provider and
 * every existing spec keeps its navigation exactly as it was.
 *
 * The links come from the same library as the routes they point at (plan 0006's
 * `HARVEST_LINKS` sits beside `harvestRoutes`), which is how the property above
 * survives: a screen and its link are added in one file, not two.
 */
export const SHELL_LINKS = new InjectionToken<readonly ShellLink[]>(
  'SHELL_LINKS',
  { providedIn: 'root', factory: () => [] }
);

/** Name the non-resource screens this app has. */
export function provideShellLinks(...links: readonly ShellLink[]): Provider {
  return { provide: SHELL_LINKS, useValue: links };
}
