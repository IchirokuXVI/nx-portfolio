import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  HarvestRun,
  RunProgress,
} from '@portfolio/luna-shopper-admin/models';

/**
 * How far a run has got (plan 0006, section 2).
 *
 * Built for something **watched intermittently**. A catalog discovery is
 * eighteen minutes and 4,383 requests, so the common case is an operator
 * arriving in the middle, and everything here is drawn from the run as it stands
 * rather than from anything accumulated since the screen opened.
 *
 * The bar is absent until there is a denominator. `totalPlanned` is null until
 * the category walk has finished counting, which is minutes in, and a bar moving
 * against a number nobody chose says less than the count alone does. So the
 * count is always shown and the bar joins it when the run knows its own size.
 *
 * The counters are the run's own, and they are shown separately rather than
 * summed. `notFound` is not a failure: a 404 from a detail call means the
 * product is not stocked at that store, which is a value. Folding it into
 * `failed` would make a healthy run look broken in the hundreds.
 */
@Component({
  selector: 'lib-run-progress',
  imports: [RokuTranslatorPipe],
  template: `
    <div class="head">
      <p class="count">
        @if (progress().total !== null) {
          {{
            'harvest.run.progress.of'
              | rokuT
                : { processed: progress().processed, total: progress().total }
          }}
        } @else {
          {{
            'harvest.run.progress.processed'
              | rokuT: { processed: progress().processed }
          }}
        }
      </p>

      @if (stageLabel(); as stage) {
        <p class="stage">{{ stage }}</p>
      }
    </div>

    @if (progress().percent; as percent) {
      <div
        [attr.aria-label]="'harvest.run.progress.label' | rokuT"
        [attr.aria-valuenow]="percent"
        aria-valuemax="100"
        aria-valuemin="0"
        class="track"
        role="progressbar"
      >
        <div [style.inline-size.%]="percent" class="fill"></div>
      </div>
    } @else {
      <p class="unsized">{{ 'harvest.run.progress.unsized' | rokuT }}</p>
    }

    <dl>
      @for (counter of counters(); track counter.key) {
        <div>
          <dt>{{ 'harvest.run.counter.' + counter.key | rokuT }}</dt>
          <dd>{{ counter.value }}</dd>
        </div>
      }
    </dl>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
      justify-content: space-between;
    }

    .count {
      font-size: 1.125rem;
      font-weight: 700;
    }

    .stage,
    .unsized {
      color: var(--admin-ink-muted);
    }

    .track {
      overflow: hidden;
      block-size: 0.5rem;
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
    }

    .fill {
      block-size: 100%;
      background: var(--admin-accent);
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
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunProgressView {
  readonly run = input.required<HarvestRun>();
  readonly progress = input.required<RunProgress>();

  /**
   * The harvester's own words for what it is doing, when it says.
   *
   * `stageLabel` and not `stage`: the first is written for a person and the
   * second is a key. Neither is translated here, because both come from the
   * service and this app owns no copy of the harvester's stage list.
   */
  readonly stageLabel = computed(() => this.run().stageLabel);

  readonly counters = computed(() => {
    const run = this.run();
    return [
      { key: 'created', value: run.created },
      { key: 'updated', value: run.updated },
      { key: 'unchanged', value: run.unchanged },
      { key: 'notFound', value: run.notFound },
      { key: 'failed', value: run.failed },
    ];
  });
}
