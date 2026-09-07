import type {
  ChartBar,
  ChartDelta,
  ChartSeriesInfo,
} from '../chart/chart-types';

/**
 * The two shapes every dashboard builds, whichever section it belongs to.
 *
 * Admin plan 0022 split one dashboard into four, one per section, each in the
 * library that owns its screens. The selectors moved with their sections and
 * none of them changed; these two types are what all four still share, so they
 * live here rather than in any one of them.
 *
 * **Here and not in `models`**, which is where the pure things otherwise go.
 * Both of these name what a chart and a tile take, and those types are in this
 * library: `models` cannot import them without a cycle, since `ui` reads
 * `Deployment` from `models` already. A view model shaped by the component that
 * consumes it belongs beside that component anyway.
 */

/** One headline number, as `lib-stat-tile` takes it plus the caption beneath. */
export interface TileView {
  /** Stable across renders: what `@for` tracks. */
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** A line under the tile, already translated. */
  readonly caption: string | null;
  readonly delta: ChartDelta | null;
  readonly trend: readonly number[] | null;
  readonly link: readonly string[] | null;
  /**
   * Query parameters the link carries, for the one screen that reads one.
   *
   * On the tile rather than in a lookup beside it, because a tile is a value and
   * a lookup keyed on a tile's name would be a module level map two callers
   * could disagree about.
   */
  readonly query: Readonly<Record<string, string>> | null;
  readonly tone: 'quiet' | 'attention';
}

/** A bar chart's two inputs, which are always built together. */
export interface BarChartView {
  readonly bars: readonly ChartBar[];
  readonly series: readonly ChartSeriesInfo[];
}
