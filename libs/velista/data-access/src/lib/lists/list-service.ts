import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  ListAccessEntry,
  ListOrder,
  Page,
  ShoppingListSummary,
  UpdateListRequest,
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
   * **Any APPROVED member may**, which is why the empty state's primary is offered to a
   * plain member too. The creator is given all four permissions on what they made, as an
   * ordinary access row rather than as a property of having created it, which is what
   * lets a group admin later change it (backend plan 0036, section 2.5).
   *
   * `shareWithZone` gives every other approved member READ, WRITE and DECIDE (plan 0024,
   * and backend plan 0036 section 2.6): the group can add lines and can tick them off,
   * and governing the list is the thing the creator kept. False keeps it to its creator
   * until the share sheet says otherwise.
   */
  createList(
    zoneId: string,
    name: string,
    shareWithZone: boolean
  ): Promise<ShoppingListSummary>;

  /**
   * Rename a list, or reconfigure it (`PATCH /v1/lists/:id`).
   *
   * `MANAGE`, which is a **different permission** from the `WRITE` that gates adding a
   * line. So somebody who can add to this list all day still cannot rename it, and the
   * overflow reflects that from `canManage` rather than offering a control that fails
   * (rule G2).
   *
   * A changes object rather than a `name` parameter, matching `LineServiceI.updateLine`
   * and for the same reason: the gateway validates with `forbidNonWhitelisted` and the
   * body carries only the fields it names, so a rename must not be able to carry a
   * setting along with it. `autoApproveLines` is the second field the settings sheet can
   * change (backend plan 0037, section 3).
   */
  updateList(
    listId: string,
    changes: UpdateListRequest
  ): Promise<ShoppingListSummary>;

  /** Delete a list, and every line on it, for everybody. `MANAGE`. */
  deleteList(listId: string): Promise<string>;

  /**
   * Replace what the named memberships may do on this list (`PUT /v1/lists/:id/access`).
   *
   * `MANAGE`. It replaces **each named membership's set outright** and leaves unnamed
   * memberships alone, so it is not a partial update of a set: a share sheet holds the
   * whole answer for a row in front of the person pressing save, and two ways to express
   * one change is two ways to express it wrongly (backend plan 0036, section 5.2).
   *
   * An entry whose `permissions` are **empty deletes the row**, which is how access is
   * revoked. That is why {@link getListAccess} has to exist before this can be called
   * from a real sheet: a complete set built from ignorance quietly takes access away
   * from people the caller never saw.
   *
   * Three refusals come back from the server rather than being pre-empted here: an entry
   * naming group staff, a `MANAGE` change made by somebody who is not group staff, and a
   * caller without `MANAGE` at all. The sheet draws those rows locked so they are not
   * normally reachable, but the rule is the server's.
   */
  setListAccess(
    listId: string,
    entries: readonly ListAccessEntry[]
  ): Promise<ShoppingListSummary>;

  /**
   * What each membership may do on this list (`GET /v1/lists/:id/access`).
   *
   * `MANAGE` only: who else can write to a list is governance, not content, so `READ`
   * does not include it (backend plan 0036, section 4.3).
   *
   * Required on the interface. It was optional for as long as the route did not exist,
   * which was the whole of the reason; now that it does, an implementation of this
   * interface that cannot answer it is one the share sheet cannot use.
   *
   * Stored rows only. Group staff are absent by construction (backend plan 0036,
   * section 2.4) and the sheet adds their rows from `MembershipStore`.
   */
  getListAccess(listId: string): Promise<readonly ListAccessEntry[]>;
}

/**
 * Whether the gateway serves the list access read. It does, since backend plan 0036.
 *
 * `GET /v1/lists/:id/access` was the one item of plan 0012 section 5.6 that blocked
 * anything, and for a real reason: `PUT` replaces the access it is given, so a sheet
 * that cannot read the current set can only guess at it, and a wrong guess does not fail
 * loudly, it quietly takes other people's access away. The share sheet was therefore
 * built, drawn and tested against `ListMemory` and **not offered**, behind this flag.
 *
 * Kept at `true` rather than deleted, which is a judgement worth stating. Deleting it
 * would edit `list-settings-sheet.ts` in the same breath, which belongs to the components
 * half of plan 0030, and it would take with it the one line recording why the sheet spent
 * a release switched off. The cost of keeping it is a constant that is now always true,
 * so it should go when that sheet is next rewritten rather than growing a second reason
 * to exist.
 */
export const LIST_ACCESS_READABLE = true;

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
