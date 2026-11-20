import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  isReverted,
  isTerminalRun,
  runPriceCounters,
  runProgressLine,
  type HarvestRun,
  type RunProgress,
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
 * count is always shown and the bar joins it when the run knows its own size,
 * or, while the run goes, when another completed run of the same kind gives an
 * approximate one (decision 86 of the harvester round). That bar never reaches
 * full, and once the run passes the estimate the bar goes and the count says
 * how many, as it does with no earlier run. An ended run keeps the estimate,
 * in the past tense, and no bar (owner decision 97b).
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
      <p class="count" data-progress-count>
        {{ line().key | rokuT: line().args }}
      </p>

      @if (stageLabel(); as stage) {
        <p class="stage">{{ stage }}</p>
      }
    </div>

    @let percent = progress().percent;
    @if (percent !== null) {
      <!-- Against an estimate the bar says so to a screen reader in the words
           of the line, and stops short of full (decision 86). An ended run
           has no percent against an estimate, so it gets no bar. A run at 0
           percent of a known total draws the empty track, as the header does. -->
      <div
        [attr.aria-label]="'harvest.run.progress.label' | rokuT"
        [attr.aria-valuenow]="percent"
        [attr.aria-valuetext]="
          approximate() ? (line().key | rokuT: line().args) : null
        "
        aria-valuemax="100"
        aria-valuemin="0"
        class="track"
        role="progressbar"
      >
        <div [style.inline-size.%]="percent" class="fill"></div>
      </div>
    }
    @if (approximate()) {
      <p class="unsized" data-progress-approximate>
        {{ approximateNote() | rokuT: line().args }}
      </p>
    } @else if (unsizedNote()) {
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

    @if (prices().length > 0) {
      <dl class="prices">
        @for (counter of prices(); track counter.key) {
          <div>
            <dt>{{ 'harvest.run.counter.' + counter.key | rokuT }}</dt>
            <dd>{{ counter.value }}</dd>
          </div>
        }
      </dl>
      <p class="note">{{ 'harvest.run.counter.pricesNote' | rokuT }}</p>
    }
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
    .unsized,
    .note {
      color: var(--admin-ink-muted);
    }

    .note {
      margin: 0;
      font-size: 0.8125rem;
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
  private readonly _translate = inject(RokuTranslatorService);

  readonly run = input.required<HarvestRun>();
  readonly progress = input.required<RunProgress>();

  /**
   * "N of T", "N processed", or the estimate line. "About" when the total is
   * another run's (decision 86 of the harvester round), and never a known
   * total replaced by one.
   */
  readonly line = computed(() =>
    runProgressLine(this.progress(), this._translate.locale())
  );

  /** Whether the line is drawn against another run's total. */
  readonly approximate = computed(() => this.line().approximate);

  /** The note under the estimate: present while the run goes, past after. */
  readonly approximateNote = computed(() =>
    this.progress().ended
      ? 'harvest.run.progress.approximateEnded'
      : 'harvest.run.progress.approximate'
  );

  /**
   * Whether to say that the run does not know yet how much work it has: no
   * bar, no estimate, and a run that is still going and so can still learn
   * it. An ended run has nothing left to learn, however it ended (owner
   * decisions 120b and 131b): a completed, failed, aborted or stale run with
   * no total and no estimate shows its count alone and no note at all.
   * Ended is `isTerminalRun`, the rule polling stops on.
   *
   * "No total and no estimate" is a null percent, which `runProgress` gives
   * exactly then. A percent of 0 is a known whole with nothing done yet: a
   * Mercadona walk that read "0 of 4338" must not also say it does not know
   * how much work it has.
   */
  readonly unsizedNote = computed(
    () => this.progress().percent === null && !isTerminalRun(this.run())
  );

  /**
   * The harvester's own words for what it is doing, when it says.
   *
   * `stageLabel` and not `stage`: the first is written for a person and the
   * second is a key. Neither is translated here, because both come from the
   * service and this app owns no copy of the harvester's stage list.
   *
   * The harvester never clears the phase when a run ends, so this is where a
   * finished run stops showing it (admin plan 0074, section 1b). A completed
   * run reached every phase, and a reverted run had its writes taken back, so
   * for both the last phase says nothing. A run that stopped short keeps it,
   * because it says where the run stopped.
   */
  readonly stageLabel = computed(() => {
    const run = this.run();
    return run.status === 'COMPLETED' || isReverted(run)
      ? null
      : run.stageLabel;
  });

  /**
   * The run's own counters, shown separately rather than summed.
   *
   * They keep their neutral words on every mode. Two of them used to be renamed
   * prices on a run that writes any, and that was wrong twice over: `updated` is
   * rows the ladder changed, and the harvester once added its price inserts to
   * it as well. Since backend plan 0217 it no longer does. A LIDL walk read
   * "prices written: 0" while its own source rows carried 8,154 prices. The
   * real numbers are {@link prices}, which the run reports.
   */
  readonly counters = computed(() => {
    const run = this.run();
    return [
      { key: 'created', value: run.created },
      { key: 'updated', value: run.updated },
      { key: 'unchanged', value: run.unchanged },
      { key: 'notFound', value: run.notFound },
      // What a rule dropped, which is not the same as what failed (backend plan
      // 0081, section 7). A loyalty gated leaflet offer is skipped on purpose
      // and a crawl skips nothing at all, so folding it into `failed` would
      // report a working import as broken six times over.
      { key: 'skipped', value: run.skipped },
      { key: 'failed', value: run.failed },
    ];
  });

  /**
   * What the run did with prices, in its own words.
   *
   * Two numbers and not one, because they answer two different questions and a
   * chain nobody has matched yet answers them very differently: every price the
   * source stated is kept on the source rows, and none of it reaches catalog
   * until a person binds the row to a product. Drawn only when the run reports
   * them, so a store discovery and an older run show nothing here rather than
   * three zeros.
   */
  readonly prices = computed(() => {
    const counters = runPriceCounters(this.run());
    return counters === null
      ? []
      : [
          { key: 'pricesRecorded', value: counters.recorded },
          { key: 'pricesPublished', value: counters.published },
          { key: 'pricesConfirmed', value: counters.confirmed },
        ];
  });
}
