import { Injectable, signal, type Signal } from '@angular/core';
import { Subject, type Observable } from 'rxjs';
import type {
  RealtimeClientI,
  RealtimeSubscribeOptions,
} from './realtime-client';
import { toRealtimeEvent } from './realtime-event-mapper';
import type { RealtimeEvent } from './realtime-events';
import { RoomRegistry } from './room-registry';

/**
 * The in-memory realtime client. The default behind `REALTIME_CLIENT`.
 *
 * It is not a stub. It implements the **same** interface including refcounting and
 * resubscription, so every live update path in the app is exercised with no server
 * running (plan 0004, section 9.2). Tests and the running app both drive it by hand.
 *
 * `0003` needs this specifically: a membership change arriving without a refresh is an
 * acceptance criterion, and reproducing one against a real backend means two accounts
 * and a join request.
 *
 * It shares {@link RoomRegistry} with the socket transport rather than keeping its own
 * map of room names to counts. That is the correction plan 0016 section 3.2 is about:
 * the old fake modelled rooms as independent strings, which is precisely what the
 * server does not do, so the one behaviour most worth faking — a staff intent that
 * rides on the zone subscription and cannot be released on its own — was the one
 * behaviour it could not express. A fake more orthogonal than the thing it fakes hides
 * the bug instead of catching it.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeMemory implements RealtimeClientI {
  private readonly _events = new Subject<RealtimeEvent>();
  private readonly _connected = signal(true);
  private readonly _degraded = signal(false);
  private readonly _refused = signal<ReadonlySet<string>>(new Set());
  private readonly _dropped = signal<ReadonlyMap<string, number>>(new Map());

  private readonly _registry = new RoomRegistry();

  readonly events: Observable<RealtimeEvent> = this._events.asObservable();
  readonly connected: Signal<boolean> = this._connected.asReadonly();
  readonly degraded: Signal<boolean> = this._degraded.asReadonly();
  readonly refusedZones: Signal<ReadonlySet<string>> =
    this._refused.asReadonly();
  readonly droppedEvents: Signal<ReadonlyMap<string, number>> =
    this._dropped.asReadonly();

  /** Zones this fake will refuse, so the `{ ok: false }` path can be exercised. */
  readonly refuse = new Set<string>();

  /**
   * The rooms a real server would have this client in, as room names.
   *
   * Derived from the registry rather than maintained beside it, so the fake cannot
   * claim a membership its own bookkeeping does not support. Asserted on in tests.
   */
  get rooms(): ReadonlySet<string> {
    return this._registry.roomNames();
  }

  subscribeZone(
    zoneId: string,
    options?: RealtimeSubscribeOptions
  ): () => void {
    if (this.refuse.has(zoneId)) {
      this._refused.update((current) => new Set(current).add(zoneId));
      return () => undefined;
    }

    return this._registry.acquireZone(zoneId, options?.staff === true);
  }

  subscribeList(listId: string): () => void {
    return this._registry.acquireList(listId);
  }

  viewList(listId: string): () => void {
    return this._registry.acquireListView(listId);
  }

  setEditingLine(listId: string, lineId: string | null): void {
    this._registry.setEditingLine(listId, lineId);
  }

  /**
   * The lists this client is announcing itself on, and the line it is editing on each.
   *
   * Derived from the registry for `rooms`' reason exactly: a fake that maintained its
   * own copy could claim an intent its own bookkeeping does not support, and the one
   * behaviour most worth faking here is that a view rides on a list subscription and
   * cannot be held without one.
   */
  get viewedLists(): ReadonlySet<string> {
    return this._registry.viewedLists();
  }

  get editedLines(): ReadonlyMap<string, string> {
    return this._registry.editedLines();
  }

  /**
   * Push an event as if the server had sent it.
   *
   * Takes the raw `(name, payload)` rather than a built event on purpose: driving the
   * fake through the same mapper as the real transport is what keeps the mapper
   * covered by the tests that use this, and what makes a dropped payload countable
   * here for the same reason it is countable there.
   */
  emit(name: string, payload: unknown): void {
    const event = toRealtimeEvent(name, payload);
    if (event === null) {
      this._dropped.update((current) =>
        new Map(current).set(name, (current.get(name) ?? 0) + 1)
      );
      return;
    }

    this._events.next(event);
  }

  /** Simulate losing and regaining the connection, including resubscription. */
  setConnected(connected: boolean): void {
    this._connected.set(connected);
  }

  setDegraded(degraded: boolean): void {
    this._degraded.set(degraded);
  }

  retry(): void {
    this._degraded.set(false);
    this._connected.set(true);
    this._refused.set(new Set());
  }
}
