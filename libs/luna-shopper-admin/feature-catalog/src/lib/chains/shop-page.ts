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
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
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
  type ReferenceScope,
  type ResourceRow,
  type ScopeLevel,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  InfoButton,
  PageHeader,
  PageTabs,
  ReferencesControl,
  ScopeMark,
  Viewport,
  type PageTab,
} from '@portfolio/luna-shopper-admin/ui';
import { priceScopeMark } from '../catalog-enums';
import { isOwnStoreScope, SHOP_PICKABLE_SCOPE_KINDS } from '../locations';
import { ChainContext } from './chain-context';
import { DETAILS_TAB } from './chain-page';
import { ShopContext } from './shop-context';

/** The route parameter that holds the shop. */
export const SHOP_PARAM = 'shopId';

/** The segment of a shop's Sections tab. */
export const SHOP_SECTIONS_TAB = 'sections';

/** What the info button of "Priced by" says (admin plan 0042, target 10). */
export const PRICED_BY_INFO: InfoContent = {
  title: 'catalog.shops.pricedBy.info.title',
  points: [
    'catalog.shops.pricedBy.info.mostSpecific',
    'catalog.shops.pricedBy.info.reach',
  ],
};

/** One scope of the "Priced by" line. */
export interface PricedByScope {
  readonly id: string;
  /** What the scope is called, or a key when it is the shop's own. */
  readonly name: string;
  readonly nameKey: string | null;
  /** How far it reaches, 1 the widest. `null` for a kind this app does not know. */
  readonly level: ScopeLevel | null;
  /** A translation key for the kind, said by the mark. */
  readonly kindKey: string;
  /** Most general first. */
  readonly priority: number;
}

/**
 * One shop, as a page inside its chain (admin plan 0042, target 5).
 *
 * Above its tabs is the one line that explains every price the shop shows:
 * the scopes that price it, most general first, each with the mark that says
 * how far it reaches. Then the tabs: its details, the order it walks its
 * sections in, and its products.
 *
 * On a wide screen it sits beside its chain's list of shops, under the chain's
 * header, and its name titles a pane. On a narrow one it is the page, and it
 * draws the way back to the chain.
 *
 * **What is under the tabs is drawn again when the shop changes**, for the
 * reason the chain's page gives: pressing another shop in the column changes
 * one route parameter, and a form that read the old shop would keep it.
 */
@Component({
  selector: 'lib-shop-page',
  imports: [
    PageHeader,
    PageTabs,
    RouterOutlet,
    RouterLink,
    ConfirmDialog,
    InfoButton,
    ScopeMark,
    ReferencesControl,
    RokuTranslatorPipe,
  ],
  providers: [ShopContext],
  template: `
    <lib-page-header
      [backLabel]="
        split() ? null : ('catalog.shops.back' | rokuT: { chain: chainName() })
      "
      [backLink]="shopsPath()"
      [frameTabs]="false"
      [heading]="title() || ('resource.form.loading' | rokuT)"
      [subtitle]="subtitle()"
    >
      <a [routerLink]="detailsPath()" class="button" pageMoreAction>{{
        'catalog.shops.edit' | rokuT
      }}</a>
      <button
        (click)="deleting.set(true)"
        class="button danger"
        pageMoreAction
        type="button"
      >
        {{ 'catalog.shops.delete' | rokuT }}
      </button>
    </lib-page-header>

    @if (shop.status() === 'error') {
      <p class="state error" role="alert">
        {{ shop.errorKey() ?? 'resource.error.unknown' | rokuT }}
      </p>
    } @else {
      @if (refusalKey(); as key) {
        <p class="refusal" role="alert">{{ key | rokuT }}</p>
      }

      <section aria-labelledby="priced-by-heading" class="priced">
        <div class="priced-line">
          <h3 id="priced-by-heading">
            {{ 'catalog.shops.pricedBy.heading' | rokuT }}
          </h3>
          <ul class="scopes">
            @for (scope of scopes(); track scope.id) {
              <li class="chip">
                @if (scope.level; as level) {
                  <lib-scope-mark
                    [label]="scope.kindKey | rokuT"
                    [level]="level"
                  />
                }
                <span>{{
                  scope.nameKey ? (scope.nameKey | rokuT) : scope.name
                }}</span>
              </li>
            }
          </ul>
          <span class="grow"></span>
          <lib-info-button [info]="pricedInfo" />
          @if (!changing()) {
            <button
              (click)="startChange()"
              [disabled]="shop.shop() === null"
              class="button small"
              type="button"
              data-change-scopes
            >
              {{ 'catalog.shops.pricedBy.change' | rokuT }}
            </button>
          }
        </div>

        @if (changing()) {
          <div class="change">
            <lib-references-control
              (valueChange)="draft.set($event)"
              [disabled]="saving()"
              [locks]="locks"
              [lookup]="references"
              [scope]="pickerScope()"
              [value]="draft()"
              controlId="shop-price-scopes"
              resource="price-scopes"
            />
            @if (changeErrorKey(); as key) {
              <p class="refusal" role="alert">{{ key | rokuT }}</p>
            }
            <div class="change-actions">
              <button
                (click)="cancelChange()"
                [disabled]="saving()"
                class="button"
                type="button"
              >
                {{ 'resource.action.cancel' | rokuT }}
              </button>
              <button
                (click)="saveChange()"
                [disabled]="saving()"
                class="button primary"
                type="button"
                data-save-scopes
              >
                {{
                  (saving() ? 'resource.action.saving' : 'resource.action.save')
                    | rokuT
                }}
              </button>
            </div>
          </div>
        }
      </section>

      <lib-page-tabs [label]="title()" [tabs]="tabs()" />

      @for (key of keys(); track key) {
        <div class="shop-body"><router-outlet /></div>
      }
    }

    @if (deleting()) {
      <lib-confirm-dialog
        (confirm)="confirmDelete()"
        (dismiss)="deleting.set(false)"
        [bodyArgs]="{ name: title() }"
        [busy]="removing()"
        bodyKey="catalog.shops.deleteBody"
        confirmKey="catalog.shops.deleteConfirm"
        headingKey="catalog.shops.deleteHeading"
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

    .shop-body {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
      padding-block-start: var(--admin-page-block);
    }

    /* A band under the header, edge to edge, as the tabs under it are. */
    .priced {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      margin-inline: calc(-1 * var(--admin-page-inline));
      padding: var(--admin-space-2) var(--admin-page-inline);
      border-block-end: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
    }

    .priced-line {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: center;
    }

    h3 {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    .scopes {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      list-style: none;
    }

    /* On a phone the heading and its two controls are one row, and the scopes
       take the row under it, where three of them fit. */
    @media (max-width: 47.99rem) {
      .scopes {
        order: 1;
        flex-basis: 100%;
      }
    }

    .chip {
      display: inline-flex;
      gap: 0.375rem;
      align-items: center;
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      color: var(--admin-neutral-on-wash);
    }

    .grow {
      flex: 1;
    }

    .change {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      max-inline-size: 36rem;
      padding-block-end: var(--admin-space-2);
    }

    .change-actions {
      display: flex;
      gap: var(--admin-space-2);
      justify-content: flex-end;
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

    .button.small {
      padding-inline: var(--admin-space-3);
      font-size: 0.8125rem;
    }

    .button.primary {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    .button.danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger);
    }

    .button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .state,
    .refusal {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .state {
      margin-block-start: var(--admin-page-block);
    }

    :host > .refusal {
      margin-block: var(--admin-space-3);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _changes = inject(ResourceChanges);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _viewport = inject(Viewport);
  private readonly _chain = inject(ChainContext, { optional: true });

  readonly shop = inject(ShopContext);
  readonly references = inject(ResourceReferences);

  readonly pricedInfo = PRICED_BY_INFO;
  readonly split = this._viewport.split;

  readonly keys = computed(() => {
    const id = this.shop.id();
    return id === null ? [] : [id];
  });

  /** The address, which is what tells two shops of a chain apart. */
  readonly title = computed(() => {
    const row = this.shop.shop();
    if (row === null) {
      return '';
    }
    return (
      localizedTextValue(row.label, this._content.order()) ||
      row.address ||
      row.city ||
      row.id
    );
  });

  readonly chainName = computed(() => {
    const row = this._chain?.chain() ?? null;
    return row === null
      ? ''
      : localizedTextValue(row.name, this._content.order());
  });

  /** "Mercadona, Sevilla 41004": the chain, then where the shop is. */
  readonly subtitle = computed(() => {
    const row = this.shop.shop();
    if (row === null) {
      return null;
    }
    const place = [row.city, row.postalCode]
      .filter((part) => part !== null && part !== '')
      .join(' ');
    const parts = [this.chainName(), place].filter((part) => part !== '');
    return parts.length === 0 ? null : parts.join(', ');
  });

  /** The chain's Shops tab, for the way back on a narrow screen. */
  readonly shopsPath = computed(
    () => this._registry.pathOf('locations', this._known()) ?? ['/']
  );

  readonly detailsPath = computed(() => [...this._path(), DETAILS_TAB]);

  /**
   * The three tabs. Sections shows how many the shop walks, which the shop's
   * own read carries. Products shows no number: the list is paged and has no
   * total.
   */
  readonly tabs = computed<readonly PageTab[]>(() => {
    const path = this._path();
    const shop = this.shop;

    return [
      { path: this.detailsPath(), label: 'catalog.shops.tabs.details' },
      {
        path: [...path, SHOP_SECTIONS_TAB],
        label: 'catalog.shops.tabs.sections',
        count: () => shop.shop()?.sections.length ?? null,
      },
      {
        path:
          this._registry.pathOf('location-items', {
            ...this._known(),
            supermarketLocationId: shop.id(),
          }) ?? path,
        label: 'catalog.shops.tabs.products',
      },
    ];
  });

  /**
   * The chain's general scopes, by id, read once per shop.
   *
   * One request names every scope a shop can hold but its own: a chain has a
   * handful of nationwide, region and local area scopes. A scope the shop
   * holds that is not among them is its own single shop scope, which is the
   * only other kind a shop may hold (backend plan 0116).
   */
  private readonly _general = signal<ReadonlyMap<string, ResourceRow> | null>(
    null
  );

  /** The scopes that price the shop, most general first. */
  readonly scopes = computed<readonly PricedByScope[]>(() => {
    const row = this.shop.shop();
    const general = this._general();
    if (row === null || general === null) {
      return [];
    }

    const locales = this._content.order();
    return row.priceScopeIds
      .map((id): PricedByScope => {
        const scope = general.get(id);
        if (scope === undefined) {
          const mark = priceScopeMark('STORE');
          return {
            id,
            name: '',
            nameKey: 'catalog.shops.pricedBy.own',
            level: mark?.level ?? null,
            kindKey: mark?.label ?? '',
            priority: 0,
          };
        }

        const mark = priceScopeMark(scope['kind']);
        const label = localizedTextValue(
          scope['label'] as Parameters<typeof localizedTextValue>[0],
          locales
        );
        const key = scope['externalKey'];
        return {
          id,
          name: label !== '' ? label : typeof key === 'string' ? key : '',
          // A harvested scope has no label, and a nationwide one no key
          // either. Its kind is then its name.
          nameKey:
            label === '' && typeof key !== 'string'
              ? (mark?.label ?? null)
              : null,
          level: mark?.level ?? null,
          kindKey: mark?.label ?? '',
          priority:
            typeof scope['priority'] === 'number' ? scope['priority'] : 1,
        };
      })
      .sort((a, b) => b.priority - a.priority);
  });

  /** Whether the scopes are being changed. */
  readonly changing = signal(false);
  /** The scopes as the editor holds them. Nothing is sent until Save. */
  readonly draft = signal<readonly string[]>([]);
  readonly saving = signal(false);
  readonly changeErrorKey = signal<string | null>(null);

  readonly deleting = signal(false);
  readonly removing = signal(false);
  readonly refusalKey = signal<string | null>(null);

  /** The shop's chain, and every kind but a single shop's. */
  readonly pickerScope = computed<ReferenceScope | null>(() => {
    const chain = this.shop.shop()?.supermarketId;
    return typeof chain === 'string' && chain !== ''
      ? { supermarketId: chain, kind: SHOP_PICKABLE_SCOPE_KINDS }
      : null;
  });

  /** The shop's own scope stays: catalog keeps it whatever is sent. */
  readonly locks = (target: ResourceRow): boolean =>
    isOwnStoreScope(this.shop.shop() ?? {}, target);

  constructor() {
    const params = this._route.paramMap.subscribe((map) => {
      const id = map.get(SHOP_PARAM);
      if (id !== null && id !== this.shop.id()) {
        this.changing.set(false);
        this.refusalKey.set(null);
        void this.shop.open(id);
      }
    });
    inject(DestroyRef).onDestroy(() => params.unsubscribe());

    // The Sections tab saved an order, and the shop's own row names its
    // sections: read it again, so the count on the tab is the one saved.
    let sections = this._changes.version('location-sections');
    effect(() => {
      const version = this._changes.version('location-sections');
      untracked(() => {
        if (version !== sections) {
          sections = version;
          void this.shop.reload();
        }
      });
    });

    // The chain's general scopes, once the shop says which chain it is in.
    effect(() => {
      const chain = this.shop.shop()?.supermarketId ?? null;
      untracked(() => void this._readGeneral(chain));
    });
  }

  startChange(): void {
    const row = this.shop.shop();
    if (row === null) {
      return;
    }
    this.changeErrorKey.set(null);
    this.draft.set(row.priceScopeIds);
    this.changing.set(true);
  }

  cancelChange(): void {
    this.changing.set(false);
    this.changeErrorKey.set(null);
  }

  async saveChange(): Promise<void> {
    this.saving.set(true);
    this.changeErrorKey.set(null);
    try {
      await this.shop.setPriceScopes(this.draft());
      this.changing.set(false);
    } catch (error) {
      // The draft stays, so a refusal costs a retry and not the picks.
      this.changeErrorKey.set(
        gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
      );
    } finally {
      this.saving.set(false);
    }
  }

  async confirmDelete(): Promise<void> {
    this.removing.set(true);
    this.refusalKey.set(null);
    try {
      await this.shop.remove();
      this.deleting.set(false);
      await this._router.navigate([...this.shopsPath()]);
    } catch (error) {
      this.deleting.set(false);
      this.refusalKey.set(
        gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
      );
    } finally {
      this.removing.set(false);
    }
  }

  private _generation = 0;

  private async _readGeneral(chain: string | null): Promise<void> {
    this._generation += 1;
    const generation = this._generation;
    const descriptor = this._registry.byName('price-scopes');

    if (chain === null || descriptor === undefined) {
      this._general.set(null);
      return;
    }

    try {
      const page = await this._registry.gatewayFor(descriptor).list({
        limit: 100,
        filters: { supermarketId: chain, kind: SHOP_PICKABLE_SCOPE_KINDS },
      });
      if (generation === this._generation) {
        // More than one page of them, and a scope this did not read could be
        // taken for the shop's own. No names is the honest answer then.
        this._general.set(
          page.nextCursor === null
            ? new Map(page.items.map((row) => [String(row['id']), row]))
            : null
        );
      }
    } catch {
      // The line then names no scope. The Details tab still lists them.
      if (generation === this._generation) {
        this._general.set(null);
      }
    }
  }

  /** The chain this shop is under, as the registry wants it. */
  private _known(): Record<string, string> {
    const chain =
      this._chain?.id() ?? this.shop.shop()?.supermarketId ?? undefined;
    return chain === undefined ? {} : { supermarketId: chain };
  }

  private _path(): readonly string[] {
    const id = this.shop.id();
    return id === null
      ? this.shopsPath()
      : (this._registry.rowPath('locations', id, this._known()) ??
          this.shopsPath());
  }
}
