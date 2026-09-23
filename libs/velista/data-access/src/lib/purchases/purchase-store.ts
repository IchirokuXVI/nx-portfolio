import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import {
  purchaseEntryKey,
  PURCHASES_REFETCH_QUIET_MS,
  type PurchaseEntry,
  type PurchaseEntryRow,
  type ShoppingListsLoad,
} from '@portfolio/velista/models';
import type { Subscription } from 'rxjs';
import { GatewayError } from '../errors';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import { PURCHASE_SERVICE, type PurchaseServiceI } from './purchase-service';

/** What {@link PurchaseStore.loadMore} answers: how many entries arrived, or a failure. */
export type PurchaseLoadMoreOutcome =
  | { readonly state: 'loaded'; readonly added: number }
  | { readonly state: 'failed' };

/**
 * What the reader bought: the "Bought" tab of the history (velista `0095`, section 2).
 *
 * `SharedListStore`'s shape, over the history read: one array in the server's order, a
 * cursor, a load state for the skeleton and the error. Plus the rows of every entry
 * somebody opened, read the first time it opens and kept for the visit, every page of
 * them, as `TripStore` does for a trip.
 *
 * ## An answer a newer request overtook is dropped
 *
 * Every read of the first page takes a generation, and every rows read takes one per
 * entry (velista `0086`). An answer whose generation is no longer the latest is thrown
 * away, so a slow read that started before a settle cannot put an entry back the way
 * it was before it.
 *
 * ## What keeps it current
 *
 * `line.settled`, for any list, and `basket.updated`: the two signals that can add or
 * regroup a purchase. Both read the first page again, quietly and coalesced, and the
 * rows of every entry that is open. An entry whose id disappeared, because a revert
 * split a session, is dropped.
 *
 * ## Who listens
 *
 * The page. It is provided with the app's other stores, where no route destroys it,
 * so the page calls {@link attach} when it is built and {@link detach} when it goes,
 * and nothing is listening while nobody is looking.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9.
@Injectable()
export class PurchaseStore {
  private readonly _service = inject<PurchaseServiceI>(PURCHASE_SERVICE);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);

  private readonly _entries = signal<readonly PurchaseEntry[]>([]);
  private readonly _state = signal<ShoppingListsLoad>('idle');
  private readonly _cursor = signal<string | null>(null);
  private readonly _loadingMore = signal(false);
  private readonly _pagesLoaded = signal(0);
  private readonly _rows = signal<
    ReadonlyMap<string, readonly PurchaseEntryRow[]>
  >(new Map());

  /** Every entry paged in so far, newest first. */
  readonly entries = this._entries.asReadonly();
  readonly state = this._state.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly hasMore = computed(() => this._cursor() !== null);

  /** Pages landed, for the announcement. The quiet refresh leaves it alone. */
  readonly pagesLoaded = this._pagesLoaded.asReadonly();

  /** Every opened entry's rows, by entry key. */
  readonly rows = this._rows.asReadonly();

  private _headsGeneration = 0;
  private readonly _rowsGeneration = new Map<string, number>();

  /** Entries whose rows this visit asked for. Read again on every refetch. */
  private readonly _requested = new Set<string>();

  /** Whether older pages were read, so a refetch keeps them. */
  private _pagedBeyondFirst = false;

  private _subscription: Subscription | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.detach());
  }

  /** Start listening for the two signals. Called by the page when it is built. */
  attach(): void {
    if (this._subscription !== null) {
      return;
    }
    // By hand, not `takeUntilDestroyed`: `@angular/core/rxjs-interop` is a secondary
    // entry point module federation does not dedupe (see `BasketListStore`).
    this._subscription = this._realtime.events.subscribe((event) =>
      this._apply(event)
    );
  }

  /** Stop listening, and drop a refetch that was waiting. Called by the page. */
  detach(): void {
    this._subscription?.unsubscribe();
    this._subscription = null;
    this._clearTimer();
  }

  /** One entry's rows, or undefined until they arrive. */
  rowsOf(key: string): readonly PurchaseEntryRow[] | undefined {
    return this._rows().get(key);
  }

  /** The first page, once per app run. The tab calls it when it is first shown. */
  async loadFirst(): Promise<void> {
    if (this._state() !== 'idle') {
      return;
    }
    await this.reload();
  }

  /** The first page again, discarding what is held. The retry. */
  async reload(): Promise<void> {
    await this._readFirst('load');
  }

  /** The next page of entries, appended. Answers how many arrived. */
  async loadMore(): Promise<PurchaseLoadMoreOutcome> {
    const cursor = this._cursor();
    if (cursor === null || this._loadingMore() || this._state() !== 'loaded') {
      return { state: 'loaded', added: 0 };
    }

    const generation = this._headsGeneration;
    this._loadingMore.set(true);
    try {
      const page = await this._service.sessions(cursor);
      if (generation !== this._headsGeneration) {
        return { state: 'loaded', added: 0 };
      }

      const held = new Set(this._entries().map(purchaseEntryKey));
      const added = page.items.filter(
        (entry) => !held.has(purchaseEntryKey(entry))
      );
      this._entries.update((entries) => [...entries, ...added]);
      this._cursor.set(page.nextCursor);
      this._pagedBeyondFirst = true;
      this._pagesLoaded.update((n) => n + 1);
      return { state: 'loaded', added: added.length };
    } catch {
      return { state: 'failed' };
    } finally {
      this._loadingMore.set(false);
    }
  }

  /**
   * Read one entry's rows, every page, the first time it is opened.
   *
   * A second call asks for nothing: the rows stay loaded for the visit and a refetch
   * keeps them current. A failed read is quiet and asked again on the next open.
   */
  open(key: string): void {
    const entry = this._entries().find(
      (candidate) => purchaseEntryKey(candidate) === key
    );
    if (entry === undefined || this._requested.has(key)) {
      return;
    }

    this._requested.add(key);
    void this._readRows(entry);
  }

  /** Read the first page again after a short quiet. A burst of calls is one read. */
  refetch(): void {
    if (this._state() !== 'loaded') {
      return;
    }

    this._clearTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._readFirst('refresh');
    }, PURCHASES_REFETCH_QUIET_MS);
  }

  private async _readFirst(mode: 'load' | 'refresh'): Promise<void> {
    const generation = (this._headsGeneration += 1);
    if (mode === 'load') {
      this._state.set('loading');
      this._requested.clear();
      this._rowsGeneration.clear();
      this._rows.set(new Map());
      this._pagedBeyondFirst = false;
    }

    try {
      const page = await this._service.sessions();
      if (generation !== this._headsGeneration) {
        return;
      }

      if (
        mode === 'load' ||
        !this._pagedBeyondFirst ||
        page.nextCursor === null
      ) {
        this._entries.set(page.items);
        this._cursor.set(page.nextCursor);
        this._pagedBeyondFirst = false;
      } else {
        // Older pages were read. A held entry older than the fresh first page is on one
        // of them and stays. A held entry inside the fresh page's range that the fresh
        // page no longer names is gone.
        const fresh = new Set(page.items.map(purchaseEntryKey));
        const boundary = page.items[page.items.length - 1];
        const older = this._entries().filter(
          (entry) =>
            !fresh.has(purchaseEntryKey(entry)) &&
            (boundary === undefined || isOlder(entry, boundary))
        );
        this._entries.set([...page.items, ...older]);
      }

      if (mode === 'load') {
        this._pagesLoaded.update((n) => n + 1);
        this._state.set('loaded');
      } else {
        this._rereadRows();
      }
    } catch {
      if (generation !== this._headsGeneration) {
        return;
      }
      // A failed refresh is quiet: what is on screen is not made worse by a read that
      // did not arrive.
      if (mode === 'load') {
        this._state.set('failed');
      }
    }
  }

  /** The rows of every held entry that was opened, read again quietly. */
  private _rereadRows(): void {
    const held = new Map(
      this._entries().map((entry) => [purchaseEntryKey(entry), entry])
    );

    this._rows.update((rows) => {
      const kept = new Map<string, readonly PurchaseEntryRow[]>();
      for (const [key, value] of rows) {
        if (held.has(key)) {
          kept.set(key, value);
        }
      }
      return kept;
    });

    for (const key of [...this._requested]) {
      const entry = held.get(key);
      if (entry === undefined) {
        this._requested.delete(key);
        this._rowsGeneration.delete(key);
        continue;
      }
      void this._readRows(entry);
    }
  }

  private async _readRows(entry: PurchaseEntry): Promise<void> {
    const key = purchaseEntryKey(entry);
    const generation = (this._rowsGeneration.get(key) ?? 0) + 1;
    this._rowsGeneration.set(key, generation);
    const current = () => this._rowsGeneration.get(key) === generation;

    try {
      const rows: PurchaseEntryRow[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;

      do {
        const page = await this._service.rows(entry, cursor);
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

      this._requested.delete(key);
      if (error instanceof GatewayError && error.code === 'not_found') {
        // Every purchase in it was taken back, or a revert split the session. The
        // entry goes, and the first page is read again to find what replaced it.
        this._rowsGeneration.delete(key);
        this._entries.update((entries) =>
          entries.filter((candidate) => purchaseEntryKey(candidate) !== key)
        );
        this.refetch();
      }
    }
  }

  private _apply(event: RealtimeEvent): void {
    switch (event.type) {
      case 'line.settled':
      case 'basket.updated':
        this.refetch();
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

/** Whether `entry` sorts after `boundary` in the server's `(startedAt, id)` descending order. */
function isOlder(entry: PurchaseEntry, boundary: PurchaseEntry): boolean {
  const difference = entry.startedAt.getTime() - boundary.startedAt.getTime();
  return difference !== 0 ? difference < 0 : entry.id < boundary.id;
}
