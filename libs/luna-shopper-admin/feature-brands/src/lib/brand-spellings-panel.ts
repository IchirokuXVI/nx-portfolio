import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ChainNames } from '@portfolio/luna-shopper-admin/feature-harvest';
import { RECORD_CONTEXT } from '@portfolio/luna-shopper-admin/feature-resource';
import { RecordSection } from '@portfolio/luna-shopper-admin/ui';
import type { SeededSpelling } from './brand-seed';
import { BrandsGateway } from './brands-gateway';

/** One chain, and every way it spells this brand. */
interface SpellingGroup {
  readonly supermarketId: string;
  readonly rows: readonly SeededSpelling[];
}

/**
 * What each chain's source calls a brand (admin plan 0027, section 2.3), as a
 * panel of the brand's record page (admin plan 0054, section 4.2).
 *
 * It was a block of `BrandDetailPage`, and is that block as it was: one row
 * for each spelling, grouped by chain, with the count of products and of
 * queued entries. It learns the brand from `RECORD_CONTEXT`.
 *
 * **It fails alone.** The rows come from the harvester, and a harvester that
 * is out empties this panel and leaves the brand above it readable.
 *
 * A spelling that differs from the label only by case or by an accent is
 * still a row here. Seeing `MAHOU` beside `Mahou` is the point of the panel:
 * it is the evidence that one key is holding two chains together.
 */
@Component({
  selector: 'lib-brand-spellings-panel',
  imports: [RokuTranslatorPipe, RecordSection],
  template: `
    <lib-record-section [heading]="'brands.record.sources' | rokuT">
      @switch (status()) {
        @case ('loading') {
          <p aria-busy="true" class="state" data-loading>
            {{ 'record.collection.loading' | rokuT }}
          </p>
        }
        @case ('error') {
          <p class="state" role="alert" data-error>
            <span class="grow">{{ 'record.collection.failed' | rokuT }}</span>
            <button (click)="load()" type="button">
              {{ 'resource.action.retry' | rokuT }}
            </button>
          </p>
        }
        @default {
          @if (groups().length === 0) {
            <p class="state quiet" data-empty>
              {{ 'brands.registered.spellings.empty' | rokuT }}
            </p>
          } @else {
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">
                      {{ 'brands.registered.spellings.chain' | rokuT }}
                    </th>
                    <th scope="col">
                      {{ 'brands.registered.spellings.spelling' | rokuT }}
                    </th>
                    <th class="figure" scope="col">
                      {{ 'brands.registered.spellings.products' | rokuT }}
                    </th>
                    <th class="figure" scope="col">
                      {{ 'brands.registered.spellings.waiting' | rokuT }}
                    </th>
                  </tr>
                </thead>
                @for (group of groups(); track group.supermarketId) {
                  <tbody>
                    @for (
                      row of group.rows;
                      track row.spelling;
                      let first = $first
                    ) {
                      <tr>
                        @if (first) {
                          <th
                            [attr.rowspan]="group.rows.length"
                            scope="rowgroup"
                          >
                            {{ names.nameOf(group.supermarketId) }}
                          </th>
                        }
                        <td class="spelling">{{ row.spelling }}</td>
                        <td class="figure">{{ count(row.productCount) }}</td>
                        <td class="figure">{{ count(row.queuedCount) }}</td>
                      </tr>
                    }
                  </tbody>
                }
              </table>
            </div>
          }
        }
      }
    </lib-record-section>
  `,
  styles: `
    :host {
      display: block;
    }

    .state {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border-block-start: 1px solid var(--admin-border);
    }

    .grow {
      flex: 1;
      min-inline-size: 0;
    }

    .quiet {
      color: var(--admin-ink-muted);
    }

    /* The table scrolls inside the panel, so the page never scrolls
       sideways. */
    .table-wrap {
      overflow-x: auto;
      border-block-start: 1px solid var(--admin-border);
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
      font-size: 0.84375rem;
    }

    th,
    td {
      padding: var(--admin-space-2) var(--admin-space-4);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
      vertical-align: top;
    }

    thead th {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    tbody th {
      font-weight: 600;
    }

    tbody:last-child tr:last-child th,
    tbody:last-child tr:last-child td {
      border-block-end: none;
    }

    /* Verbatim and monospaced, so MAHOU beside Mahou reads as two spellings
       and not as one of them styled twice. */
    /* A spelling breaks only when it cannot fit at all. On a phone the table
       then scrolls inside its panel, and a name is not cut after any letter. */
    .spelling {
      font-family: monospace;
      overflow-wrap: break-word;
    }

    .figure {
      font-variant-numeric: tabular-nums;
      text-align: end;
    }

    button {
      font-weight: 500;
      cursor: pointer;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandSpellingsPanel {
  private readonly _brands = inject(BrandsGateway);

  /** The brand, from the page. The page builds this panel again for another. */
  private readonly _brandId = inject(RECORD_CONTEXT).id;

  /** What a chain is called, resolved once per id (plan 0007, section 4). */
  readonly names = inject(ChainNames);

  readonly status = signal<'loading' | 'ready' | 'error'>('loading');

  private readonly _spellings = signal<readonly SeededSpelling[]>([]);

  /**
   * The rows, one block per chain, in the order the route answered.
   *
   * Grouped here and not trusted to arrive grouped. The route orders by chain
   * and then by count, so the rows are already adjacent. Walking them into
   * first seen order makes the row spans of the table correct whatever the
   * answer does, and costs one pass.
   */
  readonly groups = computed<readonly SpellingGroup[]>(() => {
    const groups: SpellingGroup[] = [];
    const at = new Map<string, SeededSpelling[]>();

    for (const row of this._spellings()) {
      const rows = at.get(row.supermarketId);
      if (rows === undefined) {
        const started: SeededSpelling[] = [row];
        at.set(row.supermarketId, started);
        groups.push({ supermarketId: row.supermarketId, rows: started });
        continue;
      }
      rows.push(row);
    }

    return groups;
  });

  constructor() {
    void this.load();
  }

  /** A count, through `Intl`, like every other figure in this app. */
  count(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  async load(): Promise<void> {
    this.status.set('loading');
    try {
      const rows = await this._brands.spellings(this._brandId);
      this._spellings.set(rows);
      // The names are a decoration on a decoration: a chain the reference
      // cannot name shows its id, and the panel draws either way.
      void this.names.resolve(rows.map((row) => row.supermarketId));
      this.status.set('ready');
    } catch {
      this.status.set('error');
    }
  }
}
