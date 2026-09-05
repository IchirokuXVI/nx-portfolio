import type { ResourceSource } from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  ITEM_PRICE_SEED,
  ITEM_SEED,
  LOCATION_ITEM_SEED,
  LOCATION_SEED,
  PRICE_POLICY_SEED,
  PRICE_SCOPE_SEED,
  PRICE_SEED,
  PRODUCT_GROUP_SEED,
} from './catalog-seed';
import { SUPERMARKETS_PATH } from './supermarkets';

/**
 * Where each catalog resource lives, and how it departs from ordinary CRUD.
 *
 * Here rather than inline in each descriptor, because the price screens need
 * several of them for themselves: to name a scope the form has to read one, to
 * say how many shops share it, it has to count that scope's shops, and the
 * price history page reads the effective row from one path and the rows behind
 * it from another. A second copy of any of these would be a second chance to
 * spell a path wrong, and one of the two copies would be the one nothing
 * exercises.
 *
 * **`/v1/admin/catalog/**` is not uniform CRUD** (backend plan 0073), and five
 * of the resources say so here rather than in a hand written gateway:
 *
 * | Resource        | What is different                                                     |
 * | --------------- | --------------------------------------------------------------------- |
 * | locations       | listed and created under a chain, read and changed at their own path  |
 * | price scopes    | no route reads one by id, so a member is found in the collection      |
 * | prices          | read only, keyed on `(itemId, priceScopeId)`, at v3 (plan 0080)       |
 * | item prices     | inserted and removed, never changed; listed for one (item, scope)     |
 * | price policies  | six rows keyed on their kind, changed with a `PATCH`, never created   |
 * | location items  | one `PUT` for create and change, keyed on `(itemId, supermarketLocationId)`, and no delete |
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
 * Where the back office reads the effective prices (backend plan 0080,
 * section 7): the price a shopper sees, chosen among the rows behind it.
 *
 * `v3`, because the view's meaning changed with the price model beneath it,
 * and two of its fields were renamed so an old build cannot silently read a
 * stale number as fresh (plan 0080, section 11). Nothing writes a price here.
 */
export const PRICES_PATH = '/v3/admin/catalog/supermarket-items';

/**
 * Where the back office reads and writes the rows a source gave (backend plan
 * 0080, section 9). A row is inserted and removed and never edited: editing a
 * price is inserting a price, and the history shows both.
 */
export const ITEM_PRICES_PATH = '/v1/admin/catalog/item-prices';

/** Where the back office reads and changes the six policy rows (plan 0080, section 3). */
export const PRICE_POLICIES_PATH = '/v1/admin/catalog/price-policies';

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
 * Effective prices: read only, and read by the pair.
 *
 * The list takes both halves of the key, so a read is one exact request rather
 * than a walk. There is no write behind this source at all: the row is derived
 * from the item prices, and the descriptor that draws it sends its one write,
 * the add, to {@link itemPriceSource} instead.
 */
export function priceSource(): ResourceSource<Wire.CatalogSupermarketItemView> {
  return {
    path: PRICES_PATH,
    key: [...PRICE_KEY],
    keyFilters: [...PRICE_KEY],
    readVia: 'collection',
    seed: PRICE_SEED,
  };
}

/**
 * The rows a source gave: a `POST` to add one, a `DELETE` by its own uuid to
 * remove one, and a list that takes the (item, scope) it is the history of.
 */
export function itemPriceSource(): ResourceSource<Wire.CatalogItemPriceView> {
  return { path: ITEM_PRICES_PATH, seed: ITEM_PRICE_SEED };
}

/**
 * Policies: six rows keyed on their kind, which is the id the `PATCH` takes.
 * The list is not paged, because six rows do not need a cursor.
 */
export function pricePolicySource(): ResourceSource<Wire.CatalogPricePolicyView> {
  return {
    path: PRICE_POLICIES_PATH,
    idField: 'sourceKind',
    readVia: 'collection',
    page: (body) => ({
      items: ((body as { items?: Wire.CatalogPricePolicyView[] }).items ??
        []) as Wire.CatalogPricePolicyView[],
      nextCursor: null,
    }),
    seed: PRICE_POLICY_SEED,
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
