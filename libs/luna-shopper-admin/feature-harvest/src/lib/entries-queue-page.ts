import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  QueueStore,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { HarvestNotice, QueueFrame } from '@portfolio/luna-shopper-admin/ui';
import { HarvestShell } from './harvest-shell';

/** The categories `CreateItemFromEntryDto` accepts. */
const CATEGORIES: readonly Wire.EnumsItemCategory[] = [
  'PRODUCE',
  'DAIRY',
  'BAKERY',
  'MEAT',
  'SEAFOOD',
  'FROZEN',
  'BEVERAGES',
  'SNACKS',
  'PANTRY',
  'HOUSEHOLD',
  'PERSONAL_CARE',
  'OTHER',
];

/**
 * Source catalog entries, promoted to catalog items one at a time (plan 0006,
 * section 5).
 *
 * A discovery run creates nothing in the catalog. It records what it found at a
 * storefront, and import is a second, explicit step, which is why four thousand
 * products arrive as a queue rather than as four thousand rows nobody chose.
 *
 * **Two things the plan asks for are not here, because the routes are not.**
 * Section 1 lists `GET entries/groups`, `POST entries/:id/import` and `POST
 * entries/:id/reject`, and section 5 says the screen uses the grouping. Those
 * three belong to `places`: the entries controller exposes `GET` and `POST
 * :entryId/item` and nothing else. So there is no grouped bulk import and no
 * reject, and this queue offers a search, a category, and one entry at a time.
 * A screen that grouped them locally would be grouping one page rather than the
 * four thousand, which is a worse answer than not offering it.
 *
 * The chain is a path segment rather than a filter, so it has to be chosen
 * before there is a queue at all. That is why this screen opens on a chooser
 * rather than on an empty list.
 */
@Component({
  selector: 'lib-entries-queue-page',
  imports: [FormsModule, RokuTranslatorPipe, QueueFrame, HarvestNotice],
  template: `
    @if (chosen() === '') {
      <section class="choose">
        <h1>{{ 'harvest.entries.heading' | rokuT }}</h1>
        <p>{{ 'harvest.entries.choose.body' | rokuT }}</p>

        <label>
          <span>{{ 'harvest.entries.choose.supermarketId' | rokuT }}</span>
          <input [(ngModel)]="supermarketId" name="supermarketId" type="text" />
        </label>

        <button
          (click)="open()"
          [disabled]="supermarketId().trim() === ''"
          class="primary"
          type="button"
        >
          {{ 'harvest.entries.choose.submit' | rokuT }}
        </button>
      </section>
    } @else {
      <lib-queue-frame
        (confirm)="importEntry()"
        (skip)="queue!.skip()"
        [busy]="queue!.busy()"
        [decided]="queue!.decided()"
        [empty]="queue!.empty()"
        [errorKey]="errorKey()"
        [failed]="queue!.failed()"
        [loading]="queue!.loading()"
        [remaining]="queue!.items().length"
        confirmKey="harvest.entries.import"
        emptyKey="harvest.entries.empty"
        titleKey="harvest.entries.heading"
      >
        <lib-harvest-notice
          (retry)="queue!.load()"
          [absent]="shell.absent()"
          queueFailure
        />

        @if (queue!.current(); as entry) {
          <h2>{{ entry.name }}</h2>

          <dl>
            @for (line of lines(); track line.key) {
              @if (line.value !== '') {
                <div>
                  <dt>{{ 'harvest.entries.field.' + line.key | rokuT }}</dt>
                  <dd>{{ line.value }}</dd>
                </div>
              }
            }
          </dl>
        }

        <section class="category" queueContext>
          <label>
            <span>{{ 'harvest.entries.category' | rokuT }}</span>
            <select [(ngModel)]="category" name="category">
              @for (option of categories; track option) {
                <option [value]="option">
                  {{ 'harvest.category.' + option | rokuT }}
                </option>
              }
            </select>
          </label>
          <p class="help">{{ 'harvest.entries.categoryHelp' | rokuT }}</p>
        </section>
      </lib-queue-frame>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    .choose {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }

    h2 {
      margin-block-end: var(--admin-space-3);
      font-size: 1.25rem;
      font-weight: 700;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    label span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .primary {
      min-block-size: 2.75rem;
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
    }

    dl {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
    }

    dt {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .category {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    .help {
      color: var(--admin-ink-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntriesQueuePage {
  private readonly _service = inject(HARVEST_SERVICE);

  readonly shell = inject(HarvestShell);

  readonly categories = CATEGORIES;

  readonly supermarketId = signal('');
  /** The chain the queue is for. Empty until one is chosen. */
  readonly chosen = signal('');
  readonly category = signal<Wire.EnumsItemCategory>('OTHER');

  /** Built when a chain is chosen, because the path needs one to exist. */
  queue: QueueStore<Wire.HarvestSourceCatalogEntryView> | null = null;

  readonly errorKey = computed(() =>
    gatewayErrorKey(this.queue?.error() ?? null)
  );

  readonly lines = computed(() => {
    const entry = this.queue?.current() ?? null;
    if (entry === null) {
      return [];
    }

    return [
      { key: 'brand', value: entry.brand ?? '' },
      { key: 'externalId', value: entry.externalId },
      { key: 'ean', value: entry.ean ?? '' },
      { key: 'sizeFormat', value: entry.sizeFormat ?? '' },
      { key: 'price', value: money(entry.price) },
      { key: 'unitPrice', value: unitPrice(entry) },
      { key: 'categoryPath', value: entry.categoryPath.join(' / ') },
      { key: 'url', value: entry.url ?? '' },
    ];
  });

  open(): void {
    const id = this.supermarketId().trim();
    if (id === '') {
      return;
    }

    this.chosen.set(id);
    this.queue = new QueueStore<Wire.HarvestSourceCatalogEntryView>(
      async (cursor) => {
        try {
          const page = await this._service.listEntries({
            supermarketId: id,
            // Only what has no catalog item yet. An entry already promoted is
            // not a question, and offering it again would create a second item
            // for one product.
            unmatchedOnly: true,
            cursor,
          });
          this.shell.observeReachable();
          return page;
        } catch (error) {
          this.shell.observeFailure();
          throw error;
        }
      },
      (entry) => entry.id
    );

    void this.queue.load();
  }

  importEntry(): void {
    const queue = this.queue;
    if (queue === null) {
      return;
    }

    void queue.decide((entry) =>
      this._service.createItemFromEntry(entry.supermarketId, entry.id, {
        category: this.category(),
      })
    );
  }
}

/**
 * A price, or nothing.
 *
 * No currency symbol, and that is not laziness. These are the storefront's own
 * numbers in the storefront's own currency, this app is told which currency by
 * nothing, and a euro sign this screen invented would be a claim it cannot
 * support.
 */
function money(value: number | null): string {
  return value === null ? '' : value.toFixed(2);
}

function unitPrice(entry: Wire.HarvestSourceCatalogEntryView): string {
  if (entry.unitPrice === null) {
    return '';
  }

  const label = entry.unitPriceLabel ?? '';
  return label === ''
    ? entry.unitPrice.toFixed(2)
    : `${entry.unitPrice.toFixed(2)} ${label}`;
}
