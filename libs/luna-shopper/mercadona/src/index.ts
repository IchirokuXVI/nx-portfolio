/**
 * Mercadona's storefront API (plan 0038, section 3.1), grouped behind one
 * boundary so nothing else in Luna Shopper learns what its JSON looks like.
 *
 * Framework free by hard constraint: no TypeORM entity, no repository, no Nest
 * decorator, no `Item`, no `SupermarketItem`, no database. It depends on
 * `contracts` for the two enums it maps onto, and on nothing else.
 */

export {
  MERCADONA_BASE_URL,
  MercadonaClient,
  MercadonaHttpError,
} from './lib/mercadona.client';
export {
  CHEESE_CATEGORY_IDS,
  MERCADONA_ROOT_CATEGORY_MAP,
  resolveCategory,
} from './lib/categories';
export type { CategoryPathNode } from './lib/categories';
export {
  normalizeCategories,
  normalizeCategoryProducts,
  normalizeProduct,
  unavailableProduct,
} from './lib/normalize';
export type { NormalizeProductOptions } from './lib/normalize';
export { isImportableSizeFormat, mapSizeFormat } from './lib/units';
export type {
  MercadonaCategory,
  MercadonaClientOptions,
  MercadonaLang,
  MercadonaListProduct,
  MercadonaProduct,
} from './lib/types';
