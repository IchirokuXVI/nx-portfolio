import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { ShopSections } from '@portfolio/velista/models';
import { ShopSectionsApi } from './shop-sections-api';

/**
 * A shop's sections, the aisles it is walked in (velista `0120`, backend `0167`).
 *
 * ## Its own service
 *
 * Bound apart from `ShopServiceI`, whose every call names a profile: this read names a
 * shop and nobody, and it **takes no account**, so a guest on a shared basket at a
 * shop reads the same aisles the owner does. It fails apart from everything else
 * too: aisles that do not answer draw the basket by category, as it was drawn before
 * anyone configured a shop.
 */
export interface ShopSectionsServiceI {
  /**
   * `GET /v1/catalog/locations/:id/sections`: the shop's sections in its order.
   *
   * An empty list for a shop the catalog does not know, which is a fact about the
   * shop and not worth asking again. `null` for a read that did not answer, and
   * **never throws**: nothing waits on this.
   */
  sections(locationId: string): Promise<ShopSections | null>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, for the reason recorded on `ZONE_SERVICE`. The
 * fake is asked for by name with
 * `{ provide: SHOP_SECTIONS_SERVICE, useExisting: ShopSectionsMemory }`.
 */
export const SHOP_SECTIONS_SERVICE = serviceToken<ShopSectionsServiceI>(
  'SHOP_SECTIONS_SERVICE',
  () => inject(ShopSectionsApi)
);
