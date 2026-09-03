import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
  GatewayError,
  GeneratedListStore,
  NetworkError,
} from '@portfolio/velista/data-access';
import {
  displayNames,
  formatGeneratedDate,
  isLiveGeneratedList,
  outcomeBreakdown,
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
} from '@portfolio/velista/ui';
import { BASKET_PATHS } from '../basket-paths';
import { ShoppingListRow } from '../shopping-list-row/shopping-list-row';

/**
 * Every shopping list this account has ever generated, newest first (plan 0045,
 * section 3.3).
 *
 * The container, and the only thing here that touches a store (rule D1). Its one piece
 * of presentation logic is choosing which state to render, and that is a `computed`
 * over `GeneratedListStore` rather than a pure function of its own: unlike the
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
    RouterOutlet,
    RowSkeleton,
    ShoppingListRow,
  ],
  templateUrl: './shopping-lists-page.html',
  styleUrl: './shopping-lists-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShoppingListsPage {
  private readonly _generated = inject(GeneratedListStore);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _browser = inject(BrowserFacade);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _correlationId = computed(() => {
    const error = this._generated.error();
    return error instanceof GatewayError || error instanceof NetworkError
      ? error.correlationId
      : null;
  });

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

    const lists = this._generated.lists();
    if (lists.length === 0) {
      return { kind: 'empty' };
    }

    const names = this._names();
    return {
      kind: 'populated',
      rows: lists.map((list) => ({
        id: list.id,
        name: names.get(list.id) ?? list.id,
        generatedAt: list.generatedAt,
        lineCount: list.lineCount,
        settledLineCount: list.settledLineCount,
        breakdown: outcomeBreakdown(list),
        // The live pair, not `ACTIVE` alone: the server composes a run as `DRAFT` and
        // never promotes it, so the Shopping now badge asked a question nothing could
        // answer yes to. Same one line and same reason as the dashboard card's, which
        // is why both now read `isLiveGeneratedList` rather than each naming a status.
        active: isLiveGeneratedList(list.status),
        // The one status this app can now write, and the one the sweep in luna
        // `0059` section 4 eventually writes for a trip nobody finished. Nothing
        // here tells those two apart and nothing should: the row says the trip is
        // over, which is true either way (velista `0057`, section 9).
        finished: list.status === 'COMPLETED',
      })),
      loadingMore: this._generated.loadingMore(),
    };
  });

  readonly hasMore = this._generated.hasMore;

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
    void this._generated.load();

    // An effect rather than a `computed`, because this is an announcement and not a
    // value: it must be written when a page lands and must **not** be recomputed when
    // the count moves underneath it. `allowSignalWrites` is unnecessary in a zoneless
    // app on a signal nothing else reads back.
    effect(() => this._announcePages());
  }

  /**
   * Say how many there now are, once per page of results.
   *
   * The read of {@link GeneratedListStore.pagesLoaded} is what makes this fire, and the
   * count is read **untracked** so that a settle moving `settledLineCount`, or a
   * basket appearing on the quiet refresh, cannot re-trigger it. That asymmetry is the
   * whole behaviour: pages speak, everything else is silent.
   */
  private _announcePages(): void {
    if (this._generated.pagesLoaded() === 0) {
      return;
    }

    const count = untracked(() => this._generated.lists().length);
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
      void this._generated.loadMore();
    }
  }

  retry(): void {
    void this._generated.reload();
  }

  /** Back to wherever this was opened from, which is the dashboard in every path. */
  back(): void {
    const dashboard = this._router.createUrlTree(['..', 'home'], {
      relativeTo: this._route,
    });

    void this._pages.back(this._router.serializeUrl(dashboard));
  }

  open(generatedListId: string): void {
    void this._router.navigate(['..', BASKET_PATHS.list, generatedListId], {
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
