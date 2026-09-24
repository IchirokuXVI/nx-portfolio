import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  HARVEST_SERVICE,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { formatCurrencyAmount } from '@portfolio/luna-shopper-admin/models';
import { ReferencePicker } from '@portfolio/luna-shopper-admin/ui';

/** How many price rows one page asks for. */
const PRICE_PAGE_SIZE = 50;

/** How a run came to hold a row: it wrote it, or it saw it again. */
export type RunPriceWrittenBy = 'INSERTED' | 'CONFIRMED' | 'UNKNOWN';

/** Where a price came from, as far as this tab tells them apart. */
const SOURCE_KINDS: readonly string[] = [
  'OFFICIAL_API',
  'OFFICIAL_WEB',
  'OFFICIAL_LEAFLET',
  'ADMIN',
  'USER_RECEIPT',
  'USER_REPORTED',
];

/** One row a run wrote, as this tab holds it (rule D4). */
export interface RunPriceRow {
  readonly id: string;
  readonly itemId: string;
  readonly priceScopeId: string;
  /** The source kind, or `''` for one this build does not know. */
  readonly sourceKind: string;
  readonly price: number | null;
  readonly unitPrice: number | null;
  readonly unitPriceLabel: string | null;
  readonly currency: string | null;
  readonly writtenBy: RunPriceWrittenBy;
}

/**
 * A price row off the wire, or `null` for one with no id or no product, which
 * could be neither told apart nor opened.
 *
 * `writtenBy` is `UNKNOWN` for anything but the two answers: saying a row was
 * inserted when the server did not say so is the claim this tab exists to make
 * correctly.
 */
export function toRunPriceRow(value: unknown): RunPriceRow | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = stringOf(row['id']);
  const itemId = stringOf(row['itemId']);
  if (id === '' || itemId === '') {
    return null;
  }
  const writtenBy = row['writtenBy'];
  const kind = stringOf(row['sourceKind']);

  return {
    id,
    itemId,
    priceScopeId: stringOf(row['priceScopeId']),
    sourceKind: SOURCE_KINDS.includes(kind) ? kind : '',
    price: numberOrNull(row['price']),
    unitPrice: numberOrNull(row['unitPrice']),
    unitPriceLabel: stringOf(row['unitPriceLabel']) || null,
    currency: stringOf(row['currency']) || null,
    writtenBy:
      writtenBy === 'INSERTED' || writtenBy === 'CONFIRMED'
        ? writtenBy
        : 'UNKNOWN',
  };
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The "Prices written" tab of the run screen (admin plan 0033; backend plan
 * 0160).
 *
 * The run screen counts what a run did; this lists it. Every price row the run
 * inserted, and every row an earlier run inserted that this one saw again, with
 * which of the two it was. Plan 0150 found the four rows walk 2 inserted for
 * Dorada with psql, and this is that query as a table.
 *
 * **Narrowed by product, chosen by name.** The route narrows a run to one
 * product id and nothing else, so the filter is the product picker the rest of
 * the app uses: the operator types a name and the tab sends the id.
 *
 * Each row opens the product's prices at every scope, which is where the row's
 * standing is explained: whether it is the one shown, and why.
 *
 * A confirmed row can leave this list later. The confirmation belongs to the
 * newest run that repeated the price, so an older run's confirmed rows shrink as
 * newer runs confirm them, and the lead sentence says so.
 */
@Component({
  selector: 'lib-run-prices-tab',
  imports: [RouterLink, RokuTranslatorPipe, ReferencePicker],
  template: `
    <p class="lead">{{ 'harvest.run.prices.lead' | rokuT }}</p>

    <div class="filter">
      <label for="run-prices-item">{{
        'harvest.run.prices.filter' | rokuT
      }}</label>
      <lib-reference-picker
        (valueChange)="narrow($event)"
        [controlId]="'run-prices-item'"
        [lookup]="references"
        [nullable]="true"
        [resource]="'items'"
        [value]="itemId()"
      />
    </div>

    @if (loading() && rows().length === 0) {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (errorKey(); as key) {
      <div class="failure" role="alert">
        <p>{{ key | rokuT }}</p>
        <button (click)="reload()" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </div>
    } @else if (rows().length === 0) {
      <p class="state">
        {{
          (itemId() === ''
            ? 'harvest.run.prices.empty'
            : 'harvest.run.prices.emptyForItem'
          ) | rokuT
        }}
      </p>
    } @else {
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{{ 'harvest.run.prices.item' | rokuT }}</th>
              <th scope="col">{{ 'harvest.run.prices.scope' | rokuT }}</th>
              <th scope="col">{{ 'harvest.run.prices.kind' | rokuT }}</th>
              <th class="number" scope="col">
                {{ 'harvest.run.prices.price' | rokuT }}
              </th>
              <th class="number" scope="col">
                {{ 'harvest.run.prices.unitPrice' | rokuT }}
              </th>
              <th scope="col">{{ 'harvest.run.prices.writtenBy' | rokuT }}</th>
            </tr>
          </thead>
          <tbody>
            @for (row of shown(); track row.id) {
              <tr>
                <th scope="row">
                  @if (row.link; as link) {
                    <a [routerLink]="link">{{ row.item }}</a>
                  } @else {
                    {{ row.item }}
                  }
                </th>
                <td>{{ row.scope }}</td>
                <td>
                  @if (row.sourceKind !== '') {
                    {{ 'catalog.priceSourceKind.' + row.sourceKind | rokuT }}
                  }
                </td>
                <td class="number">{{ row.price }}</td>
                <td class="number">{{ row.unitPrice }}</td>
                <td>
                  <span [class]="row.writtenBy" class="chip">{{
                    'harvest.run.prices.written.' + row.writtenBy | rokuT
                  }}</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (nextCursor() !== null) {
        <button (click)="more()" [disabled]="loading()" type="button">
          {{ 'harvest.run.prices.more' | rokuT }}
        </button>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      inline-size: 100%;
    }

    .lead,
    .state {
      max-inline-size: 65ch;
      color: var(--admin-ink-muted);
    }

    .filter {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      inline-size: min(100%, 24rem);
    }

    .filter label {
      font-size: 0.875rem;
    }

    .failure {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
    }

    .scroll {
      inline-size: 100%;
      overflow-x: auto;
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: var(--admin-space-2) var(--admin-space-3);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
      vertical-align: baseline;
    }

    thead th {
      font-size: 0.75rem;
      font-weight: 400;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    tbody th {
      font-weight: 600;
    }

    tbody a {
      color: var(--admin-accent);
    }

    .number {
      font-variant-numeric: tabular-nums;
      text-align: end;
    }

    .chip {
      padding: 0 var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      font-size: 0.75rem;
      white-space: nowrap;
    }

    .chip.INSERTED {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunPricesTab {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _registry = inject(ResourceRegistry);

  readonly references = inject(ResourceReferences);

  /** The run whose rows are listed. */
  readonly runId = input.required<string>();

  /** The product the list is narrowed to, or `''` for every one. */
  readonly itemId = signal('');

  readonly rows = signal<readonly RunPriceRow[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly errorKey = signal<string | null>(null);

  private readonly _names = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _asked = new Set<string>();
  private _generation = 0;

  /** The rows as the table draws them. */
  readonly shown = computed(() => {
    const names = this._names();
    const items = this._registry.pathOf('items');

    return this.rows().map((row) => ({
      id: row.id,
      item: names.get(`items:${row.itemId}`) ?? row.itemId,
      scope: names.get(`price-scopes:${row.priceScopeId}`) ?? row.priceScopeId,
      sourceKind: row.sourceKind,
      price: formatCurrencyAmount(row.price, row.currency),
      unitPrice:
        row.unitPrice === null
          ? ''
          : row.unitPriceLabel === null
            ? String(row.unitPrice)
            : `${row.unitPrice} / ${row.unitPriceLabel}`,
      writtenBy: row.writtenBy,
      link: items === null ? null : [...items, row.itemId, 'prices'],
    }));
  });

  constructor() {
    effect(() => {
      const runId = this.runId();
      untracked(() => void this._read(runId, undefined));
    });
  }

  /** The product picker chose a product, or was cleared. */
  narrow(itemId: string): Promise<void> {
    this.itemId.set(itemId);
    return this._read(this.runId(), undefined);
  }

  reload(): Promise<void> {
    return this._read(this.runId(), undefined);
  }

  more(): Promise<void> {
    const cursor = this.nextCursor();
    return cursor === null
      ? Promise.resolve()
      : this._read(this.runId(), cursor);
  }

  private async _read(
    runId: string,
    cursor: string | undefined
  ): Promise<void> {
    this._generation += 1;
    const generation = this._generation;

    this.loading.set(true);
    this.errorKey.set(null);
    if (cursor === undefined) {
      this.rows.set([]);
      this.nextCursor.set(null);
    }

    try {
      const itemId = this.itemId();
      const page = await this._service.listRunPrices(runId, {
        cursor,
        limit: PRICE_PAGE_SIZE,
        itemId: itemId === '' ? undefined : itemId,
      });
      if (generation !== this._generation) {
        return;
      }
      const read = (Array.isArray(page?.items) ? page.items : [])
        .map(toRunPriceRow)
        .filter((row): row is RunPriceRow => row !== null);

      this.rows.update((held) =>
        cursor === undefined ? read : [...held, ...read]
      );
      this.nextCursor.set(
        typeof page?.nextCursor === 'string' ? page.nextCursor : null
      );
      for (const row of read) {
        this._name('items', row.itemId);
        this._name('price-scopes', row.priceScopeId);
      }
    } catch (error) {
      if (generation !== this._generation) {
        return;
      }
      this.errorKey.set(
        error instanceof GatewayError
          ? (gatewayErrorKey(error) ?? 'resource.error.unknown')
          : 'resource.error.unknown'
      );
    } finally {
      if (generation === this._generation) {
        this.loading.set(false);
      }
    }
  }

  /**
   * Name one product or scope, once. A page repeats the same few scopes, so
   * the cache is what keeps this to one read per distinct id.
   */
  private _name(resource: string, id: string): void {
    const key = `${resource}:${id}`;
    if (id === '' || this._asked.has(key)) {
      return;
    }
    this._asked.add(key);
    this.references
      .resolve(resource, id)
      .then((option) => {
        if (option !== null) {
          this._names.update((held) => new Map(held).set(key, option.title));
        }
      })
      .catch(() => {
        // The id stays.
      });
  }
}
