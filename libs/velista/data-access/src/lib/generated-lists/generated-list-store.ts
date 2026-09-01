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
 * ## What keeps a second device current, and the one gap
 *
 * `generatedList.created`, `generatedList.updated` and `generatedList.deleted` are
 * addressed to the owner's own sessions, so generating a basket on a laptop puts the
 * card on a phone with no reload.
 *
 * **Settling does not reach here, and that is a real gap rather than an omission.**
 * Plan 0045 section 3.2 expects `generatedList.lineSettled` on the owner's room; core
 * publishes it with `emitToGeneratedList`, so it goes to the **basket's** room and
 * reaches whoever is holding that basket open. The owner walking round a shop is in
 * that room and sees their own progress move on the basket screen (`0044`); the owner
 * looking at the dashboard while somebody else shops is not, so the card's settled
 * count is as of the last read. It is stale by a number rather than wrong about which
 * basket is live, and {@link reload} is what the pages call to close it. Making it live
 * is a backend change (either a second emit to the owner, or the owner's room added to
 * that event's audience) and is recorded here rather than papered over with a poll.
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
        case 'generatedList.deleted':
          this._lists.update((lists) =>
            lists.filter((list) => list.id !== event.generatedListId)
          );
          break;
        default:
          break;
      }
    });

    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
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
