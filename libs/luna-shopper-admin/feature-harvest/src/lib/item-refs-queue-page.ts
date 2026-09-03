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
import { formatInstant } from './format-instant';
import { HarvestShell } from './harvest-shell';
import { confidencePercent, refLines, refProblem } from './ref-view';

/**
 * Item source refs, one decision at a time (plan 0006, section 5).
 *
 * A ref is the mapping from one of our items to one of a chain's products, and
 * `GET item-refs/unresolved` is the queue. A `CANDIDATE` came from a fuzzy name
 * match and **never writes a price** until it is confirmed here, which is what
 * makes this queue worth a person's time rather than a cron job.
 *
 * The third action is the one that makes this different from the other two
 * queues. Confirm and reject are answers to "is this the right product"; the
 * correction is the answer to "no, it is that one", and `PUT item-refs` is the
 * route for it. Without the correction an operator whose match is wrong can only
 * reject, which leaves the item with no price at all rather than the right one.
 *
 * A ref whose product has stopped appearing is drawn differently, because
 * confirming it is almost never the right answer. That state is derived rather
 * than read: see `refProblem`, and the note there about `GONE` not existing.
 */
@Component({
  selector: 'lib-item-refs-queue-page',
  imports: [FormsModule, RokuTranslatorPipe, QueueFrame, HarvestNotice],
  template: `
    <lib-queue-frame
      (confirm)="confirm()"
      (reject)="reject()"
      (skip)="queue.skip()"
      [busy]="queue.busy()"
      [decided]="queue.decided()"
      [empty]="queue.empty()"
      [errorKey]="errorKey()"
      [failed]="queue.failed()"
      [loading]="queue.loading()"
      [remaining]="queue.items().length"
      confirmKey="harvest.refs.confirm"
      emptyKey="harvest.refs.empty"
      rejectKey="harvest.refs.reject"
      titleKey="harvest.refs.heading"
    >
      <lib-harvest-notice
        (retry)="queue.load()"
        [absent]="shell.absent()"
        queueFailure
      />

      @if (queue.current(); as ref) {
        <p [class]="problem()" class="problem">
          {{ 'harvest.refs.problem.' + problem() | rokuT }}
        </p>

        <p class="confidence">
          {{ 'harvest.refs.confidence' | rokuT: { percent: percent() } }}
        </p>

        <dl>
          @for (line of lines(); track line.key) {
            @if (line.value !== '') {
              <div>
                <dt>{{ 'harvest.refs.field.' + line.key | rokuT }}</dt>
                <dd>{{ line.value }}</dd>
              </div>
            }
          }
          <div>
            <dt>{{ 'harvest.refs.field.lastSeenAt' | rokuT }}</dt>
            <dd>{{ lastSeen() }}</dd>
          </div>
        </dl>
      }

      <section class="correct" queueContext>
        <h3>{{ 'harvest.refs.correct.heading' | rokuT }}</h3>
        <p class="help">{{ 'harvest.refs.correct.help' | rokuT }}</p>

        <div class="row">
          <label>
            <span>{{ 'harvest.refs.correct.externalId' | rokuT }}</span>
            <input [(ngModel)]="externalId" name="externalId" type="text" />
          </label>
          <button
            (click)="correct()"
            [disabled]="queue.busy() || externalId().trim() === ''"
            type="button"
          >
            {{ 'harvest.refs.correct.submit' | rokuT }}
          </button>
        </div>
      </section>
    </lib-queue-frame>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    h3 {
      font-size: 0.875rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .problem {
      display: inline-block;
      margin-block-end: var(--admin-space-2);
      padding: var(--admin-space-1) var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      font-size: 0.75rem;
      text-transform: uppercase;
    }

    .problem.stale {
      background: var(--admin-danger-wash);
      color: var(--admin-danger-ink);
    }

    .confidence {
      margin-block-end: var(--admin-space-3);
      font-variant-numeric: tabular-nums;
      font-weight: 700;
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

    dd {
      overflow-wrap: anywhere;
    }

    .correct {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    .help {
      color: var(--admin-ink-muted);
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: flex-end;
    }

    label {
      display: flex;
      flex: 1 1 12rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    label span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemRefsQueuePage {
  private readonly _service = inject(HARVEST_SERVICE);

  readonly shell = inject(HarvestShell);

  readonly externalId = signal('');

  readonly queue = new QueueStore<Wire.HarvestItemSourceRefView>(
    async (cursor) => {
      try {
        const page = await this._service.listUnresolvedItemRefs({ cursor });
        this.shell.observeReachable();
        return page;
      } catch (error) {
        this.shell.observeFailure();
        throw error;
      }
    },
    (ref) => ref.id
  );

  readonly errorKey = computed(() => gatewayErrorKey(this.queue.error()));

  readonly lines = computed(() => {
    const ref = this.queue.current();
    return ref === null ? [] : refLines(ref);
  });

  readonly problem = computed(() => {
    const ref = this.queue.current();
    return ref === null ? 'unmatched' : refProblem(ref);
  });

  readonly percent = computed(() => {
    const ref = this.queue.current();
    return ref === null ? 0 : confidencePercent(ref);
  });

  readonly lastSeen = computed(() => {
    const ref = this.queue.current();
    return ref === null ? '' : formatInstant(ref.lastSeenAt);
  });

  constructor() {
    void this.queue.load();
  }

  confirm(): void {
    void this.queue.decide((ref) => this._service.confirmItemRef(ref.id));
  }

  reject(): void {
    void this.queue.decide((ref) => this._service.rejectItemRef(ref.id));
  }

  /**
   * Point the ref at a different product.
   *
   * `PUT item-refs` is keyed on the item and the chain rather than on the ref's
   * own id, so this replaces the mapping rather than editing a row. It counts as
   * a decision: the ref leaves the queue, because the question it was asking has
   * been answered even though the answer was neither yes nor no.
   */
  correct(): void {
    const externalId = this.externalId().trim();
    if (externalId === '') {
      return;
    }

    void this.queue
      .decide((ref) =>
        this._service.setManualItemRef({
          itemId: ref.itemId,
          supermarketId: ref.supermarketId,
          externalId,
        })
      )
      .then(() => this.externalId.set(''));
  }
}
