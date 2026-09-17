import type { Route } from '@angular/router';
import { HARVEST_SEGMENT } from '@portfolio/luna-shopper-admin/feature-harvest';
import type { ShellLink } from '@portfolio/luna-shopper-admin/ui';
import { BrandSuggestionsPage } from './brand-suggestions-page';

/**
 * The brands' hand written screen: the suggested brands (admin plan 0027,
 * section 3).
 *
 * **Mounted inside the harvester section**, beside the `BRANDS` descriptor that
 * the same section mounts. Brands had a section of their own, which was one tab
 * for two screens, and its tab pointed at the suggestions, so it went unmarked
 * the moment the operator opened the registered list. The suggestions are keys
 * the harvested queue carries, and a person works them next to the queues they
 * come from, so the harvester is where both screens live.
 *
 * Every path is a plain segment, because this app carries no `:locale`
 * (plan 0001, section 3): one operator, one browser, no links sent to anyone.
 */
export function brandsRoutes(): Route[] {
  return [{ path: 'suggested-brands', component: BrandSuggestionsPage }];
}

/**
 * The navigation entry for that screen.
 *
 * Beside the route rather than in the app, so a screen cannot end up reachable
 * without a link or linked without a route.
 *
 * `sectionScreens` puts a section's hand written links before its resources, so
 * the app lists this entry last among the harvester's links and `BRANDS` first
 * among its resources, which keeps the two brand screens next to each other.
 */
export const BRANDS_LINKS: readonly ShellLink[] = [
  {
    path: `/${HARVEST_SEGMENT}/suggested-brands`,
    label: 'brands.nav.suggested',
  },
];
