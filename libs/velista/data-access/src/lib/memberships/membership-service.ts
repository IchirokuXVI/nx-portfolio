import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  MemberOrder,
  Membership,
  MembershipStatus,
  Page,
  Zone,
} from '@portfolio/velista/models';
import { MembershipApi } from './membership-api';

/**
 * Who is in a zone, and everything staff may do about it.
 *
 * Split from `ZoneServiceI` rather than added to it, and the line between the two is
 * the record each one is about: `ZoneServiceI` is operations on **the zone**, this is
 * operations on **a membership**. Transfer of ownership is the one that has to pick a
 * side, and it is here, because it is addressed by membership id and the caller always
 * reaches it from a member's row.
 *
 * Every method returns a promise for `ZoneServiceI`'s reason: these are one-shot
 * requests, and the live half of the data arrives through `REALTIME_CLIENT`.
 *
 * **The role a member can be set to is not `ZoneRole`.** `SetRoleDto` accepts ADMIN and
 * MEMBER only, so ownership cannot be handed over through this route, and the type says
 * so rather than letting a caller build a request the gateway will refuse
 * (plan 0010, section 5.6).
 */
export type AssignableRole = 'ADMIN' | 'MEMBER';

export interface MembershipServiceI {
  /**
   * The zone's members (`GET /v1/zones/:id/members`).
   *
   * `statuses` defaults to APPROVED on the server, and **any other value is staff
   * only**: asking for PENDING as an ordinary member is a `forbidden`, not an empty
   * page. The members screen therefore asks for the pending ones only when `myRole`
   * already says it may (rule G2 and section 5.4).
   */
  listMembers(
    zoneId: string,
    options?: {
      statuses?: readonly MembershipStatus[];
      cursor?: string;
      limit?: number;
      order?: MemberOrder;
    }
  ): Promise<Page<Membership>>;

  /**
   * Let somebody in (`POST /v1/zones/:id/members/:mid/approve`).
   *
   * Refused with `validation_failed` when the membership is no longer PENDING, which
   * is what happens when a second admin answered first. That is not an error the
   * caller should be shown (section 5.6).
   */
  approve(zoneId: string, membershipId: string): Promise<Membership>;

  /** Turn somebody down. Answers the id only, since the membership is gone. */
  reject(zoneId: string, membershipId: string): Promise<string>;

  /** Remove somebody. They can ask to join again with the code. */
  kick(zoneId: string, membershipId: string): Promise<Membership>;

  /** Remove somebody and stop them coming back. `join` refuses a BANNED membership. */
  ban(zoneId: string, membershipId: string): Promise<Membership>;

  /** Promote or demote. **OWNER only**, and never to OWNER. See {@link AssignableRole}. */
  setRole(
    zoneId: string,
    membershipId: string,
    role: AssignableRole
  ): Promise<Membership>;

  /**
   * Hand the group over. **OWNER only**, and the caller becomes an ADMIN by the same
   * call. Answers the zone, because what changed is the zone's owner.
   */
  transferOwnership(zoneId: string, membershipId: string): Promise<Zone>;

  /**
   * Change the name somebody goes by **in this zone**.
   *
   * Themselves, or an owner or admin renaming somebody else, except that an admin may
   * not rename the owner. Throttled at the gateway's `usernameChange` bucket, because
   * a public, non unique, freely changeable name makes rapid renaming a harassment
   * pattern; a refusal here is a `rate_limited` with its own copy.
   */
  setUsername(
    zoneId: string,
    membershipId: string,
    username: string
  ): Promise<Membership>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * **The default is the real gateway**, matching `ZONE_SERVICE` and reversing the
 * workspace convention for the same reason it does: a token that quietly falls back to
 * fixtures serves invented data while looking like it is talking to a backend, and
 * nothing tells you. Anything that wants the fake asks for it by name with
 * `{ provide: MEMBERSHIP_SERVICE, useExisting: MembershipMemory }`.
 */
export const MEMBERSHIP_SERVICE = serviceToken<MembershipServiceI>(
  'MEMBERSHIP_SERVICE',
  () => inject(MembershipApi)
);
