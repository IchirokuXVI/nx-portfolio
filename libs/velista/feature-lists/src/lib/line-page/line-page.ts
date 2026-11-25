import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  Injector,
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
  ProductPickStore,
  SessionStore,
  ZoneStore,
} from '@portfolio/velista/data-access';
import {
  type AbsorbedExtra,
  type AlsoOnPlaceVm,
  type AlsoOnVm,
  APP_BASE_PATH,
  catalogName,
  defaultQuantity,
  LINE_PRICED_PRODUCTS_MAX,
  type LineUnit,
  type QuantityStep,
} from '@portfolio/velista/models';
import {
  AppHistory,
  appPath,
  lineIdOf,
  listIdOf,
  PageNavigation,
  productPagePath,
  productsPickPath,
  quantityRuns,
  sheetSegments,
  zoneIdOf,
} from '@portfolio/velista/platform';
import {
  ChevronRightIcon,
  EllipsisIcon,
  ExtraAskHost,
  ExtraAskPopover,
  InfoIcon,
  LineProductRail,
  LineUnitChip,
  PageHeader,
  PageHeaderAction,
  QuantityStepper,
} from '@portfolio/velista/ui';
import { listErrorKey } from '../list-error-copy';
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
    LineUnitChip,
    ExtraAskPopover,
  ],
  // One for the visit, and for the sheets over this page, which are drawn in its
  // outlet and so resolve it from here. The question about the extra already
  // bought is this page's too (velista `0208`, target state 12), gone with it.
  providers: [LineProductPrices, ExtraAskHost],
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
  private readonly _pick = inject(ProductPickStore);
  private readonly _history = inject(AppHistory);
  private readonly _extraHost = inject(ExtraAskHost);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _document = inject(DOCUMENT);
  private readonly _injector = inject(Injector);

  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);
  readonly lineId = lineIdOf(this._route);

  /** A write of the favourite is out, so the stars wait. */
  readonly busy = signal(false);

  /** A unit change is out, so the chip and the stepper wait (velista `0183`). */
  readonly unitPending = signal(false);

  /** The last refused unit change, with the version of the line it was refused at. */
  private readonly _unitError = signal<{
    readonly key: string;
    readonly version: number | null;
  } | null>(null);

  private readonly _line = computed(() =>
    this._lines.linesIn(this.listId()).find((line) => line.id === this.lineId())
  );

  /**
   * Why the last unit change was refused, drawn under the amount. Only while the
   * line is the one it was refused on: a step that lands, or any other write
   * that moves the line's version, takes the line away, so the words would
   * describe a line that is no longer drawn.
   */
  readonly unitErrorKey = computed(() => {
    const error = this._unitError();
    if (error === null) {
      return null;
    }
    return (this._line()?.version ?? null) === error.version ? error.key : null;
  });

  private readonly _list = computed(() =>
    this._lists.listsIn(this.zoneId()).find((list) => list.id === this.listId())
  );

  private readonly _abilities = computed(() =>
    selectAbilities(this._list()?.myPermissions ?? [])
  );

  /** Loading, failed, gone, missing or ready (section 4, velista 0156). */
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

  /**
   * `WRITE` or `MANAGE` on any line. A writer may change the products of an
   * approved line, which puts it back to pending (backend plan 0076); the only
   * field approval keeps from a writer is the quantity, which this page does not
   * write.
   */
  private readonly _canEdit = computed(() => {
    const abilities = this._abilities();
    return abilities.canWrite || abilities.canManage;
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
      productOf: this._itemNames.sizingOf,
      supermarketNameOf: (supermarketId) => {
        const name =
          context?.chains.find((chain) => chain.supermarketId === supermarketId)
            ?.name ??
          context?.chainNames.get(supermarketId) ??
          null;
        return name === null ? null : catalogName(name, locale);
      },
      alsoOn: this.alsoOn(),
      commentCount: this._lines.commentCountOf(this.lineId()) ?? null,
      canEdit: this._canEdit(),
      canStep: this._abilities().canDecide,
      canRename:
        line !== undefined && editScopeFor(line, this._abilities()) !== null,
      translate: (key, args) =>
        this._translator.t(key, undefined, locale, args),
    });
  });

  constructor() {
    loadLineContext(this.zoneId, this.listId);
    this._extraHost.connect({
      readerId: () => this._session.userId(),
      nameOf: (zoneId, userId) => this._names.nameOf(zoneId, userId),
    });

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

  /**
   * The stepper's steps, gathered into one write per run (velista `0188`, section
   * 5.2): a hold that repeats ten times a second would otherwise be ten requests a
   * second. The stepper draws the open run, and a page that goes away writes it.
   */
  readonly quantityRuns = quantityRuns<string>((lineId, run) => {
    const delta = run.to - run.from;
    const sent = ++this._sentCount;
    this._sentRuns.set(lineId, sent);
    this._extraHost.dropWaiting(lineId);
    // A raise reports what it took into the ask, and its answer may ask on the
    // stepper (velista `0208`, target state 12). A lowering never.
    const writing =
      delta > 0
        ? this._lines.raiseReportingExtra(lineId, delta).then((answer) => {
            if (
              answer.state === 'succeeded' &&
              answer.extra !== null &&
              answer.quantity !== null
            ) {
              this._askAboutExtra(lineId, sent, answer.extra, answer.quantity);
            }
            return answer.state;
          })
        : this._lines.addQuantity(lineId, delta);
    const write = writing
      .then((outcome) => {
        if (outcome === 'succeeded') {
          this._unitError.set(null);
        }
      })
      .finally(() => {
        if (this._runWrites.get(lineId) === write) {
          this._runWrites.delete(lineId);
        }
      });
    this._runWrites.set(lineId, write);
  });

  /**
   * The run write of each line still on its way. A unit change waits for it: a
   * delta in the old unit that reached the server after the change would be
   * refused, and the refusal puts the line back in the old unit on screen.
   */
  private readonly _runWrites = new Map<string, Promise<void>>();

  /** One step of the stepper, a press or a repeat of a hold. */
  step(step: QuantityStep): void {
    this.quantityRuns.step(this.lineId(), step);
    // A press on the control the question points at is no answer (target state 4).
    if (this._extraHost.asked()?.lineId === this.lineId()) {
      this._extraHost.close('outside');
    }
  }

  /** The newest write of each line, numbered, so an older answer asks nothing. */
  private readonly _sentRuns = new Map<string, number>();
  private _sentCount = 0;

  /**
   * A raise of the stepper answered with something to count (velista `0208`,
   * target state 12): asked on the stepper, below it, since the header leaves no
   * room above (the board's frame 2), while the page is in front and no newer run
   * of the line is open or was sent.
   */
  private _askAboutExtra(
    lineId: string,
    sent: number,
    extra: AbsorbedExtra,
    shown: number
  ): void {
    const line = this._line();
    if (line === undefined || line.id !== lineId) {
      return;
    }
    const unit = line.unit;
    afterNextRender(
      () =>
        this._extraHost.ask({
          lineId,
          zoneId: this.zoneId(),
          unit,
          extra,
          shown,
          origin: () =>
            this._host.nativeElement.querySelector<HTMLElement>(
              '.amount lib-quantity-stepper'
            ),
          keepInSight: () =>
            this._host.nativeElement.querySelector<HTMLElement>('.amount'),
          side: 'below',
          count: () => this._countExtra(lineId, extra.countable, shown),
          inFront: () =>
            this.lineId() === lineId &&
            !this._route.firstChild &&
            this._document.visibilityState !== 'hidden' &&
            this._document.querySelector('dialog[open]') === null,
          current: () =>
            this._sentRuns.get(lineId) === sent &&
            !this.quantityRuns.pending().has(lineId),
        }),
      { injector: this._injector }
    );
  }

  /** "Count the extra" on the stepper: the store shows Z at once (target state 4). */
  private async _countExtra(
    lineId: string,
    amount: number,
    expect: number
  ): Promise<'done' | 'stale' | 'failed'> {
    const outcome = await this._lines.countExtra(lineId, amount, expect);
    return outcome === 'counted' ? 'done' : outcome;
  }

  /** A sheet opened over the page: its question goes with no answer (target state 10). */
  onSheetOpened(): void {
    this._extraHost.drop();
  }

  /**
   * A segment of the unit chip (velista `0183`, target state 3): one write of
   * the unit with the amount that unit starts at, which backend `0246` requires
   * with every unit change. The store moves the line at once and puts it back on
   * a refusal, and the chip and the stepper read the line, so both follow it.
   */
  async chooseUnit(unit: LineUnit): Promise<void> {
    const line = this._line();
    if (line === undefined || this.unitPending() || unit === line.unit) {
      return;
    }
    // The open run is written first, and its answer is waited for, so the unit
    // change reaches the server after the delta in the old unit.
    this.quantityRuns.flush(line.id);
    this.unitPending.set(true);
    this._unitError.set(null);
    await this._runWrites.get(line.id);
    const outcome = await this._lines.updateLine(line.id, {
      unit,
      quantity: defaultQuantity(unit),
    });
    this.unitPending.set(false);
    if (outcome.state === 'failed') {
      this._unitError.set({
        key: listErrorKey(outcome.error, 'lines.write') ?? 'list.detail.failed',
        version: this._line()?.version ?? null,
      });
    }
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

  /**
   * "Change", and "Choose a product" on a line with none: the catalog that
   * chooses the whole set of the line (velista `0146`, section 5), opened on the
   * products the line holds, its own and its group's, which are one set.
   */
  async openProducts(): Promise<void> {
    const line = this._line();
    if (line === undefined || !this._canEdit()) {
      return;
    }
    const locale = this._localeStore.locale();
    this._pick.open({
      kind: 'set',
      lineId: line.id,
      forLabel: this._translator.t('list.row.pickFor', undefined, locale, {
        name: this.page()?.content ?? '',
      }),
      forDetail: this._list()?.name ?? '',
      chosenId: null,
      chosenIds: line.itemIds,
      returnUrl: this._url(),
      returnDepth: this._history.depth(),
      callerState: null,
    });
    await this._router.navigateByUrl(
      productsPickPath(
        locale,
        this._basePath,
        this.zoneId(),
        this.listId(),
        line.id
      )
    );
  }

  async openHistory(): Promise<void> {
    await this._router.navigateByUrl(this._url('history'));
  }

  /** The three dots: the menu, a sheet over this page. */
  async openMenu(): Promise<void> {
    await this._router.navigateByUrl(this._url(...sheetSegments('menu')));
  }

  /**
   * "Add a name", on a line that is not named (velista `0144`, section 5): the name
   * sheet, pushed over this page so closing it lands here.
   */
  async openName(): Promise<void> {
    await this._router.navigateByUrl(this._url(...sheetSegments('name')));
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

  /** A list that is not readable: its group, replacing this page's entry. */
  async leaveToGroup(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(
        this._localeStore.locale(),
        this._basePath,
        'zones',
        this.zoneId()
      ),
      { replaceUrl: true }
    );
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
