import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  CatalogScope,
  ShoppingProfile,
  Supermarket,
  WriteShoppingProfileRequest,
} from '@portfolio/velista/models';
import { ShoppingProfileApi } from './shopping-profile-api';

/**
 * Where the caller shops, and what the catalog makes of it (plan 0046, section 5).
 *
 * Six methods over two services, and they are on one interface because they are one
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
   * Mint a profile (`POST /v1/account/shopping-profiles`).
   *
   * Never the default one: a new profile takes its place at the end of the list, and
   * moving the default is {@link makeDefault}.
   */
  createProfile(body: WriteShoppingProfileRequest): Promise<ShoppingProfile>;

  /**
   * Edit one (`PATCH /v1/account/shopping-profiles/:id`).
   *
   * The collections are **full replacements**, which is what the page does anyway: it
   * holds the whole list of postal codes and saves it.
   */
  updateProfile(
    profileId: string,
    body: WriteShoppingProfileRequest
  ): Promise<ShoppingProfile>;

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
