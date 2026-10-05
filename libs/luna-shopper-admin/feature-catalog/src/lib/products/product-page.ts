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
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceChanges,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  localizedTextValue,
  type InfoContent,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  PageHeader,
  Viewport,
  type PageTab,
} from '@portfolio/luna-shopper-admin/ui';
import { ProductContext } from './product-context';
import { formatSize } from './product-format';

/** The route parameter that holds the product. */
export const PRODUCT_PARAM = 'productId';

/** The segment of a product's Details tab: the form of the product itself. */
export const PRODUCT_DETAILS_TAB = 'details';

/** The segment of the "Where it is" tab: the product in each chain's shops. */
export const PRODUCT_WHERE_TAB = 'where';

/** The segment of the Sources tab: the chain rows that name the product. */
export const PRODUCT_SOURCES_TAB = 'sources';

/**
 * The query parameter that names the scope the Prices tab opens with (admin
 * plan 0043, target 7): the address of one product at one scope.
 */
export const PRODUCT_SCOPE_QUERY = 'scope';

/** What the info button says on the Prices tab (admin plan 0043, target 9). */
export const PRODUCT_PRICES_INFO: InfoContent = {
  title: 'catalog.productPrices.info.title',
  points: [
    'catalog.productPrices.info.row',
    'catalog.productPrices.info.open',
    'catalog.productPrices.info.held',
  ],
};

/**
 * One product, as a page (admin plan 0043, target 3).
 *
 * The header names the product. Under it are four tabs: its details, its
 * prices by chain and scope, where it is in each chain's shops, and the chain
 * rows that name it. Each tab is a child route, so each has an address and the
 * browser's back button walks them. On a wide screen a summary of the product
 * stays beside every tab.
 *
 * It replaced a form with two panels under it and two more screens reached by
 * links: the product at every scope, and one price with its history.
 *
 * **What is under the tabs is drawn again when the product changes.** A link
 * from one product to another changes only a route parameter, and the router
 * keeps every component it can. So the body is keyed on the product.
 */
@Component({
  selector: 'lib-product-page',
  imports: [
    PageHeader,
    RouterOutlet,
    RouterLink,
    ConfirmDialog,
    RokuTranslatorPipe,
  ],
  providers: [ProductContext],
  template: `
    <lib-page-header
      [backLabel]="'catalog.products.back' | rokuT"
      [backLink]="listPath"
      [heading]="name() || ('resource.form.loading' | rokuT)"
      [info]="info()"
      [subtitle]="subtitle()"
      [tabs]="tabs()"
      [tabsLabel]="name()"
    >
      <a [routerLink]="detailsPath()" class="button" pageMoreAction>{{
        'catalog.products.edit' | rokuT
      }}</a>
      <button
        (click)="deleting.set(true)"
        class="button danger"
        pageMoreAction
        type="button"
      >
        {{ 'catalog.products.delete' | rokuT }}
      </button>
    </lib-page-header>

    @if (refusalKey(); as key) {
      <p class="refusal" role="alert">
        {{ key | rokuT: { name: name() } }}
        <button (click)="refusalKey.set(null)" type="button">
          {{ 'resource.action.dismiss' | rokuT }}
        </button>
      </p>
    }

    @if (product.status() === 'error') {
      <p class="state error" role="alert">
        {{ product.errorKey() ?? 'resource.error.unknown' | rokuT }}
      </p>
    } @else {
      <div [class.split]="split()" class="body">
        @for (key of keys(); track key) {
          <div class="tab"><router-outlet /></div>
        }

        @if (split()) {
          <aside [attr.aria-label]="'catalog.products.summary' | rokuT">
            <h2>{{ 'catalog.products.summary' | rokuT }}</h2>
            @if (summary(); as view) {
              <dl>
                <div>
                  <dt>{{ 'catalog.items.brand' | rokuT }}</dt>
                  <dd>
                    @if (view.brand === '') {
                      <span class="muted">{{
                        'resource.value.none' | rokuT
                      }}</span>
                    } @else if (brandsPath; as path) {
                      <a
                        [queryParams]="{ query: view.brand }"
                        [routerLink]="path"
                        >{{ view.brand }}</a
                      >
                    } @else {
                      {{ view.brand }}
                    }
                  </dd>
                </div>
                <div>
                  <dt>{{ 'catalog.items.unitSize' | rokuT }}</dt>
                  <dd>
                    @if (view.size === '') {
                      <span class="muted">{{
                        'resource.value.none' | rokuT
                      }}</span>
                    } @else {
                      {{ view.size }}
                    }
                  </dd>
                </div>
                <div>
                  <dt>{{ 'catalog.items.ean' | rokuT }}</dt>
                  <dd>
                    @if (view.barcode === '') {
                      <span class="muted">{{
                        'resource.value.none' | rokuT
                      }}</span>
                    } @else {
                      <span class="mono">{{ view.barcode }}</span>
                    }
                  </dd>
                </div>
                <div>
                  <dt>{{ 'catalog.items.group' | rokuT }}</dt>
                  <dd>
                    @if (view.groupPath; as path) {
                      <a [routerLink]="path">{{ groupName() }}</a>
                    } @else {
                      <span class="muted">{{
                        'catalog.products.noGroup' | rokuT
                      }}</span>
                    }
                  </dd>
                </div>
                <div>
                  <dt>{{ 'catalog.items.categoryIds' | rokuT }}</dt>
                  <dd class="chips">
                    @for (category of view.categories; track category) {
                      <span class="chip">{{ category }}</span>
                    } @empty {
                      <span class="muted">{{
                        'catalog.categoryTree.none' | rokuT
                      }}</span>
                    }
                  </dd>
                </div>
              </dl>
            } @else {
              <p class="muted" role="status">
                {{ 'resource.form.loading' | rokuT }}
              </p>
            }
          </aside>
        }
      </div>
    }

    @if (deleting()) {
      <lib-confirm-dialog
        (confirm)="confirmDelete()"
        (dismiss)="deleting.set(false)"
        [bodyArgs]="{ name: name() }"
        [busy]="removing()"
        bodyKey="catalog.products.deleteBody"
        confirmKey="catalog.products.deleteConfirm"
        headingKey="catalog.products.deleteHeading"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
    }

    .body {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
      padding-block-start: var(--admin-page-block);
    }

    /* The summary is the 300 px of the mock, and stays beside every tab. */
    .body.split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 18.75rem;
      gap: var(--admin-space-4);
      align-items: start;
    }

    .tab {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
    }

    aside {
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    h2 {
      padding-block-end: var(--admin-space-2);
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    dl > div {
      display: flex;
      gap: var(--admin-space-3);
      padding-block: 0.3125rem;
      font-size: 0.875rem;
    }

    dt {
      flex: none;
      inline-size: 5.375rem;
      color: var(--admin-ink-muted);
    }

    dd {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    dd a {
      color: var(--admin-accent);
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-1) var(--admin-space-2);
    }

    .chip {
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--admin-neutral-on-wash);
    }

    .mono {
      font-family: var(--admin-font-mono);
      font-size: 0.8125rem;
    }

    .muted {
      color: var(--admin-ink-muted);
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .button.danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger);
    }

    .button:focus-visible,
    .refusal > button:focus-visible,
    a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .state {
      margin-block-start: var(--admin-page-block);
      padding: var(--admin-space-6);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    .refusal {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-3);
      align-items: center;
      margin-block-start: var(--admin-space-3);
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .refusal > button {
      margin-inline-start: auto;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _references = inject(ResourceReferences);
  private readonly _changes = inject(ResourceChanges);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _viewport = inject(Viewport);

  readonly product = inject(ProductContext);

  readonly split = this._viewport.split;

  /** Where the product list is, for the way back. */
  readonly listPath = this._registry.pathOf('items') ?? ['/'];

  /** Where the registered brands are, for the link on a product's brand. */
  readonly brandsPath = this._registry.pathOf('brands');

  /** The product as a one entry list, so that the template can key on it. */
  readonly keys = computed(() => {
    const id = this.product.id();
    return id === null ? [] : [id];
  });

  readonly name = computed(() => {
    const row = this.product.product();
    return row === null
      ? ''
      : localizedTextValue(row.name, this._content.order()) || row.id;
  });

  /** The brand and the size, which is what tells two products apart. */
  readonly subtitle = computed(() => {
    const row = this.product.product();
    if (row === null) {
      return null;
    }
    const parts = [
      row.brand ?? '',
      formatSize(row, this._translate.locale()),
    ].filter((part) => part !== '');
    return parts.length === 0 ? null : parts.join(', ');
  });

  /** The tab the address is on: the first segment under the product. */
  private readonly _tab = signal(this._tabNow());

  /** The info button of the header, which only the Prices tab has. */
  readonly info = computed<InfoContent | null>(() =>
    this._tab() === this._registry.byName('prices')?.segment
      ? PRODUCT_PRICES_INFO
      : null
  );

  readonly deleting = signal(false);
  readonly removing = signal(false);
  /** A delete the gateway refused, said under the header. */
  readonly refusalKey = signal<string | null>(null);

  readonly detailsPath = computed(() => [...this._path(), PRODUCT_DETAILS_TAB]);

  /**
   * The four tabs. Prices and Sources show a count, and each shows it only
   * when the gateway gave one.
   */
  readonly tabs = computed<readonly PageTab[]>(() => {
    const context = this.product;
    const path = this._path();

    return [
      { path: this.detailsPath(), label: 'catalog.products.tabs.details' },
      {
        // Where the registry says a product's prices are, so the tab cannot
        // point at an address the route table does not have.
        path: this._registry.pathOf('prices', { itemId: context.id() }) ?? path,
        label: 'catalog.products.tabs.prices',
        count: () => context.scopeCount(),
      },
      {
        path: [...path, PRODUCT_WHERE_TAB],
        label: 'catalog.products.tabs.where',
      },
      {
        path: [...path, PRODUCT_SOURCES_TAB],
        label: 'catalog.products.tabs.sources',
        count: () => context.sourceCount(),
      },
    ];
  });

  /** The group's name, once it is read. The id until then. */
  private readonly _groupName = signal<{ id: string; name: string } | null>(
    null
  );
  readonly groupName = computed(() => {
    const id = this.product.product()?.productGroupId ?? null;
    const named = this._groupName();
    return id === null ? '' : named?.id === id ? named.name : id;
  });

  /** What the summary beside the tabs says, or `null` until the product is read. */
  readonly summary = computed(() => {
    const row = this.product.product();
    if (row === null) {
      return null;
    }
    const order = this._content.order();
    const groupId = row.productGroupId ?? null;

    return {
      brand: row.brand ?? '',
      size: formatSize(row, this._translate.locale()),
      barcode: row.ean ?? '',
      groupPath:
        groupId === null
          ? null
          : this._registry.rowPath('product-groups', groupId),
      categories: (row.categories ?? []).map(
        (category) => localizedTextValue(category.name, order) || category.id
      ),
    };
  });

  constructor() {
    const destroy = inject(DestroyRef);

    const params = this._route.paramMap.subscribe((map) => {
      const id = map.get(PRODUCT_PARAM);
      if (id !== null && id !== this.product.id()) {
        this.refusalKey.set(null);
        void this.product.open(id);
      }
    });
    const events = this._router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this._tab.set(this._tabNow());
      }
    });
    destroy.onDestroy(() => {
      params.unsubscribe();
      events.unsubscribe();
    });

    // The product was saved on the Details tab: the header and the summary
    // read it again.
    let seen = this._changes.version('items');
    effect(() => {
      const version = this._changes.version('items');
      untracked(() => {
        if (version !== seen) {
          seen = version;
          void this.product.reload();
        }
      });
    });

    // A price was added: the scopes and their count are read again. The tab
    // that removes a price reads them itself and says so here as well.
    let prices = this._changes.version('prices');
    effect(() => {
      const version = this._changes.version('prices');
      untracked(() => {
        if (version !== prices) {
          prices = version;
          void this.product.reloadPrices();
        }
      });
    });

    // The group is named by a lookup, since the product carries its id alone.
    effect(() => {
      const id = this.product.product()?.productGroupId ?? null;
      // In the language the operator reads the catalog in.
      this._content.locale();
      untracked(() => void this._nameGroup(id));
    });
  }

  async confirmDelete(): Promise<void> {
    this.removing.set(true);
    this.refusalKey.set(null);
    try {
      await this.product.remove();
      this.deleting.set(false);
      await this._router.navigate([...this.listPath]);
    } catch (error) {
      this.deleting.set(false);
      this.refusalKey.set(
        gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
      );
    } finally {
      this.removing.set(false);
    }
  }

  private async _nameGroup(id: string | null): Promise<void> {
    if (id === null) {
      return;
    }
    const option = await this._references.resolve('product-groups', id);
    if (option !== null) {
      this._groupName.set({ id, name: option.title });
    }
  }

  /** The product's own address, through the registry and never typed. */
  private _path(): readonly string[] {
    const id = this.product.id();
    return id === null
      ? this.listPath
      : (this._registry.rowPath('items', id) ?? this.listPath);
  }

  private _tabNow(): string | null {
    return this._route.snapshot.firstChild?.url[0]?.path ?? null;
  }
}
