import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { ShopDetail } from '@portfolio/velista/models';
import { ShopDetailApi } from './shop-detail-api';

/** How a read of one shop answered: the shop, no such shop, or no answer. */
export type ShopDetailRead =
  | { readonly kind: 'shop'; readonly shop: ShopDetail }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' };

/**
 * One shop, for its own page (velista `0121`, target 2).
 *
 * `GET /v1/catalog/locations/:id` and the chain's name from
 * `GET /v1/catalog/supermarkets/:id`, in one call, because the page draws them
 * together. Its own service, bound apart from `ShopServiceI`, whose every call
 * names a profile: this one names a shop and nobody.
 */
export interface ShopDetailServiceI {
  /** Never throws. A chain read that fails costs the chain's name and nothing else. */
  location(locationId: string): Promise<ShopDetailRead>;
}

/**
 * Inject this, typed as the interface, never a concrete class. The fake is asked
 * for by name with `{ provide: SHOP_DETAIL_SERVICE, useExisting: ShopDetailMemory }`.
 */
export const SHOP_DETAIL_SERVICE = serviceToken<ShopDetailServiceI>(
  'SHOP_DETAIL_SERVICE',
  () => inject(ShopDetailApi)
);
