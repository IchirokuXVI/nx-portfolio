import { computed, signal, type Signal } from '@angular/core';
import { GatewayError, toGatewayError } from '../gateway-error';

/** One page of whatever a queue is working through. */
export interface QueuePage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** How a queue reads its next page. */
export type QueueReader<T> = (
  cursor: string | undefined
) => Promise<QueuePage<T>>;

/**
 * When to fetch the next page.
 *
 * Fetching at the last item would make every page boundary a wait in front of an
 * operator who is working through items in a rhythm. Three is far enough ahead
 * to hide a round trip and near enough that a queue of four does not fetch twice
 * before anything is decided.
 */
const PREFETCH_AT = 3;

/**
 * A decision queue: a list of things each needing confirm, reject, or a
 * correction, worked through in sequence (plan 0006, section 5).
 *
 * Three screens share this shape, and the shape is the point. An import queue is
 * not a list you edit, so `0004`'s list and form do not fit it: what it needs is
 * a current item, a way to say yes or no to it, and the next one arriving
 * **without navigating back to a list**. Losing your place after every decision
 * is what makes reviewing four thousand products impossible rather than merely
 * long.
 *
 * A decided item is removed rather than marked, so what is left is the work
 * that is left. The next page is fetched before the current one runs out, so a
 * queue does not stall at a page boundary.
 *
 * **The rows never change places** (admin plan 0049, target 5). The row being
 * decided is named by its id, and the rows keep the order the gateway gave
 * them. Choosing a row and skipping one both move that name and nothing else.
 * The row in front used to be the first of the list, so choosing the fifth row
 * turned the list until the fifth was first: the four above it went to the
 * end, and the column the operator was reading jumped under the pointer.
 *
 * The same rows were also a list with a selection and a bulk runner (plan
 * 0020). The owner removed that view in admin plan 0049, and the selection,
 * the bulk run and its report went with it: nothing else read them.
 *
 * A plain class the screen constructs, for the same reason `ResourceListStore`
 * is one: a route's providers injector is never destroyed, so a route-scoped
 * service outlives the screen that made it.
 */
export class QueueStore<T> {
  private readonly _items = signal<readonly T[]>([]);
  private readonly _cursor = signal<string | null>(null);
  private readonly _loading = signal(true);
  private readonly _loadingMore = signal(false);
  private readonly _error = signal<GatewayError | null>(null);
  /** The row a decision is in flight for. */
  private readonly _busyId = signal<string | null>(null);
  /**
   * The row being decided, by id. `null` means the first row, which is what a
   * queue opens on.
   */
  private readonly _currentId = signal<string | null>(null);
  private _exhausted = false;

  constructor(
    private readonly _read: QueueReader<T>,
    private readonly _idOf: (item: T) => string
  ) {}

  readonly items: Signal<readonly T[]> = this._items.asReadonly();
  readonly error: Signal<GatewayError | null> = this._error.asReadonly();
  readonly loading: Signal<boolean> = this._loading.asReadonly();

  /** A later page is being read, which the column's own button asked for. */
  readonly loadingMore: Signal<boolean> = this._loadingMore.asReadonly();

  readonly busyId: Signal<string | null> = this._busyId.asReadonly();

  /** A decision is in flight. The buttons are disabled rather than hidden. */
  readonly busy = computed(() => this._busyId() !== null);

  /** Where the row being decided sits in the list, or -1 when there is none. */
  private readonly _at = computed(() => {
    const items = this._items();
    if (items.length === 0) {
      return -1;
    }
    const id = this._currentId();
    const at =
      id === null ? 0 : items.findIndex((item) => this._idOf(item) === id);
    // A name that no row answers to any more is the first row again.
    return at < 0 ? 0 : at;
  });

  /** The item being decided about, or null when there is nothing left. */
  readonly current = computed<T | null>(
    () => this._items()[this._at()] ?? null
  );

  /**
   * What is coming up: the rows after the current one, and then the rows
   * before it, which is the order skipping walks them in.
   *
   * The places queue draws these beside the current one, because near duplicates
   * cannot be judged one at a time: a place offered as new is offered precisely
   * because nothing matched it, and the thing it might be a duplicate of is the
   * next row rather than a row anywhere else.
   */
  readonly upcoming = computed<readonly T[]>(() => {
    const items = this._items();
    const at = this._at();
    return at < 0 ? [] : [...items.slice(at + 1), ...items.slice(0, at)];
  });

  /** Nothing is drawable: the first read failed and no items arrived. */
  readonly failed = computed(
    () => this._error() !== null && this._items().length === 0
  );

  /** The queue is genuinely empty, rather than merely unread or broken. */
  readonly empty = computed(
    () =>
      !this._loading() && this._error() === null && this._items().length === 0
  );

  /** Whether there is another page. The column offers a button for it. */
  readonly canLoadMore = computed(() => this._cursor() !== null);

  /** What this queue calls a row by, which callers outside it also need. */
  idOf(item: T): string {
    return this._idOf(item);
  }

  /** The first page. Replaces everything, so it doubles as a reload. */
  async load(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    this._items.set([]);
    this._cursor.set(null);
    this._currentId.set(null);
    this._exhausted = false;

    await this._fetch(undefined, (items) => this._items.set(items));
    this._loading.set(false);
  }

  /**
   * Read one more page, because the column asked for it.
   *
   * The queue's own prefetch happens when a decision empties it far enough, and
   * an operator reading down the column decides nothing while they read. So
   * the button, which says how many are loaded, and the prefetch, which is
   * silent, both exist.
   */
  async loadMore(): Promise<void> {
    if (this._loadingMore() || !this.canLoadMore()) {
      return;
    }

    this._loadingMore.set(true);
    try {
      await this._more();
    } finally {
      this._loadingMore.set(false);
    }
  }

  /**
   * Decide the current item, then move on.
   *
   * The item leaves the queue only when the call succeeded. A failure puts the
   * error up and leaves it exactly where it was, because the alternative is an
   * operator who believes they have rejected something they have not.
   */
  async decide(act: (item: T) => Promise<unknown>): Promise<void> {
    const item = this.current();
    if (item === null) {
      return;
    }

    await this.decideAt(this._idOf(item), async (row) => {
      await act(row);
      return null;
    });
  }

  /**
   * Decide a row by its id, which need not be the one in front.
   *
   * The act says what becomes of the row: `null` for one that leaves, or the row
   * itself for one that stays, changed. Both are decisions. The shops queue is
   * the screen that needs the second: ignoring a shop on the default filter
   * takes it out of the queue, and doing it with no filter on leaves it there
   * wearing a new badge, and losing your place on every press is what the
   * queue exists to avoid.
   */
  async decideAt(
    id: string,
    act: (item: T) => Promise<T | null>
  ): Promise<boolean> {
    const item = this._items().find((row) => this._idOf(row) === id);
    if (item === undefined || this.busy()) {
      return false;
    }

    this._busyId.set(id);
    try {
      const kept = await act(item);
      this._error.set(null);
      this._settle(id, kept);
      this._readAhead();
      return true;
    } catch (error) {
      this._error.set(toGatewayError(error));
      return false;
    } finally {
      this._busyId.set(null);
    }
  }

  /**
   * Make this row the one being decided, without deciding anything.
   *
   * What pressing a row of the column does. The rows stay where they are: only
   * the mark moves, so the rows above the chosen one are still above it and
   * the column does not scroll (admin plan 0049, target 5).
   */
  focus(id: string): void {
    if (this._items().some((item) => this._idOf(item) === id)) {
      this._currentId.set(id);
      this._readAhead();
    }
  }

  /**
   * Go to the next row without deciding this one, and from the last row back
   * to the first.
   *
   * The way out of an item somebody cannot judge. Without it the only way past a
   * hard case is to answer it wrongly, and this queue writes to the catalog.
   * The skipped row keeps its place, so it is where the operator left it when
   * they come back to it.
   */
  skip(): void {
    const items = this._items();
    const at = this._at();
    if (at < 0) {
      return;
    }

    const next = items[(at + 1) % items.length];
    this._currentId.set(this._idOf(next));
    this._readAhead();
  }

  /**
   * A decided row, taken out or put back changed.
   *
   * When the row that leaves is the one in front, the row under it comes up in
   * its place, and after the last row the first one does. Every other row
   * keeps its place, so nothing above the decided row moves.
   */
  private _settle(id: string, kept: T | null): void {
    const items = this._items();
    const at = this._at();
    const front = items[at];

    if (kept === null && front !== undefined && this._idOf(front) === id) {
      const next = items[at + 1] ?? (at > 0 ? items[0] : undefined);
      this._currentId.set(next === undefined ? null : this._idOf(next));
    }

    this._items.set(
      kept === null
        ? items.filter((item) => this._idOf(item) !== id)
        : items.map((item) => (this._idOf(item) === id ? kept : item))
    );
  }

  /**
   * Read the next page when few rows are left under the one in front.
   *
   * Counted from the row in front and not from the top, since an operator who
   * chose a row far down the column, or skipped their way there, is as close
   * to the end as one who decided every row above it.
   */
  private _readAhead(): void {
    const left = this._items().length - 1 - Math.max(this._at(), 0);
    if (left < PREFETCH_AT) {
      void this._more();
    }
  }

  private async _more(): Promise<void> {
    const cursor = this._cursor();
    if (cursor === null || this._exhausted) {
      return;
    }

    await this._fetch(cursor, (items) =>
      this._items.update((shown) => dedupe([...shown, ...items], this._idOf))
    );
  }

  private async _fetch(
    cursor: string | undefined,
    apply: (items: readonly T[]) => void
  ): Promise<void> {
    try {
      const page = await this._read(cursor);
      apply(page.items);
      this._cursor.set(page.nextCursor);
      // A page that carried no cursor is the last one. Recording it stops a
      // queue that empties from asking for the same nothing on every decision.
      this._exhausted = page.nextCursor === null;
    } catch (error) {
      this._error.set(toGatewayError(error));
    }
  }
}

/**
 * The same item once, keeping the first.
 *
 * A cursor timestamp in this backend loses microseconds, so a row can arrive on
 * both sides of a page boundary. In a list that costs a repeated row; in a queue
 * it costs an operator being asked the same question twice and the second answer
 * failing because the first already settled it.
 */
function dedupe<T>(items: readonly T[], idOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];

  for (const item of items) {
    const id = idOf(item);
    if (!seen.has(id)) {
      seen.add(id);
      kept.push(item);
    }
  }

  return kept;
}
