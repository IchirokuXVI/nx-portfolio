import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import type {
  LiveBasketSummary,
  ShoppingListsLoad,
} from '@portfolio/velista/models';
import { AppResumed } from '@portfolio/velista/platform';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';

/**
 * The three numbers the dashboard's `LIVE` card draws (velista `0091`,
 * section 5.2).
 *
 * ## Why it is not `BasketListStore`
 *
 * That store holds the account's **generated** baskets, page by page, and the
 * server leaves the permanent one out of that listing on purpose: it has no date,
 * it is never finished, and a history that listed it would offer a delete on the
 * one basket that cannot go away. So the card reads its own summary, from its own
 * route, and the two stores never have to agree about what a row means.
 *
 * ## It writes nothing
 *
 * Every write on this basket happens on the basket page, through `BasketStore`,
 * which holds the whole thing. This is three numbers for a card, so the only
 * thing it can do is ask for them again: when the dashboard opens, when the app
 * comes back, and when a basket header changes.
 *
 * **It does not hear a purchase the moment it happens**, and that is a known gap
 * rather than an oversight (velista `0090`, section 15): a basket stores no rows,
 * so a settle no longer reaches the owner's own sessions with anything in it, and
 * no backend plan yet names a successor event. The card is right on entry and on
 * resume, which is when it is read.
 *
 * App scoped and provided by the app layer, never root: it resolves
 * `BASKET_SERVICE`, so at the root it would take that token's default and serve
 * fixture numbers beside a real account (rule D5).
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9.
@Injectable()
export class LiveBasketStore {
  private readonly _service = inject<BasketServiceI>(BASKET_SERVICE);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _resumed = inject(AppResumed);

  private readonly _summary = signal<LiveBasketSummary | null>(null);
  private readonly _state = signal<ShoppingListsLoad>('idle');

  /**
   * How many reads this store has started, so a slow one cannot overwrite a fast
   * one that came after it.
   *
   * Every refetching store here holds one. Two reads are in flight whenever a
   * resume lands on a dashboard that was already asking, and the answers can
   * arrive in either order.
   */
  private _generation = 0;

  /** The counter value the resume effect last acted on. See {@link BasketStore}. */
  private _actedOnResumes = 0;

  /** Whether anything has asked yet, which is what a resume brings up to date. */
  private _asked = false;

  /** The numbers, or null before the first answer and after a failed first read. */
  readonly summary = this._summary.asReadonly();

  /** How the read has got on, which is what decides the card's skeleton. */
  readonly state = this._state.asReadonly();

  constructor() {
    // The two edges that read again, each an edge rather than a value: a reader
    // that sampled the counter could not tell "came back a moment ago" from "has
    // been here all along". Both start at zero, so the first run reads nothing.
    //
    // An `effect` and not `toObservable`: `@angular/core/rxjs-interop` is a
    // secondary entry point module federation does not dedupe, and a service
    // several remotes provide throws `NG0203` from it with a perfectly correct
    // DI graph. `effect` is core.
    effect(() => {
      const resumes = this._resumed.resumes();
      untracked(() => {
        const moved = resumes !== this._actedOnResumes;
        this._actedOnResumes = resumes;
        if (moved && this._asked) {
          void this.load();
        }
      });
    });

    // By hand, not `takeUntilDestroyed`, for the reason above.
    //
    // A basket header moved. It is the owner's **generated** baskets those events
    // are about, and this one reads a different basket, but a run that has just
    // drawn from a list is exactly the moment the permanent basket's numbers are
    // stale: the same lines are covered by both. Cheap, three numbers, and only
    // once something has asked.
    const subscription = this._realtime.events.subscribe((event) => {
      if (
        this._asked &&
        (event.type === 'basket.created' ||
          event.type === 'basket.updated' ||
          event.type === 'basket.deleted')
      ) {
        void this.load();
      }
    });

    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  /**
   * Read the summary, creating the basket on the server if this account has none.
   *
   * Safe to call from every edge that wants it current: an answer overtaken by a
   * later read is dropped rather than applied, and a failure keeps whatever
   * numbers are already on screen, because a card that empties on a flaky
   * connection is worse than one a minute old.
   */
  async load(): Promise<void> {
    this._asked = true;
    const generation = ++this._generation;

    if (this._summary() === null) {
      this._state.set('loading');
    }

    try {
      const summary = await this._service.getLiveSummary();
      if (generation !== this._generation) {
        return;
      }
      this._summary.set(summary);
      this._state.set('loaded');
    } catch {
      if (generation !== this._generation) {
        return;
      }
      // The error itself is not kept: the card has no room for a sentence and
      // no retry of its own. It draws its title and stays tappable, and the
      // basket page behind it is where a failure gets words and a Try again.
      this._state.set(this._summary() === null ? 'failed' : 'loaded');
    }
  }
}
