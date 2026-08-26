import { Injectable, signal, type Signal } from '@angular/core';
import { Subject, type Observable } from 'rxjs';
import type { RealtimeClientI } from './realtime-client';
import { toRealtimeEvent } from './realtime-event-mapper';
import type { RealtimeEvent } from './realtime-events';

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
 */
@Injectable({ providedIn: 'root' })
export class RealtimeMemory implements RealtimeClientI {
  private readonly _events = new Subject<RealtimeEvent>();
  private readonly _connected = signal(true);
  private readonly _degraded = signal(false);
  private readonly _refused = signal<ReadonlySet<string>>(new Set());

  /** Rooms currently joined, with their refcount. Asserted on in tests. */
  readonly rooms = new Map<string, number>();

  readonly events: Observable<RealtimeEvent> = this._events.asObservable();
  readonly connected: Signal<boolean> = this._connected.asReadonly();
  readonly degraded: Signal<boolean> = this._degraded.asReadonly();
  readonly refusedRooms: Signal<ReadonlySet<string>> =
    this._refused.asReadonly();

  /** Rooms this fake will refuse, so the `{ ok: false }` path can be exercised. */
  readonly refuse = new Set<string>();

  subscribeZone(zoneId: string): () => void {
    return this._join(`zone:${zoneId}`);
  }

  subscribeList(listId: string): () => void {
    return this._join(`list:${listId}`);
  }

  /**
   * Push an event as if the server had sent it.
   *
   * Takes the raw `(name, payload)` rather than a built event on purpose: driving the
   * fake through the same mapper as the real transport is what keeps the mapper
   * covered by the tests that use this.
   */
  emit(name: string, payload: unknown): void {
    const event = toRealtimeEvent(name, payload);
    if (event !== null) {
      this._events.next(event);
    }
  }

  /** Simulate losing and regaining the connection, including resubscription. */
  setConnected(connected: boolean): void {
    this._connected.set(connected);
  }

  setDegraded(degraded: boolean): void {
    this._degraded.set(degraded);
  }

  private _join(room: string): () => void {
    if (this.refuse.has(room)) {
      this._refused.update((current) => new Set(current).add(room));
      return () => undefined;
    }

    this.rooms.set(room, (this.rooms.get(room) ?? 0) + 1);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      const count = (this.rooms.get(room) ?? 1) - 1;
      if (count <= 0) {
        this.rooms.delete(room);
      } else {
        this.rooms.set(room, count);
      }
    };
  }
}
