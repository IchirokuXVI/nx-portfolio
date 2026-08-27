import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  ListOrder,
  Page,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import { ListApi } from './list-api';

/**
 * The lists inside a zone.
 *
 * Only the two operations the group page needs. Renaming, sharing and deleting a list
 * belong with the list screen, where the list is the subject rather than a row
 * (plan 0010, section 9), and adding them here before there is a screen for them would
 * be an interface written against a guess.
 *
 * **`list` is filtered by the caller, not by the zone.** Core returns every list to a
 * manager and only the ones they created or were granted to anybody else, so two people
 * can open the same group and correctly see different numbers. Nothing above this may
 * phrase a count as a fact about the group (section 5.5).
 */
export interface ListServiceI {
  /** A zone's lists, as far as this caller may read them (`GET /v1/zones/:id/lists`). */
  listLists(
    zoneId: string,
    options?: { cursor?: string; limit?: number; order?: ListOrder }
  ): Promise<Page<ShoppingListSummary>>;

  /**
   * Start a list (`POST /v1/zones/:id/lists`).
   *
   * **Any APPROVED member may**, which is why the empty state's primary is offered to
   * a plain member too. The creator is given WRITER access to what they made.
   */
  createList(zoneId: string, name: string): Promise<ShoppingListSummary>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, for the reason `ZONE_SERVICE` gives at length: a
 * token that falls back to fixtures serves invented data while looking like a backend.
 * The fake is asked for by name.
 */
export const LIST_SERVICE = serviceToken<ListServiceI>('LIST_SERVICE', () =>
  inject(ListApi)
);
