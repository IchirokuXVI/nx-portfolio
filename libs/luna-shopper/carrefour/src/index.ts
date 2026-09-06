/**
 * Carrefour's grocery storefront (plan 0090), grouped behind one boundary so
 * nothing else in Luna Shopper learns what its pages look like.
 *
 * Framework free in every way except one: no TypeORM entity, no repository, no
 * Nest decorator, no `Item`, no `SupermarketItem`, no database, and every test
 * runs against checked in fixtures with no network and no browser. **The one
 * exception is Playwright**, and it is forced rather than chosen: Cloudflare
 * refuses every other client this workspace owns on the TLS handshake, which
 * `carrefour.client.ts` records in full.
 *
 * It depends on nothing else in the workspace, not even on `contracts`. The
 * harvester maps what this hands out onto rows, and it owns `normalizeName`,
 * which is deliberately not copied here: a second copy beside a second source
 * is how two keys start disagreeing.
 */

export {
  CarrefourClient,
  dropCloudflareCookies,
  isCloudflareCookie,
  type CarrefourCookieJar,
} from './lib/carrefour.client';
export {
  categoryIdFromUrl,
  isWalkableCategory,
  listingPath,
  pagesFor,
  walkFrontier,
  type CarrefourCappedCategory,
  type CarrefourFrontier,
} from './lib/categories';
export {
  CarrefourBlockedError,
  CarrefourBrowserError,
  CarrefourHttpError,
  isSkippable,
} from './lib/errors';
export { readCard, readCards, splitCardName } from './lib/listing';
export type { SplitCardName } from './lib/listing';
export { priceToCents, unitPriceLabel } from './lib/price';
export { readDetail, readListing } from './lib/state';
export {
  CARREFOUR_CEILING,
  CARREFOUR_MIN_DELAY_MS,
  CARREFOUR_ORIGIN,
  CARREFOUR_PAGE_SIZE,
  CARREFOUR_STOREFRONT_PATH,
} from './lib/types';
export type {
  CarrefourCard,
  CarrefourCategory,
  CarrefourCategoryLink,
  CarrefourClientOptions,
  CarrefourDetail,
  CarrefourListing,
  CarrefourProduct,
  CarrefourStateLoader,
} from './lib/types';
