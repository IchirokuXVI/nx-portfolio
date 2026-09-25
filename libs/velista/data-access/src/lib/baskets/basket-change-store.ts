import {
  computed,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import type {
  Basket,
  BasketChange,
  BasketListRef,
} from '@portfolio/velista/models';
import type { BasketChangeContext } from '../mapping/basket-change-mappers';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';
import { BasketStore } from './basket-store';

/** How the changes sheet is getting on. */
export type BasketChangeLoad = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * What changed on the lists this basket covers, as the changes sheet reads it
 * (velista `0093`, section 2).
 *
 * ## Provided on the basket route, beside `BasketStore`
 *
 * The sheet is a child route of the basket page, so it is constructed and
 * destroyed while the page stays, and a store on the sheet would lose the page
 * between two openings. A route's injector is **never destroyed** by the router,
 * so nothing here is torn down by a `DestroyRef`: the page calls {@link reset}
 * from its own teardown, exactly as it does for `BasketViewStore`.
 *
 * ## It holds no clock and no window
 *
 * {@link BasketChange.unseen} is the server's answer and is read, never
 * computed. Nothing here compares a change's `at` to anything, and the
 * acknowledgement carries the **id** of what was drawn rather than a moment
 * (velista `0093`, section 7). The one timer in this feature is the display
 * dwell, and it lives on `ChangeAcknowledger` in the page.
 *
 * ## An answer a newer request overtook is dropped
 *
 * Every read takes a generation, which is `BasketStore.refresh`'s device for the
 * same failure: a read that started before an acknowledgement would otherwise
 * land afterwards and put every `unseen` flag back the way it was.
 */
// Provided by the route, not the app and not root (rule D5): it is one screen's
// subject, and it reads the basket that screen opened.
@Injectable()
export class BasketChangeStore {
  private readonly _service = inject<BasketServiceI>(BASKET_SERVICE);
  private readonly _basket = inject(BasketStore);

  private readonly _changes = signal<readonly BasketChange[]>([]);
  private readonly _state = signal<BasketChangeLoad>('idle');
  private readonly _cursor = signal<string | null>(null);
  private readonly _loadingMore = signal(false);

  /** The changes read so far, newest first. */
  readonly changes = this._changes.asReadonly();

  readonly state = this._state.asReadonly();

  /** The cursor the next page starts at, or null when there is no next page. */
  readonly nextCursor = this._cursor.asReadonly();

  /** Whether "Show more" has anything left to read. */
  readonly hasMore = computed(() => this._cursor() !== null);

  readonly loadingMore = this._loadingMore.asReadonly();

  private _generation = 0;

  /**
   * The `through` values already sent, so the same one never goes twice.
   *
   * On the store rather than on the acknowledger, because the sheet acknowledges
   * too and the two must not each send the newest id once (velista `0093`,
   * section 7).
   */
  private readonly _acknowledged = new Set<string>();

  constructor() {
    // A line changed while the sheet was open, so the sheet reads again
    // (velista `0093`, section 2). It watches the **basket**, which moves only
    // when a read lands, so the debounce `BasketStore` already applies to
    // `basket.linesChanged` is the quiet this waits out: a burst of edits by
    // somebody tidying a list at home costs one basket read and one page here.
    //
    // Nothing happens while this store is idle, which is the sheet being shut.
    //
    // An `effect` and not `toObservable`: `@angular/core/rxjs-interop` is a
    // secondary entry point module federation does not dedupe, and a service
    // several remotes provide throws `NG0203` from it with a perfectly correct
    // DI graph (velista `0001`). Every other store in this library says so too.
    //
    // The route injector is never destroyed, so this outlives the sheet and the
    // page. `reset` is what stops it doing anything.
    effect(() => {
      const basket = this._basket.basket();
      untracked(() => {
        if (basket !== null && this._state() !== 'idle') {
          void this._read('refresh');
        }
      });
    });
  }

  /**
   * The first page, read when the sheet opens.
   *
   * Always a real read, even when a page is already held: the sheet is opened to
   * find out what happened, and the cheapest wrong answer here is a stale one.
   */
  async load(): Promise<void> {
    await this._read('load');
  }

  /**
   * The next page, appended (velista `0093`, section 6).
   *
   * Answers how many arrived, which is what the sheet announces through its
   * polite region: focus stays on the button, so a reader who cannot see the
   * rows land has to be told that they did (velista `0088`, section 10).
   *
   * A failure answers `null`, which the sheet says without taking the button
   * away: the page already read is still on screen and still worth reading.
   */
  async loadMore(): Promise<number | null> {
    const basketId = this._basket.basket()?.id ?? null;
    const cursor = this._cursor();
    if (basketId === null || cursor === null || this._loadingMore()) {
      return 0;
    }

    const generation = this._generation;
    this._loadingMore.set(true);
    try {
      const page = await this._service.changes(
        basketId,
        this._context(),
        cursor
      );
      if (generation !== this._generation) {
        return 0;
      }

      // By id rather than by trusting the cursor: a change that arrived at the
      // head between the two reads shifts the page, and a duplicate row saying
      // the same thing twice is the visible half of that.
      const held = new Set(this._changes().map((change) => change.id));
      const added = page.items.filter((change) => !held.has(change.id));
      this._changes.update((changes) => [...changes, ...added]);
      this._cursor.set(page.nextCursor);
      return added.length;
    } catch {
      return null;
    } finally {
      if (generation === this._generation) {
        this._loadingMore.set(false);
      }
    }
  }

  /**
   * Tell the server this viewer has drawn everything through `through`
   * (velista `0093`, section 7).
   *
   * **Fire and forget, with one retry.** A lost request leaves the marks and the
   * banner exactly where they were, which is the safe way to be wrong: the next
   * dwell sends it again. There is no error state, because there is nothing for
   * a reader to do about it and nothing here is broken.
   *
   * One request per distinct `through`, whichever half of the screen asked. On
   * success it asks `BasketStore.refresh()` once, so the count and the marks are
   * the **server's** new answer rather than a local guess: this store never
   * decrements a number and never clears a mark.
   *
   * The caller decides **when**, and that rule is not enforceable here: only
   * while marked rows, or the sheet, were really on screen with the document
   * visible. `ChangeAcknowledger` is the one caller.
   */
  async acknowledge(through: string): Promise<void> {
    const basketId = this._basket.basket()?.id ?? null;
    if (basketId === null || this._acknowledged.has(through)) {
      return;
    }

    // Marked before the request rather than after it, so a second dwell landing
    // while this one is out cannot send the same id again. A failure takes it
    // back, which is what makes the retry the next dwell's.
    this._acknowledged.add(through);
    try {
      await this._send(basketId, through);
    } catch {
      this._acknowledged.delete(through);
      return;
    }

    await this._basket.refresh();
  }

  /**
   * Give the instance back, from the page's own teardown.
   *
   * A route's `DestroyRef` never fires, so a store left holding a previous
   * basket's changes would hand them to the next basket opened on the same
   * route. Bumping the generation is what drops every read still out.
   */
  reset(): void {
    this._generation += 1;
    this._changes.set([]);
    this._state.set('idle');
    this._cursor.set(null);
    this._loadingMore.set(false);
    this._acknowledged.clear();
  }

  /**
   * One attempt and one retry, and then silence until the next dwell.
   *
   * The retry is immediate rather than backed off: the two failures this covers
   * are a dropped packet and a gateway restarting, and a phone in a shop with no
   * signal at all is covered by doing nothing rather than by waiting.
   */
  private async _send(basketId: string, through: string): Promise<void> {
    try {
      await this._service.acknowledgeChanges(basketId, through);
    } catch {
      await this._service.acknowledgeChanges(basketId, through);
    }
  }

  /**
   * Read the first page.
   *
   * `load` draws the skeletons and can fail loudly. `refresh` keeps whatever is
   * on screen: a read that did not arrive must not replace a readable sheet with
   * a retry button, and the next change event will ask again.
   */
  private async _read(mode: 'load' | 'refresh'): Promise<void> {
    const basketId = this._basket.basket()?.id ?? null;
    if (basketId === null) {
      return;
    }

    const generation = (this._generation += 1);
    if (mode === 'load') {
      this._state.set('loading');
    }

    try {
      const page = await this._service.changes(basketId, this._context());
      if (generation !== this._generation) {
        return;
      }
      this._changes.set(page.items);
      this._cursor.set(page.nextCursor);
      this._state.set('ready');
    } catch {
      if (generation !== this._generation) {
        return;
      }
      if (mode === 'load') {
        this._state.set('failed');
      }
    }
  }

  /**
   * What the mapper resolves a change's ids against: this basket, right now.
   *
   * Built per read rather than held, because the basket behind it is replaced
   * whole on every refresh (velista `0086`, section 2) and a context captured
   * once would name people and lists from a basket nobody is looking at.
   */
  private _context(): BasketChangeContext {
    const basket = this._basket.basket();

    return {
      nameFor: (participantId, userId) =>
        nameFor(basket, participantId, userId),
      listFor: (listId) => listFor(basket, listId),
      contentFor: (rowKey) =>
        basket?.rows.find((row) => row.rowKey === rowKey)?.content ?? null,
    };
  }
}

/**
 * The name this client can put to an actor, or null.
 *
 * `Basket.participants` is the whole of it, and it answers both keys: a
 * participant's own id, and the `userId` of a registered one. An account on no
 * participant row answers null, and so does a guest who typed nothing, which the
 * sheet draws as "Someone" rather than as a blank.
 *
 * **A household member who is not on the basket therefore reads as "Someone",**
 * although the reader could in principle name them: backend `0138` serves that
 * person as a bare `userId` beside a served `listId`, on the reasoning that a
 * reader who can write the list is in its zone and already resolves them. The
 * basket page holds no zone memberships, so resolving it would mean a read per
 * covered zone on the one screen that already makes the largest read in the app,
 * for a caption. Velista `0093` section 2 asks for it; it is deferred on that
 * cost, and the redaction is unaffected either way — the name is less specific
 * than it could be, never wider.
 *
 * A **name and not a role word**: the owner with no username resolves to null
 * here, because "Owner" is a word the sheet has a translator for and this
 * library does not.
 */
function nameFor(
  basket: Basket | null,
  participantId: string | null,
  userId: string | null
): string | null {
  const person = basket?.participants.find(
    (candidate) =>
      (participantId !== null && candidate.id === participantId) ||
      (userId !== null && candidate.userId === userId)
  );
  if (person === undefined) {
    return null;
  }

  // Typed on purpose wins, as it does everywhere a participant is named: a
  // signed in person who wrote a name on the join screen said it deliberately.
  return person.displayName ?? person.username ?? null;
}

/** One covered list this reader was served, by id, or null. */
function listFor(basket: Basket | null, listId: string): BasketListRef | null {
  return basket?.lists.find((list) => list.listId === listId) ?? null;
}
