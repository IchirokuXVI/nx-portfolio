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
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
  type CatalogBrowseServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  catalogOrdersFor,
  chainOfScope,
  scopesOfChain,
  type CatalogBrowseContext,
  type CatalogOrder,
  type CatalogProduct,
} from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  sheetSegments,
} from '@portfolio/velista/platform';
import {
  ChainChips,
  CloseIcon,
  OrderPills,
  ProductRow,
  ProductRowSkeleton,
  productRowView,
  SearchIcon,
  type ChainChip,
  type ProductRowView,
} from '@portfolio/velista/ui';
import { CatalogContext } from '../catalog-context';

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
 * A field, a row of chain chips and three order pills, all drawn, none behind a
 * sheet. That is the opposite of the basket's `ListTools`, and deliberately: here
 * narrowing **is** the activity, so a screen that hid its own controls would give
 * somebody a wall of products and a magnifier.
 *
 * ## Best match exists only while there is something to match (rule C2)
 *
 * The screen opens on A to Z. The moment a search begins, Best match appears in
 * front and is chosen. When the field is emptied it goes, and the order falls back
 * to A to Z if it was on.
 *
 * ## A chip narrows the products and the prices
 *
 * `soldBy` narrows which products are listed (backend `0146`), and the chain's own
 * scopes are sent as the price scopes, so every price on the screen is what that
 * chain charges here. With no chip the read resolves the person's profile and each
 * row shows the cheapest of their shops.
 *
 * ## No postal code is not an empty catalog (`0069`, section 2)
 *
 * Every state lists every product. The priceless ones add one card at the top
 * saying why and how to fix it, and every row says `no price`.
 *
 * ## State lives here, not in a store
 *
 * `ShopStore`'s reasoning: the query, the chain and the pages are about the
 * screen that is open and are thrown away with it.
 */
@Component({
  selector: 'lib-catalog-page',
  imports: [
    ChainChips,
    CloseIcon,
    OrderPills,
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

  protected readonly skeletonRows = SKELETON_ROWS;

  /** What is in the field, exactly as typed. */
  protected readonly typed = signal('');

  /** What the list was last asked for, which lags {@link typed} by the debounce. */
  protected readonly query = signal('');

  /** The chosen chain's id, or null for all shops. */
  protected readonly chain = signal<string | null>(null);

  protected readonly order = signal<CatalogOrder>('name');

  protected readonly context = signal<CatalogBrowseContext | null>(null);

  private readonly _products = signal<readonly CatalogProduct[]>([]);
  private readonly _cursor = signal<string | null>(null);
  protected readonly status = signal<ListStatus>('loading');
  protected readonly moreStatus = signal<MoreStatus>('idle');

  /** Bumped by every new first page, so an answer to an old one is dropped. */
  private _generation = 0;
  private _debounce: ReturnType<typeof setTimeout> | null = null;

  protected readonly orders = computed(() => catalogOrdersFor(this.query()));

  protected readonly hasMore = computed(() => this._cursor() !== null);

  /** The chips, named in the reader's language. */
  protected readonly chips = computed<readonly ChainChip[]>(() => {
    const locale = this._locale();
    return (this.context()?.chains ?? []).map((chain) => ({
      supermarketId: chain.supermarketId,
      name: catalogName(chain.name, locale),
    }));
  });

  /** The chosen chain as the context knows it, for its name and shop count. */
  protected readonly chosenChain = computed(() => {
    const id = this.chain();
    return id === null
      ? null
      : (this.context()?.chains.find((chain) => chain.supermarketId === id) ??
          null);
  });

  protected readonly chosenChainName = computed(() => {
    const chain = this.chosenChain();
    return chain === null ? '' : catalogName(chain.name, this._locale());
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
    const chainChosen = chosen !== null;

    return this._products().map((product) =>
      productRowView(this._pricedBy(product, context, chosen), {
        locale,
        chainChosen,
        translate: (key, args) =>
          this._translator.t(key, undefined, locale, args),
        chainOf: (scope) => this._chainName(context, scope, locale),
      })
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

  protected readonly placeholderKey = computed(() =>
    this.chain() === null ? 'catalog.search.all' : 'catalog.search.chain'
  );

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
    inject(DestroyRef).onDestroy(() => this._clearDebounce());

    void this._context.load().then((context) => this.context.set(context));
    void this._firstPage();
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

  protected chooseChain(supermarketId: string | null): void {
    if (supermarketId === this.chain()) {
      return;
    }
    this.chain.set(supermarketId);
    void this._firstPage();
  }

  protected chooseOrder(order: CatalogOrder): void {
    if (order === this.order()) {
      return;
    }
    this.order.set(order);
    void this._firstPage();
  }

  protected open(itemId: string): void {
    void this._router.navigateByUrl(
      appPath(
        this._locale(),
        this._basePath,
        'catalog',
        ...sheetSegments('products', itemId)
      )
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

  private async _firstPage(): Promise<void> {
    const generation = ++this._generation;
    this.status.set('loading');
    this.moreStatus.set('idle');
    this._products.set([]);
    this._cursor.set(null);

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
      priceScopeIds:
        chain === null || context === null
          ? []
          : [...scopesOfChain(context, chain)],
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
