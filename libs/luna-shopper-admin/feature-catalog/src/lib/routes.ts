import type { Route } from '@angular/router';
import { ItemPricesPage } from './item-prices-page';

/**
 * The catalog's hand written screens: one, the product at every scope (admin
 * plan 0033).
 *
 * **Relative to the section**, like the harvester's. It sits beside the items
 * resource rather than inside it, because the resource route factory mounts a
 * list, a form and a detail and nothing else; the section tries the resource
 * first, finds no child that takes two segments after the product, and falls
 * through to this one.
 *
 * There is no navigation entry for it, for the reason `runs/:id` has none: a
 * link to a route with a parameter has nothing to put in it. It is reached from
 * the product's screen and from a price's history.
 */
export function catalogRoutes(): Route[] {
  return [{ path: 'items/:id/prices', component: ItemPricesPage }];
}
