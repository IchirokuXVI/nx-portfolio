import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import type {
  CreateGeneratedListRequest,
  GeneratedListRun,
  GeneratedListSummary,
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
 * How long a burst of settles is allowed to gather before the listing is read again.
 *
 * Somebody at a checkout ticks things off seconds apart, so this is the window that
 * turns a shop's worth of taps into one request. Long enough to swallow a burst, short
 * enough that the card moves while its reader is still looking at it.
 */
const SETTLE_REFRESH_MS = 1500;

/**
 * The caller's generated shopping lists: the card on the dashboard, the history page,
 * and the sheet that makes one (plan 0045, section 5).
 *
 * ## Why it lives in `data-access` and is provided by the app
 *
 * `ZoneStore`'s reason: it resolves `GENERATED_LIST_SERVICE`, so at the root it would
 * get that token's own default rather than whatever the app bound and would quietly
 * serve fixture baskets beside a real account (rule D5). And it is app scoped rather
 * than page scoped for a second reason, the one `ShoppingProfileStore` gives: two
 * screens read it. The dashboard's card and the history page are separate routes, and a
 * store owned by either would refetch the whole listing every time somebody moved
 * between them.
 *
 * ## One list, held once, read three ways
 *
 * There is a single array of summaries, newest first, exactly as the server ordered
 * them. {@link active} filters it and the history renders all of it, so the two screens
 * cannot disagree about how many live baskets there are, which they would the moment
 * either kept its own copy.
 *
 * ## What keeps a second device current
 *
 * All four events are addressed to the owner's **own sessions**, so they arrive on the
 * ordinary account authenticated socket this app already holds. Generating a basket on
 * a laptop puts the card on a phone with no reload, and somebody settling a line in the
 * shop moves the count on the dashboard at home, which is the case the card exists for.
 *
 * `created`, `updated` and `deleted` carry the whole basket, so they are applied
 * directly. **A settle cannot be**, and the reason is worth stating because the obvious
 * implementation is wrong: this store holds summaries, so what it would have to update
 * is `settledLineCount`, and one line event cannot say whether that number should move.
 * The payload carries the line that was settled, redacted, and knowing that a line is
 * now finished says nothing about whether it was *already* finished and counted. So a
 * settle triggers a refetch rather than an arithmetic apply. See {@link _scheduleRefresh}
 * for why that is coalesced and why it is quiet.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9.
@Injectable()
export class GeneratedListStore {
  private readonly _service = inject<GeneratedListServiceI>(
    GENERATED_LIST_SERVICE
  );
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);

  private readonly _lists = signal<readonly GeneratedListSummary[]>([]);
  private readonly _state = signal<ShoppingListsLoad>('idle');
  private readonly _error = signal<unknown>(null);
  private readonly _cursor = signal<string | null>(null);
  private readonly _loadingMore = signal(false);

  /** The pending coalesced refresh, or null. See {@link _scheduleRefresh}. */
  private _refreshAt: ReturnType<typeof setTimeout> | null = null;

  /**
   * Whether the first page has ever been asked for.
   *
   * Two screens call {@link load} on creation and either may be first, so without this
   * the second one to open would refetch a listing already in hand. {@link reload} is
   * the deliberate way past it.
   */
  private _asked = false;

  /** Every basket the caller has, newest first, in the order the server gave them. */
  readonly lists = this._lists.asReadonly();

  /** How the listing has got on. Drives the skeleton, the empty state and the error. */
  readonly state = this._state.asReadonly();

  /** The failure behind a `failed` state, for its correlation id. */
  readonly error = this._error.asReadonly();

  /** Whether a further page is on its way, for the row at the bottom of the history. */
  readonly loadingMore = this._loadingMore.asReadonly();

  /** Whether there is a further page to ask for. */
  readonly hasMore = computed(() => this._cursor() !== null);

  /**
   * The baskets being shopped right now, newest first.
   *
   * `ACTIVE` and nothing else. `DRAFT` is composed and not yet taken to a shop, and the
   * dashboard's question is "what am I in the middle of", so a draft is not an answer
   * to it. Nothing in this app produces a draft today, since a run lands `ACTIVE`; the
   * filter is written for what the status **means** rather than for what the current
   * server happens to emit.
   */
  readonly active = computed<readonly GeneratedListSummary[]>(() =>
    this._lists().filter((list) => list.status === 'ACTIVE')
  );

  constructor() {
    // By hand, not `takeUntilDestroyed`: `@angular/core/rxjs-interop` is a secondary
    // entry point module federation does not dedupe, and a service several remotes
    // provide throws `NG0203` from it with a perfectly correct DI graph. Every other
    // store in this library says the same thing.
    const subscription = this._realtime.events.subscribe((event) => {
      switch (event.type) {
        case 'generatedList.created':
        case 'generatedList.updated':
          this._upsert(event.list);
          break;
        case 'generatedList.lineSettled':
          // Only for a basket this client is actually holding. A settle on one that
          // was never read changes nothing on screen, and refetching for it would let
          // any basket in the account drive requests from a page that is not showing
          // it.
          if (this._lists().some((list) => list.id === event.generatedListId)) {
            this._scheduleRefresh();
          }
          break;
        case 'generatedList.deleted':
          this._lists.update((lists) =>
            lists.filter((list) => list.id !== event.generatedListId)
          );
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

  /** The first page, once per app run. Safe to call from every page that reads it. */
  async load(): Promise<void> {
    if (this._asked) {
      return;
    }
    this._asked = true;
    await this.reload();
  }

  /** The first page again, discarding what is held. The retry, and the refresh. */
  async reload(): Promise<void> {
    this._asked = true;
    this._state.set('loading');
    this._error.set(null);

    try {
      const page = await this._service.listMine();
      this._lists.set(page.items);
      this._cursor.set(page.nextCursor);
      this._state.set('loaded');
    } catch (error) {
      this._error.set(error);
      this._state.set('failed');
    }
  }

  /**
   * The next page, appended.
   *
   * A failure here leaves the state `loaded` rather than moving it to `failed`, and
   * that is deliberate: the rows already on screen are good, and replacing a readable
   * history with a full page error because its fourth page did not arrive would lose
   * somebody the thing they were reading. The bottom row simply stops spinning, and
   * scrolling again retries.
   */
  async loadMore(): Promise<void> {
    const cursor = this._cursor();
    if (cursor === null || this._loadingMore() || this._state() !== 'loaded') {
      return;
    }

    this._loadingMore.set(true);
    try {
      const page = await this._service.listMine(cursor);
      // Merged rather than concatenated: a basket created while somebody was reading
      // shifts the server's window, so the same row can arrive on two pages. Appending
      // blindly would draw it twice and give `@for`'s `track` two rows with one id.
      this._lists.update((lists) => {
        const known = new Set(lists.map((list) => list.id));
        return [...lists, ...page.items.filter((item) => !known.has(item.id))];
      });
      this._cursor.set(page.nextCursor);
    } catch {
      // Deliberately swallowed. See above.
    } finally {
      this._loadingMore.set(false);
    }
  }

  /**
   * Compose a basket (plan 0045, section 3.4).
   *
   * The new run is written in straight away rather than waited for over the socket, so
   * the sheet can navigate to a card that is already there. `generatedList.created`
   * arrives a moment later and {@link _upsert} makes it the same row rather than a
   * second one.
   *
   * Failures are **thrown**, not swallowed into a state signal: the sheet stays open
   * and shows the error under its submit, which it can only do if it knows the call
   * failed. That is the opposite of {@link loadMore} and for the opposite reason: there
   * is nothing already on screen to protect, and the person is waiting on an answer.
   */
  async create(request: CreateGeneratedListRequest): Promise<GeneratedListRun> {
    const run = await this._service.create(request);
    this._upsert(run.list);
    return run;
  }

  /**
   * Refetch the first page after a settle, once per burst.
   *
   * **Coalesced**, because a settle is not a lone event: four people working through
   * one basket in a shop settle lines seconds apart, and a request each would be a
   * request per tin of tomatoes. One timer, restarted by each arrival, turns a burst
   * into a single read a moment after it stops.
   *
   * The window is short enough that the card moves while somebody is looking at it and
   * long enough to swallow a checkout's worth of taps. It is not tuned finer than that,
   * because the cost of being a second late is a number on a card being a second old.
   */
  private _scheduleRefresh(): void {
    this._cancelRefresh();
    this._refreshAt = setTimeout(() => {
      this._refreshAt = null;
      void this._refreshQuietly();
    }, SETTLE_REFRESH_MS);
  }

  private _cancelRefresh(): void {
    if (this._refreshAt !== null) {
      clearTimeout(this._refreshAt);
      this._refreshAt = null;
    }
  }

  /**
   * Read the first page again without touching the load state.
   *
   * **Quiet is the whole point.** {@link reload} moves the state to `loading`, which is
   * right for a retry and would be wrong here: the pages render a skeleton for that
   * state, so a live update would blank the very card it is updating every time
   * somebody in the shop ticked something off. A failure is swallowed for the same
   * reason `loadMore`'s is, and one step further: nobody asked for this read, so
   * nobody is owed an error for it, and what is on screen is still the truth as of the
   * last successful one.
   */
  private async _refreshQuietly(): Promise<void> {
    if (this._state() !== 'loaded') {
      return;
    }

    try {
      const page = await this._service.listMine();
      this._mergeFirstPage(page.items);
    } catch {
      // Deliberately swallowed. See above.
    }
  }

  /**
   * Lay a freshly read first page over what is held, keeping the pages behind it.
   *
   * Not `set`, which is what a first read does: somebody who has scrolled a year into
   * their history would watch it collapse back to twenty rows because a flatmate
   * settled a line. The page is authoritative for the rows it covers, including their
   * disappearance, and everything below it keeps its place.
   */
  private _mergeFirstPage(items: readonly GeneratedListSummary[]): void {
    this._lists.update((held) => {
      const covered = new Set(items.map((item) => item.id));
      return [...items, ...held.filter((list) => !covered.has(list.id))];
    });
  }

  /**
   * Insert or replace one basket, keeping the newest first order.
   *
   * Replacing in place rather than moving to the front: the order is by generation
   * time, and an edit does not regenerate anything. A basket that is genuinely new is
   * put at the front, which is where its generation time belongs.
   */
  private _upsert(list: GeneratedListSummary): void {
    this._lists.update((lists) => {
      const at = lists.findIndex((candidate) => candidate.id === list.id);
      if (at < 0) {
        return [list, ...lists];
      }

      const next = [...lists];
      next[at] = list;
      return next;
    });
  }
}
