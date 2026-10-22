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
  ItemNames,
  LineStore,
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
  productSetChange,
  productSetChanged,
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
  ClearsField,
  CloseIcon,
  LeaveQuestion,
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
import { lineProductCard, rebaseProductSet, tickProduct } from '../pick-set';
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

/** What the live region at the foot of the catalog that chooses says, or null. */
interface PickNote {
  readonly key: string;
  readonly args?: Record<string, unknown>;
}

/** A product of the line drawn first in the kind `set`, or a bone while it is read. */
interface LineCard {
  readonly id: string;
  readonly row: ProductRowView | null;
}

/** The skeleton rows drawn while the first page is on its way. */
const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

type ListStatus = 'loading' | 'ready' | 'failed';
type MoreStatus = 'idle' | 'loading' | 'failed';

/** Two lists of products, the same in the same order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, at) => id === b[at]);
}

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
 *
 * ## Or the whole set of a line (velista `0146`, section 3)
 *
 * Under `…/lines/:lineId/products` the kind is `set`: a tick in place of the
 * radio, the products of the line ticked on arrival and, with nothing searched
 * or chosen, drawn first under "On this line". The page holds the set and not
 * the cards: a product of the line that the read does not find keeps its place
 * in what is saved. The set is in `ProductPickStore`, for the request's reason.
 *
 * **Save is the page's own write**, one `updateLine` with the whole set, and not
 * an answer the caller writes, because a failed save keeps the page open with the
 * ticks as they were. It sends no `adoptItemIds` (the owner, 2026-10-15): a
 * product of the group left ticked stays the group's. Leaving with a change asks
 * first, from the close, Escape and the back of the browser, which reaches the
 * page through {@link CatalogPage.canLeave} on the route's guard.
 */
@Component({
  selector: 'lib-catalog-page',
  imports: [
    AddingBar,
    CatalogSelectors,
    ChoosingBar,
    ClearsField,
    CloseIcon,
    LeaveQuestion,
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
  host: { '(document:keydown.escape)': 'onEscape($event)' },
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

  /**
   * What the screen that opened the page handed it, for this line and this
   * kind, or null. A request for the other kind on the same line is not this
   * page's to answer.
   */
  protected readonly pickRequest = computed<ProductPickRequest | null>(() => {
    const request = this._pick.request();
    return this.pickKind !== null &&
      request !== null &&
      request.kind === this.pickKind &&
      request.lineId === this._pickLineId
      ? request
      : null;
  });

  /** The product chosen so far in the catalog that chooses. */
  protected readonly pickChosen = this._pick.chosen;

  /** Whether the page chooses the whole set of a line (velista `0146`). */
  protected readonly pickSet = this.pickKind === 'set';

  /**
   * The products of the line, named and priced, and the line itself, which Save
   * writes. Asked for only by the kind that chooses a set: the tab and the kind
   * that chooses one read neither.
   */
  private readonly _itemNames = this.pickSet ? inject(ItemNames) : null;
  private readonly _lines = this.pickSet ? inject(LineStore) : null;

  /**
   * The products of the line the bar compares the set to: what it arrived
   * with, or what it holds after another device changed it while the page was
   * open (the effect in the constructor moves it).
   */
  private readonly _pickBefore = computed<readonly string[]>(() =>
    this.pickRequest() === null ? [] : this._pick.base()
  );

  /**
   * The line as `LineStore` holds it now, the store the line page reads, or
   * null when the store does not hold it. Realtime keeps it current while the
   * page is open.
   */
  private readonly _liveLine = computed(() => {
    const listId = this._route.snapshot?.paramMap?.get('listId') ?? '';
    return (
      this._lines
        ?.linesIn(listId)
        .find((line) => line.id === this._pickLineId) ?? null
    );
  });

  /** The page is gone: a save that settles later neither navigates nor sets. */
  private _destroyed = false;

  /** The set ticked so far. */
  protected readonly ticked = this._pick.ticked;

  /** What the set gained and lost since the page opened. */
  private readonly _pickChange = computed(() =>
    productSetChange(this._pickBefore(), this.ticked())
  );

  protected readonly pickChanged = computed(() =>
    productSetChanged(this._pickChange())
  );

  /** What the live region at the foot says: why a press did nothing. */
  protected readonly pickNote = signal<PickNote | null>(null);

  /** A save of the set is out. */
  protected readonly saving = signal(false);

  /** The last save of the set failed: said with a second try, the ticks kept. */
  protected readonly saveFailed = signal(false);

  /** "Leave without saving?" is up. */
  protected readonly asking = signal(false);
  private _leaving: Promise<boolean> | null = null;
  private _answerLeave: ((leave: boolean) => void) | null = null;

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
    unpricedStart(this.order(), this._listed())
  );

  /**
   * Whether the products of the line are drawn first, under their own heading
   * (velista `0146`, section 3): in the kind `set`, with nothing searched and no
   * supermarket or category chosen. Otherwise a product of the line is drawn only
   * where the read finds it, in the order of the results.
   */
  protected readonly lineFirst = computed(
    () =>
      this.pickSet &&
      this._pickBefore().length > 0 &&
      this.query().trim() === '' &&
      this.chain() === null &&
      this.categorySlug() === null
  );

  /**
   * The products the list draws: all of them, or with the products of the line
   * drawn first, the others. A product is never drawn twice.
   */
  private readonly _listed = computed<readonly CatalogProduct[]>(() => {
    const shown = this._shown();
    if (!this.lineFirst()) {
      return shown;
    }
    const first = new Set(this._pickBefore());
    return shown.filter((product) => !first.has(product.id));
  });

  /**
   * The products of the line as cards, in the order the line holds them. One the
   * lookup has not answered for is a bone. One the catalog no longer holds, or
   * that could not be read, is a card with no price under a name that says so,
   * so it can still be taken off the line.
   */
  protected readonly lineCards = computed<readonly LineCard[]>(() => {
    const names = this._itemNames;
    if (!this.lineFirst() || names === null) {
      return [];
    }
    const locale = this._locale();
    this._translator.loaded();
    const context = this.context();
    const translate = (key: string, args?: Record<string, unknown>) =>
      this._translator.t(key, undefined, locale, args);
    return this._pickBefore().map((itemId) => {
      const item = names.nameOf(itemId);
      if (item !== null) {
        return {
          id: itemId,
          row: this._onLine(
            productRowView(lineProductCard(item), {
              locale,
              chainChosen: false,
              translate,
              chainOf: (scope) => this._chainName(context, scope, locale),
            })
          ),
        };
      }
      if (!names.settled(itemId)) {
        return { id: itemId, row: null };
      }
      const name = translate(
        names.anyFailed([itemId])
          ? 'list.detail.unnamedProduct'
          : 'catalog.pick.gone'
      );
      return {
        id: itemId,
        row: this._onLine({
          id: itemId,
          name,
          detail: null,
          caption: null,
          imageUrl: null,
          price: null,
          unitPrice: null,
          seen: null,
          stale: false,
          chains: null,
          label: name,
          summary: null,
        }),
      };
    });
  });

  /** The two lines of the bar at the foot, and its button. */
  protected readonly pickBar = computed(() => {
    const request = this.pickRequest();
    if (request === null) {
      return null;
    }
    const locale = this._locale();
    this._translator.loaded();
    const translate = (key: string, args?: Record<string, unknown>) =>
      this._translator.t(key, undefined, locale, args);
    if (!this.pickSet) {
      return {
        label: request.forLabel,
        detail: request.forDetail,
        action: translate('basket.change.use'),
        disabled: this.pickChosen() === null,
      };
    }
    // With a change, what it is (section 3), and only the half that is not zero
    // when one of them is.
    const { added, removed } = this._pickChange();
    const counts = [
      ...(added.length > 0
        ? [translate('catalog.pick.added', { count: added.length })]
        : []),
      ...(removed.length > 0
        ? [translate('catalog.pick.removed', { count: removed.length })]
        : []),
    ];
    return {
      label: counts[0] ?? request.forLabel,
      detail: counts.length > 0 ? (counts[1] ?? '') : request.forDetail,
      action: translate('catalog.pick.save'),
      // One button, the same with a change and without (the owner). Only a save
      // already out holds it.
      disabled: this.saving(),
    };
  });

  protected readonly rows = computed<readonly ProductRowView[]>(() => {
    const locale = this._locale();
    // Read so the rows are drawn again once the words arrive.
    this._translator.loaded();
    const context = this.context();
    const chainChosen = this.chain() !== null;

    return this._listed().map((product) =>
      this._onLine(
        productRowView(product, {
          locale,
          chainChosen,
          translate: (key, args) =>
            this._translator.t(key, undefined, locale, args),
          chainOf: (scope) => this._chainName(context, scope, locale),
        })
      )
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

  protected readonly count = computed(() => this._listed().length);

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
      this._destroyed = true;
      params.unsubscribe();
      this._clearDebounce();
    });

    // Another device changed the line while the page is open: the set moves
    // onto what the line holds now, with the person's own ticks and unticks
    // carried over, so the ticks drawn are what Save writes. Not while a save is
    // out: the store's optimistic copy of that write is not news.
    if (this.pickSet) {
      effect(() => {
        const live = this._liveLine()?.itemIds;
        if (
          live === undefined ||
          this.pickRequest() === null ||
          this.saving()
        ) {
          return;
        }
        untracked(() => {
          const base = this._pick.base();
          if (sameIds(base, live)) {
            return;
          }
          this._pick.rebase(live, rebaseProductSet(base, this.ticked(), live));
          void this._itemNames?.ensure(live);
        });
      });
    }

    void this._context.load().then((context) => this.context.set(context));
    // The catalog that chooses adds to nothing, so it reads no list to add to.
    if (this.pickKind === null) {
      void this._adds.ensure();
    } else if (this.pickRequest() === null) {
      // Nothing opened it: a reload, or a link. There is no caller to answer, so
      // the page goes to the list the line is on, or for a set the line page, in
      // place of this entry. The line page opens the set only for a person who
      // may change it, so a reader who reaches the URL lands there as well.
      void this._router.navigateByUrl(this._pickFallback(), {
        replaceUrl: true,
      });
    } else if (this._itemNames !== null) {
      // The names and prices of the products the line arrived with, through the
      // line page's own lookup, which usually holds them already.
      void this._itemNames.ensure(this._pickBefore());
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

  /**
   * The radio of a row in the catalog that chooses one, its tick in the catalog
   * that chooses a set, or null in the tab.
   */
  protected choiceOf(itemId: string): ProductRowChoice | null {
    if (this.pickKind === null) {
      return null;
    }
    return this.pickSet
      ? {
          name: 'catalog-pick',
          checked: this.ticked().includes(itemId),
          multiple: true,
        }
      : { name: 'catalog-pick', checked: this.pickChosen() === itemId };
  }

  /**
   * A press on a card in the catalog that chooses: that product is the choice,
   * or in a set, ticked or taken out. A tick past the cap is refused and said.
   */
  protected choose(itemId: string): void {
    this.pickNote.set(null);
    if (!this.pickSet) {
      this._pick.choose(itemId);
      return;
    }
    if (this.saving()) {
      return;
    }
    const tick = tickProduct(this.ticked(), itemId, this._pickBefore());
    if (tick.kind === 'full') {
      this.pickNote.set({ key: 'catalog.pick.full', args: { ...tick.full } });
      return;
    }
    this._pick.tick(tick.ticked);
  }

  /**
   * The button of the bar. "Use this product": the answer is left for the screen
   * that opened the page, and the page goes back to it past every entry the
   * pickers added. With nothing chosen it says why (velista `0146`, section 2).
   * "Save": the set is written.
   */
  protected usePick(): void {
    const request = this.pickRequest();
    if (request === null) {
      return;
    }
    if (this.pickSet) {
      void this._saveSet(request);
      return;
    }
    if (this.pickChosen() === null) {
      this.pickNote.set({ key: 'catalog.pick.first' });
      return;
    }
    if (this._pick.use()) {
      void this._pages.backTo(request.returnDepth, request.returnUrl);
    }
  }

  /**
   * Close, and Escape: back to the screen that opened the page, with nothing
   * changed. A set with a change asks first (velista `0146`, section 4).
   */
  protected async closePick(): Promise<void> {
    const request = this.pickRequest();
    if (request === null) {
      void this._router.navigateByUrl(this._pickFallback(), {
        replaceUrl: true,
      });
      return;
    }
    if (this.pickSet) {
      // A save that is out decides where the page goes. Leaving now would offer
      // to discard a set that may already be written.
      if (this.saving()) {
        return;
      }
      // Asked before the walk back, never from inside it: the guard then finds
      // the set ended and lets the walk through.
      if (this.pickChanged() && !(await this._ask())) {
        return;
      }
      this._pick.end();
    } else {
      this._pick.cancel();
    }
    void this._pages.backTo(request.returnDepth, request.returnUrl);
  }

  /**
   * Escape on the catalog that chooses, wherever the focus is, unless something
   * on the page takes it first: the field clears itself, and the order menu and
   * the question close themselves.
   */
  protected onEscape(event: Event): void {
    const target = event.target as Element | null;
    if (
      this.pickKind === null ||
      this.asking() ||
      event.defaultPrevented ||
      target?.closest?.(
        'input, textarea, lib-order-menu, .cdk-overlay-container, [aria-modal="true"]'
      ) != null
    ) {
      return;
    }
    void this.closePick();
  }

  /**
   * Whether a navigation may leave the page, asked by the route's guard
   * (velista `0146`, section 4). Its own pickers are under its path and are not a
   * leaving. With a change in the set it asks first, and the navigation waits
   * for the answer.
   */
  canLeave(nextUrl: string): boolean | Promise<boolean> {
    if (!this.pickSet || this.pickRequest() === null) {
      return true;
    }
    // While a save is out nothing leaves, not even to a picker: the save goes
    // back to the line page itself once it lands, and keeps the page on a
    // failure.
    if (this.saving()) {
      return false;
    }
    const own = this._ownPath();
    const path = nextUrl.split(/[?#]/)[0];
    if (path === own || path.startsWith(`${own}/`)) {
      return true;
    }
    if (!this.pickChanged()) {
      this._pick.end();
      return true;
    }
    return this._ask().then((leave) => {
      if (leave) {
        this._pick.end();
      }
      return leave;
    });
  }

  /** "Keep choosing". */
  protected stay(): void {
    this._answered(false);
  }

  /** "Leave". */
  protected leave(): void {
    this._answered(true);
  }

  /** "Leave without saving?", asked once however many ways ask it at once. */
  private _ask(): Promise<boolean> {
    if (this._leaving === null) {
      this.asking.set(true);
      this._leaving = new Promise<boolean>((resolve) => {
        this._answerLeave = resolve;
      });
    }
    return this._leaving;
  }

  private _answered(leave: boolean): void {
    this.asking.set(false);
    const answer = this._answerLeave;
    this._answerLeave = null;
    this._leaving = null;
    answer?.(leave);
  }

  /**
   * Save (velista `0146`, section 3). With no change, back to the line and
   * nothing sent. With one, the whole set in one write, with the favourite
   * cleared in the same write when the set no longer holds it, and no
   * `adoptItemIds`. A failed save keeps the page and the ticks, and says so.
   *
   * The set written is built from the line as the store holds it now: what it
   * holds, less what the person unticked, plus what the person ticked. A
   * product another device added while the page was open is kept, and the
   * favourite is the one the line holds now.
   */
  private async _saveSet(request: ProductPickRequest): Promise<void> {
    const lines = this._lines;
    if (this.saving() || lines === null) {
      return;
    }
    this.pickNote.set(null);
    this.saveFailed.set(false);

    const line = this._liveLine();
    const live = line?.itemIds ?? this._pickBefore();
    const itemIds = rebaseProductSet(this._pickBefore(), this.ticked(), live);
    if (!productSetChanged(productSetChange(live, itemIds))) {
      this._pick.end();
      void this._pages.backTo(request.returnDepth, request.returnUrl);
      return;
    }

    const favorite = line?.favoriteItemId ?? null;
    this.saving.set(true);
    const outcome = await lines.updateLine(request.lineId, {
      itemIds,
      ...(favorite !== null && !itemIds.includes(favorite)
        ? { favoriteItemId: null }
        : {}),
    });
    if (this._destroyed) {
      // Nothing on the page is left to answer. A written set still ends the
      // request, so a later visit does not open on it.
      if (outcome.state !== 'failed') {
        this._pick.end();
      }
      return;
    }
    this.saving.set(false);
    if (outcome.state === 'failed') {
      this.saveFailed.set(true);
      return;
    }
    this._pick.end();
    void this._pages.backTo(request.returnDepth, request.returnUrl);
  }

  /** A card of a product of the line says so to a screen reader, as the mock does. */
  private _onLine(row: ProductRowView): ProductRowView {
    if (!this.pickSet || !this._pickBefore().includes(row.id)) {
      return row;
    }
    return {
      ...row,
      label: this._translator.t(
        'catalog.pick.onLineLabel',
        undefined,
        this._locale(),
        { label: row.label }
      ),
    };
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
   * its line is on, which is the fallback velista `0146` names for the same page,
   * or for the set of a line, the line page (section 4).
   */
  private _pickFallback(): string {
    const params = this._route.snapshot.paramMap;
    const list = [
      'zones',
      params.get('zoneId') ?? '',
      'lists',
      params.get('listId') ?? '',
    ];
    return this.pickSet
      ? appPath(
          this._locale(),
          this._basePath,
          ...list,
          'lines',
          params.get('lineId') ?? ''
        )
      : appPath(this._locale(), this._basePath, ...list);
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
