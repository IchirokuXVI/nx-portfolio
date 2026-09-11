import {
  computed,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import {
  foldForSearch,
  matchesBasketLine,
  type BasketLine,
} from '@portfolio/velista/models';
import { BasketStore } from './basket-store';

/**
 * What the basket page actually draws, as opposed to what the basket holds
 * (velista `0074`, section 4.3).
 *
 * ## Why it is a second store
 *
 * {@link BasketStore} answers what is on this shopping trip. This answers which of
 * it is on the screen, and the two are different questions: `BasketStore.lines`
 * stays exactly what the server said, and `BasketStore.progress` keeps counting the
 * whole basket, so a search that hides eight rows never changes what "4 of 12 got"
 * means. Everything a control on the page decides about the view lands here, and
 * `0075` to `0078` grow {@link visibleLines} into the rest of the pipeline.
 *
 * ## Why it is provided on the route
 *
 * Beside `BasketStore` in `routes.ts`, and for the reason `BasketStore` is there:
 * the sheets that set these controls are **child routes of the page**, not children
 * of its component, and a store provided on the component is not one a sibling route
 * can be sure to reach.
 *
 * That has the consequence the store beside it already carries: Angular caches a
 * route's environment injector on the route config and destroys it only under
 * `withExperimentalAutoCleanupInjectors()`, so this instance is handed back on the
 * next visit and nothing here is ever torn down. {@link leave} is what the page
 * calls instead, from its own teardown, which is the one place a departure is
 * certain.
 */
@Injectable()
export class BasketViewStore {
  private readonly _basket = inject(BasketStore);
  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _query = signal('');

  /** What is in the search field, exactly as it was typed. */
  readonly query = this._query.asReadonly();

  /** Whether anything is being searched for, which is not the same as the field being open. */
  readonly searching = computed(() => this._query() !== '');

  /**
   * The query folded once, for the row to draw its `<mark>` from.
   *
   * Folded here rather than by each row: a basket is a dozen rows deep and the
   * answer is the same for all of them.
   */
  readonly folded = computed(() => foldForSearch(this._query()));

  /**
   * The lines the page draws, in the order the basket holds them.
   *
   * **Never reordered.** The search hides rows and does nothing else, so the
   * position of what is left is still the position the server gave it, which is the
   * order `0075` goes on to decide.
   *
   * The whole array when nothing is being searched for, by identity and not by a
   * copy, so an untouched basket costs nothing at all.
   */
  readonly visibleLines = computed<readonly BasketLine[]>(() => {
    const query = this._query();
    const lines = this._basket.lines();
    if (query === '') {
      return lines;
    }

    const products = this._basket.products();
    const locale = this._locale();
    return lines.filter((line) =>
      matchesBasketLine(line, products.get(line.pickId ?? ''), query, locale)
    );
  });

  /**
   * Clear the search when this reader's **own** line lands (section 4.6).
   *
   * The thing somebody searched for and did not find is very often the next line
   * they add, and a row that arrived hidden by the search that failed to find it is
   * a row somebody types a second time. So the add wins and the query goes.
   *
   * `createdBy` is what makes it the reader's own. `BasketStore.lastAdded` is set
   * for every line that arrives, including the four other people's, and clearing the
   * query because somebody across the shop typed something would take the screen out
   * from under the person holding this phone.
   */
  private readonly _clearOnOwnAdd = effect(() => {
    const added = this._basket.lastAdded();
    if (added === null) {
      return;
    }
    // The arrival is the only thing this watches. Who the reader is has nothing to
    // say about when the query should go, so reading it here would re-run the whole
    // effect on a participant list that merely refreshed.
    untracked(() => {
      if (added.createdBy === (this._basket.me()?.id ?? null)) {
        this._query.set('');
      }
    });
  });

  /** Search for this, or for nothing when it is empty. */
  search(query: string): void {
    this._query.set(query);
  }

  /**
   * Give the basket back, because the screen holding it has been left.
   *
   * Called from the page's own teardown beside `BasketStore.leave`, for the reason
   * written on that method: the `DestroyRef` this class can reach never fires. A
   * basket opened later must not start searched, because the search is the one thing
   * on this screen that is never remembered (`0076` names what is, and this is not on
   * the list).
   */
  leave(): void {
    this._query.set('');
  }
}
