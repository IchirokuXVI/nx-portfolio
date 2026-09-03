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
import { nearby, placeLines } from './place-view';

/**
 * Discovered places, one decision at a time (plan 0006, section 5).
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
 * Importing takes a supermarket id, and the field is offered rather than
 * required: `ImportDiscoveredPlaceDto` has both properties optional, so a place
 * whose chain catalog already knows can be imported without one.
 */
@Component({
  selector: 'lib-places-queue-page',
  imports: [FormsModule, RokuTranslatorPipe, QueueFrame, HarvestNotice],
  template: `
    <lib-queue-frame
      (confirm)="importPlace()"
      (reject)="reject()"
      (skip)="queue.skip()"
      [busy]="queue.busy()"
      [decided]="queue.decided()"
      [empty]="queue.empty()"
      [errorKey]="errorKey()"
      [failed]="queue.failed()"
      [loading]="queue.loading()"
      [remaining]="queue.items().length"
      confirmKey="harvest.places.import"
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
    </lib-queue-frame>
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlacesQueuePage {
  private readonly _service = inject(HARVEST_SERVICE);

  readonly shell = inject(HarvestShell);

  readonly supermarketId = signal('');

  readonly queue = new QueueStore<Wire.HarvestDiscoveredPlaceView>(
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
}
