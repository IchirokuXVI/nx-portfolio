import { computed, signal, type Signal } from '@angular/core';
import {
  appendPage,
  idOf,
  searchedRecordId,
  type ResourceDescriptor,
  type ResourceGateway,
  type ResourcePage,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError, toGatewayError } from '../gateway-error';
import { readRecordById } from './read-record-by-id';

/**
 * The rows one list is showing, and everything it knows about how they got
 * there (plan 0004, sections 3 and 4).
 *
 * A plain class rather than an `@Injectable`, constructed by the page that
 * draws it. One list screen is one of these, and it dies with the screen: two
 * resources open in two tabs are two stores, and a route-provided service would
 * be neither, since a route's injector is never destroyed.
 *
 * It is where the four states of section 3 are decided, once, so that fifteen
 * entities cannot disagree about what an empty list looks like. In particular
 * **no rows** and **no rows matching the filter** are different answers with
 * different remedies, and only the second one offers a way out.
 */
export type ListStatus = 'loading' | 'ready' | 'error';

export class ResourceListStore<T extends ResourceRow> {
  private readonly _rows = signal<readonly T[]>([]);
  private readonly _status = signal<ListStatus>('loading');
  private readonly _error = signal<GatewayError | null>(null);
  private readonly _cursor = signal<string | null>(null);
  private readonly _loadingMore = signal(false);
  private readonly _filters = signal<Readonly<Record<string, string>>>({});
  private readonly _order = signal<string | undefined>(undefined);
  /** Counts the reads from the start, so a read that was overtaken is dropped. */
  private _reads = 0;

  constructor(
    private readonly _descriptor: ResourceDescriptor<T>,
    private readonly _gateway: ResourceGateway<T>,
    /**
     * The filters the list opens with, from the link that opened it.
     *
     * A refusal can point at a narrowed list rather than at a row: a category
     * that still holds products links to its products (admin plan 0036), and
     * the list has to open already filtered or the link says nothing.
     */
    initialFilters: Readonly<Record<string, string>> = {},
    /**
     * What the address already decided, sent on every read (admin plan 0042).
     *
     * A chain's shops sit at `/chains/{chainId}/shops`, so the chain is not a
     * choice the operator makes on the list. It is kept apart from the filters
     * for that reason: it is no control, clearing the filters keeps it, and a
     * list narrowed by nothing else is still an empty list and not a list
     * whose filter needs clearing.
     */
    private readonly _fixed: Readonly<Record<string, string>> = {}
  ) {
    this._filters.set(initialFilters);
  }

  readonly rows: Signal<readonly T[]> = this._rows.asReadonly();
  readonly status: Signal<ListStatus> = this._status.asReadonly();
  readonly error: Signal<GatewayError | null> = this._error.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly order = this._order.asReadonly();

  /** Another page is being fetched under the rows already shown. */
  readonly loadingMore = this._loadingMore.asReadonly();

  /**
   * Whether there is another page.
   *
   * From the cursor and from nothing else. A page holding exactly the requested
   * number of rows is not proof that another exists, and a short page is not
   * proof that one does not (section 4).
   */
  readonly hasMore = computed(() => this._cursor() !== null);

  /**
   * Whether the operator has narrowed the list.
   *
   * Filters only. An order does not exclude anything, so a sorted empty list is
   * still an empty list rather than one whose filter needs clearing.
   */
  readonly narrowed = computed(() =>
    Object.values(this._filters()).some((value) => value !== '')
  );

  /**
   * The record ID typed into the search box, or `null` (admin plan 0051).
   *
   * While there is one the list is not a search. It holds the one row of this
   * resource that has the ID, read by the resource's own read route, and no
   * other filter takes part: an ID names one record, and a record that a
   * filter hid would be an ID that "does not exist" while it does.
   */
  readonly searchedId = computed(() =>
    searchedRecordId(this._descriptor, this._filters())
  );

  /**
   * No row of this resource has the typed ID.
   *
   * Its own state, because neither sentence beside it is true: the list is
   * not empty, and no filter is hiding the row.
   */
  readonly idNotFound = computed(
    () =>
      this._status() === 'ready' &&
      this._rows().length === 0 &&
      this.searchedId() !== null
  );

  /** Nothing is here, and nothing was excluded. */
  readonly empty = computed(
    () =>
      this._status() === 'ready' &&
      this._rows().length === 0 &&
      !this.narrowed()
  );

  /**
   * Nothing matched, which is a different sentence and needs a way out.
   *
   * An operator looking at "no supermarkets" when there are two thousand of
   * them, because a filter three screens ago is still set, is the failure this
   * distinction exists to prevent.
   */
  readonly noMatch = computed(
    () =>
      this._status() === 'ready' &&
      this._rows().length === 0 &&
      this.narrowed() &&
      this.searchedId() === null
  );

  /** The first page, from the current filters and order. Replaces the rows. */
  async load(): Promise<void> {
    this._reads += 1;
    this._error.set(null);
    this._rows.set([]);
    this._cursor.set(null);

    this._status.set('loading');
    await this._fetch(undefined, (page) => this._rows.set(page));
  }

  /**
   * The next page, appended.
   *
   * Deduplicated by id, because a cursor timestamp in this backend loses
   * microseconds and a row can arrive on both sides of a boundary. A repeated
   * row then costs nothing visible.
   */
  async loadMore(): Promise<void> {
    const cursor = this._cursor();
    if (
      cursor === null ||
      this._loadingMore() ||
      this._status() === 'loading'
    ) {
      return;
    }

    this._loadingMore.set(true);
    this._error.set(null);
    await this._fetch(cursor, (page) =>
      this._rows.update((shown) =>
        appendPage(shown, page, (row) => idOf(this._descriptor, row))
      )
    );
    this._loadingMore.set(false);
  }

  /**
   * Read again what is on screen, and keep as many rows as were loaded.
   *
   * For a list that stays drawn while one of its rows is written (admin plan
   * 0042). `load` answers the first page alone, so a row the operator had
   * reached with "Load more", and had open beside the list, left the column
   * on every save. This reads page after page until it holds as many rows as
   * were shown, and swaps them in at once: the rows on screen stay until the
   * new ones are here, so nothing blinks.
   *
   * A list with nothing loaded has nothing to keep, and is read from the
   * start. A failure leaves the rows that are shown and says so in a line,
   * as a failed "Load more" does.
   */
  async refresh(): Promise<void> {
    const wanted = this._rows().length;
    if (this._status() !== 'ready' || wanted === 0) {
      return this.load();
    }

    this._reads += 1;
    const read = this._reads;
    let rows: readonly T[] = [];
    let cursor: string | null = null;

    try {
      do {
        const page: ResourcePage<T> = await this._page(cursor ?? undefined);
        if (read !== this._reads) {
          // A filter or an order changed meanwhile, and its own read is what
          // the screen shows.
          return;
        }
        rows = appendPage(rows, page.items, (row) =>
          idOf(this._descriptor, row)
        );
        cursor = page.nextCursor;
      } while (cursor !== null && rows.length < wanted);

      this._rows.set(rows);
      this._cursor.set(cursor);
      this._error.set(null);
    } catch (error) {
      if (read === this._reads) {
        this._error.set(toGatewayError(error));
      }
    }
  }

  /** Set one filter and read the first page again. */
  setFilter(param: string, value: string): Promise<void> {
    this._filters.update((filters) => ({ ...filters, [param]: value }));
    return this.load();
  }

  /** Change the order and read the first page again. */
  setOrder(order: string | undefined): Promise<void> {
    this._order.set(order === '' ? undefined : order);
    return this.load();
  }

  /** Put every filter back, which is the way out of an empty filtered list. */
  clear(): Promise<void> {
    this._filters.set({});
    this._order.set(undefined);
    return this.load();
  }

  /**
   * Delete a row, and take it off the screen.
   *
   * The row is removed locally rather than by reading the list again, so the
   * operator's scroll position and every page they have loaded survive. A
   * failure leaves the row exactly where it was and answers the error, which
   * the caller shows.
   */
  async remove(id: string): Promise<GatewayError | null> {
    try {
      await this._gateway.remove(id);
    } catch (error) {
      return toGatewayError(error);
    }

    this._rows.update((rows) =>
      rows.filter((row) => idOf(this._descriptor, row) !== id)
    );
    return null;
  }

  /**
   * One page of what the list shows, and the one place it is read.
   *
   * A typed record ID is read as that record, in a page of one or of none.
   * The fixed values still hold: under a chain, the ID of another chain's
   * shop finds nothing.
   */
  private async _page(cursor: string | undefined): Promise<ResourcePage<T>> {
    const id = this.searchedId();
    if (id !== null) {
      const row = await readRecordById(
        this._descriptor,
        this._gateway,
        id,
        this._fixed,
        { ...this._filters(), ...this._fixed }
      );
      return { items: row === null ? [] : [row], nextCursor: null };
    }

    return this._gateway.list({
      cursor,
      order: this._order(),
      filters: { ...this._filters(), ...this._fixed },
    });
  }

  private async _fetch(
    cursor: string | undefined,
    apply: (items: readonly T[]) => void
  ): Promise<void> {
    // A filter that changes while a read is out starts its own read, and that
    // one is what the screen shows. A slow search by name must not land over
    // the record a typed ID found after it (admin plan 0051), and a "Load
    // more" of the old filter must not append to the new rows.
    const read = this._reads;
    try {
      const page = await this._page(cursor);
      if (read !== this._reads) {
        return;
      }

      apply(page.items);
      this._cursor.set(page.nextCursor);
      this._status.set('ready');
    } catch (error) {
      if (read !== this._reads) {
        return;
      }
      // A failure while appending leaves the rows already shown alone: they are
      // still true, and clearing them would turn a failed request for more into
      // the loss of everything the operator had. So the whole screen becomes an
      // error only when there is nothing else to draw; otherwise the rows stay
      // and the failure is a line beneath them.
      this._error.set(toGatewayError(error));
      this._status.set(this._rows().length > 0 ? 'ready' : 'error');
    }
  }
}
