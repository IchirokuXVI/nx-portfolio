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
  type CatalogBrowseServiceI,
  type CatalogServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  categoryName,
  productPricesSeenAt,
  productShopPrices,
  similarProducts,
  type CatalogBrowseContext,
  type CatalogItem,
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
  PageHeader,
  PriceTable,
  ProductIcon,
  ProductRow,
  ProductRowSkeleton,
  productRowView,
  type PriceTableRow,
  type ProductRowAdd,
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

/**
 * One product, on a page of its own (velista `0134`, section 5).
 *
 * It replaces the product sheet, which had room for a name and a few lines. From
 * top to bottom: the header with the product's name, the product, what each
 * supermarket of the shopping profile charges, and similar products.
 *
 * ## The prices come first, and are on screen when the page opens
 *
 * "What does this cost" is the question a person opened the page with. The read
 * is the sheet's: every source row of the product (`GET
 * /v1/catalog/items/:id/offers`), kept to the person's own scopes, one row for
 * each chain at its cheapest, and the chains near the person with no row say `not
 * sold here`.
 *
 * ## Similar products carry the plus
 *
 * The other products of its group, each with the plus of the catalog's rows. The
 * heading says which list the plus adds to and opens the same sheet of lists as
 * the catalog: the choice is one value for both pages, and what is added here
 * joins the record of the visit. A press on a row opens that product's page.
 *
 * ## Back never leaves the app
 *
 * The back control pops when this document pushed the entry behind it, which is
 * the catalog, a list or a basket that linked here. On a cold load the fallback
 * is the catalog.
 *
 * ## What waits for the backend (stage 2)
 *
 * The price history and the table of lists (sections 6 and 7) need reads the
 * gateway does not serve yet (section 9). Nothing is drawn for them.
 */
@Component({
  selector: 'lib-product-page',
  imports: [
    AddingBar,
    ChevronRightIcon,
    PageHeader,
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
  private readonly _pages = inject(PageNavigation);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
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

  /** The similar product whose stepper is open. One is open at a time. */
  protected readonly stepperOpen = signal<string | null>(null);

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
    rowAdds(this.addTarget(), this._adds.visit(), this.stepperOpen())
  );

  constructor() {
    const params = this._route.paramMap.subscribe((map) => {
      const itemId = map.get('itemId') ?? '';
      if (itemId !== this.itemId()) {
        this.itemId.set(itemId);
        this.stepperOpen.set(null);
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

  protected openStepper(itemId: string): void {
    this.stepperOpen.set(itemId);
  }

  protected stepProduct(itemId: string, by: 1 | -1): void {
    const target = this.addTarget();
    if (target === null) {
      return;
    }
    this.addFailed.set(false);
    void this._adds.step(target.listId, itemId, by);
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
    this.priced.set(hasScopes(context));
    this._prices.set(
      hasScopes(context) ? productShopPrices(rows, context) : []
    );
    this.status.set('ready');
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
