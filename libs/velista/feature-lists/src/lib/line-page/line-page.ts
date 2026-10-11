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
  ItemNames,
  LINE_SERVICE,
  type LineServiceI,
  LineStore,
  ListStore,
  MemberNames,
  SessionStore,
  ZoneStore,
} from '@portfolio/velista/data-access';
import {
  type AlsoOnPlaceVm,
  type AlsoOnVm,
  APP_BASE_PATH,
  catalogName,
  LINE_PRICED_PRODUCTS_MAX,
} from '@portfolio/velista/models';
import {
  appPath,
  lineIdOf,
  listIdOf,
  PageNavigation,
  productPagePath,
  sheetSegments,
  zoneIdOf,
} from '@portfolio/velista/platform';
import {
  ChevronRightIcon,
  EllipsisIcon,
  InfoIcon,
  LineProductRail,
  PageHeader,
  PageHeaderAction,
  QuantityStepper,
} from '@portfolio/velista/ui';
import {
  actionsFor,
  editScopeFor,
  selectAbilities,
} from '../select-list-state';
import { linePageStatus, loadLineContext } from './line-context';
import { LineProductPrices } from './line-product-prices';
import { selectLinePage } from './select-line-page';

/** How many cards past the last one on screen are read ahead (velista `0135`, 3). */
const CARDS_READ_AHEAD = 2;

/**
 * Everything the app knows about one line (velista plan `0135`, section 2).
 *
 * ## Its own route
 *
 * A page rather than a deeper sheet, so it can be linked to. The detail sheet
 * over the list answers the question somebody has standing in the kitchen. This
 * page is where a line is looked at and changed.
 *
 * ## Around the products
 *
 * Top to bottom: where the line is and how many, the products as cards with a
 * price, then three rows that lead somewhere (the supermarket, the buy history,
 * the comments), then the other lists that want it. The page draws no history of
 * its own: the two lists that filled it are on the history page.
 *
 * ## It loads by itself
 *
 * `loadLineContext` reads the list, the lines and the group when nothing holds
 * them, so a shared link and a reload draw the page (section 4).
 */
@Component({
  selector: 'lib-line-page',
  imports: [
    RouterOutlet,
    RokuTranslatorPipe,
    PageHeader,
    PageHeaderAction,
    EllipsisIcon,
    ChevronRightIcon,
    InfoIcon,
    QuantityStepper,
    LineProductRail,
  ],
  // One for the visit, and for the sheets over this page, which are drawn in its
  // outlet and so resolve it from here.
  providers: [LineProductPrices],
  templateUrl: './line-page.html',
  styleUrl: './line-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinePage {
  private readonly _lines = inject(LineStore);
  private readonly _lists = inject(ListStore);
  private readonly _zones = inject(ZoneStore);
  private readonly _names = inject(MemberNames);
  private readonly _itemNames = inject(ItemNames);
  private readonly _prices = inject(LineProductPrices);
  /**
   * The transport, for the one read that is this page's alone: "where else is this
   * wanted" is asked by this screen, answered per visit, and held by nothing.
   */
  private readonly _lineService = inject<LineServiceI>(LINE_SERVICE);
  private readonly _session = inject(SessionStore);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _localeStore = inject(RokuLocaleStore);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);
  readonly lineId = lineIdOf(this._route);

  /** A write of the favourite is out, so the stars wait. */
  readonly busy = signal(false);

  private readonly _line = computed(() =>
    this._lines.linesIn(this.listId()).find((line) => line.id === this.lineId())
  );

  private readonly _list = computed(() =>
    this._lists.listsIn(this.zoneId()).find((list) => list.id === this.listId())
  );

  private readonly _abilities = computed(() =>
    selectAbilities(this._list()?.myPermissions ?? [])
  );

  /** Loading, failed, missing or ready (section 4). */
  readonly status = computed(() =>
    linePageStatus(this._lines, this.listId(), this.lineId())
  );

  /**
   * The line's product set, compared by value.
   *
   * `LineStore` replaces the whole `Line` on every write to it, and one edit is
   * more than one write: the optimistic patch, the server's row and the realtime
   * echo each land separately. The reads below care about which products the line
   * holds, so they watch this and a write that leaves the set alone wakes none.
   */
  private readonly _itemIds = computed<readonly string[]>(
    () => this._line()?.itemIds ?? [],
    {
      equal: (a, b) =>
        a.length === b.length && a.every((itemId, i) => itemId === b[i]),
    }
  );

  /** How many cards the rail has reached, counted from the first. */
  private readonly _reached = signal(0);

  /** `WRITE` on a line nobody approved yet, `MANAGE` on any (backend 0036, 4.1). */
  private readonly _canEdit = computed(() => {
    const abilities = this._abilities();
    const line = this._line();
    return (
      abilities.canManage ||
      (abilities.canWrite && line?.approvalStatus !== 'APPROVED')
    );
  });

  /**
   * Whether the three dots are drawn: only when the menu would hold a row. A
   * menu with nothing in it is a button that opens an empty sheet.
   */
  readonly hasMenu = computed(() => {
    const line = this._line();
    if (line === undefined) {
      return false;
    }
    const abilities = this._abilities();
    return (
      editScopeFor(line, abilities) !== null ||
      actionsFor(line, abilities).includes('delete')
    );
  });

  readonly page = computed(() => {
    const line = this._line();
    const zoneId = this.zoneId();
    const locale = this._localeStore.locale();
    // Read so the words redraw once the translations of a cold load arrive.
    this._translator.loaded();
    const context = this._prices.context();

    return selectLinePage({
      line,
      list: this._list(),
      zoneName: this._zones.zoneById(zoneId)?.name ?? null,
      itemNameOf: (itemId) => this._itemNames.nameOf(itemId),
      namesUnavailable: this._itemNames.anyFailed(line?.itemIds ?? []),
      nameOf: (userId) => this._names.nameOf(zoneId, userId),
      callerUserId: this._session.userId(),
      locale,
      priceOf: this._prices.priceOf,
      supermarketNameOf: (supermarketId) => {
        const name =
          context?.chains.find(
            (chain) => chain.supermarketId === supermarketId
          )?.name ??
          context?.chainNames.get(supermarketId) ??
          null;
        return name === null ? null : catalogName(name, locale);
      },
      alsoOn: this.alsoOn(),
      commentCount: this._lines.commentCountOf(this.lineId()) ?? null,
      canEdit: this._canEdit(),
      canStep: this._abilities().canDecide,
      translate: (key, args) =>
        this._translator.t(key, undefined, locale, args),
    });
  });

  constructor() {
    loadLineContext(this.zoneId, this.listId);

    // The product names, keyed on the set, so a product added while the page is
    // open resolves without anything else being read again.
    effect(() => {
      const itemIds = this._itemIds();
      untracked(() => void this._itemNames.ensure(itemIds));
    });

    // The prices the order of the cards compares: the first twenty products, read
    // when the page opens (velista `0137`, section 2). Past those the cards keep the
    // order of the line, so the rail reads them as it reaches them and two ahead.
    // The favourite is the first card wherever the line holds it, so its price is
    // always asked for.
    effect(() => {
      const itemIds = this._itemIds();
      const wanted = itemIds.slice(
        0,
        Math.max(LINE_PRICED_PRODUCTS_MAX, this._reached() + CARDS_READ_AHEAD)
      );
      const favorite = this._line()?.favoriteItemId ?? null;
      if (
        favorite !== null &&
        itemIds.includes(favorite) &&
        !wanted.includes(favorite)
      ) {
        wanted.push(favorite);
      }
      if (wanted.length > 0) {
        untracked(() => void this._prices.ensure(wanted));
      }
    });

    // The name of the supermarket of a line with no card to price. The context
    // carries the names, and it is otherwise read with the first price.
    effect(() => {
      if ((this._line()?.preferredSupermarketId ?? null) !== null) {
        untracked(() => void this._prices.ensure([]));
      }
    });

    effect(() => {
      const itemIds = this._itemIds();
      const listId = this.listId();

      untracked(() => {
        // A line with no product has no question to ask, and the server refuses
        // it rather than answering empty.
        if (itemIds.length === 0) {
          this.alsoOn.set(null);
          return;
        }
        void this._resolveAlsoOn(itemIds, listId);
      });
    });
  }

  /**
   * Where else this line's products are still wanted (backend plan 0053, section 3).
   *
   * **Null until an answer arrives**, and null again if none does: the section is
   * omitted rather than drawn empty. One request for each product, merged by list,
   * because the server answers for one item.
   */
  readonly alsoOn = signal<AlsoOnVm | null>(null);

  private _alsoOnSeq = 0;

  /**
   * One product's answer, asked once for the visit. A failure is not kept, so
   * the next change of the set retries it.
   */
  private readonly _answers = new Map<string, Promise<AlsoOnVm | null>>();

  private async _resolveAlsoOn(
    itemIds: readonly string[],
    listId: string
  ): Promise<void> {
    const seq = (this._alsoOnSeq += 1);

    const answers = await Promise.all(
      itemIds.map((itemId) => this._askAbout(itemId, listId))
    );
    if (seq !== this._alsoOnSeq) {
      return;
    }

    const answered = answers.filter(
      (answer): answer is AlsoOnVm => answer !== null
    );
    if (answered.length === 0) {
      this.alsoOn.set(null);
      return;
    }

    const byList = new Map<string, AlsoOnPlaceVm>();
    for (const answer of answered) {
      for (const place of answer.places) {
        byList.set(place.listId, place);
      }
    }

    this.alsoOn.set({
      places: [...byList.values()],
      // Cut short by the server, or one product's request failed: either way there
      // is more than what is drawn, and the caption says so.
      hasMore:
        answered.some((answer) => answer.hasMore) ||
        answered.length !== itemIds.length,
    });
  }

  private _askAbout(itemId: string, listId: string): Promise<AlsoOnVm | null> {
    const key = `${listId} ${itemId}`;
    const held = this._answers.get(key);
    if (held !== undefined) {
      return held;
    }

    const answer = this._lineService
      .listsHoldingItem(itemId, { excludeListId: listId })
      .catch(() => {
        this._answers.delete(key);
        return null;
      });

    this._answers.set(key, answer);
    return answer;
  }

  /** One press of the stepper: one more, or one fewer, as a delta (section 2). */
  step(by: 1 | -1): void {
    void this._lines.addQuantity(this.lineId(), by);
  }

  /** The rail scrolled: how many cards it has reached. */
  reached(count: number): void {
    if (count > this._reached()) {
      this._reached.set(count);
    }
  }

  /**
   * A star was pressed (section 3.1). The favourite's own star clears it, and
   * any other star moves it there, so a line has one favourite or none.
   */
  async toggleFavorite(itemId: string): Promise<void> {
    const line = this._line();
    if (line === undefined || this.busy() || !this._canEdit()) {
      return;
    }

    this.busy.set(true);
    await this._lines.updateLine(line.id, {
      favoriteItemId: line.favoriteItemId === itemId ? null : itemId,
    });
    this.busy.set(false);
  }

  /** A card was pressed: the product's own page. */
  async openProduct(itemId: string): Promise<void> {
    await this._router.navigateByUrl(
      productPagePath(this._localeStore.locale(), this._basePath, itemId)
    );
  }

  /** "Change", and "Add a product" on a line with none: the products page. */
  async openProducts(): Promise<void> {
    await this._router.navigateByUrl(this._url('products'));
  }

  async openHistory(): Promise<void> {
    await this._router.navigateByUrl(this._url('history'));
  }

  /** The three dots: the menu, a sheet over this page. */
  async openMenu(): Promise<void> {
    await this._router.navigateByUrl(this._url(...sheetSegments('menu')));
  }

  /** The info button beside the heading of the products (velista `0137`, section 3). */
  async openAbout(): Promise<void> {
    await this._router.navigateByUrl(
      this._url(...sheetSegments('about-products'))
    );
  }

  async openSupermarket(): Promise<void> {
    await this._router.navigateByUrl(
      this._url(...sheetSegments('supermarket'))
    );
  }

  async openComments(): Promise<void> {
    await this._router.navigateByUrl(this._url(...sheetSegments('comments')));
  }

  retry(): void {
    void this._lines.load(this.listId());
  }

  /** Back to whatever was on screen before this line, its list being the usual one. */
  async back(): Promise<void> {
    await this._pages.back(this._listUrl());
  }

  /** A line that is gone: its list, replacing this page's entry. */
  async leave(): Promise<void> {
    await this._router.navigateByUrl(this._listUrl(), { replaceUrl: true });
  }

  private _listUrl(): string {
    return appPath(
      this._localeStore.locale(),
      this._basePath,
      'zones',
      this.zoneId(),
      'lists',
      this.listId()
    );
  }

  private _url(...segments: readonly string[]): string {
    return appPath(
      this._localeStore.locale(),
      this._basePath,
      'zones',
      this.zoneId(),
      'lists',
      this.listId(),
      'lines',
      this.lineId(),
      ...segments
    );
  }
}
