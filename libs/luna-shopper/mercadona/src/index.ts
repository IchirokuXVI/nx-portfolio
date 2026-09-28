/**
 * Mercadona's storefront API (plan 0038, section 3.1), grouped behind one
 * boundary so nothing else in Luna Shopper learns what its JSON looks like.
 *
 * Framework free by hard constraint: no TypeORM entity, no repository, no Nest
 * decorator, no `Item`, no `SupermarketItem`, no database. It depends on
 * `contracts` for the unit enum and the pack count rule, and on nothing else.
 * A category is answered as a slug of the taxonomy (plan 0166), never an id.
 */

export {
  CHEESE_CATEGORY_IDS,
  MERCADONA_CATEGORY_TABLE,
  mercadonaCategorySlugs,
  resolveCategory,
} from './lib/categories';
export type {
  CategoryPathNode,
  MercadonaSectionMapping,
} from './lib/categories';
export {
  MERCADONA_BASE_URL,
  MercadonaClient,
  MercadonaHttpError,
} from './lib/mercadona.client';
export type {
  ListStoresOptions,
  ResolveWarehouseOptions,
} from './lib/mercadona.client';
export {
  normalizeCategories,
  normalizeCategoryProducts,
  normalizeProduct,
  unavailableProduct,
} from './lib/normalize';
export type { NormalizeProductOptions } from './lib/normalize';
export {
  MERCADONA_STORES_TOTAL_URL,
  MERCADONA_STORES_URL,
  openingHoursLine,
  parseStoreDocument,
  parseStoreTotals,
} from './lib/stores';
export type { MercadonaStore, MercadonaStoreList } from './lib/stores';
export type {
  MercadonaCategory,
  MercadonaClientOptions,
  MercadonaLang,
  MercadonaListProduct,
  MercadonaProduct,
} from './lib/types';
export { isImportableSizeFormat, mapSizeFormat } from './lib/units';
