import {
  ITEMS,
  LOCATION_ITEMS,
  LOCATIONS,
  PRICE_SCOPES,
  PRICES,
  PRODUCT_GROUPS,
  SUPERMARKETS,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import {
  ADMINS,
  BASKETS,
  LISTS,
  USERS,
  ZONES,
} from '@portfolio/luna-shopper-admin/feature-people';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';

/**
 * Every resource this app has, in the order the navigation shows them.
 *
 * The list belongs to the app, because it is the app that decides which screens
 * exist. It is what the route table is built from and what the navigation is
 * read from, so a resource cannot end up reachable without a link or linked
 * without a route.
 *
 * The order is the order the navigation shows, so it is grouped by what an
 * operator came here to do rather than alphabetically. The catalog first,
 * because that is the half that gets edited; then the people and what they
 * share, which is read far more often than it is touched; and the admin table
 * last, which is opened to answer one question and never to change anything.
 *
 * `0005` and `0006` add the rest of the catalog and the harvester by adding
 * lines here, which is the whole of `0004`'s second exit criterion: a new entity
 * is a line in this file and a descriptor, and no change to the list or the form.
 *
 * Within the catalog the order follows what an operator is holding in their head
 * rather than the alphabet. A chain, then the shops it has and the scopes it
 * prices against, because both belong to a chain and neither can be read without
 * naming one. Then the products, then the groups that make two products
 * comparable, then the prices, which need a product and a scope to exist at all.
 * The per shop rows are last: they are the narrowest question in the catalog and
 * the one asked least often.
 */
export const ADMIN_RESOURCES: readonly AnyResourceDescriptor[] = [
  SUPERMARKETS,
  LOCATIONS,
  PRICE_SCOPES,
  ITEMS,
  PRODUCT_GROUPS,
  PRICES,
  LOCATION_ITEMS,
  USERS,
  ZONES,
  LISTS,
  BASKETS,
  ADMINS,
];
