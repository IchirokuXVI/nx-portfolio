import {
  CATALOG_SCREENS,
  ITEMS,
  LOCATION_ITEMS,
  LOCATIONS,
  PRICE_SCOPES,
  PRICES,
  PRODUCT_GROUPS,
  SUPERMARKETS,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import type { ResourceScreens } from '@portfolio/luna-shopper-admin/feature-resource';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';

/**
 * Every resource this app has, in the order the navigation shows them.
 *
 * The list belongs to the app, because it is the app that decides which screens
 * exist. It is what the route table is built from and what the navigation is
 * read from, so a resource cannot end up reachable without a link or linked
 * without a route.
 *
 * The order is the order an operator moves through the catalog rather than the
 * order the tables were built in. Chains come first because everything else is
 * addressed under one: a shop belongs to a chain, a price scope belongs to a
 * chain, and both lists ask for one before they will read anything. Products
 * and groups come next, because they are the half of the catalog that has no
 * chain at all. Prices and aisle positions come last, because each of them
 * joins the two halves and neither can be filled in before both exist.
 *
 * The seven of `0005`. Harvester screens are `0006` and people are `0007`, and
 * each adds lines here.
 */
export const ADMIN_RESOURCES: readonly AnyResourceDescriptor[] = [
  SUPERMARKETS,
  LOCATIONS,
  PRICE_SCOPES,
  PRODUCT_GROUPS,
  ITEMS,
  PRICES,
  LOCATION_ITEMS,
];

/**
 * The resources that draw with a screen of their own.
 *
 * One, and it is prices. Everything else in the catalog is a descriptor and no
 * code at all, which is the claim `0004` made and this is where it is checked.
 */
export const ADMIN_SCREENS: Readonly<Record<string, ResourceScreens>> =
  CATALOG_SCREENS;
