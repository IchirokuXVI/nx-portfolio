import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  RESOURCE_ID_PARAM,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  compositeParts,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog } from '@portfolio/luna-shopper-admin/ui';
import { PRICE_SOURCE_KIND_OPTIONS } from './catalog-enums';
import { itemPriceSource, PRICE_KEY, priceSource } from './catalog-sources';

/** One row of the history, formatted for the screen. */
export interface PriceHistoryRow {
  readonly id: string;
  readonly kindLabel: string;
  readonly price: string;
  readonly unitPrice: string;
  readonly observedAt: string;
  readonly lastObservedAt: string;
  readonly window: string;
  readonly runId: string;
  /** True while an `ADMIN` row is inside its protection window. */
  readonly protected: boolean;
  /** "Overriding an official 1.19", one per kind the row recorded. Empty for other kinds. */
  readonly overriding: readonly string[];
  /** Whether this is the row the effective price came from. */
  readonly effective: boolean;
}

/**
 * A price and its history (backend plan 0080, section 10).
 *
 * The effective row at the top, the rows behind it below, newest first, with
 * an **add a price** door and a **remove** on every row. Editing a price is
 * inserting a price: an operator who typed 1.29 and meant 1.92 removes the row
 * and adds another, and both stay in the history, which is the point of one.
 *
 * Beside an `ADMIN` row inside its protection window, the line backlog 0001
 * asked for: what it is overriding, drawn from the row's own snapshot with no
 * extra read (plan 0080, section 4.2).
 *
 * A component rather than the generic form, because the generic form draws a
 * flat row and this screen is two reads joined by a pair: the effective row is
 * addressed by `(itemId, priceScopeId)` and the history is listed by the same
 * pair, which the route carries as one composite id.
 */
@Component({
  selector: 'lib-price-detail-page',
  imports: [ConfirmDialog, RokuTranslatorPipe],
  template: `
    <header>
      <button (click)="back()" class="back" type="button">
        {{ 'catalog.prices.history.back' | rokuT }}
      </button>
      <h1>{{ itemId }}</h1>
      <p class="kind">
        {{ 'catalog.prices.history.scope' | rokuT }} {{ priceScopeId }}
      </p>
    </header>

    @if (loading()) {
      <p class="state" role="status">{{ 'resource.form.loading' | rokuT }}</p>
    } @else if (errorKey(); as key) {
      <div class="state error" role="alert">
        <p>{{ key | rokuT }}</p>
        <button (click)="load()" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </div>
    } @else {
      <section class="effective">
        <h2>{{ 'catalog.prices.history.effective' | rokuT }}</h2>
        @if (effective(); as row) {
          <dl>
            <dt>{{ 'catalog.prices.price' | rokuT }}</dt>
            <dd>{{ row.price }}</dd>
            <dt>{{ 'catalog.prices.unitPrice' | rokuT }}</dt>
            <dd>{{ row.unitPrice }}</dd>
            <dt>{{ 'catalog.prices.sourceKind' | rokuT }}</dt>
            <dd>{{ row.kindLabel }}</dd>
            <dt>{{ 'catalog.prices.observedAt' | rokuT }}</dt>
            <dd>{{ row.observedAt }}</dd>
            <dt>{{ 'catalog.prices.validUntil' | rokuT }}</dt>
            <dd>{{ row.validUntil }}</dd>
            <dt>{{ 'catalog.prices.stale' | rokuT }}</dt>
            <dd>
              {{
                (row.stale
                  ? 'catalog.prices.history.staleYes'
                  : 'catalog.prices.history.staleNo'
                ) | rokuT
              }}
            </dd>
          </dl>
        } @else {
          <p class="muted">
            {{ 'catalog.prices.history.noEffective' | rokuT }}
          </p>
        }
      </section>

      <section>
        <h2>{{ 'catalog.prices.history.rows' | rokuT }}</h2>
        @if (actionErrorKey(); as key) {
          <p class="state error" role="alert">{{ key | rokuT }}</p>
        }
        @if (history().length === 0) {
          <p class="muted">{{ 'catalog.prices.history.none' | rokuT }}</p>
        } @else {
          <ul class="rows">
            @for (row of history(); track row.id) {
              <li [class.effective]="row.effective">
                <div class="what">
                  <span class="content">
                    {{ row.kindLabel }} · {{ row.price }}
                    @if (row.unitPrice) {
                      · {{ row.unitPrice }}
                    }
                    @if (row.effective) {
                      <span class="badge">{{
                        'catalog.prices.history.shown' | rokuT
                      }}</span>
                    }
                  </span>
                  <span class="muted">
                    {{ 'catalog.prices.history.seen' | rokuT }}
                    {{ row.observedAt }}
                    @if (row.lastObservedAt !== row.observedAt) {
                      · {{ 'catalog.prices.history.lastSeen' | rokuT }}
                      {{ row.lastObservedAt }}
                    }
                    @if (row.window) {
                      · {{ row.window }}
                    }
                    @if (row.runId) {
                      · {{ 'catalog.prices.history.run' | rokuT }}
                      {{ row.runId }}
                    }
                  </span>
                  @for (line of row.overriding; track line) {
                    <span class="muted overriding">{{ line }}</span>
                  }
                </div>
                <div class="actions">
                  <button
                    (click)="askRemove(row)"
                    [disabled]="busy()"
                    type="button"
                  >
                    {{ 'catalog.prices.history.remove' | rokuT }}
                  </button>
                </div>
              </li>
            }
          </ul>
        }
      </section>

      <section>
        <h2>{{ 'catalog.prices.history.actions' | rokuT }}</h2>
        <div class="actions">
          <button (click)="add()" type="button">
            {{ 'catalog.prices.history.add' | rokuT }}
          </button>
        </div>
      </section>
    }

    @if (removing(); as row) {
      <lib-confirm-dialog
        (confirm)="confirmRemove()"
        (dismiss)="removing.set(null)"
        [bodyArgs]="{ price: row.price, kind: row.kindLabel }"
        [busy]="busy()"
        bodyKey="catalog.prices.confirm.remove.body"
        confirmKey="catalog.prices.confirm.remove.confirm"
        headingKey="catalog.prices.confirm.remove.heading"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    header {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 700;
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .kind,
    .muted {
      color: var(--admin-ink-muted);
    }

    .back {
      min-block-size: 2.75rem;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
    }

    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--admin-space-1) var(--admin-space-4);
    }

    dt {
      color: var(--admin-ink-muted);
    }

    .rows {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .rows li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .rows li.effective {
      border-color: var(--admin-ink);
    }

    .what {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .content {
      font-weight: 600;
    }

    .badge {
      margin-inline-start: var(--admin-space-2);
      font-size: 0.8rem;
      font-weight: 400;
      color: var(--admin-ink-muted);
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .state.error {
      border-style: solid;
      border-color: var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceDetailPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _effective =
    this._gateways.for<Wire.CatalogSupermarketItemView>(priceSource());
  private readonly _rows =
    this._gateways.for<Wire.CatalogItemPriceView>(itemPriceSource());

  /** The pair the route carries, as one composite id. */
  readonly id = this._route.snapshot.paramMap.get(RESOURCE_ID_PARAM) ?? '';
  private readonly _key = compositeParts(this.id, PRICE_KEY) ?? {};
  readonly itemId = this._key['itemId'] ?? '';
  readonly priceScopeId = this._key['priceScopeId'] ?? '';

  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  readonly actionErrorKey = signal<string | null>(null);
  readonly busy = signal(false);
  readonly removing = signal<PriceHistoryRow | null>(null);

  private readonly _effectiveRow =
    signal<Wire.CatalogSupermarketItemView | null>(null);
  private readonly _historyRows = signal<readonly Wire.CatalogItemPriceView[]>(
    []
  );

  readonly effective = computed(() => {
    const row = this._effectiveRow();
    if (row === null) {
      return null;
    }
    return {
      price: money(row.price, row.currency),
      unitPrice: unit(row.unitPrice, row.unitPriceLabel),
      kindLabel: this._kindLabel(row.sourceKind),
      observedAt: this._instant(row.observedAt),
      validUntil: this._instant(row.validUntil),
      stale: row.stale,
    };
  });

  readonly history = computed<readonly PriceHistoryRow[]>(() => {
    const effectiveId = this._effectiveRow()?.itemPriceId ?? null;
    const now = Date.now();
    return this._historyRows().map((row) => ({
      id: row.id,
      kindLabel: this._kindLabel(row.sourceKind),
      price: money(row.price, row.currency),
      unitPrice: unit(row.unitPrice, row.unitPriceLabel),
      observedAt: this._instant(row.observedAt),
      lastObservedAt: this._instant(row.lastObservedAt),
      window: this._window(row.validFrom, row.validUntil),
      runId: row.sourceRunId ?? '',
      protected:
        row.protectedUntil !== null &&
        new Date(row.protectedUntil).getTime() > now,
      overriding: this._overriding(row),
      effective: row.id === effectiveId,
    }));
  });

  constructor() {
    void this.load();
  }

  /** Both reads, from the top. */
  async load(): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [effective, history] = await Promise.all([
        this._effective.read(this.id).catch((error: unknown) => {
          // A pair with no effective row is a pair whose every price was
          // removed. The history still answers, and it is what this screen is
          // for, so the top says "none" rather than the whole screen failing.
          if (error instanceof GatewayError && error.status === 404) {
            return null;
          }
          throw error;
        }),
        this._rows.list({
          filters: { itemId: this.itemId, priceScopeId: this.priceScopeId },
          limit: 100,
        }),
      ]);
      this._effectiveRow.set(effective);
      this._historyRows.set(history.items);
    } catch (error) {
      this._effectiveRow.set(null);
      this._historyRows.set([]);
      this.errorKey.set(
        gatewayErrorKey(error instanceof GatewayError ? error : null)
      );
    } finally {
      this.loading.set(false);
    }
  }

  back(): void {
    void this._router.navigate(['..'], { relativeTo: this._route });
  }

  /** The add a price form, one segment up. */
  add(): void {
    void this._router.navigate(['..', 'new'], { relativeTo: this._route });
  }

  askRemove(row: PriceHistoryRow): void {
    this.actionErrorKey.set(null);
    this.removing.set(row);
  }

  /**
   * The operator said yes. Both reads run again afterwards rather than the
   * row being spliced out: removing a row recomputes the effective price on
   * the server, and what it became is not something this screen can work out.
   */
  async confirmRemove(): Promise<void> {
    const row = this.removing();
    if (row === null) {
      return;
    }
    this.busy.set(true);
    try {
      await this._rows.remove(row.id);
      this.removing.set(null);
      await this.load();
    } catch (error) {
      this.removing.set(null);
      this.actionErrorKey.set(
        gatewayErrorKey(error instanceof GatewayError ? error : null)
      );
    } finally {
      this.busy.set(false);
    }
  }

  private _kindLabel(kind: unknown): string {
    const option = PRICE_SOURCE_KIND_OPTIONS.find(
      (entry) => entry.value === kind
    );
    return option === undefined
      ? String(kind ?? '')
      : this._translate.t(option.label);
  }

  private _instant(value: string | null): string {
    if (value === null || value === '') {
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

  private _window(from: string | null, until: string | null): string {
    if (from === null && until === null) {
      return '';
    }
    return `${this._instant(from) || '…'} → ${this._instant(until) || '…'}`;
  }

  /** Section 4.2's line: what an `ADMIN` row recorded it was overriding. */
  private _overriding(row: Wire.CatalogItemPriceView): string[] {
    if (
      row.sourceKind !== 'ADMIN' ||
      typeof row.overrides !== 'object' ||
      row.overrides === null
    ) {
      return [];
    }
    return Object.entries(
      row.overrides as Record<
        string,
        { price: number | null; unitPrice: number | null }
      >
    ).map(([kind, recorded]) =>
      this._translate.t(
        'catalog.prices.history.overriding',
        undefined,
        undefined,
        {
          kind: this._kindLabel(kind),
          price: money(recorded.price, row.currency),
        }
      )
    );
  }
}

function money(value: number | null, currency: string | null): string {
  if (value === null) {
    return '';
  }
  return currency ? `${value.toFixed(2)} ${currency}` : value.toFixed(2);
}

function unit(value: number | null, label: string | null): string {
  if (value === null) {
    return '';
  }
  return label ? `${value} / ${label}` : String(value);
}
