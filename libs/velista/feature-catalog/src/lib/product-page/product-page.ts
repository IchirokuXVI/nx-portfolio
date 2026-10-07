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
import {
  ActivatedRoute,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
  CATALOG_SERVICE,
  CatalogAddStore,
  CategoryStore,
  GroupMembers,
  SessionStore,
  type CatalogBrowseServiceI,
  type CatalogServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  categoryName,
  chainPriceHistories,
  PRICE_HISTORY_DEFAULT_RANGE,
  PRICE_HISTORY_READ_DAYS,
  priceHistoryStart,
  productListGroups,
  productPricesSeenAt,
  productShopPrices,
  similarProducts,
  stepsWithin,
  type CatalogBrowseContext,
  type CatalogItem,
  type ItemList,
  type PriceHistoryRange,
  type ProductListGroup,
  type ProductPriceHistory,
  type ProductShopPrice,
} from '@portfolio/velista/models';
import {
  appPath,
  CATALOG_PATHS,
  formatMoney,
  PageNavigation,
  productPagePath,
  sheetSegments,
} from '@portfolio/velista/platform';
import {
  AddingBar,
  ChevronRightIcon,
  ListsTable,
  PageHeader,
  PriceHistory,
  PriceTable,
  ProductIcon,
  ProductRow,
  ProductRowSkeleton,
  productRowView,
  type ListsTableStep,
  type PriceHistoryLine,
  type PriceTableRow,
  type ProductRowAdd,
  type ProductRowLineStep,
  type ProductRowView,
} from '@portfolio/velista/ui';
import { CatalogContext } from '../catalog-context';
import { CATEGORY_PARAM } from '../category-choice';
import { rowAdds } from '../row-adds';

/**
 * `gone` is a product the catalog no longer holds, which is not a failed read:
 * trying again cannot bring it back, so it offers the catalog instead.
 */
type PageStatus = 'loading' | 'ready' | 'failed' | 'gone';

/** A section that is read after the page is drawn, and can fail alone. */
type SectionStatus = 'loading' | 'ready' | 'failed';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One product, on a page of its own (velista `0134`, section 5).
 *
 * It replaces the product sheet, which had room for a name and a few lines. From
 * top to bottom: the header with the product's name, the product, what each
 * supermarket of the shopping profile charges, how that price has moved, the
 * person's lists with how many of the product each holds, and similar products.
 *
 * ## The prices come first, and are on screen when the page opens
 *
 * "What does this cost" is the question a person opened the page with. The read
 * is the sheet's: every source row of the product (`GET
 * /v1/catalog/items/:id/offers`), kept to the person's own scopes, one row for
 * each chain at its cheapest, and the chains near the person with no row say `not
 * sold here`.
 *
 * ## The history and the lists are read after the page is drawn
 *
 * Neither holds the page back, and either can fail alone: a product whose history
 * did not load still shows its prices. One year of history is read once, and the
 * three ranges are cut from it, so a press on a range asks the server for nothing.
 *
 * ## In your lists
 *
 * Every list the person can read, under its group, with a stepper for the line
 * that has this product. The lines live in `CatalogAddStore`, where the rows of
 * the catalog read them too, so a quantity changed here is the quantity there.
 * What is added here joins the record of the visit.
 *
 * ## Similar products carry the plus
 *
 * The other products of its group, each with the plus of the catalog's rows. The
 * heading says which list the plus adds to and opens the same sheet of lists as
 * the catalog: the choice is one value for both pages. A press on a row opens
 * that product's page.
 *
 * ## Back never leaves the app
 *
 * The back control pops when this document pushed the entry behind it, which is
 * the catalog, a list or a basket that linked here. On a cold load the fallback
 * is the catalog.
 */
@Component({
  selector: 'lib-product-page',
  imports: [
    AddingBar,
    ChevronRightIcon,
    ListsTable,
    PageHeader,
    PriceHistory,
    PriceTable,
    ProductIcon,
    ProductRow,
    ProductRowSkeleton,
    RokuTranslatorPipe,
    RouterLink,
    RouterOutlet,
  ],
  providers: [CatalogContext],
  templateUrl: './product-page.html',
  styleUrl: './product-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductPage {
  private readonly _catalog = inject<CatalogServiceI>(CATALOG_SERVICE);
  private readonly _browse = inject<CatalogBrowseServiceI>(
    CATALOG_BROWSE_SERVICE
  );
  private readonly _context = inject(CatalogContext);
  private readonly _categories = inject(CategoryStore);
  private readonly _groupMembers = inject(GroupMembers);
  private readonly _adds = inject(CatalogAddStore);
  private readonly _session = inject(SessionStore);
  private readonly _pages = inject(PageNavigation);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  protected readonly locale = this._locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  /**
   * The product on show. It follows the route, because a similar product opens
   * at this same route and the router reuses the component for it.
   */
  protected readonly itemId = signal(
    this._route.snapshot.paramMap.get('itemId') ?? ''
  );

  protected readonly status = signal<PageStatus>('loading');
  private readonly _item = signal<CatalogItem | null>(null);
  private readonly _prices = signal<readonly ProductShopPrice[]>([]);

  /** Whether the person has a shopping place, without which nothing is priced. */
  protected readonly priced = signal(true);

  /** A picture that failed to load, so the carton takes its place. */
  protected readonly brokenImage = signal<string | null>(null);

  private readonly _browseContext = signal<CatalogBrowseContext | null>(null);

  /** One year of history, read once. The ranges are cut from it. */
  private readonly _history = signal<ProductPriceHistory | null>(null);
  protected readonly historyStatus = signal<SectionStatus>('loading');
  protected readonly range = signal<PriceHistoryRange>(
    PRICE_HISTORY_DEFAULT_RANGE
  );

  /** Every list the person can read. The lines of them are the store's. */
  private readonly _lists = signal<readonly ItemList[]>([]);
  protected readonly listsStatus = signal<SectionStatus>('loading');

  /** A guest has no lists, so the page asks for none and draws no table. */
  protected readonly signedIn = computed(() => !this._session.isGuest());

  /** A write that failed, said once in the live region until the next press. */
  protected readonly addFailed = signal(false);

  /** The list the plus adds to, or null for somebody with none to write to. */
  protected readonly addTarget = this._adds.target;

  protected readonly name = computed(() => {
    const item = this._item();
    return item === null ? '' : catalogName(item.name, this._locale());
  });

  protected readonly image = computed(() => {
    const src = this._item()?.imageUrl ?? null;
    return src !== null && src !== this.brokenImage() ? src : null;
  });

  /** `brand · size`, with the row's own rule for when a size is worth saying. */
  protected readonly detail = computed(() => {
    const item = this._item();
    const locale = this._locale();
    this._translator.loaded();
    if (item === null) {
      return null;
    }
    return productRowView(
      { ...item, offer: null, unitBasis: null },
      {
        locale,
        chainChosen: false,
        chainOf: () => null,
        translate: (key, args) =>
          this._translator.t(key, undefined, locale, args),
      }
    ).detail;
  });

  /**
   * The product's first category, as "Drinks · Coffee", and the catalog narrowed
   * to it. The root's name comes from the tree, which the wire's category does
   * not carry, so until the tree is read the leaf stands alone.
   */
  protected readonly category = computed(() => {
    const category = this._item()?.categories[0] ?? null;
    if (category === null) {
      return null;
    }
    const locale = this._locale();
    const root = this._categories.tree().byId.get(category.parentId) ?? null;
    const leaf = categoryName(category, locale);
    return {
      label: root === null ? leaf : `${categoryName(root, locale)} · ${leaf}`,
      query: { [CATEGORY_PARAM]: category.slug },
    };
  });

  protected readonly catalogPath = computed(() =>
    appPath(this._locale(), this._basePath, CATALOG_PATHS.tab)
  );

  /** The screen that edits postal codes and shops, for the note's action. */
  protected readonly placePath = computed(() =>
    appPath(this._locale(), this._basePath, 'account', 'profiles')
  );

  protected readonly prices = computed<readonly PriceTableRow[]>(() => {
    const locale = this._locale();
    this._translator.loaded();
    const basis = this._item()?.unitBasis ?? null;
    return this._prices().map((line) => {
      const offer = line.offer;
      const chain = catalogName(line.chain, locale);
      return {
        supermarketId: line.supermarketId,
        logo: { logoUrl: line.logoUrl, name: chain, store: false },
        chain,
        kind: line.kind,
        price:
          offer !== null && offer.price !== null
            ? formatMoney(offer.price, offer.currency, locale)
            : null,
        unitPrice:
          offer !== null &&
          offer.price !== null &&
          offer.unitPrice !== null &&
          basis !== null
            ? this._translator.t(`catalog.unit.${basis}`, undefined, locale, {
                price: formatMoney(offer.unitPrice, offer.currency, locale),
              })
            : null,
        cheapest: line.cheapest,
        stale: offer?.stale === true,
      };
    });
  });

  /** The currency the table is in, for the chart's axis. */
  protected readonly currency = computed(
    () =>
      this._prices()
        .map((line) => line.offer?.currency ?? null)
        .find((currency) => currency !== null) ?? 'EUR'
  );

  /** The window the chart draws: the chosen range, ending where the read ends. */
  protected readonly historyWindow = computed(() => {
    const history = this._history();
    if (history === null) {
      return null;
    }
    const to = history.to.getTime();
    // Never before the read starts: the server may have cut the year short.
    const from = Math.max(
      priceHistoryStart(this.range(), history.to).getTime(),
      history.from.getTime()
    );
    return { from, to };
  });

  /** One line for each chain, cut to the window, named in the reader's language. */
  protected readonly historyLines = computed<readonly PriceHistoryLine[]>(
    () => {
      const history = this._history();
      const context = this._browseContext();
      const window = this.historyWindow();
      if (history === null || context === null || window === null) {
        return [];
      }
      const locale = this._locale();
      return chainPriceHistories(history, context).map((line) => ({
        id: line.supermarketId,
        name: catalogName(line.chain, locale),
        slot: line.slot,
        steps: stepsWithin(line.steps, window.from, window.to),
      }));
    }
  );

  /** The table of lists (section 7), the last used list and its group first. */
  protected readonly listGroups = computed<readonly ProductListGroup[]>(() => {
    const target = this.addTarget();
    return productListGroups(
      this._lists(),
      this._adds.held(),
      this.itemId(),
      this.name(),
      target === null ? null : `${target.zoneId}/${target.listId}`
    );
  });

  /** "two days ago", in the reader's language, or null with no price seen. */
  protected readonly seen = computed(() => {
    const at = productPricesSeenAt(this._prices());
    return at === null ? null : relativeDay(at, this._locale());
  });

  /** The group's other members as rows, or why there are none to draw. */
  protected readonly similar = computed(() => {
    const groupId = this._item()?.productGroupId ?? null;
    if (groupId === null) {
      return null;
    }
    const entry = this._groupMembers.entry(groupId);
    const locale = this._locale();
    this._translator.loaded();
    const rows: readonly ProductRowView[] =
      entry?.status === 'ready'
        ? similarProducts(entry.members, [this.itemId()]).map((member) =>
            productRowView(member, {
              locale,
              // The unit price under each price, because that compares them.
              chainChosen: true,
              chainOf: () => null,
              translate: (key, args) =>
                this._translator.t(key, undefined, locale, args),
            })
          )
        : [];
    return {
      rows,
      loading: entry === null || entry.status === 'loading',
      failed: entry?.status === 'failed',
    };
  });

  private readonly _rowAdds = computed(() =>
    rowAdds(this.addTarget(), this._adds.held())
  );

  constructor() {
    const params = this._route.paramMap.subscribe((map) => {
      const itemId = map.get('itemId') ?? '';
      if (itemId !== this.itemId()) {
        this.itemId.set(itemId);
        void this._load();
      }
    });
    inject(DestroyRef).onDestroy(() => params.unsubscribe());

    void this._load();
    void this._adds.ensure();
    // The root's name for the category link. Read once a session, usually held.
    void this._categories.ensure();

    let failures = this._adds.failures();
    effect(() => {
      const now = this._adds.failures();
      if (now !== failures) {
        failures = now;
        untracked(() => this.addFailed.set(true));
      }
    });
  }

  /** The back control. On a cold load there is nothing to pop, so the catalog. */
  protected async back(): Promise<void> {
    await this._pages.back(this.catalogPath());
  }

  protected retry(): void {
    void this._load();
  }

  /** What a similar row's trailing control draws, or null with no plus. */
  protected addOf(itemId: string): ProductRowAdd | null {
    const adds = this._rowAdds();
    return adds.byItem.get(itemId) ?? adds.plain;
  }

  protected addProduct(row: ProductRowView): void {
    this.addFailed.set(false);
    void this._adds.add({
      itemId: row.id,
      name: row.name,
      detail: row.summary,
    });
  }

  /** A press on the stepper of one line under a similar product. */
  protected stepLine(row: ProductRowView, step: ProductRowLineStep): void {
    const target = this.addTarget();
    if (target === null) {
      return;
    }
    this.addFailed.set(false);
    void this._adds.step(
      { listId: target.listId, itemId: row.id, detail: row.summary },
      step.lineId,
      step.by
    );
  }

  /** The plus of a list in the table: one of this product on that list. */
  protected addToList(listId: string): void {
    this.addFailed.set(false);
    void this._adds.add(
      { itemId: this.itemId(), name: this.name(), detail: this.detail() },
      listId
    );
  }

  /** A press on the stepper of a line in the table. */
  protected stepListLine(step: ListsTableStep): void {
    this.addFailed.set(false);
    void this._adds.step(
      { listId: step.listId, itemId: this.itemId(), detail: this.detail() },
      step.lineId,
      step.by
    );
  }

  protected chooseRange(range: PriceHistoryRange): void {
    this.range.set(range);
  }

  protected retryHistory(): void {
    void this._loadHistory(this.itemId());
  }

  protected retryLists(): void {
    void this._loadLists(this.itemId());
  }

  /** A similar product: its own page, pushed, so back returns to this one. */
  protected openSimilar(itemId: string): void {
    void this._router.navigateByUrl(
      productPagePath(this._locale(), this._basePath, itemId)
    );
  }

  /** The heading of Similar products: the sheet of lists, over this page. */
  protected openLists(): void {
    const segments = sheetSegments(CATALOG_PATHS.addListSheet).join('/');
    void this._router.navigateByUrl(
      `${productPagePath(this._locale(), this._basePath, this.itemId())}/${segments}`
    );
  }

  private async _load(): Promise<void> {
    const itemId = this.itemId();
    this.status.set('loading');
    const [items, context, rows] = await Promise.all([
      this._catalog.itemsByIds([itemId]),
      this._context.load(),
      this._browse.scopeOffers(itemId),
    ]);

    // Another product was opened while this one loaded. Its own load owns the page.
    if (itemId !== this.itemId()) {
      return;
    }

    if (items === null || context === null) {
      this.status.set('failed');
      return;
    }
    const item = items[0] ?? null;
    if (item === null) {
      this.status.set('gone');
      return;
    }
    if (rows === null) {
      this.status.set('failed');
      return;
    }

    if (item.productGroupId !== null) {
      void this._groupMembers.ensure([item.productGroupId]);
    }

    this._item.set(item);
    this._browseContext.set(context);
    this.priced.set(hasScopes(context));
    this._prices.set(
      hasScopes(context) ? productShopPrices(rows, context) : []
    );
    this.status.set('ready');

    // Neither holds the page back, and each fails alone.
    if (hasScopes(context)) {
      void this._loadHistory(itemId);
    }
    if (this.signedIn()) {
      void this._loadLists(itemId);
    }
  }

  /** One year of what the person's supermarkets showed for this product. */
  private async _loadHistory(itemId: string): Promise<void> {
    this.historyStatus.set('loading');
    this._history.set(null);
    const to = new Date();
    const history = await this._browse.priceHistory(
      itemId,
      new Date(to.getTime() - PRICE_HISTORY_READ_DAYS * DAY_MS),
      to
    );
    if (itemId !== this.itemId()) {
      return;
    }
    this._history.set(history);
    this.historyStatus.set(history === null ? 'failed' : 'ready');
  }

  /** The person's lists, and the lines of them that hold this product. */
  private async _loadLists(itemId: string): Promise<void> {
    this.listsStatus.set('loading');
    const lists = await this._adds.readItem(itemId);
    if (itemId !== this.itemId()) {
      return;
    }
    this._lists.set(lists ?? []);
    this.listsStatus.set(lists === null ? 'failed' : 'ready');
  }
}

function hasScopes(context: CatalogBrowseContext): boolean {
  return context.scopes.length > 0;
}

/**
 * How long ago, in whole days, hours or minutes, with `Intl` and never
 * `DatePipe` (the language is runtime state).
 */
function relativeDay(at: Date, locale: string): string {
  const seconds = (at.getTime() - Date.now()) / 1000;
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    Math.abs(seconds) >= 86400
      ? [Math.round(seconds / 86400), 'day']
      : Math.abs(seconds) >= 3600
        ? [Math.round(seconds / 3600), 'hour']
        : [Math.round(seconds / 60), 'minute'];
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      value,
      unit
    );
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
