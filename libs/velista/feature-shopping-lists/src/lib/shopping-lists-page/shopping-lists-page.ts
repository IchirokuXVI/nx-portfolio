import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketListStore,
  GatewayError,
  LiveBasketStore,
  NetworkError,
  SharedListStore,
} from '@portfolio/velista/data-access';
import {
  displayNames,
  formatGeneratedDate,
  isOpenBasket,
  outcomeBreakdown,
  type BasketSummary,
  type SharedListRowVm,
  type ShoppingListRowVm,
  type ShoppingListsState,
} from '@portfolio/velista/models';
import {
  BrowserFacade,
  PageNavigation,
  sheetSegments,
} from '@portfolio/velista/platform';
import {
  BasketIcon,
  BottomActionBar,
  ChevronLeftIcon,
  EmptyState,
  ErrorState,
  RowSkeleton,
  tabElementId,
  tabPanelId,
  Tabs,
  type TabItem,
} from '@portfolio/velista/ui';
import { BASKET_PATHS } from '../basket-paths';
import { LiveBasketRow } from '../live-basket-row/live-basket-row';
import { ShoppingListRow } from '../shopping-list-row/shopping-list-row';

/** The two tabs of the history (velista `0085`, section 5). */
export type HistoryTab = 'mine' | 'shared';

/** The query parameter the chosen tab lives in, so a reload and back keep it. */
const TAB_PARAM = 'tab';

/** Prefixes the ids of the tabs and their panels. */
const TABS_ID = 'history';

/** Every state the Shared lists tab can be in. The history's own, over its own rows. */
export type SharedListsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'populated';
      readonly rows: readonly SharedListRowVm[];
      readonly loadingMore: boolean;
    }
  | { readonly kind: 'error'; readonly correlationId: string | null };

/**
 * Every shopping list this account has ever generated, newest first (plan 0045,
 * section 3.3).
 *
 * The container, and the only thing here that touches a store (rule D1). Its one piece
 * of presentation logic is choosing which state to render, and that is a `computed`
 * over `BasketListStore` rather than a pure function of its own: unlike the
 * dashboard, this page has exactly one source and four states, so a separate selector
 * would be a function that forwards four signals and tests nothing that the store's own
 * spec does not already cover.
 *
 * ## What this page cannot do, on purpose
 *
 * **It cannot delete anything.** No swipe, no overflow, no confirm. Backend `0050`
 * section 7 keeps deletion in the API and no screen offers it: a history that cannot
 * lose entries is the point of keeping one. Archiving is out with it, since a screen
 * that could hide a trip but not remove it would be the confusing half of the feature.
 *
 * ## Why the whole listing is named at once
 *
 * An unnamed trip displays as its generation date, and a second unnamed one on the same
 * day is numbered against the first, so a row's name depends on the rows around it.
 * `displayNames` runs over everything the store holds rather than over the page just
 * appended, which is what keeps the numbering stable as older pages arrive: numbering
 * within a page would renumber the rows above whenever a new one loaded.
 *
 * ## Two tabs, each read when it is first shown
 *
 * "My lists" is the page as it always was, and "Shared lists" is the baskets other
 * people shared with the reader (velista `0085`, section 5). The chosen tab is the
 * `tab=shared` query parameter, so a reload and the back button keep it, and each
 * tab's store is asked for its first page only when that tab is first on screen: a
 * reader who never opens Shared lists costs the server nothing for it.
 */
@Component({
  selector: 'lib-shopping-lists-page',
  imports: [
    RokuTranslatorPipe,
    BasketIcon,
    BottomActionBar,
    ChevronLeftIcon,
    EmptyState,
    ErrorState,
    LiveBasketRow,
    RouterOutlet,
    RowSkeleton,
    ShoppingListRow,
    Tabs,
  ],
  templateUrl: './shopping-lists-page.html',
  styleUrl: './shopping-lists-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShoppingListsPage {
  private readonly _generated = inject(BasketListStore);
  private readonly _shared = inject(SharedListStore);
  private readonly _liveBasket = inject(LiveBasketStore);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _browser = inject(BrowserFacade);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _correlationId = computed(() =>
    correlationIdOf(this._generated.error())
  );

  /** The tab on screen, read from the query parameter. */
  readonly tab = signal<HistoryTab>(
    tabOf(this._route.snapshot.queryParamMap.get(TAB_PARAM))
  );

  readonly tabs: readonly TabItem[] = [
    { id: 'mine', labelKey: 'history.tabs.mine' },
    { id: 'shared', labelKey: 'history.tabs.shared' },
  ];

  readonly tabsId = TABS_ID;

  /** The id of a tab, which labels the panel it controls. */
  tabId(id: HistoryTab): string {
    return tabElementId(TABS_ID, id);
  }

  /** The id of the panel a tab controls. */
  panelId(id: HistoryTab): string {
    return tabPanelId(TABS_ID, id);
  }

  /**
   * The live basket's pending count for its row at the top of My lists (velista
   * `0111`), or null while its summary is on its way or would not load.
   *
   * The row is drawn in every state of the tab, above the generated baskets and
   * outside their date order and their paging: it is the basket that is always there,
   * so it is the one row that never depends on the listing having answered.
   */
  readonly livePending = computed(
    () => this._liveBasket.summary()?.pending ?? null
  );

  private readonly _names = computed(() => {
    const locale = this._locale();
    return displayNames(this._generated.lists(), (date) =>
      formatGeneratedDate(date, locale)
    );
  });

  readonly state = computed<ShoppingListsState>(() => {
    const load = this._generated.state();

    if (load === 'failed') {
      return { kind: 'error', correlationId: this._correlationId() };
    }

    // `idle` counts as loading, for `selectHomeState`'s reason: the store's first read
    // starts in this component's constructor, so idle is the instant before it happens
    // and rendering "no shopping lists yet" in it would flash the empty state at
    // somebody who has a hundred.
    if (load === 'idle' || load === 'loading') {
      return { kind: 'loading' };
    }

    // The permanent basket is never a row here (velista `0091`, section 6). The
    // server already leaves it out of "mine", and this drops it anyway, in one
    // place, because of what a row **is**: a date, a Finished badge and a delete,
    // over the one basket that has no date, is never finished and cannot go away.
    const lists = this._generated
      .lists()
      .filter((list) => list.kind !== 'LIVE');
    if (lists.length === 0) {
      return { kind: 'empty' };
    }

    const names = this._names();
    return {
      kind: 'populated',
      rows: lists.map((list) => rowOf(list, names)),
      loadingMore: this._generated.loadingMore(),
    };
  });

  private readonly _sharedNames = computed(() => {
    const locale = this._locale();
    return displayNames(this._shared.lists(), (date) =>
      formatGeneratedDate(date, locale)
    );
  });

  /**
   * The Shared lists tab, in the history's four states.
   *
   * A shared row is a row of the reader's own lists plus who shared it and when. The
   * date is formatted here with `Intl`, in the reader's language, and put beside the
   * instant it came from (`velista-ui-rules`).
   */
  readonly sharedState = computed<SharedListsState>(() => {
    const load = this._shared.state();

    if (load === 'failed') {
      return {
        kind: 'error',
        correlationId: correlationIdOf(this._shared.error()),
      };
    }
    if (load === 'idle' || load === 'loading') {
      return { kind: 'loading' };
    }

    const lists = this._shared.lists();
    if (lists.length === 0) {
      return { kind: 'empty' };
    }

    const names = this._sharedNames();
    const locale = this._locale();
    return {
      kind: 'populated',
      rows: lists.map((list) => ({
        ...rowOf(list, names),
        // Whose everything to buy this is (velista `0091`, section 6). A shared
        // permanent basket has no name and no date, so the owner's name is the
        // only thing that tells two of them apart, and `displayNames` would have
        // titled it by the day the server made it.
        ...(list.kind === 'LIVE'
          ? {
              name: this._translator.t(
                'basket.live.titleOf',
                undefined,
                locale,
                { name: list.owner.name }
              ),
            }
          : {}),
        ownerName: list.owner.name,
        sharedAt: list.sharedAt,
        sharedOn: formatGeneratedDate(list.sharedAt, locale),
      })),
      loadingMore: this._shared.loadingMore(),
    };
  });

  readonly hasMore = computed(() =>
    this.tab() === 'shared' ? this._shared.hasMore() : this._generated.hasMore()
  );

  /**
   * What a screen reader is told when a page of results lands.
   *
   * The **count**, announced once per page rather than once per row (section 7). A live
   * region per row would read a hundred rows aloud on the way down; this says how many
   * there now are, which is the fact somebody scrolling actually wants confirmed.
   *
   * Written by {@link _announcePages} rather than interpolated in the template, and
   * that is the fix rather than a preference (plan 0049, section 6). The region used to
   * render the row count straight, so it re-read the total on **every** change to it,
   * including the quiet refetch a flatmate's settle triggers. Somebody standing in a
   * shop heard their whole history re-announced each time anybody bought anything.
   */
  readonly announced = signal('');

  constructor() {
    // The tab follows the URL, so back and forward between two query strings move it.
    // A plain subscription torn down by hand: `rxjs-interop` is not deduplicated by
    // module federation.
    const subscription = this._route.queryParamMap.subscribe((params) =>
      this.tab.set(tabOf(params.get(TAB_PARAM)))
    );
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());

    // Each tab's first page, the first time that tab is on screen, and never again
    // from here: coming back to a tab shows what it already holds.
    const shown = new Set<HistoryTab>();
    effect(() => {
      const tab = this.tab();
      if (shown.has(tab)) {
        return;
      }
      shown.add(tab);
      if (tab === 'shared') {
        void this._shared.load();
        return;
      }
      void this._generated.load();
      // Its own read, from its own route: the server leaves the live basket out of
      // the listing above (velista `0091`, section 6).
      void this._liveBasket.load();
    });

    // An effect rather than a `computed`, because this is an announcement and not a
    // value: it must be written when a page lands and must **not** be recomputed when
    // the count moves underneath it. `allowSignalWrites` is unnecessary in a zoneless
    // app on a signal nothing else reads back.
    effect(() => this._announcePages());
  }

  /**
   * Show a tab, and write it into the URL.
   *
   * A replace rather than a push: switching tabs is not a place to go back to, and the
   * back button from a basket opened here still lands on the tab it was opened from,
   * because the entry it returns to is this one with the parameter already in it.
   */
  selectTab(id: string): void {
    const tab = tabOf(id);
    this.tab.set(tab);
    void this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { [TAB_PARAM]: tab === 'shared' ? 'shared' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Say how many there now are, once per page of results.
   *
   * The read of {@link BasketListStore.pagesLoaded} is what makes this fire, and the
   * count is read **untracked** so that a settle moving `settledLineCount`, or a
   * basket appearing on the quiet refresh, cannot re-trigger it. That asymmetry is the
   * whole behaviour: pages speak, everything else is silent.
   */
  private _announcePages(): void {
    // The store of the tab on screen, since each speaks for its own pages. Switching
    // tabs speaks too, which is right: a different set of rows is now drawn.
    const store = this.tab() === 'shared' ? this._shared : this._generated;
    if (store.pagesLoaded() === 0) {
      return;
    }

    const count = untracked(() => store.lists().length);
    this.announced.set(
      this._translator.t('history.announce.loaded', undefined, this._locale(), {
        count,
      })
    );
  }

  /** The generation date of one row, in the reader's language. */
  generatedOn(date: Date): string {
    return formatGeneratedDate(date, this._locale());
  }

  /**
   * Ask for the next page when the bottom comes into view.
   *
   * Driven by the template's scroll handler rather than an `IntersectionObserver`,
   * which would have to be reached through `BrowserFacade` and torn down by hand for a
   * page that already re-renders on every store change. The store itself refuses a
   * second call while one is in flight, so a fast scroll cannot fire three.
   */
  onScroll(event: Event): void {
    const element = event.target as HTMLElement;
    const remaining =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    // Roughly two rows from the bottom, so the next page is usually there before
    // somebody reaches the end rather than after they have stopped.
    if (remaining < 160) {
      void (this.tab() === 'shared'
        ? this._shared.loadMore()
        : this._generated.loadMore());
    }
  }

  retry(): void {
    void (this.tab() === 'shared'
      ? this._shared.reload()
      : this._generated.reload());
  }

  /** Back to wherever this was opened from, which is the dashboard in every path. */
  back(): void {
    const dashboard = this._router.createUrlTree(['..', 'home'], {
      relativeTo: this._route,
    });

    void this._pages.back(this._router.serializeUrl(dashboard));
  }

  open(basketId: string): void {
    void this._router.navigate(['..', BASKET_PATHS.list, basketId], {
      relativeTo: this._route,
    });
  }

  /** The live basket, at the one address that is the same for everybody. */
  openLive(): void {
    void this._router.navigate(['..', ...BASKET_PATHS.live.split('/')], {
      relativeTo: this._route,
    });
  }

  /**
   * Open the generation sheet, over **this** page (plan 0045, section 3.4).
   *
   * A child of this route, so the sheet covers the history and dismissing it leaves
   * the history exactly where it was. It used to open the dashboard's copy at
   * `home/get`, which replaced the page underneath on the way in and then returned
   * here on the way out: the same sheet, opened over the wrong screen.
   */
  getList(): void {
    void this._router.navigate(sheetSegments('get'), {
      relativeTo: this._route,
    });
  }

  /**
   * Copies the support reference.
   *
   * Best effort: the Clipboard API needs a secure context and a user gesture, and it
   * rejects rather than throwing where it is unavailable. The reference is selectable
   * text as well, so a failure here costs nothing (plan 0003, section 7).
   */
  copyReference(reference: string): void {
    void this._browser.window?.navigator.clipboard
      ?.writeText(reference)
      .catch(() => undefined);
  }
}

/** Anything but `shared` is the default tab, so a mistyped parameter still draws a page. */
function tabOf(value: string | null): HistoryTab {
  return value === 'shared' ? 'shared' : 'mine';
}

function correlationIdOf(error: unknown): string | null {
  return error instanceof GatewayError || error instanceof NetworkError
    ? error.correlationId
    : null;
}

/** What every history row draws, the reader's own lists and shared ones alike. */
function rowOf(
  list: BasketSummary,
  names: ReadonlyMap<string, string>
): ShoppingListRowVm {
  return {
    id: list.id,
    name: names.get(list.id) ?? list.id,
    generatedAt: list.generatedAt,
    lineCount: list.lineCount,
    settledLineCount: list.settledLineCount,
    breakdown: outcomeBreakdown(list),
    // The live pair, not `ACTIVE` alone: the server composes a run as `DRAFT` and
    // never promotes it, so the Shopping now badge asked a question nothing could
    // answer yes to. Same one line and same reason as the dashboard card's, which
    // is why both now read `isOpenBasket` rather than each naming a status.
    active: isOpenBasket(list.status),
    // The one status this app can now write, and the one the sweep in luna
    // `0059` section 4 eventually writes for a trip nobody finished. Nothing
    // here tells those two apart and nothing should: the row says the trip is
    // over, which is true either way (velista `0057`, section 9).
    finished: list.status === 'FINISHED',
    live: list.kind === 'LIVE',
  };
}
