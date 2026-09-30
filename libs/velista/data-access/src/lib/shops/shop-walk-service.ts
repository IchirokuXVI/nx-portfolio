import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  AppendShopWalkEntryRequest,
  ShopWalkAppendResult,
  ShopWalkDetail,
  ShopWalkLog,
  ShopWalkSummary,
  UpdateShopWalkRequest,
} from '@portfolio/velista/models';
import { ShopWalkApi } from './shop-walk-api';

/** A shop's walks: the list, `missing` for a shop nobody knows, or no answer. */
export type ShopWalkListRead =
  | { readonly kind: 'walks'; readonly walks: readonly ShopWalkSummary[] }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' };

/** One walk with its document and timeline, `missing` for a deleted or unknown one. */
export type ShopWalkRead =
  | { readonly kind: 'walk'; readonly detail: ShopWalkDetail }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' };

/** One walk's log with its events. */
export type ShopWalkLogRead =
  | { readonly kind: 'log'; readonly log: ShopWalkLog }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' };

/**
 * The walks of a shop and their logs (velista `0122`; backend `0168`). Every route
 * takes the `shopMap.record` permission.
 *
 * Reads answer a union and **never throw**. Writes throw a `GatewayError`, which
 * `ShopWalksStore` runs through `Mutations`, and a `walk_changed` refusal carries
 * `details.lastSeq`.
 */
export interface ShopWalkServiceI {
  list(locationId: string): Promise<ShopWalkListRead>;
  walk(walkId: string): Promise<ShopWalkRead>;
  /** The whole log when `fromSeq` is absent or 0, which a rewind preview needs. */
  log(walkId: string, fromSeq?: number): Promise<ShopWalkLogRead>;
  create(locationId: string, name: string): Promise<ShopWalkSummary>;
  update(
    walkId: string,
    change: UpdateShopWalkRequest
  ): Promise<ShopWalkSummary>;
  remove(walkId: string): Promise<void>;
  append(
    walkId: string,
    entry: AppendShopWalkEntryRequest
  ): Promise<ShopWalkAppendResult>;
}

/**
 * Inject this, typed as the interface. The fake is asked for by name with
 * `{ provide: SHOP_WALK_SERVICE, useExisting: ShopWalkMemory }`.
 */
export const SHOP_WALK_SERVICE = serviceToken<ShopWalkServiceI>(
  'SHOP_WALK_SERVICE',
  () => inject(ShopWalkApi)
);
