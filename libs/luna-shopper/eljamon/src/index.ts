/**
 * El Jamón's online shop and store locator (plan 0169), grouped behind one
 * boundary so nothing else in Luna Shopper learns what their markup looks like.
 *
 * Framework free by hard constraint: no TypeORM entity, no repository, no Nest
 * decorator, no database, no HTTP or DOM dependency, and every test runs
 * against checked in fixtures with no network. Requests go through Node's own
 * `https`, because the storefront sends an incomplete certificate chain that
 * Node's `fetch` refuses (`transport.ts`).
 *
 * It depends on `contracts` for `packCountOf` alone, as `deza` does, so a pack
 * count means the same thing from every source (plan 0162).
 */

export {
  ELJAMON_BASE_URL,
  ELJAMON_DEFAULT_POSTAL_CODE,
  ELJAMON_LOCATOR_ORIGIN,
  ELJAMON_LOCATOR_RADIUS_KM,
  ELJAMON_LOCATOR_URL,
  ElJamonClient,
  ElJamonHttpError,
  ElJamonSessionError,
} from './lib/eljamon.client';
export {
  ELJAMON_PAGE_SIZE,
  pageCountOf,
  parseListingPage,
  parseTopCategories,
} from './lib/listing';
export { parseSpanishPrice, parseUnitPrice } from './lib/price';
export type { UnitPrice } from './lib/price';
export { parseBreadcrumb, parseProductPage } from './lib/product';
export { splitSize } from './lib/size';
export type { ElJamonSize } from './lib/size';
export { parseLocations, storeRef } from './lib/stores';
export {
  ELJAMON_REQUEST_TIMEOUT_MS,
  ElJamonTimeoutError,
  SECTIGO_EV_R36_PEM,
  createElJamonFetch,
} from './lib/transport';
export type { ElJamonFetchOptions } from './lib/transport';
export type {
  ElJamonCategory,
  ElJamonClientOptions,
  ElJamonDropReason,
  ElJamonDroppedRecord,
  ElJamonListingPage,
  ElJamonListingRow,
  ElJamonProduct,
  ElJamonStore,
  ElJamonStoreList,
} from './lib/types';
