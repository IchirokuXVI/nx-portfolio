import { computed, inject, Injectable, signal } from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  composeListView,
  DEFAULT_LIST_VIEW_STATE,
  foldForSearch,
  inLocale,
  lineCategories,
  listCategoryCounts,
  listViewActiveCount,
  listViewHoldsReorder,
  NO_CATEGORY,
  pickedListCategory,
  type Line,
  type ListCategoryPick,
  type ListView,
  type ListViewContext,
  type ListViewLine,
  type ListViewMode,
  type ListViewOrder,
  type ListViewState,
} from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { ItemNames } from '../catalog/item-names';
import { LineStore } from '../lines/line-store';
import {
  NO_LIST_VIEW_MEMORY,
  parseListViewMemory,
  rememberListView,
  type ListViewMemory,
} from './list-view-memory';

/**
 * What the zone list page draws of a list, as opposed to what the list holds
 * (velista `0082`).
 *
 * {@link LineStore} answers what is on the list. This answers which of it is on the
 * screen, in what order, and under which heading: the search, A to Z, and one category
 * at a time. The rules are `composeListView` in `models`; this holds the choices and
 * the lookups the rules need.
 *
 * ## Provided on the route, and handed back
 *
 * Beside the list page in `routes.ts`, so the filter sheet, which is a child route,
 * reaches the same instance the page reads. A route's injector is never destroyed
 * here, so the instance outlives the page: {@link leave} is what the page calls from
 * its own teardown, as the basket page does with `BasketViewStore.leave()`.
 *
 * ## Why it translates
 *
 * The search matches a category's label in the reader's language (section 6). The
 * label is words, so it needs the translator, and the sheet's footer count has to be
 * the same number the page draws, so the matching cannot live in the page alone.
 */
@Injectable()
export class ListViewStore {
  private readonly _lines = inject(LineStore);
  private readonly _items = inject(ItemNames);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _browser = inject(BrowserFacade);

  /** The list on screen, or null before the page opens one and after it leaves. */
  private readonly _listId = signal<string | null>(null);

  private readonly _query = signal('');

  /** What is in the search field, exactly as it was typed. */
  readonly query = this._query.asReadonly();

  /** The query folded once, for the rows to draw their `<mark>` from. */
  readonly folded = computed(() => foldForSearch(this._query()));

  /** Whether anything is being searched for. */
  readonly searching = computed(() => this.folded() !== '');

  private readonly _state = signal<ListViewState>(DEFAULT_LIST_VIEW_STATE);

  readonly state = this._state.asReadonly();

  readonly order = computed(() => this._state().order);

  readonly view = computed(() => this._state().view);

  /** The category chosen in the sheet, which may be set while the view is not. */
  readonly category = computed(() => this._state().category);

  /** The category the page is filtered to, or null. */
  readonly picked = computed(() => pickedListCategory(this._state()));

  /** The list's lines as the store holds them, in no particular order. */
  private readonly _source = computed<readonly Line[]>(() => {
    const listId = this._listId();
    return listId === null ? [] : this._lines.linesIn(listId);
  });

  /**
   * Every line's categories, by line id (section 3).
   *
   * Recomputed as products resolve: `ItemNames` is a signal, so a line counted under
   * "No category" moves to its aisle the moment its products load.
   */
  private readonly _categories = computed(() => {
    const byLine = new Map<string, readonly ListCategoryPick[]>();
    for (const line of this._source()) {
      byLine.set(
        line.id,
        lineCategories(line.itemIds, (itemId) => this._items.nameOf(itemId))
      );
    }
    return byLine;
  });

  /** Every line's product names, in the reader's language. */
  private readonly _productNames = computed(() => {
    const locale = this._locale();
    const byLine = new Map<string, readonly string[]>();
    for (const line of this._source()) {
      const names: string[] = [];
      for (const itemId of line.itemIds) {
        const item = this._items.nameOf(itemId);
        if (item !== null) {
          names.push(inLocale(item.name, locale));
        }
      }
      byLine.set(line.id, names);
    }
    return byLine;
  });

  private readonly _context = computed<ListViewContext>(() => {
    const locale = this._locale();
    const categories = this._categories();
    const names = this._productNames();
    return {
      query: this._query(),
      locale,
      // A line the store does not hold yet, such as an optimistic row whose id is
      // still the client's, has no products to read and is "No category".
      categoriesOf: (lineId) => categories.get(lineId) ?? [NO_CATEGORY],
      productNamesOf: (lineId) => names.get(lineId) ?? [],
      categoryLabel: (category) =>
        this._translator.t(`basket.category.${category}`, undefined, locale),
    };
  });

  /**
   * The categories on this list and how many lines hold each, for the sheet.
   *
   * Counted over **every** line and not over what a search left standing: the sheet
   * says what the list holds, and a radio that vanished while somebody typed would be
   * unusable.
   */
  readonly categoryCounts = computed(() =>
    listCategoryCounts(this._source(), (lineId) =>
      this._context().categoriesOf(lineId)
    )
  );

  /** How many settings are on, for the filter button's badge. */
  readonly activeCount = computed(() => listViewActiveCount(this._state()));

  /** Whether the reorder action has to wait for the list order (section 7). */
  readonly holdsReorder = computed(() =>
    listViewHoldsReorder(this._state(), this._query())
  );

  /** How many lines the page draws, for the sheet's footer. */
  readonly visibleCount = computed(
    () => this.compose(this._source()).lines.length
  );

  /**
   * The page's rows, narrowed and ordered.
   *
   * Generic, so the page hands in its own view models in list order and gets the same
   * objects back. Reads signals, so a `computed` calling it redraws when any of the
   * choices or the products change.
   */
  compose<T extends ListViewLine>(rows: readonly T[]): ListView<T> {
    return composeListView(rows, this._state(), this._context());
  }

  /**
   * The page has a list to show, which is also the moment the order is restored.
   *
   * Another list in the same page instance starts from what the device remembers,
   * with no search and all lines: the router reuses the page, and the search and the
   * category are about the list that was left.
   */
  open(listId: string): void {
    if (this._listId() === listId) {
      return;
    }

    this._listId.set(listId);
    this._query.set('');
    this._state.set(DEFAULT_LIST_VIEW_STATE);
    this._restore();
  }

  /** Search for this, or for nothing when it is empty. */
  search(query: string): void {
    this._query.set(query);
  }

  setOrder(order: ListViewOrder): void {
    this._state.update((state) => ({ ...state, order }));
    this._store((memory, now) => rememberListView(memory, 'order', order, now));
  }

  /**
   * "All lines" or "One category".
   *
   * Choosing "One category" **applies nothing** until a category is picked, which is
   * what keeps the page still while the sheet asks which one (section 4). Choosing
   * "All lines" forgets the category, so choosing "One category" again asks again.
   */
  setView(view: ListViewMode): void {
    this._state.update((state) => ({
      ...state,
      view,
      category: view === 'all' ? null : state.category,
    }));
    this._store((memory, now) => rememberListView(memory, 'view', view, now));
  }

  /** Show only the lines holding this category. */
  pickCategory(category: ListCategoryPick): void {
    this._state.update((state) => ({ ...state, view: 'category', category }));
  }

  /**
   * The sheet is closing. "One category" with nothing picked goes back to "All lines"
   * (section 4), so the sheet never reopens on a question left unanswered.
   */
  settle(): void {
    const state = this._state();
    if (state.view === 'category' && state.category === null) {
      this._state.set({ ...state, view: 'all' });
    }
  }

  /** The sheet's Reset: both sections back to their defaults. The search stays. */
  reset(): void {
    this._state.set(DEFAULT_LIST_VIEW_STATE);
    this._write(NO_LIST_VIEW_MEMORY);
  }

  /**
   * Give the instance back, because the page holding it has been left.
   *
   * Called from the page's teardown, because the `DestroyRef` this class can reach
   * never fires. The next list starts unsearched and on all lines, and `open`
   * restores its order.
   */
  leave(): void {
    this._listId.set(null);
    this._query.set('');
    this._state.set(DEFAULT_LIST_VIEW_STATE);
  }

  /**
   * Apply what this device remembers, once.
   *
   * Only the order: `view` has the `'visit'` lifetime and is never written, so a record
   * that holds one anyway was written by some other build and is ignored.
   */
  private _restore(): void {
    const order = this._read()?.order?.value;
    if (order !== undefined) {
      this._state.update((state) => ({ ...state, order }));
    }
  }

  private _read(): ListViewMemory | null {
    return parseListViewMemory(this._browser.readStorage(StorageKeys.listView));
  }

  private _write(memory: ListViewMemory): void {
    this._browser.writeStorage(StorageKeys.listView, JSON.stringify(memory));
  }

  /** Read, change, write, so each property keeps its own date. */
  private _store(
    change: (memory: ListViewMemory, now: number) => ListViewMemory
  ): void {
    this._write(change(this._read() ?? NO_LIST_VIEW_MEMORY, Date.now()));
  }
}
