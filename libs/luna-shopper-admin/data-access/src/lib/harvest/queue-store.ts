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
 * How many rows of a bulk run are in flight at once (plan 0020, section 5).
 *
 * There is no bulk route and this plan does not add one, so a bulk action is one
 * call per row from the browser. Four is the compromise the plan names: enough
 * that two hundred rows are not two hundred round trips end to end, few enough
 * that draining a queue does not arrive at the gateway as a burst.
 */
const BULK_AT_ONCE = 4;

/** One row a bulk run could not put through, and why. */
export interface QueueBulkFailure {
  readonly id: string;
  readonly error: GatewayError;
}

/**
 * What a bulk run did, row by row (plan 0020, section 6).
 *
 * The rule the whole feature rests on: two hundred calls will not all succeed,
 * and a bulk that reports one word is a bulk an operator cannot recover from. So
 * three lists rather than a count, and the failed and the skipped are two lists
 * rather than one, because "I did not try" and "I tried and it was refused" are
 * different sentences.
 */
export interface QueueBulkResult {
  /** The rows that went through. They have left the selection. */
  readonly succeeded: readonly string[];
  /** The rows that were refused. They stay in the queue and stay selected. */
  readonly failed: readonly QueueBulkFailure[];
  /** The rows the act could not apply to. Never attempted, and still selected. */
  readonly skipped: readonly string[];
  /** How many rows the run set out to act on, which is everything but the skipped. */
  readonly total: number;
  /** Whether the operator stopped it. What had gone through stays through. */
  readonly stopped: boolean;
}

/** How far a bulk run has got, counting rows rather than time. */
export interface QueueBulkProgress {
  readonly done: number;
  readonly total: number;
}

const NOTHING: QueueBulkResult = {
  succeeded: [],
  failed: [],
  skipped: [],
  total: 0,
  stopped: false,
};

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
 * A decided item is removed rather than marked, so the count that is left is the
 * work that is left. The next page is fetched before the current one runs out,
 * so a queue does not stall at a page boundary.
 *
 * **The same rows are also a list** (plan 0020). One at a time is right when
 * each row is a judgement, and a list is right when the rows are alike and the
 * answer is the same for all of them, which is the ordinary end of a crawl. Both
 * views read this one store, so switching between them loads nothing, sends
 * nothing and loses no place: the selection, the cursor and the rows are all
 * here. That is why the selection lives on the store rather than on a screen.
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
  /** The row a single decision is in flight for, so only its controls lock. */
  private readonly _busyId = signal<string | null>(null);
  private readonly _bulk = signal<QueueBulkProgress | null>(null);
  private readonly _result = signal<QueueBulkResult | null>(null);
  private readonly _selected = signal<ReadonlySet<string>>(new Set());
  /** How many this session has decided, which is the only progress there is. */
  private readonly _decided = signal(0);
  private _exhausted = false;
  /** Set by `stopBulk`, read between rows rather than during one. */
  private _stopping = false;

  constructor(
    private readonly _read: QueueReader<T>,
    private readonly _idOf: (item: T) => string
  ) {}

  readonly items: Signal<readonly T[]> = this._items.asReadonly();
  readonly error: Signal<GatewayError | null> = this._error.asReadonly();
  readonly loading: Signal<boolean> = this._loading.asReadonly();

  /** A later page is being read, which the list view's own button asked for. */
  readonly loadingMore: Signal<boolean> = this._loadingMore.asReadonly();

  readonly busyId: Signal<string | null> = this._busyId.asReadonly();

  /** How far a bulk run has got, or null when none is running. */
  readonly bulk: Signal<QueueBulkProgress | null> = this._bulk.asReadonly();

  /** What the last bulk run did, until another one starts. */
  readonly result: Signal<QueueBulkResult | null> = this._result.asReadonly();

  /** The ids the operator has ticked. By id, so paging does not lose them. */
  readonly selected: Signal<ReadonlySet<string>> = this._selected.asReadonly();

  /** Anything is in flight. The buttons are disabled rather than hidden. */
  readonly busy = computed(
    () => this._busyId() !== null || this._bulk() !== null
  );

  readonly decided: Signal<number> = this._decided.asReadonly();

  /** The item being decided about, or null when there is nothing left. */
  readonly current = computed<T | null>(() => this._items()[0] ?? null);

  /**
   * What is coming up.
   *
   * The places queue draws these beside the current one, because near duplicates
   * cannot be judged one at a time: a place offered as new is offered precisely
   * because nothing matched it, and the thing it might be a duplicate of is the
   * next row rather than a row anywhere else.
   */
  readonly upcoming = computed<readonly T[]>(() => this._items().slice(1));

  /** Nothing is drawable: the first read failed and no items arrived. */
  readonly failed = computed(
    () => this._error() !== null && this._items().length === 0
  );

  /** The queue is genuinely empty, rather than merely unread or broken. */
  readonly empty = computed(
    () =>
      !this._loading() && this._error() === null && this._items().length === 0
  );

  /** Whether there is another page. The list view offers a button for it. */
  readonly canLoadMore = computed(() => this._cursor() !== null);

  /** How many of the loaded rows are ticked. */
  readonly selectedCount = computed(() => this._selected().size);

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
    this._selected.set(new Set());
    this._result.set(null);
    this._exhausted = false;

    await this._fetch(undefined, (items) => this._items.set(items));
    this._loading.set(false);
  }

  /**
   * Read one more page, because the list view asked for it.
   *
   * The queue's own prefetch happens when a decision empties it far enough, and
   * a list view has no decisions to trigger it: an operator scanning two hundred
   * rows decides nothing until the end. So the button, which says how many are
   * loaded, and the prefetch, which is silent, both exist.
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
   * Decide a row that is not the one in front.
   *
   * The list view's rows are decided where they sit, and the bulk runner walks a
   * selection rather than the head of the queue, so a decision has to be
   * addressable by id.
   *
   * The act says what becomes of the row: `null` for one that leaves, or the row
   * itself for one that stays, changed. Both are decisions and both count. The
   * shops queue is the screen that needs the second: ignoring a shop on the
   * default filter takes it out of the queue, and doing it with no filter on
   * leaves it there wearing a new badge, and losing your place on every press is
   * what the queue exists to avoid.
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
      if (this._items().length <= PREFETCH_AT) {
        void this._more();
      }
      return true;
    } catch (error) {
      this._error.set(toGatewayError(error));
      return false;
    } finally {
      this._busyId.set(null);
    }
  }

  /**
   * Do one act to every selected row, four at a time (plan 0020, sections 5 and
   * 6).
   *
   * All of the partial failure rule lives here, so the three screens hold none
   * of it and cannot each get it subtly wrong. A row `applies` refuses is never
   * passed to the act at all: an entry with no proposal cannot be accepted as
   * proposed, and reporting that as a failure would say the gateway refused
   * something nobody sent.
   */
  async decideMany(
    act: (item: T) => Promise<T | null>,
    applies: (item: T) => boolean = () => true
  ): Promise<QueueBulkResult> {
    if (this.busy()) {
      return NOTHING;
    }

    const selected = this._selected();
    const chosen = this._items().filter((item) =>
      selected.has(this._idOf(item))
    );
    const skipped = chosen
      .filter((item) => !applies(item))
      .map((item) => this._idOf(item));
    const pending = chosen.filter(applies);

    this._stopping = false;
    this._error.set(null);
    this._result.set(null);
    this._bulk.set({ done: 0, total: pending.length });

    const succeeded: string[] = [];
    const failed: QueueBulkFailure[] = [];
    let next = 0;

    const worker = async (): Promise<void> => {
      // Read between rows and not during one: a stop that abandoned a call in
      // flight would leave the operator unable to say whether it landed.
      while (!this._stopping) {
        const item = pending[next++];
        if (item === undefined) {
          return;
        }

        const id = this._idOf(item);
        try {
          const kept = await act(item);
          succeeded.push(id);
          this._settle(id, kept);
        } catch (error) {
          failed.push({ id, error: toGatewayError(error) });
        } finally {
          this._bulk.update((run) =>
            run === null ? null : { ...run, done: run.done + 1 }
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(BULK_AT_ONCE, pending.length) }, worker)
    );

    const result: QueueBulkResult = {
      succeeded,
      failed,
      skipped,
      total: pending.length,
      stopped: this._stopping,
    };

    this._stopping = false;
    this._bulk.set(null);
    this._result.set(result);

    if (this._items().length <= PREFETCH_AT) {
      void this._more();
    }

    return result;
  }

  /**
   * Stop the bulk run between rows.
   *
   * What has already gone through stays through, and the screen says so in those
   * words. A "cancel" read as an undo on a screen that writes to the catalog is
   * the worst possible misreading.
   */
  stopBulk(): void {
    this._stopping = true;
  }

  /** Tick or untick one row. */
  toggle(id: string): void {
    this._selected.update((selected) => {
      const next = new Set(selected);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /**
   * Tick every row that is loaded, and no more.
   *
   * The store holds the rows it has fetched and knows no more than that. A
   * control that claimed four thousand rows would be claiming a number it cannot
   * see and starting four thousand separate calls, so the button names the
   * number it is actually about and an operator who wants more loads more first.
   */
  selectLoaded(): void {
    this._selected.set(new Set(this._items().map((item) => this._idOf(item))));
  }

  clearSelection(): void {
    this._selected.set(new Set());
  }

  /**
   * Put this row in front, without deciding anything.
   *
   * What clicking a row in the list view does: the list is for the rows whose
   * answer is obvious, and the way out of one that is not is to look at it
   * properly. The rotation is the same one repeated skipping produces, so the
   * order behind it is unchanged.
   */
  focus(id: string): void {
    const items = this._items();
    const at = items.findIndex((item) => this._idOf(item) === id);
    if (at <= 0) {
      return;
    }

    this._items.set([...items.slice(at), ...items.slice(0, at)]);
  }

  /**
   * Put the current item at the back without deciding it.
   *
   * The way out of an item somebody cannot judge. Without it the only way past a
   * hard case is to answer it wrongly, and this queue writes to the catalog.
   */
  skip(): void {
    const [first, ...rest] = this._items();
    if (first !== undefined) {
      this._items.set([...rest, first]);
    }
  }

  /**
   * A decided row, taken out or put back changed, and out of the selection.
   *
   * A decided row always leaves the selection, whether or not it leaves the
   * queue. Nothing stays ticked that has already been acted on, which is what
   * makes pressing a bulk action a second time retry exactly the failures.
   */
  private _settle(id: string, kept: T | null): void {
    this._items.update((items) =>
      kept === null
        ? items.filter((item) => this._idOf(item) !== id)
        : items.map((item) => (this._idOf(item) === id ? kept : item))
    );

    this._selected.update((selected) => {
      if (!selected.has(id)) {
        return selected;
      }
      const next = new Set(selected);
      next.delete(id);
      return next;
    });

    this._decided.update((count) => count + 1);
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
