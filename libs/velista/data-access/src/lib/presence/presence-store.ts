import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import type {
  ListPresence,
  PresenceEditor,
  PresenceUser,
  ZonePresence,
} from '@portfolio/velista/models';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';

const NO_USERS: readonly PresenceUser[] = [];
const NO_EDITORS: readonly PresenceEditor[] = [];

/**
 * Who is in a zone and who is looking at a list, as the server last said (plan 0017).
 *
 * ## Why it is a store and not a page facade
 *
 * `ZoneStore`'s reason exactly: presence arrives for a room regardless of which page is
 * mounted, and a snapshot thrown away on navigation would leave every screen waiting
 * for the next broadcast to know anything. The broadcasts are caused by other people,
 * so "the next one" can be minutes away.
 *
 * ## A snapshot replaces, it never merges
 *
 * `broadcastZone` and `broadcastList` publish the whole room every time, read from
 * Redis after the write that caused them. The whole room is the only self consistent
 * thing to hold: merging arrivals and departures into a snapshot feed is how somebody
 * who left stays lit up forever, and two pods racing to publish would make that
 * permanent rather than momentary.
 *
 * ## It empties when the connection goes
 *
 * Presence is per connection on both ends. The moment the socket drops, every snapshot
 * here describes a room this client is no longer in, and keeping it on screen is the
 * failure `0016` names as the worst one available: looking live while being stale.
 *
 * ## It keeps the current user
 *
 * Filtering yourself out is a rendering decision, made where the sentence is written.
 * A store that dropped a user id quietly would make `viewersOf` disagree with the count
 * the server broadcast, which is exactly what a surface used for debugging must not do.
 *
 * Advisory throughout (plan 0004, section 6.7): it may under report, and nothing
 * destructive may ever be guarded by "nobody else is here".
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It resolves
// `REALTIME_CLIENT`, so at the root it would listen to that token's default while the
// rest of the app talked to the server the app bound.
@Injectable()
export class PresenceStore {
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _zones = signal<ReadonlyMap<string, ZonePresence>>(
    new Map()
  );
  private readonly _lists = signal<ReadonlyMap<string, ListPresence>>(
    new Map()
  );

  /**
   * When each viewer was first seen on each list, as epoch milliseconds.
   *
   * Kept here because a snapshot cannot carry it: `broadcastList` publishes the whole
   * room with no timestamp anywhere in it, so "since when" is not a fact the server
   * offers and the only instant available is the first snapshot **this** client saw
   * somebody in. A page that computed it for itself would restart the clock every time
   * it was navigated away from and back, which is why it lives in the store that
   * outlives the page.
   *
   * Carried forward per user rather than per snapshot: a snapshot replaces, so somebody
   * still in the new one keeps the instant they were first seen at, and somebody who
   * left loses it, which is what makes a return read as a return.
   */
  private readonly _listSince = signal<
    ReadonlyMap<string, ReadonlyMap<string, number>>
  >(new Map());

  constructor() {
    // Subscribed by hand rather than with `takeUntilDestroyed`, and the teardown goes
    // through `DestroyRef`: `@angular/core/rxjs-interop` is a secondary entry point
    // module federation does not dedupe, so it throws `NG0203` from a service several
    // remotes provide, with a perfectly correct DI graph. `RealtimeSocket` and
    // `RealtimeMemory` are written the same way for the same reason.
    const subscription = this._realtime.events.subscribe((event) =>
      this._apply(event)
    );
    this._destroyRef.onDestroy(() => subscription.unsubscribe());

    effect(() => {
      const connected = this._realtime.connected();
      untracked(() => {
        if (!connected) {
          this.clear();
        }
      });
    });
  }

  /** Who is online in a zone. Empty until the first broadcast, which is honest. */
  onlineIn(zoneId: string): readonly PresenceUser[] {
    return this._zones().get(zoneId)?.online ?? NO_USERS;
  }

  /** Who is looking at a list right now. */
  viewersOf(listId: string): readonly PresenceUser[] {
    return this._lists().get(listId)?.viewers ?? NO_USERS;
  }

  /**
   * When this client first saw somebody on a list, or null.
   *
   * Null is a first class answer and stays one: it covers the viewer who arrived in the
   * very snapshot being read on a page that has only just mounted, and it is what every
   * caller gets after a reconnection, since `clear` drops these along with the rooms
   * they describe. Whoever renders it says "here now" rather than inventing a time.
   *
   * Deliberately **not** presented as when they opened the list. Nothing on the wire
   * says that, and a client that dressed its own first sighting up as the server's fact
   * would be confidently wrong about every person who was already shopping when the
   * reader arrived.
   */
  viewerSince(listId: string, userId: string): Date | null {
    const at = this._listSince().get(listId)?.get(userId);
    return at === undefined ? null : new Date(at);
  }

  /** Who is editing a line of a list right now. */
  editorsOf(listId: string): readonly PresenceEditor[] {
    return this._lists().get(listId)?.editors ?? NO_EDITORS;
  }

  /**
   * Whoever is editing one specific line, or null.
   *
   * The shape a line row wants, and the reason `editors` carries a `lineId` at all. It
   * answers with the first editor of that line: the server permits several, since it
   * holds one line per **socket**, and a row has space to name one person.
   */
  editorOfLine(listId: string, lineId: string): PresenceEditor | null {
    return (
      this.editorsOf(listId).find((editor) => editor.lineId === lineId) ?? null
    );
  }

  /**
   * A signal view of one list, for a container that reads it inside a `computed`.
   *
   * `ListStore.forZone`'s shape and its reason: the accessors above read a signal, so
   * they are reactive when called from a reactive context, and a container that wants
   * to hold one list's presence is better served by something it can keep.
   */
  forList(listId: string): Signal<ListPresence> {
    return computed(
      () =>
        this._lists().get(listId) ?? {
          listId,
          viewers: NO_USERS,
          editors: NO_EDITORS,
        }
    );
  }

  /** Everything the server has said is no longer true. Sign out, and a lost socket. */
  clear(): void {
    this._zones.set(new Map());
    this._lists.set(new Map());
    // The arrival times go with the rooms. They describe how long somebody has been
    // somewhere this client is no longer watching, so keeping them would let a
    // reconnection draw an hour of presence nobody observed.
    this._listSince.set(new Map());
  }

  private _apply(event: RealtimeEvent): void {
    switch (event.type) {
      case 'presence.zoneUpdated':
        this._zones.update((current) =>
          new Map(current).set(event.presence.zoneId, event.presence)
        );
        return;
      case 'presence.listUpdated':
        this._lists.update((current) =>
          new Map(current).set(event.presence.listId, event.presence)
        );
        this._rememberArrivals(event.presence);
        return;
      default:
        // Every other event belongs to a store that owns the records it changes. A
        // presence store that tried to infer a departure from `member.kicked` would be
        // guessing at something the next broadcast states.
        return;
    }
  }

  /**
   * Fold a snapshot's viewers into the arrival times, keeping what is already known.
   *
   * Rebuilt from the snapshot rather than merged into the previous map, for the reason
   * the snapshot itself is not merged: whoever is not in the new room is not in it, and
   * an entry left behind is how somebody who left keeps a running clock forever.
   */
  private _rememberArrivals(presence: ListPresence): void {
    const at = Date.now();

    this._listSince.update((current) => {
      const known = current.get(presence.listId);
      const next = new Map<string, number>();
      for (const viewer of presence.viewers) {
        next.set(viewer.userId, known?.get(viewer.userId) ?? at);
      }

      return new Map(current).set(presence.listId, next);
    });
  }
}
