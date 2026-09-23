import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import {
  TRIP_ROWS_PAGE_SIZE,
  tripKey,
  TRIPS_PAGE_SIZE,
  TRIPS_REFETCH_QUIET_MS,
  type Trip,
  type TripRow,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import { TRIP_SERVICE, type TripServiceI } from './trip-service';

/** How the heads of the open list are loading. */
export type TripLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

/** What {@link TripStore.loadMore} answers: how many trips arrived, or a failure. */
export type TripLoadMoreOutcome =
  | { readonly state: 'loaded'; readonly added: number }
  | { readonly state: 'failed' };

/**
 * The trips of the zone list on screen (velista `0088`, section 8).
 *
 * ## Provided on the list route, beside `ListViewStore`
 *
 * It holds one visit to one list: the heads paged in so far and the rows of the trips
 * somebody opened. A route's injector is never destroyed here, so the page calls
 * {@link leave} from its own teardown, as it does for `ListViewStore`.
 *
 * ## One signal, three sources
 *
 * `list.tripsChanged`, `line.settled` for a line of this list and `line.claimChanged`
 * naming a line of this list all mean one thing: read the first page of heads again,
 * and the rows of every trip that is live or was opened. A burst is coalesced into one
 * read after {@link TRIPS_REFETCH_QUIET_MS} of quiet.
 *
 * ## An answer a newer request overtook is dropped
 *
 * Every heads read takes a generation, and every rows read takes one per trip. An answer
 * whose generation is no longer the latest is thrown away, so a slow read that started
 * before a settle cannot put the trip back the way it was before the settle.
 */
@Injectable()
export class TripStore {
  private readonly _service = inject<TripServiceI>(TRIP_SERVICE);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);

  private readonly _listId = signal<string | null>(null);
  private readonly _state = signal<TripLoadState>('idle');
  private readonly _live = signal<readonly Trip[]>([]);
  private readonly _past = signal<readonly Trip[]>([]);
  private readonly _cursor = signal<string | null>(null);
  private readonly _loadingMore = signal(false);
  private readonly _rows = signal<ReadonlyMap<string, readonly TripRow[]>>(
    new Map()
  );

  /** The list whose trips are held, or null. */
  readonly listId = this._listId.asReadonly();

  readonly state = this._state.asReadonly();

  /** Live trips, newest first. Never paged. */
  readonly live = this._live.asReadonly();

  /** Ended trips paged in so far, newest first. */
  readonly past = this._past.asReadonly();

  /** Whether "Show older trips" has anything to read. */
  readonly hasMore = computed(() => this._cursor() !== null);

  readonly loadingMore = this._loadingMore.asReadonly();

  /** Every held trip's rows, by trip key. */
  readonly rows = this._rows.asReadonly();

  private _headsGeneration = 0;
  private readonly _rowsGeneration = new Map<string, number>();

  /** Trips whose rows this visit asked for. Read again on every refetch. */
  private readonly _requested = new Set<string>();

  /** Trips whose rows answered not found this visit. Never asked for again. */
  private readonly _gone = new Set<string>();

  /** Whether "Show older trips" was pressed, so a refetch keeps the older pages. */
  private _pagedBeyondFirst = false;

  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const subscription = this._realtime.events.subscribe((event) =>
      this._apply(event)
    );
    inject(DestroyRef).onDestroy(() => {
      subscription.unsubscribe();
      this.leave();
    });
  }

  /** One trip's rows in list order, or undefined until they arrive. */
  rowsOf(key: string): readonly TripRow[] | undefined {
    return this._rows().get(key);
  }

  /** The list page opened a list. Reads its first page of heads. */
  open(listId: string): void {
    if (this._listId() === listId) {
      return;
    }

    this.leave();
    this._listId.set(listId);
    void this._readHeads('load');
  }

  /** The failed first read, asked again. */
  retry(): void {
    if (this._listId() === null) {
      return;
    }
    void this._readHeads('load');
  }

  /**
   * Give the instance back. Called from the page's teardown, because a route's
   * `DestroyRef` never fires. Every read still out is dropped when it answers.
   */
  leave(): void {
    this._clearTimer();
    this._headsGeneration += 1;
    this._rowsGeneration.clear();
    this._requested.clear();
    this._gone.clear();
    this._pagedBeyondFirst = false;
    this._listId.set(null);
    this._state.set('idle');
    this._live.set([]);
    this._past.set([]);
    this._cursor.set(null);
    this._loadingMore.set(false);
    this._rows.set(new Map());
  }

  /**
   * Read one trip's rows, every page, the first time it is asked for.
   *
   * A second call for the same trip asks for nothing: the rows stay loaded for the visit
   * and a refetch keeps them current. A trip whose rows answered not found is never
   * asked for again this visit, which is what stops a head the server still names from
   * looping between the two reads.
   */
  ensureRows(trip: Trip): void {
    const key = tripKey(trip);
    if (this._requested.has(key) || this._gone.has(key)) {
      return;
    }

    this._requested.add(key);
    void this._readRows(trip);
  }

  /** The next page of ended trips, appended. Answers how many arrived. */
  async loadMore(): Promise<TripLoadMoreOutcome> {
    const listId = this._listId();
    const cursor = this._cursor();
    if (listId === null || cursor === null || this._loadingMore()) {
      return { state: 'loaded', added: 0 };
    }

    this._loadingMore.set(true);
    try {
      const page = await this._service.listTrips(listId, {
        cursor,
        limit: TRIPS_PAGE_SIZE,
      });
      if (this._listId() !== listId) {
        return { state: 'loaded', added: 0 };
      }

      const held = new Set(this._allTrips().map(tripKey));
      const added = page.items.filter(
        (trip) => !held.has(tripKey(trip)) && !this._gone.has(tripKey(trip))
      );
      this._past.update((past) => [...past, ...added]);
      this._cursor.set(page.nextCursor);
      this._pagedBeyondFirst = true;
      return { state: 'loaded', added: added.length };
    } catch {
      return { state: 'failed' };
    } finally {
      if (this._listId() === listId) {
        this._loadingMore.set(false);
      }
    }
  }

  /** Read the heads again after a short quiet. A burst of calls is one read. */
  refetch(): void {
    if (this._listId() === null) {
      return;
    }

    this._clearTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._readHeads(this._state() === 'loaded' ? 'refresh' : 'load');
    }, TRIPS_REFETCH_QUIET_MS);
  }

  private async _readHeads(mode: 'load' | 'refresh'): Promise<void> {
    const listId = this._listId();
    if (listId === null) {
      return;
    }

    const generation = (this._headsGeneration += 1);
    if (mode === 'load') {
      this._state.set('loading');
    }

    try {
      const answer = await this._service.listTrips(listId, {
        limit: TRIPS_PAGE_SIZE,
      });
      if (generation !== this._headsGeneration) {
        return;
      }
      // A trip whose rows answered not found stays gone for the visit, even while the
      // heads still name it, or its group would hold a skeleton that never fills.
      const kept = (trip: Trip) => !this._gone.has(tripKey(trip));
      const page = {
        ...answer,
        live: answer.live.filter(kept),
        items: answer.items.filter(kept),
      };

      this._live.set(page.live);

      if (
        mode === 'load' ||
        !this._pagedBeyondFirst ||
        page.nextCursor === null
      ) {
        this._past.set(page.items);
        this._cursor.set(page.nextCursor);
        if (page.nextCursor === null) {
          this._pagedBeyondFirst = false;
        }
      } else {
        // Older pages were read. A held head older than the fresh first page is on one
        // of them and stays, with the cursor that reaches past them. A held head inside
        // the fresh page's range that the fresh page no longer names is gone.
        const fresh = new Set(page.items.map(tripKey));
        const boundary = page.items[page.items.length - 1];
        const older = this._past().filter(
          (trip) =>
            !fresh.has(tripKey(trip)) &&
            (boundary === undefined || isOlder(trip, boundary))
        );
        this._past.set([...page.items, ...older]);
      }

      this._state.set('loaded');

      if (mode === 'refresh') {
        this._rereadRows();
      }
    } catch {
      if (generation !== this._headsGeneration) {
        return;
      }
      // A failed refresh is quiet: what is on screen is not made worse by a read that
      // did not arrive. A failed first read is said under To buy, with a retry.
      if (mode === 'load') {
        this._state.set('failed');
      }
    }
  }

  /** The rows of every held trip that is live or was opened, read again quietly. */
  private _rereadRows(): void {
    const trips = this._allTrips();
    const present = new Set(trips.map(tripKey));

    this._rows.update((rows) => {
      const kept = new Map<string, readonly TripRow[]>();
      for (const [key, value] of rows) {
        if (present.has(key)) {
          kept.set(key, value);
        }
      }
      return kept;
    });
    for (const key of [...this._requested]) {
      if (!present.has(key)) {
        this._requested.delete(key);
      }
    }

    for (const trip of trips) {
      const key = tripKey(trip);
      if (this._gone.has(key)) {
        continue;
      }
      if (trip.live || this._requested.has(key)) {
        this._requested.add(key);
        void this._readRows(trip);
      }
    }
  }

  private async _readRows(trip: Trip): Promise<void> {
    const listId = this._listId();
    if (listId === null) {
      return;
    }

    const key = tripKey(trip);
    const generation = (this._rowsGeneration.get(key) ?? 0) + 1;
    this._rowsGeneration.set(key, generation);
    const current = () =>
      this._listId() === listId && this._rowsGeneration.get(key) === generation;

    try {
      const rows: TripRow[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;

      do {
        const page = await this._service.listTripRows(
          listId,
          trip.kind,
          trip.id,
          {
            cursor,
            limit: TRIP_ROWS_PAGE_SIZE,
          }
        );
        if (!current()) {
          return;
        }
        rows.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        // A server that answered the cursor it was handed would loop forever on a phone.
        if (cursor !== undefined && seen.has(cursor)) {
          break;
        }
        if (cursor !== undefined) {
          seen.add(cursor);
        }
      } while (cursor !== undefined);

      this._rows.update((held) => new Map(held).set(key, rows));
    } catch (error) {
      if (!current()) {
        return;
      }

      if (error instanceof GatewayError && error.code === 'not_found') {
        // A session's id can disappear when a purchase is undone. The group goes,
        // and the heads are read again to find whatever replaced it.
        this._drop(key);
        this.refetch();
        return;
      }

      // Quiet, and asked again the next time the group opens or a refetch runs.
      this._requested.delete(key);
    }
  }

  private _drop(key: string): void {
    this._gone.add(key);
    this._requested.delete(key);
    this._rowsGeneration.delete(key);
    this._live.update((trips) => trips.filter((trip) => tripKey(trip) !== key));
    this._past.update((trips) => trips.filter((trip) => tripKey(trip) !== key));
    this._rows.update((rows) => {
      if (!rows.has(key)) {
        return rows;
      }
      const next = new Map(rows);
      next.delete(key);
      return next;
    });
  }

  private _allTrips(): readonly Trip[] {
    return [...this._live(), ...this._past()];
  }

  private _apply(event: RealtimeEvent): void {
    const listId = this._listId();
    if (listId === null || this._state() === 'idle') {
      return;
    }

    switch (event.type) {
      case 'list.tripsChanged':
        if (event.listId === listId) {
          this.refetch();
        }
        return;
      case 'line.settled':
        if (event.line.listId === listId) {
          this.refetch();
        }
        return;
      case 'line.claimChanged':
        if (event.lines.some((ref) => ref.listId === listId)) {
          this.refetch();
        }
        return;
      default:
        return;
    }
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

/** Whether `trip` sorts after `boundary` in the server's `(startedAt, id)` descending order. */
function isOlder(trip: Trip, boundary: Trip): boolean {
  const difference = trip.startedAt.getTime() - boundary.startedAt.getTime();
  return difference !== 0 ? difference < 0 : trip.id < boundary.id;
}
