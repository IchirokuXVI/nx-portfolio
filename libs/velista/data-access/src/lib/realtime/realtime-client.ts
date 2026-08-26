import { inject, type Signal } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { Observable } from 'rxjs';
import type { RealtimeEvent } from './realtime-events';
import { RealtimeMemory } from './realtime-memory';

/**
 * The live connection, behind an interface so the transport can be swapped.
 *
 * The server implements **both** Socket.IO and SSE off one relay, so the payloads are
 * byte identical. Plan 0004 section 6.1 decides: build the Socket.IO transport behind
 * this interface, and add the SSE implementation when there is evidence the first one
 * fails rather than on principle. The interface costs nothing and is what makes the
 * second implementation a new class rather than a refactor.
 */
export interface RealtimeClientI {
  /** Every mapped event, from every room this client is subscribed to. */
  readonly events: Observable<RealtimeEvent>;

  /** Whether a live connection is currently established. */
  readonly connected: Signal<boolean>;

  /**
   * Whether the client has given up reconnecting.
   *
   * Distinct from being offline. An auth rejection disconnects the socket with **no
   * error event** (`realtime.gateway.ts:85`), so the client cannot tell it apart from
   * a dropped network and would otherwise reconnect forever against a token the
   * server will never accept. Realtime being unavailable must not raise `0003`'s
   * blocking connection screen, which is for a lost network.
   */
  readonly degraded: Signal<boolean>;

  /**
   * Join a zone room, refcounted. The returned function leaves it.
   *
   * Two containers can want the same zone, so the room is joined on the transition to
   * one subscriber and left on the transition to zero. Every subscription is re-issued
   * on reconnect, because rooms are per connection and server side: forgetting that
   * produces an app that works until the first network blip and then goes quietly
   * stale, which is the exact failure this layer exists to prevent.
   */
  subscribeZone(zoneId: string): () => void;

  /** Join a list room, refcounted. See {@link subscribeZone}. */
  subscribeList(listId: string): () => void;

  /**
   * Zones whose subscription the server refused.
   *
   * A `{ ok: false }` acknowledgement is not retried: it means the server declined,
   * usually on authorization. It is surfaced because a zone whose room was refused
   * will silently never update, and looking live while being stale is worse than
   * looking broken.
   */
  readonly refusedRooms: Signal<ReadonlySet<string>>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the in-memory implementation, so the app runs and every test passes
 * with no server. The Socket.IO implementation is bound at the app injector with
 * `provideService` once `socket.io-client` is a dependency.
 */
export const REALTIME_CLIENT = serviceToken<RealtimeClientI>(
  'REALTIME_CLIENT',
  () => inject(RealtimeMemory)
);
