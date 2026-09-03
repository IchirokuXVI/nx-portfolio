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
 * The order is grouped by what an operator came here to do rather than
 * alphabetically. The catalog first, because that is the half that gets edited;
 * then the people and what they share, which is read far more often than it is
 * touched; and the admin table last, which is opened to answer one question and
 * never to change anything.
 *
 * Inside the catalog the order is the order an operator moves through it rather
 * than the order the tables were built in. Chains come first because everything
 * else is addressed under one: a shop belongs to a chain, a price scope belongs
 * to a chain, and both lists ask for one before they will read anything.
 * Products and groups come next, because they are the half of the catalog that
 * has no chain at all. Prices and aisle positions come last, because each of
 * them joins the two halves and neither can be filled in before both exist.
 *
 * `0004` shipped one line, `0005` added the rest of the catalog and `0007` the
 * people. That is the whole of `0004`'s second exit criterion: a new entity is a
 * line in this file and a descriptor, and no change to the list or the form. The
 * harvester is the exception that proves it, because a run is not a row: `0006`
 * adds no line here and passes its routes to `adminRoutes` instead.
 */
export const ADMIN_RESOURCES: readonly AnyResourceDescriptor[] = [
  SUPERMARKETS,
  LOCATIONS,
  PRICE_SCOPES,
  PRODUCT_GROUPS,
  ITEMS,
  PRICES,
  LOCATION_ITEMS,
  USERS,
  ZONES,
  LISTS,
  BASKETS,
  ADMINS,
];
