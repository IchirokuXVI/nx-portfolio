import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { NearbyShops, RecentShop } from '@portfolio/velista/models';
import { ShopFinderApi } from './shop-finder-api';

/**
 * A point the device reported, as the two nearby routes take it (backend `0164`).
 *
 * **It travels in one request body and is kept nowhere**, on either side: not in a
 * signal, not in storage, not in a log line (velista `0058`, section 3.3; `0103`).
 * Whoever holds one holds it for the length of one call.
 */
export interface NearbyPoint {
  readonly latitude: number;
  readonly longitude: number;
  /** The radius in metres the device is sure of. Over 150 the server picks nothing. */
  readonly accuracyMetres: number;
}

/**
 * The shops near a point and the shops this person bought at (velista `0103`).
 *
 * Its own service rather than three more calls on the basket and shop services,
 * for the reason every service here is bound apart: they fail apart. A nearby
 * lookup that does not answer costs one line in the picker and must not be able
 * to take the basket read or the supermarkets page with it.
 */
export interface ShopFinderServiceI {
  /**
   * The shops near a point, judged against the basket's pricing profile
   * (`POST /v1/baskets/:id/shops/nearby`). Any participant, a guest included.
   */
  nearBasket(basketId: string, point: NearbyPoint): Promise<NearbyShops>;

  /**
   * The shops near a point, judged against a profile of the caller's
   * (`POST /v1/catalog/shops/nearby`). Signed in only: the get a list sheet,
   * before any basket exists.
   */
  nearProfile(point: NearbyPoint, profileId?: string): Promise<NearbyShops>;

  /**
   * Where the caller bought in the last 60 days, newest first
   * (`GET /v1/account/recent-shops`). Signed in only; a guest is never asked.
   */
  recentShops(): Promise<readonly RecentShop[]>;
}

/** Inject this, typed as the interface. The default is the real gateway. */
export const SHOP_FINDER_SERVICE = serviceToken<ShopFinderServiceI>(
  'SHOP_FINDER_SERVICE',
  () => inject(ShopFinderApi)
);
