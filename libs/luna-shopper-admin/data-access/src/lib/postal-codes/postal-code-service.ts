import { inject } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { PostalCodeMemory } from './postal-code-memory';

/**
 * What catalog and core know about a postal code (backend plan 0097).
 *
 * One interface over two backends, and the reason is the subject rather than
 * convenience: the postal code is the only thing in this product that all three
 * services have an opinion about, and the screen that shows one is three panels
 * asking three of them. The harvester's half stays on {@link HarvestServiceI},
 * because those routes are the queue itself; these two are what the queue's rows
 * mean to everybody else.
 *
 * **Every method here is a decoration**, and plan 0074 section 3's rule comes
 * with that: where one of them fails, the screen renders without it and never
 * fails the listing. None of these answers is the reason a page exists.
 */
export interface PostalCodeServiceI {
  /**
   * How many profiles and users are waiting on each of these codes.
   *
   * **A page of codes in one call**, never one call per row. The list screen
   * decorates a page of rows and a fan out of twenty five requests to put one
   * number in one column is not a decoration, it is a load.
   *
   * Every code asked about is in the answer, including the ones nobody uses: a
   * missing entry and a zero read the same and neither says which.
   */
  usage(
    country: string,
    postalCodes: readonly string[]
  ): Promise<Wire.AdminCorePostalCodeUsageListView>;

  /**
   * The neighbours of one code, nearest first.
   *
   * Centroid to centroid, so two adjacent codes whose centres sit further apart
   * than the radius are neighbours in reality and not here. `known` is what
   * separates "nothing within range" from "we have no idea where this is", and
   * the screen says which.
   */
  nearby(
    country: string,
    postalCode: string,
    radiusMetres?: number
  ): Promise<Wire.CatalogNearbyPostalCodesView>;

  /**
   * The shipped centroid row for one code, or `null` when the table has none.
   *
   * It carries `locationCount`, which is the number that decides whether velista
   * shows a shopper anything at all: places the harvester found are candidates,
   * and shops catalog holds are what a user is offered.
   *
   * Read through the listing's prefix filter, because the shipped table has no
   * member route. An exact match is picked out of the page rather than assumed
   * to be the first row.
   */
  shipped(
    country: string,
    postalCode: string
  ): Promise<Wire.CatalogAdminPostalCodeView | null>;
}

/**
 * Inject THIS token, never a concrete class.
 *
 * The default is the in-memory implementation, so a spec and a run with nothing
 * listening both work with no configuration. `app-providers.ts` binds the HTTP
 * one beside the `HttpClient` it depends on.
 */
export const POSTAL_CODE_SERVICE = serviceToken<PostalCodeServiceI>(
  'POSTAL_CODE_SERVICE',
  () => inject(PostalCodeMemory)
);
