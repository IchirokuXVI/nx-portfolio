import { listRoom, zoneRoom, zoneStaffRoom } from './realtime-events';

/** A zone subscription to issue, with the staff intent its holders add up to. */
export interface ZoneAsk {
  readonly zoneId: string;
  readonly staff: boolean;
}

/** The difference between what the app wants and what the connection is in. */
export interface RoomReconciliation {
  readonly zonesToSubscribe: readonly ZoneAsk[];
  readonly zonesToUnsubscribe: readonly string[];
  readonly listsToSubscribe: readonly string[];
  readonly listsToUnsubscribe: readonly string[];
}

interface ZoneDesire {
  holders: number;
  staffHolders: number;
}

/**
 * What the app wants to be subscribed to, against what the connection actually is.
 *
 * A plain class: no Angular, no socket, no rxjs. That is deliberate and it is the
 * point of the file. **This is where the bugs are** — refcount transitions, staff
 * intent unions, a release called twice, a room asked for while its answer is still in
 * flight — and every one of them is testable in microseconds here, with no fake socket,
 * no fake clock and no `TestBed`. Nothing in this file knows a connection exists; it
 * answers one question, `reconcile()`, and somebody else does the talking.
 *
 * Two states, kept apart on purpose:
 *
 * - **Desire** is refcounted and survives everything. It is what `subscribeZone` and
 *   `subscribeList` write, and it is the answer to "what should we be in".
 * - **Joined** is per connection and is thrown away by {@link onConnected} and
 *   {@link onDisconnected}, because rooms live on the server and a new socket is in
 *   none of them. That is what makes a reconnect the same code path as an ordinary
 *   change rather than a special one: clear the joined state, and the ordinary
 *   reconcile asks for everything again.
 *
 * ## The zone and its staff room are one subscription
 *
 * There is one refcount per zone whatever each holder asked for, and the effective
 * staff intent is the OR of the live holders'. The server has no message that joins or
 * leaves `zone:{id}:staff` alone (plan 0016, section 3.2), so modelling it as a second
 * refcounted room lets the first holder to release evict every other holder from a room
 * they still believe they are in.
 */
export class RoomRegistry {
  private readonly _zones = new Map<string, ZoneDesire>();
  private readonly _lists = new Map<string, number>();

  /** Zone id to the staff intent it was actually joined with. */
  private readonly _joinedZones = new Map<string, boolean>();
  private readonly _joinedLists = new Set<string>();

  /** Asked for, no answer yet. Keeps a reconcile from asking the same thing twice. */
  private readonly _pendingZones = new Set<string>();
  private readonly _pendingLists = new Set<string>();

  /** Answered `{ ok: false }` on this connection. Not asked again until the next one. */
  private readonly _refusedZones = new Set<string>();
  private readonly _refusedLists = new Set<string>();

  /** Zones the server refused, by zone id. Cleared on every new connection. */
  refusedZones(): ReadonlySet<string> {
    return new Set(this._refusedZones);
  }

  /**
   * The room names the desired state adds up to, built the way the server builds them.
   *
   * Derived rather than maintained, so it cannot disagree with the refcounts. Used by
   * the in-memory client, which has no connection and for which desire and membership
   * are the same thing.
   */
  roomNames(): ReadonlySet<string> {
    const rooms = new Set<string>();
    for (const [zoneId, desire] of this._zones) {
      rooms.add(zoneRoom(zoneId));
      if (desire.staffHolders > 0) {
        rooms.add(zoneStaffRoom(zoneId));
      }
    }
    for (const listId of this._lists.keys()) {
      rooms.add(listRoom(listId));
    }
    return rooms;
  }

  /**
   * Add a holder for a zone. The returned release is idempotent.
   *
   * Idempotent because a caller that releases twice would otherwise take the count
   * below the number of real holders and leave the survivors in a room the registry
   * thinks is empty. Callers do this by accident all the time: a component that
   * releases in both an effect cleanup and `ngOnDestroy` is one line of ordinary code.
   */
  acquireZone(zoneId: string, staff: boolean): () => void {
    const desire = this._zones.get(zoneId) ?? { holders: 0, staffHolders: 0 };
    desire.holders += 1;
    if (staff) {
      desire.staffHolders += 1;
    }
    this._zones.set(zoneId, desire);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      const current = this._zones.get(zoneId);
      if (current === undefined) {
        return;
      }

      current.holders -= 1;
      if (staff) {
        current.staffHolders -= 1;
      }

      if (current.holders <= 0) {
        this._zones.delete(zoneId);
        // The latch goes with the last holder. A refusal is only meaningful about a
        // zone somebody is asking for; keeping it would leave a group nobody
        // subscribes to reported as stale forever.
        this._refusedZones.delete(zoneId);
      }
    };
  }

  /** Add a holder for a list. See {@link acquireZone}. */
  acquireList(listId: string): () => void {
    this._lists.set(listId, (this._lists.get(listId) ?? 0) + 1);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      const count = (this._lists.get(listId) ?? 1) - 1;
      if (count <= 0) {
        this._lists.delete(listId);
        this._refusedLists.delete(listId);
      } else {
        this._lists.set(listId, count);
      }
    };
  }

  /**
   * What has to be said on the wire to close the gap, marking it as said.
   *
   * Subscriptions become pending and unsubscriptions leave the joined set at once, so
   * calling this twice before any answer arrives asks for nothing the second time.
   * Every returned ask has to be reported back through one of the `onZone*` /
   * `onList*` methods, or its room stays pending and is never retried.
   *
   * A zone already joined with a different staff intent is re-subscribed, and
   * deliberately **not** unsubscribed first: `zone.subscribe` is idempotent for the
   * plain room and re-runs the server's staff check, so a bare re-subscribe is the
   * promotion and demotion mechanism. Leaving first would open a window in which the
   * caller receives nothing at all.
   */
  reconcile(): RoomReconciliation {
    const zonesToSubscribe: ZoneAsk[] = [];
    const zonesToUnsubscribe: string[] = [];
    const listsToSubscribe: string[] = [];
    const listsToUnsubscribe: string[] = [];

    for (const [zoneId, desire] of this._zones) {
      if (this._pendingZones.has(zoneId) || this._refusedZones.has(zoneId)) {
        continue;
      }

      const staff = desire.staffHolders > 0;
      const joinedAs = this._joinedZones.get(zoneId);
      if (joinedAs === staff) {
        continue;
      }

      this._pendingZones.add(zoneId);
      zonesToSubscribe.push({ zoneId, staff });
    }

    for (const zoneId of [...this._joinedZones.keys()]) {
      if (!this._zones.has(zoneId)) {
        this._joinedZones.delete(zoneId);
        zonesToUnsubscribe.push(zoneId);
      }
    }

    for (const listId of this._lists.keys()) {
      if (
        this._pendingLists.has(listId) ||
        this._refusedLists.has(listId) ||
        this._joinedLists.has(listId)
      ) {
        continue;
      }

      this._pendingLists.add(listId);
      listsToSubscribe.push(listId);
    }

    for (const listId of [...this._joinedLists]) {
      if (!this._lists.has(listId)) {
        this._joinedLists.delete(listId);
        listsToUnsubscribe.push(listId);
      }
    }

    return {
      zonesToSubscribe,
      zonesToUnsubscribe,
      listsToSubscribe,
      listsToUnsubscribe,
    };
  }

  /** The server accepted the zone, with the staff intent it was asked with. */
  onZoneSubscribed(zoneId: string, staff: boolean): void {
    this._pendingZones.delete(zoneId);
    this._joinedZones.set(zoneId, staff);
  }

  /** The server answered `{ ok: false }`. Not asked again on this connection. */
  onZoneRefused(zoneId: string): void {
    this._pendingZones.delete(zoneId);
    this._joinedZones.delete(zoneId);
    if (this._zones.has(zoneId)) {
      this._refusedZones.add(zoneId);
    }
  }

  /**
   * The ask timed out, or the socket went away under it. Not a refusal.
   *
   * The room simply stays unjoined, so the next reconcile asks again. Treating this as
   * a refusal would latch a permanent "not live" badge onto a group that was merely
   * behind a slow round trip to core, which is the false version of the exact signal
   * the badge exists to give.
   */
  onZoneAskFailed(zoneId: string): void {
    this._pendingZones.delete(zoneId);
  }

  onListSubscribed(listId: string): void {
    this._pendingLists.delete(listId);
    this._joinedLists.add(listId);
  }

  onListRefused(listId: string): void {
    this._pendingLists.delete(listId);
    this._joinedLists.delete(listId);
    if (this._lists.has(listId)) {
      this._refusedLists.add(listId);
    }
  }

  onListAskFailed(listId: string): void {
    this._pendingLists.delete(listId);
  }

  /**
   * A connection came up. Everything joined, pending or refused belongs to the old one.
   *
   * The refusals go too, and that is the interesting half: authorization can change
   * between connections, so a new socket deserves a fresh answer rather than yesterday's
   * no.
   */
  onConnected(): void {
    this._resetConnectionState();
  }

  /**
   * A connection went away. Same reset, and for the blunter reason: the client is in no
   * rooms at all now, whatever it was in a moment ago.
   */
  onDisconnected(): void {
    this._resetConnectionState();
  }

  /** Drop the desire as well. Sign out, where the rooms are not ours to want. */
  clear(): void {
    this._zones.clear();
    this._lists.clear();
    this._resetConnectionState();
  }

  private _resetConnectionState(): void {
    this._joinedZones.clear();
    this._joinedLists.clear();
    this._pendingZones.clear();
    this._pendingLists.clear();
    this._refusedZones.clear();
    this._refusedLists.clear();
  }
}
