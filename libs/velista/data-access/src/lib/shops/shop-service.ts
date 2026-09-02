import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  LocationPreference,
  Page,
  Shop,
  ShopChainSummary,
} from '@portfolio/velista/models';
import { ShopApi } from './shop-api';

/** What {@link ShopServiceI.searchShops} may narrow a read by. */
export interface ShopQuery {
  /** Whose postal codes to look in. Never the caller's default: the screen edits one. */
  readonly profileId: string;
  /** One franchise's shops, which is what tapping a franchise button asks for. */
  readonly supermarketId?: string;
  /** A typed word, matched across shop name, chain name, address, city and postal code. */
  readonly query?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * The shops in a profile's postal codes, and what the profile thinks of them
 * (plan 0059; backend plans 0064 and 0068).
 *
 * ## Its own service, beside `ShoppingProfileServiceI` rather than inside it
 *
 * `CatalogServiceI`'s reasoning, one screen along. The profile service carries the six
 * calls the profiles page makes; these three are a second screen's, they are the only
 * reads in the app that page through a table of shops, and the write is a partial one
 * with a shape none of the profile routes share. Binding them apart is what lets them
 * fail apart: a shop listing that does not answer must not be able to take the profiles
 * page with it.
 *
 * ## Every call names a profile, and none names a user
 *
 * The gateway resolves the caller from their own token, so there is no user id to send.
 * The profile id is stated on every call rather than left to the caller's default,
 * because this screen edits **one** profile and the answer has to be about that one:
 * looking as somebody's default while they edit their second profile would draw shops
 * from postal codes that are not on screen.
 *
 * ## The refused come back flagged, always
 *
 * Every read here asks for `includeExcluded`, and the interface does not offer the flag.
 * This is the screen that edits those choices (backend plan 0068, section 6): a row it
 * could not see is a row nobody can switch back on, and every other caller in the app
 * is offering a shop rather than editing an opinion about one.
 */
export interface ShopServiceI {
  /**
   * One row per chain with a shop in the profile's postal codes
   * (`GET /v1/catalog/shops/summary`).
   *
   * Unpaged by the server's design: a country has tens of chains and a neighbourhood a
   * handful plus its independents, so a cursor here is one nobody would pass back.
   *
   * The rows arrive as the catalog counted them, including the keyless ones. Bucketing
   * those into OTHER is the screen's, not this call's: the server reports what it knows
   * and the word OTHER is a client's reading of it (backend plan 0068, section 4).
   */
  summarizeChains(profileId: string): Promise<readonly ShopChainSummary[]>;

  /**
   * A page of shops (`GET /v1/catalog/shops`).
   *
   * A page rather than the whole set, unlike the summary: a dense city holds hundreds of
   * shops in a profile's codes and the screen scrolls them.
   */
  searchShops(query: ShopQuery): Promise<Page<Shop>>;

  /**
   * Say what a profile thinks of one or more shops
   * (`PUT /v1/account/shopping-profiles/:id/locations`).
   *
   * **A partial write.** Shops it does not name keep whatever they had, which is what
   * separates it from the collections on the profile body: a profile can see hundreds of
   * shops, and a replacement would make one toggle send every shop it has ever seen.
   *
   * The answer is the whole profile and nothing here reads it: the store already knows
   * what it toggled, and the shop rows it draws carry their own `excluded` flag.
   */
  setLocationPreferences(
    profileId: string,
    locations: readonly LocationPreference[]
  ): Promise<void>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, matching every other service token in this library
 * for the reason recorded on `ZONE_SERVICE`: a wrong default that quietly works is worse
 * than one that fails loudly.
 */
export const SHOP_SERVICE = serviceToken<ShopServiceI>('SHOP_SERVICE', () =>
  inject(ShopApi)
);
