import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
  CATALOG_SERVICE,
  type CatalogBrowseServiceI,
  type CatalogServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  productPricesSeenAt,
  productShopPrices,
  type CatalogBrowseContext,
  type CatalogItem,
  type ProductShopPrice,
} from '@portfolio/velista/models';
import {
  appPath,
  formatMoney,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { productRowView, SheetShell } from '@portfolio/velista/ui';
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
 * Addressed at `catalog/sheet/products/:itemId`, so back dismisses it and the URL
 * says what is open.
 *
 * ## Where the prices come from
 *
 * The browse read carries one price per row, the cheapest. This sheet reads every
 * source row of the product (`GET /v1/catalog/items/:id/offers`), which covers
 * every scope in the country, and keeps the ones in the person's own scopes, one
 * line per chain at its cheapest scope. The chains near the person with no row
 * are listed last, saying `not sold here`.
 *
 * ## It adds nothing to a list
 *
 * Adding from the catalog has to choose a list, a group and a quantity, and none
 * of that fits under a sheet that answers "what does this cost". The space for it
 * is left and nothing is built.
 */
@Component({
  selector: 'lib-product-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
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
  private readonly _basePath = inject(APP_BASE_PATH);

  /** Read once: a sheet covers the list, so no second product opens under it. */
  protected readonly itemId =
    inject(ActivatedRoute).snapshot.paramMap.get('itemId') ?? '';

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

  /** "two days ago", in the reader's language, or null with no price seen. */
  protected readonly seen = computed(() => {
    const at = productPricesSeenAt(this._prices());
    return at === null ? null : relativeDay(at, this._locale());
  });

  constructor() {
    void this._load();
  }

  async dismiss(): Promise<void> {
    await this._sheet.dismiss(
      appPath(this._locale(), this._basePath, 'catalog')
    );
  }

  private async _load(): Promise<void> {
    const [items, context, rows] = await Promise.all([
      this._catalog.itemsByIds([this.itemId]),
      this._context?.load() ?? this._browse.context(),
      this._browse.scopeOffers(this.itemId),
    ]);

    const item = items?.[0] ?? null;
    if (item === null || context === null || rows === null) {
      this.status.set('failed');
      return;
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
