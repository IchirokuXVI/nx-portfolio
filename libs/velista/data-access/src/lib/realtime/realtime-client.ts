import { inject, type Signal } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { Observable } from 'rxjs';
import type { RealtimeEvent } from './realtime-events';
import { RealtimeMemory } from './realtime-memory';

/** What a zone subscription asks for beyond the plain room. */
export interface RealtimeSubscribeOptions {
  /**
   * Also ask for the zone's governance side room, `zone:{id}:staff`.
   *
   * **Not a room of its own**, which is the whole reason this is an option rather
   * than a method. The server joins it inside its `zone.subscribe` handler when the
   * caller is an OWNER or ADMIN (`realtime.gateway.ts:107-109`), leaves it inside
   * `zone.unsubscribe` (`:121`), and publishes no message that touches it alone. So
   * it is an intent carried on the zone subscription, and the transport unions the
   * intents of every holder of that zone.
   *
   * It once was a method, `subscribeZoneStaff`, with its own refcount and its own
   * release. Against a real socket that is unsound: the first holder of the zone to
   * release emits `zone.unsubscribe`, which leaves both rooms, and every other holder
   * is then out of a room its refcount still says it is in. Looking live while being
   * stale is the worst outcome this layer has, so the shape that can produce it is
   * gone rather than deprecated.
   */
  readonly staff?: boolean;
}

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
   *
   * There is **one refcount per zone** whatever each holder's staff intent, and the
   * effective intent is the OR of the live holders'. A change in it re-issues
   * `zone.subscribe` with no unsubscribe in between: the handler is idempotent for the
   * plain room and re-runs the staff check, so a re-subscribe is the promotion and
   * demotion mechanism the server already expects. Unsubscribing first would open a
   * window in which the caller receives nothing.
   */
  subscribeZone(zoneId: string, options?: RealtimeSubscribeOptions): () => void;

  /**
   * Join a list room, refcounted. See {@link subscribeZone}.
   *
   * Observing, not announcing. A caller that also wants to be **seen** on the list
   * calls {@link viewList} instead, which takes this subscription on its behalf.
   */
  subscribeList(listId: string): () => void;

  /**
   * Announce that this client is looking at a list, refcounted. The release stops it.
   *
   * **Acquires the list room as well**, because the server refuses a presence intent
   * from a socket that is not in `list:{id}`: it trusts the membership `list.subscribe`
   * established rather than asking core a second time. Two subscriptions to express one
   * fact is a thing a caller would get wrong, so the client holds both.
   *
   * The intent is re-announced on every reconnect for the reason rooms are re-joined:
   * presence is per connection and lives on the server, so a socket that dropped and
   * came back is present nowhere, however sure the app is that it is viewing a list.
   *
   * Advisory only (plan 0004, section 6.7). It may under report, and nothing
   * destructive may ever be guarded by "nobody else is here".
   */
  viewList(listId: string): () => void;

  /**
   * Say which line of a list this client is editing, or null for none.
   *
   * State rather than a release, and deliberately unlike every other method here. The
   * server holds exactly **one** edited line per socket per list: `presence.edit`
   * overwrites the previous one and `presence.stopEdit` takes a list id and no line. A
   * release closure would therefore be a lie the moment the editor moved on, because a
   * stale one firing late would stop an edit that had already become a different line.
   * Passing the current value, `null` included, is the only shape that cannot drift
   * from what the server holds.
   *
   * Ignored for a list this client is not viewing, since the intent would be refused.
   */
  setEditingLine(listId: string, lineId: string | null): void;

  /**
   * Zones whose subscription the server refused, by **zone id**.
   *
   * A `{ ok: false }` acknowledgement is not retried on the same connection: it means
   * core says the caller is not in the zone, and asking again gets the same answer. It
   * is surfaced because a zone whose room was refused will silently never update, and
   * looking live while being stale is worse than looking broken. Every latch clears on
   * the next `connect`, because authorization can change between connections.
   *
   * A timeout is **not** a refusal and never lands here. The server's subscribe costs
   * a round trip to core, so a slow answer is ordinary; it leaves the room unjoined
   * and the next reconcile retries it. Latching one would paint a permanent "not live"
   * badge on a group that was merely slow, which is the false version of the exact
   * signal this set exists to give.
   *
   * Zone ids, not room names. The two ends of this used to disagree about which string
   * it held, and stripping a `zone:` prefix off `zone:abc:staff` yields `abc:staff`,
   * a zone id that matches nothing and so can never clear.
   */
  readonly refusedZones: Signal<ReadonlySet<string>>;

  /**
   * Payloads that arrived under a known event name and did not map, counted by name.
   *
   * Rule D4 says a bad payload is dropped and counted (plan 0004, section 6.5), and
   * for a while only the dropping was implemented. A silent drop is the one realtime
   * failure with no symptom at all: the app does not break, it just stops being live
   * for one kind of change. This counter is the only thing that would ever reveal a
   * backend payload change, so it is on the interface rather than on the transport
   * alone, where nothing holding the token could read it.
   */
  readonly droppedEvents: Signal<ReadonlyMap<string, number>>;

  /**
   * Clear {@link degraded} and try to connect again.
   *
   * The way out of a latched degraded state. Without it, `degraded` is a state a user
   * enters and cannot leave, which is a user permanently and invisibly stale. The
   * transport also re-arms itself on an identity change and on the window regaining
   * the network; this is the same door with a handle on it.
   */
  retry(): void;
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
