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
  basketViewActiveCount,
  basketViewChips,
  basketViewLines,
  composeBasketView,
  DEFAULT_BASKET_VIEW_STATE,
  foldForSearch,
  resetBasketViewProperty,
  type BasketGrouping,
  type BasketLine,
  type BasketOrder,
  type BasketViewProperty,
  type BasketViewState,
} from '@portfolio/velista/models';
import { BasketStore } from './basket-store';

/** One row of the filter sheet's LISTS section, and of nothing else. */
export interface BasketSourceList {
  readonly id: string;
  readonly name: string;
  /** How many of the basket's lines reach this list, for the trailing number. */
  readonly lines: number;
}

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
   * Everything the filter sheet decides (velista `0075`, section 2).
   *
   * One signal holding the four properties rather than four signals, because the
   * chip row, the badge and `reset` all ask about the whole of it at once, and
   * `0076` stores and restores it as one record.
   */
  private readonly _state = signal<BasketViewState>(DEFAULT_BASKET_VIEW_STATE);

  readonly state = this._state.asReadonly();

  readonly order = computed(() => this._state().order);

  readonly grouping = computed(() => this._state().grouping);

  readonly shop = computed(() => this._state().shop);

  /** The kept source lists, or null for all of them. See {@link keptLists}. */
  readonly lists = computed(() => this._state().lists);

  /**
   * The source lists the filter offers, named and counted (section 6).
   *
   * Taken from the run's own `sources` rather than from the lines, so a list the
   * basket drew from is offered even when every line it contributed has since gone:
   * it is still one of the households this basket is about, and a checkbox that
   * appears and disappears as lines are bought would be unusable.
   *
   * **A source with no name is dropped.** That is the rule the row's "from" caption
   * follows for the same data, and here it matters more: a checkbox with no words is
   * a control nobody can act on. Empty for a reader who may not see origins at all,
   * which is what keeps the whole section out of a guest's sheet without a
   * `seesZoneData` branch anywhere in the template.
   */
  readonly sourceLists = computed<readonly BasketSourceList[]>(() => {
    const sources = this._basket.basket()?.sources ?? [];
    if (sources.length === 0) {
      return [];
    }

    const names = this._basket.listNames();
    const lines = this._basket.lines();

    const offered: BasketSourceList[] = [];
    // By id and not by source row: one list reached by two zones would otherwise be
    // drawn twice, and the two checkboxes would set the same thing.
    const seen = new Set<string>();
    for (const source of sources) {
      if (seen.has(source.listId)) {
        continue;
      }
      const name = names.get(source.listId);
      if (name === undefined || name === '') {
        continue;
      }
      seen.add(source.listId);
      offered.push({
        id: source.listId,
        name,
        lines: lines.filter((line) =>
          (line.origins ?? []).some((origin) => origin.listId === source.listId)
        ).length,
      });
    }
    return offered;
  });

  /**
   * Which lists are kept, as a set that is never null.
   *
   * What the sheet's checkboxes read. The state's own null means "all of them",
   * which is the default and therefore unchipped, and resolving it here is what lets
   * the template ask one question per row instead of two.
   */
  readonly keptLists = computed<ReadonlySet<string>>(() => {
    const chosen = this._state().lists;
    return chosen ?? new Set(this.sourceLists().map((source) => source.id));
  });

  /**
   * The sections the page draws: filtered, ordered, then cut up (section 3).
   *
   * A `computed` over `BasketStore.lines` and nothing else, which is what makes
   * realtime free: `apply`, `append`, `drop` and a whole `refresh` all flow through
   * here, so a line that arrives lands in its section with nothing subscribed to
   * anything (section 7).
   */
  readonly sections = computed(() =>
    composeBasketView(this._basket.lines(), this._state(), {
      query: this._query(),
      products: this._basket.products(),
      locale: this._locale(),
    })
  );

  /**
   * The distinct lines on the screen, in the order they are drawn.
   *
   * `0074` answered this by identity for an untouched basket. It cannot any more:
   * every line in a section is wrapped in a row, so the flat list is read back out
   * of the rows and is a new array each time. The lines themselves are still the
   * store's own objects, which is what `track line.id` and every row input depend
   * on, and a dozen wrappers per redraw does not pay for a second code path.
   */
  readonly visibleLines = computed<readonly BasketLine[]>(() =>
    basketViewLines(this.sections())
  );

  /**
   * How many lines the page is showing, which is what the sheet's button and the
   * chip row's count both say.
   *
   * One answer and not two: a line drawn once per list by `0077` counts once here,
   * so a basket grouped by list cannot report more lines than it has.
   */
  readonly visibleCount = computed(() => this.visibleLines().length);

  /** How many of the four properties are on, for the filter button's badge. */
  readonly activeCount = computed(() => basketViewActiveCount(this._state()));

  /**
   * The chips the page draws, as keys and arguments rather than words.
   *
   * Keys, because this store has no translator and should not: the page resolves
   * them, and every spec asserts on the key and its arguments rather than on
   * rendered text.
   */
  readonly chips = computed(() =>
    basketViewChips(this._state(), {
      listNames: this._basket.listNames(),
      listCount: this.sourceLists().length,
      // `0078` names the chain of the chosen shop. Until it does, a chosen shop is
      // unreachable, because that plan draws the only control that sets one.
      chainName: null,
    })
  );

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

  // --- The filter sheet's four properties (velista `0075`) -------------------
  //
  // Every setter applies **immediately**: the page behind the scrim redraws as the
  // radio is tapped. There is no draft and no apply step, for two reasons. The count
  // on the sheet's own button is then the truth rather than a prediction; and `0078`
  // leaves this sheet for the shop picker and comes back, which a draft held in the
  // sheet's component would not survive.

  setOrder(order: BasketOrder): void {
    this._state.update((state) => ({ ...state, order }));
  }

  setGrouping(grouping: BasketGrouping): void {
    this._state.update((state) => ({ ...state, grouping }));
  }

  setShop(shop: string | null): void {
    this._state.update((state) => ({ ...state, shop }));
  }

  /**
   * Keep or drop one source list (section 6).
   *
   * **Unchecking the last kept list is refused**, and refused by doing nothing, so
   * the checkbox does not move: a filter that keeps nothing is not a filter, and the
   * honest way to say so is that the control will not go there. The alternative,
   * disabling the last checked box, would make the sheet change shape as the second
   * to last one is unchecked.
   *
   * Keeping everything collapses back to null, which is the default: the view is the
   * same either way, and a set holding every list would leave a chip on the page
   * saying a filter is on when none is.
   */
  toggleList(listId: string): void {
    const all = this.sourceLists().map((source) => source.id);
    const kept = new Set(this._state().lists ?? all);

    if (kept.has(listId)) {
      if (kept.size <= 1) {
        return;
      }
      kept.delete(listId);
    } else {
      kept.add(listId);
    }

    const lists = kept.size === all.length ? null : kept;
    this._state.update((state) => ({ ...state, lists }));
  }

  /** Put one property back to its default, which is what a chip's x does. */
  resetProperty(property: BasketViewProperty): void {
    this._state.update((state) => resetBasketViewProperty(state, property));
  }

  /**
   * Put every property back, which is the sheet's Reset.
   *
   * The **search is left alone**. Reset is a control in the filter sheet and the
   * search is a field on the page behind it, so clearing what somebody typed from a
   * sheet they opened to change the order would be a surprise; and the search has a
   * Cancel of its own two taps away.
   */
  reset(): void {
    this._state.set(DEFAULT_BASKET_VIEW_STATE);
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
    // The whole view state and not only the search. `0076` is what restores the two
    // properties a shopper keeps, and it restores them when the **next** basket
    // loads: leaving has to put this back to the defaults regardless, or a basket
    // opened with nothing stored would start on the last one's order.
    this._state.set(DEFAULT_BASKET_VIEW_STATE);
  }
}
