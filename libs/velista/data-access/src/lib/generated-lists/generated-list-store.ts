import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import {
  isLiveGeneratedList,
  type CreateGeneratedListRequest,
  type GeneratedListRun,
  type GeneratedListStatus,
  type GeneratedListSummary,
  type ShoppingListsLoad,
  type WritableGeneratedListStatus,
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
  private readonly _pagesLoaded = signal(0);

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
   * How many pages of results have landed, counting from zero (plan 0049, section 6).
   *
   * The history's live region is driven off this rather than off the row count, and the
   * difference is a screen reader user standing in a shop. A region keyed on the count
   * re-reads the whole total every time a flatmate settles a line, because the quiet
   * refresh can change it; a region keyed on this speaks once when a page arrives and
   * stays silent for everything else. It is deliberately **not** a page *number*: what
   * the page needs is a value that changes exactly when new results have been drawn,
   * and a first read after a retry is new results.
   *
   * {@link _refreshQuietly} does not touch it, which is the whole reason it exists.
   */
  readonly pagesLoaded = this._pagesLoaded.asReadonly();

  /**
   * The baskets being shopped right now, newest first.
   *
   * The live pair, `DRAFT` and `ACTIVE` both, through {@link isLiveGeneratedList}.
   *
   * **This used to read `status === 'ACTIVE'` and therefore never matched anything.**
   * The paragraph that stood here argued that a draft is composed and not yet taken to
   * a shop, so it is not an answer to "what am I in the middle of", and closed by
   * asserting that nothing in this app produces a draft anyway because a run lands
   * `ACTIVE`. The second half was simply wrong about the server: core composes a run as
   * `DRAFT` and has no path that promotes one, so every basket velista has ever
   * generated was filtered out here and the dashboard card drew for nobody. The first
   * half does not survive it either. A basket composed minutes ago and not yet finished
   * **is** the thing somebody is in the middle of, whatever the column calls it, and
   * the way back into it is the only reason this signal exists.
   */
  readonly active = computed<readonly GeneratedListSummary[]>(() =>
    this._lists().filter((list) => isLiveGeneratedList(list.status))
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
        case 'generatedList.lineUpdated':
          // Only for a basket this client is actually holding. A settle on one that
          // was never read changes nothing on screen, and refetching for it would let
          // any basket in the account drive requests from a page that is not showing
          // it.
          //
          // `lineUpdated` joined it with velista `0048`, which is when this client
          // learned the name at all. It is an edit rather than a settle, so it can
          // move `lineCount` where a settle moves `settledLineCount`, and neither can
          // be derived from one line: the summary says how many lines are finished,
          // and knowing that one of them moved says nothing about whether it had
          // already been counted. Both refetch, and the refetch is coalesced.
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
      this._pagesLoaded.update((n) => n + 1);
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
      this._pagesLoaded.update((n) => n + 1);
    } catch {
      // Deliberately swallowed. See above. Nothing landed, so nothing is announced.
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
   * Finish a trip, or take it back to being one (velista `0057`, section 10).
   *
   * **Optimistic, unlike everything else this store writes**, and the screen is why.
   * `create` can afford to wait because a sheet is showing a spinner over it; this is
   * pressed on the basket screen, where the whole answer is a banner appearing and a
   * page's worth of controls going away, and a round trip of nothing happening in a
   * shop reads as a button that did not work. So the status is flipped here, the
   * request goes out behind it, and a failure puts back exactly the status the row
   * held before rather than a guess at what it should be.
   *
   * The flip is a no-op when the listing has never been read, which is the ordinary
   * case for this caller: a basket opened from a link or from the dashboard card has
   * no row here to move. The write still goes out, and the socket's
   * `generatedList.updated` is what fills the listing in when it is next read.
   *
   * **False rather than a throw on failure**, matching the row writes on
   * `BasketStore`: the caller is a page that has to decide whether to say something,
   * not a sheet that stays open on an error.
   */
  async setStatus(
    generatedListId: string,
    status: WritableGeneratedListStatus
  ): Promise<boolean> {
    const before = this._lists().find((list) => list.id === generatedListId);
    this._setStatusLocally(generatedListId, status);

    try {
      await this._service.setStatus(generatedListId, status);
      return true;
    } catch {
      if (before !== undefined) {
        this._setStatusLocally(generatedListId, before.status);
      }
      return false;
    }
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
  /**
   * Move one held row's status and leave everything else about it alone.
   *
   * Both halves of {@link setStatus} go through this, the flip and the rollback, so
   * the two cannot disagree about what "put it back" means. Nothing happens for a
   * basket this store is not holding, which is the ordinary case for a basket screen
   * opened without the history ever having been read.
   */
  private _setStatusLocally(
    generatedListId: string,
    status: GeneratedListStatus
  ): void {
    this._lists.update((lists) =>
      lists.map((list) =>
        list.id === generatedListId ? { ...list, status } : list
      )
    );
  }

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
