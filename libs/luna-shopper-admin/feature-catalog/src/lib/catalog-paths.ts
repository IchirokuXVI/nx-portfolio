/**
 * Where the back office reads and writes the catalog (backend plan 0073).
 *
 * In one file because half of them are addressed under another: a chain's shops
 * live under the chain and a shop lives on its own, and two descriptors that
 * each wrote out their own copy of the first path would eventually disagree
 * about it.
 *
 * `supermarket-items` is the one on `/v2`, and the version did not move with
 * the path: it describes the payload's shape, which is unrelated to who may
 * send it.
 */

const CATALOG = '/v1/admin/catalog';

export const SUPERMARKETS_PATH = `${CATALOG}/supermarkets`;
export const LOCATIONS_PATH = `${CATALOG}/locations`;
export const PRICE_SCOPES_PATH = `${CATALOG}/price-scopes`;
export const ITEMS_PATH = `${CATALOG}/items`;
export const PRODUCT_GROUPS_PATH = `${CATALOG}/product-groups`;
export const LOCATION_ITEMS_PATH = `${CATALOG}/location-items`;
export const PRICES_PATH = '/v2/admin/catalog/supermarket-items';

/** One chain's shops, which is the only route that lists or creates them. */
export function locationsOfPath(supermarketId: string): string {
  return `${SUPERMARKETS_PATH}/${encodeURIComponent(supermarketId)}/locations`;
}
