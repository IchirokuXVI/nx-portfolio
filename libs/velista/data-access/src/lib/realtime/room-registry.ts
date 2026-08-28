import { listRoom, zoneRoom, zoneStaffRoom } from './realtime-events';

/** A zone subscription to issue, with the staff intent its holders add up to. */
export interface ZoneAsk {
  readonly zoneId: string;
  readonly staff: boolean;
}

/** One line this client is editing, and the list it is on. */
export interface EditAsk {
  readonly listId: string;
  readonly lineId: string;
}

/** The difference between what the app wants and what the connection is in. */
export interface RoomReconciliation {
  readonly zonesToSubscribe: readonly ZoneAsk[];
  readonly zonesToUnsubscribe: readonly string[];
  readonly listsToSubscribe: readonly string[];
  readonly listsToUnsubscribe: readonly string[];
}

/**
 * The difference between the presence this client wants to announce and what it has.
 *
 * Answered separately from {@link RoomReconciliation}, and after it, because an intent
 * for a room that is not joined yet is refused (plan 0017, section 5.1).
 */
export interface PresenceReconciliation {
  readonly zonesToEnter: readonly string[];
  readonly zonesToLeave: readonly string[];
  readonly viewsToStart: readonly string[];
  readonly viewsToStop: readonly string[];
  readonly editsToStart: readonly EditAsk[];
  readonly editsToStop: readonly string[];
}

interface ZoneDesire {
  holders: number;
  staffHolders: number;
  /**
   * The subset of holders who want the caller to be **seen** in this zone.
   *
   * `viewHolders`' counterpart on a list, and it exists for the same reason and a
   * sharper one. Every group the user belongs to is subscribed for its whole session
   * so its counts stay live, so a zone subscription says nothing at all about where
   * the user is; only a screen that is open right now does (plan 0023).
   */
  presenceHolders: number;
}

interface ListDesire {
  /** Everybody holding the room, viewers included. */
  holders: number;
  /** The subset of them who want to be seen on it. */
  viewHolders: number;
  /** The one line being edited, since the server holds one per socket per list. */
  editingLineId: string | null;
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
  private readonly _lists = new Map<string, ListDesire>();

  /** Zone id to the staff intent it was actually joined with. */
  private readonly _joinedZones = new Map<string, boolean>();
  private readonly _joinedLists = new Set<string>();

  /** Zones and views announced, and the line announced as edited, on this connection. */
  private readonly _joinedZonePresence = new Set<string>();
  private readonly _joinedViews = new Set<string>();
  private readonly _joinedEdits = new Map<string, string>();

  /** Asked for, no answer yet. Keeps a reconcile from asking the same thing twice. */
  private readonly _pendingZones = new Set<string>();
  private readonly _pendingLists = new Set<string>();
  private readonly _pendingZonePresence = new Set<string>();
  private readonly _pendingViews = new Set<string>();
  private readonly _pendingEdits = new Set<string>();

  /** Answered `{ ok: false }` on this connection. Not asked again until the next one. */
  private readonly _refusedZones = new Set<string>();
  private readonly _refusedLists = new Set<string>();

  /**
   * Views the server refused, by list id. Cleared when its room is subscribed again.
   *
   * A refused view is a **disagreement**, not an ordinary no: the intent is only ever
   * proposed for a list this registry has recorded as joined, so a refusal means the
   * server does not think we are in a room we believe we are in. Asking again on the
   * same connection would spin, and the one event that could change the answer is that
   * room being joined afresh, so that is what lifts the latch.
   */
  private readonly _refusedViews = new Set<string>();

  /**
   * Zone presence the server refused, by zone id. Cleared when the room is re-joined.
   *
   * {@link _refusedViews}' reason exactly: the intent is only ever proposed for a zone
   * this registry has recorded as joined, so a refusal is a disagreement about which
   * rooms this socket is in, and the only thing that can change the answer is the room
   * being joined afresh.
   */
  private readonly _refusedZonePresence = new Set<string>();

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
    return this._acquireZone(zoneId, staff, false);
  }

  /**
   * Add a holder that also wants to be **seen** in the zone (plan 0023).
   *
   * {@link acquireListView}'s shape, one acquisition rather than two, and for the same
   * reason: the server refuses a presence intent from a socket that is not in
   * `zone:{id}`, so an intent without its room is not a weaker subscription but a
   * refused one.
   *
   * What differs from a list is who calls it. Every list room has an open list behind
   * it, so `subscribeList` is the rare case; every zone room is held for a whole
   * session so its group's counts stay live, so `acquireZone` is the common case and
   * this is the rare one. It is held by a screen about one group, and released when
   * that screen goes, which is what makes zone presence answer "where is this person"
   * instead of "which groups is this person a member of".
   */
  acquireZonePresence(zoneId: string, staff: boolean): () => void {
    return this._acquireZone(zoneId, staff, true);
  }

  private _acquireZone(
    zoneId: string,
    staff: boolean,
    present: boolean
  ): () => void {
    const desire = this._zones.get(zoneId) ?? {
      holders: 0,
      staffHolders: 0,
      presenceHolders: 0,
    };
    desire.holders += 1;
    if (staff) {
      desire.staffHolders += 1;
    }
    if (present) {
      desire.presenceHolders += 1;
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
      if (present) {
        current.presenceHolders -= 1;
      }

      if (current.holders <= 0) {
        this._zones.delete(zoneId);
        // The latch goes with the last holder. A refusal is only meaningful about a
        // zone somebody is asking for; keeping it would leave a group nobody
        // subscribes to reported as stale forever.
        this._refusedZones.delete(zoneId);
        this._refusedZonePresence.delete(zoneId);
      }
    };
  }

  /** Add a holder for a list room. See {@link acquireZone}. */
  acquireList(listId: string): () => void {
    return this._acquireList(listId, false);
  }

  /**
   * Add a holder that also wants to be **seen** on the list.
   *
   * One acquisition rather than two, because the server refuses a presence intent from
   * a socket that is not in the room (plan 0017, section 3.2): a view without its room
   * is not a weaker subscription, it is a refused one. The room refcount therefore
   * counts viewers too, and the release drops both halves together.
   */
  acquireListView(listId: string): () => void {
    return this._acquireList(listId, true);
  }

  /**
   * Set the line this client is editing on a list, or null for none.
   *
   * Not refcounted, because the server holds one edited line per socket per list, so
   * there is nothing to count: the last caller to speak is what the server holds. A
   * list with no holder is ignored rather than recorded, since an intent for a room
   * nobody is in would only ever be refused.
   */
  setEditingLine(listId: string, lineId: string | null): void {
    const desire = this._lists.get(listId);
    if (desire !== undefined) {
      desire.editingLineId = lineId;
    }
  }

  private _acquireList(listId: string, view: boolean): () => void {
    const desire = this._lists.get(listId) ?? {
      holders: 0,
      viewHolders: 0,
      editingLineId: null,
    };
    desire.holders += 1;
    if (view) {
      desire.viewHolders += 1;
    }
    this._lists.set(listId, desire);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      const current = this._lists.get(listId);
      if (current === undefined) {
        return;
      }

      current.holders -= 1;
      if (view) {
        current.viewHolders -= 1;
        // The last viewer out stops editing as well. A line being edited by nobody who
        // is looking at the list is a state the server would keep broadcasting.
        if (current.viewHolders <= 0) {
          current.editingLineId = null;
        }
      }

      if (current.holders <= 0) {
        this._lists.delete(listId);
        this._refusedLists.delete(listId);
        this._refusedViews.delete(listId);
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
        // Silently, for the reason `list.unsubscribe` drops the view below it:
        // `zone.unsubscribe` calls `presence.leaveZone` on the server, so a leave sent
        // beside it would buy another ack to accomplish what the unsubscribe did.
        this._joinedZonePresence.delete(zoneId);
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
        // Silently, and this is the interesting line. `list.unsubscribe` calls
        // `presence.unviewList` on the server, which removes both the viewer and the
        // editor entry for this socket, so an unview or a stop edit sent alongside it
        // would buy two more acks to accomplish what the unsubscribe already did.
        this._joinedViews.delete(listId);
        this._joinedEdits.delete(listId);
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

  /**
   * What has to be said about presence, marking it as said.
   *
   * Called **after** {@link reconcile}'s asks have been answered, never beside them: an
   * intent is only proposed for a list already recorded as joined, because the server
   * refuses one from a socket that is not in the room, and a list subscribed in the
   * same pass is not joined until its acknowledgement arrives (plan 0017, section 5.1).
   *
   * Stops are proposed but not forgotten here. The joined entry survives until the
   * server acknowledges the stop, so a stop that timed out is retried rather than
   * leaving the server believing this client is still viewing or still editing.
   */
  reconcilePresence(): PresenceReconciliation {
    const zonesToEnter: string[] = [];
    const zonesToLeave: string[] = [];
    const viewsToStart: string[] = [];
    const viewsToStop: string[] = [];
    const editsToStart: EditAsk[] = [];
    const editsToStop: string[] = [];

    for (const [zoneId, desire] of this._zones) {
      if (
        !this._joinedZones.has(zoneId) ||
        this._pendingZonePresence.has(zoneId)
      ) {
        continue;
      }

      const wantsPresence = desire.presenceHolders > 0;
      const announced = this._joinedZonePresence.has(zoneId);

      if (
        wantsPresence &&
        !announced &&
        !this._refusedZonePresence.has(zoneId)
      ) {
        this._pendingZonePresence.add(zoneId);
        zonesToEnter.push(zoneId);
        continue;
      }

      if (!wantsPresence && announced) {
        this._pendingZonePresence.add(zoneId);
        zonesToLeave.push(zoneId);
      }
    }

    for (const [listId, desire] of this._lists) {
      if (!this._joinedLists.has(listId) || this._pendingViews.has(listId)) {
        continue;
      }

      const wantsView = desire.viewHolders > 0;
      const announced = this._joinedViews.has(listId);

      if (wantsView && !announced && !this._refusedViews.has(listId)) {
        this._pendingViews.add(listId);
        viewsToStart.push(listId);
        continue;
      }

      if (!wantsView && announced) {
        this._pendingViews.add(listId);
        viewsToStop.push(listId);
        continue;
      }
    }

    for (const [listId, desire] of this._lists) {
      if (!this._joinedLists.has(listId) || this._pendingEdits.has(listId)) {
        continue;
      }

      const wanted = desire.editingLineId;
      const sent = this._joinedEdits.get(listId);

      if (wanted !== null && wanted !== sent) {
        // No stop in between, on purpose: `presence.edit` overwrites the previous line
        // for this socket, so stopping first would take this client out of the editors
        // list for a round trip and flicker on everybody else's screen.
        this._pendingEdits.add(listId);
        editsToStart.push({ listId, lineId: wanted });
        continue;
      }

      if (wanted === null && sent !== undefined) {
        this._pendingEdits.add(listId);
        editsToStop.push(listId);
      }
    }

    return {
      zonesToEnter,
      zonesToLeave,
      viewsToStart,
      viewsToStop,
      editsToStart,
      editsToStop,
    };
  }

  /** Lists this client wants to be seen on. Desire, not announcement. */
  viewedLists(): ReadonlySet<string> {
    const viewed = new Set<string>();
    for (const [listId, desire] of this._lists) {
      if (desire.viewHolders > 0) {
        viewed.add(listId);
      }
    }
    return viewed;
  }

  /** The line being edited per list, as desired. Used by the in-memory client. */
  editedLines(): ReadonlyMap<string, string> {
    const edits = new Map<string, string>();
    for (const [listId, desire] of this._lists) {
      if (desire.editingLineId !== null) {
        edits.set(listId, desire.editingLineId);
      }
    }
    return edits;
  }

  /** The server accepted the zone, with the staff intent it was asked with. */
  onZoneSubscribed(zoneId: string, staff: boolean): void {
    this._pendingZones.delete(zoneId);
    this._joinedZones.set(zoneId, staff);
    // The room is joined afresh, which is the one event that can change the server's
    // answer about presence it refused. See `_refusedZonePresence`.
    this._refusedZonePresence.delete(zoneId);
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
    // The room is joined afresh, which is the one event that can change the server's
    // answer about a view it refused. See `_refusedViews`.
    this._refusedViews.delete(listId);
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

  /** The server accepted it. This client is in the zone's online set. */
  onZonePresenceStarted(zoneId: string): void {
    this._pendingZonePresence.delete(zoneId);
    this._joinedZonePresence.add(zoneId);
  }

  /** The server accepted the leave, so it no longer counts this client as here. */
  onZonePresenceStopped(zoneId: string): void {
    this._pendingZonePresence.delete(zoneId);
    this._joinedZonePresence.delete(zoneId);
  }

  /** `{ ok: false }`: the server says we are not in the zone room we think we are in. */
  onZonePresenceRefused(zoneId: string): void {
    this._pendingZonePresence.delete(zoneId);
    this._joinedZonePresence.delete(zoneId);
    if (this._zones.has(zoneId)) {
      this._refusedZonePresence.add(zoneId);
    }
  }

  /**
   * The intent timed out. Not a refusal, so nothing is recorded and the next reconcile
   * proposes it again. {@link onPresenceAskFailed}'s reasoning, for a zone.
   */
  onZonePresenceAskFailed(zoneId: string): void {
    this._pendingZonePresence.delete(zoneId);
  }

  /** Zones this client wants to be seen in. Desire, not announcement. */
  presentZones(): ReadonlySet<string> {
    const present = new Set<string>();
    for (const [zoneId, desire] of this._zones) {
      if (desire.presenceHolders > 0) {
        present.add(zoneId);
      }
    }
    return present;
  }

  /** The server accepted the view. This client is in the list's viewers. */
  onViewStarted(listId: string): void {
    this._pendingViews.delete(listId);
    this._joinedViews.add(listId);
  }

  /** The server accepted the unview, so it no longer counts this client as a viewer. */
  onViewStopped(listId: string): void {
    this._pendingViews.delete(listId);
    this._joinedViews.delete(listId);
  }

  /** `{ ok: false }`: the server says we are not in the room we think we are in. */
  onViewRefused(listId: string): void {
    this._pendingViews.delete(listId);
    this._joinedViews.delete(listId);
    if (this._lists.has(listId)) {
      this._refusedViews.add(listId);
    }
  }

  /**
   * The intent timed out, or the socket went away under it. Not a refusal.
   *
   * Nothing is recorded, so the next reconcile proposes it again. A stop that failed
   * this way keeps its joined entry precisely so that it **is** proposed again: the
   * server still believes this client is viewing or editing, and forgetting locally is
   * how the two ends stop agreeing.
   */
  onPresenceAskFailed(listId: string): void {
    this._pendingViews.delete(listId);
    this._pendingEdits.delete(listId);
  }

  /** The server accepted the edit, and now holds this line for this socket. */
  onEditStarted(listId: string, lineId: string): void {
    this._pendingEdits.delete(listId);
    this._joinedEdits.set(listId, lineId);
  }

  /** The server accepted the stop, and holds no line for this socket on that list. */
  onEditStopped(listId: string): void {
    this._pendingEdits.delete(listId);
    this._joinedEdits.delete(listId);
  }

  /**
   * `{ ok: false }` on an edit. Treated as the view refusal it almost certainly is.
   *
   * The server's only reason for refusing `presence.edit` is the same room check that
   * refuses `presence.view`, so latching the list is what stops a spin, and the room
   * being re-joined is what lifts it.
   */
  onEditRefused(listId: string): void {
    this._pendingEdits.delete(listId);
    this._joinedEdits.delete(listId);
    if (this._lists.has(listId)) {
      this._refusedViews.add(listId);
    }
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
    this._joinedZonePresence.clear();
    this._pendingZonePresence.clear();
    this._refusedZonePresence.clear();
    // Presence is per connection exactly as rooms are: a socket that dropped is
    // present nowhere, so everything announced belongs to the connection that is gone
    // and the next one announces it all again.
    this._joinedViews.clear();
    this._joinedEdits.clear();
    this._pendingViews.clear();
    this._pendingEdits.clear();
    this._refusedViews.clear();
  }
}
