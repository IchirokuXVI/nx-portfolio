/**
 * DIA's online shop and store finder (plan 0174), grouped behind one boundary
 * so nothing else in Luna Shopper learns what their JSON looks like.
 *
 * Framework free by hard constraint: no TypeORM entity, no repository, no Nest
 * decorator, no database, no HTTP or DOM dependency, and every test runs
 * against checked in fixtures with no network. It depends on no other library.
 * Requests go through Node's global `fetch`, never `node:https`, which Akamai
 * refuses.
 *
 * **Decision D1 (plan 0174, section 2).** This is the one source library that
 * sends an unmodified browser User-Agent, because the site refuses every
 * User-Agent that names us. The headers are one constant,
 * `DIA_BROWSER_HEADERS` in `dia.client.ts`, and they are not an option of the
 * client. The client stays polite in every other way: at most 2 requests per
 * second, and no request the public site does not make itself.
 */

export { DIA_CATEGORY_NAMES, DIA_CATEGORY_SLUGS } from './lib/categories';
export {
  DIA_BASE_URL,
  DIA_BROWSER_HEADERS,
  DiaClient,
  DiaHttpError,
  DiaSessionError,
  DiaStoppedError,
} from './lib/dia.client';
export type { DiaRawResponse } from './lib/dia.client';
export { parseOpeningHours } from './lib/hours';
export type { DiaOpeningHours } from './lib/hours';
export { DIA_PAGE_SIZE, parseListing } from './lib/listing';
export { DIA_OFFERS_CATEGORY_ID, parseMenu } from './lib/menu';
export { DIA_LOYALTY_PROGRAM, regularPrice } from './lib/price';
export type {
  DiaPriceExtra,
  DiaPromotionText,
  DiaRegularPrice,
} from './lib/price';
export { splitSize } from './lib/size';
export type { DiaSize } from './lib/size';
export {
  DIA_DEFAULT_POSTAL_CODE_RADIUS_METRES,
  candidatesNear,
  distanceMetres,
  isTemporarilyClosed,
  parseStoreDetail,
  parseStoreFile,
  parseStoreFileUrl,
} from './lib/stores';
export type {
  DiaClientOptions,
  DiaLeaf,
  DiaListingPage,
  DiaListingRow,
  DiaMenu,
  DiaPromotion,
  DiaRawPrices,
  DiaRoot,
  DiaStore,
  DiaStoreDetail,
  DiaStoreFile,
  DiaStoreRecord,
} from './lib/types';
