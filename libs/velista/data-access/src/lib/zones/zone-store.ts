import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { MyZone } from '@portfolio/velista/models';
import { SessionStore } from '../auth/session-store';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import { ZONE_SERVICE, type ZoneServiceI } from './zone-service';

/** How the store's one load is going, which is what `0003`'s state machine reads. */
export type ZoneLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * The caller's zones: the cache, the realtime application, and the room subscriptions.
 *
 * ## Why this is in `data-access` and not in `feature-home`
 *
 * Realtime events arrive for a room regardless of which page is mounted. A store owned
 * by `feature-home` would be destroyed the moment the user opens a list, so the room
 * would be left and rejoined on every navigation, the cache thrown away, and going
 * back would re-fetch everything. On the connection this product is used over, that is
 * the difference between an app that feels instant and one that does not
 * (plan 0004, section 7.1).
 *
 * A page facade is shaped like a screen and lives in its feature library. A store is
 * shaped like the domain and lives here. Conflating the two is the most likely way this
 * design gets misbuilt.
 */
@Injectable({ providedIn: 'root' })
export class ZoneStore {
  private readonly _zones = inject<ZoneServiceI>(ZONE_SERVICE);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _session = inject(SessionStore);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _byId = signal<ReadonlyMap<string, MyZone>>(new Map());
  private readonly _order = signal<readonly string[]>([]);
  private readonly _state = signal<ZoneLoadState>('idle');
  private readonly _error = signal<unknown>(null);

  /** Rooms currently held, so they can be released and re-joined together. */
  private readonly _rooms = new Map<string, () => void>();

  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();

  /** The caller's zones, in the order the server returned them. */
  readonly myZones = computed<readonly MyZone[]>(() => {
    const byId = this._byId();
    return this._order().flatMap((id) => {
      const zone = byId.get(id);
      return zone === undefined ? [] : [zone];
    });
  });

  /** Zones whose realtime room the server refused, so their data is not live. */
  readonly staleZoneIds = computed(() => {
    const refused = this._realtime.refusedRooms();
    return new Set(
      [...refused]
        .filter((room) => room.startsWith('zone:'))
        .map((room) => room.slice('zone:'.length))
    );
  });

  constructor() {
    this._realtime.events
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((event) => this._apply(event));

    this._destroyRef.onDestroy(() => this._releaseRooms());
  }

  /**
   * Load the caller's zones.
   *
   * Anonymous callers have none and must not be sent to a guarded endpoint to find
   * that out: `0003`'s anonymous state is a designed screen, not a 401 handled
   * gracefully.
   */
  async load(): Promise<void> {
    if (!this._session.isAuthenticated()) {
      this._byId.set(new Map());
      this._order.set([]);
      this._state.set('loaded');
      return;
    }

    this._state.set('loading');
    this._error.set(null);

    try {
      const page = await this._zones.listMyZones();
      this._byId.set(new Map(page.items.map((zone) => [zone.id, zone])));
      this._order.set(page.items.map((zone) => zone.id));
      this._state.set('loaded');
      this._syncRooms();
    } catch (error) {
      this._error.set(error);
      this._state.set('failed');
    }
  }

  /** Insert a zone the caller just created, without waiting for a refetch. */
  upsert(zone: MyZone): void {
    this._byId.update((current) => new Map(current).set(zone.id, zone));
    this._order.update((current) =>
      current.includes(zone.id) ? current : [zone.id, ...current]
    );
    this._syncRooms();
  }

  /**
   * Join a room per visible zone.
   *
   * Only zone rooms, deliberately. List and line events are broadcast to the zone room
   * as well as the list room (`realtime/src/app/consumer/jetstream.consumer.ts:182`),
   * so subscribing per zone already delivers everything `0003` needs for its live
   * counts. Subscribing to each list on the home screen as well would pay for the same
   * bytes twice.
   */
  private _syncRooms(): void {
    const wanted = new Map(
      this.myZones().map((zone) => [
        zone.id,
        // Staff also join `zone:{id}:staff`, which is the only room that carries the
        // governance fields on a counts broadcast. Without it an owner's join request
        // row would go stale until the next full load, which is the one number on the
        // card that most wants to be live.
        //
        // Non-null pendingRequestCount is the backend's own answer to "is this caller
        // staff", so asking it here cannot disagree with what the server will allow.
        zone.counts.pendingRequestCount !== null,
      ])
    );

    for (const [zoneId, release] of this._rooms) {
      if (!wanted.has(zoneId)) {
        release();
        this._rooms.delete(zoneId);
      }
    }

    for (const [zoneId, isStaff] of wanted) {
      if (!this._rooms.has(zoneId)) {
        const leaveZone = this._realtime.subscribeZone(zoneId);
        const leaveStaff = isStaff
          ? this._realtime.subscribeZoneStaff(zoneId)
          : null;

        this._rooms.set(zoneId, () => {
          leaveZone();
          leaveStaff?.();
        });
      }
    }
  }

  private _releaseRooms(): void {
    for (const release of this._rooms.values()) {
      release();
    }
    this._rooms.clear();
  }

  /**
   * Apply one event.
   *
   * Every branch is a whole-record replace or a targeted field update, never a merge
   * of an unvalidated payload: the event has already been through its mapper, and what
   * arrives here is a model this app owns (rule D4).
   */
  private _apply(event: RealtimeEvent): void {
    switch (event.type) {
      case 'zone.updated':
      case 'zone.ownershipChanged':
      case 'zone.markedForDeletion': {
        this._patch(event.zone.id, (zone) => ({
          ...zone,
          name: event.zone.name,
          joinCode: event.zone.joinCode,
          status: event.zone.status,
          ownerUserId: event.zone.ownerUserId,
        }));
        break;
      }

      case 'zone.deleted': {
        this._remove(event.zoneId);
        break;
      }

      case 'zone.countsUpdated': {
        this._patch(event.zoneId, (zone) => ({
          ...zone,
          counts: {
            ...zone.counts,
            memberCount: event.memberCount,
            // The plain zone room sends both governance fields as null, and the
            // staff room sends them filled. Taking the null would blank the join
            // request row for an owner every time somebody joined, so a null is
            // read as "this broadcast could not say" and the known value is kept.
            pendingRequestCount:
              event.pendingRequestCount ?? zone.counts.pendingRequestCount,
            firstPendingRequesterName:
              event.pendingRequestCount === null
                ? zone.counts.firstPendingRequesterName
                : event.firstPendingRequesterName,
          },
        }));
        break;
      }

      case 'member.roleChanged':
      case 'member.approved':
      case 'member.kicked':
      case 'member.banned': {
        const { membership } = event;
        const isMe = membership.userId === this._session.userId();

        if (
          isMe &&
          (membership.status === 'KICKED' || membership.status === 'BANNED')
        ) {
          // The caller is no longer in this zone. Removing it is what makes the card
          // disappear without a refresh, which is an acceptance criterion in `0003`.
          this._remove(membership.zoneId);
          break;
        }

        this._patch(membership.zoneId, (zone) =>
          isMe
            ? { ...zone, myRole: membership.role, myStatus: membership.status }
            : zone
        );
        break;
      }

      case 'member.joined': {
        this._patch(event.membership.zoneId, (zone) =>
          bumpMembers(zone, event.membership.status === 'APPROVED' ? 1 : 0)
        );
        break;
      }

      case 'member.rejected':
        // Carries no zone id, so there is nothing to apply it to. The count corrects
        // itself on the next load rather than being guessed at here.
        break;

      // `listCount` is access filtered per caller, so the counts broadcast cannot
      // carry it and the store keeps its own from the list events it already gets.
      case 'list.created':
        this._patch(event.list.zoneId, (zone) => bumpLists(zone, 1));
        break;

      case 'list.deleted':
      case 'list.accessChanged':
      case 'line.added':
      case 'line.updated':
      case 'line.reordered':
      case 'line.deleted':
      case 'comment.added':
      case 'list.updated':
        // List-scoped traffic reaching the zone room. `ListStore` owns these; the zone
        // summary's per-list counts are refreshed by its own load rather than being
        // recomputed from a stream the store only sees part of.
        break;

      case 'merge.requested':
      case 'merge.approved':
      case 'merge.rejected':
      case 'presence.zoneUpdated':
      case 'presence.listUpdated':
        // Merges have no page yet, and presence is advisory and owned elsewhere
        // (plan 0004, section 6.7).
        break;
    }
  }

  private _patch(zoneId: string, update: (zone: MyZone) => MyZone): void {
    this._byId.update((current) => {
      const existing = current.get(zoneId);
      if (existing === undefined) {
        // An event for a zone that is not on screen. Dropping it is correct: the
        // store holds what was loaded, and inventing a partial record from an event
        // would render a card with no name and no counts.
        return current;
      }

      return new Map(current).set(zoneId, update(existing));
    });
  }

  private _remove(zoneId: string): void {
    this._byId.update((current) => {
      const next = new Map(current);
      next.delete(zoneId);
      return next;
    });
    this._order.update((current) => current.filter((id) => id !== zoneId));

    const release = this._rooms.get(zoneId);
    if (release !== undefined) {
      release();
      this._rooms.delete(zoneId);
    }
  }
}

function bumpMembers(zone: MyZone, by: number): MyZone {
  return {
    ...zone,
    counts: {
      ...zone.counts,
      memberCount: Math.max(0, zone.counts.memberCount + by),
    },
  };
}

function bumpLists(zone: MyZone, by: number): MyZone {
  return {
    ...zone,
    counts: {
      ...zone.counts,
      listCount: Math.max(0, zone.counts.listCount + by),
    },
  };
}
