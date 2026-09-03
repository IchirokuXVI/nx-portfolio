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
 * A decided item is removed rather than marked, so the count that is left is the
 * work that is left. The next page is fetched before the current one runs out,
 * so a queue does not stall at a page boundary.
 *
 * A plain class the screen constructs, for the same reason `ResourceListStore`
 * is one: a route's providers injector is never destroyed, so a route-scoped
 * service outlives the screen that made it.
 */
export class QueueStore<T> {
  private readonly _items = signal<readonly T[]>([]);
  private readonly _cursor = signal<string | null>(null);
  private readonly _loading = signal(true);
  private readonly _error = signal<GatewayError | null>(null);
  private readonly _busy = signal(false);
  /** How many this session has decided, which is the only progress there is. */
  private readonly _decided = signal(0);
  private _exhausted = false;

  constructor(
    private readonly _read: QueueReader<T>,
    private readonly _idOf: (item: T) => string
  ) {}

  readonly items: Signal<readonly T[]> = this._items.asReadonly();
  readonly error: Signal<GatewayError | null> = this._error.asReadonly();
  readonly loading: Signal<boolean> = this._loading.asReadonly();

  /** A decision is in flight. The buttons are disabled rather than hidden. */
  readonly busy: Signal<boolean> = this._busy.asReadonly();

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

  /** The first page. Replaces everything, so it doubles as a reload. */
  async load(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    this._items.set([]);
    this._cursor.set(null);
    this._exhausted = false;

    await this._fetch(undefined, (items) => this._items.set(items));
    this._loading.set(false);
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
    if (item === null || this._busy()) {
      return;
    }

    this._busy.set(true);
    try {
      await act(item);
      this._error.set(null);
      this._advance(this._idOf(item));
    } catch (error) {
      this._error.set(toGatewayError(error));
    } finally {
      this._busy.set(false);
    }
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

  private _advance(id: string): void {
    this._items.update((items) =>
      items.filter((item) => this._idOf(item) !== id)
    );
    this._decided.update((count) => count + 1);

    if (this._items().length <= PREFETCH_AT) {
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
