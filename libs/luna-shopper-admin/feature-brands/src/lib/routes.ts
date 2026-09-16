import type { Route } from '@angular/router';
import type { ShellLink } from '@portfolio/luna-shopper-admin/ui';
import { BrandSuggestionsPage } from './brand-suggestions-page';
import { BRANDS } from './brands';

/**
 * The segment the brands section owns, for the rare screen that builds an
 * absolute URL into it by hand.
 *
 * Exported the way `HARVEST_SEGMENT` is, and used the same way: a **resource**
 * under this section is found through `ResourceRegistry.pathOf` and never
 * through this constant.
 */
export const BRANDS_SEGMENT = 'brands';

/**
 * The section's hand written screens: the suggested brands, and the redirect
 * that decides what `/brands` opens (admin plan 0027, section 1).
 *
 * **The redirect is why this section has no `home`.** A section with no home
 * draws nothing at its own empty path, and a dashboard summarising two screens
 * would be a click between the operator and both of them. So `/brands` is the
 * registered list, arrived at through a redirect among the section's own
 * screens, which are plain routes and may hold one.
 *
 * `redirectTo` reads the descriptor's own segment rather than repeating it.
 * There is one statement of where the registered brands live, and it is the
 * descriptor.
 *
 * Every path is a plain segment, because this app carries no `:locale`
 * (plan 0001, section 3): one operator, one browser, no links sent to anyone.
 */
export function brandsRoutes(): Route[] {
  return [
    { path: '', pathMatch: 'full', redirectTo: BRANDS.segment },
    { path: 'suggested', component: BrandSuggestionsPage },
  ];
}

/**
 * The navigation entry for that screen.
 *
 * Beside the route rather than in the app, so a screen cannot end up reachable
 * without a link or linked without a route.
 *
 * **Suggested reads first**, because `sectionScreens` puts a section's hand
 * written links before its resources and that is the right order here: the
 * registered list is a reference, and the suggestions are the work.
 */
export const BRANDS_LINKS: readonly ShellLink[] = [
  { path: `/${BRANDS_SEGMENT}/suggested`, label: 'brands.nav.suggested' },
];
