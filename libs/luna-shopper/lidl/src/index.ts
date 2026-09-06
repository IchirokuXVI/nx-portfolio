/**
 * LIDL Spain's three services (plan 0089), grouped behind one boundary so
 * nothing else in Luna Shopper learns what their JSON looks like.
 *
 * Framework free by hard constraint: no TypeORM entity, no repository, no Nest
 * decorator, no `Item`, no `SupermarketItem`, no database. It depends on
 * `contracts` for the two enums it maps onto, and on nothing else.
 *
 * **What this source gives that the other two do not**: an EAN-13 on most
 * products, a price with a validity window, and 730 shops each naming the price
 * region it belongs to. **What it does not give is a catalog**: the site
 * publishes the week's assortment, so a run is a snapshot and the catalog is
 * built by running every week.
 */

export { LidlClient, LidlHttpError } from './lib/lidl.client';
export {
  categoryPathOf,
  isGroceryCategory,
  LIDL_CATEGORY_MAP,
  resolveCategory,
} from './lib/categories';
export {
  normalizeListPage,
  normalizeListRow,
  normalizeProduct,
  normalizeRegionPrices,
  normalizeStore,
  normalizeStorePage,
  openingHoursLine,
} from './lib/normalize';
export type {
  LidlListPage,
  LidlStorePage,
  NormalizeProductOptions,
} from './lib/normalize';
export { parseSize } from './lib/size';
export type { LidlSize } from './lib/size';
export {
  LIDL_BASE_URL,
  LIDL_GROCERY_CATEGORIES,
  LIDL_PUBLIC_STORES_API_KEY,
  LIDL_STORES_URL,
} from './lib/types';
export type {
  LidlClientOptions,
  LidlListRow,
  LidlProduct,
  LidlRegion,
  LidlRegionPrice,
  LidlStore,
} from './lib/types';
