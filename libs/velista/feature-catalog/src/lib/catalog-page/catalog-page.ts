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
  CategoryStore,
  type CatalogBrowseServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  catalogOrdersFor,
  categoryName,
  chainOfScope,
  scopesOfChain,
  type CatalogBrowseContext,
  type CatalogLocation,
  type CatalogOrder,
  type CatalogProduct,
} from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  sheetSegments,
} from '@portfolio/velista/platform';
import {
  ChevronRightIcon,
  CloseIcon,
  ListLinesIcon,
  OrderPills,
  ProductRow,
  ProductRowSkeleton,
  productRowView,
  SearchIcon,
  SupermarketButton,
  type ChainLogoView,
  type ProductRowView,
} from '@portfolio/velista/ui';
import { CatalogContext } from '../catalog-context';
import { CATEGORY_PARAM, categoryChoice } from '../category-choice';
import {
  catalogChoiceOf,
  catalogQueryOf,
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
 * ## The tools are on the screen (rule C1)
 *
 * A field, the Supermarket button and three order pills, all drawn, none behind
 * a sheet. That is the opposite of the basket's `ListTools`, and deliberately: here
 * narrowing **is** the activity, so a screen that hid its own controls would give
 * somebody a wall of products and a magnifier.
 *
 * ## Best match exists only while there is something to match (rule C2)
 *
 * The screen opens on A to Z. The moment a search begins, Best match appears in
 * front and is chosen. When the field is emptied it goes, and the order falls back
 * to A to Z if it was on.
 *
 * ## A chain narrows the products and the prices, and a shop narrows them further
 *
 * The chain chips became one Supermarket button (velista `0124`), which opens the
 * shop picker as a page of its own. A chain is enough and a shop is optional.
 *
 * With a chain, `soldBy` narrows which products are listed (backend `0146`), and
 * the chain's own scopes are sent as the price scopes, so every price on the screen
 * is what that chain charges here. With a shop, the read sends `locationId` alone
 * (backend `0170`) and is priced at that one shop, and a product it has no price
 * for says so rather than vanishing. With neither, the read resolves the person's
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
 * ## State lives here, not in a store
 *
 * `ShopStore`'s reasoning: the query, the chain and the pages are about the
 * screen that is open and are thrown away with it. The category is the exception,
 * because it is chosen rather than typed (section 2), and it is the URL's.
 */
@Component({
  selector: 'lib-catalog-page',
  imports: [
    ChevronRightIcon,
    CloseIcon,
    ListLinesIcon,
    OrderPills,
    ProductRow,
    ProductRowSkeleton,
    RokuTranslatorPipe,
    RouterLink,
    RouterOutlet,
    SearchIcon,
    SupermarketButton,
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

  protected readonly skeletonRows = SKELETON_ROWS;

  /** What is in the field, exactly as typed. */
  protected readonly typed = signal('');

  /** What the list was last asked for, which lags {@link typed} by the debounce. */
  protected readonly query = signal('');

  /** The chosen chain's id, from `?chain=`, or null for every supermarket. */
  protected readonly chain = signal<string | null>(null);

  /** The chosen shop's id, from `?shop=`, or null for any shop of the chain. */
  protected readonly shop = signal<string | null>(null);

  /** The chosen shop, named, once `GET /v1/catalog/locations/:id` answers. */
  protected readonly location = signal<CatalogLocation | null>(null);

  protected readonly order = signal<CatalogOrder>('name');

  protected readonly context = signal<CatalogBrowseContext | null>(null);

  /** The slug in `?category=`, exactly as the URL holds it. */
  protected readonly categorySlug = signal<string | null>(null);

  /** Whether the URL has been read once, so its first emission always reads. */
  private _urlRead = false;

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
   * chain the app knows: a shop from Recent or Near me can be outside the person's
   * areas, and its chain is still worth naming.
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

  /** The chosen shop in words: its own name, else its street, else its town. */
  protected readonly shopName = computed(() => {
    const location = this.location();
    if (location === null) {
      return '';
    }
    const label =
      location.label === null
        ? ''
        : catalogName(location.label, this._locale());
    return label || location.address?.trim() || location.city?.trim() || '';
  });

  /** Where the tab is priced: "Calle Mayor 3, Córdoba". */
  protected readonly shopPlace = computed(() => {
    const location = this.location();
    const name = this.shopName();
    if (location === null || name === '') {
      return '';
    }
    const town = location.city?.trim() ?? '';
    return town !== '' && town !== name ? `${name}, ${town}` : name;
  });

  /** What the Supermarket button draws (target 8). */
  protected readonly supermarket = computed<{
    readonly logo: ChainLogoView;
    readonly value: string;
    readonly detail: string | null;
    readonly chosen: boolean;
  }>(() => {
    const locale = this._locale();
    this._translator.loaded();
    const id = this.chain();
    if (id === null) {
      return {
        logo: { logoUrl: null, name: '', store: true },
        value: this._translator.t('catalog.supermarket.all', undefined, locale),
        detail: null,
        chosen: false,
      };
    }
    const name = this.chosenChainName();
    return {
      logo: {
        logoUrl: this.chosenChain()?.logoUrl ?? null,
        name,
        store: false,
      },
      value: name,
      detail:
        this.shop() === null
          ? this._translator.t('catalog.supermarket.anyShop', undefined, locale)
          : this.shopName() || null,
      chosen: true,
    };
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

  /** The root's name, drawn in front of a leaf on the chip (rule P4). */
  protected readonly categoryRootLabel = computed(() => {
    const choice = this.choice();
    return choice === null ? '' : categoryName(choice.root, this._locale());
  });

  /** Whether the choice is a leaf, which the chip draws as root and leaf. */
  protected readonly leafChosen = computed(() => {
    const choice = this.choice();
    return choice !== null && choice.node !== choice.root;
  });

  /** The chip's accessible name: both names whole, and what a tap does. */
  protected readonly categoryChipLabel = computed(() => {
    const locale = this._locale();
    this._translator.loaded();
    return this.leafChosen()
      ? this._translator.t('catalog.categories.chip', undefined, locale, {
          root: this.categoryRootLabel(),
          leaf: this.categoryLabel(),
        })
      : this._translator.t('catalog.categories.chipRoot', undefined, locale, {
          root: this.categoryLabel(),
        });
  });

  /** The page of parents, where the Categories link goes. */
  protected readonly categoriesPath = computed(() =>
    appPath(this._locale(), this._basePath, 'catalog', 'categories')
  );

  /** The chosen root's children page, where the chip's body goes (target 3). */
  protected readonly categoryChipPath = computed(() => {
    const choice = this.choice();
    return choice === null
      ? this.categoriesPath()
      : appPath(
          this._locale(),
          this._basePath,
          'catalog',
          'categories',
          choice.root.slug
        );
  });

  /** The tab's own choice, carried to the children page so it can mark it. */
  protected readonly categoryChipQuery = computed(() => {
    const slug = this.categorySlug();
    return slug === null ? null : { [CATEGORY_PARAM]: slug };
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

  protected readonly rows = computed<readonly ProductRowView[]>(() => {
    const locale = this._locale();
    // Read so the rows are drawn again once the words arrive.
    this._translator.loaded();
    const context = this.context();
    const chosen = this.chain();
    const shopChosen = this.shop() !== null;
    const chainChosen = chosen !== null || shopChosen;

    return this._products().map((product) =>
      productRowView(
        // A shop's read is priced at that shop by the server, so there is no other
        // chain's price to strip from it.
        shopChosen ? product : this._pricedBy(product, context, chosen),
        {
          locale,
          chainChosen,
          shopChosen,
          translate: (key, args) =>
            this._translator.t(key, undefined, locale, args),
          chainOf: (scope) => this._chainName(context, scope, locale),
        }
      )
    );
  });

  /**
   * How many products are drawn, for the count heard on a keystroke and shown
   * while searching. The read is a cursor page with no total, so a list with more
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
    // the picker returning a chain or a shop, or a link landing on this same page.
    const params = this._route.queryParamMap.subscribe((map) =>
      this._readChoice(catalogChoiceOf(map))
    );
    inject(DestroyRef).onDestroy(() => {
      params.unsubscribe();
      this._clearDebounce();
    });

    void this._context.load().then((context) => this.context.set(context));
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
   * The Supermarket button: the picker, a page of its own (target 8), handed the
   * current choice so it can check it, and the category so it comes back with it.
   */
  protected openSupermarket(): void {
    const url = this._router.parseUrl(
      appPath(this._locale(), this._basePath, 'catalog', 'supermarket')
    );
    url.queryParams = catalogQueryOf(this._choice());
    void this._router.navigateByUrl(url);
  }

  /** The x: every supermarket again, pushed like the category chip's cross. */
  protected clearSupermarket(): void {
    void this._router.navigateByUrl(
      this._tabUrl({ ...this._choice(), chain: null, shop: null })
    );
  }

  protected chooseOrder(order: CatalogOrder): void {
    if (order === this.order()) {
      return;
    }
    this.order.set(order);
    void this._firstPage();
  }

  protected open(itemId: string): void {
    // The sheet covers the narrowed tab, so it keeps the choice in its URL and
    // closing it pops back onto the same narrowing.
    const url = this._router.parseUrl(
      appPath(
        this._locale(),
        this._basePath,
        'catalog',
        ...sheetSegments('products', itemId)
      )
    );
    url.queryParams = catalogQueryOf(this._choice());
    void this._router.navigateByUrl(url);
  }

  /**
   * The chip's cross and the empty leaf's button: the tab without the parameter,
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
    this.query.set(words);

    if (before === '' && after !== '') {
      this.order.set('relevance');
    } else if (after === '' && this.order() === 'relevance') {
      this.order.set('name');
    }
    if (before === after) {
      return;
    }
    void this._firstPage();
  }

  /** A choice arriving from the URL. The same choice again changes nothing. */
  private _readChoice(choice: CatalogChoice): void {
    const shopChanged = choice.shop !== this.shop();
    if (
      this._urlRead &&
      choice.category === this.categorySlug() &&
      choice.chain === this.chain() &&
      !shopChanged
    ) {
      return;
    }
    this._urlRead = true;
    this.categorySlug.set(choice.category);
    this.chain.set(choice.chain);
    this.shop.set(choice.shop);
    if (shopChanged) {
      this._readLocation(choice.shop);
    }
    void this._firstPage();
  }

  /**
   * The chosen shop's words, for the button and the note. A shop named without its
   * chain takes the chain from the shop, so a hand typed link still says whose.
   *
   * The chain it takes is written into the URL too, in place of this entry. The URL
   * is the choice, and a signal holding a chain the URL does not would read the next
   * emission (a product sheet closing onto `?shop=` alone, say) as a different
   * choice: the chain dropped again and the first page read for nothing.
   */
  private _readLocation(shopId: string | null): void {
    this.location.set(null);
    if (shopId === null) {
      return;
    }
    void this._browse.location(shopId).then((location) => {
      if (location === null || this.shop() !== shopId) {
        return;
      }
      this.location.set(location);
      if (this.chain() === null) {
        this.chain.set(location.supermarketId);
        // The current URL, whatever covers the tab, with the choice as it now is.
        const url = this._router.parseUrl(this._router.url);
        url.queryParams = {
          ...url.queryParams,
          ...catalogQueryOf(this._choice()),
        };
        void this._router.navigateByUrl(url, { replaceUrl: true });
      }
    });
  }

  /** What the URL holds now, for the links that keep part of it. */
  private _choice(): CatalogChoice {
    return {
      category: this.categorySlug(),
      chain: this.chain(),
      shop: this.shop(),
    };
  }

  private _tabPath(): string {
    return appPath(this._locale(), this._basePath, 'catalog');
  }

  /** The tab with this choice in its URL. */
  private _tabUrl(choice: CatalogChoice) {
    const url = this._router.parseUrl(this._tabPath());
    url.queryParams = catalogQueryOf(choice) as Params;
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
    // before the read. With no chain the read resolves the profile by itself, and
    // a shop's read is priced by the server at that shop.
    const context =
      this.chain() === null || this.shop() !== null
        ? this.context()
        : await this._context.load();
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
    const shop = this.shop();
    if (shop !== null) {
      // One shop (backend `0170`): the server takes its chain and its scope from
      // the shop and refuses either beside it, so neither is sent.
      return {
        query: this.query(),
        order: this.order(),
        soldBy: null,
        categoryId: this.choice()?.node.id ?? null,
        priceScopeIds: [],
        locationId: shop,
        cursor,
        limit: CATALOG_PAGE_SIZE,
      };
    }
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
