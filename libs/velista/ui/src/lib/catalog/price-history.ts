import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  PRICE_HISTORY_RANGES,
  priceAt,
  priceScale,
  pricesWithin,
  steppedPath,
  type ChainPriceStep,
  type PriceHistoryRange,
} from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';

/** One chain's line, with its name already in the reader's language. */
export interface PriceHistoryLine {
  readonly id: string;
  readonly name: string;
  /** Which of the five chart colours the chain wears, from zero. */
  readonly slot: number;
  /** The steps inside the window. The first is at the start of it. */
  readonly steps: readonly ChainPriceStep[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The drawing, in the units of the view box. At a phone's width one unit is one
// pixel, because the card is as wide as the box.
const WIDTH = 326;
const HEIGHT = 176;
const PLOT_LEFT = 36;
const PLOT_RIGHT = 288;
const PLOT_TOP = 20;
const PLOT_BOTTOM = 150;
/** How close two values at the end of the lines may stand before one is moved. */
const END_LABEL_GAP = 11;

/**
 * How the price of one product has moved at each supermarket (velista `0134`,
 * section 6).
 *
 * ## Steps, not slopes
 *
 * A price holds until it changes, so each line is flat and then jumps. A sloped
 * line would say the price was somewhere in between on the days in between, and
 * it never was.
 *
 * ## The legend is the readout
 *
 * It stands above the chart, one entry for each chain: the colour, the name, and
 * the price on the day the chart is read at. A press on an entry hides its line.
 * A colour belongs to a chain, so hiding one never repaints another.
 *
 * ## Read by a press or a drag
 *
 * A range input lies over the plot, with nothing of its own drawn. It gives the
 * press, the drag, the arrow keys and the name a screen reader says, all from the
 * one native control. A dashed line marks the day and the legend follows it. The
 * chart opens on today.
 *
 * ## Never colour alone
 *
 * Three of the Day colours are under 3 to 1 on white. So each line ends in its
 * value written in the text colour, every value in the legend is text, and the
 * price table above the chart is its table view.
 */
@Component({
  selector: 'lib-price-history',
  imports: [RokuTranslatorPipe],
  templateUrl: './price-history.html',
  styleUrl: './price-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceHistory {
  readonly lines = input.required<readonly PriceHistoryLine[]>();
  /** The window, as two moments in milliseconds. */
  readonly from = input.required<number>();
  readonly to = input.required<number>();
  readonly range = input.required<PriceHistoryRange>();
  readonly locale = input.required<string>();
  readonly currency = input<string | null>('EUR');
  /** The product's name, for the chart's accessible name. */
  readonly product = input.required<string>();

  readonly rangeChosen = output<PriceHistoryRange>();

  protected readonly ranges = PRICE_HISTORY_RANGES;
  protected readonly viewBox = `0 0 ${WIDTH} ${HEIGHT}`;
  protected readonly plot = {
    left: PLOT_LEFT,
    right: PLOT_RIGHT,
    top: PLOT_TOP,
    bottom: PLOT_BOTTOM,
    labels: HEIGHT - 6,
    end: PLOT_RIGHT + 6,
  };

  /** The chains whose line is hidden. */
  private readonly _hidden = signal<ReadonlySet<string>>(new Set());

  /** How many days before the end of the window the chart is read at. */
  private readonly _daysBack = signal(0);

  /** How many whole days the window holds. */
  protected readonly days = computed(() =>
    Math.max(1, Math.round((this.to() - this.from()) / DAY_MS))
  );

  /** Where the range input stands: the window's last day is its highest value. */
  protected readonly position = computed(
    () => this.days() - Math.min(this._daysBack(), this.days())
  );

  /** The moment the chart is read at. */
  private readonly _at = computed(
    () => this.to() - (this.days() - this.position()) * DAY_MS
  );

  protected readonly today = computed(() => this.position() === this.days());

  /** Under two prices there is no movement to draw, and one sentence says so. */
  protected readonly drawable = computed(
    () => pricesWithin(this.lines().map((line) => line.steps)) >= 2
  );

  private readonly _shown = computed(() =>
    this.lines().filter((line) => !this._hidden().has(line.id))
  );

  /**
   * The axis holds every line, hidden or not. Hiding a line must not move the
   * others up or down the page: the eye is on them at that moment.
   */
  private readonly _scale = computed(() =>
    priceScale(
      this.lines().flatMap((line) =>
        line.steps
          .map((step) => step.price)
          .filter((price): price is number => price !== null)
      )
    )
  );

  protected readonly ticks = computed(() =>
    this._scale().ticks.map((value) => ({
      y: this._y(value),
      label: this._money(value),
    }))
  );

  /** The grid, as one path: a hairline at each tick. */
  protected readonly grid = computed(() =>
    this.ticks()
      .map((tick) => `M${PLOT_LEFT} ${tick.y}H${PLOT_RIGHT}`)
      .join('')
  );

  protected readonly cursorX = computed(() => this._x(this._at()));

  /** Each line that is on show: its path, its dot on the day, and its end value. */
  protected readonly drawn = computed(() => {
    const at = this._at();
    const to = this.to();
    const lines = this._shown().map((line) => {
      const now = priceAt(line.steps, at);
      const last = priceAt(line.steps, to);
      return {
        id: line.id,
        slot: line.slot,
        path: steppedPath(
          line.steps,
          to,
          (time) => this._x(time),
          (price) => this._y(price)
        ),
        dotY: now === null ? null : this._y(now),
        endY: last === null ? null : this._y(last),
        end: last === null ? '' : this._number(last),
      };
    });
    return spread(lines);
  });

  protected readonly legend = computed(() => {
    const at = this._at();
    const hidden = this._hidden();
    return this.lines().map((line) => {
      const price = priceAt(line.steps, at);
      return {
        id: line.id,
        name: line.name,
        slot: line.slot,
        off: hidden.has(line.id),
        value: price === null ? null : this._money(price),
      };
    });
  });

  /** "9 September", for the sentence under the legend and the input's value. */
  protected readonly dayLong = computed(() =>
    this._date(this._at(), { day: 'numeric', month: 'long' })
  );

  protected readonly startLabel = computed(() =>
    this._date(this.from(), { day: 'numeric', month: 'short' })
  );

  /** The day under the dashed line, unless it would sit on an end label. */
  protected readonly cursorLabel = computed(() => {
    const x = this.cursorX();
    return x - PLOT_LEFT < 44 || PLOT_RIGHT - x < 44
      ? null
      : this._date(this._at(), { day: 'numeric', month: 'short' });
  });

  protected toggle(id: string): void {
    this._hidden.update((hidden) => {
      const next = new Set(hidden);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  protected read(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this._daysBack.set(this.days() - value);
  }

  protected choose(range: PriceHistoryRange): void {
    if (range === this.range()) {
      return;
    }
    // A new window is read at today again, as the chart opens.
    this._daysBack.set(0);
    this.rangeChosen.emit(range);
  }

  private _x(at: number): number {
    const span = this.to() - this.from();
    const share = span <= 0 ? 1 : (at - this.from()) / span;
    return (
      PLOT_LEFT + Math.min(1, Math.max(0, share)) * (PLOT_RIGHT - PLOT_LEFT)
    );
  }

  private _y(price: number): number {
    const { min, max } = this._scale();
    const share = max <= min ? 0.5 : (price - min) / (max - min);
    return (
      Math.round((PLOT_BOTTOM - share * (PLOT_BOTTOM - PLOT_TOP)) * 10) / 10
    );
  }

  private _money(value: number): string {
    return formatMoney(value, this.currency(), this.locale());
  }

  /** A price with no currency sign, for the end of a line, where room is short. */
  private _number(value: number): string {
    try {
      return new Intl.NumberFormat(this.locale(), {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return value.toFixed(2);
    }
  }

  private _date(at: number, options: Intl.DateTimeFormatOptions): string {
    try {
      return new Intl.DateTimeFormat(this.locale(), options).format(at);
    } catch {
      return new Date(at).toISOString().slice(0, 10);
    }
  }
}

interface EndLabelled {
  readonly endY: number | null;
}

/**
 * Where each value at the end of a line is written. Two lines that end close
 * together would write one value over the other, so the labels are moved apart,
 * top to bottom, and kept inside the plot.
 */
function spread<T extends EndLabelled>(
  lines: readonly T[]
): readonly (T & { readonly labelY: number | null })[] {
  const order = lines
    .map((line, index) => ({ index, y: line.endY }))
    .filter((entry): entry is { index: number; y: number } => entry.y !== null)
    .sort((left, right) => left.y - right.y);

  const placed = new Map<number, number>();
  let floor = PLOT_TOP - END_LABEL_GAP;
  for (const entry of order) {
    const y = Math.max(entry.y, floor + END_LABEL_GAP);
    placed.set(entry.index, y);
    floor = y;
  }
  // Pushed past the foot of the plot: move the whole run back up.
  const over = floor - PLOT_BOTTOM;
  if (over > 0) {
    let ceiling = PLOT_BOTTOM + END_LABEL_GAP;
    for (const entry of [...order].reverse()) {
      const y = Math.min(
        placed.get(entry.index) ?? entry.y,
        ceiling - END_LABEL_GAP
      );
      placed.set(entry.index, y);
      ceiling = y;
    }
  }

  return lines.map((line, index) => ({
    ...line,
    labelY: placed.get(index) ?? null,
  }));
}
