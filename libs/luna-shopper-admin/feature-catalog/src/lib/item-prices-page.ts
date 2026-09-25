import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  GatewayError,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  compositeIdOf,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  PRICE_SCOPE_KIND_OPTIONS,
  PRICE_SOURCE_KIND_OPTIONS,
} from './catalog-enums';
import type { ItemScopePrices } from './catalog-seed';
import {
  itemScopePricesSource,
  itemSource,
  PRICE_KEY,
} from './catalog-sources';

/** How many scopes one page asks for. */
const SCOPE_PAGE_SIZE = 50;

/** The four reasons the decision gives, each with a sentence of its own. */
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
 *
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

/** One row a scope weighed, formatted for the screen. */
export interface ScopePriceRow {
  readonly id: string;
  readonly kindLabel: string;
  readonly price: string;
  readonly unitPrice: string;
  readonly observedAt: string;
  readonly lastObservedAt: string;
  readonly shown: boolean;
}

/** One scope of the product, formatted for the screen. */
export interface ScopePricesView {
  readonly priceScopeId: string;
  readonly supermarketId: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly rows: readonly ScopePriceRow[];
  readonly shownBecause: ShownBecause | null;
  /** When an `ADMIN` row's protection ends, as words, or `''`. */
  readonly protectedUntil: string;
  /** Whether that instant is still ahead. */
  readonly protecting: boolean;
  readonly stale: boolean;
  /** Where this scope's history is, which is also where a price is added. */
  readonly historyLink: readonly string[] | null;
}

/**
 * One product at every scope that prices it (admin plan 0033; backend plan
 * 0160).
 *
 * The price detail screen is one (product, scope) pair. This is the product
 * across all of them: each scope with every row the decision weighed, the row
 * it chose marked, and **why**, in a sentence. The reason is the server's,
 * returned by the function that decides; nothing here works it out again, so a
 * change to the rule cannot leave this screen explaining the old one.
 *
 * `protectedUntil` is drawn as a date wherever the server sent one, and it says
 * whether that date is still ahead: a protection that has ended is the reason a
 * crawl price is back on top, which is exactly the question an operator came
 * here with.
 *
 * The product's name and the scopes are two reads that fail apart. A name that
 * cannot be read leaves the id as the heading and the scopes drawn.
 */
@Component({
  selector: 'lib-item-prices-page',
  imports: [RouterLink, RokuTranslatorPipe],
  template: `
    <header>
      @if (itemLink(); as link) {
        <a [routerLink]="link" class="back">{{
          'catalog.prices.byItem.back' | rokuT
        }}</a>
      }
      <h1>{{ heading() }}</h1>
      <p class="muted">{{ 'catalog.prices.byItem.lead' | rokuT }}</p>
    </header>

    @if (loading() && scopes().length === 0) {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (errorKey(); as key) {
      <div class="state error" role="alert">
        <p>{{ key | rokuT }}</p>
        <button (click)="reload()" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </div>
    } @else if (scopes().length === 0) {
      <p class="state">{{ 'catalog.prices.byItem.empty' | rokuT }}</p>
    } @else {
      <ol class="scopes">
        @for (scope of scopes(); track scope.priceScopeId) {
          <li>
            <div class="scope-head">
              <h2>{{ scope.name }}</h2>
              <span class="muted">{{ scope.kindLabel }}</span>
              <span class="muted">{{ chainName(scope.supermarketId) }}</span>
              @if (scope.stale) {
                <span class="chip attention">{{
                  'catalog.prices.byItem.stale' | rokuT
                }}</span>
              }
            </div>

            @if (scope.shownBecause; as because) {
              <p class="because">
                {{ 'catalog.prices.byItem.because.' + because | rokuT }}
              </p>
            } @else {
              <p class="because muted">
                {{ 'catalog.prices.byItem.nothingShown' | rokuT }}
              </p>
            }

            @if (scope.protectedUntil !== '') {
              <p class="muted">
                {{
                  (scope.protecting
                    ? 'catalog.prices.byItem.protectedUntil'
                    : 'catalog.prices.byItem.protectionEnded'
                  ) | rokuT: { date: scope.protectedUntil }
                }}
              </p>
            }

            <table>
              <thead>
                <tr>
                  <th scope="col">{{ 'catalog.prices.sourceKind' | rokuT }}</th>
                  <th class="number" scope="col">
                    {{ 'catalog.prices.price' | rokuT }}
                  </th>
                  <th class="number" scope="col">
                    {{ 'catalog.prices.unitPrice' | rokuT }}
                  </th>
                  <th scope="col">{{ 'catalog.prices.observedAt' | rokuT }}</th>
                  <th scope="col">
                    {{ 'catalog.prices.history.lastSeen' | rokuT }}
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (row of scope.rows; track row.id) {
                  <tr [class.shown]="row.shown">
                    <th scope="row">
                      {{ row.kindLabel }}
                      @if (row.shown) {
                        <span class="chip accent">{{
                          'catalog.prices.history.shown' | rokuT
                        }}</span>
                      }
                    </th>
                    <td class="number">{{ row.price }}</td>
                    <td class="number">{{ row.unitPrice }}</td>
                    <td>{{ row.observedAt }}</td>
                    <td>{{ row.lastObservedAt }}</td>
                  </tr>
                }
              </tbody>
            </table>

            @if (scope.historyLink; as link) {
              <a [routerLink]="link" class="history">{{
                'catalog.prices.byItem.history' | rokuT
              }}</a>
            }
          </li>
        }
      </ol>

      @if (nextCursor() !== null) {
        <button (click)="more()" [disabled]="loading()" type="button">
          {{ 'catalog.prices.byItem.more' | rokuT }}
        </button>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      align-items: flex-start;
    }

    header {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 700;
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .muted {
      color: var(--admin-ink-muted);
    }

    .back,
    .history {
      color: var(--admin-accent);
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .state.error {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      border-style: solid;
      border-color: var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    .scopes {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-6);
      inline-size: 100%;
      list-style: none;
    }

    .scopes > li {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      padding-block-start: var(--admin-space-3);
      border-block-start: 1px solid var(--admin-border);
    }

    .scope-head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-1) var(--admin-space-3);
      align-items: baseline;
    }

    .because {
      max-inline-size: 65ch;
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: var(--admin-space-2) var(--admin-space-3);
      text-align: start;
      vertical-align: baseline;
    }

    tbody tr + tr > * {
      border-block-start: 1px solid var(--admin-border);
    }

    thead th {
      font-size: 0.75rem;
      font-weight: 400;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    tbody th {
      font-weight: 400;
    }

    tr.shown > * {
      font-weight: 600;
    }

    .number {
      font-variant-numeric: tabular-nums;
      text-align: end;
    }

    .chip {
      display: inline-block;
      margin-inline-start: var(--admin-space-2);
      padding: 0 var(--admin-space-2);
      border-radius: var(--admin-radius);
      font-size: 0.75rem;
      font-weight: 400;
    }

    .chip.accent {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .chip.attention {
      background: var(--admin-status-attention-wash);
      color: var(--admin-status-attention-on-wash);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemPricesPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _references = inject(ResourceReferences);
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _scopesGateway = this._gateways.for<ItemScopePrices>(
    itemScopePricesSource()
  );
  private readonly _items =
    this._gateways.for<Wire.CatalogItemView>(itemSource());

  /** The product, from the route. */
  readonly itemId = this._route.snapshot.paramMap.get('id') ?? '';

  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  readonly nextCursor = signal<string | null>(null);

  private readonly _item = signal<Wire.CatalogItemView | null>(null);
  private readonly _scopes = signal<readonly ItemScopePrices[]>([]);
  private readonly _chainNames = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _askedChains = new Set<string>();

  /** The product's name, or its id while it is unread or unreadable. */
  readonly heading = computed(() => {
    const item = this._item();
    const name =
      item === null ? '' : localizedTextValue(item.name, this._content.order());
    return name === '' ? this.itemId : name;
  });

  /** Back to the product's own screen, where the registry says it is. */
  readonly itemLink = computed(() => {
    const path = this._registry.pathOf('items');
    return path === null ? null : [...path, this.itemId];
  });

  readonly scopes = computed<readonly ScopePricesView[]>(() => {
    const prices = this._registry.pathOf('prices');
    const now = Date.now();

    return this._scopes().map((scope) => {
      const rows = Array.isArray(scope.rows) ? scope.rows : [];
      const until = scope.protectedUntil ?? null;
      const untilTime = until === null ? NaN : new Date(until).getTime();

      return {
        priceScopeId: scope.priceScopeId,
        supermarketId: scope.supermarketId,
        name: this._scopeName(scope),
        kindLabel: this._label(PRICE_SCOPE_KIND_OPTIONS, scope.scopeKind),
        rows: rows.map((row) => ({
          id: row.id,
          kindLabel: this._label(PRICE_SOURCE_KIND_OPTIONS, row.sourceKind),
          price: money(row.price, row.currency),
          unitPrice: unit(row.unitPrice, row.unitPriceLabel),
          observedAt: this._instant(row.observedAt),
          lastObservedAt: this._instant(row.lastObservedAt),
          shown: row.id === scope.shownItemPriceId,
        })),
        shownBecause: toShownBecause(scope.shownBecause),
        protectedUntil: this._instant(until),
        protecting: !Number.isNaN(untilTime) && untilTime > now,
        stale: scope.stale === true,
        historyLink:
          prices === null
            ? null
            : [
                ...prices,
                compositeIdOf(
                  { itemId: this.itemId, priceScopeId: scope.priceScopeId },
                  PRICE_KEY
                ),
              ],
      };
    });
  });

  constructor() {
    void this._readItem();
    void this.reload();
  }

  /** A chain's name, or its id until the lookup answers. */
  chainName(id: string): string {
    return this._chainNames().get(id) ?? id;
  }

  reload(): Promise<void> {
    return this._readScopes(undefined);
  }

  more(): Promise<void> {
    const cursor = this.nextCursor();
    return cursor === null ? Promise.resolve() : this._readScopes(cursor);
  }

  private async _readItem(): Promise<void> {
    try {
      this._item.set(await this._items.read(this.itemId));
    } catch {
      // The id stays as the heading. The scopes are the point of the screen
      // and are read on their own, so a product that cannot be named does not
      // take its prices with it.
    }
  }

  private async _readScopes(cursor: string | undefined): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const page = await this._scopesGateway.list({
        cursor,
        filters: { itemId: this.itemId },
        limit: SCOPE_PAGE_SIZE,
      });
      this._scopes.update((held) =>
        cursor === undefined ? page.items : [...held, ...page.items]
      );
      this.nextCursor.set(page.nextCursor);
      this._nameChains(page.items.map((scope) => scope.supermarketId));
    } catch (error) {
      this.errorKey.set(
        error instanceof GatewayError
          ? (gatewayErrorKey(error) ?? 'resource.error.unknown')
          : 'resource.error.unknown'
      );
    } finally {
      this.loading.set(false);
    }
  }

  private _nameChains(ids: readonly string[]): void {
    for (const id of new Set(ids)) {
      if (typeof id !== 'string' || id === '' || this._askedChains.has(id)) {
        continue;
      }
      this._askedChains.add(id);
      this._references
        .resolve('supermarkets', id)
        .then((option) => {
          if (option !== null) {
            this._chainNames.update((held) =>
              new Map(held).set(id, option.title)
            );
          }
        })
        .catch(() => {
          // The id stays.
        });
    }
  }

  /**
   * What a scope is called: its label, else its kind and key, which is what
   * the scope screens say for an unlabelled one.
   */
  private _scopeName(scope: ItemScopePrices): string {
    const label =
      scope.scopeLabel === null || scope.scopeLabel === undefined
        ? ''
        : localizedTextValue(scope.scopeLabel, this._content.order());
    if (label !== '') {
      return label;
    }
    const kind = this._label(PRICE_SCOPE_KIND_OPTIONS, scope.scopeKind);
    return scope.scopeExternalKey
      ? `${kind} ${scope.scopeExternalKey}`
      : kind || scope.priceScopeId;
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

  private _instant(value: string | null | undefined): string {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat(this._translate.locale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }
}

function money(value: number | null, currency: string | null): string {
  if (value === null || value === undefined) {
    return '';
  }
  return currency ? `${value.toFixed(2)} ${currency}` : value.toFixed(2);
}

function unit(value: number | null, label: string | null): string {
  if (value === null || value === undefined) {
    return '';
  }
  return label ? `${value} / ${label}` : String(value);
}
