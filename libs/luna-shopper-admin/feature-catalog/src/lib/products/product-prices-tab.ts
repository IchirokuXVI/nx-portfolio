import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
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
  RESOURCE_GATEWAYS,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceChanges,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  harvestRunPath,
  localizedTextValue,
  type ScopeLevel,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  PopoverSheet,
  ScopeMark,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { ChevronLeftIcon } from '@portfolio/shared/ui';
import {
  PRICE_SCOPE_KIND_OPTIONS,
  PRICE_SOURCE_KIND_OPTIONS,
} from '../catalog-enums';
import type { ItemScopePrices } from '../catalog-seed';
import { itemPriceSource, pricePolicySource } from '../catalog-sources';
import { holdsOwnPrice, ProductContext } from './product-context';
import {
  formatDay,
  formatPrice,
  formatSeen,
  formatUnitPrice,
} from './product-format';
import { PRODUCT_SCOPE_QUERY } from './product-page';
import { ScopeChoices, scopeLevel, scopeName } from './scope-choices';

/** The reasons the gateway gives for the shown price, each with a sentence. */
const SHOWN_BECAUSE = [
  'PROTECTED_ADMIN',
  'POLICY_PRIORITY',
  'ONLY_ROW',
  'NEWEST',
] as const;

/** Why a price is the one shown, as this app reads it. */
export type ShownBecause = (typeof SHOWN_BECAUSE)[number] | 'UNKNOWN';

/**
 * The reason off the wire, and `UNKNOWN` for one this build does not know.
 * `UNKNOWN` says the server gave a reason this screen cannot put in words,
 * which is truer than borrowing one of the four.
 */
export function toShownBecause(value: unknown): ShownBecause | null {
  if (value === null || value === undefined) {
    return null;
  }
  return (SHOWN_BECAUSE as readonly unknown[]).includes(value)
    ? (value as ShownBecause)
    : 'UNKNOWN';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** What one price behind a scope is, beside its numbers. */
export type PriceRowState =
  /** The price a shopper sees. */
  | 'shown'
  /** Its window closed: it held until a date that has passed. */
  | 'ended'
  /** Older than the limit of its rule. */
  | 'tooOld'
  | null;

/**
 * The state of one price behind a scope.
 *
 * Which one is shown is the gateway's answer and is only compared here. The
 * other two describe a row and choose nothing: a window that has closed, and
 * an age past the limit the price rule of that source states.
 */
export function priceRowState(
  row: Pick<
    Wire.CatalogItemPriceView,
    'id' | 'sourceKind' | 'validUntil' | 'lastObservedAt'
  >,
  shownId: string | null,
  maxAgeDays: ReadonlyMap<string, number | null>,
  now: number
): PriceRowState {
  if (row.id === shownId) {
    return 'shown';
  }
  const until =
    row.validUntil === null ? NaN : new Date(row.validUntil).getTime();
  if (!Number.isNaN(until) && until < now) {
    return 'ended';
  }
  const limit = maxAgeDays.get(row.sourceKind) ?? null;
  const seen = new Date(row.lastObservedAt).getTime();
  return limit !== null && !Number.isNaN(seen) && now - seen > limit * DAY_MS
    ? 'tooOld'
    : null;
}

/** One price behind a scope, formatted. */
export interface PriceRowView {
  readonly id: string;
  /** The source, already translated. */
  readonly source: string;
  /** Whether a run wrote it, and when it was first seen, as a day. */
  readonly run: string;
  /**
   * Where that run is, or `null` when no run wrote the price. `sourceRunId`
   * is the harvest run's own id: the harvester stamps it on every price it
   * writes, and the undo of a run deletes by it.
   */
  readonly runPath: readonly string[] | null;
  /** "Seen" a day, or "Until" a day for a window that closed. */
  readonly whenKey: string;
  readonly when: string;
  readonly price: string;
  readonly state: PriceRowState;
  /** What a typed price recorded it was overriding, one sentence per source. */
  readonly overriding: readonly string[];
  /**
   * Whether the price was written at a wider scope and reaches this one. It
   * is removed at the scope it was written at, so it has no Remove here.
   */
  readonly inherited: boolean;
}

/** One scope of a chain, as a row of its panel. */
export interface ScopeRowView {
  readonly id: string;
  readonly name: string;
  /** The kind, already translated. */
  readonly kind: string;
  readonly level: ScopeLevel | null;
  /** The key its source gave it, or `''`. */
  readonly key: string;
  /** Whether a price is shown at the scope. */
  readonly priced: boolean;
  /** The source of the shown price, already translated. */
  readonly source: string;
  readonly seen: string;
  readonly unitPrice: string;
  readonly price: string;
  readonly stale: boolean;
  /** The day a typed price is held until, or `''` when none is held. */
  readonly heldUntil: string;
  readonly because: ShownBecause | null;
  readonly rows: readonly PriceRowView[];
  /**
   * How many narrower scopes of the chain hold no price of their own and show
   * this scope's. `null` while there are more scopes to read: the number
   * would be too small.
   */
  readonly followers: number | null;
}

/** One chain and the scopes of it that hold a price for the product. */
export interface ChainPanelView {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly ScopeRowView[];
  /**
   * The scope a price is added at when the chain holds none for the product:
   * the one its shops fall back to. `null` for a chain with no such scope.
   */
  readonly defaultScopeId: string | null;
}

/**
 * A product's prices, by chain and scope (admin plan 0043, target 3).
 *
 * One panel for each chain. A row of a panel is one scope: how far it reaches,
 * what it is called, where the shown price came from, when it was seen, and
 * the price. Opening a row shows every price behind it, the sentence that says
 * why the shown one is shown, and the way to add a price there or remove one.
 *
 * It replaced two screens: the product at every scope, which was read only,
 * and one price with its history, which was a page per scope.
 *
 * **Nothing here decides which price is shown.** `shownItemPriceId` and
 * `shownBecause` are the gateway's, drawn as given. After a price is added or
 * removed the scopes are read again, because what the shown price became is
 * the server's to work out.
 *
 * A chain with no price for the product is still a panel, so that a price can
 * be added to it. It offers the chain's default scope, which is the one its
 * shops fall back to.
 *
 * **A row is a scope a price was written at.** The gateway also answers every
 * shop that only inherits the price of a wider scope, and a chain has
 * hundreds of those. They are not rows here: the wider scope's row says how
 * many scopes show its price.
 *
 * The form that adds a price is a child route, so "Add a price" has an address
 * and the browser's back button closes it. It is drawn in a panel above the
 * chains on a wide screen and in a sheet on a phone.
 */
@Component({
  selector: 'lib-product-prices-tab',
  imports: [
    RouterLink,
    RouterOutlet,
    ScopeMark,
    PopoverSheet,
    ConfirmDialog,
    ChevronLeftIcon,
    RokuTranslatorPipe,
  ],
  template: `
    <div class="tools">
      <p class="hint">{{ 'catalog.productPrices.hint' | rokuT }}</p>
      <button (click)="add(null)" class="primary" type="button" data-add-price>
        {{ 'catalog.productPrices.add' | rokuT }}
      </button>
    </div>

    @if (formOpen()) {
      @if (compact()) {
        <lib-popover-sheet
          (closed)="closeForm()"
          [heading]="'catalog.productPrices.add' | rokuT"
          [sheet]="true"
        >
          <div class="form-body"><router-outlet /></div>
        </lib-popover-sheet>
      } @else {
        <section
          [attr.aria-label]="'catalog.productPrices.add' | rokuT"
          class="panel form"
          data-price-form
        >
          <h2>{{ 'catalog.productPrices.add' | rokuT }}</h2>
          <router-outlet />
        </section>
      }
    }

    @if (actionErrorKey(); as key) {
      <p class="state error" role="alert">{{ key | rokuT }}</p>
    }

    @if (product.scopesStatus() === 'loading') {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (product.scopesStatus() === 'error') {
      <div class="state error" role="alert">
        <p>
          {{ product.scopesErrorKey() ?? 'resource.error.unknown' | rokuT }}
        </p>
        <button (click)="product.reloadPrices()" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </div>
    } @else {
      @for (chain of chains(); track chain.id) {
        <section [attr.data-chain]="chain.id" class="panel">
          <div class="chain-head">
            <h2>{{ chain.name }}</h2>
            @if (chain.scopes.length > 0) {
              <span class="muted small">{{
                'catalog.productPrices.scopes'
                  | rokuT: { count: chain.scopes.length }
              }}</span>
            }
          </div>

          @for (scope of chain.scopes; track scope.id) {
            <div [class.open]="isOpen(scope.id)" class="scope">
              <button
                (click)="toggle(scope.id)"
                [attr.aria-expanded]="isOpen(scope.id)"
                [attr.data-scope]="scope.id"
                class="scope-row"
                type="button"
              >
                <lib-chevron-left-icon
                  [class.down]="isOpen(scope.id)"
                  class="twist"
                />
                @if (scope.level; as level) {
                  <lib-scope-mark [level]="level" />
                }
                <span class="scope-name">
                  <span class="strong">{{ scope.name }}</span>
                  <span class="muted small">
                    <!-- Not twice, for a scope that is called by its kind. -->
                    @if (scope.kind !== scope.name) {
                      {{ scope.kind }}
                    }
                    @if (scope.key !== '') {
                      <span class="mono">{{ scope.key }}</span>
                    }
                  </span>
                  @if (scope.followers; as count) {
                    <span class="muted small">{{
                      'catalog.productPrices.followers' | rokuT: { count }
                    }}</span>
                  }
                </span>
                @if (scope.priced) {
                  <span class="facts">
                    @if (scope.stale) {
                      <span class="chip bad">{{
                        'catalog.prices.stale' | rokuT
                      }}</span>
                    }
                    @if (scope.heldUntil !== '') {
                      <span class="chip wait">{{
                        'catalog.productPrices.heldUntil'
                          | rokuT: { date: scope.heldUntil }
                      }}</span>
                    }
                    <span class="chip">{{ scope.source }}</span>
                    <span class="muted seen">{{ scope.seen }}</span>
                  </span>
                  <span class="muted unit">{{ scope.unitPrice }}</span>
                  <span class="price">{{ scope.price }}</span>
                } @else {
                  <span class="muted none">{{
                    'catalog.productPrices.none' | rokuT
                  }}</span>
                }
              </button>

              @if (isOpen(scope.id)) {
                <div class="behind">
                  @for (row of scope.rows; track row.id) {
                    <div [attr.data-price]="row.id" class="behind-row">
                      <span class="state-cell">
                        @switch (row.state) {
                          @case ('shown') {
                            <span class="chip ok">{{
                              'catalog.productPrices.state.shown' | rokuT
                            }}</span>
                          }
                          @case ('ended') {
                            <span class="chip">{{
                              'catalog.productPrices.state.ended' | rokuT
                            }}</span>
                          }
                          @case ('tooOld') {
                            <span class="chip">{{
                              'catalog.productPrices.state.tooOld' | rokuT
                            }}</span>
                          }
                        }
                      </span>
                      <span class="behind-main">
                        <span>{{ row.source }}</span>
                        <span class="muted small">
                          @if (row.runPath; as path) {
                            <a [routerLink]="path" data-run>{{
                              'catalog.productPrices.run'
                                | rokuT: { date: row.run }
                            }}</a>
                          }
                          {{ row.whenKey | rokuT: { date: row.when } }}
                        </span>
                        @for (line of row.overriding; track line) {
                          <span class="muted small">{{ line }}</span>
                        }
                        @if (row.inherited) {
                          <span class="muted small">{{
                            'catalog.productPrices.fromWider' | rokuT
                          }}</span>
                        }
                      </span>
                      <span
                        [class.strong]="row.state === 'shown'"
                        class="behind-price"
                        >{{ row.price }}</span
                      >
                      @if (!row.inherited) {
                        <button
                          (click)="askRemove(scope, row)"
                          [disabled]="busy()"
                          class="small-button"
                          type="button"
                          data-remove-price
                        >
                          {{ 'catalog.productPrices.remove' | rokuT }}
                        </button>
                      }
                    </div>
                  }
                  <div class="behind-foot">
                    <p class="muted small because">
                      @if (scope.because; as because) {
                        {{ 'catalog.productPrices.because.' + because | rokuT }}
                      } @else {
                        {{ 'catalog.productPrices.nothingShown' | rokuT }}
                      }
                    </p>
                    <button
                      (click)="add(scope.id)"
                      class="small-button"
                      type="button"
                      data-add-here
                    >
                      {{ 'catalog.productPrices.addHere' | rokuT }}
                    </button>
                  </div>
                </div>
              }
            </div>
          } @empty {
            <div class="scope-row plain">
              <span class="muted grow">{{
                'catalog.productPrices.noneYet' | rokuT
              }}</span>
              <button
                (click)="add(chain.defaultScopeId)"
                class="small-button"
                type="button"
                data-add-here
              >
                {{ 'catalog.productPrices.addHere' | rokuT }}
              </button>
            </div>
          }
        </section>
      } @empty {
        <p class="state">{{ 'catalog.productPrices.empty' | rokuT }}</p>
      }

      @if (product.moreScopes()) {
        <button (click)="product.moreScopePrices()" class="more" type="button">
          {{ 'catalog.productPrices.more' | rokuT }}
        </button>
      }
    }

    @if (removing(); as target) {
      <lib-confirm-dialog
        (confirm)="confirmRemove()"
        (dismiss)="removing.set(null)"
        [bodyArgs]="{ kind: target.row.source, price: target.row.price }"
        [busy]="busy()"
        bodyKey="catalog.prices.confirm.remove.body"
        confirmKey="catalog.prices.confirm.remove.confirm"
        headingKey="catalog.prices.confirm.remove.heading"
        tone="danger"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-3);
      min-inline-size: 0;
    }

    .tools {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-3);
      align-items: center;
    }

    .hint {
      flex: 1;
      min-inline-size: 12rem;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .panel {
      overflow: hidden;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .panel.form {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      padding: var(--admin-space-4);
      border-color: var(--admin-accent);
    }

    .form-body {
      display: flex;
      flex-direction: column;
      padding: var(--admin-space-4);
    }

    h2 {
      font-size: 0.9375rem;
      font-weight: 600;
    }

    .chain-head {
      display: flex;
      gap: var(--admin-space-3);
      align-items: baseline;
      padding: var(--admin-space-3) var(--admin-space-4);
    }

    .chain-head h2 {
      flex: 1;
    }

    .muted {
      color: var(--admin-ink-muted);
    }

    .small {
      font-size: 0.8125rem;
    }

    .strong {
      font-weight: 600;
    }

    .mono {
      font-family: var(--admin-font-mono);
    }

    .scope.open {
      background: var(--admin-surface);
    }

    .scope-row {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      inline-size: 100%;
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border: none;
      border-block-start: 1px solid var(--admin-border);
      border-radius: 0;
      background: none;
      font: inherit;
      text-align: start;
      color: var(--admin-ink);
    }

    button.scope-row {
      cursor: pointer;
    }

    /* The one chevron the app has points back. Turned, it points right for a
       closed row and down for an open one. */
    .twist {
      flex: none;
      inline-size: 1rem;
      block-size: 1rem;
      rotate: 180deg;
      color: var(--admin-ink-muted);
    }

    .twist.down {
      rotate: -90deg;
    }

    .scope-name {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-1) var(--admin-space-2);
      align-items: center;
      justify-content: flex-end;
    }

    .seen {
      min-inline-size: 5.5rem;
      font-size: 0.875rem;
    }

    .unit {
      min-inline-size: 5.5rem;
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
      text-align: end;
      white-space: nowrap;
    }

    .price {
      flex: none;
      min-inline-size: 4.5rem;
      font-size: 1rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-align: end;
      white-space: nowrap;
    }

    .none {
      font-size: 0.875rem;
    }

    .grow {
      flex: 1;
    }

    .chip {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      color: var(--admin-neutral-on-wash);
    }

    .chip.ok {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .chip.wait {
      background: var(--admin-waiting-wash);
      color: var(--admin-waiting-on-wash);
    }

    .chip.bad {
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .behind {
      display: flex;
      flex-direction: column;
      padding: 0 var(--admin-space-4) var(--admin-space-3) 3.125rem;
    }

    .behind-row {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      padding-block: var(--admin-space-2);
      border-block-start: 1px solid var(--admin-border);
    }

    .state-cell {
      flex: none;
      inline-size: 4.5rem;
    }

    .behind-main {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
    }

    .behind-price {
      flex: none;
      font-variant-numeric: tabular-nums;
      text-align: end;
      white-space: nowrap;
    }

    .behind-foot {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-3);
      align-items: center;
      padding-block-start: var(--admin-space-3);
      border-block-start: 1px solid var(--admin-border);
    }

    .because {
      flex: 1;
      min-inline-size: 12rem;
    }

    .primary,
    .small-button,
    .more,
    .state button {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      font-weight: 500;
      white-space: nowrap;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .primary {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    .small-button {
      flex: none;
      padding-inline: var(--admin-space-3);
      font-size: 0.8125rem;
    }

    .more {
      align-self: center;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: -2px;
    }

    .state {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .state.error {
      border: 1px solid var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    /* On a phone a row is the scope, then the price, and what is behind it
       takes the whole width. */
    @media (max-width: 47.99rem) {
      .scope-row {
        flex-wrap: wrap;
        padding-inline: var(--admin-space-3);
      }

      .facts {
        order: 3;
        flex-basis: 100%;
        justify-content: flex-start;
        padding-inline-start: 1.75rem;
      }

      .unit {
        display: none;
      }

      .seen {
        min-inline-size: 0;
      }

      .behind {
        padding-inline: var(--admin-space-3);
      }

      .behind-row {
        flex-wrap: wrap;
      }

      .primary {
        flex: 1;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductPricesTab {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _choices = inject(ScopeChoices);
  private readonly _changes = inject(ResourceChanges);
  private readonly _viewport = inject(Viewport);

  readonly product = inject(ProductContext);
  readonly compact = this._viewport.compact;

  /** The scopes whose prices are open, by id. */
  private readonly _open = signal<ReadonlySet<string>>(this._linkedScope());

  /** Whether the add a price form is open: a child route is. */
  readonly formOpen = signal(this._route.snapshot.firstChild !== null);

  readonly actionErrorKey = signal<string | null>(null);
  readonly busy = signal(false);
  /** The price awaiting a yes, with its scope. */
  readonly removing = signal<{
    readonly scope: ScopeRowView;
    readonly row: PriceRowView;
  } | null>(null);

  /** How old a price of each source may be, in days. `null` is never too old. */
  private readonly _maxAgeDays = signal<ReadonlyMap<string, number | null>>(
    new Map()
  );

  /**
   * One panel per chain: the chains that hold a price for the product first,
   * in the order the gateway gave their scopes, then every other chain that
   * has a scope a price can be added at.
   */
  readonly chains = computed<readonly ChainPanelView[]>(() => {
    // Read so that the kinds and the sources are said in words once the
    // catalogue has loaded, on a tab that was opened cold.
    this._translate.loaded();
    const scopes = this.product.scopes();
    const known = this._choices.chainsById();
    const order = this._content.order();
    const panels = new Map<
      string,
      ChainPanelView & { scopes: ScopeRowView[] }
    >();

    const panelOf = (chainId: string) => {
      let panel = panels.get(chainId);
      if (panel === undefined) {
        const chain = known.get(chainId);
        panel = {
          id: chainId,
          name:
            chain === undefined
              ? chainId
              : localizedTextValue(chain.name, order) || chainId,
          scopes: [],
          defaultScopeId: chain?.defaultPriceScopeId ?? null,
        };
        panels.set(chainId, panel);
      }
      return panel;
    };

    // A scope that only inherits a wider scope's price is counted on the
    // scope whose price it shows, and is not a row of its own.
    const whole = !this.product.moreScopes();
    const followers = new Map<string, number>();
    for (const scope of scopes) {
      if (!holdsOwnPrice(scope)) {
        const from =
          scope.rows.find((row) => row.id === scope.shownItemPriceId) ??
          scope.rows[0];
        followers.set(
          from.priceScopeId,
          (followers.get(from.priceScopeId) ?? 0) + 1
        );
      }
    }

    // Most general first inside a chain, which is the higher priority number.
    for (const scope of scopes
      .filter(holdsOwnPrice)
      .sort((a, b) => (b.scopePriority ?? 0) - (a.scopePriority ?? 0))) {
      const panel = panelOf(scope.supermarketId);
      const row = this._scopeRow(
        scope,
        whole ? (followers.get(scope.priceScopeId) ?? 0) : null
      );
      // A scope named after its chain, which is what a chain's nationwide
      // scope is, is called by its kind under the chain's own heading.
      panel.scopes.push(
        row.name === panel.name ? { ...row, name: row.kind } : row
      );
    }

    // Only once every scope is read: until then a chain may still turn out to
    // hold a price, and it would be drawn as holding none.
    if (!this.product.moreScopes()) {
      for (const chain of this._choices.chains() ?? []) {
        if (chain.defaultPriceScopeId !== null) {
          panelOf(chain.id);
        }
      }
    }

    return [...panels.values()];
  });

  constructor() {
    void this._choices.loadChains();
    void this._readPolicies();

    const events = this._router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.formOpen.set(this._route.snapshot.firstChild !== null);
      }
    });
    inject(DestroyRef).onDestroy(() => events.unsubscribe());
  }

  isOpen(scopeId: string): boolean {
    return this._open().has(scopeId);
  }

  toggle(scopeId: string): void {
    const next = new Set(this._open());
    if (next.has(scopeId)) {
      next.delete(scopeId);
    } else {
      next.add(scopeId);
    }
    this._open.set(next);
  }

  /**
   * Open the add a price form, at a scope when one is named. The scope goes
   * in the address under the name the form's field has, so the form opens
   * with it chosen.
   */
  add(scopeId: string | null): void {
    void this._router.navigate(['new'], {
      relativeTo: this._route,
      queryParams: scopeId === null ? {} : { priceScopeId: scopeId },
    });
  }

  /** Close the form from outside it: the sheet's own button, its scrim, Escape. */
  closeForm(): void {
    void this._router.navigate(['.'], { relativeTo: this._route });
  }

  askRemove(scope: ScopeRowView, row: PriceRowView): void {
    this.actionErrorKey.set(null);
    this.removing.set({ scope, row });
  }

  /**
   * The operator said yes. The scopes are read again and not patched: what the
   * shown price became is the server's to work out.
   */
  async confirmRemove(): Promise<void> {
    const target = this.removing();
    if (target === null) {
      return;
    }
    this.busy.set(true);
    try {
      await this._gateways.for(itemPriceSource()).remove(target.row.id);
      this.removing.set(null);
      // The page that holds the product follows this and reads the scopes.
      this._changes.wrote('prices');
    } catch (error) {
      this.removing.set(null);
      this.actionErrorKey.set(
        gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
      );
    } finally {
      this.busy.set(false);
    }
  }

  /** The scope the address asks to open with, as a set of one or none. */
  private _linkedScope(): ReadonlySet<string> {
    const scope = this._route.snapshot.queryParamMap.get(PRODUCT_SCOPE_QUERY);
    return new Set(scope === null || scope === '' ? [] : [scope]);
  }

  /** The limit of each price rule, for the "Too old" state. None when unread. */
  private async _readPolicies(): Promise<void> {
    try {
      const page = await this._gateways.for(pricePolicySource()).list({});
      this._maxAgeDays.set(
        new Map(
          page.items
            .filter((policy) => policy.enabled !== false)
            .map((policy) => [policy.sourceKind, policy.maxAgeDays ?? null])
        )
      );
    } catch {
      // No rule read, no "Too old". The prices themselves are still drawn.
    }
  }

  private _scopeRow(
    scope: ItemScopePrices,
    followers: number | null
  ): ScopeRowView {
    const locale = this._translate.locale();
    const now = Date.now();
    const rows = Array.isArray(scope.rows) ? scope.rows : [];
    const shown = rows.find((row) => row.id === scope.shownItemPriceId) ?? null;
    const kind = this._label(PRICE_SCOPE_KIND_OPTIONS, scope.scopeKind);
    const until = scope.protectedUntil ?? null;
    const held = until !== null && new Date(until).getTime() > now;
    const limits = this._maxAgeDays();

    return {
      id: scope.priceScopeId,
      name: scopeName(
        {
          kind: scope.scopeKind,
          externalKey: null,
          label: scope.scopeLabel,
        },
        this._content.order(),
        kind
      ),
      kind,
      level: scopeLevel(scope.scopeKind),
      key: scope.scopeExternalKey ?? '',
      priced: shown !== null,
      source:
        shown === null
          ? ''
          : this._label(PRICE_SOURCE_KIND_OPTIONS, shown.sourceKind),
      seen: shown === null ? '' : formatSeen(shown.lastObservedAt, now, locale),
      unitPrice:
        shown === null
          ? ''
          : formatUnitPrice(
              shown.unitPrice,
              shown.unitPriceLabel,
              shown.currency,
              locale
            ),
      price:
        shown === null
          ? ''
          : formatPrice(shown.price, shown.currency, locale) ||
            this._translate.t('catalog.productPrices.noTillPrice'),
      stale: scope.stale === true,
      heldUntil: held ? formatDay(until, locale) : '',
      because: toShownBecause(scope.shownBecause),
      followers,
      rows: rows.map((row) => {
        const state = priceRowState(row, scope.shownItemPriceId, limits, now);
        return {
          id: row.id,
          source: this._label(PRICE_SOURCE_KIND_OPTIONS, row.sourceKind),
          run:
            row.sourceRunId === null || row.sourceRunId === undefined
              ? ''
              : formatDay(row.observedAt, locale),
          runPath:
            row.sourceRunId === null || row.sourceRunId === undefined
              ? null
              : harvestRunPath(row.sourceRunId),
          whenKey:
            state === 'ended'
              ? 'catalog.productPrices.until'
              : 'catalog.productPrices.seen',
          when:
            state === 'ended'
              ? formatDay(row.validUntil, locale)
              : formatDay(row.lastObservedAt, locale),
          price:
            formatPrice(row.price, row.currency, locale) ||
            formatUnitPrice(
              row.unitPrice,
              row.unitPriceLabel,
              row.currency,
              locale
            ),
          state,
          overriding: this._overriding(row, locale),
          inherited: row.priceScopeId !== scope.priceScopeId,
        };
      }),
    };
  }

  /** What a typed price recorded it was overriding, one sentence per source. */
  private _overriding(
    row: Wire.CatalogItemPriceView,
    locale: string
  ): string[] {
    if (
      row.sourceKind !== 'ADMIN' ||
      typeof row.overrides !== 'object' ||
      row.overrides === null
    ) {
      return [];
    }
    return Object.entries(
      row.overrides as Record<string, { price: number | null } | null>
    )
      .filter(([, recorded]) => recorded !== null)
      .map(([kind, recorded]) =>
        this._translate.t(
          'catalog.productPrices.overriding',
          undefined,
          undefined,
          {
            kind: this._label(PRICE_SOURCE_KIND_OPTIONS, kind),
            price: formatPrice(recorded?.price, row.currency, locale),
          }
        )
      );
  }

  private _label(
    options: readonly { value: string; label: string }[],
    value: unknown
  ): string {
    const option = options.find((entry) => entry.value === value);
    return option === undefined
      ? String(value ?? '')
      : this._translate.t(option.label);
  }
}
