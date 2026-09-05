import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import { DirectoryMemory } from './directory-memory';

/**
 * The things an operator can do to a person or a household that are not a field
 * (plan 0007, section 1, widened by plan 0009).
 *
 * **Named acts and not a row editor.** A catalog item's name is a name, and
 * writing it is safe and complete. A list line participates in settlements,
 * generated list bindings, permission sets and realtime broadcasts other
 * clients have already applied, and deleting a user runs
 * `account-deletion.service` across three databases. The invariants live in
 * services rather than in constraints, so each of these calls the same service
 * the user facing app calls and none of them writes a row.
 *
 * Plan 0009 made most of those rows editable through the generic form, and the
 * ones that stayed here are the ones that are still not fields. Each of them
 * does more than write a column: a zone's deletion mark is two columns written
 * together, a membership's status is four verbs along a state machine, and a
 * line's approval is a service call that emits.
 *
 * An action with no service behind it is not here. If an operator needs
 * something this interface does not offer, it is a backend plan and not a form
 * (plan 0007, section 1).
 */
export interface DirectoryServiceI {
  /**
   * Delete somebody's account, and everything the cascade takes with it.
   *
   * Idempotent at the gateway: a second call answers that nothing was deleted
   * rather than failing, because an operator who clicked twice has not made a
   * mistake worth an error.
   */
  deleteUser(userId: string): Promise<void>;

  /**
   * Send the confirmation mail again, past the throttle the user's own route
   * carries.
   *
   * `locale` is the language of the mail. Absent means the request's own, which
   * is what an operator resending on somebody's behalf usually wants least, so
   * the screen offers it.
   */
  resendVerification(userId: string, locale?: string): Promise<void>;

  /** Delete a zone, through the reaper that owns what deleting one means. */
  deleteZone(zoneId: string): Promise<void>;

  /** Mint a new join code, and answer with it. */
  regenerateJoinCode(zoneId: string): Promise<string>;

  /**
   * Hand the zone to one of its members.
   *
   * The outgoing owner is found rather than named, and may be nobody: a zone
   * whose owner deleted their account is ownerless, and rescuing exactly that
   * zone is what this is most useful for.
   */
  transferOwnership(zoneId: string, membershipId: string): Promise<void>;

  /** Remove a member from a zone. They can be invited back. */
  kickMember(zoneId: string, membershipId: string): Promise<void>;

  /** Remove a member and refuse them the join code. */
  banMember(zoneId: string, membershipId: string): Promise<void>;

  /**
   * Mark a zone for deletion, or take the mark off again.
   *
   * One method for both directions, because `status` and `markedForDeletionAt`
   * are written and read together and typing either alone produces a zone the
   * reaper either never removes or removes anyway. Neither state is reachable
   * through any other code path and neither has a repair, which is why this is
   * an act rather than two fields (backend plan 0077, section 4.2).
   */
  setZoneDeletionMark(zoneId: string, marked: boolean): Promise<void>;

  /**
   * Let a waiting member in.
   *
   * `approvedByUserId` is left null, and the column stays nullable for exactly
   * this: an operator is not a member of the zone, so there is no membership id
   * to record, and every other reader treats that column as a user's id.
   */
  approveMember(zoneId: string, membershipId: string): Promise<void>;

  /** Refuse a waiting member, which removes the pending row. */
  rejectMember(zoneId: string, membershipId: string): Promise<void>;

  /**
   * Approve or reject one line of a standing list.
   *
   * One route and one service call, which is why it is an act rather than a
   * select on the form: an act can be confirmed and a select cannot.
   */
  setLineApproval(
    listId: string,
    lineId: string,
    status: LineApproval
  ): Promise<void>;
}

/** Where a line is in its approval, which is the whole of `LineApprovalStatus`. */
export type LineApproval = 'PENDING' | 'APPROVED' | 'REJECTED';

// Inject THIS token, typed as the interface, never the concrete class.
export const DIRECTORY_SERVICE = serviceToken<DirectoryServiceI>(
  'DIRECTORY_SERVICE',
  () => inject(DirectoryMemory)
);
