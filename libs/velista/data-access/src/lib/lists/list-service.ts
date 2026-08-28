import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  ListAccessEntry,
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

  /**
   * Rename a list (`PATCH /v1/lists/:id`).
   *
   * `requireManage`, which is a **different rule** from the write access that gates
   * lines: the list's creator, a zone admin, or the owner. So a WRITER who did not
   * create the list can add to it all day and cannot rename it, and the overflow has to
   * reflect that from the caller's own facts rather than offering a control that fails
   * (rule G2, and section 5.5).
   */
  updateList(listId: string, name: string): Promise<ShoppingListSummary>;

  /** Delete a list, and every line on it, for everybody. `requireManage`. */
  deleteList(listId: string): Promise<string>;

  /**
   * Replace who can read and write this list (`PUT /v1/lists/:id/access`).
   *
   * **It replaces the whole set.** Anybody the payload omits loses their access, which
   * is why {@link getListAccess} has to exist before this can be called from a real
   * sheet: sending a complete set built from ignorance silently revokes people the
   * caller never saw (section 5.5).
   */
  setListAccess(
    listId: string,
    entries: readonly ListAccessEntry[]
  ): Promise<ShoppingListSummary>;

  /**
   * Who can read and write this list (`GET /v1/lists/:id/access`).
   *
   * **The endpoint does not exist yet**, which is why this is optional on the interface
   * rather than a method every implementation has to fake. `LIST_ACCESS_READABLE` is
   * the flag that says so, and `ListMemory` implements it so the share sheet is built,
   * drawn and tested now; `ListApi` implements it against the route it will have.
   */
  getListAccess?(listId: string): Promise<readonly ListAccessEntry[]>;
}

/**
 * Whether the gateway serves the list access read yet.
 *
 * Plan 0012 section 5.6 item 3, and the only one of the five that blocks anything. Until
 * it lands there is no `GET /v1/lists/:id/access`, so the share sheet is **built and
 * not offered**: the row is absent from the list settings sheet, and everything else in
 * that sheet, rename and delete, ships.
 *
 * The reason it blocks rather than degrades is that `PUT` replaces the entire access
 * set. A sheet that cannot read the current set can only guess at it, and a wrong guess
 * does not fail loudly, it quietly takes other people's access away. There is no
 * partial version of this that is honest.
 *
 * A constant rather than a runtime probe, for the reason `VERIFY_RESEND_AVAILABLE`
 * gives: nothing is discoverable at runtime that is not already known at build time.
 * Flipping it to `true` is the whole of the frontend work when the endpoint ships.
 */
export const LIST_ACCESS_READABLE = false;

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
