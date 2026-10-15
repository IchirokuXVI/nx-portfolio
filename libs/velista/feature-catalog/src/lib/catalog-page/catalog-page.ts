import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  RouterOutlet,
  type Params,
} from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
  CatalogAddStore,
  CategoryStore,
  ProductPickStore,
  type CatalogBrowseServiceI,
  type ProductPickKind,
  type ProductPickRequest,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  catalogOrdersFor,
  catalogToolsView,
  categoryName,
  chainOfScope,
  scopesOfChain,
  unpricedStart,
  type CatalogBrowseContext,
  type CatalogOrder,
  type CatalogProduct,
} from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  CATALOG_PATHS,
  CATALOG_PICK_DATA,
  PageNavigation,
  productPagePath,
  sheetSegments,
} from '@portfolio/velista/platform';
import {
  AddingBar,
  CatalogSelectors,
  ChoosingBar,
  CloseIcon,
  OrderMenu,
  PageHeader,
  ProductIcon,
  ProductRow,
  ProductRowSkeleton,
  productRowView,
  SearchIcon,
  type ProductRowAdd,
  type ProductRowChoice,
  type ProductRowLineStep,
  type ProductRowView,
} from '@portfolio/velista/ui';
import { CatalogContext } from '../catalog-context';
import { routePath } from '../catalog-opener';
import { categoryChoice } from '../category-choice';
import { rowAdds } from '../row-adds';
import {
  CATALOG_PARAMS,
  catalogChoiceOf,
  catalogOrderAfter,
  catalogQueryOf,
  defaultCatalogOrder,
  type CatalogChoice,
} from '../supermarket-choice';

/** How long the field waits after a keystroke before it asks (section 2). */
export const CATALOG_SEARCH_DEBOUNCE_MS = 300;

/** One page of products. Enough to fill a tall phone twice over. */
export const CATALOG_PAGE_SIZE = 30;

/** The skeleton rows drawn while the first page is on its way. */
const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

type ListStatus = 'loading' | 'ready' | 'failed';
type MoreStatus = 'idle' | 'loading' | 'failed';

/**
 * The second tab: every product from every supermarket (velista `0100`).
 *
 * ## The tools are the search and one row (velista `0134`, section 2)
 *
 * A field, and under it two selectors that name what the list shows: the
 * supermarket and the category. They were four stacked rows that took a third of
 * the screen. The order moved onto the line that heads the list (section 3), with
 * where the prices are from at its other end.
 *
 * ## Best match exists only while there is something to match (rule C2)
 *
 * The screen opens on the catalog's own order. The moment a search begins, Best
 * match joins the menu and is chosen. When the field is emptied it goes, and the
 * order falls back if it was on.
 *
 * ## The plus adds to the list the line names (velista `0134`, section 4)
 *
 * Each row has a plus, and a line above the tab bar says which list it adds to.
 * Under a row sit the lines of that list that already hold the product, each with
 * its own stepper. `CatalogAddStore` holds the list, those lines and the record of
 * what this visit added, and it is the app's and not this page's: the pickers are
 * pages of their own, so this component is destroyed while one is open. A guest
 * and a person with no list to write to see neither the plus nor the line.
 *
 * When the lists cannot be read the line says so and offers a second try. Without
 * that a failed read looked exactly like having no list.
 *
 * ## A chain narrows the products and the prices
 *
 * The Supermarket selector opens the supermarket picker as a page of its own
 * (velista `0124`). A chain is the whole choice: the catalog is never narrowed to
 * one shop.
 *
 * With a chain, `soldBy` narrows which products are listed (backend `0146`), and
 * the chain's own scopes are sent as the price scopes, so every price on the screen
 * is what that chain charges here. Without one, the read resolves the person's
 * profile and each row shows the cheapest of their shops.
 *
 * ## No postal code is not an empty catalog (`0069`, section 2)
 *
 * Every state lists every product. The priceless ones add one card at the top
 * saying why and how to fix it, and every row says `no price`.
 *
 * ## A category narrows it too, and lives in the URL (velista `0119`)
 *
 * `?category=<slug>` is the one place the choice lives, so a shared link opens the
 * tab narrowed and each step of the picker is a history entry. The slug is resolved
 * through `CategoryStore` and sent as `categoryId`, a leaf or a root, composed with
 * the field, the chain chip and the order. A slug the tree does not hold drops the
 * parameter and opens the tab plain. Clearing the choice is a navigation to the tab
 * without it, never a pop.
 *
 * ## State lives in the URL, not in a store
 *
 * The pages of products are about the screen that is open and are thrown away with
 * it. Every filter is the URL's: the category, the chain, and the text and the
 * order too (`?q=`, `?order=`). The pickers are pages of their own, so the tab is
 * destroyed while one is open, and a filter held only in a signal here came back
 * reset from choosing a supermarket or a category. The text and the order are
 * written in place of the entry as they change, so a pop back onto the tab finds
 * them as well. A visit from the bar opens the tab plain, as before.
 *
 * ## The same page opens to choose (velista `0140`, section 3)
 *
 * Under `…/lines/:lineId/product` the route's data names a kind
 * (`CATALOG_PICK_DATA`), and the page chooses one product for a line instead of
 * adding to a list. Everything above, the tools, the order, the cards, the states,
 * is the tab's, so a rule of the tab that changes later reaches both. Four things
 * differ, so nobody takes one for the other: the header closes and says "Choose a
 * product", the bar of tabs is not drawn (the route's chrome), a bar at the foot
 * names what the product is for, and nothing on the page adds to a list. A press on
 * a card chooses it and opens nothing.
 *
 * What the caller handed over and the product chosen so far are in
 * `ProductPickStore`, because the pickers are pages and this component is gone
 * while one is open. The pickers are declared under this page's route, so they
 * come back to it. Close and "Use this product" walk back past every entry the
 * pickers added, to the screen that opened the page.
 */
@Component({
  selector: 'lib-catalog-page',
  imports: [
    AddingBar,
    CatalogSelectors,
    ChoosingBar,
    CloseIcon,
    OrderMenu,
    PageHeader,
    ProductIcon,
    ProductRow,
    ProductRowSkeleton,
    RokuTranslatorPipe,
    RouterLink,
    RouterOutlet,
    SearchIcon,
  ],
  providers: [CatalogContext],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {
  private readonly _browse = inject<CatalogBrowseServiceI>(
    CATALOG_BROWSE_SERVICE
  );
  private readonly _context = inject(CatalogContext);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _router = inject(Router);
  private readonly _browser = inject(BrowserFacade);
  private readonly _route = inject(ActivatedRoute);
  private readonly _categories = inject(CategoryStore);
  private readonly _adds = inject(CatalogAddStore);
  private readonly _pick = inject(ProductPickStore);
  private readonly _pages = inject(PageNavigation);

  protected readonly skeletonRows = SKELETON_ROWS;

  /**
   * What the page chooses, by its route, or null for the catalog tab (velista
   * `0140`, section 3).
   */
  protected readonly pickKind: ProductPickKind | null =
    (this._route.snapshot?.data?.[CATALOG_PICK_DATA] as
      | ProductPickKind
      | undefined) ?? null;

  /** The line the route of the catalog that chooses names. */
  private readonly _pickLineId: string | null =
    this._route.snapshot?.paramMap?.get('lineId') ?? null;

  /** What the screen that opened the page handed it, for this line, or null. */
  protected readonly pickRequest = computed<ProductPickRequest | null>(() => {
    const request = this._pick.request();
    return this.pickKind !== null &&
      request !== null &&
      request.lineId === this._pickLineId
      ? request
      : null;
  });

  /** The product chosen so far in the catalog that chooses. */
  protected readonly pickChosen = this._pick.chosen;

  /** The list the plus adds to, or null for somebody with none to write to. */
  protected readonly addTarget = this._adds.target;

  /** How many products this visit added, for the line above the tab bar. */
  protected readonly addedCount = this._adds.count;

  /**
   * What could not be read, or null: the lists, or the lines of the chosen one.
   * Either draws one sentence and a second try where the line would be.
   */
  protected readonly addsProblem = computed<'lists' | 'lines' | null>(() => {
    if (this._adds.status() === 'failed') {
      return 'lists';
    }
    return this._adds.linesStatus() === 'failed' ? 'lines' : null;
  });

  /** A write that failed, said once in the live region until the next press. */
  protected readonly addFailed = signal(false);

  /** What is in the field, exactly as typed. */
  protected readonly typed = signal('');

  /** What the list was last asked for, which lags {@link typed} by the debounce. */
  protected readonly query = signal('');

  /** The chosen chain's id, from `?chain=`, or null for every supermarket. */
  protected readonly chain = signal<string | null>(null);

  protected readonly order = signal<CatalogOrder>(defaultCatalogOrder(''));

  protected readonly context = signal<CatalogBrowseContext | null>(null);

  /** The slug in `?category=`, exactly as the URL holds it. */
  protected readonly categorySlug = signal<string | null>(null);

  /** Whether the URL has been read once, so its first emission always reads. */
  private _urlRead = false;

  /**
   * The page's own writes of the text and the order that have not landed yet. While
   * one is on its way the field is ahead of the URL, so the URL does not overrule it.
   */
  private _writes = 0;

  private readonly _products = signal<readonly CatalogProduct[]>([]);
  private readonly _cursor = signal<string | null>(null);
  protected readonly status = signal<ListStatus>('loading');
  protected readonly moreStatus = signal<MoreStatus>('idle');

  /** Bumped by every new first page, so an answer to an old one is dropped. */
  private _generation = 0;
  private _debounce: ReturnType<typeof setTimeout> | null = null;

  protected readonly orders = computed(() => catalogOrdersFor(this.query()));

  protected readonly hasMore = computed(() => this._cursor() !== null);

  /** The chosen chain as the context knows it, for its name and shop count. */
  protected readonly chosenChain = computed(() => {
    const id = this.chain();
    return id === null
      ? null
      : (this.context()?.chains.find((chain) => chain.supermarketId === id) ??
          null);
  });

  /**
   * The chosen chain's name. From the chains near the person, else from every
   * chain the app knows: a link can name a chain outside the person's areas, and
   * it is still worth naming.
   */
  protected readonly chosenChainName = computed(() => {
    const id = this.chain();
    const context = this.context();
    if (id === null || context === null) {
      return '';
    }
    const name = this.chosenChain()?.name ?? context.chainNames.get(id) ?? null;
    return name === null ? '' : catalogName(name, this._locale());
  });

  /** What the two selectors and the line that heads the list say. */
  protected readonly tools = computed(() => {
    const choice = this.choice();
    const locale = this._locale();
    return catalogToolsView({
      chainId: this.chain(),
      chainName: this.chosenChainName(),
      chainLogoUrl: this.chosenChain()?.logoUrl ?? null,
      category:
        choice === null
          ? null
          : {
              name: categoryName(choice.node, locale),
              root:
                choice.node === choice.root
                  ? null
                  : categoryName(choice.root, locale),
            },
      postalCode: this.near(),
    });
  });

  /** The chosen category and its root, or null for none or a slug not in the tree. */
  protected readonly choice = computed(() =>
    categoryChoice(this._categories.tree(), this.categorySlug())
  );

  /** The chosen category's name: the leaf's, or the root's when a root is chosen. */
  protected readonly categoryLabel = computed(() => {
    const choice = this.choice();
    return choice === null ? '' : categoryName(choice.node, this._locale());
  });

  /**
   * Where the Category selector goes: the page of parents, or with a category
   * chosen its root's children page, where the choice is marked.
   */
  private readonly _categoryPath = computed(() => {
    const choice = this.choice();
    const pickers = `${this._ownPath()}/${CATALOG_PATHS.categoryPicker}`;
    return choice === null ? pickers : `${pickers}/${choice.root.slug}`;
  });

  /**
   * What the URL holds, or is about to: the text is the field's, so a link followed
   * before the debounce carries what was typed, in the order that text settles on.
   */
  private readonly _choice = computed<CatalogChoice>(() => {
    const typed = this.typed();
    const order = catalogOrderAfter(this.query(), typed, this.order());
    return {
      category: this.categorySlug(),
      chain: this.chain(),
      query: typed.trim() === '' ? null : typed,
      order: order === defaultCatalogOrder(typed) ? null : order,
    };
  });

  /** The first postal code, for `near 14013`. */
  protected readonly near = computed(
    () => this.context()?.postalCodes[0] ?? null
  );

  /** The card at the top, or null while prices can be shown. */
  protected readonly card = computed(() => {
    const state = this.context()?.state;
    return state === 'noPlace' || state === 'unserved' || state === 'refused'
      ? state
      : null;
  });

  /** Where the card's button goes: the screen that edits postal codes and shops. */
  protected readonly placePath = computed(() =>
    appPath(this._locale(), this._basePath, 'account', 'profiles')
  );

  /** The products as they are priced on this screen. */
  private readonly _shown = computed<readonly CatalogProduct[]>(() => {
    const context = this.context();
    const chosen = this.chain();
    return this._products().map((product) =>
      this._pricedBy(product, context, chosen)
    );
  });

  /**
   * The row the "Without a price" line stands before (section 3), or null. The
   * server puts the rows with no price last in a price order, and the line says
   * where they start.
   */
  protected readonly unpricedAt = computed(() =>
    unpricedStart(this.order(), this._shown())
  );

  protected readonly rows = computed<readonly ProductRowView[]>(() => {
    const locale = this._locale();
    // Read so the rows are drawn again once the words arrive.
    this._translator.loaded();
    const context = this.context();
    const chainChosen = this.chain() !== null;

    return this._shown().map((product) =>
      productRowView(product, {
        locale,
        chainChosen,
        translate: (key, args) =>
          this._translator.t(key, undefined, locale, args),
        chainOf: (scope) => this._chainName(context, scope, locale),
      })
    );
  });

  /** The plus of each row and the lines under it, for the chosen list (section 4.1). */
  private readonly _rowAdds = computed(() =>
    rowAdds(this.addTarget(), this._adds.held())
  );

  /**
   * How many products are drawn, for the count heard on a keystroke. The read is a cursor page with no total, so a list with more
   * to come says "more than".
   */
  protected readonly countKey = computed(() =>
    this.hasMore() ? 'catalog.countMore' : 'catalog.count'
  );

  protected readonly count = computed(() => this._products().length);

  /**
   * The field says where it searches (rule P5): every supermarket, a chain, a
   * category, or a category at a chain. The name is placed after "in" as it arrives,
   * never folded into the grammar around it.
   */
  protected readonly placeholderKey = computed(() => {
    const chain = this.chain() !== null;
    if (this.choice() !== null) {
      return chain
        ? 'catalog.categories.searchChain'
        : 'catalog.categories.search';
    }
    return chain ? 'catalog.search.chain' : 'catalog.search.all';
  });

  protected readonly placeholderArgs = computed(() => ({
    chain: this.chosenChainName(),
    category: this.categoryLabel(),
  }));

  private readonly _sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  /**
   * Ask for the next page when the end of the list comes near. The sentinel sits
   * under the last row, and the margin starts the request a screen early.
   */
  private readonly _pagingEffect = effect((onCleanup) => {
    const sentinel = this._sentinel();
    if (sentinel === undefined) {
      return;
    }
    const stop = this._browser.observeIntersection(
      sentinel.nativeElement,
      (visible) => {
        if (visible) {
          untracked(() => void this.loadMore());
        }
      },
      { rootMargin: '0px 0px 600px 0px' }
    );
    onCleanup(stop);
  });

  constructor() {
    // The URL is the choice (0119 target 5, 0124 target 8). The first emission is
    // the arrival and starts the first page; a later one is a chip being cleared,
    // the picker returning a chain, or a link landing on this same page.
    const params = this._route.queryParamMap.subscribe((map) =>
      this._readChoice(catalogChoiceOf(map))
    );
    inject(DestroyRef).onDestroy(() => {
      params.unsubscribe();
      this._clearDebounce();
    });

    void this._context.load().then((context) => this.context.set(context));
    // The catalog that chooses adds to nothing, so it reads no list to add to.
    if (this.pickKind === null) {
      void this._adds.ensure();
    } else if (this.pickRequest() === null) {
      // Nothing opened it: a reload, or a link. There is no caller to answer, so
      // the page goes to the list the line is on, in place of this entry.
      void this._router.navigateByUrl(this._pickFallback(), {
        replaceUrl: true,
      });
    }

    // A failed write is said once (section 4.1): the store counts them, and each
    // new one raises the sentence until the next press takes it down.
    let failures = this._adds.failures();
    effect(() => {
      const now = this._adds.failures();
      if (now !== failures) {
        failures = now;
        untracked(() => this.addFailed.set(true));
      }
    });
  }

  /**
   * What a row's trailing control draws, or null for a row with no plus. The
   * catalog that chooses draws none: nothing on it adds to a list.
   */
  protected addOf(itemId: string): ProductRowAdd | null {
    if (this.pickKind !== null) {
      return null;
    }
    const adds = this._rowAdds();
    return adds.byItem.get(itemId) ?? adds.plain;
  }

  /** The radio of a row in the catalog that chooses, or null in the tab. */
  protected choiceOf(itemId: string): ProductRowChoice | null {
    return this.pickKind === null
      ? null
      : { name: 'catalog-pick', checked: this.pickChosen() === itemId };
  }

  /** A press on a card in the catalog that chooses: that product is the choice. */
  protected choose(itemId: string): void {
    this._pick.choose(itemId);
  }

  /**
   * "Use this product": the answer is left for the screen that opened the page,
   * and the page goes back to it past every entry the pickers added.
   */
  protected usePick(): void {
    const request = this.pickRequest();
    if (request !== null && this._pick.use()) {
      void this._pages.backTo(request.returnDepth, request.returnUrl);
    }
  }

  /** Close: back to the screen that opened the page, with nothing changed. */
  protected closePick(): void {
    const request = this.pickRequest();
    if (request === null) {
      void this._router.navigateByUrl(this._pickFallback(), {
        replaceUrl: true,
      });
      return;
    }
    this._pick.cancel();
    void this._pages.backTo(request.returnDepth, request.returnUrl);
  }

  /** The plus on a row: one of this product on the chosen list. */
  protected addProduct(row: ProductRowView): void {
    this.addFailed.set(false);
    void this._adds.add({
      itemId: row.id,
      name: row.name,
      detail: row.summary,
    });
  }

  /** A press on the stepper of one line under a row. */
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

  /** The second try after the lists, or the lines of the chosen one, did not load. */
  protected retryAdds(): void {
    void this._adds.retry();
  }

  /** The name on the line above the tab bar: the sheet of lists. */
  protected openLists(): void {
    void this._router.navigateByUrl(this._sheetUrl(CATALOG_PATHS.addListSheet));
  }

  /** The count on that line: the sheet of what this visit added. */
  protected openAdded(): void {
    void this._router.navigateByUrl(this._sheetUrl(CATALOG_PATHS.addedSheet));
  }

  /** A keystroke: shown at once, asked for after the debounce. */
  protected onInput(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
    this._clearDebounce();
    this._debounce = setTimeout(() => {
      this._debounce = null;
      this._search(this.typed());
    }, CATALOG_SEARCH_DEBOUNCE_MS);
  }

  /** The cross in the field, and the empty state's button. */
  protected clearSearch(): void {
    this._clearDebounce();
    this.typed.set('');
    this._search('');
  }

  /**
   * The Supermarket selector: the picker, a page of its own (velista `0124`,
   * target 8), handed the current choice so it can check it, and the category so
   * it comes back with it.
   */
  protected openSupermarket(): void {
    const url = this._router.parseUrl(
      `${this._ownPath()}/${CATALOG_PATHS.supermarketPicker}`
    );
    url.queryParams = catalogQueryOf(this._choice());
    void this._router.navigateByUrl(url);
  }

  /** Its cross: every supermarket again, pushed like the category's cross. */
  protected clearSupermarket(): void {
    void this._router.navigateByUrl(
      this._tabUrl({ ...this._choice(), chain: null })
    );
  }

  protected chooseOrder(order: CatalogOrder): void {
    if (order === this.order()) {
      return;
    }
    this.order.set(order);
    this._writeChoice();
    void this._firstPage();
  }

  /**
   * The Category selector: the picker's pages (velista `0119`), handed the whole
   * choice. The children page marks the category with it, and whichever row is
   * chosen comes back with the rest of it.
   */
  protected openCategory(): void {
    const url = this._router.parseUrl(this._categoryPath());
    url.queryParams = catalogQueryOf(this._choice());
    void this._router.navigateByUrl(url);
  }

  /**
   * A row: the product's page (velista `0134`, section 5). The tab keeps its
   * choice in its own history entry, so the page's back control pops onto the
   * same list.
   */
  protected open(itemId: string): void {
    void this._router.navigateByUrl(
      productPagePath(this._locale(), this._basePath, itemId)
    );
  }

  /**
   * The selector's cross and the empty leaf's button: the tab without the parameter,
   * pushed and not popped (target 4), so the supermarket and the text survive it.
   */
  protected clearCategory(): void {
    void this._router.navigateByUrl(
      this._tabUrl({ ...this._choice(), category: null })
    );
  }

  protected retry(): void {
    void this._firstPage();
  }

  /** The next page, when there is one and nothing is already on its way. */
  async loadMore(): Promise<void> {
    const cursor = this._cursor();
    if (
      cursor === null ||
      this.status() !== 'ready' ||
      this.moreStatus() === 'loading'
    ) {
      return;
    }

    const generation = this._generation;
    this.moreStatus.set('loading');
    const page = await this._browse.browse(this._request(cursor));
    if (generation !== this._generation) {
      return;
    }
    if (page === null) {
      this.moreStatus.set('failed');
      return;
    }
    this._products.update((held) => [...held, ...page.items]);
    this._cursor.set(page.nextCursor);
    this.moreStatus.set('idle');
  }

  /**
   * A new search, applying rule C2 on the way: Best match is chosen the moment
   * one begins and dropped the moment it ends.
   */
  private _search(words: string): void {
    const before = this.query().trim();
    const after = words.trim();
    this.order.set(catalogOrderAfter(before, after, this.order()));
    this.query.set(words);

    if (before === after) {
      return;
    }
    this._writeChoice();
    void this._firstPage();
  }

  /** A choice arriving from the URL. The same choice again changes nothing. */
  private _readChoice(choice: CatalogChoice): void {
    const held = this._choice();
    // The text and the order are read on arrival and on a pop onto another entry
    // of the tab. The page's own write of them is not news to it.
    const typedHere = this._urlRead && this._writes > 0;
    const wordsChanged =
      !typedHere &&
      ((choice.query ?? '').trim() !== (held.query ?? '').trim() ||
        choice.order !== held.order);
    if (
      this._urlRead &&
      choice.category === this.categorySlug() &&
      choice.chain === this.chain() &&
      !wordsChanged
    ) {
      return;
    }
    this._urlRead = true;
    this.categorySlug.set(choice.category);
    this.chain.set(choice.chain);
    if (wordsChanged) {
      const words = choice.query ?? '';
      this._clearDebounce();
      this.typed.set(words);
      this.query.set(words);
      this.order.set(choice.order ?? defaultCatalogOrder(words));
    }
    void this._firstPage();
  }

  /**
   * The text or the order changed: the current URL, whatever covers the tab, with
   * the choice as it now is, in place of this entry. A change of either is not a
   * step somebody walks back through, and a pop onto the tab must find them.
   */
  private _writeChoice(): void {
    const url = this._router.parseUrl(this._router.url);
    const kept: Params = {};
    for (const [name, value] of Object.entries(url.queryParams)) {
      if (!CATALOG_PARAMS.includes(name)) {
        kept[name] = value;
      }
    }
    url.queryParams = { ...kept, ...catalogQueryOf(this._choice()) };
    if (this._router.serializeUrl(url) === this._router.url) {
      return;
    }
    this._writes++;
    const landed = () => {
      this._writes--;
    };
    void this._router
      .navigateByUrl(url, { replaceUrl: true })
      .then(landed, landed);
  }

  /** A sheet over the tab, keeping the choice so it closes onto the same list. */
  private _sheetUrl(about: string) {
    const url = this._router.parseUrl(
      appPath(
        this._locale(),
        this._basePath,
        'catalog',
        ...sheetSegments(about)
      )
    );
    url.queryParams = catalogQueryOf(this._choice());
    return url;
  }

  /**
   * This page's own path: the tab's, or in the catalog that chooses the path of
   * its route, which names the line. The pickers are opened under it and come back
   * to it, and a cleared chip lands on it.
   */
  private _ownPath(): string {
    return this.pickKind === null
      ? appPath(this._locale(), this._basePath, CATALOG_PATHS.tab)
      : routePath(this._route.snapshot);
  }

  /**
   * Where the catalog that chooses goes with no screen to go back to: the list
   * its line is on, which is the fallback velista `0146` names for the same page.
   */
  private _pickFallback(): string {
    const params = this._route.snapshot.paramMap;
    return appPath(
      this._locale(),
      this._basePath,
      'zones',
      params.get('zoneId') ?? '',
      'lists',
      params.get('listId') ?? ''
    );
  }

  /** This page with this choice in its URL. */
  private _tabUrl(choice: CatalogChoice) {
    const url = this._router.parseUrl(this._ownPath());
    url.queryParams = catalogQueryOf(choice);
    return url;
  }

  private async _firstPage(): Promise<void> {
    const generation = ++this._generation;
    this.status.set('loading');
    this.moreStatus.set('idle');
    this._products.set([]);
    this._cursor.set(null);

    // A category is sent by id, so the tree has to be known before the read. It is
    // read once per session and is usually held already.
    if (this.categorySlug() !== null) {
      await this._categories.ensure();
      if (generation !== this._generation) {
        return;
      }
      if (this._categories.loaded() && this.choice() === null) {
        // A slug the tree does not hold: drop it and open the tab without it
        // (target 5), in place of this entry, so back does not return to a broken
        // link. The supermarket is kept.
        void this._router.navigateByUrl(
          this._tabUrl({ ...this._choice(), category: null }),
          { replaceUrl: true }
        );
        return;
      }
    }

    // A chain's prices come from its own scopes, so the context has to be known
    // before the read. With no chain the read resolves the profile by itself.
    const context =
      this.chain() === null ? this.context() : await this._context.load();
    if (generation !== this._generation) {
      return;
    }

    const page = await this._browse.browse(this._request(null, context));
    if (generation !== this._generation) {
      return;
    }
    if (page === null) {
      this.status.set('failed');
      return;
    }
    this._products.set(page.items);
    this._cursor.set(page.nextCursor);
    this.status.set('ready');
  }

  private _request(
    cursor: string | null,
    context: CatalogBrowseContext | null = this.context()
  ) {
    const chain = this.chain();
    return {
      query: this.query(),
      order: this.order(),
      soldBy: chain,
      categoryId: this.choice()?.node.id ?? null,
      priceScopeIds:
        chain === null || context === null
          ? []
          : [...scopesOfChain(context, chain)],
      locationId: null,
      cursor,
      limit: CATALOG_PAGE_SIZE,
    };
  }

  /**
   * The product with its price only when the chosen chain charges it.
   *
   * The read is priced from that chain's scopes, so this changes nothing on an
   * ordinary answer. It is for the one case where the chain has no scope for the
   * person, the read falls back to their profile, and the cheapest price is some
   * other chain's: a row under a Mercadona chip must never show what Deza charges.
   */
  private _pricedBy(
    product: CatalogProduct,
    context: CatalogBrowseContext | null,
    chosen: string | null
  ): CatalogProduct {
    const offer = product.offer;
    if (chosen === null || offer === null) {
      return product;
    }
    const owner =
      context === null ? null : chainOfScope(context, offer.priceScopeId);
    return owner === chosen
      ? product
      : { ...product, offer: null, unitBasis: null };
  }

  private _chainName(
    context: CatalogBrowseContext | null,
    priceScopeId: string,
    locale: string
  ): string | null {
    if (context === null) {
      return null;
    }
    const chain = chainOfScope(context, priceScopeId);
    const name = chain === null ? undefined : context.chainNames.get(chain);
    return name === undefined ? null : catalogName(name, locale);
  }

  private _clearDebounce(): void {
    if (this._debounce !== null) {
      clearTimeout(this._debounce);
      this._debounce = null;
    }
  }
}
