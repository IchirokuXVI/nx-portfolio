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
        return;
      default:
        // Every other event belongs to a store that owns the records it changes. A
        // presence store that tried to infer a departure from `member.kicked` would be
        // guessing at something the next broadcast states.
        return;
    }
  }
}
