import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import type { ChartDelta } from './chart-types';

/** The box the sparkline is drawn in, stretched to whatever width it gets. */
const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 40;

/**
 * A headline number, which is the form a single figure takes (plan 0015, 3.3).
 *
 * It is not a chart and it is here because it is the other half of the same
 * decision: a dashboard that drew one count as a line of thirty identical points
 * would be drawing a chart because it has charts.
 *
 * The delta carries no colour, and that is the rule rather than a shortfall. An
 * increase in failed sign ins is not good and an increase in users is not bad,
 * and this component does not know which of the two it is holding. A green
 * number would be a claim it cannot support.
 */
@Component({
  selector: 'lib-stat-tile',
  imports: [NgTemplateOutlet, RouterLink],
  template: `
    @if (target(); as commands) {
      <a [class]="'tile ' + tone()" [routerLink]="commands">
        <ng-container [ngTemplateOutlet]="body" />
      </a>
    } @else {
      <div [class]="'tile ' + tone()">
        <ng-container [ngTemplateOutlet]="body" />
      </div>
    }

    <ng-template #body>
      <p class="label">
        {{ label() }}
        @if (target()) {
          <span aria-hidden="true" class="chevron">›</span>
        }
      </p>

      <p class="value">{{ valueText() }}</p>

      @if (delta(); as change) {
        <p class="delta">
          <span class="amount">{{ deltaText() }}</span>
          <span class="caption">{{ change.caption }}</span>
        </p>
      }

      @if (spark(); as path) {
        <svg
          [attr.height]="sparkHeight"
          [attr.viewBox]="'0 0 ' + sparkWidth + ' ' + sparkHeight"
          aria-hidden="true"
          class="spark"
          preserveAspectRatio="none"
        >
          <path [attr.d]="path" vector-effect="non-scaling-stroke" />
        </svg>
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }

    .tile {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      block-size: 100%;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      color: inherit;
      text-decoration: none;
    }

    .tile.attention {
      border-color: var(--admin-status-attention);
      background: var(--admin-status-attention-wash);
    }

    a.tile:hover,
    a.tile:focus-visible {
      border-color: var(--admin-ink-muted);
    }

    .label {
      display: flex;
      gap: var(--admin-space-2);
      align-items: baseline;
      justify-content: space-between;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .chevron {
      font-size: 1rem;
      line-height: 1;
    }

    .value {
      font-size: 2rem;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      line-height: 1.1;
    }

    .delta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: baseline;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .amount {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }

    .spark {
      display: block;
      inline-size: 100%;
      margin-block-start: var(--admin-space-2);
    }

    .spark path {
      fill: none;
      stroke: var(--admin-chart-1);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatTile {
  private readonly _translate = inject(RokuTranslatorService);

  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly delta = input<ChartDelta | undefined>(undefined);
  readonly trend = input<readonly number[] | undefined>(undefined);
  /** A `routerLink` array. With one the whole tile opens; without one it does not. */
  readonly link = input<readonly unknown[] | undefined>(undefined);
  readonly tone = input<'quiet' | 'attention'>('quiet');

  protected readonly sparkWidth = SPARK_WIDTH;
  protected readonly sparkHeight = SPARK_HEIGHT;

  readonly valueText = computed(() =>
    new Intl.NumberFormat(this._translate.locale()).format(this.value())
  );

  /**
   * Signed, always, and with a real minus sign rather than a hyphen.
   *
   * `+12`, `−3`, `0`. The sign is the whole content of the number: a delta
   * without one is read as a count, and this one is a difference.
   */
  readonly deltaText = computed(() => {
    const change = this.delta();
    if (change === undefined) {
      return '';
    }

    return new Intl.NumberFormat(this._translate.locale(), {
      signDisplay: 'exceptZero',
    })
      .format(change.value)
      .replace('-', '−');
  });

  /** The commands a `routerLink` wants, which is a mutable array. */
  readonly target = computed(() => {
    const link = this.link();
    return link === undefined || link.length === 0 ? null : [...link];
  });

  /**
   * The shape of the last thirty days beside the number, and nothing more.
   *
   * No axes, no ticks and no hover, because a sparkline that answered questions
   * would be a chart drawn at forty pixels. Its job is to say whether the number
   * above it has been climbing.
   *
   * A flat run sits in the middle rather than on the floor: a straight line
   * halfway up says "unchanged", where a line along the bottom would read as
   * zero.
   */
  readonly spark = computed(() => {
    const trend = this.trend();
    if (trend === undefined || trend.length < 2) {
      return null;
    }

    const lowest = Math.min(...trend);
    const highest = Math.max(...trend);
    const span = highest - lowest;
    const inset = 2;
    const usable = SPARK_HEIGHT - inset * 2;

    const points = trend.map((value, index) => {
      const x = (index / (trend.length - 1)) * SPARK_WIDTH;
      const y =
        span === 0
          ? SPARK_HEIGHT / 2
          : inset + usable - ((value - lowest) / span) * usable;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    return `M${points.join('L')}`;
  });
}
