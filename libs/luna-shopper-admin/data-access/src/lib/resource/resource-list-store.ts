import { computed, signal, type Signal } from '@angular/core';
import {
  appendPage,
  idOf,
  queryFilters,
  unansweredFilters,
  type ResourceDescriptor,
  type ResourceGateway,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError, toGatewayError } from '../gateway-error';

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
export type ListStatus = 'loading' | 'ready' | 'error' | 'blocked';

export class ResourceListStore<T extends ResourceRow> {
  private readonly _rows = signal<readonly T[]>([]);
  private readonly _status = signal<ListStatus>('loading');
  private readonly _error = signal<GatewayError | null>(null);
  private readonly _cursor = signal<string | null>(null);
  private readonly _loadingMore = signal(false);
  private readonly _filters = signal<Readonly<Record<string, string>>>({});
  private readonly _order = signal<string | undefined>(undefined);

  constructor(
    private readonly _descriptor: ResourceDescriptor<T>,
    private readonly _gateway: ResourceGateway<T>
  ) {}

  readonly rows: Signal<readonly T[]> = this._rows.asReadonly();
  readonly status: Signal<ListStatus> = this._status.asReadonly();
  readonly error: Signal<GatewayError | null> = this._error.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly order = this._order.asReadonly();

  /**
   * The required filters still unanswered, which is why nothing has been read.
   *
   * Three of the catalog's lists begin from something rather than from
   * everything: a chain's shops are addressed under the chain, and a shop's
   * aisle positions name the shop as a required parameter. Asking without it is
   * a 400, so the list waits and names what it is waiting for, rather than
   * showing the operator an error the screen caused itself.
   */
  readonly waitingFor = computed(() =>
    unansweredFilters(this._descriptor.filters ?? [], this._filters())
  );

  /** Nothing has been read, and nothing will be until a filter is answered. */
  readonly blocked = computed(() => this.waitingFor().length > 0);

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
   * The filters the gateway is allowed to see.
   *
   * Local ones are dropped. The shop picker on the aisle position screen needs
   * a chain to search within and the route has no parameter for one, and the
   * gateway validates its query with `forbidNonWhitelisted`, so sending it
   * anyway would turn a helpful control into a 400.
   */
  private readonly _queryFilters = computed(() =>
    queryFilters(this._descriptor.filters ?? [], this._filters())
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
      this._status() === 'ready' && this._rows().length === 0 && this.narrowed()
  );

  /**
   * The first page, from the current filters and order. Replaces the rows.
   *
   * A blocked list reads nothing and says so instead. The rows are still
   * cleared, because the ones on screen belonged to the parent that has just
   * been unchosen and leaving them would attribute one shop's prices to
   * another.
   */
  async load(): Promise<void> {
    this._error.set(null);
    this._rows.set([]);
    this._cursor.set(null);

    if (this.blocked()) {
      this._status.set('blocked');
      return;
    }

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
    if (cursor === null || this._loadingMore() || this._status() !== 'ready') {
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

  /**
   * Put every filter back, which is the way out of an empty filtered list.
   *
   * Including the required ones, which sends the list back to asking for a
   * parent. That is the right answer rather than an awkward one: an operator
   * clearing the filter wants to start again, and a screen that kept the chain
   * while dropping everything else would be clearing something they did not
   * name.
   */
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

  private async _fetch(
    cursor: string | undefined,
    apply: (items: readonly T[]) => void
  ): Promise<void> {
    try {
      const page = await this._gateway.list({
        cursor,
        order: this._order(),
        filters: this._queryFilters(),
      });

      apply(page.items);
      this._cursor.set(page.nextCursor);
      this._status.set('ready');
    } catch (error) {
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
