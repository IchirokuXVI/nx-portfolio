/**
 * DEZA's product listing (plan 0085), grouped behind one boundary so nothing
 * else in Luna Shopper learns what its markup looks like.
 *
 * Framework free by hard constraint: no TypeORM entity, no repository, no Nest
 * decorator, no `Item`, no `SupermarketItem`, no database, and every test runs
 * against checked in fixtures with no network.
 *
 * It depends on almost nothing: `contracts` for one size unit type, and
 * `source-guard` for the run's refusal guard (plan 0215). There is no enum to
 * map onto here: the source states no price, no EAN and no product id, and the
 * one identity it could offer is a description. `normalizeName` is deliberately
 * absent too, because the harvester's `matching.ts` owns it and a second copy
 * beside a second source is how two keys start disagreeing.
 */

export { extractBrand } from './lib/brand';
export {
  DEZA_BASE_URL,
  DEZA_PRODUCTS_PATH,
  DEZA_REFUSAL_POLICY,
  DezaClient,
  DezaHttpError,
} from './lib/deza.client';
export {
  DEZA_CEILING_PAGES,
  DEZA_PAGE_SIZE,
  parseLastPage,
  parseProductPage,
  parseRows,
} from './lib/rows';
export { leafSections, parseSectionTree } from './lib/sections';
export { DEZA_SIZE_UNITS, packCountIn, sizeOf, splitSize } from './lib/size';
export type { SplitDescription } from './lib/size';
export type {
  DezaClientOptions,
  DezaPage,
  DezaProductRow,
  DezaQuery,
  DezaSection,
  DezaShop,
} from './lib/types';
// A probe per chain checks the storefront shape (plan 0219).
export { probeDeza } from './lib/probe';
export type { DezaProbeOptions } from './lib/probe';
// The chain's own shop list (plan 0222).
export { DEZA_SHOPS_PATH, DezaShopPageRefusedError } from './lib/deza.client';
export {
  DEZA_SHOP_LINK_TEXT,
  parseShopDirectory,
  parseShopPage,
  readShopCode,
} from './lib/shops';
export type {
  DezaCodeOutcome,
  DezaDirectory,
  DezaDirectoryEntry,
  DezaShopPage,
} from './lib/types';
