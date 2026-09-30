import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { ShopMapRead } from '@portfolio/velista/models';
import { ShopMapApi } from './shop-map-api';

/**
 * A shop's map, the one every shopper sees (velista `0121`; backend `0168`).
 *
 * `GET /v1/catalog/locations/:id/map`, which **takes no account**, so a guest on
 * a shared basket reads the same map the owner does. Bound apart from everything
 * else so a map that does not answer costs the map page and nothing more.
 */
export interface ShopMapServiceI {
  /**
   * The shop's map, `none` for a shop with no map (or one the catalog does not
   * know, which has none either), and `failed` for a read that did not answer or a
   * map that could not be drawn. **Never throws.**
   */
  map(locationId: string): Promise<ShopMapRead>;
}

/**
 * Inject this, typed as the interface, never a concrete class. The fake is asked
 * for by name with `{ provide: SHOP_MAP_SERVICE, useExisting: ShopMapMemory }`.
 */
export const SHOP_MAP_SERVICE = serviceToken<ShopMapServiceI>(
  'SHOP_MAP_SERVICE',
  () => inject(ShopMapApi)
);
