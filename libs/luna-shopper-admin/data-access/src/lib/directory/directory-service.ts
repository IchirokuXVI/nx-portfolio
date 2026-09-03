import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import { DirectoryMemory } from './directory-memory';

/**
 * The seven things an operator can do to a person or a household (plan 0007,
 * section 1).
 *
 * **Seven methods and not a row editor.** A catalog item's name is a name, and
 * writing it is safe and complete. A list line participates in settlements,
 * generated list bindings, permission sets and realtime broadcasts other
 * clients have already applied, and deleting a user runs
 * `account-deletion.service` across three databases. The invariants live in
 * services rather than in constraints, so each of these calls the same service
 * the user facing app calls and none of them writes a row.
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
}

// Inject THIS token, typed as the interface, never the concrete class.
export const DIRECTORY_SERVICE = serviceToken<DirectoryServiceI>(
  'DIRECTORY_SERVICE',
  () => inject(DirectoryMemory)
);
