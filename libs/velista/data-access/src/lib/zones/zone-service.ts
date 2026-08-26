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
