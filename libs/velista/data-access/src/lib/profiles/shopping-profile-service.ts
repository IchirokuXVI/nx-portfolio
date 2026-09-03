import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  AddPostalCodeRequest,
  CatalogScope,
  ProfileGenerationScope,
  ResolvedPostalCode,
  ShoppingProfile,
  Supermarket,
  WriteShoppingProfileRequest,
} from '@portfolio/velista/models';
import { ShoppingProfileApi } from './shopping-profile-api';

/**
 * Where the caller shops, and what the catalog makes of it (plan 0046, section 5).
 *
 * Nine methods over two services, and they are on one interface because they are one
 * screen's needs rather than one backend's shape: the profile routes reach core and the
 * two catalog reads reach catalog, but a page that could list profiles and not name a
 * chain would be a page with an empty supermarket list.
 *
 * Like `AccountServiceI`, **no method takes a user id**. Every profile route resolves
 * the caller from their own token, so there is no id to send and no way to address
 * anybody else's profiles.
 */
export interface ShoppingProfileServiceI {
  /**
   * Every profile the caller has, in the order the selector shows them
   * (`GET /v1/account/shopping-profiles`).
   *
   * **The first call creates the default one** (backend `0049` section 1.3), so a
   * brand new account reads one profile rather than none, with a null name the client
   * renders as its localized default. There is no create-on-first-visit step in this
   * app because there is no moment at which the list is empty.
   */
  listProfiles(): Promise<readonly ShoppingProfile[]>;

  /**
   * What one profile draws from, and **nothing else about it** (plan 0049, section 3).
   *
   * The same `GET /v1/account/shopping-profiles` the listing reads, mapped by a second
   * mapper into a second type. That looks redundant and is the point: the profiles page
   * holds a {@link ShoppingProfile} and saves it, `PATCH` treats a present collection
   * as a full replacement, and a `generationSources` riding along on that object would
   * one day be sent back empty and silently erase somebody's stored scope. Splitting
   * the read is what makes that impossible rather than merely unlikely.
   *
   * Null for a profile the caller does not have, which is a stale id and not a failure:
   * the generation sheet falls back to prechecking everything, which is what somebody
   * who has never narrowed anything means anyway.
   */
  readGenerationScope(
    profileId: string
  ): Promise<ProfileGenerationScope | null>;

  /**
   * Mint a profile (`POST /v1/account/shopping-profiles`).
   *
   * Never the default one: a new profile takes its place at the end of the list, and
   * moving the default is {@link makeDefault}.
   */
  createProfile(body: WriteShoppingProfileRequest): Promise<ShoppingProfile>;

  /**
   * Edit one (`PATCH /v1/account/shopping-profiles/:id`).
   *
   * `supermarkets` is a **full replacement**, which is what the chain list does anyway:
   * it holds every chain in the catalog and states an opinion about each. The postal
   * codes are not here at all, for the reason on {@link WriteShoppingProfileRequest}.
   */
  updateProfile(
    profileId: string,
    body: WriteShoppingProfileRequest
  ): Promise<ShoppingProfile>;

  /**
   * Add one postal code, and optionally its neighbours
   * (`POST /v1/account/shopping-profiles/:id/postal-codes`).
   *
   * One row at a time, because a profile's codes are no longer all the user's: the
   * derived ones are the server's, this app never states them, and so it cannot lose
   * them by omission or promote them by echoing them back.
   *
   * Answers the **whole profile**, because one add writes several rows: the code, and
   * with `expandNearby` its neighbours. That is also how the screen knows how many
   * arrived, without a second read.
   */
  addPostalCode(
    profileId: string,
    body: AddPostalCodeRequest
  ): Promise<ShoppingProfile>;

  /**
   * Remove one postal code, whoever it belongs to
   * (`DELETE /v1/account/shopping-profiles/:id/postal-codes/:postalCode`).
   *
   * **The code, not the row id**, and no argument saying how. A code the user gave is
   * deleted; a derived one is suppressed so the server's recompute cannot put it
   * straight back. Which happens follows from the row's own source, which the server
   * knows and this app should not have to.
   */
  removePostalCode(
    profileId: string,
    postalCode: string
  ): Promise<ShoppingProfile>;

  /**
   * Turn a point the device reported into a postal code
   * (`POST /v1/account/postal-code-lookups`, plan 0058 section 3.3).
   *
   * **The only call in this app that carries a location, and it stores nothing.** The
   * point goes out once and a code comes back; the code is what the confirm writes,
   * through {@link addPostalCode} with `source: 'DEVICE'`. Nothing keeps the
   * coordinates, which is what lets the sheet promise as much before the browser's own
   * permission dialog appears.
   *
   * A null `postalCode` on the answer is not a failure: the server holds centroids
   * rather than boundaries and declines to guess across too great a distance.
   */
  resolvePostalCode(
    latitude: number,
    longitude: number
  ): Promise<ResolvedPostalCode>;

  /** Move the default (`POST /v1/account/shopping-profiles/:id/default`). */
  makeDefault(profileId: string): Promise<ShoppingProfile>;

  /**
   * Delete one (`DELETE /v1/account/shopping-profiles/:id`).
   *
   * The **last** profile cannot be deleted, which the server answers as a conflict.
   * The page never asks: with one profile it draws no trash at all (plan 0046,
   * section 3.2), because a control you may not use is not drawn.
   */
  deleteProfile(profileId: string): Promise<void>;

  /**
   * Every chain in the catalog, unscoped by design (`GET /v1/catalog/supermarkets`).
   *
   * Unscoped because this listing is how a profile gets filled in at all: scoping it to
   * where the caller already shops would offer them only the chains they had already
   * chosen (backend `0049` section 3).
   */
  listSupermarkets(): Promise<readonly Supermarket[]>;

  /**
   * What the caller's postal codes resolve to today (`GET /v1/catalog/scope`).
   *
   * The only way to learn that nobody we know serves a code. It is asked **for** a
   * profile rather than for the caller's default, because the page edits whichever
   * profile is selected and the flag under a chip has to be about that one.
   */
  describeScope(profileId: string): Promise<CatalogScope>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, matching `ACCOUNT_SERVICE` and `ZONE_SERVICE` for
 * the reason recorded there: a wrong default that quietly works is worse than one that
 * fails loudly.
 */
export const SHOPPING_PROFILE_SERVICE = serviceToken<ShoppingProfileServiceI>(
  'SHOPPING_PROFILE_SERVICE',
  () => inject(ShoppingProfileApi)
);
