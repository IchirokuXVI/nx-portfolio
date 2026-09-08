import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  QueueStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  HarvestNotice,
  QueueFrame,
  ReferencePicker,
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
 * whose chain catalog already knows can be imported without one. The field is a
 * reference picker over the chains rather than a uuid typed by hand (admin plan
 * 0024, section 3), with the same wiring the shops queue has, and what is
 * picked applies to the single decision **and** to a bulk import. The bulk half
 * reverses an earlier rule on the owner's instruction; see {@link askImport}.
 */
@Component({
  selector: 'lib-places-queue-page',
  imports: [
    RokuTranslatorPipe,
    ConfirmDialog,
    QueueFrame,
    HarvestNotice,
    ReferencePicker,
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

        <div class="assign">
          <span>{{ 'harvest.places.supermarketId' | rokuT }}</span>
          <lib-reference-picker
            (valueChange)="supermarketId.set($event)"
            [controlId]="'places-chain'"
            [lookup]="references"
            [nullable]="true"
            [resource]="'supermarkets'"
            [value]="supermarketId()"
          />
        </div>
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
        [bodyArgs]="{ count: bulk.count, chain: bulk.chain }"
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
  private readonly _route = inject(ActivatedRoute);

  readonly shell = inject(HarvestShell);
  readonly references = inject(ResourceReferences);

  /**
   * The chain the picker holds, or `''`.
   *
   * Reset after every decision, single or bulk: a visible leftover choice
   * quietly filing the next place under the previous chain is the mistake the
   * reset prevents, and the picker makes re-choosing cheap.
   */
  readonly supermarketId = signal('');

  /**
   * The postal code this queue was opened on, from the URL, or `''`.
   *
   * The postal code detail page links here filtered to one code (admin plan
   * 0021, section 5), which backend plan 0097 section 9 added the filter for.
   * Read once from the snapshot rather than watched: nothing on this screen
   * changes it, and arriving with a different one is a fresh navigation.
   */
  readonly postalCode =
    this._route.snapshot.queryParamMap.get('postalCode') ?? '';
  private readonly _country =
    this._route.snapshot.queryParamMap.get('country') ?? '';

  /** The bulk action waiting for an answer, or null when none is. */
  readonly pending = signal<PendingPlacesBulk | null>(null);
  /** What the last bulk run did, by name. Cleared when another one starts. */
  readonly report = signal<QueueReport | null>(null);
  readonly progressKey = signal('harvest.queue.bulk.progress');

  readonly queue = new QueueStore<Place>(
    async (cursor) => {
      try {
        // Only the undecided ones. An imported or rejected place is not a
        // question any more, and a queue that offered it again would be asking
        // an operator to answer their own earlier answer.
        const page = await this._service.listPlaces({
          status: 'NEW',
          cursor,
          country: this._country === '' ? undefined : this._country,
          postalCode: this.postalCode === '' ? undefined : this.postalCode,
        });
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
    // The picker resets after each decision, as the text input it replaced
    // did, so the next place is never quietly filed under the previous chain.
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
   * Import every selected place, under the picked chain when one is picked.
   *
   * The bulk path used to send an empty body always, because one operator's
   * typed answer applied to rows they did not look at. The owner weighed that
   * and the chain applies now (admin plan 0024, section 3.2); what makes it
   * acceptable is the control's nature. A typed uuid was opaque, where the
   * picker shows the chosen chain **by name**, and the confirm dialog seals it:
   * with a chain picked, the body names it beside the count, so the operator
   * confirms "import 12 places under Mercadona" and not just "import 12
   * places". With none picked the body and the behaviour are exactly the old
   * ones: catalog resolves each place from its brand, and a place whose brand
   * it cannot resolve is refused and named in the report.
   */
  async askImport(): Promise<void> {
    const supermarketId = this.supermarketId().trim();
    const body = supermarketId === '' ? {} : { supermarketId };
    // The name for the dialog's sentence. The id, when the lookup answered
    // nothing: a blank would ask the operator to confirm filing under nothing
    // in particular.
    const chain =
      supermarketId === ''
        ? ''
        : ((await this.references.resolve('supermarkets', supermarketId))
            ?.title ?? supermarketId);

    this.pending.set({
      headingKey: 'harvest.places.bulk.importConfirm.heading',
      bodyKey:
        supermarketId === ''
          ? 'harvest.places.bulk.importConfirm.body'
          : 'harvest.places.bulk.importConfirm.bodyChained',
      confirmKey: 'harvest.places.bulk.import',
      progressKey: 'harvest.places.bulk.importing',
      count: this.queue.selectedCount(),
      leftAlone: 0,
      tone: 'primary',
      chain,
      run: () =>
        this._run({
          act: async (place) => {
            await this._service.importPlace(place.id, body);
            return null;
          },
          nameOf: (place) => place.name ?? place.externalRef,
          // The picker resets after a bulk run for the same reason it resets
          // after a single decision.
        }).then(() => this.supermarketId.set('')),
    });
  }

  askReject(): void {
    this.pending.set({
      chain: '',
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

/**
 * This screen's pending bulk, which also carries the chain by name.
 *
 * `''` for the actions that file under none, so the dialog's arguments always
 * have the field and the chained body key is the only reader of it.
 */
interface PendingPlacesBulk extends PendingBulk {
  readonly chain: string;
}
