import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import type {
  SharedGeneratedListSummary,
  ShoppingListsLoad,
} from '@portfolio/velista/models';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import {
  GENERATED_LIST_SERVICE,
  type GeneratedListServiceI,
} from './generated-list-service';

/**
 * How long a burst of access changes gathers before the listing is read again.
 *
 * The same window `GeneratedListStore` gives a burst of settles. An owner ticking four
 * flatmates into a basket sends four events a second apart, and that is one read.
 */
const ACCESS_REFRESH_MS = 1500;

/**
 * The baskets other people shared with the reader: the Shared lists tab of the
 * history (velista `0085`, section 5).
 *
 * `GeneratedListStore`'s shape exactly, over a different read: one array in the
 * server's order, its own cursor, a load state for the skeleton and the error, and a
 * page counter the live region is keyed on. It is a second store rather than a second
 * array on that one because the two listings page independently, and a tab that is
 * never opened must cost no request.
 *
 * ## What keeps it current
 *
 * `generatedList.shared` and `generatedList.unshared` arrive on the account socket,
 * addressed to the reader alone and carrying only a basket id. The id is not enough to
 * draw a row, so both refetch the first page, quietly and coalesced. An `unshared`
 * also drops its row at once, because the refetch cannot remove a row that sits on a
 * later page and a basket the reader can no longer open must not stay tappable.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9.
@Injectable()
export class SharedListStore {
  private readonly _service = inject<GeneratedListServiceI>(
    GENERATED_LIST_SERVICE
  );
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);

  private readonly _lists = signal<readonly SharedGeneratedListSummary[]>([]);
  private readonly _state = signal<ShoppingListsLoad>('idle');
  private readonly _error = signal<unknown>(null);
  private readonly _cursor = signal<string | null>(null);
  private readonly _loadingMore = signal(false);
  private readonly _pagesLoaded = signal(0);

  private _refreshAt: ReturnType<typeof setTimeout> | null = null;
  private _asked = false;

  /** Every basket shared with the reader, most recently shared first. */
  readonly lists = this._lists.asReadonly();
  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly hasMore = computed(() => this._cursor() !== null);

  /** Pages landed, for the announcement. The quiet refresh leaves it alone. */
  readonly pagesLoaded = this._pagesLoaded.asReadonly();

  constructor() {
    // By hand, not `takeUntilDestroyed`: `@angular/core/rxjs-interop` is a secondary
    // entry point module federation does not dedupe (see `GeneratedListStore`).
    const subscription = this._realtime.events.subscribe((event) => {
      switch (event.type) {
        case 'generatedList.unshared':
          this._lists.update((lists) =>
            lists.filter((list) => list.id !== event.generatedListId)
          );
          this._scheduleRefresh();
          break;
        case 'generatedList.shared':
          this._scheduleRefresh();
          break;
        default:
          break;
      }
    });

    inject(DestroyRef).onDestroy(() => {
      subscription.unsubscribe();
      this._cancelRefresh();
    });
  }

  /** The first page, once per app run. The tab calls it when it is first shown. */
  async load(): Promise<void> {
    if (this._asked) {
      return;
    }
    await this.reload();
  }

  /** The first page again, discarding what is held. The retry. */
  async reload(): Promise<void> {
    this._asked = true;
    this._state.set('loading');
    this._error.set(null);

    try {
      const page = await this._service.listShared();
      this._lists.set(page.items);
      this._cursor.set(page.nextCursor);
      this._pagesLoaded.update((n) => n + 1);
      this._state.set('loaded');
    } catch (error) {
      this._error.set(error);
      this._state.set('failed');
    }
  }

  /** The next page, appended. A failure keeps the rows on screen, as the history's does. */
  async loadMore(): Promise<void> {
    const cursor = this._cursor();
    if (cursor === null || this._loadingMore() || this._state() !== 'loaded') {
      return;
    }

    this._loadingMore.set(true);
    try {
      const page = await this._service.listShared(cursor);
      this._lists.update((lists) => {
        const known = new Set(lists.map((list) => list.id));
        return [...lists, ...page.items.filter((item) => !known.has(item.id))];
      });
      this._cursor.set(page.nextCursor);
      this._pagesLoaded.update((n) => n + 1);
    } catch {
      // Deliberately swallowed: the rows already drawn are still good.
    } finally {
      this._loadingMore.set(false);
    }
  }

  private _scheduleRefresh(): void {
    this._cancelRefresh();
    this._refreshAt = setTimeout(() => {
      this._refreshAt = null;
      void this._refreshQuietly();
    }, ACCESS_REFRESH_MS);
  }

  private _cancelRefresh(): void {
    if (this._refreshAt !== null) {
      clearTimeout(this._refreshAt);
      this._refreshAt = null;
    }
  }

  /**
   * Read the first page again without the skeleton, and lay it over what is held.
   *
   * Nothing is read for a tab never opened: the event is about a listing nobody has
   * asked for, and the first opening reads it fresh anyway.
   */
  private async _refreshQuietly(): Promise<void> {
    if (this._state() !== 'loaded') {
      return;
    }

    try {
      const page = await this._service.listShared();
      this._lists.update((held) => {
        const covered = new Set(page.items.map((item) => item.id));
        return [...page.items, ...held.filter((list) => !covered.has(list.id))];
      });
    } catch {
      // Deliberately swallowed. Nobody asked for this read.
    }
  }
}
