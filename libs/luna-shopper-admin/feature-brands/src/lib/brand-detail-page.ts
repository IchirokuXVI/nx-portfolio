import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { GatewayError } from '@portfolio/luna-shopper-admin/data-access';
import { ChainNames } from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  gatewayErrorKey,
  RESOURCE_ID_PARAM,
  ResourceFormPage,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { SeededSpelling } from './brand-seed';
import { BrandsGateway } from './brands-gateway';

/** One chain, and every way it spells this brand. */
interface SpellingGroup {
  readonly supermarketId: string;
  readonly rows: readonly SeededSpelling[];
}

/**
 * One brand: the form that edits it, and how the chains spell it (admin plan
 * 0027, section 2.3).
 *
 * **The brand half is the generic detail view, drawn by the generic component.**
 * There is nothing peculiar about editing a brand, so `ResourceFormPage` is
 * embedded rather than reimplemented: it reads the same descriptor and the same
 * mode off this route, draws the fields it cannot change beside the ones it can,
 * and navigates back to the list on save. What this screen adds is the block
 * underneath, which is the one thing a descriptor cannot describe.
 *
 * The spellings **fail on their own**. A harvester outage empties that block and
 * leaves the form above it usable, because the two are different questions and
 * only one of them is out.
 *
 * A spelling that differs from the label only by case or by an accent is still a
 * row here. Seeing `MAHOU` beside `Mahou` is the point of the panel: it is the
 * evidence that one key is holding two chains together.
 */
@Component({
  selector: 'lib-brand-detail-page',
  imports: [ResourceFormPage, RokuTranslatorPipe],
  template: `
    <lib-resource-form-page />

    <section class="panel">
      <h2>{{ 'brands.registered.spellings.heading' | rokuT }}</h2>
      <p class="explains">{{ 'brands.registered.spellings.says' | rokuT }}</p>

      @if (loading()) {
        <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
      } @else if (errorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      } @else if (groups().length === 0) {
        <p class="state">{{ 'brands.registered.spellings.empty' | rokuT }}</p>
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
                      <th [attr.rowspan]="group.rows.length" scope="rowgroup">
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
    </section>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .explains,
    .state {
      color: var(--admin-ink-muted);
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .failure {
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .table-wrap {
      overflow-x: auto;
      inline-size: 100%;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: var(--admin-space-3);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
      vertical-align: top;
    }

    thead th {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
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
       rather than as one of them styled twice. */
    .spelling {
      font-family: monospace;
      overflow-wrap: anywhere;
    }

    .figure {
      font-variant-numeric: tabular-nums;
      text-align: end;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandDetailPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _brands = inject(BrandsGateway);

  /** What a chain is called, resolved once per id (plan 0007, section 4). */
  readonly names = inject(ChainNames);

  /** The brand, from the URL. The same parameter the generic form reads. */
  readonly brandId = this._route.snapshot.paramMap.get(RESOURCE_ID_PARAM) ?? '';

  readonly loading = signal(true);
  readonly error = signal<GatewayError | null>(null);
  readonly errorKey = computed(() => gatewayErrorKey(this.error()));

  private readonly _spellings = signal<readonly SeededSpelling[]>([]);

  /**
   * The rows, one block per chain, in the order the route answered.
   *
   * Grouped here rather than trusted to arrive grouped. The route orders by
   * chain and then by count, so the rows are already adjacent; walking them into
   * first seen order makes the table's row spans correct whatever the answer
   * does, and costs one pass.
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
    void this._load();
  }

  /** A count, through `Intl`, like every other figure in this app. */
  count(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  private async _load(): Promise<void> {
    try {
      const rows = await this._brands.spellings(this.brandId);
      this._spellings.set(rows);
      // The names are a decoration on a decoration: a chain the reference cannot
      // name shows its id, and the block draws either way.
      void this.names.resolve(rows.map((row) => row.supermarketId));
    } catch (error) {
      this.error.set(error as GatewayError);
    } finally {
      this.loading.set(false);
    }
  }
}
