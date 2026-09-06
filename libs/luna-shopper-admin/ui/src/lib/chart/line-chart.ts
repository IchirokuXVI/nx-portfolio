import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { max as arrayMax, bisector } from 'd3-array';
import { scaleLinear, scaleUtc } from 'd3-scale';
import { line as d3Line } from 'd3-shape';
import { chartColourVar } from './chart-palette';
import {
  countAxis,
  dayFormatter,
  longDayFormatter,
  parseDay,
} from './chart-scale';
import type { ChartSeries } from './chart-types';
import { hostWidth } from './chart-width';

interface PlottedSeries {
  readonly key: string;
  readonly label: string;
  readonly colour: string;
  readonly path: string;
  readonly endLabel: { readonly x: number; readonly y: number } | null;
}

interface HoverPoint {
  readonly key: string;
  readonly label: string;
  readonly colour: string;
  readonly value: string;
  readonly x: number;
  readonly y: number;
}

/**
 * One or more counts over the same run of days (plan 0015, section 3.1).
 *
 * The scales, the tick positions and the `d` strings come from d3's arithmetic
 * modules and every element on screen is an Angular `@for` over an array this
 * component computed. Nothing from `d3-selection` is here, and that is the design
 * rather than an omission: a component that lets d3 write into its own subtree
 * has two owners for one piece of DOM, change detection that cannot know what
 * moved, and specs that have to wait for a transition to finish. Reading this
 * template tells you what is drawn.
 *
 * Everything below is a `computed` off the inputs and the measured width, so
 * there is no hook that recalculates and nothing to unsubscribe from.
 */
@Component({
  selector: 'lib-line-chart',
  imports: [RokuTranslatorPipe],
  template: `
    @if (legend().length > 0) {
      <ul [attr.aria-label]="'chart.legend' | rokuT" class="legend">
        @for (entry of legend(); track entry.key) {
          <li>
            <span [style.background]="entry.colour" class="swatch"></span>
            {{ entry.label }}
          </li>
        }
      </ul>
    }

    <div class="plot">
      <svg
        [attr.aria-label]="title()"
        [attr.height]="height()"
        [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
        [attr.width]="width()"
        role="img"
      >
        <g [attr.transform]="'translate(' + left + ',' + top + ')'">
          @for (tick of yTicks(); track tick.value) {
            <line
              [attr.x2]="innerWidth()"
              [attr.y1]="tick.y"
              [attr.y2]="tick.y"
              class="grid"
              x1="0"
            />
            <text [attr.y]="tick.y" class="tick y" dy="0.32em" x="-8">
              {{ tick.text }}
            </text>
          }

          @for (tick of xTicks(); track tick.day) {
            <text
              [attr.x]="tick.x"
              [attr.y]="innerHeight() + 16"
              class="tick x"
            >
              {{ tick.text }}
            </text>
          }

          @for (plotted of plotted(); track plotted.key) {
            <path [attr.d]="plotted.path" [attr.stroke]="plotted.colour" />
            @if (plotted.endLabel; as endLabel) {
              <text
                [attr.x]="endLabel.x + 6"
                [attr.y]="endLabel.y"
                class="direct"
                dy="0.32em"
              >
                {{ plotted.label }}
              </text>
            }
          }

          @if (hover(); as hovered) {
            <line
              [attr.x1]="hovered.x"
              [attr.x2]="hovered.x"
              [attr.y2]="innerHeight()"
              class="crosshair"
              y1="0"
            />
            @for (point of hovered.points; track point.key) {
              <circle
                [attr.cx]="point.x"
                [attr.cy]="point.y"
                [attr.fill]="point.colour"
                r="4"
              />
            }
          }

          <line
            [attr.x2]="innerWidth()"
            [attr.y1]="innerHeight()"
            [attr.y2]="innerHeight()"
            class="baseline"
            x1="0"
          />

          <rect
            (mouseleave)="leave()"
            (mousemove)="move($event)"
            [attr.height]="innerHeight()"
            [attr.width]="innerWidth()"
            class="hit"
            x="0"
            y="0"
          />
        </g>
      </svg>

      @if (empty()) {
        <p class="empty">{{ 'chart.empty' | rokuT }}</p>
      }

      @if (hover(); as hovered) {
        <div
          [style.left.px]="hovered.tooltipX"
          [style.transform]="hovered.flip ? 'translateX(-100%)' : null"
          class="tooltip"
        >
          <p class="day">{{ hovered.dayText }}</p>
          <dl>
            @for (point of hovered.points; track point.key) {
              <div>
                <dt>
                  <span [style.background]="point.colour" class="swatch"></span>
                  {{ point.label }}
                </dt>
                <dd>{{ point.value }}</dd>
              </div>
            }
          </dl>
        </div>
      }
    </div>

    <button (click)="toggleTable()" class="toggle" type="button">
      {{ (showTable() ? 'chart.hideTable' : 'chart.showTable') | rokuT }}
    </button>

    @if (showTable()) {
      <div class="table">
        <table>
          <caption>
            {{
              title()
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ 'chart.tooltipDay' | rokuT }}</th>
              @for (entry of series(); track entry.key) {
                <th scope="col">{{ entry.label }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of tableRows(); track row.day) {
              <tr>
                <th scope="row">{{ row.dayText }}</th>
                @for (cell of row.cells; track cell.key) {
                  <td>{{ cell.text }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
      margin-block-end: var(--admin-space-2);
      padding: 0;
      list-style: none;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .legend li {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
    }

    .swatch {
      display: inline-block;
      flex: none;
      inline-size: 0.625rem;
      block-size: 0.625rem;
      border-radius: 0.1875rem;
    }

    .plot {
      position: relative;
    }

    svg {
      display: block;
      max-inline-size: 100%;
    }

    path {
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .grid,
    .baseline,
    .crosshair {
      stroke: var(--admin-chart-grid);
      stroke-width: 1;
    }

    .baseline {
      stroke: var(--admin-chart-ink);
    }

    .crosshair {
      stroke: var(--admin-chart-ink);
    }

    .tick {
      font-size: 0.6875rem;
      fill: var(--admin-chart-ink);
    }

    .tick.y {
      text-anchor: end;
    }

    .tick.x {
      text-anchor: middle;
    }

    .direct {
      font-size: 0.75rem;
      fill: var(--admin-ink);
    }

    .hit {
      fill: transparent;
    }

    .empty {
      position: absolute;
      inset-block-start: 50%;
      inset-inline: 0;
      transform: translateY(-50%);
      text-align: center;
      color: var(--admin-ink-muted);
    }

    .tooltip {
      position: absolute;
      inset-block-start: 0;
      z-index: 1;
      min-inline-size: 8rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      box-shadow: 0 0.25rem 0.75rem rgb(0 0 0 / 12%);
      font-size: 0.8125rem;
      color: var(--admin-ink);
      pointer-events: none;
    }

    .tooltip .day {
      margin-block-end: var(--admin-space-1);
      font-weight: 700;
    }

    .tooltip dl {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .tooltip dl > div {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
    }

    .tooltip dt {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      color: var(--admin-ink-muted);
    }

    .tooltip dd {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }

    .toggle {
      margin-block-start: var(--admin-space-2);
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
      text-decoration: underline;
      cursor: pointer;
    }

    .table {
      overflow-x: auto;
      margin-block-start: var(--admin-space-3);
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
    }

    caption {
      margin-block-end: var(--admin-space-2);
      color: var(--admin-ink-muted);
      text-align: start;
    }

    th,
    td {
      padding: var(--admin-space-1) var(--admin-space-2);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
      white-space: nowrap;
    }

    td {
      font-variant-numeric: tabular-nums;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineChart {
  private readonly _translate = inject(RokuTranslatorService);

  readonly series = input.required<readonly ChartSeries[]>();
  /**
   * The accessible name, and what a single series is called.
   *
   * One series therefore has no legend: a box with one swatch restates the title
   * beside it and costs a line of the card.
   */
  readonly title = input.required<string>();
  readonly height = input(220);

  readonly width = hostWidth();

  /** Room for the y tick labels on the left, and for direct labels on the right. */
  protected readonly left = 44;
  protected readonly top = 8;
  private readonly _bottom = 24;

  private readonly _hoverIndex = signal<number | null>(null);
  private readonly _showTable = signal(false);

  readonly showTable = this._showTable.asReadonly();

  private readonly _numbers = computed(
    () => new Intl.NumberFormat(this._translate.locale())
  );

  /**
   * Every day any series names, in order.
   *
   * The union rather than the first series' days, because a series that reported
   * nothing on a day may simply have no row for it, and dropping the day would
   * silently shorten the window for every other series too.
   */
  readonly days = computed(() => {
    const seen = new Set<string>();
    for (const entry of this.series()) {
      for (const point of entry.points) {
        if (parseDay(point.day) !== null) {
          seen.add(point.day);
        }
      }
    }
    return [...seen].sort();
  });

  /**
   * Nothing happened, which is not the same as nothing was asked.
   *
   * An empty input and a window in which every count is zero draw the same
   * thing: the axes, the baseline, and a sentence saying so. A chart that
   * vanished would be read as a chart that failed.
   */
  readonly empty = computed(() => {
    const days = this.days();
    if (days.length === 0) {
      return true;
    }
    return this.series().every((entry) =>
      entry.points.every((point) => point.value === 0)
    );
  });

  readonly innerWidth = computed(() =>
    Math.max(40, this.width() - this.left - this._rightMargin())
  );

  readonly innerHeight = computed(() =>
    Math.max(40, this.height() - this.top - this._bottom)
  );

  private readonly _axis = computed(() => {
    const largest =
      arrayMax(this.series(), (entry) =>
        arrayMax(entry.points, (point) => point.value)
      ) ?? 0;
    return countAxis(largest);
  });

  private readonly _y = computed(() =>
    scaleLinear().domain([0, this._axis().top]).range([this.innerHeight(), 0])
  );

  /**
   * Time along x, even when the window is one day long.
   *
   * A single day gives d3 a zero width domain, which puts every point at the
   * left edge. Nudging the domain by half a day on each side puts the one point
   * in the middle, which is where a reader looks for it.
   */
  private readonly _x = computed(() => {
    const days = this.days();
    const parsed = days.map((day) => parseDay(day) as Date);
    const first = parsed[0] ?? new Date(0);
    const last = parsed[parsed.length - 1] ?? first;
    const halfDay = 12 * 60 * 60 * 1000;
    const domain: [Date, Date] =
      first.getTime() === last.getTime()
        ? [
            new Date(first.getTime() - halfDay),
            new Date(last.getTime() + halfDay),
          ]
        : [first, last];

    return scaleUtc().domain(domain).range([0, this.innerWidth()]);
  });

  readonly yTicks = computed(() => {
    const y = this._y();
    return this._axis().ticks.map((value) => ({
      value,
      y: y(value),
      text: this._numbers().format(value),
    }));
  });

  /** Every seventh day, which is what keeps a thirty day axis to five labels. */
  readonly xTicks = computed(() => {
    const days = this.days();
    const x = this._x();
    const format = dayFormatter(this._translate.locale());
    const ticks: { day: string; x: number; text: string }[] = [];

    for (let index = 0; index < days.length; index += 7) {
      const parsed = parseDay(days[index]);
      if (parsed !== null) {
        ticks.push({
          day: days[index],
          x: x(parsed),
          text: format.format(parsed),
        });
      }
    }

    return ticks;
  });

  /**
   * A legend for two or more series, and never for one.
   *
   * Identity that rests on colour alone is identity a reader who does not see
   * two of the hues apart does not have, which is why four or fewer series are
   * also labelled at their right hand end.
   */
  readonly legend = computed(() => {
    if (this.empty() || this.series().length < 2) {
      return [];
    }
    return this.series().map((entry) => ({
      key: entry.key,
      label: entry.label,
      colour: chartColourVar(entry.colour),
    }));
  });

  readonly plotted = computed<readonly PlottedSeries[]>(() => {
    if (this.empty()) {
      return [];
    }

    const x = this._x();
    const y = this._y();
    const direct = this.series().length >= 2 && this.series().length <= 4;
    const path = d3Line<{ at: Date; value: number }>()
      .x((point) => x(point.at))
      .y((point) => y(point.value));

    return this.series().map((entry) => {
      const points = entry.points
        .map((point) => ({ at: parseDay(point.day), value: point.value }))
        .filter(
          (point): point is { at: Date; value: number } => point.at !== null
        )
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      const last = points[points.length - 1];

      return {
        key: entry.key,
        label: entry.label,
        colour: chartColourVar(entry.colour),
        path: path(points) ?? '',
        endLabel:
          direct && last !== undefined
            ? { x: x(last.at), y: y(last.value) }
            : null,
      };
    });
  });

  readonly hover = computed(() => {
    const index = this._hoverIndex();
    const days = this.days();
    if (index === null || index < 0 || index >= days.length || this.empty()) {
      return null;
    }

    const day = days[index];
    const at = parseDay(day);
    if (at === null) {
      return null;
    }

    const x = this._x();
    const y = this._y();
    const numbers = this._numbers();
    const points: HoverPoint[] = this.series().map((entry) => {
      const value = entry.points.find((point) => point.day === day)?.value ?? 0;
      return {
        key: entry.key,
        label: entry.label,
        colour: chartColourVar(entry.colour),
        value: numbers.format(value),
        x: x(at),
        y: y(value),
      };
    });

    const plotX = x(at);
    return {
      x: plotX,
      dayText: longDayFormatter(this._translate.locale()).format(at),
      points,
      tooltipX: this.left + plotX,
      // Past the middle the tooltip is drawn to the left of the crosshair, so it
      // never leaves the card on the last few days of the window.
      flip: plotX > this.innerWidth() / 2,
    };
  });

  readonly tableRows = computed(() => {
    const numbers = this._numbers();
    const format = longDayFormatter(this._translate.locale());

    return this.days().map((day) => {
      const at = parseDay(day);
      return {
        day,
        dayText: at === null ? day : format.format(at),
        cells: this.series().map((entry) => ({
          key: entry.key,
          text: numbers.format(
            entry.points.find((point) => point.day === day)?.value ?? 0
          ),
        })),
      };
    });
  });

  /**
   * The nearest day to the pointer, from a hit area the full height of the plot.
   *
   * Mouse events and not pointer events, because jsdom has no `PointerEvent` and
   * a chart whose one interactive behaviour cannot be asserted is a chart whose
   * hover breaks silently. The x is taken from the hit rectangle's own bounding
   * box rather than `offsetX`, which jsdom reports as zero for everything.
   */
  protected move(event: MouseEvent): void {
    const target = event.currentTarget as Element | null;
    if (target === null) {
      return;
    }

    const bounds = target.getBoundingClientRect();
    const at = this._x().invert(event.clientX - bounds.left);
    const days = this.days();
    const parsed = days
      .map((day) => parseDay(day))
      .filter((day): day is Date => day !== null);

    const locate = bisector((day: Date) => day.getTime()).center;
    const index = locate(parsed, at.getTime());
    this._hoverIndex.set(index >= 0 && index < parsed.length ? index : null);
  }

  protected leave(): void {
    this._hoverIndex.set(null);
  }

  protected toggleTable(): void {
    this._showTable.update((shown) => !shown);
  }

  /** Room on the right for a direct label, and only when there will be one. */
  private _rightMargin(): number {
    return this.series().length >= 2 && this.series().length <= 4 ? 96 : 12;
  }
}
