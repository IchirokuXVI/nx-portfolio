import type { ResourceSource } from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  ITEM_SEED,
  LOCATION_ITEM_SEED,
  LOCATION_SEED,
  PRICE_SCOPE_SEED,
  PRICE_SEED,
  PRODUCT_GROUP_SEED,
} from './catalog-seed';
import { SUPERMARKETS_PATH } from './supermarkets';

/**
 * Where each catalog resource lives, and how it departs from ordinary CRUD.
 *
 * Here rather than inline in each descriptor, because the price editor needs
 * two of them for itself: to name a scope it has to read one, and to say how
 * many shops share it, it has to count that scope's shops. A second copy of
 * either source would be a second chance to spell a path wrong, and one of the
 * two copies would be the one nothing exercises.
 *
 * **`/v1/admin/catalog/**` is not uniform CRUD** (backend plan 0073), and four
 * of the seven resources say so here rather than in a hand written gateway:
 *
 * | Resource        | What is different                                                     |
 * | --------------- | --------------------------------------------------------------------- |
 * | locations       | listed and created under a chain, read and changed at their own path  |
 * | price scopes    | no route reads one by id, so a member is found in the collection      |
 * | prices          | one `PUT` for create and change, keyed on `(itemId, priceScopeId)`    |
 * | location items  | the same, keyed on `(itemId, supermarketLocationId)`, and no delete   |
 */

/** Where the back office reads and writes shops (backend plan 0073). */
export const LOCATIONS_PATH = '/v1/admin/catalog/locations';

/** Where the back office reads and writes scopes. */
export const PRICE_SCOPES_PATH = '/v1/admin/catalog/price-scopes';

/** Where the back office reads and writes products. */
export const ITEMS_PATH = '/v1/admin/catalog/items';

/** Where the back office reads and writes groups. */
export const PRODUCT_GROUPS_PATH = '/v1/admin/catalog/product-groups';

/**
 * Where the back office reads and writes prices.
 *
 * `v2`, and the version did not move when the path did. It says what shape the
 * payload has, which is unrelated to who may send it.
 */
export const PRICES_PATH = '/v2/admin/catalog/supermarket-items';

/** Where the back office reads and writes the per shop rows. */
export const LOCATION_ITEMS_PATH = '/v1/admin/catalog/location-items';

/** The two columns a price is unique on, and therefore addressed by. */
export const PRICE_KEY = ['itemId', 'priceScopeId'] as const;

/** The two columns a per shop row is unique on. */
export const LOCATION_ITEM_KEY = ['itemId', 'supermarketLocationId'] as const;

/**
 * Shops: two URLs, because the gateway has two.
 *
 * A chain's shops are listed and created at `/supermarkets/{id}/locations`, and
 * one shop is read, changed and deleted at `/locations/{id}`. So the collection
 * is a function of the chain, and until a chain is named there is no collection
 * to ask for.
 */
export function locationSource(): ResourceSource<Wire.CatalogSupermarketLocationView> {
  return {
    path: LOCATIONS_PATH,
    collectionPath: (values) => {
      const supermarketId = values['supermarketId'];
      return typeof supermarketId === 'string' && supermarketId !== ''
        ? `${SUPERMARKETS_PATH}/${encodeURIComponent(supermarketId)}/locations`
        : null;
    },
    // In the path, and therefore not also in the query string or the body.
    // Neither DTO declares it, and the validation pipe refuses a property no
    // DTO declares.
    pathParams: ['supermarketId'],
    seed: LOCATION_SEED,
  };
}

/**
 * Scopes: there is no `GET /price-scopes/{id}`.
 *
 * The gateway has four routes here and reading one row is not among them, so a
 * member is found by reading the collection.
 */
export function priceScopeSource(): ResourceSource<Wire.CatalogPriceScopeView> {
  return {
    path: PRICE_SCOPES_PATH,
    readVia: 'collection',
    seed: PRICE_SCOPE_SEED,
  };
}

export function itemSource(): ResourceSource<Wire.CatalogItemView> {
  return { path: ITEMS_PATH, seed: ITEM_SEED };
}

export function productGroupSource(): ResourceSource<Wire.CatalogProductGroupView> {
  return { path: PRODUCT_GROUPS_PATH, seed: PRODUCT_GROUP_SEED };
}

/**
 * Prices: one `PUT` for both create and change.
 *
 * The upsert **merges** rather than replaces, so a change sends what changed and
 * the columns it leaves out keep their values. The list takes both halves of the
 * key, so a read is one exact request rather than a walk.
 */
export function priceSource(): ResourceSource<Wire.CatalogSupermarketItemView> {
  return {
    path: PRICES_PATH,
    upsert: true,
    key: [...PRICE_KEY],
    keyFilters: [...PRICE_KEY],
    readVia: 'collection',
    seed: PRICE_SEED,
  };
}

/**
 * Per shop rows: the same upsert, and **no delete route at all**.
 *
 * Its list takes the shop and not the product, so a read fetches that shop's
 * rows and finds the product among them. Sending `itemId` as well would be
 * refused rather than ignored.
 */
export function locationItemSource(): ResourceSource<Wire.CatalogSupermarketLocationItemView> {
  return {
    path: LOCATION_ITEMS_PATH,
    upsert: true,
    key: [...LOCATION_ITEM_KEY],
    keyFilters: ['supermarketLocationId'],
    readVia: 'collection',
    seed: LOCATION_ITEM_SEED,
  };
}
