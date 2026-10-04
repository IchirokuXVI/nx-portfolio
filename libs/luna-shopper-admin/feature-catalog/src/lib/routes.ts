import type { Route } from '@angular/router';
import { oldChainAddresses } from './chains/old-addresses';
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
 *
 * After it come the addresses the chain screens had while they were lists of
 * this section, as redirects to where a chain holds them now (admin plan 0042,
 * target 9).
 */
export function catalogRoutes(): Route[] {
  return [
    { path: 'items/:id/prices', component: ItemPricesPage },
    ...oldChainAddresses(),
  ];
}
