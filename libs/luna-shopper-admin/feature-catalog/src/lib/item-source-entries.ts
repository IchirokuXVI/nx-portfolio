import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  HARVEST_SERVICE,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  toSourceEntryStatus,
  type SourceEntryStatus,
} from '@portfolio/luna-shopper-admin/models';

/** How many source rows one page asks for. */
const ENTRY_PAGE_SIZE = 50;

/** The four ways a row is matched that the harvester section already names. */
const NAMED_MATCHES: readonly string[] = [
  'EAN',
  'NAME_BRAND_SIZE',
  'NAME_SIZE',
  'MANUAL',
];

/** One source row naming the product, as this panel draws it. */
export interface ItemSourceEntryRow {
  readonly id: string;
  readonly supermarketId: string;
  readonly externalId: string;
  readonly name: string;
  readonly ean: string;
  readonly status: SourceEntryStatus;
  /** A translation key for how the row was matched. */
  readonly matchKey: string;
  /**
   * How many rows of this chain list the same barcode, when that is more than
   * this one. `0` means the barcode is this row's alone, or there is none.
   */
  readonly sharedBy: number;
}

/**
 * A source row off the wire, as this panel's own row (rule D4).
 *
 * `null` for a record with no id, which cannot be told apart from another one
 * and so cannot be drawn.
 */
export function toItemSourceEntryRow(
  value: unknown
): ItemSourceEntryRow | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = text(row['id']);
  if (id === '') {
    return null;
  }

  const shared = row['eanSharedBy'];
  const matchedBy = row['matchedBy'];

  return {
    id,
    supermarketId: text(row['supermarketId']),
    externalId: text(row['externalId']),
    name: text(row['name']),
    ean: text(row['ean']),
    status: toSourceEntryStatus(row['status']),
    matchKey:
      typeof matchedBy === 'string' && NAMED_MATCHES.includes(matchedBy)
        ? `harvest.match.${matchedBy}`
        : matchedBy === 'SHARED_EAN'
          ? 'catalog.items.sources.matchSharedEan'
          : 'catalog.items.sources.matchNone',
    sharedBy:
      typeof shared === 'number' && Number.isInteger(shared) && shared > 1
        ? shared
        : 0,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The source products bound to one product (admin plan 0033; backend plan
 * 0160).
 *
 * Which chain rows name this product used to be a psql query, because the
 * entries queue answers from the row's side only. The panel reads the other
 * side: chain, the chain's own id and name, the barcode, the status and how the
 * row was matched.
 *
 * **A barcode more than one row of a chain lists gets a warning chip.** Backend
 * plan 0150 counted those by hand. A shared barcode is how two different
 * products end up bound to one, so the chip says how many rows share it rather
 * than leaving it to be noticed.
 *
 * It fails on its own: an error here is a line inside the panel with a retry,
 * and the product form around it keeps working.
 */
@Component({
  selector: 'lib-item-source-entries',
  imports: [RokuTranslatorPipe],
  template: `
    <section aria-labelledby="item-sources-heading">
      <h2 id="item-sources-heading">
        {{ 'catalog.items.sources.heading' | rokuT }}
      </h2>

      @if (loading() && rows().length === 0) {
        <p class="muted" role="status">
          {{ 'resource.list.loading' | rokuT }}
        </p>
      } @else if (errorKey(); as key) {
        <div class="failure" role="alert">
          <p>{{ key | rokuT }}</p>
          <button (click)="reload()" type="button">
            {{ 'resource.action.retry' | rokuT }}
          </button>
        </div>
      } @else if (rows().length === 0) {
        <p class="muted">{{ 'catalog.items.sources.empty' | rokuT }}</p>
      } @else {
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">
                  {{ 'catalog.items.sources.chain' | rokuT }}
                </th>
                <th scope="col">
                  {{ 'catalog.items.sources.externalId' | rokuT }}
                </th>
                <th scope="col">{{ 'catalog.items.sources.name' | rokuT }}</th>
                <th scope="col">{{ 'catalog.items.sources.ean' | rokuT }}</th>
                <th scope="col">
                  {{ 'catalog.items.sources.status' | rokuT }}
                </th>
                <th scope="col">
                  {{ 'catalog.items.sources.matchedBy' | rokuT }}
                </th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr>
                  <td>{{ chainName(row.supermarketId) }}</td>
                  <td class="mono">{{ row.externalId }}</td>
                  <td>{{ row.name }}</td>
                  <td>
                    <span class="mono">{{ row.ean }}</span>
                    @if (row.sharedBy > 0) {
                      <span class="chip shared">
                        {{
                          'catalog.items.sources.sharedEan'
                            | rokuT: { count: row.sharedBy }
                        }}
                      </span>
                    }
                  </td>
                  <td>
                    <span [class]="row.status" class="chip">{{
                      'harvest.entryStatus.' + row.status | rokuT
                    }}</span>
                  </td>
                  <td>{{ row.matchKey | rokuT }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (nextCursor() !== null) {
          <button (click)="more()" [disabled]="loading()" type="button">
            {{ 'catalog.items.sources.more' | rokuT }}
          </button>
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .muted {
      color: var(--admin-ink-muted);
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

    .mono {
      font-family: ui-monospace, 'SFMono-Regular', 'Consolas', monospace;
      font-size: 0.8125rem;
    }

    .chip {
      display: inline-block;
      padding: 0 var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      font-size: 0.75rem;
      white-space: nowrap;
    }

    .chip.ACTIVE {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .chip.shared {
      margin-inline-start: var(--admin-space-2);
      background: var(--admin-status-attention-wash);
      color: var(--admin-status-attention-on-wash);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemSourceEntries {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _references = inject(ResourceReferences);

  /** The product whose source rows are drawn. */
  readonly itemId = input.required<string>();

  readonly rows = signal<readonly ItemSourceEntryRow[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly errorKey = signal<string | null>(null);

  private readonly _chainNames = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _askedChains = new Set<string>();
  /** The read this panel is on, so a slower earlier answer cannot land last. */
  private _generation = 0;

  constructor() {
    effect(() => {
      const itemId = this.itemId();
      untracked(() => void this._read(itemId, undefined));
    });
  }

  /** A chain's name, or its id until the lookup answers or when it cannot. */
  chainName(id: string): string {
    return this._chainNames().get(id) ?? id;
  }

  reload(): Promise<void> {
    return this._read(this.itemId(), undefined);
  }

  more(): Promise<void> {
    const cursor = this.nextCursor();
    return cursor === null
      ? Promise.resolve()
      : this._read(this.itemId(), cursor);
  }

  private async _read(
    itemId: string,
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
      const page = await this._service.listItemEntries(itemId, {
        cursor,
        limit: ENTRY_PAGE_SIZE,
      });
      if (generation !== this._generation) {
        return;
      }
      const read = (Array.isArray(page?.items) ? page.items : [])
        .map(toItemSourceEntryRow)
        .filter((row): row is ItemSourceEntryRow => row !== null);

      this.rows.update((held) =>
        cursor === undefined ? read : [...held, ...read]
      );
      this.nextCursor.set(
        typeof page?.nextCursor === 'string' ? page.nextCursor : null
      );
      this._nameChains(read.map((row) => row.supermarketId));
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

  private _nameChains(ids: readonly string[]): void {
    for (const id of new Set(ids)) {
      if (id === '' || this._askedChains.has(id)) {
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
          // The id stays, which is what a chain nobody can name shows anyway.
        });
    }
  }
}
