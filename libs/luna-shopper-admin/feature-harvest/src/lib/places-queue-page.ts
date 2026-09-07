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
import {
  ConfirmDialog,
  HarvestNotice,
  QueueFrame,
  type QueueReport,
} from '@portfolio/luna-shopper-admin/ui';
import { HarvestShell } from './harvest-shell';
import { nearby, placeLines } from './place-view';
import {
  runQueueBulk,
  type PendingBulk,
  type QueueBulkAct,
} from './queue-bulk';

type Place = Wire.HarvestDiscoveredPlaceView;

/**
 * Discovered places, one decision at a time and as a list (plan 0006, section 5;
 * plan 0020).
 *
 * Locations found in OpenStreetMap are **offered rather than silently created**.
 * A place is offered when it matched neither the provider's own reference nor
 * the same brand within fifty metres, which is exactly the case a person has to
 * settle: the two shops fifty one metres apart are either one shop mapped twice
 * or two shops on the same street.
 *
 * So this screen shows why each one is being asked about, and it shows the near
 * duplicates **beside** the current place rather than behind a navigation. A
 * queue that reveals one row at a time cannot answer the only question it is
 * asking, because the evidence is the other row.
 *
 * **The list view is a better answer to that question than the review view is**,
 * which is why this is the interesting one of the three screens plan 0020
 * touches: the near duplicates are rows, and rows read best beside each other.
 * The near duplicates panel stays in review for the cases where it is not, and
 * the screen still opens in review.
 *
 * Importing takes a supermarket id, and the field is offered rather than
 * required: `ImportDiscoveredPlaceDto` has both properties optional, so a place
 * whose chain catalog already knows can be imported without one. A bulk import
 * sends none at all, because a chain typed for one place is not an answer about
 * the other hundred and ninety nine.
 */
@Component({
  selector: 'lib-places-queue-page',
  imports: [
    FormsModule,
    RokuTranslatorPipe,
    ConfirmDialog,
    QueueFrame,
    HarvestNotice,
  ],
  template: `
    <lib-queue-frame
      (clearSelection)="queue.clearSelection()"
      (confirm)="importPlace()"
      (loadMore)="queue.loadMore()"
      (openRow)="open($event)"
      (pickRow)="queue.toggle($event)"
      (reject)="reject()"
      (selectAll)="queue.selectLoaded()"
      (skip)="queue.skip()"
      (stop)="queue.stopBulk()"
      [busy]="queue.busy()"
      [canLoadMore]="queue.canLoadMore()"
      [decided]="queue.decided()"
      [empty]="queue.empty()"
      [errorKey]="errorKey()"
      [failed]="queue.failed()"
      [loading]="queue.loading()"
      [loadingMore]="queue.loadingMore()"
      [progress]="queue.bulk()"
      [progressKey]="progressKey()"
      [remaining]="queue.items().length"
      [report]="report()"
      [rows]="queue.items()"
      [selected]="queue.selected()"
      [selectedCount]="queue.selectedCount()"
      confirmKey="harvest.places.import"
      defaultView="review"
      emptyKey="harvest.places.empty"
      rejectKey="harvest.places.reject"
      titleKey="harvest.places.heading"
    >
      <lib-harvest-notice
        (retry)="queue.load()"
        [absent]="shell.absent()"
        queueFailure
      />

      @if (queue.current(); as place) {
        <h2>{{ place.name ?? place.externalRef }}</h2>
        <p class="why">{{ 'harvest.places.why' | rokuT }}</p>

        <dl>
          @for (line of lines(); track line.key) {
            @if (line.value !== '') {
              <div>
                <dt>{{ 'harvest.places.field.' + line.key | rokuT }}</dt>
                <dd>{{ line.value }}</dd>
              </div>
            }
          }
        </dl>

        <label class="assign">
          <span>{{ 'harvest.places.supermarketId' | rokuT }}</span>
          <input [(ngModel)]="supermarketId" name="supermarketId" type="text" />
        </label>
      }

      <section class="near" queueContext>
        <h3>{{ 'harvest.places.near.heading' | rokuT }}</h3>

        @if (near().length === 0) {
          <p class="none">{{ 'harvest.places.near.none' | rokuT }}</p>
        } @else {
          <ul>
            @for (other of near(); track other.id) {
              <li>
                <strong>{{ other.name ?? other.externalRef }}</strong>
                <span>{{ other.street }}</span>
                <span>{{ other.city }}</span>
                <span class="ref">{{ other.externalRef }}</span>
              </li>
            }
          </ul>
        }
      </section>

      <!-- Section 2's columns for this screen: the name, the street, the city
           and the provider's own reference. The same facts the review view
           leads with, because a list whose columns are a different four is a
           second thing to learn. -->
      <ng-template #queueRow let-row>
        <strong>{{ row.name ?? row.externalRef }}</strong>
        <span>{{ row.street }}</span>
        <span>{{ row.city }}</span>
        <span class="ref">{{ row.externalRef }}</span>
      </ng-template>

      <div class="bulk" queueBulk>
        <button
          (click)="askImport()"
          [disabled]="nothingPicked()"
          type="button"
        >
          {{ 'harvest.places.bulk.import' | rokuT }}
        </button>
        <button
          (click)="askReject()"
          [disabled]="nothingPicked()"
          class="danger"
          type="button"
        >
          {{ 'harvest.places.bulk.reject' | rokuT }}
        </button>
      </div>
    </lib-queue-frame>

    @if (pending(); as bulk) {
      <lib-confirm-dialog
        (confirm)="go(bulk)"
        (dismiss)="pending.set(null)"
        [bodyArgs]="{ count: bulk.count }"
        [bodyKey]="bulk.bodyKey"
        [busy]="queue.busy()"
        [confirmKey]="bulk.confirmKey"
        [headingKey]="bulk.headingKey"
        [tone]="bulk.tone"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    h2 {
      font-size: 1.25rem;
      font-weight: 700;
    }

    h3 {
      font-size: 0.875rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .why {
      margin-block: var(--admin-space-2);
      color: var(--admin-ink-muted);
    }

    dl {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
      margin-block-end: var(--admin-space-3);
    }

    dt {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .assign {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .assign span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .near {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    .near ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .near li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      padding: var(--admin-space-3);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .none,
    .ref {
      color: var(--admin-ink-muted);
    }

    .bulk {
      display: flex;
      flex: 2;
      gap: var(--admin-space-3);
    }

    .bulk button {
      flex: 1;
      min-block-size: 3rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      font-size: 1rem;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .bulk .danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger-on-wash);
    }

    .bulk button:disabled {
      opacity: 0.55;
      cursor: default;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlacesQueuePage {
  private readonly _service = inject(HARVEST_SERVICE);

  readonly shell = inject(HarvestShell);

  readonly supermarketId = signal('');

  /** The bulk action waiting for an answer, or null when none is. */
  readonly pending = signal<PendingBulk | null>(null);
  /** What the last bulk run did, by name. Cleared when another one starts. */
  readonly report = signal<QueueReport | null>(null);
  readonly progressKey = signal('harvest.queue.bulk.progress');

  readonly queue = new QueueStore<Place>(
    async (cursor) => {
      try {
        // Only the undecided ones. An imported or rejected place is not a
        // question any more, and a queue that offered it again would be asking
        // an operator to answer their own earlier answer.
        const page = await this._service.listPlaces({ status: 'NEW', cursor });
        this.shell.observeReachable();
        return page;
      } catch (error) {
        this.shell.observeFailure();
        throw error;
      }
    },
    (place) => place.id
  );

  readonly errorKey = computed(() => gatewayErrorKey(this.queue.error()));

  readonly nothingPicked = computed(() => this.queue.selectedCount() === 0);

  readonly lines = computed(() => {
    const place = this.queue.current();
    return place === null ? [] : placeLines(place);
  });

  /**
   * The places this one might be a duplicate of.
   *
   * Same brand key and within a short distance, which is the rule that decided
   * to ask in the first place, applied to what is still in the queue. Grouping
   * is on `brand:wikidata` and never on the name, because `Dia` and `Maxi Dia`
   * share one QID while name matching would split exactly the pair somebody
   * needs to see together.
   */
  readonly near = computed(() => {
    const place = this.queue.current();
    return place === null ? [] : nearby(place, this.queue.upcoming());
  });

  constructor() {
    void this.queue.load();
  }

  importPlace(): void {
    const id = this.supermarketId().trim();
    void this.queue
      .decide((place) =>
        this._service.importPlace(
          place.id,
          id === '' ? {} : { supermarketId: id }
        )
      )
      .then(() => this.supermarketId.set(''));
  }

  reject(): void {
    void this.queue.decide((place) => this._service.rejectPlace(place.id));
  }

  /** A row the operator wants to look at properly, rather than tick. */
  open(id: string): void {
    this.queue.focus(id);
  }

  /**
   * Import every selected place, with no chain named.
   *
   * The empty body is what section 4 asks for: catalog resolves the chain from
   * the place's own brand, and a place whose brand it cannot resolve is refused
   * and named in the report. Sending the chain typed for one place would be one
   * operator's answer applied to rows they did not look at.
   */
  askImport(): void {
    this.pending.set({
      headingKey: 'harvest.places.bulk.importConfirm.heading',
      bodyKey: 'harvest.places.bulk.importConfirm.body',
      confirmKey: 'harvest.places.bulk.import',
      progressKey: 'harvest.places.bulk.importing',
      count: this.queue.selectedCount(),
      leftAlone: 0,
      tone: 'primary',
      run: () =>
        this._run({
          act: async (place) => {
            await this._service.importPlace(place.id, {});
            return null;
          },
          nameOf: (place) => place.name ?? place.externalRef,
        }),
    });
  }

  askReject(): void {
    this.pending.set({
      headingKey: 'harvest.places.bulk.rejectConfirm.heading',
      bodyKey: 'harvest.places.bulk.rejectConfirm.body',
      confirmKey: 'harvest.places.bulk.reject',
      progressKey: 'harvest.places.bulk.rejecting',
      count: this.queue.selectedCount(),
      leftAlone: 0,
      tone: 'danger',
      run: () =>
        this._run({
          act: async (place) => {
            await this._service.rejectPlace(place.id);
            return null;
          },
          nameOf: (place) => place.name ?? place.externalRef,
        }),
    });
  }

  /** Go through with the confirmed bulk action. */
  go(bulk: PendingBulk): void {
    this.pending.set(null);
    this.progressKey.set(bulk.progressKey);
    void bulk.run();
  }

  private async _run(bulk: QueueBulkAct<Place>): Promise<void> {
    this.report.set(null);
    this.report.set(await runQueueBulk(this.queue, bulk));
    this.progressKey.set('harvest.queue.bulk.progress');
  }
}
