import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  Membership,
  MyZone,
  MyZoneOrder,
  Page,
  Zone,
} from '@portfolio/velista/models';
import { ZoneApi } from './zone-api';

/**
 * What a caller can do with zones.
 *
 * Every method returns a promise rather than an observable. These are one-shot
 * requests; the **live** side of the data arrives through `REALTIME_CLIENT` and lands
 * in `ZoneStore`, so an observable here would suggest a stream that does not exist.
 */
export interface ZoneServiceI {
  /** The caller's zones. One request, which is what the summary block is for. */
  listMyZones(options?: {
    cursor?: string;
    limit?: number;
    order?: MyZoneOrder;
  }): Promise<Page<MyZone>>;

  /**
   * Create a zone, minting a guest account when the caller is anonymous.
   *
   * Rule D3 lives behind this: the route treats an expired token as anonymous and
   * would silently mint a **second** guest account over the top of the caller's
   * existing one. See {@link ZoneCreationResult}.
   */
  createZone(name: string, username?: string): Promise<ZoneCreationResult>;

  /** Join a zone by its code. Same guest handshake and the same rule D3 hazard. */
  joinZone(joinCode: string, username?: string): Promise<ZoneJoinResult>;

  /**
   * One zone, with the caller's standing in it (`GET /v1/zones/:id`).
   *
   * Answers the same `MyZoneView` the dashboard's list does, counts and list previews
   * included, so the group page's header needs no model of its own.
   *
   * Refused with `forbidden` for a membership that is still PENDING and with
   * `not_found` for somebody who is not a member at all. The second is deliberate on
   * core's side: a stranger must not be able to tell an existing zone from a missing
   * one by the status code (plan 0010, section 5.6).
   */
  getZone(zoneId: string): Promise<MyZone>;

  /** Rename it (`PATCH /v1/zones/:id`). OWNER or ADMIN. */
  renameZone(zoneId: string, name: string): Promise<Zone>;

  /**
   * Mint a new join code (`POST /v1/zones/:id/regenerate-code`). OWNER or ADMIN.
   *
   * Not destructive to data and destructive to every invite already sent, which is
   * invisible unless the copy says so. Hence a confirm (section 5.7).
   */
  regenerateJoinCode(zoneId: string): Promise<Zone>;

  /**
   * Delete it (`DELETE /v1/zones/:id`). **OWNER only**, and there is no undo anywhere
   * in the product. Answers the deleted id.
   */
  deleteZone(zoneId: string): Promise<string>;

  /**
   * Take on a zone whose owner deleted their account
   * (`POST /v1/zones/:id/claim-ownership`).
   *
   * **ADMIN only, and only while `ownerUserId` is null.** It is the one action in the
   * whole product that gets a zone out of `MARKED_FOR_DELETION`, which is why the
   * group page has to offer it: nothing else anywhere does (section 3.5).
   */
  claimOwnership(zoneId: string): Promise<Zone>;
}

/**
 * The result of a call to one of the two optional-auth routes.
 *
 * `guest-account-lost` is not an error in the usual sense and must not be rendered as
 * one: the request was never sent. The caller had a guest account, its refresh token
 * is spent or revoked, and sending the request anyway would have handed them a new
 * empty account while their groups became unreachable. `0003`'s guest banner exists to
 * stop users reaching this state; this is what happens when they do anyway.
 */
export type ZoneCreationResult =
  | { readonly state: 'created'; readonly zone: Zone }
  | { readonly state: 'guest-account-lost' };

export type ZoneJoinResult =
  | { readonly state: 'joined'; readonly membership: Membership }
  | { readonly state: 'guest-account-lost' };

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * **The default is the real gateway**, and that is a deliberate reversal of the
 * workspace convention that a service token defaults to its in-memory implementation.
 *
 * The convention exists so a lib runs with no backend and a spec needs no setup. It
 * assumes the memory implementation is the safe answer when nobody chose. Here it was
 * the opposite: `ZoneStore` resolved this token in an injector the app's
 * `provideService(ZONE_SERVICE, ZoneApi)` never reached, silently got `ZoneMemory`, and
 * the app served invented data while looking like it was talking to the backend. A
 * wrong default that works is worse than one that fails, because nothing tells you.
 *
 * So the default is the implementation the running app actually wants, and anything
 * that wants the fake has to say so: `{ provide: ZONE_SERVICE, useExisting: ZoneMemory }`.
 * A test that forgets now gets a loud failure reaching for `HttpClient` instead of
 * quietly passing against fixtures.
 */
export const ZONE_SERVICE = serviceToken<ZoneServiceI>('ZONE_SERVICE', () =>
  inject(ZoneApi)
);
