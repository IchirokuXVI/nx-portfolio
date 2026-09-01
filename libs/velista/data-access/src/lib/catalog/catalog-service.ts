import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { CatalogItem, CatalogSuggestion } from '@portfolio/velista/models';
import { CatalogApi } from './catalog-api';

/**
 * What the composer offers after three characters (velista plan 0043, section 6).
 *
 * Its own service rather than a method on `LineServiceI`, because it is a different
 * subject on a different backend: lines live in core and the catalog is its own
 * service with its own database, and a line write must not be able to fail because a
 * product search was unavailable.
 *
 * There is deliberately **no list method here and never will be**. The catalog cannot
 * be listed whole (backend plan 0049): it is hundreds of thousands of products, it is
 * reachable only by search, and an interface offering `list()` would be an invitation
 * to page through it.
 */
export interface CatalogServiceI {
  /**
   * Products and groups matching what somebody is typing.
   *
   * Three rules ride on this call and **none of them is enforced here**, which is the
   * point of the note:
   *
   * - **A group beats an item.** The order is the server's, from
   *   `item.searchOffers`, and is never re-sorted by the client. A client that
   *   re-ranked would be a second opinion about relevance formed without the prices,
   *   the scopes or the synonyms that produced the first one.
   * - **The scope is where you shop.** `profileId` narrows the search to the chains
   *   that profile actually visits, so a product from a shop the user never enters is
   *   not offered. Omitted, the server answers across everything readable, which is
   *   the honest behaviour for somebody who has set no profile up.
   * - **Free text stays first class.** Nothing here is required of the caller: a
   *   composer that submitted without choosing anything adds a plain line, with no
   *   warning and no nagging.
   *
   * Answers an empty list rather than throwing on a query the server refuses. A
   * dropdown is an offer, and an offer that errors is worse than one that is empty.
   */
  suggest(
    query: string,
    options?: { profileId?: string; signal?: AbortSignal }
  ): Promise<readonly CatalogSuggestion[]>;

  /**
   * What the catalog calls a **set** of products (velista plan 0047, section 1).
   *
   * The read the line detail sheet and the line page make. A set rather than one,
   * because a line carries a set: naming five products through the single item route
   * would be five requests fired from a sheet that opens on a tap.
   *
   * Two answers that look alike and are not, which is the whole reason this returns
   * what it does:
   *
   * - **An id that came back with nothing is omitted.** A line outlives a product, so
   *   a withdrawn one is an ordinary thing for a set to contain. The catalog answered;
   *   that product is simply gone, and the screen draws the line with one chip fewer
   *   name.
   * - **A lookup that did not answer is `null`.** Not an empty array. The screen must
   *   be able to say the names could not be loaded, because saying "no products" would
   *   be a claim about the line rather than about the request, and it is the opposite
   *   of the truth.
   *
   * Like {@link suggest} it **fails soft** and never throws: a name lookup must not be
   * able to stop a sheet opening. What differs is only what a failure draws.
   *
   * No `signal`, unlike {@link suggest}, and the absence is deliberate: there is nothing
   * to cancel. A suggestion is superseded by the next keystroke, while a set of names is
   * asked for once per set and its answer is still wanted when it arrives. An option
   * accepted and never honoured is the shape this plan exists to remove.
   */
  itemsByIds(itemIds: readonly string[]): Promise<readonly CatalogItem[] | null>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, matching every other service token in this library
 * and for the reason `ZONE_SERVICE` gives at length: a token that quietly falls back to
 * fixtures serves invented data while looking like a backend. The fake is asked for by
 * name with `{ provide: CATALOG_SERVICE, useExisting: CatalogMemory }`.
 */
export const CATALOG_SERVICE = serviceToken<CatalogServiceI>(
  'CATALOG_SERVICE',
  () => inject(CatalogApi)
);
