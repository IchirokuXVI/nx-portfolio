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
import { scaleLinear } from 'd3-scale';
import { chartColourVar } from './chart-palette';
import { countAxis } from './chart-scale';
import type { ChartBar, ChartSeriesInfo } from './chart-types';
import { hostWidth } from './chart-width';

interface BarSegment {
  readonly key: string;
  readonly colour: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The clip that squares off the bottom of a rounded top segment, or null. */
  readonly clip: string | null;
  readonly radius: number;
}

interface DrawnBar {
  readonly key: string;
  readonly label: string;
  readonly x: number;
  readonly width: number;
  readonly segments: readonly BarSegment[];
  /** The true top of the stack, which is where the clip and the tooltip sit. */
  readonly top: number;
  readonly clipId: string;
}

/**
 * Ids have to be unique across the document, and a page draws more than one of
 * these. A module counter is the cheapest thing that is: nothing reads it back,
 * and two instances never share a number in one document.
 */
let instanceCount = 0;

/**
 * The horizontal room one category label needs before it touches its neighbour.
 *
 * A measurement would be exact and would cost a layout pass per render inside a
 * `computed`, which is the one thing this chart does not do. 56 is wide enough
 * for a short date or a status word at the tick size, which is what these labels
 * are.
 */
const LABEL_SLOT = 56;

/**
 * A value per category, or a stack per category (plan 0015, section 3.2).
 *
 * The same construction as the line chart: d3 does the arithmetic, the template
 * does the drawing, and every element is an `@for` over a computed array.
 *
 * Colour here is identity between the series of a stack and nothing else. A
 * single series draws every bar in the first colour, because colour by category
 * would repeat what the x axis already says and would spend six hues saying it.
 */
@Component({
  selector: 'lib-bar-chart',
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
        <defs>
          @for (bar of drawn(); track bar.key) {
            <clipPath [attr.id]="bar.clipId">
              <rect
                [attr.height]="innerHeight() - bar.top"
                [attr.width]="bar.width"
                [attr.x]="bar.x"
                [attr.y]="bar.top"
              />
            </clipPath>
          }
        </defs>

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

          @for (bar of drawn(); track bar.key) {
            @for (segment of bar.segments; track segment.key) {
              <rect
                [attr.clip-path]="segment.clip"
                [attr.fill]="segment.colour"
                [attr.height]="segment.height"
                [attr.rx]="segment.radius"
                [attr.width]="segment.width"
                [attr.x]="segment.x"
                [attr.y]="segment.y"
                class="segment"
              />
            }
          }

          @for (label of xLabels(); track label.key) {
            <text
              [attr.x]="label.x"
              [attr.y]="innerHeight() + 16"
              class="tick x"
            >
              {{ label.text }}
            </text>
          }

          <line
            [attr.x2]="innerWidth()"
            [attr.y1]="innerHeight()"
            [attr.y2]="innerHeight()"
            class="baseline"
            x1="0"
          />

          @for (bar of drawn(); track bar.key) {
            <rect
              (mouseenter)="enter(bar.key)"
              (mouseleave)="leave()"
              [attr.height]="innerHeight()"
              [attr.width]="bar.width + 2"
              [attr.x]="bar.x - 1"
              class="hit"
              y="0"
            />
          }
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
          <p class="day">{{ hovered.label }}</p>
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
              <th scope="col">{{ 'chart.category' | rokuT }}</th>
              @for (entry of series(); track entry.key) {
                <th scope="col">{{ entry.label }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of tableRows(); track row.key) {
              <tr>
                <th scope="row">{{ row.label }}</th>
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

    .grid,
    .baseline {
      stroke: var(--admin-chart-grid);
      stroke-width: 1;
    }

    .baseline {
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
export class BarChart {
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _uid = `lib-bar-chart-${(instanceCount += 1)}`;

  readonly bars = input.required<readonly ChartBar[]>();
  /** One entry for plain bars, several for a stack, always in stacking order. */
  readonly series = input.required<readonly ChartSeriesInfo[]>();
  readonly title = input.required<string>();
  readonly height = input(220);

  readonly width = hostWidth();

  protected readonly left = 44;
  protected readonly top = 8;
  private readonly _bottom = 24;
  private readonly _right = 12;

  /** The widest a bar gets, however few there are. Air, not a filled slot. */
  private readonly _maxBarWidth = 24;
  /** The gap of surface between neighbours and between stacked segments. */
  private readonly _gap = 2;
  /** The rounding on the data end of a stack, and on no other corner. */
  private readonly _radius = 4;

  private readonly _hoverKey = signal<string | null>(null);
  private readonly _showTable = signal(false);

  readonly showTable = this._showTable.asReadonly();

  private readonly _numbers = computed(
    () => new Intl.NumberFormat(this._translate.locale())
  );

  readonly innerWidth = computed(() =>
    Math.max(40, this.width() - this.left - this._right)
  );

  readonly innerHeight = computed(() =>
    Math.max(40, this.height() - this.top - this._bottom)
  );

  readonly empty = computed(() => {
    const bars = this.bars();
    if (bars.length === 0) {
      return true;
    }
    return bars.every((bar) => bar.values.every((value) => value === 0));
  });

  private readonly _axis = computed(() => {
    let largest = 0;
    for (const bar of this.bars()) {
      const total = bar.values.reduce(
        (sum, value) => sum + Math.max(0, value),
        0
      );
      largest = Math.max(largest, total);
    }
    return countAxis(largest);
  });

  private readonly _y = computed(() =>
    scaleLinear().domain([0, this._axis().top]).range([this.innerHeight(), 0])
  );

  /**
   * A single series takes the first colour whatever number it carries.
   *
   * Colour is identity within a stack. With one series there is nothing to tell
   * apart, so the number the caller gave would be a colour chosen for no reason
   * a reader can recover.
   */
  private readonly _colours = computed(() => {
    const series = this.series();
    if (series.length <= 1) {
      return [chartColourVar(1)];
    }
    return series.map((entry) => chartColourVar(entry.colour));
  });

  readonly yTicks = computed(() => {
    const y = this._y();
    return this._axis().ticks.map((value) => ({
      value,
      y: y(value),
      text: this._numbers().format(value),
    }));
  });

  readonly legend = computed(() => {
    const series = this.series();
    if (this.empty() || series.length < 2) {
      return [];
    }
    const colours = this._colours();
    return series.map((entry, index) => ({
      key: entry.key,
      label: entry.label,
      colour: colours[index],
    }));
  });

  readonly drawn = computed<readonly DrawnBar[]>(() => {
    const bars = this.bars();
    if (bars.length === 0) {
      return [];
    }

    const y = this._y();
    const colours = this._colours();
    const step = this.innerWidth() / bars.length;
    const width = Math.max(2, Math.min(this._maxBarWidth, step - this._gap));
    const baseline = this.innerHeight();

    return bars.map((bar, index) => {
      const x = index * step + (step - width) / 2;
      const topmost = bar.values.reduce(
        (found, value, at) => (value > 0 ? at : found),
        -1
      );

      const segments: BarSegment[] = [];
      let cumulative = 0;

      for (let at = 0; at < bar.values.length; at += 1) {
        const value = Math.max(0, bar.values[at]);
        if (value === 0) {
          continue;
        }

        const bottom = y(cumulative);
        cumulative += value;
        const boxTop = y(cumulative);
        const isTop = at === topmost;
        // The gap is taken off the top of every segment but the last, so one
        // strip of surface separates each touching pair and the stack still ends
        // exactly where its total says.
        const segmentTop = isTop ? boxTop : boxTop + this._gap;
        const height = Math.max(0, bottom - segmentTop);

        segments.push({
          key: `${bar.key}:${at}`,
          colour: colours[Math.min(at, colours.length - 1)],
          x,
          y: segmentTop,
          width,
          // A rounded rect rounds all four corners, and the data end is the only
          // one that may be round. So the top segment is drawn past its own
          // bottom edge and clipped back to it, which squares the two corners
          // that sit on the baseline or on the gap below.
          height: isTop ? height + this._radius : height,
          clip: isTop ? `url(#${this._clipId(bar.key)})` : null,
          radius: isTop ? this._radius : 0,
        });
      }

      const total = bar.values.reduce(
        (sum, value) => sum + Math.max(0, value),
        0
      );

      return {
        key: bar.key,
        label: bar.label,
        x,
        width,
        segments,
        top: total > 0 ? y(total) : baseline,
        clipId: this._clipId(bar.key),
      };
    });
  });

  /**
   * Every nth category label, where n is what the plot has room for.
   *
   * Thirty stacks of one day each is the case this exists for: every label drawn
   * would overlap its neighbours into a grey band, and a band of unreadable text
   * says less than five readable dates. The full label is still one hover away
   * and still in the table.
   *
   * The count that fits comes from the measured width rather than from a fixed
   * ten, because a plot on a phone is half the width of one on a desktop and
   * collides at half as many labels. Ten is what {@link LABEL_SLOT} happens to
   * allow at the default width, so the desktop behaviour is the same either way.
   */
  readonly xLabels = computed(() => {
    const bars = this.drawn();
    const fits = Math.max(1, Math.floor(this.innerWidth() / LABEL_SLOT));
    const stride = bars.length > fits ? Math.ceil(bars.length / fits) : 1;
    const labels: { key: string; x: number; text: string }[] = [];

    for (let index = 0; index < bars.length; index += stride) {
      const bar = bars[index];
      labels.push({
        key: bar.key,
        x: bar.x + bar.width / 2,
        text: bar.label,
      });
    }

    return labels;
  });

  readonly hover = computed(() => {
    const key = this._hoverKey();
    if (key === null || this.empty()) {
      return null;
    }

    const bar = this.bars().find((entry) => entry.key === key);
    const drawn = this.drawn().find((entry) => entry.key === key);
    if (bar === undefined || drawn === undefined) {
      return null;
    }

    const numbers = this._numbers();
    const colours = this._colours();
    const centre = drawn.x + drawn.width / 2;

    return {
      label: bar.label,
      points: this.series().map((entry, index) => ({
        key: entry.key,
        label: entry.label,
        colour: colours[Math.min(index, colours.length - 1)],
        value: numbers.format(bar.values[index] ?? 0),
      })),
      tooltipX: this.left + centre,
      flip: centre > this.innerWidth() / 2,
    };
  });

  readonly tableRows = computed(() => {
    const numbers = this._numbers();
    return this.bars().map((bar) => ({
      key: bar.key,
      label: bar.label,
      cells: this.series().map((entry, index) => ({
        key: entry.key,
        text: numbers.format(bar.values[index] ?? 0),
      })),
    }));
  });

  protected enter(key: string): void {
    this._hoverKey.set(key);
  }

  protected leave(): void {
    this._hoverKey.set(null);
  }

  protected toggleTable(): void {
    this._showTable.update((shown) => !shown);
  }

  private _clipId(key: string): string {
    // Bar keys come from a caller and can hold anything a URL fragment cannot,
    // so the id is this instance's own plus the key's position rather than the
    // key itself.
    const index = this.bars().findIndex((bar) => bar.key === key);
    return `${this._uid}-${index}`;
  }
}
