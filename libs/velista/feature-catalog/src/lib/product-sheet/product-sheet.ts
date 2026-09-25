import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  ActivatedRoute,
  Router,
  type ActivatedRouteSnapshot,
} from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
  CATALOG_SERVICE,
  GroupMembers,
  type CatalogBrowseServiceI,
  type CatalogServiceI,
} from '@portfolio/velista/data-access';
import {
  catalogName,
  productPricesSeenAt,
  productShopPrices,
  type CatalogBrowseContext,
  type CatalogItem,
  type ProductShopPrice,
} from '@portfolio/velista/models';
import {
  formatMoney,
  SheetNavigation,
  sheetSegments,
} from '@portfolio/velista/platform';
import {
  productRowView,
  SheetShell,
  SimilarProducts,
} from '@portfolio/velista/ui';
import { CatalogContext } from '../catalog-context';

/** One line of the sheet, every string already chosen. */
export interface ProductSheetLine {
  readonly supermarketId: string;
  readonly chain: string;
  readonly kind: ProductShopPrice['kind'];
  readonly price: string | null;
  readonly cheapest: boolean;
  readonly stale: boolean;
}

type SheetStatus = 'loading' | 'ready' | 'failed';

/**
 * One product, and what every shop near the person charges for it (velista
 * `0100`, section 5).
 *
 * Addressed at `<the covered page>/sheet/products/:itemId`, so back dismisses it and
 * the URL says what is open. It covers the catalog, and since velista `0107` the zone
 * list and both baskets too, whose composers link a suggestion's Details here. It
 * knows none of them by name: the page it closes onto is read from its own route.
 *
 * ## Where the prices come from
 *
 * The browse read carries one price per row, the cheapest. This sheet reads every
 * source row of the product (`GET /v1/catalog/items/:id/offers`), which covers
 * every scope in the country, and keeps the ones in the person's own scopes, one
 * line per chain at its cheapest scope. The chains near the person with no row
 * are listed last, saying `not sold here`.
 *
 * ## Similar products
 *
 * Under the prices, the other products of its group: the same product under
 * other labels, cheapest first. Pressing one opens it in this sheet, replacing
 * the history entry, so closing still lands on the page underneath.
 *
 * ## It adds nothing to a list
 *
 * Adding from the catalog has to choose a list, a group and a quantity, and none
 * of that fits under a sheet that answers "what does this cost". The space for it
 * is left and nothing is built.
 */
@Component({
  selector: 'lib-product-sheet',
  imports: [RokuTranslatorPipe, SheetShell, SimilarProducts],
  templateUrl: './product-sheet.html',
  styleUrl: './product-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductSheet {
  private readonly _catalog = inject<CatalogServiceI>(CATALOG_SERVICE);
  private readonly _browse = inject<CatalogBrowseServiceI>(
    CATALOG_BROWSE_SERVICE
  );
  private readonly _context = inject(CatalogContext, { optional: true });
  private readonly _sheet = inject(SheetNavigation);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _groupMembers = inject(GroupMembers);
  private readonly _shell = viewChild.required(SheetShell);

  /**
   * The product on show. It follows the route, because a similar product opens
   * in this same sheet and the router reuses the component for it.
   */
  protected readonly itemId = signal(
    this._route.snapshot.paramMap.get('itemId') ?? ''
  );

  protected readonly status = signal<SheetStatus>('loading');
  private readonly _item = signal<CatalogItem | null>(null);
  private readonly _prices = signal<readonly ProductShopPrice[]>([]);
  protected readonly priced = signal(true);

  protected readonly name = computed(() => {
    const item = this._item();
    return item === null ? '' : catalogName(item.name, this._locale());
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
      { ...item, imageUrl: null, offer: null, unitBasis: null },
      {
        locale,
        chainChosen: false,
        chainOf: () => null,
        translate: (key, args) =>
          this._translator.t(key, undefined, locale, args),
      }
    ).detail;
  });

  protected readonly lines = computed<readonly ProductSheetLine[]>(() => {
    const locale = this._locale();
    return this._prices().map((line) => ({
      supermarketId: line.supermarketId,
      chain: catalogName(line.chain, locale),
      kind: line.kind,
      price:
        line.offer !== null && line.offer.price !== null
          ? formatMoney(line.offer.price, line.offer.currency, locale)
          : null,
      cheapest: line.cheapest,
      stale: line.offer?.stale === true,
    }));
  });

  /** The group's members, or null while they load or with no group. */
  protected readonly similar = computed(() => {
    const groupId = this._item()?.productGroupId ?? null;
    if (groupId === null) {
      return null;
    }
    const entry = this._groupMembers.entry(groupId);
    return {
      members: entry?.status === 'ready' ? entry.members : null,
      loading: entry === null || entry.status === 'loading',
      failed: entry?.status === 'failed',
    };
  });

  /** "two days ago", in the reader's language, or null with no price seen. */
  protected readonly seen = computed(() => {
    const at = productPricesSeenAt(this._prices());
    return at === null ? null : relativeDay(at, this._locale());
  });

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
  }

  /**
   * Open a similar product in this sheet, in place of this one.
   *
   * Focus goes to the panel first: the row that was pressed is redrawn with the
   * new product's list, and focus left on it would fall out of the sheet.
   */
  async openSimilar(itemId: string): Promise<void> {
    this._shell().focusPanel();
    const covered = coveredPageUrl(this._route.snapshot);
    const segments = sheetSegments('products', itemId).map(encodeURIComponent);
    await this._router.navigateByUrl(`${covered}/${segments.join('/')}`, {
      replaceUrl: true,
    });
  }

  /**
   * Cancel, the scrim and Escape. The fallback, used on a cold load of the sheet's
   * own URL, is the page it covers, whichever of the four that is.
   */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(coveredPageUrl(this._route.snapshot));
  }

  private async _load(): Promise<void> {
    const itemId = this.itemId();
    this.status.set('loading');
    const [items, context, rows] = await Promise.all([
      this._catalog.itemsByIds([itemId]),
      this._context?.load() ?? this._browse.context(),
      this._browse.scopeOffers(itemId),
    ]);

    // Another product was opened while this one loaded; its own load owns the sheet.
    if (itemId !== this.itemId()) {
      return;
    }

    const item = items?.[0] ?? null;
    if (item === null || context === null || rows === null) {
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

/**
 * The URL of the page a sheet covers: every segment down to its parent route, which
 * is that page, and nothing of the sheet below it.
 *
 * Read from the route rather than built from a path, because this sheet is declared
 * over four pages (velista `0107`) and the only fact they share is that the sheet is
 * their direct child. The locale and the mount are already among the segments, so a
 * standalone build and the portfolio's mount both come out right.
 */
function coveredPageUrl(sheet: ActivatedRouteSnapshot): string {
  const segments = (sheet.parent?.pathFromRoot ?? []).flatMap((route) =>
    route.url.map((segment) => encodeURIComponent(segment.path))
  );
  return `/${segments.join('/')}`;
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
